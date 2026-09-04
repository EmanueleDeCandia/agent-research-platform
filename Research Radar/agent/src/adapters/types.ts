import { Candidate } from "../domain/models.js";

/**
 * Adapter contracts (PRD §12/§13): a semantic tool expresses the information
 * need; an adapter translates it into source-specific queries and normalizes
 * the output into application objects. Source syntax never leaks to the model.
 */

/** Application-level intent for innovation retrieval, built from the committed Issue Profile. */
export interface InnovationSearchIntent {
  /** Which materially different search hypothesis this query expresses (RF-04). */
  searchHypothesis: string;
  /** The problem framing, carried from the committed profile (RF-08). */
  problemStatement: string;
  /** Vocabulary terms for this hypothesis (canonical/institutional/technical). */
  keywords: string[];
  /** Causal mechanisms, used to bias recall without narrowing to a keyword. */
  mechanisms: string[];
  /** Recall-oriented upper bound (Stage B favours recall, PRD §11). */
  maxResults: number;
}

export interface InnovationSourceAdapter {
  readonly sourceProvider: string;
  searchInnovationProjects(intent: InnovationSearchIntent): Promise<Candidate[]>;
}

/**
 * Application-level intent for policy retrieval (RF-10). The tool expresses
 * the information need; adapters decide which institutional sources to query
 * (CELLAR, EUR-Lex, Commission Work Programme, ...) and hide their syntax.
 */
export interface PolicySearchIntent {
  searchHypothesis: string;
  /** The problem framing, carried from the committed profile. */
  problemStatement: string;
  /** Vocabulary terms for this hypothesis (institutional terminology first). */
  keywords: string[];
  /** Optional focus on document classes (communication, regulation, consultation, ...). */
  documentTypes?: string[];
  maxResults: number;
}

export interface PolicySourceAdapter {
  readonly sourceProvider: string;
  searchPolicyDocuments(intent: PolicySearchIntent): Promise<Candidate[]>;
}

export class AdapterError extends Error {
  constructor(
    readonly sourceProvider: string,
    message: string,
  ) {
    super(`[${sourceProvider}] ${message}`);
    this.name = "AdapterError";
  }
}
