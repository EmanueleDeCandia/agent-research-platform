import { RuntimeConfig } from "../config/env.js";
import { DiscoverySource } from "../domain/models.js";
import { recordActivity, touch } from "../domain/state.js";
import { SemanticTool, toolsForPhase, WEB_SEARCH_TOOL } from "../tools/registry.js";
import { ModelClient } from "./openai.js";
import { buildInstructions } from "./prompt.js";
import {
  extractAssistantMessages,
  extractFunctionCalls,
  extractWebSearches,
  ParsedFunctionCall,
  replayableItems,
} from "./response-utils.js";

/**
 * Agent orchestrator (ARCHITECTURE §5/§7): loads runtime instructions, selects
 * the tools available for the current phase, executes the model/tool cycle,
 * updates the ResearchState after successful tool calls, enforces loop/tool
 * budgets and exposes agent activity to the UI.
 */

export interface OrchestratorDeps {
  model: ModelClient;
  registry: readonly SemanticTool[];
  config: RuntimeConfig;
  canonicalPrompt: string;
}

/** Encourages the model to either keep working towards the commit or close gracefully (RF-02). */
function continuationNudge(attempt: number): string {
  if (attempt === 1) {
    return (
      "Continue the research: the Issue Profile has not been committed yet. " +
      "Either keep investigating the language of the Issue with web_search and then call " +
      "commit_issue_profile, or, if the user input is too generic to identify a substantive " +
      "Issue, reply with a final message explaining precisely what additional information you need."
    );
  }
  return (
    "Wrap up now: either call commit_issue_profile with the best-supported profile, or produce " +
    "your final message. Do not call any other tool."
  );
}

export async function runResearch(state: import("../domain/models.js").ResearchState, deps: OrchestratorDeps): Promise<void> {
  state.status = "running";
  touch(state);
  recordActivity(state, {
    type: "note",
    summary: `Research run started (phase: ${state.phase}, model: ${deps.config.demoMode ? "scripted demo" : deps.config.model}).`,
  });

  if (state.conversation.length === 0) {
    state.conversation.push({ role: "user", content: state.userQuestion });
  }

  try {
    await researchLoop(state, deps);
    if (state.status === "running") state.status = "completed";
  } catch (error) {
    state.status = "error";
    const message = error instanceof Error ? error.message : String(error);
    state.errorMessage = message;
    recordActivity(state, { type: "error", summary: `Research run failed: ${message}` });
  } finally {
    touch(state);
  }
}

async function researchLoop(state: import("../domain/models.js").ResearchState, deps: OrchestratorDeps): Promise<void> {
  const { config } = deps;
  let wrapUpNudgeSent = false;
  let continuationNudges = 0;
  const MAX_CONTINUATION_NUDGES = 2;

  while (state.counters.modelTurns < config.maxModelTurns) {
    const phaseTools = toolsForPhase(deps.registry, state.phase);
    const tools: Array<Record<string, unknown>> = [
      WEB_SEARCH_TOOL,
      ...phaseTools.map((tool) => tool.spec as unknown as Record<string, unknown>),
    ];
    const instructions = buildInstructions(
      deps.canonicalPrompt,
      state.phase,
      config.capabilities,
      phaseTools.map((tool) => tool.name),
    );

    const response = await deps.model.createResponse({
      instructions,
      input: [...state.conversation],
      tools,
    });
    state.counters.modelTurns++;
    touch(state);

    // RF-03/RF-07: make web searches and citations visible + provenance (DATA_MODEL §9).
    for (const search of extractWebSearches(response.output)) {
      state.counters.webSearches++;
      recordActivity(state, {
        type: "web_search",
        summary: `Web search: "${search.query}"`,
        input: { query: search.query },
      });
    }
    for (const message of extractAssistantMessages(response.output)) {
      for (const citation of message.citations) {
        addDiscoverySource(state, citation.url, citation.title);
      }
    }

    state.conversation.push(...replayableItems(response.output));

    const calls = extractFunctionCalls(response.output);
    if (calls.length === 0) {
      const finalText = extractAssistantMessages(response.output)
        .map((message) => message.text)
        .join("\n\n")
        .trim();

      // RF-02: a run may only end in issue_discovery when the agent explicitly
      // closes it (clarification request) — never silently after narration.
      const awaitingCommit = state.phase === "issue_discovery" && !state.issueProfile;
      if (awaitingCommit && continuationNudges < MAX_CONTINUATION_NUDGES) {
        continuationNudges++;
        state.conversation.push({ role: "user", content: continuationNudge(continuationNudges) });
        recordActivity(state, {
          type: "note",
          summary: "Agent paused without committing the Issue Profile; asking it to continue or clarify.",
        });
        continue;
      }

      if (finalText) state.finalMessage = finalText;
      recordActivity(state, { type: "note", summary: "Agent produced its final message; run complete." });
      return;
    }

    for (const call of calls) {
      if (state.counters.toolCalls >= config.maxToolCalls) {
        recordActivity(state, {
          type: "error",
          summary: `Tool call budget (${config.maxToolCalls}) exhausted; stopping run.`,
        });
        state.status = "stopped";
        return;
      }
      state.counters.toolCalls++;
      recordActivity(state, {
        type: "tool_call",
        name: call.name,
        summary: `Tool call: ${call.name}`,
        input: argsPreview(call),
      });

      const outcome = await dispatchTool(state, deps, call);

      state.conversation.push({
        type: "function_call_output",
        call_id: call.callId,
        output: JSON.stringify(outcome),
      });
      recordActivity(state, {
        type: "tool_result",
        name: call.name,
        summary: outcomePreview(call.name, outcome),
        outputSummary: outcomeSummary(outcome),
      });
    }

    // Milestone 1: the run stops after ISSUE_COMMITTED. Ask the model for its
    // final Issue Understanding summary instead of burning further turns.
    if (
      state.phase === "issue_committed" &&
      !config.capabilities.innovationRetrieval &&
      !config.capabilities.policyRetrieval &&
      !wrapUpNudgeSent
    ) {
      wrapUpNudgeSent = true;
      state.conversation.push({
        role: "user",
        content:
          "The Issue Profile has been committed and this deployment stops here (Milestone 1). " +
          "Provide now your concise final Issue Understanding summary: what the Issue is, the key " +
          "language discovered, and what the committed profile enables next. Do not call any further tool.",
      });
    }
  }

  recordActivity(state, {
    type: "note",
    summary: `Model turn budget (${config.maxModelTurns}) reached; stopping run.`,
  });
  state.status = "stopped";
}

