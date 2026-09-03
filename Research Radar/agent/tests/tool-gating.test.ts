import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createResearchState } from "../src/domain/state.js";
import {
  COMMIT_ISSUE_PROFILE_NAME,
  COMMIT_ISSUE_PROFILE_PARAMETERS,
  createCommitIssueProfileTool,
} from "../src/tools/commit-issue-profile.js";
import { toolsForPhase } from "../src/tools/registry.js";
import { testConfig, validProfileInput } from "./helpers.js";

const registry = [createCommitIssueProfileTool()];

describe("Tool gating (PRD §8, enforced in code)", () => {
  it("exposes commit_issue_profile only during issue_discovery", () => {
    const discovery = toolsForPhase(registry, "issue_discovery").map((tool) => tool.name);
    assert.deepEqual(discovery, [COMMIT_ISSUE_PROFILE_NAME]);

    for (const phase of [
      "issue_committed",
      "authoritative_retrieval",
      "candidate_validation",
      "synthesis",
    ] as const) {
      assert.deepEqual(
        toolsForPhase(registry, phase),
        [],
        `no function tools expected in ${phase} (Milestone 1)`,
      );
    }
  });

  it("keeps the strict tool schema aligned with the validator fields", () => {
    const parameters = COMMIT_ISSUE_PROFILE_PARAMETERS as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    const schemaFields = Object.keys(parameters.properties ?? {}).sort();
    const required = (parameters.required ?? []).slice().sort();
    assert.deepEqual(schemaFields, required, "strict mode requires every property to be required");
    const expected = [
      "affectedActors",
      "canonicalTerms",
      "exclusions",
      "geographicScope",
      "impacts",
      "institutionalTerms",
      "issueDescription",
      "mechanisms",
      "potentialPolicyResponses",
      "problemStatement",
      "searchHypotheses",
      "technicalTerms",
      "temporalScope",
      "title",
    ];
    assert.deepEqual(schemaFields, expected.sort());
    assert.equal((COMMIT_ISSUE_PROFILE_PARAMETERS as { additionalProperties?: boolean }).additionalProperties, false);
  });
});

describe("commit_issue_profile executor (RF-05)", () => {
  const config = testConfig();
  const tool = registry[0]!;

  it("accepts a valid profile, generates ids server-side and transitions the state", async () => {
    const state = createResearchState("question");
    const result = await tool.execute(validProfileInput(), { state, config });

    assert.equal(result["accepted"], true);
    assert.equal(result["nextPhase"], "issue_committed");
    const profile = result["issueProfile"] as { id: string; createdAt: string };
    assert.match(profile.id, /^issue_/);
    assert.ok(profile.createdAt);
    assert.equal(state.phase, "issue_committed");
    assert.equal(state.issueProfile?.title, validProfileInput().title);
  });

  it("rejects a generic label profile and keeps the run in issue_discovery", async () => {
    const state = createResearchState("AI");
    const trivial = {
      ...validProfileInput(),
      title: "AI",
      problemStatement: "AI",
      issueDescription: "AI",
      mechanisms: ["AI", "AI"],
      canonicalTerms: ["AI", "AI"],
      institutionalTerms: ["AI"],
      technicalTerms: ["AI"],
    };
    const result = await tool.execute(trivial, { state, config });
    assert.equal(result["accepted"], false);
    assert.ok(Array.isArray(result["validationErrors"]) && result["validationErrors"].length > 0);
    assert.equal(result["nextPhase"], "issue_discovery");
    assert.equal(state.phase, "issue_discovery");
    assert.equal(state.issueProfile, undefined);
  });

  it("rejects non-JSON/garbage arguments with validation errors", async () => {
    const state = createResearchState("question");
    const result = await tool.execute("not an object", { state, config });
    assert.equal(result["accepted"], false);
    assert.ok((result["validationErrors"] as string[]).some((e) => /JSON object/i.test(e)));
  });

  it("rejects a double commit", async () => {
    const state = createResearchState("question");
    await tool.execute(validProfileInput(), { state, config });
    const second = await tool.execute(validProfileInput(), { state, config });
    assert.equal(second["accepted"], false);
    assert.ok(
      (second["validationErrors"] as string[]).some((e) => /already committed/i.test(e)),
    );
  });
});
