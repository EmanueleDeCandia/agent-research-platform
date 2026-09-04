import { newId, nowIso } from "../domain/ids.js";
import { IssueProfile, IssueProfileInput } from "../domain/models.js";

/**
 * Deterministic quality gate for the Issue Profile commit (PRD §6.1, P-01,
 * DATA_MODEL §2). A profile is not valid merely because all arrays are
 * non-empty: it must preserve the substantive "what this is about".
 *
 * The model proposes; this code disposes. No opaque numeric score.
 */

export type IssueProfileValidation =
  | { ok: true; value: IssueProfileInput }
  | { ok: false; errors: string[] };

/** Broad domain labels that are never a substantive Issue by themselves (P-01). */
export const GENERIC_DOMAIN_LABELS: ReadonlySet<string> = new Set([
  "ai",
  "artificial intelligence",
  "energy",
  "mobility",
  "healthcare",
  "cloud",
  "digital",
  "transport",
  "climate",
  "biotech",
  "cybersecurity",
  "semiconductors",
  "quantum",
  "space",
  "defence",
  "agriculture",
  "tourism",
]);

interface FieldLimits {
  min: number;
  max: number;
}

const STRING_FIELDS: Readonly<Record<string, FieldLimits>> = {
  title: { min: 8, max: 160 },
  problemStatement: { min: 60, max: 1200 },
  issueDescription: { min: 200, max: 6000 },
};

interface ArrayFieldSpec {
  minItems: number;
  maxItems: number;
  itemMin: number;
  itemMax: number;
}

const ARRAY_FIELDS: Readonly<Record<string, ArrayFieldSpec>> = {
  mechanisms: { minItems: 2, maxItems: 20, itemMin: 8, itemMax: 300 },
  affectedActors: { minItems: 2, maxItems: 20, itemMin: 4, itemMax: 200 },
  impacts: { minItems: 2, maxItems: 20, itemMin: 8, itemMax: 300 },
  potentialPolicyResponses: { minItems: 1, maxItems: 20, itemMin: 8, itemMax: 300 },
  canonicalTerms: { minItems: 2, maxItems: 20, itemMin: 3, itemMax: 120 },
  institutionalTerms: { minItems: 1, maxItems: 20, itemMin: 3, itemMax: 120 },
  technicalTerms: { minItems: 1, maxItems: 20, itemMin: 3, itemMax: 120 },
  exclusions: { minItems: 1, maxItems: 20, itemMin: 10, itemMax: 300 },
  searchHypotheses: { minItems: 2, maxItems: 12, itemMin: 15, itemMax: 300 },
};

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseStringArray(value: unknown): { ok: true; values: string[] } | { ok: false } {
  if (!Array.isArray(value)) return { ok: false };
  const values: string[] = [];
  for (const item of value) {
    if (!isNonEmptyString(item)) return { ok: false };
    values.push(item.trim());
  }
  return { ok: true, values };
}

function hasDistinctValues(values: string[]): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    const key = normalized(value);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/**
 * Detects profiles that collapse into a single repeated generic label
 * (e.g. everything is "AI"). Looks at the vocabulary-bearing fields and
 * rejects when one short label dominates them.
 */