async function dispatchTool(
  state: import("../domain/models.js").ResearchState,
  deps: OrchestratorDeps,
  call: ParsedFunctionCall,
): Promise<Record<string, unknown>> {
  // Defense in depth: even if a tool spec is not exposed in this phase, a
  // hallucinated or replayed call is rejected here (PRD §8).
  const tool = deps.registry.find(
    (candidate) => candidate.name === call.name && candidate.availableInPhases.includes(state.phase),
  );
  if (!tool) {
    const known = deps.registry.find((candidate) => candidate.name === call.name);
    const message = known
      ? `Tool "${call.name}" is not available in phase "${state.phase}".`
      : `Unknown tool "${call.name}".`;
    return {
      error: message,
      availableTools: toolsForPhase(deps.registry, state.phase).map((candidate) => candidate.name),
    };
  }

  let args: unknown;
  try {
    args = JSON.parse(call.arguments || "{}");
  } catch {
    return { error: `Invalid JSON arguments for "${call.name}".` };
  }

  try {
    return await tool.execute(args, { state, config: deps.config });
  } catch (error) {
    return {
      error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function addDiscoverySource(state: import("../domain/models.js").ResearchState, url: string, title?: string): void {
  if (state.discoverySources.some((source) => source.url === url)) return;
  const source: DiscoverySource = {
    url,
    ...(title ? { title } : {}),
    retrievedAt: new Date().toISOString(),
    usedFor: "issue_discovery",
  };
  state.discoverySources.push(source);
}

function argsPreview(call: ParsedFunctionCall): unknown {
  if (call.name === "commit_issue_profile") {
    try {
      const parsed = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
      const preview: Record<string, unknown> = {};
      if (typeof parsed["title"] === "string") preview["title"] = parsed["title"];
      for (const key of [
        "mechanisms",
        "affectedActors",
        "impacts",
        "exclusions",
        "searchHypotheses",
      ]) {
        const value = parsed[key];
        if (Array.isArray(value)) preview[key] = value.length;
      }
      return preview;
    } catch {
      return { parseError: true };
    }
  }
  return undefined;
}

function outcomePreview(name: string, outcome: Record<string, unknown>): string {
  if (outcome["accepted"] === true) {
    return `Tool result: ${name} accepted — Issue Profile committed.`;
  }
  if (outcome["accepted"] === false) {
    const errors = Array.isArray(outcome["validationErrors"]) ? outcome["validationErrors"].length : 0;
    return `Tool result: ${name} rejected the commit (${errors} validation error(s)).`;
  }
  if (typeof outcome["error"] === "string") {
    return `Tool result: ${name} failed — ${outcome["error"]}`;
  }
  return `Tool result: ${name} completed.`;
}

function outcomeSummary(outcome: Record<string, unknown>): unknown {
  const summary: Record<string, unknown> = {};
  if (typeof outcome["accepted"] === "boolean") summary["accepted"] = outcome["accepted"];
  if (Array.isArray(outcome["validationErrors"])) {
    summary["validationErrors"] = (outcome["validationErrors"] as unknown[]).slice(0, 8);
  }
  if (typeof outcome["error"] === "string") summary["error"] = outcome["error"];
  return Object.keys(summary).length > 0 ? summary : undefined;
}
