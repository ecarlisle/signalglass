/**
 * Primary entry points: `parseEvidenceRecord` and the deterministic
 * `normalizeEvidenceRecord`, plus semantic-comparison helpers that reject
 * serialized trace/analysis/completeness disagreements (Spec 014 §5.2,
 * §5.7–§5.8). `parseEvidenceRecord` never throws for malformed input; it
 * returns the single `EvidenceRecordParseResult` union.
 */
import type { ValidationIssue } from './types-analysis.js';
import type { EvidenceStructuralAnalysis } from './types-analysis.js';
import type { EvidenceRecord, CaptureBoundary, TraceCompleteness, EvidenceRecordParseResult } from './types-record.js';
import type { Condition } from './types-base.js';
import { isRecord } from './internal/guards.js';
import { cloneJsonSafe } from './internal/overlay.js';
import { isSupportedEvidenceSchemaVersion } from './version.js';
import { COMPLETENESS_DERIVATION_ALGORITHM_VERSION } from './version.js';
import { collapseObservations } from './normalize.js';
import {
  agreeTrace,
  agreeAnalysis,
  agreeCompleteness,
  preserveTrace,
  preserveAnalysis,
  preserveCompleteness,
} from './preservation.js';
import { deriveTrace } from './derive-trace.js';
import { deriveCompleteness } from './completeness.js';
import {
  validateObservation,
  validateCaptureBoundary,
  validateCaptureProfile,
  issue,
} from './validate-fields.js';
import type { EvidenceObservation } from './types-trace.js';

export type { EvidenceRecord };

export type NormalizeOptions = {
  captureProfile?: { name: string; version: string };
  conditions?: readonly Condition[];
};

/** Default trace-level capture-profile reference when none is declared. */
function defaultCaptureProfile(): { name: string; version: string } {
  return { name: 'unrecorded', version: '0.0.0' };
}

function fail(issues: readonly ValidationIssue[]): {
  ok: false;
  issues: readonly ValidationIssue[];
} {
  return { ok: false, issues };
}

/** Validate the raw-observation array: structural per-observation checks plus
 * unique, present, immutable `observationId` values. */
function validateObservationList(
  raw: unknown,
  path: string,
): { observations: EvidenceObservation[] | null; issues: ValidationIssue[] } {
  if (!Array.isArray(raw)) {
    return { observations: null, issues: [issue('raw_observations_not_array', path, 'rawObservations must be an array')] };
  }
  const issues: ValidationIssue[] = [];
  const obsIds = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    validateObservation(raw[i], `${path}[${i}]`, issues);
    const rec = raw[i];
    if (isRecord(rec) && typeof rec['observationId'] === 'string') {
      if (obsIds.has(rec['observationId'] as string)) {
        issues.push(issue('duplicate_observation_id', `${path}[${i}].observationId`, `duplicate observationId '${rec['observationId']}'`));
      }
      obsIds.add(rec['observationId'] as string);
    }
  }
  return { observations: raw as EvidenceObservation[], issues };
}

function buildAnalysis(
  collapsed: Extract<ReturnType<typeof collapseObservations>, { ok: true }>,
): EvidenceStructuralAnalysis {
  return {
    duplicateObservations: collapsed.duplicateObservations,
    sequenceGaps: collapsed.sequenceGaps,
    validationIssues: [],
    completenessDerivationAlgorithmVersion: COMPLETENESS_DERIVATION_ALGORITHM_VERSION,
  };
}

/**
 * Deterministic normalization: derives the canonical trace, structural
 * analysis, and completeness from raw observations and a declared capture
 * boundary. This is the construction path for an authoritative
 * `EvidenceRecord`; `parseEvidenceRecord` additionally verifies serialized
 * derivatives against it.
 */
export function normalizeEvidenceRecord(
  rawObservations: readonly EvidenceObservation[],
  captureBoundary: CaptureBoundary,
  evidenceSchemaVersion: string,
  options: NormalizeOptions = {},
): EvidenceRecordParseResult {
  const issues: ValidationIssue[] = [];
  if (!isSupportedEvidenceSchemaVersion(evidenceSchemaVersion)) {
    issues.push(issue('unsupported_evidence_schema_version', 'evidenceSchemaVersion', `evidenceSchemaVersion '${String(evidenceSchemaVersion)}' is not supported (supported MAJOR: 1)`));
  }
  validateCaptureBoundary(captureBoundary, 'captureBoundary', issues);
  const checked = validateObservationList(rawObservations, 'rawObservations');
  issues.push(...checked.issues);
  if (issues.length > 0) return fail(issues);

  const observations = checked.observations!;
  const collapsed = collapseObservations(observations, 'rawObservations');
  if (!collapsed.ok) return fail(collapsed.issues);

  const meta = {
    evidenceSchemaVersion,
    captureProfile: options.captureProfile ?? defaultCaptureProfile(),
    captureBoundary,
    conditions: options.conditions,
  };
  const derived = deriveTrace(collapsed.events, observations, meta);
  issues.push(...derived.issues);
  if (issues.length > 0) return fail(issues);

  const analysis = buildAnalysis(collapsed);
  const completeness = deriveCompleteness(derived.trace, analysis, captureBoundary);

  return {
    ok: true,
    record: {
      rawObservations: observations,
      trace: derived.trace,
      analysis,
      completeness,
      evidenceSchemaVersion,
      captureBoundary,
    },
  };
}

