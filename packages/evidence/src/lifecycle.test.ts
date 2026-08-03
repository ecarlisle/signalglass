/**
 * Tests: trace/span lifecycle status derivation and validation (Spec 014
 * §2.2.3, §4.7; Spec 013 §3.3). Status is evidence-scoped lifecycle state,
 * determined exclusively from `lifecycleTarget` / `lifecycleEffect`, never
 * from timestamps, roles, or payload text.
 */
import { describe, expect, it } from 'vitest';
import { parseEvidenceRecord, normalizeEvidenceRecord } from './validate.js';
import { serializeEvidenceRecord } from './serialize.js';
import {
  minimalObservations,
  buildBoundary,
  buildRecord,
  obs,
  T0, T1, T2, T3, T4, T5,
  PROFILE,
} from './fixtures.js';
import type { EvidenceObservation } from './types-trace.js';
import type { CaptureBoundary } from './types-record.js';

const V = '1.0.0';

function normalize(observations: EvidenceObservation[], boundary: CaptureBoundary = buildBoundary()) {
  return normalizeEvidenceRecord(observations, boundary, V, { captureProfile: PROFILE });
}

const interactionStart = () => obs({ observationId: 'o0', eventId: 'evt-i0', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 });
const spanStart = () => obs({
  observationId: 'o1', eventId: 'evt-s0', seq: 1, spanId: 'sp-1', kind: 'span_start', capturedAt: T1, rawCapturedAt: T1,
  payload: { span: { kind: 'model', name: 'model:x', parentSpanId: null } },
});

describe('trace status (§4.7)', () => {
  it('completed: interaction_end as final applicable event', () => {
    const record = buildRecord();
    expect(record.trace.status).toBe('completed');
    expect(record.trace.finishedAt).toBe(T5);
  });

  it('failed: terminal error targeting trace as final applicable event', () => {
    const observations = [
      interactionStart(), spanStart(),
      obs({ observationId: 'o2', eventId: 'evt-err', seq: 2, spanId: null, kind: 'error', capturedAt: T2, rawCapturedAt: T2, observationRole: 'provider_reported',
        payload: { actor: 'model', lifecycleTarget: 'trace', lifecycleEffect: 'fail', error: { type: 'timeout', message: 'deadline exceeded' } } }),
    ];
    const record = buildRecord(observations);
    expect(record.trace.status).toBe('failed');
    expect(record.trace.finishedAt).toBe(T2);
    expect(record.trace.finishedAt).not.toBe(undefined);
  });

  it('cancelled: terminal cancelled targeting trace as final applicable event', () => {
    const observations = [
      interactionStart(), spanStart(),
      obs({ observationId: 'o2', eventId: 'evt-cx', seq: 2, spanId: null, kind: 'cancelled', capturedAt: T2, rawCapturedAt: T2, observationRole: 'client_sent',
        payload: { lifecycleTarget: 'trace', lifecycleEffect: 'cancel', cancellation: { requestedBy: 'user' } } }),
    ];
    const record = buildRecord(observations);
    expect(record.trace.status).toBe('cancelled');
    expect(record.trace.finishedAt).toBe(T2);
  });

  it('unknown: no terminal event, no finishedAt, honest unavailability', () => {
    const observations = [
      interactionStart(), spanStart(),
      obs({ observationId: 'o2', eventId: 'evt-req', seq: 2, spanId: 'sp-1', kind: 'model_request', capturedAt: T2, rawCapturedAt: T2, observationRole: 'client_sent',
        payload: { requestEnvelope: { model: 'x', provider: 'p', providerNativeFidelity: 'structurally_faithful' } } }),
    ];
    const record = buildRecord(observations);
    expect(record.trace.status).toBe('unknown');
    expect(record.trace.finishedAt).toBeUndefined();
    // Wall-clock absence never upgrades unknown: parse/serialize keep it.
    const text = serializeEvidenceRecord(record);
    const parsed = parseEvidenceRecord(JSON.parse(text) as unknown);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.record.trace.status).toBe('unknown');
  });

  it('rejects a terminal declaration followed by interaction_end (contradiction)', () => {
    const observations = [
      interactionStart(), spanStart(),
      obs({ observationId: 'o2', eventId: 'evt-err', seq: 2, spanId: null, kind: 'error', capturedAt: T2, rawCapturedAt: T2, observationRole: 'provider_reported',
        payload: { actor: 'model', lifecycleTarget: 'trace', lifecycleEffect: 'fail', error: { type: 'timeout' } } }),
      obs({ observationId: 'o3', eventId: 'evt-iend', seq: 3, spanId: null, kind: 'interaction_end', capturedAt: T3, rawCapturedAt: T3 }),
    ];
    const res = normalize(observations);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('terminal_declaration_not_final');
  });

  it('a later interaction_end contradicts a completed status only via disagreement (not fabrication)', () => {
    const record = buildRecord();
    const bad = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    const trace = bad['trace'] as Record<string, unknown>;
    trace['status'] = 'failed';
    trace['finishedAt'] = T2;
    const res = parseEvidenceRecord(bad);
    expect(res.ok).toBe(false);
  });
});

