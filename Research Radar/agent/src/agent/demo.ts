import { ModelClient, ModelRequest, ModelResponse } from "./openai.js";

/**
 * Scripted demo model client. Used ONLY when DEMO_MODE=true so that the UI
 * workflow can be previewed without an OpenAI key. Every response it produces
 * uses the same wire format as the real Responses API, so the orchestrator,
 * state machine and UI run their genuine code paths.
 *
 * This is a demo aid, not a substitute for the real integration: the default
 * deployment uses OpenAIResponsesClient (AGENTS.md verification rules).
 */

const DEMO_PROFILE_ARGUMENTS = {
  title: "European dependence on non-EU controlled digital infrastructure (demo run)",
  problemStatement:
    "European firms and institutions increasingly rely on compute capacity, cloud services, foundation models and semiconductors controlled predominantly by non-EU operators, which constrains European strategic autonomy, industrial capacity, economic security and control over data.",
  issueDescription:
    "The Issue concerns the structural dependency of the European economy on digital infrastructure and technology stack components whose design, ownership or operation sits predominantly outside the EU. This dependency spans advanced computing capacity, hyperscale cloud and edge infrastructure, frontier foundation models, and semiconductor supply chains. It matters because it shapes the EU's ability to act autonomously in industrial, security and data-governance terms, and because disruptions or extraterritorial decisions could produce material economic and institutional impacts. The investigation looks for policy and innovation initiatives that recognise this dependency as a problem and respond to it. Adjacent topics that merely use the same technologies — such as agricultural AI applications or general digital skills programmes — are outside the scope.",
  mechanisms: [
    "Concentration of hyperscale cloud and edge capacity under non-EU operators",
    "Limited EU-owned advanced semiconductor design and fabrication capacity",
    "Frontier foundation models developed and hosted outside the EU",
    "Lock-in effects of existing non-EU technology stacks in European industry",
  ],
  affectedActors: [
    "European industrial firms reliant on external compute and cloud",
    "EU public administrations and institutional users",
    "European research organisations and HPC centres",
    "European cloud and semiconductor suppliers",
    "EU policymakers in digital and economic security domains",
  ],
  impacts: [
    "Reduced European strategic autonomy in critical digital capacity",
    "Exposure of European data and workloads to extraterritorial jurisdiction",
    "Weakened European industrial competitiveness in the digital stack",
    "Economic security risks from supply disruption of critical components",
  ],
  potentialPolicyResponses: [
    "EU funding programmes for sovereign cloud, AI factories and compute capacity",
    "European Chips Act style initiatives for semiconductor capacity",
    "Procurement and certification rules favouring EU-controlled infrastructure",
    "Research and innovation calls targeting digital autonomy technologies",
  ],
  canonicalTerms: [
    "technological sovereignty",
    "strategic autonomy",
    "digital autonomy",
    "economic security",
  ],
  institutionalTerms: [
    "European Chips Act",
    "EU economic security strategy",
    "AI factories",
    "European cloud policy",
  ],
  technicalTerms: ["sovereign cloud", "edge computing capacity", "foundation models", "high performance computing"],
  exclusions: [
    "Projects applying AI to sectoral problems without addressing dependency or autonomy",
    "General digital skills and adoption programmes",
    "Cybersecurity product suites unrelated to infrastructure control",
  ],
  searchHypotheses: [
    "European technological dependence on non-EU suppliers",
    "strategic autonomy in European computing infrastructure",
    "sovereign cloud and AI factory initiatives in the EU",
    "European semiconductor supply chain vulnerabilities",
  ],
  geographicScope: ["European Union"],
  temporalScope: null,
};

const DEMO_CITATIONS = [
  { type: "url_citation", url: "https://example.europa.eu/strategic-autonomy", title: "Strategic autonomy — institutional overview (demo)" },
  { type: "url_citation", url: "https://example.europa.eu/economic-security", title: "EU economic security strategy (demo)" },
  { type: "url_citation", url: "https://example.europa.eu/ai-factories", title: "AI factories initiative (demo)" },
];

export class ScriptedModelClient implements ModelClient {
  private turn = 0;

  async createResponse(_request: ModelRequest): Promise<ModelResponse> {
    this.turn++;
    const id = `demo_resp_${this.turn}`;

    if (this.turn === 1) {
      return {
        id,
        output: [
          {
            type: "web_search_call",
            id: "demo_ws_1",
            status: "completed",
            action: { type: "search", query: "EU strategic autonomy digital infrastructure policy terminology" },
          },
          {
            type: "web_search_call",
            id: "demo_ws_2",
            status: "completed",
            action: { type: "search", query: "European sovereign cloud AI factories chips act institutional language" },
          },
          assistantItem(
            "Demo discovery pass. The institutional debate uses terms such as “technological " +
              "sovereignty”, “strategic autonomy”, “economic security”, “AI factories” and “sovereign " +
              "cloud”. Adjacent-but-different framings (general digital skills, sectoral AI applications) " +
              "are noted as exclusions. I can now structure the Issue Profile.",
            DEMO_CITATIONS,
          ),
        ],
        outputText: "",
      };
    }

    if (this.turn === 2) {
      return {
        id,
        output: [
          {
            type: "function_call",
            id: "demo_fc_1",
            call_id: "demo_call_1",
            name: "commit_issue_profile",
            arguments: JSON.stringify(DEMO_PROFILE_ARGUMENTS),
          },
        ],
        outputText: "",
      };
    }

    return {
      id,
      output: [
        assistantItem(
          "Demo Issue Understanding summary: the investigation targets the structural dependence of " +
            "European firms and institutions on non-EU controlled compute, cloud, foundation models and " +
            "semiconductors. The committed profile captures the problem, its mechanisms (capacity " +
            "concentration, limited EU fabrication, non-EU frontier models, lock-in), the affected actors, " +
            "the material impacts, and four materially different search hypotheses for future authoritative " +
            "retrieval. This demo run stops at Milestone 1: innovation and policy retrieval would follow " +
            "in the next milestones.",
          [],
        ),
      ],
      outputText: "",
    };
  }
}

function assistantItem(text: string, annotations: Array<Record<string, unknown>>) {
  return {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text, annotations }],
  };
}
