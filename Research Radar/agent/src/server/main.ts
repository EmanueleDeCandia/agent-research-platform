import path from "node:path";
import { loadDotEnv, loadRuntimeConfig } from "../config/env.js";
import { OrchestratorDeps, runResearch } from "../agent/orchestrator.js";
import { ScriptedModelClient } from "../agent/demo.js";
import { OpenAIResponsesClient, ModelClient } from "../agent/openai.js";
import { findAppRoot, loadRuntimePrompt } from "../agent/prompt.js";
import { CordisAdapter } from "../adapters/cordis.js";
import { DemoCordisAdapter } from "../adapters/cordis-demo.js";
import { CellarAdapter } from "../adapters/cellar.js";
import { DemoPolicyAdapter } from "../adapters/policy-demo.js";
import { InnovationSourceAdapter, PolicySourceAdapter } from "../adapters/types.js";
import { createCommitIssueProfileTool } from "../tools/commit-issue-profile.js";
import { createSearchInnovationProjectsTool } from "../tools/search-innovation-projects.js";
import { createValidateInnovationCandidatesTool } from "../tools/validate-innovation-candidates.js";
import { createSearchPolicyDocumentsTool } from "../tools/search-policy-documents.js";
import { createValidatePolicyDocumentsTool } from "../tools/validate-policy-documents.js";
import { createApp } from "./app.js";
import { ResearchStore } from "./store.js";

async function main(): Promise<void> {
  const appRoot = findAppRoot() ?? process.cwd();
  loadDotEnv(appRoot);
  const config = loadRuntimeConfig(appRoot);

  if (!config.demoMode && !config.openaiApiKey) {
    console.error(
      "OPENAI_API_KEY is required. Set it in the environment or in .env, " +
        "or set DEMO_MODE=true to preview the workflow with a scripted model client.",
    );
    process.exit(1);
  }

  const model: ModelClient = config.demoMode
    ? new ScriptedModelClient(config.capabilities.innovationRetrieval, config.capabilities.policyRetrieval)
    : new OpenAIResponsesClient({
        apiKey: config.openaiApiKey as string,
        model: config.model,
        timeoutMs: config.httpTimeoutMs,
      });

  const canonicalPrompt = loadRuntimePrompt(config.appRoot);
  const registry = [createCommitIssueProfileTool()];

  // Milestone 2 — Innovation Intelligence: CORDIS adapter behind the semantic
  // tool. The adapter is demo-scripted only in DEMO_MODE (labeled in the UI).
  if (config.capabilities.innovationRetrieval) {
    const adapter: InnovationSourceAdapter = config.demoMode
      ? new DemoCordisAdapter()
      : new CordisAdapter({
          apiKey: config.cordisApiKey as string,
          ...(config.cordisBaseUrl ? { baseUrl: config.cordisBaseUrl } : {}),
          timeoutMs: config.httpTimeoutMs,
          maxResultsCap: config.cordisMaxResultsCap,
        });
    registry.push(createSearchInnovationProjectsTool(adapter));
    registry.push(createValidateInnovationCandidatesTool());
  }

  // Milestone 3 — European Policy Intelligence: CELLAR adapter (public SPARQL,
  // no key) behind the semantic tool. SPARQL never leaves the adapter.
  if (config.capabilities.policyRetrieval) {
    const policyAdapter: PolicySourceAdapter = config.demoMode
      ? new DemoPolicyAdapter()
      : new CellarAdapter({
          ...(config.cellarBaseUrl ? { baseUrl: config.cellarBaseUrl } : {}),
          timeoutMs: config.httpTimeoutMs,
          maxResultsCap: config.cellarMaxResultsCap,
        });
    registry.push(createSearchPolicyDocumentsTool(policyAdapter));
    registry.push(createValidatePolicyDocumentsTool());
  }
  const orchestratorDeps: OrchestratorDeps = { model, registry, config, canonicalPrompt };

  const store = new ResearchStore();
  const publicDir = path.join(appRoot, "dist", "web", "public");

  const server = createApp({
    store,
    runner: (state) => runResearch(state, orchestratorDeps),
    config,
    publicDir,
  });

  server.listen(config.port, "0.0.0.0", () => {
    const mode = config.demoMode ? "DEMO MODE (scripted model client)" : `OpenAI Responses API · ${config.model}`;
    const milestone = config.capabilities.policyRetrieval
      ? "Milestone 3 — Issue Understanding + Innovation (CORDIS) + Policy (EUR-Lex/CELLAR)"
      : config.capabilities.innovationRetrieval
        ? "Milestone 2 — Issue Understanding + Innovation Intelligence (CORDIS)"
        : "Milestone 1 — Issue Understanding";
    console.log(`Research Radar listening on http://0.0.0.0:${config.port}`);
    console.log(`  runtime prompt : ${canonicalPrompt.slice(0, 60)}...`);
    console.log(`  model          : ${mode}`);
    console.log(`  capabilities   : ${JSON.stringify(config.capabilities)} (${milestone})`);
    if (config.capabilities.innovationRetrieval && !config.demoMode) {
      console.log(`  cordis         : ${config.cordisBaseUrl ?? "https://cordis.europa.eu"} (data extractions API)`);
    }
    if (config.capabilities.policyRetrieval && !config.demoMode) {
      console.log(`  policy/cellar  : ${config.cellarBaseUrl ?? "https://publications.europa.eu/sparql"} (public SPARQL)`);
    }
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
