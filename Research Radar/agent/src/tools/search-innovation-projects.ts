import { RuntimeConfig } from "../config/env.js";
import { CandidateRecord } from "../domain/models.js";
import { recordActivity } from "../domain/state.js";
import { InnovationSourceAdapter } from "../adapters/types.js";
import { SemanticTool } from "./registry.js";

/**
 * search_innovation_projects (PRD RF-08, Milestone 2 core function).
 *
 * Receives a semantic intent built from the committed Issue Profile — never a
 * generic keyword. The adapter translates the intent into source-specific
 * queries; the output is normalized Candidate[] (P-04: Candidates, not
 * Evidence). Availability is phase-gated; the executor additionally refuses to
 * run without a committed Issue Profile (P-02, defense in depth).
 */

export const SEARCH_INNOVATION_PROJECTS_NAME = "search_innovation_projects";

const MAX_CONTENT_CHARS = 3_500;

export function createSearchInnovationProjectsTool(adapter: InnovationSourceAdapter): SemanticTool {
  return {
    name: SEARCH_INNOVATION_PROJECTS_NAME,
    spec: {
      type: "function",
      name: SEARCH_INNOVATION_PROJECTS_NAME,
      description:
        "Retrieve EU-funded innovation project candidates (CORDIS) for the committed Issue. " +
        "Call once per materially different search hypothesis. Results are Candidates: they " +
        "become Evidence only after validate_innovation_candidates accepts them.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: [
          "searchHypothesis",
          "problemStatement",
          "keywords",
          "mechanisms",
          "maxResults",
        ],
        properties: {
          searchHypothesis: {
            type: "string",
            description:
              "The search hypothesis this query expresses, taken or derived from the committed Issue Profile.",
          },
          problemStatement: {
            type: "string",
            description: "The problem framing carried from the committed Issue Profile (not a keyword).",
          },
          keywords: {
            type: "array",
            items: { type: "string" },
            description: "2-6 vocabulary terms of this hypothesis (canonical/institutional/technical).",
          },
          mechanisms: {
            type: "array",
            items: { type: "string" },
            description: "Causal mechanisms from the profile that retrieved projects should plausibly address.",
          },
          maxResults: {
            type: ["integer", "null"],
            description: "Optional maximum number of candidates to return (1-20); null uses the default of 10.",
          },
        },
      },
    },
    availableInPhases: ["authoritative_retrieval", "candidate_validation"],
    async execute(rawArgs, ctx) {
      const { state, config }: { state: import("../domain/models.js").ResearchState; config: RuntimeConfig } = ctx;

      if (!state.issueProfile) {
        return {
          error:
            "No Issue Profile has been committed for this research run: authoritative retrieval is " +
            "not allowed before the commit (P-02).",
        };
      }

      const parsed = parseIntent(rawArgs);
      if ("error" in parsed) return { error: parsed.error };

      let retrieved: import("../domain/models.js").Candidate[];
      try {
        retrieved = await adapter.searchInnovationProjects(parsed.intent);
      } catch (error) {
        return {
          error: `Innovation retrieval failed: ${error instanceof Error ? error.message : String(error)}`,
          sourceProvider: adapter.sourceProvider,
        };
      }

      // RF-14: deduplicate by canonical source identifier, fallback to URL.
      const duplicates: number[] = [];
      const added: CandidateRecord[] = [];
      for (const candidate of retrieved) {
        const key = candidateKey(candidate);
        const existing = state.candidates.find((candidateRecord) => candidateKey(candidateRecord) === key);
        if (existing) {
          duplicates.push(1);
          continue;
        }
        const record: CandidateRecord = { ...candidate, status: "pending", domain: "innovation" };
        state.candidates.push(record);
        added.push(record);
      }
      recordActivity(state, {
        type: "note",
        summary:
          `CORDIS retrieval "${parsed.intent.searchHypothesis.slice(0, 80)}": ` +
          `${retrieved.length} record(s), ${added.length} new, ${duplicates.length} duplicate(s)`,
        outputSummary: {
          sourceProvider: adapter.sourceProvider,
          retrieved: retrieved.length,
          new: added.length,
          duplicates: duplicates.length,
        },
      });

      return {
        sourceProvider: adapter.sourceProvider,
        query: { searchHypothesis: parsed.intent.searchHypothesis, keywords: parsed.intent.keywords },
        retrieved: retrieved.length,
        newCandidates: added.length,
        duplicates: duplicates.length,
        totalCandidatesInRun: state.candidates.length,
        candidates: added.map((record) => toViewModel(record)),
        guidance:
          "These are Candidates, not Evidence. Validate each with validate_innovation_candidates " +
          "against the committed Issue (problem, mechanisms, actors, impacts, interventions, exclusions).",
      };
    },
  };
}

function candidateKey(candidate: { sourceProvider: string; sourceId?: string; sourceUrl?: string; title: string }): string {
  if (candidate.sourceId) return `${candidate.sourceProvider}::${candidate.sourceId}`;
  return `${candidate.sourceProvider}::url::${candidate.sourceUrl ?? candidate.title}`;
}

function toViewModel(record: CandidateRecord): Record<string, unknown> {
  const content = record.content ?? "";
  return {
    candidateId: record.id,
    sourceProvider: record.sourceProvider,
    sourceId: record.sourceId ?? null,
    sourceUrl: record.sourceUrl ?? null,
    title: record.title,
    summary: record.summary ?? null,
    content: content.slice(0, MAX_CONTENT_CHARS),
    contentTruncated: content.length > MAX_CONTENT_CHARS,
    metadata: record.metadata,
  };
}

function parseIntent(
  raw: unknown,
):
  | { error: string }
  | { intent: import("../adapters/types.js").InnovationSearchIntent } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "Arguments must be a JSON object." };
  }
  const args = raw as Record<string, unknown>;
  const searchHypothesis = typeof args["searchHypothesis"] === "string" ? args["searchHypothesis"].trim() : "";
  if (searchHypothesis.length < 8) {
    return { error: '"searchHypothesis" is required (min. 8 characters).' };
  }
  const problemStatement = typeof args["problemStatement"] === "string" ? args["problemStatement"].trim() : "";
  if (problemStatement.length < 20) {
    return { error: '"problemStatement" must carry the committed problem framing (min. 20 characters).' };
  }
  const stringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  const keywords = stringArray(args["keywords"]);
  if (keywords.length < 1) {
    return { error: '"keywords" must contain at least 1 vocabulary term.' };
  }
  const mechanisms = stringArray(args["mechanisms"]);
  let maxResults = 10;
  if (typeof args["maxResults"] === "number" && Number.isInteger(args["maxResults"])) {
    maxResults = Math.min(Math.max(args["maxResults"], 1), 20);
  }
  return { intent: { searchHypothesis, problemStatement, keywords, mechanisms, maxResults } };
}
