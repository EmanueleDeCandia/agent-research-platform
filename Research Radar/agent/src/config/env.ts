import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Deployment capabilities. Updated milestone by milestone so that the UI and
 * the agent runtime context always reflect what is actually implemented
 * (AGENTS.md: do not implement authoritative adapters before their milestone).
 */
export interface Capabilities {
  readonly innovationRetrieval: boolean;
  readonly policyRetrieval: boolean;
}

/** Milestone 1 — Issue Understanding only. */
export const MILESTONE_CAPABILITIES: Capabilities = {
  innovationRetrieval: false,
  policyRetrieval: false,
};

/**
 * Milestone 2: innovation retrieval is active when CORDIS is not disabled and
 * either an API key is configured or demo mode provides the scripted adapter.
 * Milestone 3: policy retrieval uses the public CELLAR SPARQL endpoint — no
 * key required — and can be disabled with POLICY_ENABLED=false.
 */
export function computeCapabilities(env: NodeJS.ProcessEnv, demoMode: boolean): Capabilities {
  const cordisEnabled = (env["CORDIS_ENABLED"] ?? "true").trim().toLowerCase() !== "false";
  const cordisKey = Boolean((env["CORDIS_API_KEY"] ?? "").trim());
  const policyEnabled = (env["POLICY_ENABLED"] ?? "true").trim().toLowerCase() !== "false";
  return {
    innovationRetrieval: cordisEnabled && (cordisKey || demoMode),
    policyRetrieval: policyEnabled,
  };
}

export interface RuntimeConfig {
  readonly appRoot: string;
  readonly openaiApiKey?: string;
  readonly model: string;
  readonly port: number;
  readonly httpTimeoutMs: number;
  readonly maxModelTurns: number;
  readonly maxToolCalls: number;
  readonly demoMode: boolean;
  readonly cordisApiKey?: string;
  readonly cordisBaseUrl?: string;
  readonly cordisMaxResultsCap: number;
  readonly cellarBaseUrl?: string;
  readonly cellarMaxResultsCap: number;
  readonly capabilities: Capabilities;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Minimal .env loader (no external dependency). Existing env vars win. */
export function loadDotEnv(appRoot: string): void {
  const envPath = path.join(appRoot, ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadRuntimeConfig(appRoot: string): RuntimeConfig {
  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  const cordisApiKey = process.env["CORDIS_API_KEY"]?.trim();
  const cordisBaseUrl = process.env["CORDIS_BASE_URL"]?.trim();
  const cellarBaseUrl = process.env["CELLAR_BASE_URL"]?.trim();
  const demoMode = (process.env["DEMO_MODE"] ?? "").trim().toLowerCase() === "true";
  return {
    appRoot,
    ...(apiKey ? { openaiApiKey: apiKey } : {}),
    model: process.env["OPENAI_MODEL"]?.trim() || "gpt-4.1",
    port: readInt("PORT", 8787),
    httpTimeoutMs: readInt("RR_HTTP_TIMEOUT_MS", 120_000),
    maxModelTurns: readInt("RR_MAX_MODEL_TURNS", 12),
    maxToolCalls: readInt("RR_MAX_TOOL_CALLS", 24),
    demoMode,
    ...(cordisApiKey ? { cordisApiKey } : {}),
    ...(cordisBaseUrl ? { cordisBaseUrl } : {}),
    cordisMaxResultsCap: readInt("CORDIS_MAX_RESULTS", 20),
    ...(cellarBaseUrl ? { cellarBaseUrl } : {}),
    cellarMaxResultsCap: readInt("CELLAR_MAX_RESULTS", 20),
    capabilities: computeCapabilities(process.env, demoMode),
  };
}
