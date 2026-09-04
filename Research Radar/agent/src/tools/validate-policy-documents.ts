import { newId, nowIso } from "../domain/ids.js";
import {
  CandidateRecord,
  CandidateValidationRecord,
  Evidence,
  MatchLevel,
  PolicyStage,
} from "../domain/models.js";
import { recordActivity } from "../domain/state.js";
import { SemanticTool } from "./registry.js";

/**
 * validate_policy_documents (PRD RF-11 + RF-12, Milestone 3).
 *
 * Semantic validation of policy Candidates with two distinct classifications:
 *  - matchLevel: how substantively the document addresses the committed Issue
 *    (same 6-level scale, RF-11);
 *  - policyStage: the normalized institutional stage of the policy response
 *    (RF-12) — an application classification, deliberately distinct from the
 *    source metadata (documentType/date) preserved in Evidence.metadata.
 *
 * Guards enforced here in code:
 *  - only policy-domain candidates of this run, decided once;
 *  - relevant requires a substantive match level (same keyword/technology is
 *    never enough — §10);
 *  - a triggered exclusion can never be relevant;
 *  - policyStage is optional only when the evidence does not support one
 *    ("quando le evidenze lo consentono", RF-12).
 */

export const VALIDATE_POLICY_DOCUMENTS_NAME = "validate_policy_documents";

const MATCH_LEVELS: readonly MatchLevel[] = [
  "incidental_mention",
  "thematic_association",
  "substantive_discussion",
  "explicit_problem_recognition",
  "proposed_intervention",
  "formal_funded_response",
];
const EVIDENCE_MIN_LEVEL = 2; // substantive_discussion

export const POLICY_STAGES: readonly PolicyStage[] = [
  "signal",
  "consultation",
  "planned_initiative",
  "proposal",
  "legislative_process",
  "adopted",
  "evaluation",
];

/** Deterministic application classification (RF-12) — independent of source metadata. */
export function stageToEvidenceType(stage: PolicyStage): Evidence["evidenceType"] {
  switch (stage) {
    case "consultation":
      return "consultation";
    case "proposal":
    case "legislative_process":
    case "adopted":
      return "legislative";
    case "signal":
    case "planned_initiative":
    case "evaluation":
      return "institutional";
  }
}

