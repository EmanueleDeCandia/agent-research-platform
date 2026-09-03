---
name: research-radar-development
description: Implement or modify Research Radar runtime agent workflows, Issue Profile semantics, research state transitions, retrieval tools, semantic validation, evidence persistence, source adapters, or related tests.
---

# Research Radar Development Workflow

Use this skill for work affecting the Research Radar runtime research architecture.

## Before implementation

1. Read the relevant requirements in `PRD.md`.
2. Read `docs/ARCHITECTURE.md`.
3. Read `docs/DATA_MODEL.md`.
4. Inspect the current implementation.
5. Identify the research phase affected by the change:
   - issue discovery;
   - issue commitment;
   - authoritative retrieval;
   - semantic validation;
   - evidence persistence;
   - synthesis.
6. State the expected state transition before implementing it.

## Preserve the central invariant

Authoritative policy and innovation retrieval must never execute before a valid Issue Profile has been committed.

Do not weaken this rule for implementation convenience.

## When adding or changing a tool

1. Define the semantic information need first.
2. Define a strict application-level input schema.
3. Keep source-specific query syntax inside an adapter.
4. Normalize external output before downstream use.
5. Preserve source identifiers and provenance.
6. Add validation tests.
7. Add at least one failure or irrelevant-result test.

Do not expose raw third-party API schemas directly to the model without an explicit architectural reason.

## When changing runtime prompts

Runtime prompts live under `prompts/`.

For every prompt change:
1. identify the behaviour being corrected;
2. avoid duplicating constraints already enforced in code;
3. prefer a deterministic code invariant over a prompt-only instruction when practical;
4. add or update an eval/test demonstrating the intended behaviour.

## Semantic relevance rule

Never equate:
- same keyword;
- same technology;
- same taxonomy;
- same sector

with Issue relevance.

Candidate retrieval favours recall.
Semantic validation favours precision.

## Scope discipline

Implement one vertical slice at a time.

Do not start a new external integration because it is easy to add if the active milestone does not require it.

## Completion

Before completing a task:
1. run type checking;
2. run tests;
3. verify the relevant state transition;
4. run the required real integration path when the milestone requires one;
5. report unimplemented requirements explicitly;
6. do not silently expand scope.
