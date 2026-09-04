import { newId, nowIso } from "../domain/ids.js";
import { Candidate } from "../domain/models.js";
import { PolicySearchIntent, PolicySourceAdapter } from "./types.js";

/**
 * Demo policy adapter (used only when DEMO_MODE=true): returns fixture EU
 * policy documents chosen to exercise the Milestone 3 success criteria —
 * from an incidental mention up to an adopted act — against the demo Issue
 * (European dependence on non-EU digital infrastructure).
 */

function fixture(
  celex: string,
  title: string,
  content: string,
  metadata: Record<string, unknown>,
): Candidate {
  return {
    id: newId("cand"),
    sourceProvider: "cellar-demo",
    sourceId: celex,
    sourceUrl: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${celex}`,
    title,
    summary: content.slice(0, 400),
    content,
    retrievedAt: nowIso(),
    metadata,
  };
}

const FIXTURES: Candidate[] = [
  fixture(
    "52023PC0635",
    "Joint Communication to the European Parliament and the Council — European Economic Security Strategy",
    "The European Economic Security Strategy identifies structural dependencies on non-EU suppliers " +
      "in critical technologies — including advanced computing, cloud infrastructure and semiconductors — " +
      "as risks to European economic security and strategic autonomy. It proposes a toolbox of measures: " +
      "risk assessments with Member States, investment screening, export controls and targeted European " +
      "investment in strategic capacity. The strategy explicitly recognises the problem of technological " +
      "dependence and commits the Commission to monitor and reduce it.",
    { documentType: "communication", date: "2023-06-20" },
  ),
  fixture(
    "32022R2483",
    "Regulation (EU) 2022/2483 establishing the Digital Decade Policy Programme 2030",
    "The Digital Decade Policy Programme sets measurable targets for Europe's digital transformation " +
      "by 2030, including digital sovereignty objectives: at least 75% of European enterprises using " +
      "cloud/AI/data technologies, the deployment of common European data infrastructures and edge " +
      "cloud capacities through multi-country projects, and the first generation of European edge " +
      "node distributed platforms. The programme — adopted as EU law — funds the Next Generation Cloud " +
      "initiative and interoperable public digital service infrastructures to reduce technological " +
      "dependence in critical areas.",
    { documentType: "regulation", date: "2022-12-14" },
  ),
  fixture(
    "52024DC0099",
    "Call for evidence — Targeted consultation on the future of the European cloud and edge policy",
    "The Commission consults stakeholders on the policy options for strengthening EU-owned cloud and " +
      "edge capacity: barriers to the uptake of European offers, coordination of national initiatives, " +
      "and the role of the EU funding framework in reducing dependence on non-EU hyperscale providers. " +
      "The consultation seeks views on whether the current mix of instruments sufficiently addresses " +
      "the structural dependency of European users on external cloud infrastructure.",
    { documentType: "consultation", date: "2024-03-05" },
  ),
  fixture(
    "32024R1689",
    "Regulation (EU) 2024/1689 laying down harmonised rules on artificial intelligence (AI Act)",
    "The AI Act establishes a horizontal regulatory framework for artificial intelligence in the " +
      "Union: prohibited practices, high-risk requirements, transparency obligations and a governance " +
      "system based on the European AI Office. The regulation addresses risks posed by AI systems " +
      "regardless of where the underlying computing infrastructure is located or controlled.",
    { documentType: "regulation", date: "2024-06-13" },
  ),
  fixture(
    "52025CV0007",
    "Council conclusions on digital transformation (title-only record)",
    "",
    { documentType: "other", date: "2025-01-15" },
  ),
];

export class DemoPolicyAdapter implements PolicySourceAdapter {
  readonly sourceProvider = "cellar-demo";

  async searchPolicyDocuments(_intent: PolicySearchIntent): Promise<Candidate[]> {
    return FIXTURES.map((candidate) => ({ ...candidate, id: newId("cand") }));
  }
}
