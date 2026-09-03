# Research Radar — Codex Project Guidance

## Source of truth

The product requirements are defined in `PRD.md`.

Before changing product behaviour, agent behaviour, data models, retrieval logic, or UI flows:
1. read the relevant sections of `PRD.md`;
2. read `docs/ARCHITECTURE.md`;
3. read `docs/DATA_MODEL.md`;
4. inspect the existing implementation before proposing structural changes.

Do not duplicate the PRD in code comments, prompts, or this file.

If implementation and requirements disagree, surface the inconsistency rather than silently choosing one.

## Product invariant

Research Radar investigates a substantive Issue, not a generic topic.

A broad domain label such as `AI`, `energy`, `mobility`, or `healthcare` is not sufficient to trigger authoritative policy or innovation retrieval.

The runtime workflow is state-gated:

1. understand the Issue;
2. enrich its language when needed;
3. commit a structured Issue Profile;
4. retrieve authoritative candidate records;
5. semantically validate candidates against the committed Issue;
6. persist validated Evidence with provenance;
7. synthesize findings and information gaps.

Authoritative retrieval must not run before a valid Issue Profile has been committed.

## Runtime architecture

Keep these concerns separate:

- runtime agent instructions under `prompts/`;
- domain models under `src/domain/`;
- agent orchestration under `src/agent/`;
- semantic tools under `src/tools/`;
- source-specific HTTP/SPARQL/SOAP logic under `src/adapters/`;
- semantic validation under `src/validation/`;
- UI under `src/web/` or the framework-equivalent location.

Do not expose raw third-party API schemas directly to the model unless the PRD explicitly requires it.

A semantic tool expresses the information need.
An adapter translates that need into the source-specific query.

## Tooling rules

Use the OpenAI Responses API for the runtime research workflow.

Custom functions must:
- use strict schemas;
- have narrow semantic responsibilities;
- return normalized application objects rather than raw source payloads where practical;
- preserve source IDs, URLs, retrieval timestamps, and provenance.

Prefer code-enforced state transitions over prompt-only behavioural rules.

The set of tools exposed to the model should depend on the current research phase.

## Retrieval rules

Candidate retrieval and semantic validation are different stages.

Candidate retrieval should favour recall.
Semantic validation should favour precision.

Never equate:
- same keyword,
- same technology,
- same taxonomy,
- same sector

with relevance to the committed Issue.

A retrieved result remains a Candidate until semantic validation accepts it.

## Engineering rules

- Use TypeScript.
- Keep external calls server-side.
- Never expose secrets in browser code.
- Use environment variables for credentials.
- Add timeouts and error handling around external calls.
- Preserve provenance for every Evidence item.
- Keep source-specific assumptions out of UI components.
- Prefer small vertical slices over broad unfinished integrations.
- Do not add a new external source until the preceding vertical slice has tests.

## First milestone

The first milestone is defined in `tasks/01-issue-understanding.md`.

Do not implement CORDIS, EUR-Lex, CELLAR, GDELT, or other authoritative source adapters in Milestone 1 unless required only as inert interfaces or placeholders.

## Verification

For every material change:
1. run type checking;
2. run unit tests;
3. run relevant integration tests;
4. verify the affected research-state transition;
5. inspect the diff for accidental scope expansion.

A feature requiring a real model/tool cycle is not complete if it works only with mocks.
