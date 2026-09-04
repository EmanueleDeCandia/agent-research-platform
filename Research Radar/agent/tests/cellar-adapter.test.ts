import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCellarSparql, CellarAdapter, normalizePolicyDocument } from "../src/adapters/cellar.js";
import { AdapterError } from "../src/adapters/types.js";

const INTENT = {
  searchHypothesis: "European economic security and digital autonomy initiatives",
  problemStatement:
    "European firms and institutions depend on non-EU controlled compute, cloud and semiconductor infrastructure.",
  keywords: ["economic security strategy", "Digital Decade", "sovereign cloud"],
  maxResults: 10,
};

describe("CELLAR SPARQL query building (recall-oriented, source syntax stays in the adapter)", () => {
  it("builds a title-matching query with OR filters and a LIMIT", () => {
    const sparql = buildCellarSparql(INTENT, 40);
    assert.ok(sparql.includes("PREFIX cdm:"));
    assert.ok(sparql.includes("cdm:resource_legal_has_celex ?celex"));
    assert.ok(sparql.includes("FILTER (LANG(?title) = 'en')"));
    assert.ok(sparql.includes("CONTAINS(LCASE(STR(?title)), LCASE('sovereign cloud'))"));
    assert.ok(sparql.includes("||"));
    assert.ok(sparql.includes("LIMIT 40"));
  });

  it("escapes single quotes and backslashes in terms", () => {
    const sparql = buildCellarSparql({ ...INTENT, keywords: ["Europe's cloud"] }, 10);
    assert.ok(sparql.includes("Europe\\'s cloud"));
  });

  it("falls back to the problem statement when no usable keywords exist", () => {
    const sparql = buildCellarSparql({ ...INTENT, keywords: ["ab", "cde"] }, 10);
    assert.ok(sparql.includes("CONTAINS"));
    assert.ok(sparql.length > 0);
  });

  it("caps the LIMIT defensively", () => {
    assert.ok(buildCellarSparql(INTENT, 99999).includes("LIMIT 200"));
    assert.ok(buildCellarSparql(INTENT, 0).includes("LIMIT 1"));
  });
});

describe("CELLAR result normalization", () => {
  it("maps SPARQL bindings to Candidates with CELEX provenance and EUR-Lex URL", () => {
    const candidate = normalizePolicyDocument(
      {
        work: { value: "http://publications.europa.eu/resource/celex/52023PC0635" },
        celex: { value: "52023PC0635" },
        title: { value: "European Economic Security Strategy" },
        date: { value: "2023-06-20" },
        docType: { value: "http://publications.europa.eu/resource/authority/resource-type/COMMUNICATION" },
      },
      "cellar",
    );
    assert.ok(candidate);
    assert.equal(candidate?.sourceProvider, "cellar");
    assert.equal(candidate?.sourceId, "52023PC0635");
    assert.equal(
      candidate?.sourceUrl,
      "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52023PC0635",
    );
    assert.equal(candidate?.metadata["documentType"], "COMMUNICATION");
    assert.equal(candidate?.metadata["cellarWork"], "http://publications.europa.eu/resource/celex/52023PC0635");
    assert.equal(candidate?.publishedAt, "2023-06-20");
    assert.ok(candidate?.retrievedAt);
  });

  it("drops bindings without celex or title", () => {
    assert.equal(normalizePolicyDocument({ celex: { value: "1" } }, "cellar"), null);
    assert.equal(normalizePolicyDocument({ title: { value: "T" } }, "cellar"), null);
    assert.equal(normalizePolicyDocument({}, "cellar"), null);
  });
});

describe("CELLAR adapter flow", () => {
  function sparqlResponse(bindings: Array<Record<string, { value: string }>>) {
    return { results: { bindings } };
  }

  it("queries the endpoint, normalizes and dedupes by CELEX", async () => {
    const seenUrls: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = String(input);
      seenUrls.push(url);
      assert.ok(url.startsWith("https://publications.europa.eu/sparql?query="));
      assert.ok(url.includes(encodeURIComponent("cdm:resource_legal_has_celex")));
      return new Response(
        JSON.stringify(
          sparqlResponse([
            {
              work: { value: "w:1" },
              celex: { value: "52023PC0635" },
              title: { value: "European Economic Security Strategy" },
            },
            {
              work: { value: "w:1-dup" },
              celex: { value: "52023PC0635" },
              title: { value: "European Economic Security Strategy" },
            },
            {
              work: { value: "w:2" },
              celex: { value: "32022R2483" },
              title: { value: "Digital Decade Policy Programme" },
            },
          ]),
        ),
        { status: 200, headers: { "Content-Type": "application/sparql-results+json" } },
      );
    }) as unknown as typeof fetch;

    const adapter = new CellarAdapter({ timeoutMs: 5_000, fetchImpl });
    const candidates = await adapter.searchPolicyDocuments(INTENT);
    assert.equal(candidates.length, 2, "duplicate CELEX must collapse");
    assert.deepEqual(
      candidates.map((candidate) => candidate.sourceId),
      ["52023PC0635", "32022R2483"],
    );
    assert.equal(seenUrls.length, 1);
  });

  it("wraps failures in AdapterError (no match, bad payload, HTTP error)", async () => {
    const empty = (async () => new Response(JSON.stringify(sparqlResponse([])))) as unknown as typeof fetch;
    await assert.rejects(
      () => new CellarAdapter({ timeoutMs: 500, fetchImpl: empty }).searchPolicyDocuments(INTENT),
      (error: unknown) => {
        assert.ok(error instanceof AdapterError);
        assert.match(error.message, /no documents matched/);
        return true;
      },
    );

    const badPayload = (async () => new Response("<html>gateway error</html>")) as unknown as typeof fetch;
    await assert.rejects(
      () => new CellarAdapter({ timeoutMs: 500, fetchImpl: badPayload }).searchPolicyDocuments(INTENT),
      (error: unknown) => {
        assert.ok(error instanceof AdapterError);
        return true;
      },
    );

    const httpError = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await assert.rejects(
      () => new CellarAdapter({ timeoutMs: 500, fetchImpl: httpError }).searchPolicyDocuments(INTENT),
      (error: unknown) => {
        assert.ok(error instanceof AdapterError);
        assert.match(error.message, /HTTP 503/);
        return true;
      },
    );
  });

  it("filters by requested document types without dropping unknown-typed records", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify(
          sparqlResponse([
            { celex: { value: "1" }, title: { value: "A communication" }, docType: { value: "u/communication" } },
            { celex: { value: "2" }, title: { value: "A regulation" }, docType: { value: "u/regulation" } },
            { celex: { value: "3" }, title: { value: "No type record" } },
          ]),
        ),
        { status: 200 },
      )) as unknown as typeof fetch;

    const adapter = new CellarAdapter({ timeoutMs: 5_000, fetchImpl });
    const candidates = await adapter.searchPolicyDocuments({
      ...INTENT,
      documentTypes: ["communication"],
    });
    assert.deepEqual(
      candidates.map((candidate) => candidate.sourceId),
      ["1", "3"],
      "unknown-typed records are kept for recall; validation decides",
    );
  });
});
