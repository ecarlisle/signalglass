/**
 * Owned-field agreement and unknown-additive-field preservation for the
 * serialized derivatives (Spec 014 §5.2, §5.3, §5.7–§5.8). `agreeTrace`,
 * `agreeAnalysis`, and `agreeCompleteness` verify that every schema-owned
 * field of the serialized derivative recomputes to the deterministic
 * derivation, ignoring unknown additive fields; the `preserve*` functions
 * then carry JSON-safe unknown fields back onto the canonical record at their
 * equivalent structural paths. Unknown fields never influence ordering,
 * collision resolution, status, completeness, hashing, or provenance — they
 * are applied only after agreement is established.
 */
import type { EvidenceTrace } from './types-trace.js';
import type { EvidenceStructuralAnalysis } from './types-analysis.js';
import type { TraceCompleteness } from './types-record.js';
import { isRecord, jsonEqual } from './internal/guards.js';
import { toJsonView, sortUtf8 } from './normalize.js';
import {
  stripUnknowns,
  preserveUnknowns,
  type NodeSpec,
} from './internal/overlay.js';

// ---------------------------------------------------------------------------
// Owned-field specifications (per structural node)
// ---------------------------------------------------------------------------

const EVENT_COMMON = [
  'eventId',
  'traceId',
  'spanId',
  'seq',
  'kind',
  'capturedAt',
  'evidenceStatus',
  'observationRole',
];

/** Kind-specific payload field names (the payload value itself is opaque). */
const EVENT_PAYLOAD_FIELDS = [
  'requestEnvelope',
  'responseEnvelope',
  'usage',
  'tool',
  'toolResult',
  'mcp',
  'mcpResult',
  'retrieval',
  'retrievalResult',
  'contextProvider',
  'contextContributions',
  'actor',
  'lifecycleTarget',
  'lifecycleEffect',
  'error',
  'cancellation',
  'retry',
];

const EVENT_SPEC: NodeSpec = {
  keys: [...EVENT_COMMON, ...EVENT_PAYLOAD_FIELDS],
};

const SPAN_SPEC: NodeSpec = {
  keys: [
    'spanId',
    'kind',
    'name',
    'parentSpanId',
    'startSeq',
    'startedAt',
    'status',
    'participants',
    'endSeq',
    'finishedAt',
    'durationMs',
  ],
};

const CONDITION_SPEC: NodeSpec = {
  keys: ['label', 'value', 'version'],
};

const TRACE_SPEC: NodeSpec = {
  keys: [
    'interactionId',
    'traceId',
    'evidenceSchemaVersion',
    'captureProfile',
    'captureSurface',
    'observationBoundary',
    'startedAt',
    'status',
    'finishedAt',
    'conditions',
    'events',
    'spans',
  ],
  children: {
    events: { kind: 'arrayById', idKey: 'eventId', spec: EVENT_SPEC },
    spans: { kind: 'arrayById', idKey: 'spanId', spec: SPAN_SPEC },
    conditions: { kind: 'array', spec: CONDITION_SPEC },
  },
};

const POSITION_SPEC: NodeSpec = {
  keys: ['seq', 'observationIds'],
};

const DISCARDED_SPEC: NodeSpec = {
  keys: ['seq', 'observationIds', 'positionIndependentlyRepresented'],
};

const DUP_SPEC: NodeSpec = {
  keys: [
    'classification',
    'eventId',
    'seq',
    'observationIds',
    'canonicalContentDigest',
    'retainedPosition',
    'discardedPositions',
    'normalizationAlgorithmVersion',
  ],
  children: {
    retainedPosition: { kind: 'object', spec: POSITION_SPEC },
    discardedPositions: { kind: 'array', spec: DISCARDED_SPEC },
  },
};

const GAP_SPEC: NodeSpec = {
  keys: ['startSeq', 'endSeq', 'adjacentRetainedEventIds'],
};

const ISSUE_SPEC: NodeSpec = {
  keys: ['code', 'path', 'message'],
};

const ANALYSIS_SPEC: NodeSpec = {
  keys: [
    'completenessDerivationAlgorithmVersion',
    'duplicateObservations',
    'sequenceGaps',
    'validationIssues',
  ],
  children: {
    duplicateObservations: {
      kind: 'arrayByKey',
      keyOf: duplicateKey,
      spec: DUP_SPEC,
    },
    // Gaps and issues are compared order-independently during agreement, so
    // preservation must align them by their complete schema-owned identity,
    // never by array position (additive fields are not part of the key).
    sequenceGaps: { kind: 'arrayByKey', keyOf: gapKey, spec: GAP_SPEC },
    validationIssues: { kind: 'arrayByKey', keyOf: issueKey, spec: ISSUE_SPEC },
  },
};

