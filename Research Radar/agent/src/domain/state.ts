import { newId, nowIso } from "./ids.js";
import {
  AgentActivity,
  AgentActivityType,
  ResearchPhase,
  ResearchState,
} from "./models.js";

/**
 * Code-enforced research state machine (PRD §7, P-07).
 * The model can never self-declare a transition: the only way to advance is a
 * successful tool execution in this module.
 */
const TRANSITIONS: Readonly<Record<ResearchPhase, readonly ResearchPhase[]>> = {
  issue_discovery: ["issue_committed"],
  issue_committed: ["authoritative_retrieval"],
  authoritative_retrieval: ["candidate_validation"],
  candidate_validation: ["synthesis"],
  synthesis: [],
};

export class ResearchStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchStateError";
  }
}

export function canTransition(from: ResearchPhase, to: ResearchPhase): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function createResearchState(userQuestion: string): ResearchState {
  const now = nowIso();
  return {
    id: newId("run"),
    phase: "issue_discovery",
    status: "queued",
    userQuestion,
    activity: [],
    discoverySources: [],
    candidates: [],
    evidence: [],
    conversation: [],
    counters: { modelTurns: 0, toolCalls: 0, webSearches: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

export function touch(state: ResearchState): void {
  state.updatedAt = nowIso();
}

export function recordActivity(
  state: ResearchState,
  entry: {
    type: AgentActivityType;
    summary: string;
    name?: string;
    input?: unknown;
    outputSummary?: unknown;
  },
): AgentActivity {
  const activity: AgentActivity = {
    id: newId("act"),
    type: entry.type,
    summary: entry.summary,
    ...(entry.name !== undefined ? { name: entry.name } : {}),
    ...(entry.input !== undefined ? { input: entry.input } : {}),
    ...(entry.outputSummary !== undefined ? { outputSummary: entry.outputSummary } : {}),
    createdAt: nowIso(),
  };
  state.activity.push(activity);
  touch(state);
  return activity;
}

/**
 * Applies a phase transition. Throws ResearchStateError on any illegal
 * transition so that callers (tool executors) can convert it into a rejected
 * tool result instead of corrupting the state.
 */
export function applyTransition(state: ResearchState, to: ResearchPhase): void {
  if (state.phase === to) {
    throw new ResearchStateError(`Research is already in phase "${to}".`);
  }
  if (!canTransition(state.phase, to)) {
    throw new ResearchStateError(
      `Illegal research state transition: "${state.phase}" -> "${to}".`,
    );
  }
  const from = state.phase;
  state.phase = to;
  recordActivity(state, {
    type: "state_transition",
    summary: `State transition: ${from} -> ${to}`,
    outputSummary: { from, to },
  });
}
