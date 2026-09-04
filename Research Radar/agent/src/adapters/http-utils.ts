/** Shared HTTP helper for source adapters: timeout, size cap, JSON parsing. */

export interface FetchJsonOptions {
  timeoutMs: number;
  headers?: Record<string, string>;
  /** Test seam: defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

export async function fetchJsonWithTimeout(
  url: string,
  opts: FetchJsonOptions,
): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    fetch(input, init)) as typeof fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await doFetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", ...(opts.headers ?? {}) },
    });
    if (!res.ok) {
      // Never include the full URL in errors: it may carry credentials.
      throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    }
    const text = await readBodyCapped(res);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("response is not valid JSON");
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`request timed out after ${opts.timeoutMs} ms`);
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}

async function readBodyCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`response exceeds ${MAX_RESPONSE_BYTES} bytes`);
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
