import { createHash } from "node:crypto";

type CanonicalScalar = string | number | boolean | null;
export type CanonicalValue =
  | CanonicalScalar
  | CanonicalValue[]
  | { [k: string]: CanonicalValue };

/** Stable JSON-equivalent representation: sorted keys, NaN/Infinity → null. */
export function canonicalize(value: unknown): CanonicalValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const obj: { [k: string]: CanonicalValue } = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      obj[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return obj;
  }
  return null;
}

/**
 * Content hash for dedup. SHA-256 over (project_id, address, raw).
 *
 * Same hash function used by both /api/responses/import and
 * /api/points/import so that the dedup story stays consistent: re-importing
 * the same CSV is a no-op regardless of which flow you used.
 */
export function rowContentHash(projectId: string, address: string | null, raw: unknown): string {
  const payload = JSON.stringify([projectId, address ?? "", canonicalize(raw)]);
  return createHash("sha256").update(payload).digest("hex");
}