const COMPLETENESS_SPEC: NodeSpec = {
  keys: ['eventsByStatus', 'seqGaps', 'duplicatesDetected', 'boundaryStatement'],
  // `seqGaps` alignment stays positional: completeness agreement requires
  // canonical array order (a reordered serialized `seqGaps` rejects), so
  // positional overlay cannot misattach unknown fields.
  children: {
    seqGaps: { kind: 'array', spec: GAP_SPEC },
  },
};

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

function eq(a: unknown, b: unknown): boolean {
  return jsonEqual(toJsonView(a), toJsonView(b));
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** Canonical identity of a duplicate entry (no digest; set-like). */
function duplicateKey(d: Record<string, unknown>): string {
  if (d['classification'] === 'exact_replay') {
    return `exact_replay|${String(d['eventId'])}|${String(d['seq'])}|ids=${sortUtf8(asStrings(d['observationIds'])).join(',')}`;
  }
  const discarded = asArray(d['discardedPositions'])
    .map((p) =>
      `${String(toRecord(p)['seq'])}:${sortUtf8(asStrings(toRecord(p)['observationIds'])).join(',')}:${String(toRecord(p)['positionIndependentlyRepresented'])}`,
    )
    .join(';');
  const retained = toRecord(d['retainedPosition']);
  return `same_id_different_seq|${String(d['eventId'])}|ret=${String(retained['seq'])}:${sortUtf8(asStrings(retained['observationIds'])).join(',')}|disc=${discarded}`;
}

/** Semantic identity of a gap: its complete schema-owned fields. */
function gapKey(g: Record<string, unknown>): string {
  return `gap|${String(g['startSeq'])}:${String(g['endSeq'])}:${sortUtf8(asStrings(g['adjacentRetainedEventIds'])).join(',')}`;
}

/** Semantic identity of a validation issue: its complete schema-owned fields. */
function issueKey(i: Record<string, unknown>): string {
  return `issue|${String(i['code'])}:${String(i['path'])}:${String(i['message'])}`;
}

function sortedEvents(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return [...value].sort((a, b) => {
    const ra = toRecord(a)['seq'];
    const rb = toRecord(b)['seq'];
    return (ra as number) - (rb as number);
  });
}

function sortedSpans(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return [...value].sort((a, b) => {
    const ra = String(toRecord(a)['spanId']);
    const rb = String(toRecord(b)['spanId']);
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });
}

function sortedGaps(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return [...value].sort((a, b) => {
    const ra = toRecord(a)['startSeq'];
    const rb = toRecord(b)['startSeq'];
    if (ra !== rb) return (ra as number) - (rb as number);
    const ea = toRecord(a)['endSeq'];
    const eb = toRecord(b)['endSeq'];
    return (ea as number) - (eb as number);
  });
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStrings(value: unknown): string[] {
  return asArray(value).filter((v): v is string => typeof v === 'string');
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

/** Strict shape gate: malformed serialized analysis rejects, never throws. */
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

// ---------------------------------------------------------------------------
// Agreement checks (owned fields only; unknown additive fields ignored)
// ---------------------------------------------------------------------------

/** Trace agreement: events by seq, spans by spanId, conditions in order. */
export function agreeTrace(derived: unknown, serialized: unknown): boolean {
  if (!isRecord(derived) || !isRecord(serialized)) return false;
  for (const k of [
    'interactionId',
    'traceId',
    'evidenceSchemaVersion',
    'captureSurface',
    'observationBoundary',
    'startedAt',
    'status',
  ]) {
    if (!eq(derived[k], serialized[k])) return false;
  }
  if (!eq(derived['captureProfile'], serialized['captureProfile'])) return false;
  if (!eq(derived['finishedAt'], serialized['finishedAt'])) return false;

  const de = sortedEvents(derived['events']);
  const se = sortedEvents(serialized['events']);
  if (de.length !== se.length) return false;
  for (let i = 0; i < de.length; i++) {
    // Strip both sides: derived events carry unknown fields projected from
    // observation payloads, which are additive and must not decide agreement.
    if (!eq(stripUnknowns(de[i], EVENT_SPEC), stripUnknowns(se[i], EVENT_SPEC))) return false;
  }

  const ds = sortedSpans(derived['spans']);
  const ss = sortedSpans(serialized['spans']);
  if (ds.length !== ss.length) return false;
  for (let i = 0; i < ds.length; i++) {
    if (!eq(stripUnknowns(ds[i], SPAN_SPEC), stripUnknowns(ss[i], SPAN_SPEC))) return false;
  }

  const dc = derived['conditions'];
  const sc = serialized['conditions'];
  if (dc === undefined || sc === undefined) return dc === sc;
  if (!Array.isArray(dc) || !Array.isArray(sc) || dc.length !== sc.length) return false;
  for (let i = 0; i < dc.length; i++) {
    if (!eq(stripUnknowns(dc[i], CONDITION_SPEC), stripUnknowns(sc[i], CONDITION_SPEC))) return false;
  }
  return true;
}

/** Analysis agreement: shape gate, canonical duplicate key sets, digest
 * verification when serialized, ordered gaps, and issue code/path sets. */
export function agreeAnalysis(derived: unknown, serialized: unknown): boolean {
  if (!isRecord(derived) || !isRecord(serialized)) return false;
  if (derived['completenessDerivationAlgorithmVersion'] !== serialized['completenessDerivationAlgorithmVersion']) {
    return false;
  }
  if (!analysisShapeIsWellFormed(serialized)) return false;

  const da = asArray(derived['duplicateObservations']).filter(isRecord);
  const db = asArray(serialized['duplicateObservations']).filter(isRecord);
  const ka = da.map(duplicateKey).sort();
  const kb = db.map(duplicateKey).sort();
  if (!jsonEqual(ka, kb)) return false;
  // Serialized exact-replay digests must match the derived digest (§5.8).
  const byKeyA = new Map(da.map((d) => [duplicateKey(d), d]));
  for (const d of db) {
    if (d['classification'] === 'exact_replay' && d['canonicalContentDigest'] !== undefined) {
      const derivedD = byKeyA.get(duplicateKey(d));
      const derivedDigest = toRecord(derivedD)['canonicalContentDigest'];
      if (!eq(d['canonicalContentDigest'], derivedDigest)) return false;
    }
  }

  const ga = sortedGaps(derived['sequenceGaps']);
  const gb = sortedGaps(stripUnknowns(serialized['sequenceGaps'], GAP_SPEC));
  if (ga.length !== gb.length) return false;
  for (let i = 0; i < ga.length; i++) {
    if (!eq(ga[i], gb[i])) return false;
  }

  const ia = asArray(derived['validationIssues']).map((x) => `${String(toRecord(x)['code'])}|${String(toRecord(x)['path'])}`).sort();
  const ib = asArray(serialized['validationIssues']).map((x) => `${String(toRecord(x)['code'])}|${String(toRecord(x)['path'])}`).sort();
  return jsonEqual(ia, ib);
}

/** Completeness agreement: owned fields exactly, unknown fields ignored. */
export function agreeCompleteness(derived: unknown, serialized: unknown): boolean {
  if (!isRecord(derived) || !isRecord(serialized)) return false;
  return eq(derived, stripUnknowns(serialized, COMPLETENESS_SPEC));
}

// ---------------------------------------------------------------------------
// Preservation (carry unknown additive fields onto the canonical record)
// ---------------------------------------------------------------------------

/** Preserve unknown trace fields (root, spans, events, conditions). */
export function preserveTrace(
  derived: EvidenceTrace,
  serialized: unknown,
): EvidenceTrace {
  return preserveUnknowns(derived, serialized, TRACE_SPEC) as EvidenceTrace;
}

/** Preserve unknown analysis fields (root, duplicates, gaps, issues). */
export function preserveAnalysis(
  derived: EvidenceStructuralAnalysis,
  serialized: unknown,
): EvidenceStructuralAnalysis {
  return preserveUnknowns(derived, serialized, ANALYSIS_SPEC) as EvidenceStructuralAnalysis;
}

/** Preserve unknown completeness fields (root; seqGaps children). */
export function preserveCompleteness(
  derived: TraceCompleteness,
  serialized: unknown,
): TraceCompleteness {
  return preserveUnknowns(derived, serialized, COMPLETENESS_SPEC) as TraceCompleteness;
}
