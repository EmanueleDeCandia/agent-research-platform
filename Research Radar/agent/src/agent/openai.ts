/**
 * Minimal typed client for the OpenAI Responses API (PRD §17).
 *
 * Hand-rolled on purpose: zero runtime dependencies, full control over the
 * wire format (built-in web_search tool, strict function tools, store:false so
 * the whole conversation stays application-side), explicit timeouts and error
 * messages that never leak the API key.
 */

export interface ModelRequest {
  instructions: string;
  input: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
}

export interface ModelResponse {
  id: string;
  output: Array<Record<string, unknown>>;
  outputText: string;
}

export interface ModelClient {
  createResponse(request: ModelRequest): Promise<ModelResponse>;
}

export class ModelClientError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ModelClientError";
    this.status = status;
  }
}

export interface OpenAIClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs: number;
}

export class OpenAIResponsesClient implements ModelClient {
  private readonly opts: OpenAIClientOptions;

  constructor(opts: OpenAIClientOptions) {
    this.opts = opts;
  }

  async createResponse(request: ModelRequest): Promise<ModelResponse> {
    const url = `${this.opts.baseUrl ?? "https://api.openai.com/v1"}/responses`;
    const body = {
      model: this.opts.model,
      instructions: request.instructions,
      input: request.input,
      tools: request.tools,
      tool_choice: "auto",
      store: false,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let detail = text.slice(0, 500);
        try {
          const parsed = JSON.parse(text) as { error?: { message?: string } };
          if (parsed.error?.message) detail = parsed.error.message.slice(0, 500);
        } catch {
          // keep raw text
        }
        throw new ModelClientError(
          `OpenAI Responses API error (HTTP ${res.status}): ${detail}`,
          res.status,
        );
      }

      const json = (await res.json()) as Record<string, unknown>;
      const id = typeof json["id"] === "string" ? json["id"] : "resp_unknown";
      const output = Array.isArray(json["output"])
        ? (json["output"] as unknown[]).filter(
            (item): item is Record<string, unknown> =>
              typeof item === "object" && item !== null && !Array.isArray(item),
          )
        : [];
      const outputText = typeof json["output_text"] === "string" ? json["output_text"] : "";
      return { id, output, outputText };
    } catch (error) {
      if (error instanceof ModelClientError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ModelClientError(
          `OpenAI Responses API call timed out after ${this.opts.timeoutMs} ms.`,
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new ModelClientError(`OpenAI Responses API call failed: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
