import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Capabilities } from "../config/env.js";
import { ResearchPhase } from "../domain/models.js";

/**
 * Runtime instructions (ARCHITECTURE §6): the canonical agent prompt lives in
 * `prompt/research-agent.md` at the specification root. The application loads
 * it — it never keeps a second divergent copy in code. Only a small,
 * deterministic runtime-context wrapper is appended by the orchestrator.
 */

const PACKAGE_NAME = "research-radar";

export function findAppRoot(startDir: string = process.cwd()): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === PACKAGE_NAME) return dir;
      } catch {
        // not a readable package.json — keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function canonicalPromptPath(appRoot: string): string {
  if (process.env["RR_RUNTIME_PROMPT"]) {
    return path.resolve(process.env["RR_RUNTIME_PROMPT"]);
  }
  return path.resolve(appRoot, "..", "prompt", "research-agent.md");
}

export function loadRuntimePrompt(appRoot: string): string {
  const promptPath = canonicalPromptPath(appRoot);
  if (!existsSync(promptPath)) {
    throw new Error(
      `Canonical runtime prompt not found at ${promptPath}. ` +
        "The prompt file is part of the specification and must not be duplicated inside the app. " +
        "Set RR_RUNTIME_PROMPT to override its location.",
    );
  }
  return readFileSync(promptPath, "utf8");
}

function describeCapabilities(capabilities: Capabilities): string {
  const parts: string[] = ["issue understanding and Issue Profile commit (Milestone 1)"];
  if (capabilities.innovationRetrieval) parts.push("innovation candidate retrieval via CORDIS (Milestone 2)");
  if (capabilities.policyRetrieval) parts.push("policy candidate retrieval via EU sources (Milestone 3)");
  return parts.join("; ");
}

export function buildInstructions(
  canonicalPrompt: string,
  phase: ResearchPhase,
  capabilities: Capabilities,
  functionToolNames: string[],
): string {
  const lines: string[] = [
    canonicalPrompt.trimEnd(),
    "",
    "---",
    "",
    "## Runtime context (appended by the orchestrator — authoritative)",
    "",
    `- Current research phase: ${phase}`,
    `- This deployment implements: ${describeCapabilities(capabilities)}.`,
    functionToolNames.length > 0
      ? `- Function tools currently exposed in this phase: ${functionToolNames.join(", ")}.`
      : "- No function tools are exposed in this phase; the web_search built-in tool is available when useful.",
    "- Tool availability is enforced by the orchestrator: calls that are not allowed in the current phase are rejected.",
  ];

  if (!capabilities.innovationRetrieval && !capabilities.policyRetrieval && phase === "issue_discovery") {
    lines.push(
      "- Milestone 1 scope: once the Issue Profile is committed, this research run stops. " +
        "After a successful commit, produce a concise final Issue Understanding summary " +
        "(what the Issue is, the language discovered, the committed profile highlights) without further tool calls.",
    );
  }
  return lines.join("\n");
}
