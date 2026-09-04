import { newId, nowIso } from "../domain/ids.js";
import {
  CandidateRecord,
  CandidateValidationRecord,
  Evidence,
  MatchLevel,
} from "../domain/models.js";
import { recordActivity } from "../domain/state.js";
import { SemanticTool } from "./registry.js";

/**
 * validate_innovation_candidates (PRD RF-09, §10 — Semantic Validation).
 *
 * The model proposes a structured decision per Candidate; this executor
 * verifies the contract and persists Evidence server-side:
 *  - the candidate must exist in this run and still be pending;
 *  - "relevant" requires a substantive match level (same keyword / same
 *    technology / same sector is never enough — PRD §10);
 *  - IDs and timestamps are application-generated.
 * Deterministic guards turn model verbosity into explainable decisions.
 */

export const VALIDATE_INNOVATION_CANDIDATES_NAME = "validate_innovation_candidates";

const MATCH_LEVELS: readonly MatchLevel[] = [
  "incidental_mention",
  "thematic_association",
  "substantive_discussion",
  "explicit_problem_recognition",
  "proposed_intervention",
  "formal_funded_response",
];

/** A Candidate may become Evidence only from these levels onwards (§10). */
const EVIDENCE_MIN_LEVEL = 2; // substantive_discussion

export function createValidateInnovationCandidatesTool(): SemanticTool {
  return {
    name: VALIDATE_INNOVATION_CANDIDATES_NAME,
    spec: {
      type: "function",
      name: VALIDATE_INNOVATION_CANDIDATES_NAME,
      description:
        "Semantically validate retrieved innovation Candidates against the committed Issue Profile. " +
        "A project that shares only the same technology, sector or vocabulary must be not_relevant. " +
        "Accepted candidates become Innovation Evidence with provenance.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["validations"],
        properties: {
          validations: {
            type: "array",
            description: "One decision per pending candidate.",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "candidateId",
                "verdict",
                "matchLevel",
                "relevanceExplanation",
                "matchedProblemElements",
                "matchedMechanisms",
                "matchedImpacts",
                "matchedInterventions",
                "exclusionTriggered",
              ],
              properties: {
                candidateId: { type: "string", description: "The candidateId returned by search_innovation_projects." },
                verdict: {
                  type: "string",
                  enum: ["relevant", "not_relevant", "insufficient_content"],
                  description:
                    "relevant = genuinely addresses the committed problem; not_relevant = shares only technology/sector/vocabulary " +
                    "or triggers an exclusion; insufficient_content = not enough content to decide (reported as an information gap).",
                },
                matchLevel: {
                  type: "string",
                  enum: [...MATCH_LEVELS],
                  description: "How substantively the candidate addresses the committed Issue.",
                },
                relevanceExplanation: {
                  type: "string",
                  description: "Explain the fit or the mismatch with the Issue's problem, mechanisms, actors, impacts, interventions (min. 40 characters).",
                },
                matchedProblemElements: { type: "array", items: { type: "string" }, description: "Parts of the candidate that match the problem statement (empty when not relevant)." },
                matchedMechanisms: { type: "array", items: { type: "string" }, description: "Matching causal mechanisms (empty when not relevant)." },
                matchedImpacts: { type: "array", items: { type: "string" }, description: "Matching material impacts (empty when not relevant)." },
                matchedInterventions: { type: "array", items: { type: "string" }, description: "Matching response/intervention elements (empty when not relevant)." },
                exclusionTriggered: {
                  type: ["string", "null"],
                  description: "The committed exclusion this candidate triggers, or null when none.",
                },
              },
            },
          },
        },
      },
    },
    availableInPhases: ["candidate_validation"],
    async execute(rawArgs, ctx) {
      const state = ctx.state;

      if (!Array.isArray((rawArgs as { validations?: unknown })?.["validations"])) {
        return { error: '"validations" must be an array.' };
      }
      const entries = (rawArgs as { validations: unknown[] })["validations"];
      if (entries.length === 0) return { error: '"validations" must contain at least one decision.' };

      const errors: Array<{ candidateId: string; error: string }> = [];
      let accepted = 0;
      let rejected = 0;
      let insufficient = 0;

      for (const entry of entries) {
        const outcome = applyDecision(state, entry);
        if (outcome === "accepted") {
          accepted++;
        } else if (outcome === "rejected") {
          rejected++;
        } else if (outcome === "insufficient") {
          insufficient++;
        } else {
          errors.push({ candidateId: idOf(entry), error: outcome });
        }
      }

      recordActivity(state, {
        type: "tool_result",
        name: VALIDATE_INNOVATION_CANDIDATES_NAME,
        summary:
          `Semantic validation: ${accepted} accepted, ${rejected} rejected, ${insufficient} insufficient content` +
          `${errors.length > 0 ? `, ${errors.length} invalid entr${errors.length === 1 ? "y" : "ies"}` : ""}`,
        outputSummary: { accepted, rejected, insufficient, invalid: errors.length },
      });

      return {
        decided: accepted + rejected + insufficient,
        accepted,
        rejected,
        insufficientContent: insufficient,
        evidenceCount: state.evidence.length,
        pendingCandidates: state.candidates.filter((candidate) => candidate.status === "pending").length,
        errors: errors.length > 0 ? errors : undefined,
      };
    },
  };
}

