import { ResearchState } from "../domain/models.js";
import { createResearchState } from "../domain/state.js";

/**
 * Session persistence (PRD RF-06). Milestone 1 keeps the research state in the
 * current session's memory; the contract is intentionally narrow so a durable
 * store can replace it later without touching the orchestrator.
 */
export class ResearchStore {
  private readonly runs = new Map<string, ResearchState>();

  create(userQuestion: string): ResearchState {
    const state = createResearchState(userQuestion);
    this.runs.set(state.id, state);
    return state;
  }

  get(id: string): ResearchState | undefined {
    return this.runs.get(id);
  }

  list(): ResearchState[] {
    return [...this.runs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50);
  }
}
