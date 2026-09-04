/**
 * Core domain contracts for Research Radar.
 *
 * These types implement docs/DATA_MODEL.md exactly. They are the semantic
 * contract between Issue Understanding and every later retrieval stage.
 */

/** Research phases (PRD §7, ARCHITECTURE §3). Transitions are code-enforced in state.ts. */
export type ResearchPhase =
  | "issue_discovery"
  | "issue_committed"
  | "authoritative_retrieval"
  | "candidate_validation"
  | "synthesis";

export type ResearchStatus = "queued" | "running" | "completed" | "stopped" | "error";

export interface TemporalScope {
  from?: string;
  to?: string;
}

/**
 * Input contract for `commit_issue_profile` (DATA_MODEL §8): every substantive
 * IssueProfile field except server-generated IDs and timestamps.
 */
export interface IssueProfileInput {
  title: string;
  problemStatement: string;
  issueDescription: string;

  mechanisms: string[];
  affectedActors: string[];
  impacts: string[];
  potentialPolicyResponses: string[];

  canonicalTerms: string[];
  institutionalTerms: string[];
  technicalTerms: string[];

  exclusions: string[];
  searchHypotheses: string[];

  geographicScope?: string[];
  temporalScope?: TemporalScope;
}

/** The central semantic contract of the product (PRD §6.1). */
export interface IssueProfile extends IssueProfileInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** Web sources cited during discovery. Kept for provenance (DATA_MODEL §9). */
export interface DiscoverySource {
  url: string;
  title?: string;
  retrievedAt: string;
  usedFor: string;
}

export type AgentActivityType =
  | "web_search"
  | "tool_call"
  | "tool_result"
  | "state_transition"
  | "note"
  | "error";

/** Agent activity log entry (DATA_MODEL §4). Never store secrets here. */
export interface AgentActivity {
  id: string;
  type: AgentActivityType;
  name?: string;
  summary: string;
  input?: unknown;
  outputSummary?: unknown;
  createdAt: string;
}

/** Result of commit_issue_profile (DATA_MODEL §5). */
export interface CommitIssueProfileResult {
  accepted: boolean;
  issueProfile?: IssueProfile;
  validationErrors?: string[];
  nextPhase: ResearchPhase;
}

/**
 * Normalized, source-independent retrieval record (DATA_MODEL §6).
 * A retrieved record stays a Candidate until semantic validation accepts it.
 */
export interface Candidate {
  id: string;
  sourceProvider: string;
  sourceId?: string;
  sourceUrl?: string;
  title: string;
  summary?: string;
  content?: string;
  publishedAt?: string;
  metadata: Record<string, unknown>;
  retrievedAt: string;
  /** Which retrieval domain this candidate belongs to (set by the search tool). */
  domain?: "innovation" | "policy";
}

/** Lifecycle of a retrieved Candidate inside a research run (P-04). */
export type CandidateStatus = "pending" | "accepted" | "rejected" | "insufficient_content";

/**
 * How substantively a candidate addresses the committed Issue
 * (PRD §10, prompt "Phase 3"). Distinct from PolicyStage (RF-12).
 */
export type MatchLevel =
  | "incidental_mention"
  | "thematic_association"
  | "substantive_discussion"
  | "explicit_problem_recognition"
  | "proposed_intervention"
  | "formal_funded_response";

/** Model-proposed, code-validated semantic decision about a Candidate (RF-09). */
export interface CandidateValidationRecord {
  verdict: "relevant" | "not_relevant" | "insufficient_content";
  matchLevel: MatchLevel;
  relevanceExplanation: string;
  matchedProblemElements: string[];
  matchedMechanisms: string[];
  matchedImpacts: string[];
  matchedInterventions: string[];
  exclusionTriggered?: string;
  decidedAt: string;
}

/** A Candidate stored in the research state, with its validation outcome. */
export interface CandidateRecord extends Candidate {
  status: CandidateStatus;
  validation?: CandidateValidationRecord;
}

/**
 * Normalized policy stage (PRD RF-12). Placeholder for Milestone 3 — the
 * application classification is distinct from source metadata.
 */
export type PolicyStage =
  | "signal"
  | "consultation"
  | "planned_initiative"
  | "proposal"
  | "legislative_process"
  | "adopted"
  | "evaluation";

/**
 * A Candidate becomes Evidence only after semantic validation (DATA_MODEL §7).
 * Placeholder contract for Milestones 2–3 — not populated yet.
 */
export interface Evidence {
  id: string;
  issueId: string;
  candidateId: string;
  evidenceType: "media" | "institutional" | "legislative" | "consultation" | "research" | "innovation";
  title: string;
  summary?: string;
  sourceProvider: string;
  sourceId?: string;
  sourceUrl?: string;
  relevanceExplanation: string;
  matchedProblemElements: string[];
  matchedMechanisms: string[];
  matchedImpacts: string[];
  matchedInterventions: string[];
  policyStage?: PolicyStage;
  /** Structured enrichment preserved from the Candidate (Stage D). */
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ResearchCounters {
  modelTurns: number;
  toolCalls: number;
  webSearches: number;
}

/**
 * Persisted research state (DATA_MODEL §3). Conversation items are internal
 * (never exposed through the public API serialization).
 */
export interface ResearchState {
  id: string;
  phase: ResearchPhase;
  status: ResearchStatus;
  userQuestion: string;
  issueProfile?: IssueProfile;
  activity: AgentActivity[];
  discoverySources: DiscoverySource[];
  candidates: CandidateRecord[];
  evidence: Evidence[];
  conversation: Array<Record<string, unknown>>;
  finalMessage?: string;
  errorMessage?: string;
  counters: ResearchCounters;
  createdAt: string;
  updatedAt: string;
}
