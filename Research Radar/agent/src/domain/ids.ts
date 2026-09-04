import { randomUUID } from "node:crypto";

/** Generates application-side identifiers. IDs are never model-generated (DATA_MODEL §8). */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
