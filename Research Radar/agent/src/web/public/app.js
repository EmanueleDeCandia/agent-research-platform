/* Research Radar — UI controller (vanilla JS, no build step).
   The browser only talks to this server; all external calls are server-side. */

"use strict";

const $ = (sel) => document.querySelector(sel);

const PHASES = [
  "issue_discovery",
  "issue_committed",
  "authoritative_retrieval",
  "candidate_validation",
  "synthesis",
];

let config = null;
let currentRunId = null;
let pollTimer = null;
let activeTab = "activity";
let lastState = null;

init();

async function init() {
  config = await fetchJson("/api/config");
  renderBadges();
  wireTabs();
  $("#run-btn").addEventListener("click", onRun);
  await refreshRecent();
}

function renderBadges() {
  const badges = $("#badges");
  const items = [];
  if (config.demoMode) {
    items.push('<span class="badge demo">DEMO MODE — scripted model, not a real run</span>');
  } else {
    items.push(`<span class="badge">model: ${esc(config.model)}</span>`);
  }
  items.push('<span class="badge">milestone 1 — issue understanding</span>');
  if (config.capabilities && !config.capabilities.innovationRetrieval) {
    items.push('<span class="badge">authoritative retrieval: locked</span>');
  }
  badges.innerHTML = items.join("");
}

function wireTabs() {
  for (const btn of document.querySelectorAll(".tab")) {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("locked")) return;
      activeTab = btn.dataset.tab;
      for (const b of document.querySelectorAll(".tab")) b.classList.toggle("active", b === btn);
      if (lastState) renderTab(lastState);
    });
  }
}

