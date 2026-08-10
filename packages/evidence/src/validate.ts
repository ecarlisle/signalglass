/**
 * Primary entry points: `parseEvidenceRecord` and the deterministic
 * `normalizeEvidenceRecord`, plus semantic-comparison helpers that reject
 * serialized trace/analysis/completeness disagreements (Spec 014 §5.2,
 * §5.7–§5.8). `parseEvidenceRecord` never throws for malformed input; it
 * returns the single `EvidenceRecordParseResult` union.
 */
import type { ValidationIssue } from './types-analysis.js';
import type { EvidenceStructuralAnalysis } from './types-analysis.js';
import type { EvidenceRecord, CaptureBoundary, StreamingCaptureBoundary, EvidenceRecordParseResult } from './types-record.js';
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
  validateStreamingConsistency,
  issue,
} from './validate-fields.js';
import type { EvidenceObservation } from './types-trace.js';
import type { EvidenceTrace } from './types-trace.js';
import { toJsonView } from './normalize.js';
import { utf8Encode } from './hash.js';

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
  schemaVersion: string,
): { observations: EvidenceObservation[] | null; issues: ValidationIssue[] } {
  if (!Array.isArray(raw)) {
    return { observations: null, issues: [issue('raw_observations_not_array', path, 'rawObservations must be an array')] };
  }
  const issues: ValidationIssue[] = [];
  const obsIds = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    validateObservation(raw[i], `${path}[${i}]`, issues, schemaVersion);
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
  validateCaptureBoundary(captureBoundary, 'captureBoundary', issues, evidenceSchemaVersion);
  const checked = validateObservationList(rawObservations, 'rawObservations', evidenceSchemaVersion);
  issues.push(...checked.issues);
  if (issues.length > 0) return fail(issues);

  const observations = checked.observations!;
  const collapsed = collapseObservations(observations, 'rawObservations');
  if (!collapsed.ok) return fail(collapsed.issues);

  const meta = {
    evidenceSchemaVersion,
    captureProfile: captureBoundary.streaming?.captureProfile ?? options.captureProfile ?? defaultCaptureProfile(),
    captureBoundary,
    conditions: options.conditions,
  };
  const derived = deriveTrace(collapsed.events, observations, meta);
  issues.push(...derived.issues);
  if (captureBoundary.streaming) validateStreamingConsistency(derived.trace, captureBoundary.streaming, issues);
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
  if (isSchema10(evidenceSchemaVersion)) {
    const ownedPathIssue = findLegacyOwnedPath(input);
    if (ownedPathIssue) return fail([ownedPathIssue]);
  }

  // ---- Capture boundary ----
  const rawBoundary = input['captureBoundary'];
  validateCaptureBoundary(rawBoundary, 'captureBoundary', issues, evidenceSchemaVersion);
  if (issues.length > 0) return fail(issues);
  const captureBoundary = rawBoundary as CaptureBoundary;

  // ---- Raw observations ----
  const checked = validateObservationList(input['rawObservations'], 'rawObservations', evidenceSchemaVersion);
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
  if (captureBoundary.streaming) {
    validateStreamingConsistency(derived.trace, captureBoundary.streaming, issues);
    validateStreamingRecordBudgets(input, observations, derived.trace, captureBoundary.streaming, issues);
  }
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

function isSchema10(version: string): boolean {
  return Number(version.split('.')[1] ?? 0) === 0;
}

function findLegacyOwnedPath(input: Record<string, unknown>): ValidationIssue | null {
  const boundary = input['captureBoundary'];
  if (isRecord(boundary) && boundary['streaming'] !== undefined) return issue('field_not_allowed_in_schema_version', 'captureBoundary.streaming', '1.1-owned field is not allowed in schema 1.0.x');
  const completeness = input['completeness'];
  if (isRecord(completeness) && completeness['lifecycle'] !== undefined) return issue('field_not_allowed_in_schema_version', 'completeness.lifecycle', '1.1-owned field is not allowed in schema 1.0.x');
  if (isRecord(completeness) && completeness['declaredLosses'] !== undefined) return issue('field_not_allowed_in_schema_version', 'completeness.declaredLosses', '1.1-owned field is not allowed in schema 1.0.x');
  const trace = input['trace'];
  if (isRecord(trace) && trace['assembly'] !== undefined) return issue('field_not_allowed_in_schema_version', 'trace.assembly', '1.1-owned field is not allowed in schema 1.0.x');
  for (const root of [input['rawObservations'], isRecord(trace) ? trace['events'] : undefined]) {
    if (!Array.isArray(root)) continue;
    for (const entry of root) {
      if (!isRecord(entry)) continue;
      const container = 'payload' in entry && isRecord(entry['payload']) ? entry['payload'] : entry;
      if (!isRecord(container) || !isRecord(container['responseEnvelope'])) continue;
      for (const key of ['responseMeta', 'choiceIndex', 'deltaText']) if (container['responseEnvelope'][key] !== undefined) return issue('field_not_allowed_in_schema_version', `events[].responseEnvelope.${key}`, '1.1-owned field is not allowed in schema 1.0.x');
    }
  }
  return null;
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

function validateStreamingRecordBudgets(
  input: Record<string, unknown>,
  observations: readonly EvidenceObservation[],
  trace: EvidenceTrace,
  streaming: StreamingCaptureBoundary,
  issues: ValidationIssue[],
): void {
  const budgets = streaming.budgets;
  if (trace.events.length > budgets.maxCanonicalEvents) issues.push(issue('canonical_event_budget_exceeded', 'trace.events', 'canonical event count exceeds the declared budget'));
  if (observations.length > budgets.maxRawObservations) issues.push(issue('raw_observation_budget_exceeded', 'rawObservations', 'raw observation count exceeds the declared budget'));
  const rawPayloadBytes = observations.reduce((total, observation) => total + utf8Encode(JSON.stringify(toJsonView(observation.payload))).byteLength, 0);
  if (rawPayloadBytes > budgets.maxRawObservationPayloadBytes) issues.push(issue('raw_payload_budget_exceeded', 'rawObservations', 'raw observation payload bytes exceed the declared budget'));
  const retainedCodePoints = countRetainedCodePoints(trace.events);
  if (retainedCodePoints > budgets.maxRetainedContentCodePoints) issues.push(issue('retained_content_budget_exceeded', 'trace.events', 'retained content exceeds the declared code-point budget'));
  const serializedBytes = utf8Encode(JSON.stringify(toJsonView(input))).byteLength;
  if (serializedBytes > budgets.maxSerializedEvidenceBytes) issues.push(issue('serialized_evidence_budget_exceeded', '$', 'serialized evidence exceeds its declared byte budget'));
  const ids = observations.flatMap((observation) => [observation.observationId, observation.eventId, observation.traceId]);
  if (ids.some((id) => utf8Encode(id).byteLength > budgets.maxIdLengthBytes)) issues.push(issue('evidence_id_budget_exceeded', 'rawObservations', 'an evidence identifier exceeds the declared byte bound'));
}

function countRetainedCodePoints(events: readonly import('./types-event.js').EventRecord[]): number {
  let count = 0;
  const countLeaf = (leaf: unknown): void => { if (isRecord(leaf) && typeof leaf['text'] === 'string') count += [...leaf['text']].length; };
  for (const event of events) {
    if (event.kind === 'model_response_chunk' && typeof event.responseEnvelope.deltaText === 'string') count += [...event.responseEnvelope.deltaText].length;
    if (event.kind !== 'model_request' || !Array.isArray(event.requestEnvelope.messages)) continue;
    for (const message of event.requestEnvelope.messages) {
      if (!isRecord(message)) continue;
      const content = message['content'];
      if (!Array.isArray(content)) { countLeaf(content); continue; }
      for (const part of content) if (isRecord(part)) {
        if (part['kind'] === 'text') countLeaf(part['text']);
        else if (part['kind'] === 'image_url') countLeaf(part['url']);
        else if (part['kind'] === 'tool_call') countLeaf(part['arguments']);
        else if (part['kind'] === 'tool_result') countLeaf(part['content']);
      }
    }
  }
  return count;
}
