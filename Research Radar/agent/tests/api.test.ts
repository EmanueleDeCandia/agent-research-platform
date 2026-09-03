import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { AddressInfo } from "node:net";
import { createApp } from "../src/server/app.js";
import { ResearchStore } from "../src/server/store.js";
import { createResearchState } from "../src/domain/state.js";
import { applyTransition } from "../src/domain/state.js";
import { buildIssueProfile, validateIssueProfileInput } from "../src/validation/issue-profile.js";
import { testConfig, validProfileInput } from "./helpers.js";
import { Server } from "node:http";
import { fileURLToPath } from "node:url";

describe("HTTP API integration", () => {
  let server: Server;
  let baseUrl: string;
  const store = new ResearchStore();

  const runner = async (state: import("../src/domain/models.js").ResearchState): Promise<void> => {
    // Simulated successful Milestone 1 run without network/model access.
    state.status = "running";
    const parsed = validateIssueProfileInput(validProfileInput());
    assert.equal(parsed.ok, true);
    applyTransition(state, "issue_committed");
    state.issueProfile = buildIssueProfile((parsed as { ok: true; value: never }).value);
    state.finalMessage = "Simulated final summary.";
    state.status = "completed";
  };

  before(async () => {
    server = createApp({
      store,
      runner,
      config: testConfig(),
      publicDir: fileURLToPath(new URL("../web/public", import.meta.url)),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("health endpoint responds", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
  });

  it("starts a research run and exposes the committed state (RF-06/RF-07)", async () => {
    const start = await fetch(`${baseUrl}/api/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Investigate EU dependence on non-EU compute infrastructure." }),
    });
    assert.equal(start.status, 202);
    const created = (await start.json()) as { id: string };
    assert.ok(created.id);

    const detail = await fetch(`${baseUrl}/api/research/${created.id}`);
    assert.equal(detail.status, 200);
    const state = (await detail.json()) as {
      phase: string;
      status: string;
      issueProfile: { title: string } | null;
      activity: Array<{ type: string }>;
      finalMessage: string | null;
      conversation?: unknown;
    };
    assert.equal(state.phase, "issue_committed");
    assert.equal(state.status, "completed");
    assert.ok(state.issueProfile?.title);
    assert.ok(state.activity.some((entry) => entry.type === "state_transition"));
    assert.equal(state.finalMessage, "Simulated final summary.");
    assert.equal(state.conversation, undefined, "internal conversation must not be serialized");
  });

  it("rejects empty or too short questions (RF-01 contract)", async () => {
    const bad = await fetch(`${baseUrl}/api/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "AI" }),
    });
    assert.equal(bad.status, 400);
  });

  it("returns 404 for unknown runs", async () => {
    const res = await fetch(`${baseUrl}/api/research/run_does_not_exist`);
    assert.equal(res.status, 404);
  });

  it("serves the UI", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    const html = await res.text();
    assert.match(html, /RUN RESEARCH/);
    assert.match(html, /Describe the substantive issue you want to investigate/);
  });

  it("lists runs without exposing internals", async () => {
    store.create("short question for listing");
    const res = await fetch(`${baseUrl}/api/research`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { runs: Array<{ id: string; phase: string }> };
    assert.ok(body.runs.length >= 1);
    assert.ok(body.runs.every((run) => typeof run.id === "string" && typeof run.phase === "string"));
  });
});
