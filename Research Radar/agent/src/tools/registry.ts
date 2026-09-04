import { RuntimeConfig } from "../config/env.js";
import { ResearchPhase, ResearchState } from "../domain/models.js";

/**
 * Semantic tool layer (PRD §12, AGENTS.md): functions express application
 * actions, never source-specific syntax. Availability is phase-dependent and
 * enforced here in code — not only in the prompt (PRD §8, P-07).
 */

export interface ToolContext {
  state: ResearchState;
  config: RuntimeConfig;
}

export interface SemanticTool {
  readonly name: string;
  readonly spec: {
    type: "function";
    name: string;
    description: string;
    strict: true;
    parameters: Record<string, unknown>;
  };
  readonly availableInPhases: readonly ResearchPhase[];
  execute(rawArgs: unknown, ctx: ToolContext): Promise<Record<string, unknown>>;
}

/** Built-in web_search tool of the Responses API (PRD §5.1 — Discovery Layer). */
export const WEB_SEARCH_TOOL: Record<string, unknown> = {
  type: "web_search",
  search_context_size: "medium",
};

export function toolsForPhase(registry: readonly SemanticTool[], phase: ResearchPhase): SemanticTool[] {
  return registry.filter((tool) => tool.availableInPhases.includes(phase));
}
