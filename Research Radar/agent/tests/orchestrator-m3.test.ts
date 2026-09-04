import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runResearch } from "../src/agent/orchestrator.js";
import { ModelClient, ModelRequest, ModelResponse } from "../src/agent/openai.js";
import { Candidate, ResearchState } from "../src/domain/models.js";
import { createResearchState } from "../src/domain/state.js";
import { InnovationSourceAdapter, PolicySourceAdapter } from "../src/adapters/types.js";
import { createCommitIssueProfileTool } from "../src/tools/commit-issue-profile.js";
import { createSearchInnovationProjectsTool } from "../src/tools/search-innovation-projects.js";
import { createValidateInnovationCandidatesTool } from "../src/tools/validate-innovation-candidates.js";
import { createSearchPolicyDocumentsTool } from "../src/tools/search-policy-documents.js";
import { createValidatePolicyDocumentsTool } from "../src/tools/validate-policy-documents.js";
import { assistant, functionCall, response, testConfig, validProfileInput } from "./helpers.js";

function innovationCandidates(): Candidate[] {
  return [
    {
      id: "",
      sourceProvider: "cordis-test",
      sourceId: "111",
      sourceUrl: "https://cordis.europa.eu/project/id/111",
      title: "SOVEREIGN-CLOUD — EU federated compute",
      content:
        "Builds EU-controlled federated cloud-edge capacity reducing dependence on non-EU hyperscalers.",
      metadata: {},
      retrievedAt: new Date().toISOString(),
    },
  ];
}

function policyCandidates(): Candidate[] {
  return [
    {
      id: "",
      sourceProvider: "cellar-test",
      sourceId: "52023PC0635",
      sourceUrl: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52023PC0635",
      title: "European Economic Security Strategy",
      content:
        "Recognises dependence on non-EU critical technologies and proposes instruments to reduce it.",
      metadata: { documentType: "communication" },
      retrievedAt: new Date().toISOString(),
    },
    {
      id: "",
      sourceProvider: "cellar-test",
      sourceId: "32022R2483",
      sourceUrl: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022R2483",
      title: "Digital Decade Policy Programme",
      content: "Adopted regulation funding European cloud-edge and data infrastructures.",
      metadata: { documentType: "regulation" },
      retrievedAt: new Date().toISOString(),
    },
    {
      id: "",
      sourceProvider: "cellar-test",
      sourceId: "32024R1689",
      sourceUrl: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689",
      title: "Artificial Intelligence Act",
      content: "Horizontal framework for AI risks regardless of infrastructure control.",
      metadata: { documentType: "regulation" },
      retrievedAt: new Date().toISOString(),
    },
  ];
}

class FakeInnovationAdapter implements InnovationSourceAdapter {
  readonly sourceProvider = "cordis-test";
  private returned = false;
  async searchInnovationProjects() {
    if (this.returned) return [];
    this.returned = true;
    return innovationCandidates().map((candidate) => ({ ...candidate, id: "cand_inn_111" }));
  }
}

class FakePolicyAdapter implements PolicySourceAdapter {
  readonly sourceProvider = "cellar-test";
  private returned = false;
  async searchPolicyDocuments() {
    if (this.returned) return [];
    this.returned = true;
    return policyCandidates().map((candidate) => ({ ...candidate, id: `cand_pol_${candidate.sourceId}` }));
  }
}

function m3Deps(model: ModelClient, capabilities: { innovation: boolean; policy: boolean }) {
  const registry = [createCommitIssueProfileTool()];
  if (capabilities.innovation) {
    const adapter = new FakeInnovationAdapter();
    registry.push(createSearchInnovationProjectsTool(adapter));
    registry.push(createValidateInnovationCandidatesTool());
  }
  if (capabilities.policy) {
    const adapter = new FakePolicyAdapter();
    registry.push(createSearchPolicyDocumentsTool(adapter));
    registry.push(createValidatePolicyDocumentsTool());
  }
  return {
    model,
    registry,
    config: testConfig({
      capabilities: {
        innovationRetrieval: capabilities.innovation,
        policyRetrieval: capabilities.policy,
      },
    }),
    canonicalPrompt: "# test canonical prompt (Milestone 3)",
  };
}

function candidateIdsFrom(input: Array<Record<string, unknown>>): Array<{ candidateId: string; sourceId?: string }> {
  for (let i = input.length - 1; i >= 0; i--) {
    const item = input[i];
    if (!item || item["type"] !== "function_call_output") continue;
    try {
      const parsed = JSON.parse(String(item["output"])) as { candidates?: unknown };
      if (!Array.isArray(parsed["candidates"])) continue;
      return parsed["candidates"]
        .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
        .map((c) => ({
          candidateId: String(c["candidateId"]),
          ...(typeof c["sourceId"] === "string" ? { sourceId: c["sourceId"] } : {}),
        }));
    } catch {
      // keep scanning
    }
  }
  return [];
}

