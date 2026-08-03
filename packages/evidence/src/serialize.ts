/**
 * Serialization (Spec 014 §5.7). `serializeEvidenceRecord` emits the full
 * authoritative `EvidenceRecord` (validating first — a programming-error
 * guard, since invalid evidence must be caught by `parseEvidenceRecord`
 * instead of thrown). `serializeEvidenceExport` emits the derivative export
 * that omits `rawObservations` and declares the reduced verification
 * boundary. Retained byte payloads serialize as canonical RFC 4648 §4 Base64.
 */
import type { EvidenceRecord } from './types-record.js';
import type { CaptureBoundary, TraceCompleteness } from './types-record.js';
import type { EvidenceTrace } from './types-trace.js';
import type { EvidenceStructuralAnalysis } from './types-analysis.js';
import { parseEvidenceRecord } from './validate.js';
import { toJsonView } from './normalize.js';

const RECORD_KEYS = [
  'rawObservations',
  'trace',
  'analysis',
  'completeness',
  'evidenceSchemaVersion',
  'captureBoundary',
];

/**
 * Serializes the full authoritative evidence record as canonical JSON. The
 * record is validated against the full parse pipeline first; a record that
 * fails validation is a caller programming error (invalid evidence must be
 * surfaced through `parseEvidenceRecord`, not here), so this throws.
 */
export function serializeEvidenceRecord(record: EvidenceRecord): string {
  const parsed = parseEvidenceRecord(record as unknown);
  if (!parsed.ok) {
    const codes = parsed.issues.map((i) => i.code).join(', ');
    throw new Error(`serializeEvidenceRecord: invalid evidence record (${codes})`);
  }
  const out: Record<string, unknown> = {};
  for (const k of RECORD_KEYS) {
    const v = (record as unknown as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  // Preserve unknown top-level additive fields (record-level passthrough),
  // never descending prototype keys.
  for (const k of Object.keys(record as unknown as Record<string, unknown>)) {
    if (!RECORD_KEYS.includes(k) && k !== '__proto__' && k !== 'constructor' && k !== 'prototype') out[k] = (record as unknown as Record<string, unknown>)[k];
  }
  return JSON.stringify(toJsonView(out));
}

/**
 * Serializes the derivative normalized export: canonical trace, reported
 * structural analysis, derived completeness, and declared boundary, with
 * explicit declarations that `rawObservations` are omitted, the verification
 * boundary is reduced, duplicate analysis is reported derived metadata, and
 * omitted observations cannot be independently proved, reconstructed, or
 * revalidated without the authoritative `EvidenceRecord` (§5.7–§5.8).
 */
export function serializeEvidenceExport(
  trace: EvidenceTrace,
  analysis: EvidenceStructuralAnalysis,
  completeness: TraceCompleteness,
  captureBoundary: CaptureBoundary,
): string {
  const exportDoc = {
    exportClass: 'signalglass.evidence.export.v1',
    rawObservationsOmitted: true,
    verificationBoundary: 'reduced',
    duplicateAnalysis: 'reported-derived',
    statement:
      'This export is not the authoritative evidence record: raw observations are omitted and ' +
      'cannot be independently proved, reconstructed, or revalidated without the authoritative ' +
      'EvidenceRecord. Structural duplicate analysis is reported derived metadata.',
    evidenceSchemaVersion: trace.evidenceSchemaVersion,
    captureBoundary,
    trace,
    analysis,
    completeness,
  };
  return JSON.stringify(toJsonView(exportDoc));
}