export function createValidatePolicyDocumentsTool(): SemanticTool {
  return {
    name: VALIDATE_POLICY_DOCUMENTS_NAME,
    spec: {
      type: "function",
      name: VALIDATE_POLICY_DOCUMENTS_NAME,
      description:
        "Semantically validate policy document Candidates against the committed Issue Profile and " +
        "classify the policy stage of the response. A document that merely mentions the topic or shares " +
        "vocabulary must be not_relevant. Accepted documents become Policy Evidence with provenance.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["validations"],
        properties: {
          validations: {
            type: "array",
            description: "One decision per pending policy candidate.",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "candidateId",
                "verdict",
                "matchLevel",
                "policyStage",
                "relevanceExplanation",
                "matchedProblemElements",
                "matchedMechanisms",
                "matchedImpacts",
                "matchedInterventions",
                "exclusionTriggered",
              ],
              properties: {
                candidateId: { type: "string", description: "The candidateId returned by search_policy_documents." },
                verdict: {
                  type: "string",
                  enum: ["relevant", "not_relevant", "insufficient_content"],
                  description:
                    "relevant = genuinely addresses the committed problem; not_relevant = incidental mention, thematic " +
                    "association or triggered exclusion; insufficient_content = record too thin to decide.",
                },
                matchLevel: {
                  type: "string",
                  enum: [...MATCH_LEVELS],
                  description: "How substantively the document addresses the committed Issue (RF-11).",
                },
                policyStage: {
                  anyOf: [{ type: "string", enum: [...POLICY_STAGES] }, { type: "null" }],
                  description:
                    "Normalized stage of the policy response (RF-12): signal, consultation, planned_initiative, " +
                    "proposal, legislative_process, adopted, evaluation. Null only when relevant but the evidence " +
                    "does not support a stage, or when not relevant.",
                },
                relevanceExplanation: {
                  type: "string",
                  description:
                    "Explain the fit/mismatch with the Issue's problem, mechanisms, actors, impacts, interventions, and the ground for the policy stage (min. 40 characters).",
                },
                matchedProblemElements: { type: "array", items: { type: "string" } },
                matchedMechanisms: { type: "array", items: { type: "string" } },
                matchedImpacts: { type: "array", items: { type: "string" } },
                matchedInterventions: { type: "array", items: { type: "string" } },
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

      const rawValidations = (rawArgs as { validations?: unknown })?.["validations"];
      if (!Array.isArray(rawValidations)) {
        return { error: '"validations" must be an array.' };
      }
      if (rawValidations.length === 0) {
        return { error: '"validations" must contain at least one decision.' };
      }

      const errors: Array<{ candidateId: string; error: string }> = [];
      let accepted = 0;
      let rejected = 0;
      let insufficient = 0;
      let withoutStage = 0;

      for (const entry of rawValidations) {
        const outcome = applyDecision(state, entry);
        if (typeof outcome === "string") {
          errors.push({ candidateId: idOf(entry), error: outcome });
        } else if (outcome.kind === "accepted") {
          accepted++;
          if (outcome.policyStage === null) withoutStage++;
        } else if (outcome.kind === "rejected") {
          rejected++;
        } else {
          insufficient++;
        }
      }

      recordActivity(state, {
        type: "tool_result",
        name: VALIDATE_POLICY_DOCUMENTS_NAME,
        summary:
          `Policy validation: ${accepted} accepted, ${rejected} rejected, ${insufficient} insufficient content` +
          `${withoutStage > 0 ? `, ${withoutStage} without a defensible policy stage` : ""}` +
          `${errors.length > 0 ? `, ${errors.length} invalid entr${errors.length === 1 ? "y" : "ies"}` : ""}`,
        outputSummary: { accepted, rejected, insufficient, withoutStage, invalid: errors.length },
      });

      return {
        decided: accepted + rejected + insufficient,
        accepted,
        rejected,
        insufficientContent: insufficient,
        acceptedWithoutStage: withoutStage,
        evidenceCount: state.evidence.length,
        pendingCandidates: state.candidates.filter((candidate) => candidate.status === "pending").length,
        errors: errors.length > 0 ? errors : undefined,
      };
    },
  };
}

type DecisionOutcome =
  | { kind: "accepted"; policyStage: PolicyStage | null }
  | { kind: "rejected" }
  | { kind: "insufficient" }
  | string;

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
): DecisionOutcome {
  if (typeof entry !== "object" || entry === null) return "each validation entry must be an object";
  const raw = entry as Record<string, unknown>;

  const candidateId = raw["candidateId"];
  if (typeof candidateId !== "string") return "candidateId is required";
  const candidate = state.candidates.find((record) => record.id === candidateId);
  if (!candidate) return `unknown candidateId "${candidateId}"`;
  if (candidate.status !== "pending") return `candidate "${candidate.title}" is already decided (${candidate.status})`;
  if (candidate.domain !== "policy") {
    return `candidate "${candidate.title}" does not belong to the policy retrieval domain`;
  }

  const verdict = raw["verdict"];
  if (verdict !== "relevant" && verdict !== "not_relevant" && verdict !== "insufficient_content") {
    return `invalid verdict for "${candidate.title}"`;
  }
  const matchLevel = raw["matchLevel"];
  if (typeof matchLevel !== "string" || !MATCH_LEVELS.includes(matchLevel as MatchLevel)) {
    return `invalid matchLevel for "${candidate.title}"`;
  }
  const policyStageRaw = raw["policyStage"];
  const policyStage: PolicyStage | null =
    typeof policyStageRaw === "string" && POLICY_STAGES.includes(policyStageRaw as PolicyStage)
      ? (policyStageRaw as PolicyStage)
      : null;

  const relevanceExplanation =
    typeof raw["relevanceExplanation"] === "string" ? raw["relevanceExplanation"].trim() : "";
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
    return { kind: "insufficient" };
  }

  if (verdict === "relevant") {
    if (exclusionTriggered) {
      return `"${candidate.title}" cannot be relevant: it triggers the committed exclusion "${exclusionTriggered}"`;
    }
    if (MATCH_LEVELS.indexOf(matchLevel as MatchLevel) < EVIDENCE_MIN_LEVEL) {
      return (
        `"${candidate.title}" cannot be Evidence at matchLevel "${matchLevel}": an incidental mention or a ` +
        `thematic association is not Issue relevance (RF-11, PRD §10).`
      );
    }
    candidate.status = "accepted";
    candidate.validation = validation;
    state.evidence.push(
      buildPolicyEvidence(candidate, validation, policyStage, state.issueProfile?.id ?? "unknown-issue"),
    );
    return { kind: "accepted", policyStage };
  }

  candidate.status = "rejected";
  candidate.validation = validation;
  return { kind: "rejected" };
}

function buildPolicyEvidence(
  candidate: CandidateRecord,
  validation: CandidateValidationRecord,
  policyStage: PolicyStage | null,
  issueId: string,
): Evidence {
  return {
    id: newId("evid"),
    issueId,
    candidateId: candidate.id,
    evidenceType: policyStage ? stageToEvidenceType(policyStage) : "institutional",
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
    ...(policyStage ? { policyStage } : {}),
    ...(candidate.metadata && Object.keys(candidate.metadata).length > 0
      ? { metadata: candidate.metadata }
      : {}),
    createdAt: nowIso(),
  };
}