/**
 * Conversation-aware scripted model driving the full Milestone 3 loop:
 * commit → (innovation search → innovation validate) → policy search →
 * policy validate → final synthesis.
 */
class ScriptedM3Model implements ModelClient {
  step = 0;
  committed = false;
  readonly requests: ModelRequest[] = [];

  constructor(
    private readonly innovation: boolean,
    private readonly policy: boolean,
  ) {}

  protected innovationValidations(ids: Array<{ candidateId: string }>): Array<Record<string, unknown>> {
    return ids.map((entry) => ({
      candidateId: entry.candidateId,
      verdict: "relevant",
      matchLevel: "formal_funded_response",
      relevanceExplanation:
        "The project builds EU-controlled federated compute capacity to reduce dependence on non-EU hyperscalers, matching the committed problem.",
      matchedProblemElements: ["dependence on non-EU compute"],
      matchedMechanisms: ["hyperscaler concentration"],
      matchedImpacts: ["strategic autonomy risk"],
      matchedInterventions: ["EU funding for sovereign capacity"],
      exclusionTriggered: null,
    }));
  }

  protected policyValidations(ids: Array<{ candidateId: string; sourceId?: string }>): Array<Record<string, unknown>> {
    return ids.map((entry) => {
      if (entry.sourceId === "52023PC0635") {
        return {
          candidateId: entry.candidateId,
          verdict: "relevant",
          matchLevel: "proposed_intervention",
          policyStage: "planned_initiative",
          relevanceExplanation:
            "The strategy explicitly recognises technological dependence as a risk and proposes instruments to reduce it.",
          matchedProblemElements: ["dependence on non-EU critical technologies"],
          matchedMechanisms: ["hyperscaler concentration"],
          matchedImpacts: ["economic security risk"],
          matchedInterventions: ["EU economic security instruments"],
          exclusionTriggered: null,
        };
      }
      if (entry.sourceId === "32022R2483") {
        return {
          candidateId: entry.candidateId,
          verdict: "relevant",
          matchLevel: "formal_funded_response",
          policyStage: "adopted",
          relevanceExplanation:
            "The adopted Digital Decade regulation funds European cloud-edge and data infrastructures addressing the dependency.",
          matchedProblemElements: ["limited EU-controlled infrastructure"],
          matchedMechanisms: ["lock-in into non-EU stacks"],
          matchedImpacts: ["reduced strategic autonomy"],
          matchedInterventions: ["Digital Decade multi-country projects"],
          exclusionTriggered: null,
        };
      }
      return {
        candidateId: entry.candidateId,
        verdict: "not_relevant",
        matchLevel: "thematic_association",
        policyStage: null,
        relevanceExplanation:
          "The AI Act shares the technology domain but does not address the committed dependency problem.",
        matchedProblemElements: [],
        matchedMechanisms: [],
        matchedImpacts: [],
        matchedInterventions: [],
        exclusionTriggered: null,
      };
    });
  }

  async createResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    this.step++;
    const input = request.input as Array<Record<string, unknown>>;
    const has = (name: string) =>
      input.some((item) => item["type"] === "function_call" && item["name"] === name);

    if (!this.committed && !has("commit_issue_profile")) {
      return response("m3-commit", [functionCall("commit_issue_profile", validProfileInput())]);
    }
    this.committed = true;

    if (this.innovation && !has("search_innovation_projects")) {
      return response("m3-inn-search", [
        functionCall("search_innovation_projects", {
          searchHypothesis: "sovereign cloud initiatives in the EU",
          problemStatement: "European dependence on non-EU compute infrastructure.",
          keywords: ["sovereign cloud"],
          mechanisms: [],
          maxResults: 5,
        }),
      ]);
    }
    if (this.innovation && !has("validate_innovation_candidates")) {
      return response("m3-inn-validate", [
        functionCall("validate_innovation_candidates", {
          validations: this.innovationValidations(candidateIdsFrom(input)),
        }),
      ]);
    }
    if (this.policy && !has("search_policy_documents")) {
      return response("m3-pol-search", [
        functionCall("search_policy_documents", {
          searchHypothesis: "European economic security policy initiatives",
          problemStatement: "European dependence on non-EU compute infrastructure.",
          keywords: ["economic security strategy", "Digital Decade"],
          documentTypes: null,
          maxResults: 5,
        }),
      ]);
    }
    if (this.policy && !has("validate_policy_documents")) {
      return response("m3-pol-validate", [
        functionCall("validate_policy_documents", {
          validations: this.policyValidations(candidateIdsFrom(input)),
        }),
      ]);
    }
    return response("m3-final", [assistant("Final synthesis: policy signals up to adopted stage; innovation evidence present.")]);
  }
}

