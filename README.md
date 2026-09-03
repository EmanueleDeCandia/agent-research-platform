# Research Radar — Instruction System

This directory contains the **specification and instruction set** for building Research Radar, an agentic research platform for European policy and innovation intelligence.

## What is this?

Not source code. This is a **system of instructions** that tells an AI agent (and development teams) how to build and extend the application.

## Core documents

- **[PRD.md](./PRD.md)** — Product requirements, domain model, and research workflow specification
- **[AGENTS.md](./AGENTS.md)** — Guidance for AI agents: architecture rules, tooling constraints, and engineering practices

## Structure

```
.
├── docs/          → Architecture and data model documentation
├── prompt/        → Agent system instructions and search logic
└── agent/         → Runtime agent implementation (follows this specification)
```

## Key principle

**Research Radar investigates substantive Issues, not generic topics.**

The workflow is state-gated:
1. Issue discovery and semantic enrichment
2. Commit a structured Issue Profile
3. Retrieve authoritative candidates
4. Semantic validation
5. Evidence synthesis

Authoritative retrieval (policy, innovation) does not run until a valid Issue Profile has been committed.

## For AI agents

Read `PRD.md` and `AGENTS.md` first. They are the source of truth. The implementation must reflect these requirements exactly. If it doesn't, surface the inconsistency.

## For developers

Follow the architecture rules in `AGENTS.md`:
- Keep concerns separated (domain → tools → adapters → UI)
- Use code-enforced state transitions
- Preserve provenance for every evidence item