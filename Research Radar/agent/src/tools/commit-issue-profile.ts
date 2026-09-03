import { ResearchPhase, ResearchState } from "../domain/models.js";
import { applyTransition, recordActivity } from "../domain/state.js";
import { SemanticTool } from "./registry.js";
import { buildIssueProfile, validateIssueProfileInput } from "../validation/issue-profile.js";

/**
 * commit_issue_profile (PRD RF-05, DATA_MODEL §5/§8).
 *
 * The model proposes the profile; the backend:
 *  1. validates the schema and the deterministic quality gate;
 *  2. generates IDs and timestamps (never model-generated);
 *  3. accepts or rejects the commit;
 *  4. controls the state transition to issue_committed.
 */

const stringArray = (description: string): Record<string, unknown> => ({
  type: "array",
  items: { type: "string" },
  description,
});

export const COMMIT_ISSUE_PROFILE_NAME = "commit_issue_profile";

export const COMMIT_ISSUE_PROFILE_PARAMETERS: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  description:
    "Commits the structured Issue Profile for this research. Call only when the substantive " +
    "Issue is sufficiently understood (problem, mechanisms, actors, impacts, responses, " +
    "terminology, exclusions, search hypotheses). A label-only profile will be rejected.",
  required: [
    "title",
    "problemStatement",
    "issueDescription",
    "mechanisms",
    "affectedActors",
    "impacts",
    "potentialPolicyResponses",
    "canonicalTerms",
    "institutionalTerms",
    "technicalTerms",
    "exclusions",
    "searchHypotheses",
    "geographicScope",
    "temporalScope",
  ],
  properties: {
    title: { type: "string", description: "Concise substantive title of the Issue (not a domain label)." },
    problemStatement: {
      type: "string",
      description: "The problem being investigated: what is going wrong, for whom, why it matters (min. 60 characters).",
    },
    issueDescription: {
      type: "string",
      description: "Richer description of the Issue, its context and its boundaries (min. 200 characters).",
    },
    mechanisms: stringArray("Mechanisms that produce or sustain the problem (min. 2 distinct entries)."),
    affectedActors: stringArray("Actors affected by or involved in the problem (min. 2 distinct entries)."),
    impacts: stringArray("Material economic, technological, competitive or institutional impacts (min. 2 distinct entries)."),
    potentialPolicyResponses: stringArray("Plausible policy or innovation responses to the problem (min. 1)."),
    canonicalTerms: stringArray("Canonical terms used to describe the Issue (min. 2)."),
    institutionalTerms: stringArray("Institutional/EU terminology discovered for the Issue (min. 1)."),
    technicalTerms: stringArray("Technical terminology of the Issue (min. 1)."),
    exclusions: stringArray("Adjacent topics/interpretations that are explicitly OUT of scope (min. 1)."),
    searchHypotheses: stringArray(
      "Materially different formulations under which the same underlying Issue could appear in external sources (min. 2, each distinct).",
    ),
    geographicScope: {
      anyOf: [stringArray("Geographic scope, e.g. ['European Union']."), { type: "null" }],
      description: "Optional geographic scope of the investigation; null when not applicable.",
    },
    temporalScope: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["from", "to"],
          properties: {
            from: { type: ["string", "null"], description: "Start of the temporal scope (YYYY / YYYY-MM / YYYY-MM-DD) or null." },
            to: { type: ["string", "null"], description: "End of the temporal scope (YYYY / YYYY-MM / YYYY-MM-DD) or null." },
          },
        },
        { type: "null" },
      ],
      description: "Optional temporal scope; null when not applicable.",
    },
  },
};

export function createCommitIssueProfileTool(): SemanticTool {
  return {
    name: COMMIT_ISSUE_PROFILE_NAME,
    spec: {
      type: "function",
      name: COMMIT_ISSUE_PROFILE_NAME,
      description:
        "Commit the structured Issue Profile and transition the research from issue_discovery to " +
        "issue_committed. The application validates the profile and rejects generic or trivial ones.",
      strict: true,
      parameters: COMMIT_ISSUE_PROFILE_PARAMETERS,
    },
    availableInPhases: ["issue_discovery"],
    async execute(rawArgs, ctx) {
      const state: ResearchState = ctx.state;
      const reject = (validationErrors: string[]): Record<string, unknown> => ({
        accepted: false,
        validationErrors,
        nextPhase: state.phase,
      });

      if (state.issueProfile) {
        return reject(["An Issue Profile is already committed for this research run."]);
      }

      const parsed = validateIssueProfileInput(rawArgs);
      if (!parsed.ok) {
        return reject(parsed.errors);
      }

      const profile = buildIssueProfile(parsed.value);
      try {
        applyTransition(state, "issue_committed");
      } catch (error) {
        return reject([
          `Profile rejected by the research state machine: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ]);
      }
      state.issueProfile = profile;
      recordActivity(ctx.state, {
        type: "tool_result",
        name: COMMIT_ISSUE_PROFILE_NAME,
        summary: `Issue Profile committed: "${profile.title}"`,
        outputSummary: {
          issueId: profile.id,
          title: profile.title,
          searchHypotheses: profile.searchHypotheses.length,
          exclusions: profile.exclusions.length,
        },
      });

      return {
        accepted: true,
        issueProfile: profile,
        nextPhase: "issue_committed" satisfies ResearchPhase,
      };
    },
  };
}