describe('span status (§4.7)', () => {
  it('completed: span_end carries endSeq matching its seq and finishedAt', () => {
    const record = buildRecord();
    expect(record.trace.spans[0]).toMatchObject({ status: 'completed', endSeq: 4, finishedAt: T4 });
  });

  it('failed: terminal span error yields finishedAt without endSeq and never fabricates span_end', () => {
    const observations = [
      interactionStart(), spanStart(),
      obs({ observationId: 'o2', eventId: 'evt-err', seq: 2, spanId: 'sp-1', kind: 'error', capturedAt: T2, rawCapturedAt: T2, observationRole: 'provider_reported',
        payload: { actor: 'tool', lifecycleTarget: 'span', lifecycleEffect: 'fail', error: { type: 'exec_failed' } } }),
      obs({ observationId: 'o3', eventId: 'evt-iend', seq: 3, spanId: null, kind: 'interaction_end', capturedAt: T3, rawCapturedAt: T3 }),
    ];
    const record = buildRecord(observations);
    const span = record.trace.spans[0]!;
    expect(span.status).toBe('failed');
    expect(span.finishedAt).toBe(T2);
    expect(span.endSeq).toBeUndefined();
    // Child-span failure does not auto-fail the trace.
    expect(record.trace.status).toBe('completed');
  });

  it('cancelled: terminal span cancelled yields finishedAt without endSeq', () => {
    const observations = [
      interactionStart(), spanStart(),
      obs({ observationId: 'o2', eventId: 'evt-cx', seq: 2, spanId: 'sp-1', kind: 'cancelled', capturedAt: T2, rawCapturedAt: T2, observationRole: 'client_sent',
        payload: { lifecycleTarget: 'span', lifecycleEffect: 'cancel', cancellation: { requestedBy: 'user' } } }),
      obs({ observationId: 'o3', eventId: 'evt-iend', seq: 3, spanId: null, kind: 'interaction_end', capturedAt: T3, rawCapturedAt: T3 }),
    ];
    const record = buildRecord(observations);
    expect(record.trace.spans[0]).toMatchObject({ status: 'cancelled', finishedAt: T2 });
    expect(record.trace.spans[0]!.endSeq).toBeUndefined();
    expect(record.trace.status).toBe('completed');
  });

  it('unknown: span without terminal event carries no endSeq/finishedAt', () => {
    const observations = [
      interactionStart(), spanStart(),
      obs({ observationId: 'o2', eventId: 'evt-req', seq: 2, spanId: 'sp-1', kind: 'model_request', capturedAt: T2, rawCapturedAt: T2, observationRole: 'client_sent',
        payload: { requestEnvelope: { model: 'x', provider: 'p', providerNativeFidelity: 'structurally_faithful' } } }),
      obs({ observationId: 'o3', eventId: 'evt-iend', seq: 3, spanId: null, kind: 'interaction_end', capturedAt: T3, rawCapturedAt: T3 }),
    ];
    const record = buildRecord(observations);
    expect(record.trace.spans[0]).toMatchObject({ status: 'unknown' });
    expect(record.trace.spans[0]!.endSeq).toBeUndefined();
    expect(record.trace.spans[0]!.finishedAt).toBeUndefined();
    expect(record.trace.status).toBe('completed');
  });
});

