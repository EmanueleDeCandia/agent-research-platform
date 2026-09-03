# Research Radar — Runtime Agent

Runtime implementation of **Research Radar**, the agentic research platform for
European policy and innovation intelligence specified in this repository
(`PRD.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`).

## Milestone status

| Milestone | Scope | Status |
| --- | --- | --- |
| 1 — Issue Understanding | user problem → web discovery → committed Issue Profile | **implemented** |
| 2 — Innovation Intelligence (CORDIS) | planned |
| 3 — Policy Intelligence (EUR-Lex/CELLAR) | planned |
| 4 — Relationship & Knowledge Layer | to be evaluated after 1–3 |
| 5 — Monitoring & Media Intelligence | to be evaluated after 1–3 |

Milestone 1 stops at `ISSUE_COMMITTED` (ARCHITECTURE §2). No authoritative
source adapter is active; `search_innovation_projects` / `search_policy_documents`
do not exist yet, and the orchestrator rejects any hallucinated call to them.

## Layout (per AGENTS.md)

```
agent/
├── src/domain/        # domain models + code-enforced research state machine
├── src/agent/         # orchestrator, OpenAI Responses API client, prompt loader
├── src/tools/         # semantic tools (strict schemas, phase-gated)
├── src/validation/    # deterministic Issue Profile quality gate
├── src/adapters/      # source adapters (from Milestone 2)
├── src/server/        # HTTP API + static UI
├── src/web/public/    # minimal UI (PRD §14)
└── tests/             # unit + integration tests (node:test)
```

The canonical runtime prompt is loaded from `../prompt/research-agent.md`
(specification root) — the app keeps no divergent copy (PRD §18).

## How it works

1. The user submits a substantive problem description (`POST /api/research`).
2. The orchestrator runs the model/tool loop with the **OpenAI Responses API**:
   - built-in `web_search` for semantic discovery (terminology, framings, actors);
   - the custom function `commit_issue_profile` (strict schema) to commit the
     structured Issue Profile.
3. Tool availability depends on the research phase and is enforced in code:
   - `issue_discovery` → `web_search` + `commit_issue_profile`;
   - `issue_committed` → nothing authoritative in Milestone 1.
4. `commit_issue_profile` validates the proposal with a deterministic quality
   gate (generic/trivial profiles such as `title: "AI"` are rejected), generates
   IDs and timestamps server-side, and is the only path that transitions the
   state to `issue_committed`.
5. The UI shows the phase pipeline, agent activity (searches, tool calls, state
   transitions), the committed Issue Profile and the cited discovery sources.

## Setup

```bash
cd "Research Radar/agent"
npm install
cp .env.example .env   # set OPENAI_API_KEY (or DEMO_MODE=true to preview)
npm run build
npm start              # http://localhost:8787
```

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | required unless `DEMO_MODE=true` |
| `OPENAI_MODEL` | `gpt-4.1` | any Responses API model that supports `web_search` |
| `PORT` | `8787` | HTTP port |
| `RR_MAX_MODEL_TURNS` | `12` | research loop budget |
| `RR_MAX_TOOL_CALLS` | `24` | tool call budget |
| `RR_HTTP_TIMEOUT_MS` | `120000` | external call timeout |
| `DEMO_MODE` | `false` | scripted model client for UI preview (clearly labeled) |

### Scripts

```bash
npm run typecheck   # tsc --noEmit
npm test            # build + node --test (31 tests)
npm run build
npm start
```

## Design decisions

- **Zero runtime dependencies** (Node 20+, native `fetch`): the OpenAI
  Responses API client is a small typed module — full control over the
  `web_search` built-in tool, strict function schemas and `store:false`
  conversations. Dev dependencies: TypeScript only.
- **State machine in code** (`src/domain/state.ts`): illegal transitions throw;
  the model can never self-declare a phase change (PRD P-07).
- **Deterministic quality gate** (`src/validation/issue-profile.ts`): no opaque
  score; explicit, explainable validation errors (DATA_MODEL §2).
- **Budgets**: model turns and tool calls are capped; runs stop gracefully with
  a visible activity note.
- **Provenance**: web citations from discovery are captured with URL, title and
  retrieval timestamp (DATA_MODEL §9).
- **Secrets**: the browser never sees the API key; the public API never
  serializes the internal conversation.
