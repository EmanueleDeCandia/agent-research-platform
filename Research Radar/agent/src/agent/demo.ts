import { ModelClient, ModelRequest, ModelResponse } from "./openai.js";

/**
 * Scripted demo model client. Used ONLY when DEMO_MODE=true so that the UI
 * workflow can be previewed without an OpenAI key. Every response uses the
 * same wire format as the real Responses API, so the orchestrator, state
 * machine, adapters and UI run their genuine code paths.
 *
 * The script is conversation-aware (not turn-count based): it looks at what
 * has already happened in the run and produces the next step — discovery,
 * Issue Profile commit, CORDIS retrieval (Milestone 2), semantic validation,
 * or the final synthesis.
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

  /**
   * innovation/policy: whether the Milestone 2 (CORDIS) and Milestone 3
   * (EUR-Lex/CELLAR) flows are deployed. The script adapts accordingly.
   */
  constructor(
    private readonly innovation: boolean = false,
    private readonly policy: boolean = false,
  ) {}

  async createResponse(request: ModelRequest): Promise<ModelResponse> {
    this.turn++;
    const id = `demo_resp_${this.turn}`;
    const input = request.input as Array<Record<string, unknown>>;

    const hasFunctionCall = (name: string): boolean =>
      input.some((item) => item["type"] === "function_call" && item["name"] === name);
    const hasWebSearch = input.some((item) => item["type"] === "web_search_call");

    // Stage 1 — discovery, then commit.
    if (!hasFunctionCall("commit_issue_profile")) {
      if (!hasWebSearch) {
        return {
          id,
          output: [
            webSearchItem("EU strategic autonomy digital infrastructure policy terminology"),
            webSearchItem("European sovereign cloud AI factories chips act institutional language"),
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
      return {
        id,
        output: [functionCallItem("commit_issue_profile", DEMO_PROFILE_ARGUMENTS)],
        outputText: "",
      };
    }

    // Stage 2 — Milestone 2: CORDIS retrieval per search hypothesis.
    if (this.innovation && !hasFunctionCall("search_innovation_projects")) {
      return {
        id,
        output: [
          functionCallItem("search_innovation_projects", {
            searchHypothesis: "sovereign cloud and AI factory initiatives in the EU",
            problemStatement: DEMO_PROFILE_ARGUMENTS.problemStatement,
            keywords: ["sovereign cloud", "strategic autonomy", "AI factories", "digital autonomy"],
            mechanisms: DEMO_PROFILE_ARGUMENTS.mechanisms.slice(0, 2),
            maxResults: 10,
          }),
        ],
        outputText: "",
      };
    }

    // Stage 3 — semantic validation of the retrieved candidates.
    if (this.innovation && !hasFunctionCall("validate_innovation_candidates")) {
      const candidates = parseLastSearchCandidates(input);
      if (candidates.length > 0) {
        return {
          id,
          output: [functionCallItem("validate_innovation_candidates", { validations: demoValidations(candidates) })],
          outputText: "",
        };
      }
    }

    // Stage 3b — Milestone 3: EU policy retrieval per search hypothesis.
    if (this.policy && !hasFunctionCall("search_policy_documents")) {
      return {
        id,
        output: [
          functionCallItem("search_policy_documents", {
            searchHypothesis: "European economic security and digital autonomy policy initiatives",
            problemStatement: DEMO_PROFILE_ARGUMENTS.problemStatement,
            keywords: ["economic security strategy", "Digital Decade", "sovereign cloud", "technological sovereignty"],
            documentTypes: null,
            maxResults: 10,
          }),
        ],
        outputText: "",
      };
    }

    // Stage 3c — Milestone 3: policy validation with stage classification.
    if (this.policy && !hasFunctionCall("validate_policy_documents")) {
      const candidates = parseLastSearchCandidates(input);
      if (candidates.length > 0) {
        return {
          id,
          output: [
            functionCallItem("validate_policy_documents", {
              validations: demoPolicyValidations(candidates),
            }),
          ],
          outputText: "",
        };
      }
    }

    // Stage 4 — final synthesis.
    return {
      id,
      output: [assistantItem(finalSynthesisMessage(this.innovation, this.policy), [])],
      outputText: "",
    };
  }
}

function finalSynthesisMessage(innovation: boolean, policy: boolean): string {
  if (policy) {
    return (
      "Demo synthesis. Executive synthesis: the investigated Issue — European dependence on non-EU " +
        "controlled compute, cloud, foundation models and semiconductors — is recognised at the highest " +
        "policy level and is being addressed by both legislation and funded innovation. Policy signals: " +
        "the European Economic Security Strategy explicitly recognises the dependency problem and plans " +
        "instruments (planned_initiative); the Digital Decade Policy Programme has been adopted as EU law " +
        "with funding for European cloud-edge and data infrastructures (adopted); a targeted consultation " +
        "on the future of European cloud policy is ongoing (consultation). Policy maturity: the Issue has " +
        "progressed from signals and consultation to an adopted regulatory response. " +
        (innovation
          ? "Innovation signals: a federated sovereign compute project constitutes validated innovation " +
            "Evidence, while agricultural AI and quantum communication projects were rejected — same or " +
            "adjacent technology, different problem. "
          : "") +
        "Actors: the Commission, Member States, European research centres and national e-infrastructure " +
        "providers. Information gaps: this demo run covers one hypothesis per domain and the title-only " +
        "Council conclusions record was marked insufficient content. Sources: the demo discovery pages " +
        "and the CORDIS/EUR-Lex records cited in the Evidence workspace."
    );
  }
  if (innovation) {
    return (
      "Demo synthesis. Executive synthesis: the investigated Issue — European dependence on " +
        "non-EU controlled compute, cloud, foundation models and semiconductors — is materially " +
        "addressed by at least one funded EU research initiative (a federated sovereign cloud-edge " +
        "and compute project), while initiatives that merely use the same technologies for other " +
        "problems (agricultural AI) or address a different infrastructure problem (quantum " +
        "communications security) were rejected by semantic validation. Innovation signals point to " +
        "an active EU funding line on digital autonomy. Actors include European research centres, " +
        "HPC/national e-infrastructures and public administrations. Information gaps: this demo run " +
        "covers a single search hypothesis; policy intelligence (EUR-Lex/CELLAR) arrives in " +
        "Milestone 3. Sources: the three demo discovery pages and the CORDIS project records cited " +
        "in the Evidence workspace."
    );
  }
  return (
    "Demo Issue Understanding summary: the investigation targets the structural dependence of " +
      "European firms and institutions on non-EU controlled compute, cloud, foundation models and " +
      "semiconductors. The committed profile captures the problem, its mechanisms (capacity " +
      "concentration, limited EU fabrication, non-EU frontier models, lock-in), the affected actors, " +
      "the material impacts, and four materially different search hypotheses for future authoritative " +
      "retrieval. This demo run stops at Milestone 1: innovation and policy retrieval would follow " +
      "in the next milestones."
  );
}

interface DemoCandidateView {
  candidateId: string;
  sourceId?: string;
  title: string;
}

function parseLastSearchCandidates(input: Array<Record<string, unknown>>): DemoCandidateView[] {
  for (let i = input.length - 1; i >= 0; i--) {
    const item = input[i];
    if (!item || item["type"] !== "function_call_output") continue;
    try {
      const parsed = JSON.parse(String(item["output"])) as { candidates?: unknown };
      if (!Array.isArray(parsed["candidates"])) continue;
      const views: DemoCandidateView[] = [];
      for (const candidate of parsed["candidates"]) {
        if (typeof candidate !== "object" || candidate === null) continue;
        const view = candidate as Record<string, unknown>;
        if (typeof view["candidateId"] === "string" && typeof view["title"] === "string") {
          views.push({
            candidateId: view["candidateId"],
            ...(typeof view["sourceId"] === "string" ? { sourceId: view["sourceId"] } : {}),
            title: view["title"],
          });
        }
      }
      return views;
    } catch {
      // not the search output — keep scanning
    }
  }
  return [];
}

function demoValidations(candidates: DemoCandidateView[]): Array<Record<string, unknown>> {
  return candidates.map((candidate) => {
    const rcn = candidate.sourceId ?? "";
    if (rcn === "101138085") {
      return {
        candidateId: candidate.candidateId,
        verdict: "relevant",
        matchLevel: "formal_funded_response",
        relevanceExplanation:
          "The project directly addresses the committed problem: it builds EU-controlled federated " +
          "compute/cloud-edge capacity to reduce dependence on non-EU hyperscalers and lock-in.",
        matchedProblemElements: ["dependence on non-EU controlled compute and cloud infrastructure"],
        matchedMechanisms: [
          "Concentration of hyperscale cloud and edge capacity under non-EU operators",
          "Lock-in effects of existing non-EU technology stacks in European industry",
        ],
        matchedImpacts: ["Reduced European strategic autonomy in critical digital capacity"],
        matchedInterventions: ["EU funding programmes for sovereign cloud and compute capacity"],
        exclusionTriggered: null,
      };
    }
    if (rcn === "101112993") {
      return {
        candidateId: candidate.candidateId,
        verdict: "not_relevant",
        matchLevel: "thematic_association",
        relevanceExplanation:
          "The project applies AI and cloud analytics to agricultural yield optimization: it shares the " +
          "technology but addresses a different problem, and runs on non-EU commercial cloud without any " +
          "dependency/autonomy objective.",
        matchedProblemElements: [],
        matchedMechanisms: [],
        matchedImpacts: [],
        matchedInterventions: [],
        exclusionTriggered: "Projects applying AI to sectoral problems without addressing dependency or autonomy",
      };
    }
    return {
      candidateId: candidate.candidateId,
      verdict: "not_relevant",
      matchLevel: "thematic_association",
      relevanceExplanation:
        "Quantum key distribution secures communications infrastructure against future computational " +
        "threats: a related technological-sovereignty theme, but it does not address the committed problem " +
        "of dependence on non-EU compute, cloud, models or semiconductors.",
      matchedProblemElements: [],
      matchedMechanisms: [],
      matchedImpacts: [],
      matchedInterventions: [],
      exclusionTriggered: "Cybersecurity product suites unrelated to infrastructure control",
    };
  });
}

function demoPolicyValidations(candidates: DemoCandidateView[]): Array<Record<string, unknown>> {
  return candidates.map((candidate) => {
    const celex = candidate.sourceId ?? "";
    if (celex === "52023PC0635") {
      return {
        candidateId: candidate.candidateId,
        verdict: "relevant",
        matchLevel: "proposed_intervention",
        policyStage: "planned_initiative",
        relevanceExplanation:
          "The Economic Security Strategy explicitly recognises dependence on non-EU critical technologies " +
          "(compute, cloud, semiconductors) as a risk and proposes concrete instruments, matching the " +
          "committed problem and policy responses.",
        matchedProblemElements: ["structural dependence on non-EU critical technologies"],
        matchedMechanisms: ["Concentration of hyperscale cloud capacity under non-EU operators"],
        matchedImpacts: ["Economic security risks from supply disruption of critical components"],
        matchedInterventions: ["EU economic security strategy instruments"],
        exclusionTriggered: null,
      };
    }
    if (celex === "32022R2483") {
      return {
        candidateId: candidate.candidateId,
        verdict: "relevant",
        matchLevel: "formal_funded_response",
        policyStage: "adopted",
        relevanceExplanation:
          "The adopted Digital Decade regulation sets funded digital-sovereignty targets, including European " +
          "cloud-edge and data infrastructures — a formal EU response to the committed dependency problem.",
        matchedProblemElements: ["limited EU-controlled digital infrastructure capacity"],
        matchedMechanisms: ["Lock-in effects of existing non-EU technology stacks in European industry"],
        matchedImpacts: ["Reduced European strategic autonomy in critical digital capacity"],
        matchedInterventions: ["EU funding programmes for sovereign cloud and compute capacity"],
        exclusionTriggered: null,
      };
    }
    if (celex === "52024DC0099") {
      return {
        candidateId: candidate.candidateId,
        verdict: "relevant",
        matchLevel: "substantive_discussion",
        policyStage: "consultation",
        relevanceExplanation:
          "The targeted consultation substantively discusses the structural dependency of European users on " +
          "non-EU cloud providers and gathers evidence on policy options — a consultation-stage signal.",
        matchedProblemElements: ["dependency of European users on external cloud infrastructure"],
        matchedMechanisms: ["Concentration of hyperscale cloud capacity under non-EU operators"],
        matchedImpacts: ["Weakened European industrial competitiveness in the digital stack"],
        matchedInterventions: ["Coordination of national cloud initiatives at EU level"],
        exclusionTriggered: null,
      };
    }
    if (celex === "32024R1689") {
      return {
        candidateId: candidate.candidateId,
        verdict: "not_relevant",
        matchLevel: "thematic_association",
        relevanceExplanation:
          "The AI Act regulates risks of artificial intelligence systems regardless of infrastructure " +
          "control: it shares the technology domain but does not address the committed dependency problem.",
        matchedProblemElements: [],
        matchedMechanisms: [],
        matchedImpacts: [],
        matchedInterventions: [],
        exclusionTriggered: null,
      };
    }
    return {
      candidateId: candidate.candidateId,
      verdict: "insufficient_content",
      matchLevel: "incidental_mention",
      policyStage: null,
      relevanceExplanation:
        "The record provides only a generic title without content: there is not enough information to " +
        "decide whether it addresses the committed Issue, so it is reported as an information gap.",
      matchedProblemElements: [],
      matchedMechanisms: [],
      matchedImpacts: [],
      matchedInterventions: [],
      exclusionTriggered: null,
    };
  });
}

function webSearchItem(query: string): Record<string, unknown> {
  return {
    type: "web_search_call",
    id: `demo_ws_${Math.random().toString(36).slice(2, 8)}`,
    status: "completed",
    action: { type: "search", query },
  };
}

function functionCallItem(name: string, args: unknown): Record<string, unknown> {
  return {
    type: "function_call",
    id: `demo_fc_${name}_${Math.random().toString(36).slice(2, 8)}`,
    call_id: `demo_call_${name}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    arguments: JSON.stringify(args),
  };
}

function assistantItem(text: string, annotations: Array<Record<string, unknown>>) {
  return {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text, annotations }],
  };
}
