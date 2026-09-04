import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runResearch } from "../src/agent/orchestrator.js";
import { ModelClient, ModelRequest, ModelResponse } from "../src/agent/openai.js";
import { Candidate, ResearchState } from "../src/domain/models.js";
import { createResearchState } from "../src/domain/state.js";
import { InnovationSourceAdapter } from "../src/adapters/types.js";
import { createCommitIssueProfileTool } from "../src/tools/commit-issue-profile.js";
import { createSearchInnovationProjectsTool } from "../src/tools/search-innovation-projects.js";
import { createValidateInnovationCandidatesTool } from "../src/tools/validate-innovation-candidates.js";
import { assistant, functionCall, response, testConfig, validProfileInput, webSearch } from "./helpers.js";

const CANONICAL = "# test canonical prompt (Milestone 2)";

function m2Deps(model: ModelClient, adapter: InnovationSourceAdapter) {
  return {
    model,
    registry: [
      createCommitIssueProfileTool(),
      createSearchInnovationProjectsTool(adapter),
      createValidateInnovationCandidatesTool(),
    ],
    config: testConfig({
      capabilities: { innovationRetrieval: true, policyRetrieval: false },
    }),
    canonicalPrompt: CANONICAL,
  };
}

/** Adapter stub with stable, recognizable fixtures. */
class FakeAdapter {
  readonly sourceProvider = "cordis-test";
  constructor(private readonly candidates: Candidate[]) {}
  async searchInnovationProjects() {
    return this.candidates.map((candidate) => ({
      ...candidate,
      id: `cand_fixed_${candidate.sourceId}`,
    }));
  }
}

function fixtureCandidates(): Candidate[] {
  return [
    {
      id: "",
      sourceProvider: "cordis-test",
      sourceId: "111",
      sourceUrl: "https://cordis.europa.eu/project/id/111",
      title: "SOVEREIGN-CLOUD — EU federated compute",
      content:
        "Builds EU-controlled federated cloud-edge and HPC capacity, reducing European dependence on non-EU hyperscalers and technology lock-in.",
      metadata: { frameworkProgramme: "Horizon Europe" },
      retrievedAt: new Date().toISOString(),
    },
    {
      id: "",
      sourceProvider: "cordis-test",
      sourceId: "222",
      sourceUrl: "https://cordis.europa.eu/project/id/222",
      title: "AGRI-AI — crop monitoring",
      content: "Applies AI to irrigation and yield prediction for farms on a commercial cloud platform.",
      metadata: {},
      retrievedAt: new Date().toISOString(),
    },
  ];
}

/**
 * Conversation-aware scripted model: drives the full Milestone 2 loop by
 * reading the run state from the request (commit -> search -> validate -> final).
 */
class ScriptedM2Model implements ModelClient {
  step = 0;
  readonly requests: ModelRequest[] = [];
  committed = false;

  async createResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    this.step++;
    const input = request.input as Array<Record<string, unknown>>;
    const hasCommit = input.some((item) => item["type"] === "function_call" && item["name"] === "commit_issue_profile");
    const hasWebSearch = input.some((item) => item["type"] === "web_search_call");

    if (!this.committed && !hasCommit && !hasWebSearch) {
      return response("m2-1", [webSearch("EU sovereign cloud terminology"), assistant("Discovery done.")]);
    }
    if (!this.committed) {
      this.committed = true;
      return response("m2-2", [functionCall("commit_issue_profile", validProfileInput())]);
    }
    if (!input.some((item) => item["type"] === "function_call" && item["name"] === "search_innovation_projects")) {
      return response("m2-3", [
        functionCall("search_innovation_projects", {
          searchHypothesis: "sovereign cloud initiatives in the EU",
          problemStatement: "European dependence on non-EU compute and cloud infrastructure.",
          keywords: ["sovereign cloud", "digital autonomy"],
          mechanisms: ["Concentration of hyperscale cloud capacity"],
          maxResults: 10,
        }),
      ]);
    }
    if (!input.some((item) => item["type"] === "function_call" && item["name"] === "validate_innovation_candidates")) {
      const ids = parseCandidateIds(input);
      return response("m2-4", [
        functionCall("validate_innovation_candidates", {
          validations: ids.map((entry) => {
            if (entry.sourceId === "111") {
              return {
                candidateId: entry.candidateId,
                verdict: "relevant",
                matchLevel: "formal_funded_response",
                relevanceExplanation:
                  "The project builds EU-controlled federated compute capacity to reduce dependence on non-EU hyperscalers, matching the committed problem and mechanisms.",
                matchedProblemElements: ["dependence on non-EU compute"],
                matchedMechanisms: ["hyperscaler concentration"],
                matchedImpacts: ["strategic autonomy risk"],
                matchedInterventions: ["EU funding for sovereign capacity"],
                exclusionTriggered: null,
              };
            }
            return {
              candidateId: entry.candidateId,
              verdict: "not_relevant",
              matchLevel: "thematic_association",
              relevanceExplanation:
                "The project applies AI to agriculture: it shares the technology but addresses a different problem than the committed Issue.",
              matchedProblemElements: [],
              matchedMechanisms: [],
              matchedImpacts: [],
              matchedInterventions: [],
              exclusionTriggered: "Sectoral AI applications unrelated to infrastructure dependency",
            };
          }),
        }),
      ]);
    }
    return response("m2-5", [assistant("Final synthesis: one validated innovation Evidence; one candidate rejected.")]);
  }
}