describe('lifecycle targeting semantics (§2.2.3, §4.7)', () => {
  it('lifecycleTarget span requires a matching spanId', () => {
    const observations = [
      interactionStart(), spanStart(),
      obs({ observationId: 'o2', eventId: 'evt-err', seq: 2, spanId: null, kind: 'error', capturedAt: T2, rawCapturedAt: T2, observationRole: 'provider_reported',
        payload: { actor: 'model', lifecycleTarget: 'span', lifecycleEffect: 'fail', error: { type: 'x' } } }),
    ];
    const res = normalize(observations);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('target_span_requires_span');
  });

  it('lifecycleTarget trace requires spanId null', () => {
    const observations = [
      interactionStart(), spanStart(),
      obs({ observationId: 'o2', eventId: 'evt-err', seq: 2, spanId: 'sp-1', kind: 'error', capturedAt: T2, rawCapturedAt: T2, observationRole: 'provider_reported',
        payload: { actor: 'model', lifecycleTarget: 'trace', lifecycleEffect: 'fail', error: { type: 'x' } } }),
    ];
    const res = normalize(observations);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('target_trace_requires_null_span');
  });

  it('lifecycleEffect none does not set status (docs example 8: recoverable timeout)', () => {
    const observations = [
      interactionStart(), spanStart(),
      obs({ observationId: 'o2', eventId: 'evt-timeout', seq: 2, spanId: 'sp-1', kind: 'error', capturedAt: T2, rawCapturedAt: T2, observationRole: 'provider_reported',
        payload: { actor: 'model', lifecycleTarget: 'none', lifecycleEffect: 'none', error: { type: 'timeout' } } }),
      obs({ observationId: 'o3', eventId: 'evt-se', seq: 3, spanId: 'sp-1', kind: 'span_end', capturedAt: T3, rawCapturedAt: T3, payload: { durationMs: 2000 } }),
      obs({ observationId: 'o4', eventId: 'evt-cx-none', seq: 4, spanId: null, kind: 'cancelled', capturedAt: T4, rawCapturedAt: T4, observationRole: 'client_sent',
        payload: { lifecycleTarget: 'none', lifecycleEffect: 'cancel', cancellation: { requestedBy: 'user' } } }),
      obs({ observationId: 'o5', eventId: 'evt-ie', seq: 5, spanId: null, kind: 'interaction_end', capturedAt: T5, rawCapturedAt: T5 }),
    ];
    const record = buildRecord(observations);
    // The recoverable timeout changes no status; the target-none cancellation
    // is non-terminal and coherent with the later completed span and trace.
    expect(record.trace.spans[0]).toMatchObject({ status: 'completed', endSeq: 3 });
    expect(record.trace.status).toBe('completed');
    expect(record.trace.finishedAt).toBe(T5);
  });

  it('later unrelated span events do not invalidate a completed span', () => {
    const observations = [
      interactionStart(), spanStart(),
      obs({ observationId: 'o2', eventId: 'evt-se', seq: 2, spanId: 'sp-1', kind: 'span_end', capturedAt: T2, rawCapturedAt: T2, payload: { durationMs: 100 } }),
      obs({ observationId: 'o3', eventId: 'evt-s2', seq: 3, spanId: 'sp-2', kind: 'span_start', capturedAt: T3, rawCapturedAt: T3,
        payload: { span: { kind: 'tool', name: 'tool:bash', parentSpanId: 'sp-1' } } }),
      obs({ observationId: 'o4', eventId: 'evt-iend', seq: 4, spanId: null, kind: 'interaction_end', capturedAt: T4, rawCapturedAt: T4 }),
    ];
    const record = buildRecord(observations);
    const sp1 = record.trace.spans.find((s) => s.spanId === 'sp-1')!;
    expect(sp1.status).toBe('completed');
    expect(sp1.endSeq).toBe(2);
  });
});

describe('incomplete lifecycle records', () => {
  it('unknown trace and span parse and validate (no terminal events)', () => {
    const observations = [
      interactionStart(), spanStart(),
      obs({ observationId: 'o2', eventId: 'evt-req', seq: 2, spanId: 'sp-1', kind: 'model_request', capturedAt: T2, rawCapturedAt: T2, observationRole: 'client_sent',
        payload: { requestEnvelope: { model: 'x', provider: 'p', providerNativeFidelity: 'structurally_faithful' } } }),
    ];
    const record = buildRecord(observations);
    const res = parseEvidenceRecord(record as unknown);
    expect(res.ok).toBe(true);
  });

  it('completeness reports unobserved termination in the boundary statement', () => {
    const observations = [
      interactionStart(), spanStart(),
      obs({ observationId: 'o2', eventId: 'evt-req', seq: 2, spanId: 'sp-1', kind: 'model_request', capturedAt: T2, rawCapturedAt: T2, observationRole: 'client_sent',
        payload: { requestEnvelope: { model: 'x', provider: 'p', providerNativeFidelity: 'structurally_faithful' } } }),
    ];
    const boundary = buildBoundary({
      missingRecord: { reason: 'capture_ended_before_terminal_event', reportedBy: { captureSurface: 'client_side', observationBoundary: 'application_constructed' } },
    });
    const record = buildRecord(observations, boundary);
    expect(record.completeness.boundaryStatement).toContain('missing=capture_ended_before_terminal_event');
  });
});

void minimalObservations;
void T1;