describe("Milestone 3 orchestrator — policy intelligence vertical slice", () => {
  it("runs the full M3 loop: commit → innovation → policy → validated Evidence with stages → synthesis", async () => {
    const model = new ScriptedM3Model(true, true);
    const state: ResearchState = createResearchState("Investigate EU digital dependence.");
    await runResearch(state, m3Deps(model, { innovation: true, policy: true }));

    assert.equal(state.status, "completed");
    assert.equal(state.phase, "synthesis");

    const transitions = state.activity
      .filter((entry) => entry.type === "state_transition")
      .map((entry) => (entry.outputSummary as { to: string }).to);
    assert.deepEqual(transitions, [
      "issue_committed",
      "authoritative_retrieval",
      "candidate_validation",
      "synthesis",
    ]);

    // Candidates from both domains, all decided.
    assert.equal(state.candidates.length, 4);
    assert.ok(state.candidates.every((candidate) => candidate.status !== "pending"));

    // Evidence: 1 innovation + 2 policy, with stages and provenance.
    assert.equal(state.evidence.length, 3);
    const policyEvidence = state.evidence.filter((evidence) => evidence.policyStage);
    assert.equal(policyEvidence.length, 2);
    const stages = policyEvidence.map((evidence) => evidence.policyStage).sort();
    assert.deepEqual(stages, ["adopted", "planned_initiative"]);
    const adopted = policyEvidence.find((evidence) => evidence.policyStage === "adopted")!;
    assert.equal(adopted.evidenceType, "legislative");
    assert.equal(adopted.sourceProvider, "cellar-test");
    assert.equal(adopted.sourceId, "32022R2483");
    const strategy = policyEvidence.find((evidence) => evidence.policyStage === "planned_initiative")!;
    assert.equal(strategy.evidenceType, "institutional");

    // The AI Act candidate was rejected: thematic association is not relevance.
    assert.equal(
      state.candidates.find((candidate) => candidate.sourceId === "32024R1689")?.status,
      "rejected",
    );

    assert.ok(state.finalMessage?.includes("Final synthesis"));

    // Phase gating: policy tools appear only after the commit.
    const toolNames = (request: ModelRequest) =>
      (request.tools as Array<Record<string, unknown>>)
        .filter((tool) => tool["type"] === "function")
        .map((tool) => String(tool["name"]));
    const firstRequestTools = toolNames(model.requests[0]!);
    assert.deepEqual(firstRequestTools, ["commit_issue_profile"], "no retrieval before the commit (P-02)");
    const postCommitTools = toolNames(model.requests[1]!);
    assert.ok(postCommitTools.includes("search_policy_documents"));
    assert.ok(postCommitTools.includes("search_innovation_projects"));
  });

  it("supports a policy-only deployment (innovation disabled)", async () => {
    const model = new ScriptedM3Model(false, true);
    const state = createResearchState("Investigate EU digital dependence.");
    await runResearch(state, m3Deps(model, { innovation: false, policy: true }));

    assert.equal(state.phase, "synthesis");
    assert.equal(state.candidates.length, 3);
    assert.equal(state.evidence.length, 2);
    assert.ok(state.evidence.every((evidence) => evidence.evidenceType !== "innovation"));
    const postCommitTools = (model.requests[1]?.tools as Array<Record<string, unknown>>)
      .filter((tool) => tool["type"] === "function")
      .map((tool) => String(tool["name"]));
    // The search happens in authoritative_retrieval: the validator is exposed
    // only once candidates exist (candidate_validation).
    assert.deepEqual(postCommitTools, ["search_policy_documents"]);
  });

  it("rejects a premature policy search before the commit (central invariant)", async () => {
    const model = new (class extends ScriptedM3Model {
      private attempted = false;
      override async createResponse(request: ModelRequest): Promise<ModelResponse> {
        if (!this.attempted && !this.committed) {
          this.attempted = true;
          this.requests.push(request);
          this.step++;
          return response("early", [
            functionCall("search_policy_documents", {
              searchHypothesis: "European economic security initiatives",
              problemStatement: "European dependence on non-EU infrastructure.",
              keywords: ["economic security"],
              documentTypes: null,
              maxResults: 5,
            }),
          ]);
        }
        if (!this.committed) {
          this.committed = true;
          this.requests.push(request);
          this.step++;
          return response("give-up", [
            assistant("The input is too generic to identify a substantive Issue; please refine it."),
          ]);
        }
        return super.createResponse(request);
      }
    })(false, true);
    const state = createResearchState("vague input");
    await runResearch(state, m3Deps(model, { innovation: false, policy: true }));

    assert.equal(state.phase, "issue_discovery");
    assert.equal(state.candidates.length, 0);
    assert.equal(state.evidence.length, 0);
    const outputs = state.conversation.filter((item) => item["type"] === "function_call_output");
    const payload = JSON.parse(String(outputs[0]?.["output"])) as { error?: string };
    assert.match(payload.error ?? "", /not available in phase "issue_discovery"|Unknown tool/);
  });
});
