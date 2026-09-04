# Research Radar — Runtime Agent

Runtime implementation of **Research Radar**, the agentic research platform for
European policy and innovation intelligence specified in this repository
(`PRD.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`).

## Milestone status

| Milestone | Scope | Status |
| --- | --- | --- |
| 1 — Issue Understanding | user problem → web discovery → committed Issue Profile | **implemented** |
| 2 — Innovation Intelligence (CORDIS) | committed Issue → CORDIS candidates → semantic validation → Innovation Evidence | **implemented** |
| 3 — Policy Intelligence (EUR-Lex/CELLAR) | committed Issue → policy candidates → validation + Policy Stage → Policy Evidence | **implemented** |
| 4 — Relationship & Knowledge Layer | to be evaluated after 1–3 |
| 5 — Monitoring & Media Intelligence | to be evaluated after 1–3 |

Milestone 3 completes the core state machine: `issue_discovery →
issue_committed → authoritative_retrieval → candidate_validation → synthesis`.
Innovation retrieval activates with a CORDIS key (or demo mode); policy
retrieval uses the public CELLAR SPARQL endpoint (no key) and can be disabled
with `POLICY_ENABLED=false`. Tools are phase-gated in code and every
retrieval/validation is refused before an Issue Profile is committed (P-02).

## Layout (per AGENTS.md)

```
agent/
├── src/domain/        # domain models + code-enforced research state machine
├── src/agent/         # orchestrator, OpenAI Responses API client, prompt loader
├── src/tools/         # semantic tools (strict schemas, phase-gated)
├── src/validation/    # deterministic Issue Profile quality gate
├── src/adapters/      # source adapters: CORDIS (M2), CELLAR (M3), demo fixtures
├── src/server/        # HTTP API + static UI
├── src/web/public/    # UI (PRD §14): activity, profile, evidence, synthesis
└── tests/             # unit + integration tests (node:test)
```

The canonical runtime prompt is loaded from `../prompt/research-agent.md`
(specification root) — the app keeps no divergent copy (PRD §18).

## How it works

1. The user submits a substantive problem description (`POST /api/research`).
2. **Issue Understanding (M1)**: the orchestrator runs the model/tool loop with
   the **OpenAI Responses API** — built-in `web_search` for semantic discovery
   and `commit_issue_profile` (strict schema, deterministic quality gate:
   generic profiles such as `title: "AI"` are rejected; IDs/timestamps are
   generated server-side). This is the only path to `issue_committed`.
3. **Innovation Intelligence (M2)**: after the commit the orchestrator opens
   `authoritative_retrieval`. `search_innovation_projects` carries a semantic
   intent (search hypothesis + problem framing + vocabulary from the committed
   profile — never a keyword) to the CORDIS adapter; results are normalized
   `Candidate`s. `validate_innovation_candidates` semantically validates each
   candidate (6 match levels, exclusion guard, same-technology-different-problem
   rejection) and only accepted candidates become Innovation `Evidence` with
   full provenance (project URL, funding, organisations preserved as metadata).
4. **Policy Intelligence (M3)**: `search_policy_documents` expresses the same
   application intent to the CELLAR adapter (public SPARQL over EUR-Lex
   content; CELEX is the canonical id used for dedup). SPARQL and endpoints
   never leave the adapter. `validate_policy_documents` validates each document
   and classifies the **Policy Stage** (signal → consultation →
   planned_initiative → proposal → legislative_process → adopted → evaluation,
   RF-12) — an application classification kept distinct from source metadata —
   producing Policy Evidence typed as institutional/legislative/consultation.
5. Phase transitions are applied by the orchestrator after each tool batch
   (the model never self-declares them); when every candidate is decided the
   run enters `synthesis` and produces the final message (executive synthesis,
   policy signals & maturity, innovation signals, actors, information gaps,
   sources) based only on validated Evidence.
6. The UI shows the phase pipeline, agent activity, the committed Issue
   Profile, discovery sources, the Candidate/Evidence workspace and the
   synthesis with policy maturity.

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
| `CORDIS_API_KEY` | — | enables innovation retrieval (M2) |
| `CORDIS_ENABLED` | `true` | set `false` to disable innovation retrieval |
| `POLICY_ENABLED` | `true` | set `false` to disable policy retrieval (M3) |
| `CELLAR_BASE_URL` | `https://publications.europa.eu/sparql` | policy SPARQL endpoint |
| `DEMO_MODE` | `false` | scripted model + fixture adapters for UI preview (clearly labeled) |

### Scripts

```bash
npm run typecheck   # tsc --noEmit
npm test            # build + node --test (unit + integration)
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

## Notes on the authoritative sources

- **CORDIS (M2)**: the adapter implements the official asynchronous Data
  Extractions API (submit → poll → download JSON). The exported JSON shape is
  not formally documented by the source, so parsing is tolerant and tested
  against fixtures; run a real extraction once in your environment to confirm.
- **CELLAR (M3)**: the adapter queries the public SPARQL endpoint with a
  recall-oriented query over English titles of works carrying a CELEX id, and
  links each candidate to its EUR-Lex page. The CDM predicate set can drift:
  mismatches surface as clear `AdapterError`s instead of corrupt data, and
  `CELLAR_BASE_URL` allows pointing at a compatible endpoint.
- The EUR-Lex SOAP web service and the Commission Work Programme can be added
  later as separate adapters behind the same `search_policy_documents` tool.
