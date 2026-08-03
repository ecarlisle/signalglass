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
import { jsonEqual } from './internal/guards.js';
import { isSupportedEvidenceSchemaVersion } from './version.js';
import { COMPLETENESS_DERIVATION_ALGORITHM_VERSION } from './version.js';
import { collapseObservations, toJsonView, sortUtf8 } from './normalize.js';
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
  if (!traceSemanticEqual(derived.trace, serializedTrace)) {
    return fail([issue('trace_disagrees_with_derivation', 'trace', 'serialized trace disagrees with the deterministic derivation')]);
  }
  if (!analysisSemanticEqual(analysis, serializedAnalysis)) {
    return fail([issue('analysis_disagrees_with_derivation', 'analysis', 'serialized structural analysis disagrees with the deterministic derivation')]);
  }
  if (!completenessExactEqual(completeness, serializedCompleteness)) {
    return fail([issue('completeness_disagrees_with_derivation', 'completeness', 'serialized completeness disagrees with the deterministic derivation')]);
  }

  const record = {
    rawObservations: observations,
    trace: derived.trace,
    analysis,
    completeness,
    evidenceSchemaVersion,
    captureBoundary,
  };
  // Preserve unknown top-level additive fields (§5.3) at the record level.
  const known = new Set(['rawObservations', 'trace', 'analysis', 'completeness', 'evidenceSchemaVersion', 'captureBoundary']);
  for (const k of Object.keys(input)) {
    if (known.has(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    (record as Record<string, unknown>)[k] = input[k];
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

// ---------------------------------------------------------------------------
// Semantic comparison helpers (§5.2, §5.7)
// ---------------------------------------------------------------------------

function sortedEvents(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return [...value].sort((a, b) => {
    const ra = isRecord(a) ? a['seq'] : -1;
    const rb = isRecord(b) ? b['seq'] : -1;
    return (ra as number) - (rb as number);
  });
}

function sortedSpans(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return [...value].sort((a, b) => {
    const ra = isRecord(a) ? String(a['spanId']) : '';
    const rb = isRecord(b) ? String(b['spanId']) : '';
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });
}

/** Semantic trace equality: events by seq, spans by spanId, arrays ordered. */
export function traceSemanticEqual(a: unknown, b: unknown): boolean {
  if (!isRecord(a) || !isRecord(b)) return false;
  for (const k of ['interactionId', 'traceId', 'evidenceSchemaVersion', 'captureSurface', 'observationBoundary', 'startedAt', 'status']) {
    if (!jsonEqual(toJsonView(a[k]), toJsonView(b[k]))) return false;
  }
  if (!jsonEqual(toJsonView(a['captureProfile']), toJsonView(b['captureProfile']))) return false;
  const fa = a['finishedAt'];
  const fb = b['finishedAt'];
  if ((fa === undefined) !== (fb === undefined)) return false;
  if (fa !== undefined && !jsonEqual(toJsonView(fa), toJsonView(fb))) return false;
  const ca = a['conditions'];
  const cb = b['conditions'];
  if ((ca === undefined) !== (cb === undefined)) return false;
  if (ca !== undefined && !jsonEqual(toJsonView(ca), toJsonView(cb))) return false;

  const ea = sortedEvents(a['events']);
  const eb = sortedEvents(b['events']);
  if (ea.length !== eb.length) return false;
  for (let i = 0; i < ea.length; i++) {
    if (!jsonEqual(toJsonView(ea[i]), toJsonView(eb[i]))) return false;
  }
  const sa = sortedSpans(a['spans']);
  const sb = sortedSpans(b['spans']);
  if (sa.length !== sb.length) return false;
  for (let i = 0; i < sa.length; i++) {
    if (!jsonEqual(toJsonView(sa[i]), toJsonView(sb[i]))) return false;
  }
  return true;
}

function duplicateKeyNoDigest(d: Record<string, unknown>): string {
  if (d['classification'] === 'exact_replay') {
    return `exact_replay|${String(d['eventId'])}|${String(d['seq'])}|ids=${sortUtf8(asStrings(d['observationIds'])).join(',')}`;
  }
  const discarded = asArray(d['discardedPositions'])
    .map((p) => `${String(isRecord(p) ? p['seq'] : '')}:${sortUtf8(asStrings(isRecord(p) ? p['observationIds'] : null)).join(',')}:${String(isRecord(p) ? p['positionIndependentlyRepresented'] : '')}`)
    .join(';');
  const retained = isRecord(d['retainedPosition']) ? d['retainedPosition'] : {};
  return `same_id_different_seq|${String(d['eventId'])}|ret=${String(retained['seq'])}:${sortUtf8(asStrings(retained['observationIds'])).join(',')}|disc=${discarded}`;
}

function sortedGaps(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return [...value].sort((a, b) => {
    const ra = isRecord(a) ? a['startSeq'] : -1;
    const rb = isRecord(b) ? b['startSeq'] : -1;
    if (ra !== rb) return (ra as number) - (rb as number);
    const ea = isRecord(a) ? a['endSeq'] : -1;
    const eb = isRecord(b) ? b['endSeq'] : -1;
    return (ea as number) - (eb as number);
  });
}

/** Treat non-array inputs as empty arrays for shape-hardened comparisons. */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Array-valued strings, ignoring non-string members. */
function asStrings(value: unknown): string[] {
  return asArray(value).filter((v): v is string => typeof v === 'string');
}

/** True when `value` is an array whose members are all plain records. */
function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

/**
 * Strict shape gate over a serialized analysis: every required array and
 * entry must be structurally well-formed or the analysis disagrees (and never
 * throws). Malformed shapes must reject rather than silently normalize.
 */
function analysisShapeIsWellFormed(b: Record<string, unknown>): boolean {
  if (!isRecordArray(b['duplicateObservations'])) return false;
  if (!isRecordArray(b['sequenceGaps'])) return false;
  if (!isRecordArray(b['validationIssues'])) return false;
  for (const d of b['duplicateObservations']) {
    if (d['classification'] === 'exact_replay') {
      if (typeof d['eventId'] !== 'string' || typeof d['seq'] !== 'number' || !Array.isArray(d['observationIds'])) return false;
    } else if (d['classification'] === 'same_id_different_seq') {
      if (!isRecord(d['retainedPosition']) || !Array.isArray(d['discardedPositions'])) return false;
      const rp = d['retainedPosition'];
      if (typeof rp['seq'] !== 'number' || !Array.isArray(rp['observationIds'])) return false;
      for (const p of d['discardedPositions']) {
        if (!isRecord(p) || !Array.isArray(p['observationIds'])) return false;
      }
    } else {
      return false;
    }
  }
  for (const g of b['sequenceGaps']) {
    if (typeof g['startSeq'] !== 'number' || typeof g['endSeq'] !== 'number') return false;
  }
  return true;
}

/**
 * Semantic analysis equality: duplicate collections compared without emission
 * order (set-like `observationIds` canonicalized), optional digests verified
 * when present, gaps by ordered (startSeq, endSeq), issues by code+path.
 * Malformed serialized shapes never throw; they simply disagree and reject.
 */
export function analysisSemanticEqual(a: unknown, b: unknown): boolean {
  if (!isRecord(a) || !isRecord(b)) return false;
  if (a['completenessDerivationAlgorithmVersion'] !== b['completenessDerivationAlgorithmVersion']) {
    return false;
  }
  if (!analysisShapeIsWellFormed(b)) return false;
  const da = asArray(a['duplicateObservations']).filter(isRecord);
  const db = asArray(b['duplicateObservations']).filter(isRecord);
  const ka = da.map(duplicateKeyNoDigest).sort();
  const kb = db.map(duplicateKeyNoDigest).sort();
  if (!jsonEqual(ka, kb)) return false;
  // When a serialized exact-replay digest is present it must match the
  // derived digest for the same event identity (§5.8 negative requirement).
  const byKeyA = new Map(da.map((d) => [duplicateKeyNoDigest(d), d]));
  for (const d of db) {
    if (d['classification'] === 'exact_replay' && d['canonicalContentDigest'] !== undefined) {
      const derivedD = byKeyA.get(duplicateKeyNoDigest(d));
      const derivedDigest = isRecord(derivedD) ? derivedD['canonicalContentDigest'] : undefined;
      if (!jsonEqual(toJsonView(d['canonicalContentDigest']), toJsonView(derivedDigest))) return false;
    }
  }
  const ga = sortedGaps(a['sequenceGaps']);
  const gb = sortedGaps(b['sequenceGaps']);
  if (ga.length !== gb.length) return false;
  for (let i = 0; i < ga.length; i++) {
    if (!jsonEqual(toJsonView(ga[i]), toJsonView(gb[i]))) return false;
  }
  const ia = asArray(a['validationIssues']).map((x) => `${String(isRecord(x) ? x['code'] : '')}|${String(isRecord(x) ? x['path'] : '')}`).sort();
  const ib = asArray(b['validationIssues']).map((x) => `${String(isRecord(x) ? x['code'] : '')}|${String(isRecord(x) ? x['path'] : '')}`).sort();
  return jsonEqual(ia, ib);
}

/** Completeness must have exact semantic equality with the derivation (§5.8). */
export function completenessExactEqual(a: unknown, b: unknown): boolean {
  return jsonEqual(toJsonView(a), toJsonView(b));
}