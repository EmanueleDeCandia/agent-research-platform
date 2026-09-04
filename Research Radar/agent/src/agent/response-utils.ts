import { ModelResponse } from "./openai.js";

/**
 * Defensive parsing of Responses API output items. The wire format is treated
 * as untrusted: every access is guarded so a malformed item can never crash
 * the research loop.
 */

export interface ParsedFunctionCall {
  id: string;
  callId: string;
  name: string;
  arguments: string;
}

export interface ParsedWebSearch {
  query: string;
}

export interface ParsedAssistantMessage {
  text: string;
  citations: Array<{ url: string; title?: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractFunctionCalls(output: ModelResponse["output"]): ParsedFunctionCall[] {
  const calls: ParsedFunctionCall[] = [];
  for (const item of output) {
    if (item["type"] !== "function_call") continue;
    const name = item["name"];
    const callId = item["call_id"];
    if (typeof name !== "string" || typeof callId !== "string") continue;
    calls.push({
      id: typeof item["id"] === "string" ? item["id"] : "",
      callId,
      name,
      arguments: typeof item["arguments"] === "string" ? item["arguments"] : "{}",
    });
  }
  return calls;
}

export function extractWebSearches(output: ModelResponse["output"]): ParsedWebSearch[] {
  const searches: ParsedWebSearch[] = [];
  for (const item of output) {
    if (item["type"] !== "web_search_call") continue;
    const action = item["action"];
    if (!isRecord(action)) continue;
    if (action["type"] !== "search" && action["type"] !== undefined) continue;
    const query = action["query"];
    if (typeof query === "string" && query.trim().length > 0) {
      searches.push({ query: query.trim() });
    }
  }
  return searches;
}

export function extractAssistantMessages(output: ModelResponse["output"]): ParsedAssistantMessage[] {
  const messages: ParsedAssistantMessage[] = [];
  for (const item of output) {
    if (item["type"] !== "undefined" && item["type"] !== "message") continue;
    if (item["role"] !== "assistant") continue;
    const content = item["content"];
    if (!Array.isArray(content)) continue;

    let text = "";
    const citations: Array<{ url: string; title?: string }> = [];
    for (const part of content) {
      if (!isRecord(part)) continue;
      if (part["type"] === "output_text" && typeof part["text"] === "string") {
        text += part["text"];
      }
      const annotations = part["annotations"];
      if (!Array.isArray(annotations)) continue;
      for (const annotation of annotations) {
        if (!isRecord(annotation)) continue;
        if (annotation["type"] !== "url_citation") continue;
        const url = annotation["url"];
        if (typeof url === "string" && url.startsWith("http")) {
          const title = annotation["title"];
          citations.push({
            url,
            ...(typeof title === "string" && title.trim().length > 0 ? { title: title.trim() } : {}),
          });
        }
      }
    }
    if (text.trim().length > 0 || citations.length > 0) {
      messages.push({ text: text.trim(), citations });
    }
  }
  return messages;
}

const REPLAYABLE_TYPES = new Set(["message", "web_search_call", "function_call"]);

/** Items that can be safely replayed as input on the next turn (store:false). */
export function replayableItems(output: ModelResponse["output"]): Array<Record<string, unknown>> {
  return output.filter((item) => {
    const type = item["type"];
    return typeof type === "string" && REPLAYABLE_TYPES.has(type);
  });
}
