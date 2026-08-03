/**
 * Identifier syntax/validation helpers (Spec 014 §3.2, §5.4). Identifiers are
 * caller-supplied opaque non-empty strings; generation is outside the
 * evidence core. Internal-only.
 */

/** Identifiers are non-empty opaque strings; whitespace-only is not opaque. */
export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !/^\s+$/.test(value);
}

/** A `spanId`/`parentSpanId` value: an identifier or `null` (structural). */
export function isOptionalSpanId(value: unknown): value is string | null {
  return value === null || isIdentifier(value);
}

/** A non-negative integer sequence position. */
export function isSeq(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

/** A non-negative integer position (context contribution `position`). */
export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}
