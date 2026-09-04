import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateIssueProfileInput } from "../src/validation/issue-profile.js";
import { validProfileInput } from "./helpers.js";

describe("Issue Profile deterministic quality gate (DATA_MODEL §2)", () => {
  it("accepts a substantive profile", () => {
    const result = validateIssueProfileInput(validProfileInput());
    assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.errors));
  });

  it("rejects the trivial 'AI' profile from the PRD", () => {
    const trivial = {
      title: "AI",
      problemStatement: "AI",
      issueDescription: "AI",
      mechanisms: ["AI", "AI"],
      affectedActors: ["AI", "users"],
      impacts: ["AI", "AI"],
      potentialPolicyResponses: ["AI"],
      canonicalTerms: ["AI", "AI"],
      institutionalTerms: ["AI"],
      technicalTerms: ["AI"],
      exclusions: ["AI"],
      searchHypotheses: ["AI", "AI"],
    };
    const result = validateIssueProfileInput(trivial);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length >= 3, "multiple errors expected");
    assert.ok(
      result.errors.some((error) => /label|characters/i.test(error)),
      `expected label/length errors, got: ${result.errors.join(" | ")}`,
    );
    assert.ok(
      result.errors.some((error) => /collapses into the repeated label/i.test(error)),
      "expected the generic-label collapse error",
    );
  });

  it("rejects a profile whose vocabulary collapses into one repeated label", () => {
    const input = {
      ...validProfileInput(),
      mechanisms: ["energy", "energy", "energy"],
      canonicalTerms: ["energy", "energy"],
      institutionalTerms: ["energy"],
      technicalTerms: ["energy"],
    };
    const result = validateIssueProfileInput(input);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /collapses into the repeated label "energy"/i.test(error)));
  });

  it("rejects a problem statement that merely repeats the title", () => {
    const input = {
      ...validProfileInput(),
      title: "European dependence on non-EU digital infrastructure",
      problemStatement: "European dependence on non-EU digital infrastructure",
    };
    const result = validateIssueProfileInput(input);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /more specific than "title"/i.test(error)));
  });

  it("rejects near-duplicate search hypotheses", () => {
    const input = {
      ...validProfileInput(),
      searchHypotheses: [
        "European technological dependence on non-EU suppliers",
        "european technological dependence on non-EU suppliers",
        "sovereign cloud initiatives in the EU",
      ],
    };
    const result = validateIssueProfileInput(input);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /near-duplicates/i.test(error)));
  });

  it("rejects missing and mistyped fields", () => {
    const missing = validProfileInput() as unknown as Record<string, unknown>;
    delete missing["mechanisms"];
    assert.equal(validateIssueProfileInput(missing).ok, false);

    const mistyped = { ...validProfileInput(), mechanisms: "not-an-array" };
    const result = validateIssueProfileInput(mistyped);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /"mechanisms" must be an array/i.test(error)));
  });

  it("rejects an input that is not an object", () => {
    assert.equal(validateIssueProfileInput("AI").ok, false);
    assert.equal(validateIssueProfileInput(null).ok, false);
    assert.equal(validateIssueProfileInput([validProfileInput()]).ok, false);
  });

  it("accepts optional scopes only when well-formed", () => {
    assert.equal(validateIssueProfileInput({ ...validProfileInput(), temporalScope: { from: "2020", to: null } }).ok, true);
    assert.equal(validateIssueProfileInput({ ...validProfileInput(), temporalScope: { from: "yesterday" } }).ok, false);
    assert.equal(validateIssueProfileInput({ ...validProfileInput(), geographicScope: "EU" }).ok, false);
  });
});
