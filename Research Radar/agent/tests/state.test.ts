import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canTransition, applyTransition, createResearchState, ResearchStateError } from "../src/domain/state.js";

describe("Research state machine (PRD §7, code-enforced)", () => {
  it("starts every run in issue_discovery/queued", () => {
    const state = createResearchState("some substantive question");
    assert.equal(state.phase, "issue_discovery");
    assert.equal(state.status, "queued");
    assert.equal(state.activity.length, 0);
  });

  it("allows issue_discovery -> issue_committed and records the transition", () => {
    const state = createResearchState("question");
    applyTransition(state, "issue_committed");
    assert.equal(state.phase, "issue_committed");
    const transition = state.activity.find((entry) => entry.type === "state_transition");
    assert.ok(transition, "state_transition activity expected");
    assert.deepEqual(transition?.outputSummary, { from: "issue_discovery", to: "issue_committed" });
  });

  it("rejects skipping phases", () => {
    const state = createResearchState("question");
    assert.throws(() => applyTransition(state, "authoritative_retrieval"), ResearchStateError);
    assert.throws(() => applyTransition(state, "synthesis"), ResearchStateError);
    assert.equal(state.phase, "issue_discovery", "state must be unchanged after a rejected transition");
  });

  it("rejects going backwards or repeating a phase", () => {
    const state = createResearchState("question");
    applyTransition(state, "issue_committed");
    assert.throws(() => applyTransition(state, "issue_discovery"), ResearchStateError);
    assert.throws(() => applyTransition(state, "issue_committed"), ResearchStateError);
  });

  it("follows the full legal chain up to synthesis", () => {
    const state = createResearchState("question");
    applyTransition(state, "issue_committed");
    applyTransition(state, "authoritative_retrieval");
    applyTransition(state, "candidate_validation");
    applyTransition(state, "synthesis");
    assert.equal(canTransition("synthesis", "issue_discovery"), false);
    assert.throws(() => applyTransition(state, "issue_discovery"), ResearchStateError);
  });
});
