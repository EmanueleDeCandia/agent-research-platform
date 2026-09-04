import { newId, nowIso } from "../domain/ids.js";
import { Candidate } from "../domain/models.js";
import {
  AdapterError,
  InnovationSearchIntent,
  InnovationSourceAdapter,
} from "./types.js";
import { fetchJsonWithTimeout, sleep } from "./http-utils.js";

/**
 * CORDIS adapter — the first authoritative Innovation Intelligence source
 * (PRD §5.2). Targets the official CORDIS Data Extractions API:
 *
 *   1. GET /api/dataextractions/getExtraction?query=...&key=...&outputFormat=json
 *      -> { taskID }
 *   2. GET /api/dataextractions/getExtractionStatus?taskId=...&key=...
 *      -> poll until destinationFileUri is populated
 *   3. GET destinationFileUri -> JSON result file
 *
 * Responsibilities (PRD §13): request construction, HTTP, timeout, error
 * handling, parsing, normalization to Candidate, source provenance.
 * The exported JSON shape is not formally documented by the source, so parsing
 * is defensive and supports the known container shapes; drift produces a clear
 * AdapterError instead of corrupt data.
 */

interface CordisRecord {
  [field: string]: unknown;
}

export interface CordisAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs: number;
  maxResultsCap?: number;
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://cordis.europa.eu";

export class CordisAdapter implements InnovationSourceAdapter {
  readonly sourceProvider = "cordis";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxResultsCap: number;
  private readonly pollIntervalMs: number;
  private readonly fetchImpl?: typeof fetch;

  constructor(opts: CordisAdapterOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs;
    this.maxResultsCap = opts.maxResultsCap ?? 20;
    this.pollIntervalMs = opts.pollIntervalMs ?? 3_000;
    this.fetchImpl = opts.fetchImpl;
  }

  async searchInnovationProjects(intent: InnovationSearchIntent): Promise<Candidate[]> {
    const query = buildCordisQuery(intent);
    const maxResults = Math.min(Math.max(intent.maxResults, 1), this.maxResultsCap);

    const taskId = await this.submitExtraction(query, maxResults);
    const fileUri = await this.waitForExtraction(taskId);
    const payload = await this.downloadResult(fileUri);
    const records = extractRecords(payload);
    if (records.length === 0) {
      throw new AdapterError(
        this.sourceProvider,
        "extraction result did not contain any recognizable project record",
      );
    }
    return records.slice(0, maxResults).map((record) => normalizeProject(record, this.sourceProvider));
  }

  private async submitExtraction(query: string, pageSize: number): Promise<string> {
    const url =
      `${this.baseUrl}/api/dataextractions/getExtraction?query=${encodeURIComponent(query)}` +
      `&key=${encodeURIComponent(this.apiKey)}&outputFormat=json&pageSize=${pageSize}`;
    const json = (await this.fetch(url)) as { taskID?: unknown; taskId?: unknown };
    const taskId = json["taskID"] ?? json["taskId"];
    if (typeof taskId !== "string" && typeof taskId !== "number") {
      throw new AdapterError(this.sourceProvider, "extraction submission did not return a task id");
    }
    return String(taskId);
  }

