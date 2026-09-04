import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Candidate } from "../src/domain/models.js";
import { applyTransition, createResearchState } from "../src/domain/state.js";
import { validateIssueProfileInput, buildIssueProfile } from "../src/validation/issue-profile.js";
import {
  SEARCH_INNOVATION_PROJECTS_NAME,
  createSearchInnovationProjectsTool,
} from "../src/tools/search-innovation-projects.js";
import {
  VALIDATE_INNOVATION_CANDIDATES_NAME,
  createValidateInnovationCandidatesTool,
} from "../src/tools/validate-innovation-candidates.js";
import { toolsForPhase } from "../src/tools/registry.js";
import { InnovationSourceAdapter } from "../src/adapters/types.js";
import { testConfig, validProfileInput } from "./helpers.js";

function makeCandidate(rcn: string, title: string, objective: string): Candidate {
  return {
    id: `cand_${rcn}`,
    sourceProvider: "cordis-test",
    sourceId: rcn,
    sourceUrl: `https://cordis.europa.eu/project/id/${rcn}`,
    title,
    summary: objective.slice(0, 200),
    content: objective,
    metadata: { frameworkProgramme: "Horizon Europe", ecContributionEur: 1000 },
    retrievedAt: new Date().toISOString(),
  };
}

const RELEVANT = makeCandidate(
  "111",
  "SOVEREIGN-CLOUD — EU federated sovereign compute",
  "Reduces dependence on non-EU hyperscalers by building EU-controlled federated cloud-edge and HPC capacity for European industry and public administrations.",
);
const AGRI = makeCandidate(
  "222",
  "AGRI-AI — AI crop monitoring",
  "Applies machine learning to irrigation and yield prediction for European farms, running on a commercial cloud platform.",
);

function fakeAdapter(candidates: Candidate[], failWith?: Error): InnovationSourceAdapter {
  return {
    sourceProvider: "cordis-test",
    async searchInnovationProjects() {
      if (failWith) throw failWith;
      return candidates.map((candidate) => ({ ...candidate }));
    },
  };
}

function committedState() {
  const state = createResearchState("question");
  const parsed = validateIssueProfileInput(validProfileInput());
  assert.equal(parsed.ok, true);
  applyTransition(state, "issue_committed");
  state.issueProfile = buildIssueProfile((parsed as { ok: true; value: ReturnType<typeof validProfileInput> }).value);
  applyTransition(state, "authoritative_retrieval");
  return state;
}

const VALID_SEARCH_ARGS = {
  searchHypothesis: "sovereign cloud initiatives in the EU",
  problemStatement:
    "European firms and institutions depend on non-EU controlled compute and cloud infrastructure.",
  keywords: ["sovereign cloud", "strategic autonomy"],
  mechanisms: ["Concentration of hyperscale cloud capacity"],
  maxResults: 10,
};

describe("search_innovation_projects (RF-08)", () => {
  const config = testConfig();

  it("is available only in authoritative_retrieval and candidate_validation", () => {
    const registry = [
      createSearchInnovationProjectsTool(fakeAdapter([])),
      createValidateInnovationCandidatesTool(),
    ];
    const names = (phase: Parameters<typeof toolsForPhase>[1]) =>
      toolsForPhase(registry, phase).map((tool) => tool.name);
    assert.deepEqual(names("issue_discovery").includes(SEARCH_INNOVATION_PROJECTS_NAME), false);
    assert.deepEqual(names("issue_committed"), []);
    assert.deepEqual(names("authoritative_retrieval"), [SEARCH_INNOVATION_PROJECTS_NAME]);
    assert.deepEqual(names("candidate_validation"), [
      SEARCH_INNOVATION_PROJECTS_NAME,
      VALIDATE_INNOVATION_CANDIDATES_NAME,
    ]);
    assert.deepEqual(names("synthesis"), []);
  });

  it("refuses to run without a committed Issue Profile (P-02, defense in depth)", async () => {
    const tool = createSearchInnovationProjectsTool(fakeAdapter([RELEVANT]));
    const state = createResearchState("generic question"); // still issue_discovery, no profile
    const result = await tool.execute(VALID_SEARCH_ARGS, { state, config });
    assert.match(String(result["error"]), /not allowed before the commit/);
    assert.equal(state.candidates.length, 0);
  });

  it("returns normalized Candidates with dedup by canonical source id (RF-14)", async () => {
    const tool = createSearchInnovationProjectsTool(fakeAdapter([RELEVANT, AGRI, { ...RELEVANT }]));
    const state = committedState();
    const result = await tool.execute(VALID_SEARCH_ARGS, { state, config });

    assert.equal(result["newCandidates"], 2);
    assert.equal(result["duplicates"], 1);
    assert.equal(state.candidates.length, 2);
    assert.equal(state.candidates.every((candidate) => candidate.status === "pending"), true);
    const view = (result["candidates"] as Array<Record<string, unknown>>)[0] as Record<string, unknown> | undefined;
    assert.equal(view?.["sourceProvider"], "cordis-test");
    assert.equal(typeof view?.["candidateId"], "string");
    assert.ok(typeof view?.["content"] === "string" && (view?.["content"] as string).length > 0);
    assert.match(String(result["guidance"]), /Candidates, not Evidence/);
  });

  it("validates the intent contract and surfaces adapter failures", async () => {
    const state = committedState();
    const bad = await createSearchInnovationProjectsTool(fakeAdapter([])).execute(
      { ...VALID_SEARCH_ARGS, keywords: [] },
      { state, config },
    );
    assert.match(String(bad["error"]), /keywords/);

    const failing = await createSearchInnovationProjectsTool(
      fakeAdapter([], new Error("CORDIS unreachable")),
    ).execute(VALID_SEARCH_ARGS, { state, config });
    assert.match(String(failing["error"]), /CORDIS unreachable/);
  });
});