function findDominantGenericLabel(groups: string[][]): { label: string; share: number; count: number } | undefined {
  const counts = new Map<string, number>();
  let total = 0;
  for (const group of groups) {
    for (const raw of group) {
      const label = normalized(raw);
      if (label.length === 0 || label.length > 40) continue;
      total++;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  if (total === 0) return undefined;
  let best: { label: string; count: number } | undefined;
  for (const [label, count] of counts) {
    if (!best || count > best.count) best = { label, count };
  }
  if (!best) return undefined;
  const share = best.count / total;
  if (best.count >= 4 && share >= 0.6) {
    return { label: best.label, share, count: best.count };
  }
  return undefined;
}

export function validateIssueProfileInput(input: unknown): IssueProfileValidation {
  const errors: string[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["Issue profile must be a JSON object."] };
  }
  const raw = input as Record<string, unknown>;

  const strings: Partial<Record<string, string>> = {};
  for (const [field, limits] of Object.entries(STRING_FIELDS)) {
    const value = raw[field];
    if (!isNonEmptyString(value)) {
      errors.push(`"${field}" is required (non-empty string).`);
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length < limits.min) {
      errors.push(`"${field}" must be at least ${limits.min} characters (received ${trimmed.length}).`);
    }
    if (trimmed.length > limits.max) {
      errors.push(`"${field}" must be at most ${limits.max} characters.`);
    }
    strings[field] = trimmed;
  }

  const arrays: Partial<Record<string, string[]>> = {};
  for (const [field, spec] of Object.entries(ARRAY_FIELDS)) {
    const parsed = parseStringArray(raw[field]);
    if (!parsed.ok) {
      errors.push(`"${field}" must be an array of non-empty strings.`);
      continue;
    }
    arrays[field] = parsed.values;
    if (parsed.values.length < spec.minItems) {
      errors.push(`"${field}" requires at least ${spec.minItems} entries (received ${parsed.values.length}).`);
    }
    if (parsed.values.length > spec.maxItems) {
      errors.push(`"${field}" allows at most ${spec.maxItems} entries.`);
    }
    for (const item of parsed.values) {
      if (item.length < spec.itemMin) {
        errors.push(`Each entry of "${field}" must be at least ${spec.itemMin} characters.`);
        break;
      }
      if (item.length > spec.itemMax) {
        errors.push(`Each entry of "${field}" must be at most ${spec.itemMax} characters.`);
        break;
      }
    }
    if (!hasDistinctValues(parsed.values)) {
      errors.push(`"${field}" contains duplicate entries: entries must be distinct.`);
    }
  }

  const title = strings["title"];
  const problemStatement = strings["problemStatement"];
  const issueDescription = strings["issueDescription"];
  const searchHypotheses = arrays["searchHypotheses"];

  if (title && problemStatement && normalized(title) === normalized(problemStatement)) {
    errors.push('"problemStatement" must be more specific than "title": a label is not a problem statement.');
  }
  if (problemStatement && issueDescription && normalized(problemStatement) === normalized(issueDescription)) {
    errors.push('"issueDescription" must expand beyond "problemStatement".');
  }
  if (title && GENERIC_DOMAIN_LABELS.has(normalized(title)) && problemStatement === undefined) {
    errors.push(`A generic domain label ("${title}") is not a substantive Issue (P-01).`);
  }
  if (title && problemStatement && normalized(problemStatement) === normalized(title)) {
    errors.push("The profile reduces to a generic label: describe the substantive problem (P-01).");
  }

  if (searchHypotheses) {
    const norms = searchHypotheses.map(normalized);
    for (let i = 0; i < norms.length; i++) {
      for (let j = i + 1; j < norms.length; j++) {
        const a = norms[i];
        const b = norms[j];
        if (!a || !b) continue;
        if (a === b || a.includes(b) || b.includes(a)) {
          errors.push(
            "Search hypotheses must be materially different formulations of the underlying Issue " +
              `(hypotheses ${i + 1} and ${j + 1} are near-duplicates).`,
          );
          i = norms.length;
          break;
        }
      }
    }
  }

  const dominant = findDominantGenericLabel([
    arrays["mechanisms"] ?? [],
    arrays["canonicalTerms"] ?? [],
    arrays["institutionalTerms"] ?? [],
    arrays["technicalTerms"] ?? [],
  ]);
  if (dominant) {
    errors.push(
      `The profile collapses into the repeated label "${dominant.label}" ` +
        `(${dominant.count} of the vocabulary entries): it does not describe a substantive Issue (P-01).`,
    );
  }

  // Optional fields: strictly typed when present.
  const geographicScope = raw["geographicScope"];
  if (geographicScope !== undefined && geographicScope !== null) {
    const parsed = parseStringArray(geographicScope);
    if (!parsed.ok) {
      errors.push('"geographicScope" must be an array of non-empty strings (or null).');
    } else {
      arrays["geographicScope"] = parsed.values;
    }
  }
  const temporalScope = raw["temporalScope"];
  if (temporalScope !== undefined && temporalScope !== null) {
    if (typeof temporalScope !== "object" || Array.isArray(temporalScope)) {
      errors.push('"temporalScope" must be an object { from?, to? } (or null).');
    } else {
      const scope = temporalScope as Record<string, unknown>;
      for (const key of ["from", "to"]) {
        const value = scope[key];
        if (value !== undefined && value !== null && typeof value !== "string") {
          errors.push(`"temporalScope.${key}" must be a string or null.`);
        }
      }
      const from = scope["from"];
      const to = scope["to"];
      if (isNonEmptyString(from) && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(from.trim())) {
        errors.push('"temporalScope.from" must be a year or ISO date (YYYY, YYYY-MM, YYYY-MM-DD).');
      }
      if (isNonEmptyString(to) && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(to.trim())) {
        errors.push('"temporalScope.to" must be a year or ISO date (YYYY, YYYY-MM, YYYY-MM-DD).');
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: IssueProfileInput = {
    title: strings["title"] as string,
    problemStatement: strings["problemStatement"] as string,
    issueDescription: strings["issueDescription"] as string,
    mechanisms: arrays["mechanisms"] as string[],
    affectedActors: arrays["affectedActors"] as string[],
    impacts: arrays["impacts"] as string[],
    potentialPolicyResponses: arrays["potentialPolicyResponses"] as string[],
    canonicalTerms: arrays["canonicalTerms"] as string[],
    institutionalTerms: arrays["institutionalTerms"] as string[],
    technicalTerms: arrays["technicalTerms"] as string[],
    exclusions: arrays["exclusions"] as string[],
    searchHypotheses: arrays["searchHypotheses"] as string[],
    ...(arrays["geographicScope"] ? { geographicScope: arrays["geographicScope"] } : {}),
    ...(temporalScope && typeof temporalScope === "object" && !Array.isArray(temporalScope)
      ? { temporalScope: temporalScope as { from?: string; to?: string } }
      : {}),
  };
  return { ok: true, value };
}

/** Builds the persisted IssueProfile: IDs and timestamps are application-generated. */
export function buildIssueProfile(input: IssueProfileInput): IssueProfile {
  const now = nowIso();
  return { id: newId("issue"), createdAt: now, updatedAt: now, ...input };
}
