import { newId, nowIso } from "../domain/ids.js";
import { Candidate } from "../domain/models.js";
import { InnovationSearchIntent, InnovationSourceAdapter } from "./types.js";

/**
 * Demo CORDIS adapter (used only when DEMO_MODE=true): returns three fixture
 * projects chosen to exercise the Milestone 2 success criteria — one project
 * that genuinely addresses the demo Issue, one that shares only the
 * technology (agricultural AI) and one adjacent-but-out-of-scope initiative.
 * The wire-level fixtures mirror the normalized Candidate contract.
 */

function fixture(
  rcn: string,
  acronym: string,
  title: string,
  objective: string,
  metadata: Record<string, unknown>,
): Candidate {
  return {
    id: newId("cand"),
    sourceProvider: "cordis-demo",
    sourceId: rcn,
    sourceUrl: `https://cordis.europa.eu/project/id/${rcn}`,
    title: `${acronym} — ${title}`,
    summary: objective.slice(0, 400),
    content: objective,
    retrievedAt: nowIso(),
    metadata: { acronym, ...metadata },
  };
}

const FIXTURES: Candidate[] = [
  fixture(
    "101138085",
    "EURO-COMPUTE",
    "European federated sovereign compute and cloud-edge capacity",
    "European firms and public administrations increasingly depend on compute and cloud " +
      "capacity controlled by non-EU hyperscalers. EURO-COMPUTE designs and pilots a " +
      "federated European sovereign cloud-edge infrastructure, including energy-efficient " +
      "data centres, an EU-operated federation layer for HPC and AI workloads, and " +
      "portability tools that reduce lock-in into non-EU technology stacks. The project " +
      "directly addresses the recognized problem of technological dependence in critical " +
      "digital infrastructure and strengthens European strategic autonomy, industrial " +
      "capacity and control over data.",
    {
      frameworkProgramme: "Horizon Europe",
      call: "HORIZON-DIGITAL-2024",
      topics: "Digital autonomy; Cloud-edge; HPC",
      status: "SIGNED",
      startDate: "2025-01-01",
      endDate: "2027-12-31",
      totalCostEur: 24_000_000,
      ecContributionEur: 19_500_000,
      coordinator: "Fraunhofer-Gesellschaft (DE)",
      organizations: "Fraunhofer (DE); CEA (FR); PSNC (PL); SURF (NL); Trust-IT (IT)",
      countries: "DE, FR, PL, NL, IT",
    },
  ),
  fixture(
    "101112993",
    "AGRI-AI-SENSE",
    "AI-driven crop monitoring for sustainable agriculture",
    "AGRI-AI-SENSE applies machine learning and cloud analytics to precision agriculture: " +
      "multispectral drone imagery and IoT soil sensors feed AI models that optimise " +
      "irrigation, fertilisation and yield prediction for European farms. The consortium " +
      "runs its workloads on a commercial cloud platform and focuses on reducing " +
      "environmental impact and increasing farm profitability.",
    {
      frameworkProgramme: "Horizon Europe",
      call: "HORIZON-CL6-2023",
      topics: "Agriculture; AI applications",
      status: "SIGNED",
      startDate: "2023-06-01",
      endDate: "2026-05-31",
      totalCostEur: 6_800_000,
      ecContributionEur: 5_900_000,
      coordinator: "Wageningen University (NL)",
      organizations: "Wageningen University (NL); Uni Bologna (IT); AgriTech SME (ES)",
      countries: "NL, IT, ES",
    },
  ),
  fixture(
    "101095188",
    "QUANTUM-LINK",
    "European quantum communication network for secure infrastructure",
    "QUANTUM-LINK deploys quantum key distribution segments across member states to secure " +
      "critical communication infrastructure against future computational threats. The " +
      "project builds quantum cryptography testbeds and interoperability standards for " +
      "national telecom operators and public administrations.",
    {
      frameworkProgramme: "Horizon Europe",
      call: "HORIZON-CL4-2023",
      topics: "Quantum communication; Cybersecurity",
      status: "SIGNED",
      startDate: "2023-10-01",
      endDate: "2026-09-30",
      totalCostEur: 15_000_000,
      ecContributionEur: 12_000_000,
      coordinator: "CNRS (FR)",
      organizations: "CNRS (FR); DT (DE); TID (ES)",
      countries: "FR, DE, ES",
    },
  ),
];

export class DemoCordisAdapter implements InnovationSourceAdapter {
  readonly sourceProvider = "cordis-demo";

  async searchInnovationProjects(intent: InnovationSearchIntent): Promise<Candidate[]> {
    // Deterministic fixtures regardless of intent (demo preview only).
    return FIXTURES.map((candidate) => ({ ...candidate, id: newId("cand") }));
  }
}
