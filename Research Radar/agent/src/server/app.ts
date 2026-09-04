import { readFile, stat } from "node:fs/promises";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import path from "node:path";
import { RuntimeConfig } from "../config/env.js";
import { ResearchState } from "../domain/models.js";
import { ResearchStore } from "./store.js";

/**
 * HTTP layer: research API + static UI. All external calls happen server-side
 * (PRD §17): the browser only ever talks to this server and never receives
 * secrets or raw provider payloads.
 */

export interface AppDeps {
  store: ResearchStore;
  runner: (state: ResearchState) => Promise<void>;
  config: RuntimeConfig;
  publicDir: string;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

const MAX_BODY_BYTES = 64 * 1024;

export function createApp(deps: AppDeps): Server {
  return createServer((req, res) => {
    handle(req, res, deps).catch((error) => {
      console.error("[server] unhandled error:", error);
      sendJson(res, 500, { error: "Internal server error." });
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, deps: AppDeps): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, service: "research-radar" });
  }

  if (req.method === "GET" && pathname === "/api/config") {
    return sendJson(res, 200, {
      model: deps.config.demoMode ? "scripted-demo" : deps.config.model,
      demoMode: deps.config.demoMode,
      capabilities: deps.config.capabilities,
      budgets: {
        maxModelTurns: deps.config.maxModelTurns,
        maxToolCalls: deps.config.maxToolCalls,
      },
    });
  }

  if (req.method === "POST" && pathname === "/api/research") {
    const body = await readJsonBody(req);
    const question = typeof body["question"] === "string" ? body["question"].trim() : "";
    if (question.length < 10) {
      return sendJson(res, 400, {
        error: "Field 'question' is required (at least 10 characters).",
      });
    }
    if (question.length > 4000) {
      return sendJson(res, 400, { error: "Field 'question' must be at most 4000 characters." });
    }
    const state = deps.store.create(question);
    // Fire-and-forget: the run mutates the stored state; the UI polls it.
    deps.runner(state).catch((error) => {
      state.status = "error";
      state.errorMessage = error instanceof Error ? error.message : String(error);
    });
    return sendJson(res, 202, { id: state.id, phase: state.phase, status: state.status });
  }

  if (req.method === "GET" && pathname === "/api/research") {
    return sendJson(res, 200, {
      runs: deps.store.list().map((state) => ({
        id: state.id,
        phase: state.phase,
        status: state.status,
        question: state.userQuestion.slice(0, 160),
        createdAt: state.createdAt,
        issueCommitted: Boolean(state.issueProfile),
      })),
    });
  }

  const match = /^\/api\/research\/([a-zA-Z0-9_-]+)$/.exec(pathname);
  if (req.method === "GET" && match) {
    const id = match[1] ?? "";
    const state = deps.store.get(id);
    if (!state) return sendJson(res, 404, { error: "Research run not found." });
    return sendJson(res, 200, serializeState(state, deps.config));
  }

  if (req.method === "GET") {
    return serveStatic(res, deps.publicDir, pathname);
  }

  return sendJson(res, 404, { error: "Not found." });
}

/** Public serialization: internal conversation items are never exposed. */
function serializeState(state: ResearchState, config: RuntimeConfig): Record<string, unknown> {
  return {
    id: state.id,
    status: state.status,
    phase: state.phase,
    userQuestion: state.userQuestion,
    issueProfile: state.issueProfile ?? null,
    finalMessage: state.finalMessage ?? null,
    errorMessage: state.errorMessage ?? null,
    activity: state.activity,
    discoverySources: state.discoverySources,
    candidates: state.candidates,
    evidence: state.evidence,
    counters: {
      ...state.counters,
      candidates: state.candidates.length,
      evidence: state.evidence.length,
    },
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    capabilities: config.capabilities,
  };
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function serveStatic(res: ServerResponse, publicDir: string, pathname: string): Promise<void> {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(publicDir, relative);
  if (!resolved.startsWith(path.resolve(publicDir))) {
    return sendJson(res, 403, { error: "Forbidden." });
  }
  try {
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error("not a file");
    const contentType = MIME_TYPES[path.extname(resolved)] ?? "application/octet-stream";
    const content = await readFile(resolved);
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: "Not found." });
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}
