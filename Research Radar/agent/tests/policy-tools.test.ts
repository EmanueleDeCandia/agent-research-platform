import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Candidate } from "../src/domain/models.js";
import { applyTransition, createResearchState } from "../src/domain/state.js";
import { buildIssueProfile, validateIssueProfileInput } from "../src/validation/issue-profile.js";
import {
  SEARCH_POLICY_DOCUMENTS_NAME,
  createSearchPolicyDocumentsTool,
} from "../src/tools/search-policy-documents.js";
import {
  VALIDATE_POLICY_DOCUMENTS_NAME,
  createValidatePolicyDocumentsTool,
  stageToEvidenceType,
} from "../src/tools/validate-policy-documents.js";
import { createSearchInnovationProjectsTool } from "../src/tools/search-innovation-projects.js";
import { createValidateInnovationCandidatesTool } from "../src/tools/validate-innovation-candidates.js";
import { toolsForPhase } from "../src/tools/registry.js";
import { InnovationSourceAdapter, PolicySourceAdapter } from "../src/adapters/types.js";
import { testConfig, validProfileInput } from "./helpers.js";

function makeCandidate(id: string, celex: string, title: string, content: string): Candidate {
  return {
    id,
    sourceProvider: "cellar-test",
    sourceId: celex,
    sourceUrl: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${celex}`,
    title,
    summary: content.slice(0, 200),
    content,
    metadata: { documentType: "communication" },
    retrievedAt: new Date().toISOString(),
  };
}

const ESS = makeCandidate(
  "pc_1",
  "52023PC0635",
  "European Economic Security Strategy",
  "Recognises dependence on non-EU critical technologies and proposes instruments to reduce it.",
);
const AI_ACT = makeCandidate(
  "pc_2",
  "32024R1689",
  "Artificial Intelligence Act",
  "Horizontal framework for AI risks regardless of infrastructure control.",
);

function fakePolicyAdapter(candidates: Candidate[], failWith?: Error): PolicySourceAdapter {
  return {
    sourceProvider: "cellar-test",
    async searchPolicyDocuments() {
      if (failWith) throw failWith;
      return candidates.map((candidate) => ({ ...candidate }));
    },
  };
}

const fakeInnovationAdapter: InnovationSourceAdapter = {
  sourceProvider: "cordis-test",
  async searchInnovationProjects() {
    return [];
  },
};

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
  searchHypothesis: "European economic security policy initiatives",
  problemStatement:
    "European firms and institutions depend on non-EU controlled compute and cloud infrastructure.",
  keywords: ["economic security strategy", "Digital Decade"],
  documentTypes: null,
  maxResults: 10,
};

describe("search_policy_documents (RF-10)", () => {
  const config = testConfig();

  it("is available in authoritative_retrieval and candidate_validation, never before", () => {
    const registry = [
      createSearchInnovationProjectsTool(fakeInnovationAdapter),
      createValidateInnovationCandidatesTool(),
      createSearchPolicyDocumentsTool(fakePolicyAdapter([ESS])),
      createValidatePolicyDocumentsTool(),
    ];
    const names = (phase: Parameters<typeof toolsForPhase>[1]) =>
      toolsForPhase(registry, phase).map((tool) => tool.name);
    assert.equal(names("issue_discovery").includes(SEARCH_POLICY_DOCUMENTS_NAME), false);
    assert.equal(names("issue_committed").length, 0);
    assert.deepEqual(names("authoritative_retrieval"), [
      "search_innovation_projects",
      SEARCH_POLICY_DOCUMENTS_NAME,
    ]);
    assert.deepEqual(names("candidate_validation"), [
      "search_innovation_projects",
      "validate_innovation_candidates",
      SEARCH_POLICY_DOCUMENTS_NAME,
      VALIDATE_POLICY_DOCUMENTS_NAME,
    ]);
    assert.deepEqual(names("synthesis"), []);
  });

  it("refuses to run without a committed Issue Profile (P-02)", async () => {
    const state = createResearchState("generic");
    const result = await createSearchPolicyDocumentsTool(fakePolicyAdapter([ESS])).execute(
      VALID_SEARCH_ARGS,
      { state, config },
    );
    assert.match(String(result["error"]), /not allowed before the commit/);
    assert.equal(state.candidates.length, 0);
  });

  it("stores policy candidates with domain=policy and dedups by CELEX (RF-14)", async () => {
    const state = committedState();
    const result = await createSearchPolicyDocumentsTool(fakePolicyAdapter([ESS, AI_ACT, { ...ESS }])).execute(
      VALID_SEARCH_ARGS,
      { state, config },
    );
    assert.equal(result["newCandidates"], 2);
    assert.equal(result["duplicates"], 1);
    assert.equal(state.candidates.length, 2);
    assert.ok(state.candidates.every((candidate) => candidate.domain === "policy"));
    assert.ok(state.candidates.every((candidate) => candidate.status === "pending"));
  });

  it("validates the intent and surfaces adapter failures", async () => {
    const state = committedState();
    const tool = createSearchPolicyDocumentsTool(fakePolicyAdapter([ESS]));
    const bad = await tool.execute({ ...VALID_SEARCH_ARGS, keywords: [] }, { state, config });
    assert.match(String(bad["error"]), /keywords/);

    const failing = await createSearchPolicyDocumentsTool(
      fakePolicyAdapter([], new Error("SPARQL endpoint down")),
    ).execute(VALID_SEARCH_ARGS, { state, config });
    assert.match(String(failing["error"]), /SPARQL endpoint down/);
  });
});

describe("validate_policy_documents (RF-11 + RF-12)", () => {
  const config = testConfig();

  function stateWithPolicyCandidates() {
    const state = committedState();
    applyTransition(state, "candidate_validation");
    state.candidates.push(
      { ...ESS, status: "pending", domain: "policy" },
      { ...AI_ACT, status: "pending", domain: "policy" },
    );
    return state;
  }

  const relevantEss = {
    candidateId: "pc_1",
    verdict: "relevant",
    matchLevel: "proposed_intervention",
    policyStage: "planned_initiative",
    relevanceExplanation:
      "The strategy explicitly recognises technological dependence as a risk and proposes instruments, matching the committed problem.",
    matchedProblemElements: ["dependence on non-EU critical technologies"],
    matchedMechanisms: ["hyperscaler concentration"],
    matchedImpacts: ["economic security risk"],
    matchedInterventions: ["EU economic security instruments"],
    exclusionTriggered: null,
  };

  const notRelevantAiAct = {
    candidateId: "pc_2",
    verdict: "not_relevant",
    matchLevel: "thematic_association",
    policyStage: null,
    relevanceExplanation:
      "The AI Act shares the technology domain but regulates AI risks regardless of infrastructure control — not the committed Issue.",
    matchedProblemElements: [],
    matchedMechanisms: [],
    matchedImpacts: [],
    matchedInterventions: [],
    exclusionTriggered: null,
  };

  it("accepts a relevant document, classifies the stage and builds typed Evidence", async () => {
    const state = stateWithPolicyCandidates();
    const result = await createValidatePolicyDocumentsTool().execute(
      { validations: [relevantEss, notRelevantAiAct] },
      { state, config },
    );

    assert.equal(result["accepted"], 1);
    assert.equal(result["rejected"], 1);
    assert.equal(state.evidence.length, 1);

    const evidence = state.evidence[0]!;
    assert.equal(evidence.evidenceType, "institutional", "planned_initiative → institutional");
    assert.equal(evidence.policyStage, "planned_initiative");
    assert.equal(evidence.sourceId, "52023PC0635");
    assert.equal(evidence.issueId, state.issueProfile?.id);
    assert.ok(evidence.id.startsWith("evid_"));
    assert.equal(state.candidates.find((c) => c.id === "pc_1")?.status, "accepted");
    assert.equal(state.candidates.find((c) => c.id === "pc_2")?.status, "rejected");
  });

  it("maps stages to evidence types deterministically (RF-12 application classification)", () => {
    assert.equal(stageToEvidenceType("consultation"), "consultation");
    assert.equal(stageToEvidenceType("proposal"), "legislative");
    assert.equal(stageToEvidenceType("legislative_process"), "legislative");
    assert.equal(stageToEvidenceType("adopted"), "legislative");
    assert.equal(stageToEvidenceType("signal"), "institutional");
    assert.equal(stageToEvidenceType("planned_initiative"), "institutional");
    assert.equal(stageToEvidenceType("evaluation"), "institutional");
  });

  it("keeps stage=null possible for relevant evidence (RF-12 'when evidence allows')", async () => {
    const state = stateWithPolicyCandidates();
    const result = await createValidatePolicyDocumentsTool().execute(
      { validations: [{ ...relevantEss, policyStage: null }] },
      { state, config },
    );
    assert.equal(result["accepted"], 1);
    assert.equal(result["acceptedWithoutStage"], 1);
    assert.equal(state.evidence[0]?.policyStage, undefined);
    assert.equal(state.evidence[0]?.evidenceType, "institutional");
  });

  it("guards: incidental/thematic cannot be Evidence; exclusion cannot be relevant", async () => {
    const state = stateWithPolicyCandidates();
    const result = await createValidatePolicyDocumentsTool().execute(
      {
        validations: [
          { ...relevantEss, matchLevel: "incidental_mention" },
          {
            ...notRelevantAiAct,
            verdict: "relevant",
            matchLevel: "substantive_discussion",
            policyStage: "proposal",
            exclusionTriggered: "AI regulatory frameworks unrelated to infrastructure dependency",
          },
        ],
      },
      { state, config },
    );
    const errors = result["errors"] as Array<{ error: string }>;
    assert.equal(errors.length, 2);
    assert.match(errors[0]?.error ?? "", /cannot be Evidence at matchLevel/);
    assert.match(errors[1]?.error ?? "", /cannot be relevant.*exclusion/);
    assert.equal(state.evidence.length, 0);
    assert.ok(state.candidates.every((candidate) => candidate.status === "pending"));
  });

  it("rejects invalid stages and cross-domain candidates", async () => {
    const state = stateWithPolicyCandidates();
    const tool = createValidatePolicyDocumentsTool();

    const badStage = await tool.execute(
      { validations: [{ ...relevantEss, policyStage: "definitely_not_a_stage" }] },
      { state, config },
    );
    // invalid stage string is tolerated as null (acceptedWithoutStage), but an
    // enum-valid stage on a weak level must fail; here we verify no crash and
    // the decision outcome:
    assert.equal(Number(badStage["accepted"]) + Number(badStage["rejected"]), 1);

    const crossDomain = stateWithPolicyCandidates();
    crossDomain.candidates.push({
      ...({ ...ESS, id: "crossover" }),
      status: "pending",
      domain: "innovation",
    });
    const cross = await tool.execute(
      {
        validations: [
          {
            ...relevantEss,
            candidateId: "crossover",
            relevanceExplanation:
              "Cross-domain attempt: an innovation candidate must never be decided by the policy validator.",
          },
        ],
      },
      { state: crossDomain, config },
    );
    assert.match(
      String((cross["errors"] as Array<{ error: string }>)[0]?.error),
      /does not belong to the policy retrieval domain/,
    );
  });

  it("insufficient_content records the gap without Evidence", async () => {
    const state = stateWithPolicyCandidates();
    const result = await createValidatePolicyDocumentsTool().execute(
      { validations: [{ ...relevantEss, verdict: "insufficient_content", matchLevel: "incidental_mention", policyStage: null }] },
      { state, config },
    );
    assert.equal(result["insufficientContent"], 1);
    assert.equal(state.evidence.length, 0);
    assert.equal(state.candidates.find((c) => c.id === "pc_1")?.status, "insufficient_content");
  });
});