function parseCandidateIds(input: Array<Record<string, unknown>>): Array<{ candidateId: string; sourceId?: string }> {
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

describe("Milestone 2 orchestrator — full innovation vertical slice", () => {
  it("commits, retrieves CORDIS candidates, validates and synthesizes through code-enforced phases", async () => {
    const model = new ScriptedM2Model();
    const state: ResearchState = createResearchState("Investigate EU dependence on non-EU digital infrastructure.");
    await runResearch(state, m2Deps(model, new FakeAdapter(fixtureCandidates())));

    // Full phase chain traversed by the orchestrator only.
    const transitions = state.activity
      .filter((entry) => entry.type === "state_transition")
      .map((entry) => (entry.outputSummary as { from: string; to: string }).to);
    assert.deepEqual(transitions, [
      "issue_committed",
      "authoritative_retrieval",
      "candidate_validation",
      "synthesis",
    ]);
    assert.equal(state.status, "completed");

    // Candidates retrieved, deduplicated, decided.
    assert.equal(state.candidates.length, 2);
    assert.equal(state.candidates.find((c) => c.sourceId === "111")?.status, "accepted");
    assert.equal(state.candidates.find((c) => c.sourceId === "222")?.status, "rejected");

    // P-04: exactly the accepted candidate became Evidence, with provenance.
    assert.equal(state.evidence.length, 1);
    const evidence = state.evidence[0]!;
    assert.equal(evidence.evidenceType, "innovation");
    assert.equal(evidence.sourceId, "111");
    assert.equal(evidence.sourceUrl, "https://cordis.europa.eu/project/id/111");
    assert.ok(evidence.relevanceExplanation.length > 0);

    assert.ok(state.finalMessage?.includes("Final synthesis"));

    // Tool exposure was phase-gated across the run (P-02/§8).
    const toolNames = (request: ModelRequest) =>
      (request.tools as Array<Record<string, unknown>>)
        .filter((tool) => tool["type"] === "function")
        .map((tool) => String(tool["name"]));
    assert.deepEqual(toolNames(model.requests[0]!), ["commit_issue_profile"]);
    assert.equal(toolNames(model.requests[1]!).includes("search_innovation_projects"), false);
    assert.deepEqual(toolNames(model.requests[2]!), ["search_innovation_projects"]);
    assert.deepEqual(toolNames(model.requests[3]!), ["search_innovation_projects", "validate_innovation_candidates"]);
    assert.deepEqual(toolNames(model.requests[4]!), []);

    // Phase-entry instructions were injected exactly once per phase.
    for (const marker of [
      "Phase authoritative_retrieval is now open",
      "Candidate validation is now open",
      "phase synthesis is open",
    ]) {
      assert.equal(
        state.conversation.filter(
          (item) => item["role"] === "user" && String(item["content"]).includes(marker),
        ).length,
        1,
        `expected exactly one nudge containing "${marker}"`,
      );
    }
  });

  it("rejects authoritative retrieval attempted before the commit (central invariant)", async () => {
    const model = new (class extends ScriptedM2Model {
      override async createResponse(request: ModelRequest): Promise<ModelResponse> {
        const input = request.input as Array<Record<string, unknown>>;
        const hasRejectedSearch = input.some(
          (item) =>
            item["type"] === "function_call_output" &&
            String(item["output"]).includes("search_innovation_projects"),
        );
        if (!hasRejectedSearch) {
          this.requests.push(request);
          this.step++;
          return response("early", [
            functionCall("search_innovation_projects", {
              searchHypothesis: "sovereign cloud initiatives in the EU",
              problemStatement: "European dependence on non-EU compute infrastructure.",
              keywords: ["sovereign cloud"],
              mechanisms: [],
              maxResults: 5,
            }),
          ]);
        }
        // After the rejection the model asks the user for a substantive Issue.
        this.requests.push(request);
        this.step++;
        return response("early-final", [
          assistant("The input is too generic to commit an Issue Profile; please describe the substantive problem."),
        ]);
      }
    })();
    const state = createResearchState("generic input");
    await runResearch(state, m2Deps(model, new FakeAdapter(fixtureCandidates())));

    assert.equal(state.phase, "issue_discovery", "state must not advance without a committed profile");
    assert.equal(state.candidates.length, 0);
    assert.equal(state.evidence.length, 0);
    const outputs = state.conversation.filter((item) => item["type"] === "function_call_output");
    const payload = JSON.parse(String(outputs[0]?.["output"])) as { error?: string };
    assert.match(payload.error ?? "", /not available in phase "issue_discovery"|Unknown tool/);
  });

  it("reaches synthesis even when every candidate is rejected (gap reporting)", async () => {
    const model = new (class extends ScriptedM2Model {
      async validateResponse(input: Array<Record<string, unknown>>): Promise<ModelResponse> {
        const ids = parseCandidateIds(input);
        return response("m2-4", [
          functionCall("validate_innovation_candidates", {
            validations: ids.map((entry) => ({
              candidateId: entry.candidateId,
              verdict: "not_relevant",
              matchLevel: "thematic_association",
              relevanceExplanation:
                "The candidate does not address the committed problem: it only shares vocabulary with the Issue.",
              matchedProblemElements: [],
              matchedMechanisms: [],
              matchedImpacts: [],
              matchedInterventions: [],
              exclusionTriggered: null,
            })),
          }),
        ]);
      }
      override async createResponse(request: ModelRequest): Promise<ModelResponse> {
        const input = request.input as Array<Record<string, unknown>>;
        const hasValidate = input.some((item) => item["type"] === "function_call" && item["name"] === "validate_innovation_candidates");
        const hasSearch = input.some((item) => item["type"] === "function_call" && item["name"] === "search_innovation_projects");
        if (this.committed && hasSearch && !hasValidate) {
          this.requests.push(request);
          this.step++;
          return this.validateResponse(input);
        }
        return super.createResponse(request);
      }
    })();
    const state = createResearchState("question");
    await runResearch(state, m2Deps(model, new FakeAdapter(fixtureCandidates())));

    assert.equal(state.phase, "synthesis");
    assert.equal(state.evidence.length, 0);
    assert.equal(state.candidates.every((candidate) => candidate.status === "rejected"), true);
    assert.ok(state.finalMessage);
  });

  it("nudges the model when candidates are left pending, then accepts an explicit gap report", async () => {
    const model = new (class extends ScriptedM2Model {
      pauseCount = 0;
      override async createResponse(request: ModelRequest): Promise<ModelResponse> {
        const input = request.input as Array<Record<string, unknown>>;
        const hasValidate = input.some((item) => item["type"] === "function_call" && item["name"] === "validate_innovation_candidates");
        const hasSearch = input.some((item) => item["type"] === "function_call" && item["name"] === "search_innovation_projects");
        if (this.committed && hasSearch && !hasValidate && this.pauseCount < 1) {
          this.pauseCount++;
          this.requests.push(request);
          this.step++;
          return response("pause", [assistant("Still evaluating the candidates.")]);
        }
        return super.createResponse(request);
      }
    })();
    const state = createResearchState("question");
    await runResearch(state, m2Deps(model, new FakeAdapter(fixtureCandidates())));

    const reminders = state.conversation.filter(
      (item) => item["role"] === "user" && String(item["content"]).includes("still pending a decision"),
    );
    assert.equal(reminders.length, 1, "exactly one bounded reminder expected");
    assert.equal(state.status, "completed");
  });
});
