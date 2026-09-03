import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runResearch } from "../src/agent/orchestrator.js";
import { ModelClient } from "../src/agent/openai.js";
import { ResearchState } from "../src/domain/models.js";
import { createResearchState } from "../src/domain/state.js";
import { createCommitIssueProfileTool } from "../src/tools/commit-issue-profile.js";
import {
  assistant,
  assistantWithCitation,
  FakeModelClient,
  functionCall,
  response,
  testConfig,
  validProfileInput,
  webSearch,
} from "./helpers.js";

const CANONICAL = "# test canonical prompt";
const REGISTRY = [createCommitIssueProfileTool()];

function depsWith(model: ModelClient, overrides: Record<string, unknown> = {}) {
  return {
    model,
    registry: REGISTRY,
    config: testConfig(overrides as never),
    canonicalPrompt: CANONICAL,
  };
}

function committedOutputFromState(state: ResearchState) {
  return state.conversation.filter((item) => item["type"] === "function_call_output");
}

describe("Research orchestrator — Milestone 1 loop", () => {
  it("happy path: discovery -> web search -> commit -> final summary", async () => {
    const model = new FakeModelClient([
      response("r1", [
        webSearch("EU strategic autonomy digital infrastructure"),
        assistantWithCitation(
          "Institutional language includes “technological sovereignty” and “AI factories”.",
          "https://example.eu/autonomy",
          "Strategic autonomy overview",
        ),
      ]),
      response("r2", [functionCall("commit_issue_profile", validProfileInput())]),
      response("r3", [assistant("Final Issue Understanding summary.")]),
    ]);
    const state = createResearchState(
      "Investigate European dependence on non-EU digital infrastructure and its policy responses.",
    );

    await runResearch(state, depsWith(model));

    assert.equal(state.status, "completed");
    assert.equal(state.phase, "issue_committed");
    assert.ok(state.issueProfile);
    assert.equal(state.finalMessage, "Final Issue Understanding summary.");
    assert.equal(state.counters.modelTurns, 3);
    assert.equal(state.counters.toolCalls, 1);
    assert.equal(state.counters.webSearches, 1);
    assert.deepEqual(
      state.discoverySources.map((source) => source.url),
      ["https://example.eu/autonomy"],
    );

    const types = state.activity.map((entry) => entry.type);
    assert.ok(types.includes("web_search"));
    assert.ok(types.includes("tool_call"));
    assert.ok(types.includes("tool_result"));
    assert.ok(types.includes("state_transition"));
    assert.ok(types.includes("note"));

    // Function call output was appended to the conversation (model sees acceptance).
    const outputs = committedOutputFromState(state);
    assert.equal(outputs.length, 1);
    const payload = JSON.parse(String(outputs[0]?.["output"])) as { accepted: boolean; nextPhase: string };
    assert.equal(payload.accepted, true);
    assert.equal(payload.nextPhase, "issue_committed");

    // Tool exposure was phase-dependent across turns.
    const turn1Tools = model.requests[0]?.tools as Array<Record<string, unknown>>;
    const turn2Tools = model.requests[1]?.tools as Array<Record<string, unknown>>;
    const turn3Tools = model.requests[2]?.tools as Array<Record<string, unknown>>;
    assert.ok(turn1Tools?.some((tool) => tool["type"] === "function" && tool["name"] === "commit_issue_profile"));
    assert.ok(turn2Tools?.some((tool) => tool["type"] === "web_search"));
    assert.equal(
      turn3Tools?.some((tool) => tool["type"] === "function" && tool["name"] === "commit_issue_profile"),
      false,
      "commit tool must disappear after the phase changed",
    );
  });

  it("rejection path: trivial profile rejected, model retries with a valid one", async () => {
    const trivial = { ...validProfileInput(), title: "AI", problemStatement: "AI", issueDescription: "AI" };
    const model = new FakeModelClient([
      response("r1", [functionCall("commit_issue_profile", trivial)]),
      response("r2", [functionCall("commit_issue_profile", validProfileInput())]),
      response("r3", [assistant("Summary after successful commit.")]),
    ]);
    const state = createResearchState("generic AI input from the user");

    await runResearch(state, depsWith(model));

    assert.equal(state.phase, "issue_committed");
    assert.equal(state.status, "completed");
    const outputs = committedOutputFromState(state);
    assert.equal(outputs.length, 2);
    const first = JSON.parse(String(outputs[0]?.["output"])) as { accepted: boolean; validationErrors?: string[] };
    assert.equal(first.accepted, false);
    assert.ok((first.validationErrors ?? []).length > 0);
  });

  it("rejects a hallucinated authoritative tool call (gating in depth, Milestone 1)", async () => {
    const model = new FakeModelClient([
      response("r1", [functionCall("search_innovation_projects", { query: "sovereign cloud" })]),
      response("r2", [assistant("No authoritative retrieval is possible in this milestone.")]),
    ]);
    const state = createResearchState("question about sovereign cloud");

    await runResearch(state, depsWith(model));

    assert.equal(state.phase, "issue_discovery", "state must not advance without a committed profile");
    assert.equal(state.status, "completed");
    const outputs = committedOutputFromState(state);
    const payload = JSON.parse(String(outputs[0]?.["output"])) as { error?: string };
    assert.match(payload.error ?? "", /Unknown tool "search_innovation_projects"/);
  });

  it("stops when the model turn budget is exhausted", async () => {
    const garbage = { ...validProfileInput(), title: "AI" };
    const scripted = Array.from({ length: 10 }, (_, i) =>
      response(`r${i}`, [functionCall("commit_issue_profile", garbage, `_${i}`)]),
    );
    const model = new FakeModelClient(scripted);
    const state = createResearchState("question");

    await runResearch(state, depsWith(model, { maxModelTurns: 4 }));

    assert.equal(state.status, "stopped");
    assert.equal(state.phase, "issue_discovery");
    assert.equal(state.counters.modelTurns, 4);
    const lastNote = [...state.activity].reverse().find((entry) => entry.type === "note");
    assert.match(lastNote?.summary ?? "", /budget/);
  });

  it("marks the run as error when the model client fails", async () => {
    const model = new (class implements ModelClient {
      async createResponse(): Promise<never> {
        throw new Error("boom: upstream unavailable");
      }
    })();
    const state = createResearchState("question");
    await runResearch(state, depsWith(model));

    assert.equal(state.status, "error");
    assert.match(state.errorMessage ?? "", /boom/);
    assert.ok(state.activity.some((entry) => entry.type === "error"));
  });

  it("does not silently end a run in issue_discovery after narration (RF-02)", async () => {
    const model = new FakeModelClient([
      response("r1", [
        webSearch("EU terminology for the problem"),
        assistantWithCitation("Found relevant institutional language.", "https://example.eu/x", "X"),
      ]),
      response("r2", [functionCall("commit_issue_profile", validProfileInput())]),
      response("r3", [assistant("Final summary after commit.")]),
    ]);
    const state = createResearchState("question");
    await runResearch(state, depsWith(model));

    // The first turn had no function call: the orchestrator must have nudged
    // the model to continue instead of ending the run in issue_discovery.
    const nudges = state.conversation.filter(
      (item) => item["role"] === "user" && String(item["content"]).includes("Continue the research"),
    );
    assert.equal(nudges.length, 1);
    assert.equal(state.phase, "issue_committed");
    assert.equal(state.status, "completed");
  });

  it("accepts a clarification request as final message after bounded nudges", async () => {
    const model = new FakeModelClient([
      response("r1", [assistant("Which specific problem within 'energy' should I investigate?")]),
      response("r2", [assistant("Clarification request: please describe the concrete problem.")]),
      response("r3", [assistant("Clarification request: please describe the concrete problem.")]),
    ]);
    const state = createResearchState("energy");
    await runResearch(state, depsWith(model));

    assert.equal(state.phase, "issue_discovery", "no profile invented from a generic topic");
    assert.equal(state.status, "completed");
    assert.match(state.finalMessage ?? "", /Clarification request/);
  });

  it("sends the wrap-up nudge after commit in a Milestone 1 deployment", async () => {
    const model = new FakeModelClient([
      response("r1", [functionCall("commit_issue_profile", validProfileInput())]),
      response("r2", [assistant("Final summary.")]),
    ]);
    const state = createResearchState("question");
    await runResearch(state, depsWith(model));

    const nudges = state.conversation.filter(
      (item) => item["role"] === "user" && String(item["content"]).includes("Milestone 1"),
    );
    assert.equal(nudges.length, 1);
  });
});
