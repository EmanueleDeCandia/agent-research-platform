import { RuntimeConfig, MILESTONE_CAPABILITIES } from "../src/config/env.js";
import { IssueProfileInput } from "../src/domain/models.js";
import { ModelClient, ModelRequest, ModelResponse } from "../src/agent/openai.js";

/** A substantively valid Issue Profile input (passes the deterministic gate). */
export function validProfileInput(): IssueProfileInput {
  return {
    title: "Dependence of European actors on non-EU controlled digital infrastructure",
    problemStatement:
      "European firms and institutions rely on compute, cloud, foundation models and semiconductors " +
      "controlled predominantly by non-EU operators, constraining European strategic autonomy, " +
      "industrial capacity, economic security and control over data.",
    issueDescription:
      "The Issue concerns the structural dependency of the European economy on digital infrastructure " +
      "whose design, ownership or operation sits predominantly outside the EU: hyperscale cloud and edge " +
      "capacity, advanced computing, frontier foundation models and semiconductor supply chains. " +
      "This dependency constrains the EU's ability to act autonomously and exposes European industry " +
      "and institutions to economic security and data-control risks. The research looks for policy and " +
      "innovation initiatives that recognise this dependency as a problem and respond to it. " +
      "Sectoral applications of the same technologies are out of scope.",
    mechanisms: [
      "Concentration of hyperscale cloud capacity under non-EU operators",
      "Limited EU-owned semiconductor fabrication capacity",
      "Frontier models developed and hosted outside the EU",
    ],
    affectedActors: [
      "European industrial firms",
      "EU public administrations",
      "European research organisations",
    ],
    impacts: [
      "Reduced strategic autonomy in critical digital capacity",
      "Exposure of European data to extraterritorial jurisdiction",
    ],
    potentialPolicyResponses: [
      "EU funding for sovereign cloud and compute capacity",
      "Procurement rules favouring EU-controlled infrastructure",
    ],
    canonicalTerms: ["technological sovereignty", "strategic autonomy", "digital autonomy"],
    institutionalTerms: ["European Chips Act", "EU economic security strategy"],
    technicalTerms: ["sovereign cloud", "foundation models"],
    exclusions: [
      "Sectoral AI applications unrelated to infrastructure dependency",
      "General digital skills programmes",
    ],
    searchHypotheses: [
      "European technological dependence on non-EU suppliers",
      "strategic autonomy in European computing infrastructure",
      "sovereign cloud initiatives in the EU",
    ],
    geographicScope: ["European Union"],
  };
}

export function testConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    appRoot: "/tmp/research-radar-test",
    model: "test-model",
    port: 0,
    httpTimeoutMs: 5_000,
    maxModelTurns: 6,
    maxToolCalls: 8,
    demoMode: false,
    cordisMaxResultsCap: 20,
    cellarMaxResultsCap: 20,
    capabilities: MILESTONE_CAPABILITIES,
    ...overrides,
  };
}

/** Scripted model client for orchestrator tests (deterministic, no network). */
export class FakeModelClient implements ModelClient {
  private readonly scripted: ModelResponse[];
  private index = 0;
  readonly requests: ModelRequest[] = [];

  constructor(scripted: ModelResponse[]) {
    this.scripted = scripted;
  }

  async createResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const next = this.scripted[this.index];
    this.index++;
    if (!next) {
      return { id: `fake_done_${this.index}`, output: [assistant("Run complete.")], outputText: "" };
    }
    return next;
  }
}

export function assistant(text: string): Record<string, unknown> {
  return {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

export function assistantWithCitation(text: string, url: string, title: string): Record<string, unknown> {
  return {
    type: "message",
    role: "assistant",
    content: [
      { type: "output_text", text, annotations: [{ type: "url_citation", url, title }] },
    ],
  };
}

export function webSearch(query: string): Record<string, unknown> {
  return { type: "web_search_call", id: `ws_${Math.random().toString(36).slice(2, 8)}`, status: "completed", action: { type: "search", query } };
}

export function functionCall(name: string, args: unknown, suffix = ""): Record<string, unknown> {
  return {
    type: "function_call",
    id: `fc_${name}${suffix}`,
    call_id: `call_${name}${suffix}`,
    name,
    arguments: typeof args === "string" ? args : JSON.stringify(args),
  };
}

export function response(id: string, output: Array<Record<string, unknown>>): ModelResponse {
  return { id, output, outputText: "" };
}