/**
 * Validates the full serialized evidence record and returns the parsed
 * `EvidenceRecord` with canonical trace, structural analysis, and derived
 * completeness. Serialized `trace`, `analysis`, and `completeness` that
 * disagree with the deterministic derivations reject the record (§5.8).
 */
export function parseEvidenceRecord(input: unknown): EvidenceRecordParseResult {
  if (!isRecord(input)) {
    return fail([issue('record_not_object', '$', 'evidence record must be a JSON object')]);
  }
  const issues: ValidationIssue[] = [];

  // ---- Schema version ----
  const rawVersion = input['evidenceSchemaVersion'];
  if (!isSupportedEvidenceSchemaVersion(rawVersion)) {
    return fail([issue('unsupported_evidence_schema_version', 'evidenceSchemaVersion', `evidenceSchemaVersion '${String(rawVersion)}' is not supported (supported MAJOR: 1)` )]);
  }
  const evidenceSchemaVersion = rawVersion as string;

  // ---- Capture boundary ----
  const rawBoundary = input['captureBoundary'];
  validateCaptureBoundary(rawBoundary, 'captureBoundary', issues);
  if (issues.length > 0) return fail(issues);
  const captureBoundary = rawBoundary as CaptureBoundary;

  // ---- Raw observations ----
  const checked = validateObservationList(input['rawObservations'], 'rawObservations');
  issues.push(...checked.issues);
  if (issues.length > 0) return fail(issues);
  const observations = checked.observations!;

  // ---- Collision processing + trace derivation ----
  const collapsed = collapseObservations(observations, 'rawObservations');
  if (!collapsed.ok) return fail(collapsed.issues);

  const serializedTrace = input['trace'];
  if (!isRecord(serializedTrace)) {
    return fail([issue('trace_missing', 'trace', 'serialized trace must be an object')]);
  }
  validateCaptureProfile(serializedTrace['captureProfile'], 'trace.captureProfile', issues);
  const conditions = validateConditions(serializedTrace['conditions']);
  if (issues.length > 0) return fail(issues);

  const meta = {
    evidenceSchemaVersion,
    captureProfile: serializedTrace['captureProfile'] as { name: string; version: string },
    captureBoundary,
    conditions,
  };
  const derived = deriveTrace(collapsed.events, observations, meta);
  issues.push(...derived.issues);
  if (issues.length > 0) return fail(issues);

  const analysis = buildAnalysis(collapsed);
  const completeness = deriveCompleteness(derived.trace, analysis, captureBoundary);

  // ---- Compare serialized derivatives with derivations (§5.8 steps 8–11) ----
  const serializedAnalysis = input['analysis'];
  const serializedCompleteness = input['completeness'];
  if (!isRecord(serializedAnalysis)) {
    return fail([issue('analysis_missing', 'analysis', 'serialized analysis must be an object')]);
  }
  if (!isRecord(serializedCompleteness)) {
    return fail([issue('completeness_missing', 'completeness', 'serialized completeness must be an object')]);
  }
  if (!agreeTrace(derived.trace, serializedTrace)) {
    return fail([issue('trace_disagrees_with_derivation', 'trace', 'serialized trace disagrees with the deterministic derivation')]);
  }
  if (!agreeAnalysis(analysis, serializedAnalysis)) {
    return fail([issue('analysis_disagrees_with_derivation', 'analysis', 'serialized structural analysis disagrees with the deterministic derivation')]);
  }
  if (!agreeCompleteness(completeness, serializedCompleteness)) {
    return fail([issue('completeness_disagrees_with_derivation', 'completeness', 'serialized completeness disagrees with the deterministic derivation')]);
  }

  // ---- Carry unknown additive fields at equivalent structural paths (§5.3) ----
  const trace = preserveTrace(derived.trace, serializedTrace);
  const preservedAnalysis = preserveAnalysis(analysis, serializedAnalysis);
  const preservedCompleteness = preserveCompleteness(completeness, serializedCompleteness);

  const record = {
    rawObservations: observations,
    trace,
    analysis: preservedAnalysis,
    completeness: preservedCompleteness,
    evidenceSchemaVersion,
    captureBoundary,
  };
  // Preserve unknown top-level additive fields (§5.3) at the record level,
  // as sanitized clones so unsafe prototype keys never survive.
  const known = new Set(['rawObservations', 'trace', 'analysis', 'completeness', 'evidenceSchemaVersion', 'captureBoundary']);
  for (const k of Object.keys(input)) {
    if (known.has(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    (record as Record<string, unknown>)[k] = cloneJsonSafe(input[k]);
  }
  return { ok: true, record: record as EvidenceRecord };
}

function validateConditions(value: unknown): readonly Condition[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const out: Condition[] = [];
  for (const c of value) {
    if (isRecord(c) && typeof c['label'] === 'string' && typeof c['version'] === 'string') {
      out.push(c as unknown as Condition);
    }
  }
  return out;
}
