import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCordisQuery, CordisAdapter, extractRecords, normalizeProject } from "../src/adapters/cordis.js";
import { AdapterError } from "../src/adapters/types.js";

const INTENT = {
  searchHypothesis: "sovereign cloud and AI factory initiatives in the EU",
  problemStatement:
    "European firms and institutions depend on non-EU controlled compute, cloud and semiconductor infrastructure.",
  keywords: ["sovereign cloud", "strategic autonomy"],
  mechanisms: ["Concentration of hyperscale cloud capacity under non-EU operators"],
  maxResults: 10,
};

describe("CORDIS query building (recall-oriented, Stage B)", () => {
  it("expands the profile vocabulary over title and objective with OR", () => {
    const query = buildCordisQuery(INTENT);
    assert.ok(query.startsWith("contenttype='project' AND ("));
    assert.ok(query.includes("title='sovereign cloud'"));
    assert.ok(query.includes("objective='sovereign cloud'"));
    assert.ok(query.includes("OR"));
    assert.ok(query.includes("Concentration of hyperscale cloud capacity under non-EU operators"));
  });

  it("escapes single quotes in OData values", () => {
    const query = buildCordisQuery({ ...INTENT, keywords: ["Europe's cloud"] });
    assert.ok(query.includes("title='Europe''s cloud'"));
  });

  it("falls back to the search hypothesis when no valid terms are provided", () => {
    const query = buildCordisQuery({ ...INTENT, keywords: [], mechanisms: ["ab"] });
    assert.ok(query.includes(INTENT.searchHypothesis));
  });
});

describe("CORDIS result parsing (tolerant normalization)", () => {
  it("parses the WireFrame extraction container", () => {
    const payload = {
      type: "WireFrame",
      payload: {
        data: [
          {
            order: 0,
            fields: [
              { name: "rcn", value: "101138085" },
              { name: "acronym", value: "EURO-COMPUTE" },
              { name: "title", value: "European federated sovereign compute capacity" },
              { name: "objective", value: "Build EU-controlled federated compute and cloud-edge capacity." },
              { name: "frameworkProgramme", value: "Horizon Europe" },
              { name: "totalCost", value: "24000000" },
              { name: "ecMaxContribution", value: 19500000 },
            ],
          },
        ],
      },
    };
    const records = extractRecords(payload);
    assert.equal(records.length, 1);
    const candidate = normalizeProject(records[0]!, "cordis");
    assert.equal(candidate.sourceProvider, "cordis");
    assert.equal(candidate.sourceId, "101138085");
    assert.equal(candidate.sourceUrl, "https://cordis.europa.eu/project/id/101138085");
    assert.match(candidate.title, /EURO-COMPUTE/);
    assert.ok(candidate.content?.includes("federated"));
    assert.equal(candidate.metadata["frameworkProgramme"], "Horizon Europe");
    assert.equal(candidate.metadata["totalCostEur"], 24_000_000);
    assert.equal(candidate.metadata["ecContributionEur"], 19_500_000);
    assert.ok(candidate.retrievedAt);
  });

  it("parses plain-array and results-wrapper containers", () => {
    const plain = [{ rcn: "1", title: "A", objective: "x" }];
    assert.equal(extractRecords(plain).length, 1);
    const wrapped = { results: [{ rcn: "2", title: "B" }] };
    assert.equal(extractRecords(wrapped).length, 1);
    assert.equal(extractRecords({ unexpected: true }).length, 0);
    assert.equal(extractRecords("nope").length, 0);
  });
});

describe("CORDIS extraction flow (official API contract)", () => {
  function fakeFetchFlow(handlers: Array<(url: string) => unknown>) {
    let call = 0;
    return async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = String(input);
      const handler = handlers[call];
      call++;
      if (!handler) throw new Error(`unexpected fetch #${call}: ${url}`);
      const body = handler(url);
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  }

  it("submits, polls and downloads the extraction, returning normalized candidates", async () => {
    const fetchImpl = fakeFetchFlow([
      (url) => {
        assert.ok(url.includes("/api/dataextractions/getExtraction?"));
        assert.ok(url.includes(encodeURIComponent("contenttype='project'")));
        assert.ok(url.includes("key="));
        return { taskID: 4242 };
      },
      (url) => {
        assert.ok(url.includes("getExtractionStatus"));
        assert.ok(url.includes("taskId=4242"));
        return { status: "COMPLETED", destinationFileUri: "https://cordis.europa.eu/api/dataextractions/download/4242" };
      },
      (url) => {
        assert.ok(url.includes("download/4242"));
        return {
          type: "WireFrame",
          payload: { data: [{ order: 0, fields: [{ name: "rcn", value: "77" }, { name: "title", value: "T" }] }] },
        };
      },
    ]);

    const adapter = new CordisAdapter({
      apiKey: "secret-key",
      timeoutMs: 5_000,
      pollIntervalMs: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const candidates = await adapter.searchInnovationProjects(INTENT);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.sourceId, "77");
  });

  it("wraps HTTP failures in AdapterError without leaking the API key or URL", async () => {
    const fetchImpl = (async () =>
      new Response("denied", { status: 403 })) as unknown as typeof fetch;
    const adapter = new CordisAdapter({ apiKey: "secret-key", timeoutMs: 500, fetchImpl });
    await assert.rejects(
      () => adapter.searchInnovationProjects(INTENT),
      (error: unknown) => {
        assert.ok(error instanceof AdapterError);
        assert.match(error.message, /\[cordis\] HTTP 403/);
        assert.ok(!error.message.includes("secret-key"));
        return true;
      },
    );
  });

  it("surfaces extraction task failures and empty/unrecognized payloads", async () => {
    const failing = fakeFetchFlow([
      () => ({ taskID: 9 }),
      () => ({ status: "ERROR", errorMessage: "invalid query" }),
    ]);
    const adapter = new CordisAdapter({ apiKey: "k", timeoutMs: 2_000, pollIntervalMs: 1, fetchImpl: failing as unknown as typeof fetch });
    await assert.rejects(
      () => adapter.searchInnovationProjects(INTENT),
      (error: unknown) => {
        assert.match((error as Error).message, /invalid query/);
        return true;
      },
    );

    const empty = fakeFetchFlow([
      () => ({ taskID: 10 }),
      () => ({ status: "COMPLETED", destinationFileUri: "https://x/file" }),
      () => ({ foo: "bar" }),
    ]);
    const adapter2 = new CordisAdapter({ apiKey: "k", timeoutMs: 2_000, pollIntervalMs: 1, fetchImpl: empty as unknown as typeof fetch });
    await assert.rejects(
      () => adapter2.searchInnovationProjects(INTENT),
      (error: unknown) => {
        assert.match((error as Error).message, /did not contain any recognizable project record/);
        return true;
      },
    );
  });
});