describe("validate_innovation_candidates (RF-09, §10)", () => {
  const config = testConfig();

  function stateWithCandidates() {
    const state = committedState();
    applyTransition(state, "candidate_validation");
    state.candidates.push(
      { ...RELEVANT, status: "pending" },
      { ...AGRI, status: "pending" },
    );
    return state;
  }

  const relevantDecision = {
    candidateId: "cand_111",
    verdict: "relevant",
    matchLevel: "formal_funded_response",
    relevanceExplanation:
      "The project directly builds EU-controlled compute capacity to reduce dependence on non-EU hyperscalers, matching problem, mechanisms and impacts.",
    matchedProblemElements: ["dependence on non-EU compute"],
    matchedMechanisms: ["Concentration of hyperscale cloud capacity"],
    matchedImpacts: ["reduced strategic autonomy"],
    matchedInterventions: ["EU funding for sovereign cloud"],
    exclusionTriggered: null,
  };

  const notRelevantDecision = {
    candidateId: "cand_222",
    verdict: "not_relevant",
    matchLevel: "thematic_association",
    relevanceExplanation:
      "The project applies AI to agriculture: it shares the technology but addresses a completely different problem than the committed Issue.",
    matchedProblemElements: [],
    matchedMechanisms: [],
    matchedImpacts: [],
    matchedInterventions: [],
    exclusionTriggered: "Projects applying AI to sectoral problems without addressing dependency or autonomy",
  };

  it("accepts a relevant candidate and builds Evidence server-side (P-04)", async () => {
    const state = stateWithCandidates();
    const result = await createValidateInnovationCandidatesTool().execute(
      { validations: [relevantDecision] },
      { state, config },
    );

    assert.equal(result["accepted"], 1);
    assert.equal(state.evidence.length, 1);
    const evidence = state.evidence[0]!;
    assert.equal(evidence.evidenceType, "innovation");
    assert.equal(evidence.candidateId, "cand_111");
    assert.equal(evidence.issueId, state.issueProfile?.id);
    assert.equal(evidence.sourceProvider, "cordis-test");
    assert.equal(evidence.sourceId, "111");
    assert.match(evidence.id, /^evid_/);
    assert.ok(evidence.createdAt);
    assert.equal(state.candidates.find((c) => c.id === "cand_111")?.status, "accepted");
  });

  it("rejects the same-technology-different-problem candidate (Milestone 2 success criterion)", async () => {
    const state = stateWithCandidates();
    const result = await createValidateInnovationCandidatesTool().execute(
      { validations: [notRelevantDecision] },
      { state, config },
    );
    assert.equal(result["rejected"], 1);
    assert.equal(state.evidence.length, 0);
    const candidate = state.candidates.find((c) => c.id === "cand_222");
    assert.equal(candidate?.status, "rejected");
    assert.equal(candidate?.validation?.exclusionTriggered, notRelevantDecision.exclusionTriggered);
  });

  it("guards the relevance contract: weak match level or exclusion cannot become Evidence", async () => {
    const state = stateWithCandidates();
    const tool = createValidateInnovationCandidatesTool();
    const weak = await tool.execute(
      {
        validations: [
          { ...relevantDecision, matchLevel: "thematic_association" },
          { ...notRelevantDecision, verdict: "relevant", matchLevel: "substantive_discussion" },
        ],
      },
      { state, config },
    );
    const errors = weak["errors"] as Array<{ error: string }>;
    assert.equal(errors.length, 2);
    assert.match(errors[0]?.error ?? "", /cannot be Evidence at matchLevel/);
    assert.match(errors[1]?.error ?? "", /cannot be relevant.*exclusion/);
    assert.equal(state.evidence.length, 0);
    assert.equal(state.candidates.every((candidate) => candidate.status === "pending"), true);
  });

  it("records insufficient_content as an information gap, not as Evidence", async () => {
    const state = stateWithCandidates();
    const result = await createValidateInnovationCandidatesTool().execute(
      { validations: [{ ...relevantDecision, verdict: "insufficient_content", matchLevel: "incidental_mention" }] },
      { state, config },
    );
    assert.equal(result["insufficientContent"], 1);
    assert.equal(state.evidence.length, 0);
    assert.equal(state.candidates.find((c) => c.id === "cand_111")?.status, "insufficient_content");
  });

  it("rejects unknown ids, double decisions and malformed batches", async () => {
    const state = stateWithCandidates();
    const tool = createValidateInnovationCandidatesTool();
    const first = await tool.execute({ validations: [{ ...relevantDecision, candidateId: "nope" }] }, { state, config });
    assert.equal((first["errors"] as unknown[]).length, 1);

    await tool.execute({ validations: [relevantDecision] }, { state, config });
    const second = await tool.execute({ validations: [relevantDecision] }, { state, config });
    assert.match(
      String((second["errors"] as Array<{ error: string }>)[0]?.error),
      /already decided/,
    );

    const malformed = await tool.execute({ validations: "not-an-array" }, { state, config });
    assert.match(String(malformed["error"]), /must be an array/);
  });
});
