import { newId, nowIso } from "../domain/ids.js";
import { Candidate } from "../domain/models.js";
import {
  AdapterError,
  PolicySearchIntent,
  PolicySourceAdapter,
} from "./types.js";
import { fetchJsonWithTimeout } from "./http-utils.js";

/**
 * CELLAR adapter — first authoritative European Policy Intelligence source
 * (PRD §5.3). CELLAR is the Publications Office content repository that also
 * carries EUR-Lex documents; CELEX is the canonical document identifier and
 * is used for deduplication (RF-14).
 *
 * All SPARQL knowledge lives here: the semantic tool only expresses
 * search_policy_documents(). The public SPARQL endpoint returns
 * application/sparql-results+json; the query matches English expression
 * titles of legal works (recall-oriented — precision comes from semantic
 * validation, PRD §11 Stage B).
 *
 * The exact CDM predicate set can drift: parsing is defensive and any
 * structural mismatch surfaces as a clear AdapterError. Set
 * CELLAR_BASE_URL to point the adapter at a compatible endpoint.
 */

export const CELLAR_DEFAULT_BASE_URL = "https://publications.europa.eu/sparql";

export interface CellarAdapterOptions {
  baseUrl?: string;
  timeoutMs: number;
  maxResultsCap?: number;
  fetchImpl?: typeof fetch;
}

interface SparqlBinding {
  [name: string]: { value?: unknown } | undefined;
}

export class CellarAdapter implements PolicySourceAdapter {
  readonly sourceProvider = "cellar";
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxResultsCap: number;
  private readonly fetchImpl?: typeof fetch;

  constructor(opts: CellarAdapterOptions) {
    this.baseUrl = (opts.baseUrl ?? CELLAR_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs;
    this.maxResultsCap = opts.maxResultsCap ?? 20;
    this.fetchImpl = opts.fetchImpl;
  }

  async searchPolicyDocuments(intent: PolicySearchIntent): Promise<Candidate[]> {
    const maxResults = Math.min(Math.max(intent.maxResults, 1), this.maxResultsCap);
    const sparql = buildCellarSparql(intent, maxResults * 2);
    const url = `${this.baseUrl}?query=${encodeURIComponent(sparql)}&format=${encodeURIComponent(
      "application/sparql-results+json",
    )}&timeout=${this.timeoutMs}`;

    let payload: unknown;
    try {
      payload = await fetchJsonWithTimeout(url, {
        timeoutMs: this.timeoutMs,
        headers: { Accept: "application/sparql-results+json" },
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      });
    } catch (error) {
      throw new AdapterError(
        this.sourceProvider,
        error instanceof Error ? error.message : String(error),
      );
    }

    const bindings = extractBindings(payload);
    if (bindings === null) {
      throw new AdapterError(this.sourceProvider, "SPARQL endpoint returned an unrecognized payload");
    }
    if (bindings.length === 0) {
      throw new AdapterError(this.sourceProvider, "no documents matched the query");
    }

    const candidates = bindings
      .map((binding) => normalizePolicyDocument(binding, this.sourceProvider))
      .filter((candidate): candidate is Candidate => candidate !== null)
      .filter((candidate) => matchesDocumentTypes(candidate, intent.documentTypes));

    if (candidates.length === 0) {
      throw new AdapterError(
        this.sourceProvider,
        "matched documents were filtered out by the requested document types",
      );
    }
    return dedupeByCelex(candidates).slice(0, maxResults);
  }
}

/** Recall-oriented SPARQL over CELLAR: English titles of works with a CELEX id. */
export function buildCellarSparql(intent: PolicySearchIntent, limit: number): string {
  const terms = [...intent.keywords, intent.searchHypothesis]
    .map((term) => term.trim())
    .filter((term) => term.length >= 4)
    .slice(0, 6);
  const searchable = terms.length > 0 ? terms : [intent.problemStatement.slice(0, 80)];

  const clauses = searchable
    .map((term) => `CONTAINS(LCASE(STR(?title)), LCASE('${escapeSparql(term)}'))`)
    .join(" || ");

  return [
    "PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>",
    "PREFIX dct: <http://purl.org/dc/terms/>",
    "SELECT DISTINCT ?work ?celex ?title ?date ?docType WHERE {",
    "  ?work cdm:resource_legal_has_celex ?celex .",
    "  ?work cdm:work_has_expression ?expression .",
    "  ?expression dct:title ?title .",
    "  FILTER (LANG(?title) = 'en')",
    "  OPTIONAL { ?work cdm:work_date_document ?date }",
    "  OPTIONAL { ?work dct:type ?docType }",
    `  FILTER (${clauses})`,
    "}",
    `LIMIT ${Math.max(1, Math.min(limit, 200))}`,
  ].join("\n");
}

function escapeSparql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function extractBindings(payload: unknown): SparqlBinding[] | null {
  if (typeof payload !== "object" || payload === null) return null;
  const results = (payload as Record<string, unknown>)["results"];
  if (typeof results !== "object" || results === null) return null;
  const bindings = (results as Record<string, unknown>)["bindings"];
  if (!Array.isArray(bindings)) return null;
  return bindings.filter(
    (binding): binding is SparqlBinding =>
      typeof binding === "object" && binding !== null && !Array.isArray(binding),
  );
}

function bindingValue(binding: SparqlBinding, name: string): string | undefined {
  const value = binding[name]?.["value"];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function normalizePolicyDocument(
  binding: SparqlBinding,
  sourceProvider: string,
): Candidate | null {
  const celex = bindingValue(binding, "celex");
  const title = bindingValue(binding, "title");
  if (!celex || !title) return null;

  const work = bindingValue(binding, "work");
  const date = bindingValue(binding, "date");
  const docType = localName(bindingValue(binding, "docType"));

  const metadata: Record<string, unknown> = {};
  if (work) metadata["cellarWork"] = work;
  if (docType) metadata["documentType"] = docType;

  return {
    id: newId("cand"),
    sourceProvider,
    sourceId: celex,
    sourceUrl: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${encodeURIComponent(celex)}`,
    title,
    summary: title,
    content: [title, docType ? `Type: ${docType}` : "", date ? `Date: ${date}` : ""]
      .filter((part) => part.length > 0)
      .join(" — "),
    ...(date ? { publishedAt: date } : {}),
    metadata,
    retrievedAt: nowIso(),
  };
}

function localName(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const match = /[/#]([^/#]+)$/.exec(uri);
  return match?.[1] ?? uri;
}

function matchesDocumentTypes(candidate: Candidate, documentTypes?: string[]): boolean {
  if (!documentTypes || documentTypes.length === 0) return true;
  const type = typeof candidate.metadata["documentType"] === "string"
    ? String(candidate.metadata["documentType"]).toLowerCase()
    : undefined;
  if (!type) return true; // unknown type: keep for recall, validation will decide
  return documentTypes.some((requested) => type.includes(requested.toLowerCase()));
}

/** RF-14: prefer the canonical source identifier (CELEX) over URLs/titles. */
function dedupeByCelex(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const unique: Candidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.sourceId ?? candidate.sourceUrl ?? candidate.title;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}