function idOf(entry: unknown): string {
  if (typeof entry === "object" && entry !== null) {
    const candidateId = (entry as Record<string, unknown>)["candidateId"];
    if (typeof candidateId === "string") return candidateId;
  }
  return "(missing candidateId)";
}

function applyDecision(
  state: import("../domain/models.js").ResearchState,
  entry: unknown,
): "accepted" | "rejected" | "insufficient" | string {
  if (typeof entry !== "object" || entry === null) return "each validation entry must be an object";
  const raw = entry as Record<string, unknown>;

  const candidateId = raw["candidateId"];
  if (typeof candidateId !== "string") return "candidateId is required";
  const candidate = state.candidates.find((record) => record.id === candidateId);
  if (!candidate) return `unknown candidateId "${candidateId}"`;
  if (candidate.status !== "pending") return `candidate "${candidate.title}" is already decided (${candidate.status})`;

  const verdict = raw["verdict"];
  if (verdict !== "relevant" && verdict !== "not_relevant" && verdict !== "insufficient_content") {
    return `invalid verdict for "${candidate.title}"`;
  }
  const matchLevel = raw["matchLevel"];
  if (typeof matchLevel !== "string" || !MATCH_LEVELS.includes(matchLevel as MatchLevel)) {
    return `invalid matchLevel for "${candidate.title}"`;
  }
  const relevanceExplanation = typeof raw["relevanceExplanation"] === "string" ? raw["relevanceExplanation"].trim() : "";
  if (relevanceExplanation.length < 40) {
    return `relevanceExplanation for "${candidate.title}" must be a substantive explanation (min. 40 characters)`;
  }
  const exclusionTriggered =
    typeof raw["exclusionTriggered"] === "string" && raw["exclusionTriggered"].trim().length > 0
      ? raw["exclusionTriggered"].trim()
      : undefined;

  const stringArray = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
      : [];

  const validation: CandidateValidationRecord = {
    verdict,
    matchLevel: matchLevel as MatchLevel,
    relevanceExplanation,
    matchedProblemElements: stringArray(raw["matchedProblemElements"]),
    matchedMechanisms: stringArray(raw["matchedMechanisms"]),
    matchedImpacts: stringArray(raw["matchedImpacts"]),
    matchedInterventions: stringArray(raw["matchedInterventions"]),
    ...(exclusionTriggered ? { exclusionTriggered } : {}),
    decidedAt: nowIso(),
  };

  if (verdict === "insufficient_content") {
    candidate.status = "insufficient_content";
    candidate.validation = validation;
    return "insufficient";
  }

  if (verdict === "relevant") {
    if (exclusionTriggered) {
      return `"${candidate.title}" cannot be relevant: it triggers the committed exclusion "${exclusionTriggered}"`;
    }
    if (MATCH_LEVELS.indexOf(matchLevel as MatchLevel) < EVIDENCE_MIN_LEVEL) {
      return (
        `"${candidate.title}" cannot be Evidence at matchLevel "${matchLevel}": same keyword/technology/sector ` +
        `is not Issue relevance. Use not_relevant or a substantive match level (PRD §10).`
      );
    }
    const evidence = buildEvidence(candidate, validation, state.issueProfile?.id ?? "unknown-issue");
    candidate.status = "accepted";
    candidate.validation = validation;
    state.evidence.push(evidence);
    return "accepted";
  }

  candidate.status = "rejected";
  candidate.validation = validation;
  return "rejected";
}

function buildEvidence(candidate: CandidateRecord, validation: CandidateValidationRecord, issueId: string): Evidence {
  return {
    id: newId("evid"),
    issueId,
    candidateId: candidate.id,
    evidenceType: "innovation",
    title: candidate.title,
    ...(candidate.summary ? { summary: candidate.summary } : {}),
    sourceProvider: candidate.sourceProvider,
    ...(candidate.sourceId ? { sourceId: candidate.sourceId } : {}),
    ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
    relevanceExplanation: validation.relevanceExplanation,
    matchedProblemElements: validation.matchedProblemElements,
    matchedMechanisms: validation.matchedMechanisms,
    matchedImpacts: validation.matchedImpacts,
    matchedInterventions: validation.matchedInterventions,
    ...(candidate.metadata && Object.keys(candidate.metadata).length > 0
      ? { metadata: candidate.metadata }
      : {}),
    createdAt: nowIso(),
  };
}
