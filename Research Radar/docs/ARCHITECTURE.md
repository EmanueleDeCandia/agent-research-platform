# Research Radar — Runtime Architecture

## 1. Purpose

This document defines the minimum runtime architecture that Codex must preserve while implementing the PRD.

It is intentionally narrower than the PRD.

## 2. Core state machine

```text
USER PROBLEM
    |
    v
ISSUE_DISCOVERY
    |
    |  web search when semantic enrichment is needed
    v
ISSUE_PROFILE_READY
    |
    |  commit_issue_profile()
    v
ISSUE_COMMITTED
    |
    v
AUTHORITATIVE_RETRIEVAL
    |
    v
CANDIDATE_VALIDATION
    |
    v
EVIDENCE_READY
    |
    v
SYNTHESIS
```

For Milestone 1, implementation stops at `ISSUE_COMMITTED`.

## 3. Research phases

```ts
export type ResearchPhase =
  | "issue_discovery"
  | "issue_committed"
  | "authoritative_retrieval"
  | "candidate_validation"
  | "synthesis";
```

## 4. Tool gating

Tool availability must be phase-dependent.

Milestone 1:

```text
issue_discovery
  - web_search
  - commit_issue_profile

issue_committed
  - no authoritative tools yet
```

Future milestones may expose:

```text
authoritative_retrieval
  - search_policy_documents
  - search_innovation_projects
  - web_search when necessary
```

Do not rely only on prompt instructions to prevent premature authoritative retrieval.
The orchestrator must gate tool availability in code.

## 5. Responsibilities

### Agent orchestrator

Responsible for:
- loading runtime instructions;
- loading current ResearchState;
- selecting tools available for the current phase;
- executing model/tool cycles;
- updating ResearchState after successful tool calls;
- enforcing loop/tool budgets;
- exposing agent activity to the UI.

### Semantic tools

Responsible for expressing application-level actions such as:
- `commit_issue_profile`;
- later: `search_policy_documents`;
- later: `search_innovation_projects`.

They must not expose unnecessary source-specific syntax.

### Adapters

Responsible for:
- HTTP/SPARQL/SOAP calls;
- source authentication;
- request construction;
- source response parsing;
- retries/timeouts where appropriate;
- normalization into application objects.

### Semantic validation

Responsible for deciding whether a retrieved Candidate addresses the committed Issue rather than merely sharing vocabulary.

Not required in Milestone 1.

### UI

Milestone 1 UI must make the following visible:
- user problem description;
- agent activity;
- web searches performed;
- committed Issue Profile;
- discovered terminology;
- exclusions;
- search hypotheses;
- cited web sources used during discovery.

## 6. Runtime instructions

Load runtime instructions from:

`prompts/research-agent.md`

Do not inline a second divergent copy in application code.

A small code wrapper may add current phase/state-specific instructions, but the file remains the canonical runtime prompt.

## 7. Research loop

Conceptual shape:

```ts
while (!isTerminal(state) && iterations < MAX_ITERATIONS) {
  const tools = toolsForPhase(state.phase);

  const response = await runModel({
    instructions,
    input: buildModelInput(state),
    tools
  });

  const toolCalls = extractToolCalls(response);

  if (toolCalls.length === 0) {
    handleNoToolCall(response, state);
    break;
  }

  for (const call of toolCalls) {
    const result = await executeTool(call, state);
    state = applyToolResult(state, call, result);
  }
}
```

Implementation details may differ, but phase-dependent tool exposure is required.

## 8. Milestone sequencing

### Milestone 1
Issue Understanding:
user description -> web discovery -> committed Issue Profile.

### Milestone 2
Innovation retrieval:
committed Issue -> CORDIS candidates -> semantic validation -> Evidence.

### Milestone 3
EU policy retrieval:
committed Issue -> authoritative policy candidates -> full-content validation -> policy-stage Evidence.

Do not collapse these milestones into one initial implementation.