  private async waitForExtraction(taskId: string): Promise<string> {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const url =
        `${this.baseUrl}/api/dataextractions/getExtractionStatus?taskId=${encodeURIComponent(taskId)}` +
        `&key=${encodeURIComponent(this.apiKey)}`;
      const json = (await this.fetch(url)) as Record<string, unknown>;
      const status = typeof json["status"] === "string" ? json["status"].toUpperCase() : "";

      if (status === "ERROR" || status === "FAILED" || status === "CANCELLED") {
        const detail = typeof json["errorMessage"] === "string" ? `: ${json["errorMessage"]}` : "";
        throw new AdapterError(this.sourceProvider, `extraction task failed with status ${status}${detail}`);
      }
      const fileUri = json["destinationFileUri"];
      if (typeof fileUri === "string" && fileUri.startsWith("http")) {
        return fileUri;
      }
      if (Date.now() + this.pollIntervalMs > deadline) {
        throw new AdapterError(this.sourceProvider, "extraction task did not complete within the timeout");
      }
      await sleep(this.pollIntervalMs);
    }
  }

  private async downloadResult(fileUri: string): Promise<unknown> {
    return this.fetch(fileUri);
  }

  private async fetch(url: string): Promise<unknown> {
    try {
      return await fetchJsonWithTimeout(url, {
        timeoutMs: this.timeoutMs,
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      });
    } catch (error) {
      throw new AdapterError(
        this.sourceProvider,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

/**
 * Recall-oriented query building (PRD §11 Stage B): the committed problem's
 * vocabulary is expanded over title/objective with OR — precision is applied
 * later by semantic validation, not here.
 */
export function buildCordisQuery(intent: InnovationSearchIntent): string {
  const terms = [...intent.keywords, ...intent.mechanisms]
    .map((term) => term.trim())
    .filter((term) => term.length >= 3)
    .slice(0, 8);
  const searchable = terms.length > 0 ? terms : [intent.searchHypothesis];

  const clauses = searchable.map((term) => `title='${escapeOData(term)}' OR objective='${escapeOData(term)}'`);
  return `contenttype='project' AND (${clauses.join(" OR ")})`;
}

function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Accepts the known CORDIS result-file containers:
 *  - { type: "WireFrame", payload: { data: [ { order, fields: [{name, value}] } ] } }
 *  - a plain array of records
 *  - { results: [...] } / { data: [...] } wrappers of records
 */
export function extractRecords(payload: unknown): CordisRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecordObject);
  }
  if (!isRecordObject(payload)) return [];

  const wireData = (payload["payload"] as Record<string, unknown> | undefined)?.["data"];
  if (Array.isArray(wireData)) {
    const records: CordisRecord[] = [];
    for (const row of wireData) {
      if (!isRecordObject(row)) continue;
      const fields = row["fields"];
      if (!Array.isArray(fields)) continue;
      const record: CordisRecord = {};
      for (const field of fields) {
        if (isRecordObject(field) && typeof field["name"] === "string") {
          record[field["name"]] = field["value"];
        }
      }
      records.push(record);
    }
    return records;
  }

  for (const key of ["results", "data", "items"]) {
    const wrapper = payload[key];
    if (Array.isArray(wrapper)) return wrapper.filter(isRecordObject);
  }
  return [];
}

function isRecordObject(value: unknown): value is CordisRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick(record: CordisRecord, names: string[]): string | undefined {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function pickNumber(record: CordisRecord, names: string[]): number | undefined {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

/** Normalizes a raw CORDIS project record into the application Candidate (RF-08). */
export function normalizeProject(record: CordisRecord, sourceProvider: string): Candidate {
  const sourceId = pick(record, ["rcn", "projectRcn", "id", "projectID"]);
  const title = pick(record, ["title", "projectTitle"]) ?? "Untitled CORDIS project";
  const objective = pick(record, ["objective", "summary", "description"]);
  const acronym = pick(record, ["acronym", "projectAcronym"]);
  const sourceUrl = sourceId
    ? `https://cordis.europa.eu/project/id/${encodeURIComponent(sourceId)}`
    : pick(record, ["url", "projectUrl"]);

  const metadata: Record<string, unknown> = {};
  const scalarMappings: Array<[string[], string]> = [
    [["frameworkProgramme", "framework", "programme"], "frameworkProgramme"],
    [["callIdentifier", "call", "callId"], "call"],
    [["topics", "topic"], "topics"],
    [["status", "projectStatus"], "status"],
    [["startDate", "start"], "startDate"],
    [["endDate", "end"], "endDate"],
    [["coordinator", "coordinatorName"], "coordinator"],
    [["organisations", "organizations", "listOrganizations"], "organizations"],
    [["countries", "participantCountries"], "countries"],
  ];
  for (const [sourceNames, target] of scalarMappings) {
    const value = pick(record, sourceNames);
    if (value !== undefined) metadata[target] = value;
  }
  const totalCost = pickNumber(record, ["totalCost", "totalCostEu"]);
  const ecContribution = pickNumber(record, ["ecContribution", "ecMaxContribution", "euContribution"]);
  if (totalCost !== undefined) metadata["totalCostEur"] = totalCost;
  if (ecContribution !== undefined) metadata["ecContributionEur"] = ecContribution;

  return {
    id: newId("cand"),
    sourceProvider,
    ...(sourceId ? { sourceId } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    title: acronym ? `${acronym} — ${title}` : title,
    ...(objective ? { summary: objective.slice(0, 400) } : {}),
    ...(objective ? { content: objective } : {}),
    ...(pick(record, ["startDate"]) ? { publishedAt: pick(record, ["startDate"]) } : {}),
    metadata,
    retrievedAt: nowIso(),
  };
}