async function onRun() {
  const question = $("#question").value.trim();
  const status = $("#run-status");
  if (question.length < 10) {
    status.textContent = "Describe the issue with at least 10 characters.";
    status.className = "run-status error";
    return;
  }
  status.className = "run-status";
  status.textContent = "Starting research run…";
  $("#run-btn").disabled = true;
  try {
    const res = await fetchJson("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    currentRunId = res.id;
    status.textContent = `Run ${res.id} started — polling agent activity…`;
    startPolling();
  } catch (error) {
    status.textContent = `Failed to start: ${error.message}`;
    status.className = "run-status error";
    $("#run-btn").disabled = false;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(poll, 1200);
  poll();
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function poll() {
  if (!currentRunId) return stopPolling();
  let state;
  try {
    state = await fetchJson(`/api/research/${currentRunId}`);
  } catch (error) {
    $("#run-status").textContent = `Poll error: ${error.message}`;
    return;
  }
  lastState = state;
  renderPipeline(state);
  renderTab(state);
  const done = state.status !== "queued" && state.status !== "running";
  if (done) {
    stopPolling();
    $("#run-btn").disabled = false;
    const status = $("#run-status");
    status.className = "run-status";
    status.textContent =
      `Run ${state.status}` +
      (state.errorMessage ? ` — ${state.errorMessage}` : "") +
      ` · ${state.counters.modelTurns} model turns · ${state.counters.webSearches} web searches`;
    refreshRecent();
  }
}

function renderPipeline(state) {
  const idx = PHASES.indexOf(state.phase);
  document.querySelectorAll(".step").forEach((stepEl, i) => {
    stepEl.classList.toggle("active", i === idx);
    stepEl.classList.toggle("done", idx > i || (state.phase === "synthesis" && i === idx));
  });
}

function renderTab(state) {
  const content = $("#tab-content");
  if (!state) return;
  if (activeTab === "activity") content.innerHTML = renderActivity(state);
  else if (activeTab === "profile") content.innerHTML = renderProfile(state);
  else if (activeTab === "sources") content.innerHTML = renderSources(state);
}

function renderActivity(state) {
  if (!state.activity.length && !state.finalMessage) {
    return `<div class="empty-state"><p>No agent activity yet.</p></div>`;
  }
  const counters = `
    <div class="counters">
      <span class="counter">status: <b>${esc(state.status)}</b></span>
      <span class="counter">phase: <b>${esc(state.phase)}</b></span>
      <span class="counter">model turns: <b>${state.counters.modelTurns}</b></span>
      <span class="counter">web searches: <b>${state.counters.webSearches}</b></span>
      <span class="counter">tool calls: <b>${state.counters.toolCalls}</b></span>
    </div>`;
  const final = state.finalMessage
    ? `<div class="final-message"><h4>Final message</h4>${esc(state.finalMessage)}</div>`
    : "";
  const items = state.activity
    .map((entry) => {
      const detail =
        entry.input !== undefined || entry.outputSummary !== undefined
          ? `<details class="t-detail"><summary>details</summary><pre>${esc(
              JSON.stringify(
                { input: entry.input, output: entry.outputSummary },
                null,
                2,
              ),
            )}</pre></details>`
          : "";
      return `
      <li class="${esc(entry.type)}">
        <div class="t-meta">${esc(entry.createdAt)} · <span class="t-type">${esc(entry.type.toUpperCase())}</span>${entry.name ? ` · ${esc(entry.name)}` : ""}</div>
        <div class="t-summary">${esc(entry.summary)}</div>
        ${detail}
      </li>`;
    })
    .join("");
  return `${final}<ul class="timeline">${items}</ul>${counters}`;
}

function renderProfile(state) {
  const p = state.issueProfile;
  if (!p) {
    const reason =
      state.status === "error"
        ? `The run failed: ${state.errorMessage ?? "unknown error"}`
        : "The Issue Profile appears here once the agent commits it (phase: issue_committed).";
    return `<div class="empty-state"><p>No committed Issue Profile yet.</p><p class="muted">${esc(reason)}</p></div>`;
  }
  const section = (title, body) => `<div class="profile-section"><h4>${title}</h4>${body}</div>`;
  const labeled = (label, text) => `<p class="labeled"><span class="lbl">${label}:</span> ${esc(text)}</p>`;
  const chips = (values, cls) =>
    `<div class="chips">${(values || []).map((v) => `<span class="chip ${cls}">${esc(v)}</span>`).join("")}</div>`;
  const list = (values) => `<p>${(values || []).map((v) => `• ${esc(v)}`).join("<br>")}</p>`;

  const scopeBits = [];
  if (p.geographicScope && p.geographicScope.length) scopeBits.push(p.geographicScope.join(", "));
  if (p.temporalScope && (p.temporalScope.from || p.temporalScope.to)) {
    scopeBits.push(`${p.temporalScope.from ?? "…"} → ${p.temporalScope.to ?? "…"}`);
  }

  return `
    <div class="profile-head">
      <p class="title">${esc(p.title)}</p>
      <p class="ids">${esc(p.id)} · committed ${esc(p.createdAt)}</p>
    </div>
    ${section("Problem statement", `<p>${esc(p.problemStatement)}</p>`)}
    ${section("Issue description", `<p>${esc(p.issueDescription)}</p>`)}
    ${section("Causal structure",
      labeled("Mechanisms", "") + list(p.mechanisms) +
      labeled("Affected actors", "") + list(p.affectedActors) +
      labeled("Impacts", "") + list(p.impacts) +
      labeled("Potential responses", "") + list(p.potentialPolicyResponses))}
    ${section("Discovered vocabulary",
      chips(p.canonicalTerms, "term") + `<div style="height:6px"></div>` +
      chips(p.institutionalTerms, "term") + `<div style="height:6px"></div>` +
      chips(p.technicalTerms, "term"))}
    ${section("Exclusions (out of scope)", chips(p.exclusions, "excl"))}
    ${section("Search hypotheses",
      `<ol class="hypotheses">${p.searchHypotheses.map((h) => `<li>${esc(h)}</li>`).join("")}</ol>`)}
    ${scopeBits.length ? section("Scope", `<p>${esc(scopeBits.join(" · "))}</p>`) : ""}
  `;
}

function renderSources(state) {
  const sources = state.discoverySources || [];
  if (!sources.length) {
    return `<div class="empty-state"><p>No discovery sources recorded yet.</p><p class="muted">Cited web sources used during Issue Understanding will be listed here with provenance.</p></div>`;
  }
  const items = sources
    .map(
      (s) => `
      <li>
        <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">
          <span class="src-title">${esc(s.title || s.url)}</span>
          <span class="src-url">${esc(s.url)}</span>
        </a>
        <div class="src-date">retrieved ${esc(s.retrievedAt)} · used for: ${esc(s.usedFor)}</div>
      </li>`,
    )
    .join("");
  return `<ul class="source-list">${items}</ul>`;
}

async function refreshRecent() {
  try {
    const data = await fetchJson("/api/research");
    const runs = data.runs || [];
    if (!runs.length) return;
    $("#recent").hidden = false;
    $("#recent-list").innerHTML = runs
      .slice(0, 8)
      .map(
        (r) => `
        <li data-id="${esc(r.id)}">
          <span>${esc(r.question.slice(0, 90))}${r.question.length > 90 ? "…" : ""}</span>
          <span class="phase-chip">${esc(r.phase)}</span>
        </li>`,
      )
      .join("");
    for (const li of document.querySelectorAll("#recent-list li")) {
      li.addEventListener("click", () => {
        currentRunId = li.dataset.id;
        $("#run-status").textContent = `Viewing run ${currentRunId}`;
        startPolling();
      });
    }
  } catch {
    // recent runs are best-effort
  }
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON response
  }
  if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
  return body;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return ch;
    }
  });
}
