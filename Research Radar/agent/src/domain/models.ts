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
 * Placeholder contract for Milestone 2 — not populated yet.
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
  conversation: Array<Record<string, unknown>>;
  finalMessage?: string;
  errorMessage?: string;
  counters: ResearchCounters;
  createdAt: string;
  updatedAt: string;
}
