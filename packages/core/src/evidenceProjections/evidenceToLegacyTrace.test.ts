/**
 * Tests: canonical evidence → legacy `Trace`/`TraceEvent` projection
 * (Spec 014 §6.1 direction 1, §6.3–§6.5, §9.1). Uses fixed, in-memory
 * authoritative `EvidenceRecord` inputs built through the public
 * `@signalglass/evidence` contract.
 */
import { describe, expect, it } from 'vitest';
import { EVENT_KINDS } from '@signalglass/evidence';
import { evidenceToLegacyTrace } from './evidenceToLegacyTrace.js';
import {
  CANONICAL_EVENT_MAPPINGS,
  CANONICAL_EVENT_KINDS_WITHOUT_LEGACY_EQUIVALENT,
  mapCanonicalEventKind,
} from './eventMapping.js';
import { EVIDENCE_TO_LEGACY_TRACE_PROJECTION_VERSION, PROJECTION_ISSUE_CODES } from './types.js';
import {
  ALL_KINDS_ERROR_MESSAGE,
  allKindsObservations,
  buildRecord,
  minimalObservations,
  obs,
  T0,
  T1,
  T2,
  T3,
  T4,
  T5,
} from './testHelpers.js';
import type { EvidenceRecord } from '@signalglass/evidence';

describe('evidenceToLegacyTrace — mapping table', () => {
  it('covers every canonical event kind exactly once', () => {
    for (const kind of EVENT_KINDS) {
      const mapped = kind in CANONICAL_EVENT_MAPPINGS;
      const omitted = CANONICAL_EVENT_KINDS_WITHOUT_LEGACY_EQUIVALENT.includes(kind);
      expect(mapped || omitted, `kind ${kind} must be mapped or omitted`).toBe(true);
      expect(mapped && omitted, `kind ${kind} must not be in both sets`).toBe(false);
      expect(mapCanonicalEventKind(kind) !== null, `mapCanonicalEventKind(${kind})`).toBe(
        mapped,
      );
    }
  });

  it('maps kinds to their documented legacy types', () => {
    expect(mapCanonicalEventKind('model_request')?.legacyType).toBe('provider_request');
    expect(mapCanonicalEventKind('model_response')?.legacyType).toBe('provider_response');
    expect(mapCanonicalEventKind('model_response_chunk')?.legacyType).toBe('provider_response');
    expect(mapCanonicalEventKind('model_usage')?.legacyType).toBe('inference');
    expect(mapCanonicalEventKind('tool_call')?.legacyType).toBe('tool_call');
    expect(mapCanonicalEventKind('tool_result')?.legacyType).toBe('tool_result');
    expect(mapCanonicalEventKind('context_assembled')?.legacyType).toBe('context');
    expect(mapCanonicalEventKind('error')?.legacyType).toBe('provider_error');
    expect(mapCanonicalEventKind('interaction_start')).toBeNull();
    expect(mapCanonicalEventKind('interaction_end')).toBeNull();
    expect(mapCanonicalEventKind('span_start')).toBeNull();
    expect(mapCanonicalEventKind('span_end')).toBeNull();
    expect(mapCanonicalEventKind('mcp_request')).toBeNull();
    expect(mapCanonicalEventKind('mcp_result')).toBeNull();
    expect(mapCanonicalEventKind('retrieval_request')).toBeNull();
    expect(mapCanonicalEventKind('retrieval_result')).toBeNull();
    expect(mapCanonicalEventKind('context_provider_request')).toBeNull();
    expect(mapCanonicalEventKind('context_provider_result')).toBeNull();
    expect(mapCanonicalEventKind('cancelled')).toBeNull();
    expect(mapCanonicalEventKind('retry')).toBeNull();
  });
});

/** A completed trace containing every canonical event kind. */
function allKindsRecord(): EvidenceRecord {
  return buildRecord(allKindsObservations());
}

describe('evidenceToLegacyTrace — trace-level mapping', () => {
  it('projects a minimal completed record into a valid legacy Trace', () => {
    const result = evidenceToLegacyTrace(buildRecord(minimalObservations()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const view = result.view;
    expect(view.id).toBe('trace-1');
    expect(view.startedAt).toBe(T0);
    expect(view.endedAt).toBe(T5);
    expect(view.status).toBe('success');
    expect(view.mode).toBe('standard');
    expect(view.provider).toBe('anthropic');
    expect(view.model).toBe('claude-sonnet-4');
    expect(view.events).toHaveLength(2); // interaction/span control omitted; request+response mapped
    expect(view.events.map((e) => e.type)).toEqual([
      'provider_request',
      'provider_response',
    ]);
  });

  it('reports exact, partial, inferred, and unavailable mappings', () => {
    const result = evidenceToLegacyTrace(buildRecord(minimalObservations()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const outcomes = new Set(result.report.mappings.map((m) => m.outcome));
    expect(outcomes.has('exact')).toBe(true);
    expect(outcomes.has('partial')).toBe(true);
    expect(outcomes.has('inferred')).toBe(true);
    expect(outcomes.has('unavailable')).toBe(true);
    expect(result.report.projectionVersion).toBe(EVIDENCE_TO_LEGACY_TRACE_PROJECTION_VERSION);
    expect(result.report.sourceSchemaVersion).toBe('1.0.0');
  });

  it('reports legacy status vocabulary loss as partial', () => {
    const result = evidenceToLegacyTrace(buildRecord(minimalObservations()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const status = result.report.mappings.find((m) => m.path === 'trace.status');
    expect(status?.outcome).toBe('partial');
    expect(status?.reason).toContain('"completed"');
  });

  it('reports agent and task as unavailable (no canonical equivalent)', () => {
    const result = evidenceToLegacyTrace(buildRecord(minimalObservations()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const agent = result.report.mappings.find((m) => m.path === 'trace.agent');
    const task = result.report.mappings.find((m) => m.path === 'trace.task');
    expect(agent?.outcome).toBe('unavailable');
    expect(task?.outcome).toBe('unavailable');
  });

  it('reports completeness, capture surface, observation boundary, and evidenceStatus loss', () => {
    const result = evidenceToLegacyTrace(buildRecord(minimalObservations()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = new Set(result.report.mappings.map((m) => m.path));
    expect(paths.has('completeness')).toBe(true);
    expect(paths.has('trace.captureSurface')).toBe(true);
    expect(paths.has('trace.observationBoundary')).toBe(true);
    expect(paths.has('trace.events[].evidenceStatus')).toBe(true);
    expect(paths.has('trace.events[].seq')).toBe(true);
    expect(paths.has('trace.events[].observationRole')).toBe(true);
    expect(paths.has('trace.hashes')).toBe(false); // not a real aggregate field
  });

  it('reports interactionId as exact (value preserved by legacy Trace.id)', () => {
    const result = evidenceToLegacyTrace(buildRecord(minimalObservations()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.id).toBe('trace-1');
    const interactionId = result.report.mappings.find((m) => m.path === 'trace.interactionId');
    expect(interactionId?.outcome).toBe('exact');
    expect(interactionId?.reason).toContain('Trace.id');
  });

  it('reports conditions and span loss only when those fields are present', () => {
    const plain = evidenceToLegacyTrace(buildRecord(minimalObservations()));
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(plain.report.mappings.some((m) => m.path === 'trace.conditions')).toBe(false);
    // minimalObservations carries one span: the aggregate span mapping is present.
    expect(plain.report.mappings.some((m) => m.path === 'trace.spans')).toBe(true);

    // A start/end-only record has no spans: no span mappings are emitted.
    const spanless = evidenceToLegacyTrace(buildRecord([
      obs({ observationId: 'n0', eventId: 'evt-start', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
      obs({ observationId: 'n1', eventId: 'evt-end', seq: 1, kind: 'interaction_end', capturedAt: T5, rawCapturedAt: T5 }),
    ]));
    expect(spanless.ok).toBe(true);
    if (!spanless.ok) return;
    expect(spanless.report.mappings.some((m) => m.path === 'trace.spans')).toBe(false);

    const record = buildRecord(
      minimalObservations(),
      undefined,
      '1.0.0',
      { conditions: [{ label: 'env', value: 'test', version: '1' }] },
    );
    const result = evidenceToLegacyTrace(record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const conditions = result.report.mappings.find((m) => m.path === 'trace.conditions');
    expect(conditions?.outcome).toBe('unavailable');
    expect(conditions?.reason).not.toContain('test'); // structural reason only, never captured values

    const spans = result.report.mappings.find((m) => m.path === 'trace.spans');
    expect(spans?.outcome).toBe('unavailable');
    const duration = result.report.mappings.find((m) => m.path === 'trace.spans[0].durationMs');
    expect(duration?.outcome).toBe('unavailable');
  });

  it('reports byte_faithful nativeContentHash loss against the real envelope field', () => {
    const record = buildRecord([
      obs({ observationId: 'h0', eventId: 'evt-interaction-start', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
      obs({
        observationId: 'h1', eventId: 'evt-span-start', seq: 1, spanId: 'sp-1',
        kind: 'span_start', capturedAt: T1, rawCapturedAt: T1,
        payload: { span: { kind: 'model', name: 'model:m', parentSpanId: null } },
      }),
      obs({
        observationId: 'h2', eventId: 'evt-req', seq: 2, spanId: 'sp-1',
        kind: 'model_request', capturedAt: T2, rawCapturedAt: T2, observationRole: 'client_sent',
        payload: {
          requestEnvelope: {
            model: 'm', provider: 'p', providerNativeFidelity: 'byte_faithful',
            nativeEncoding: 'utf-8', nativeContentType: 'application/json',
            nativeContentHash: 'sha256:' + 'a'.repeat(64),
          },
        },
      }),
      obs({
        observationId: 'h3', eventId: 'evt-resp', seq: 3, spanId: 'sp-1',
        kind: 'model_response', capturedAt: T3, rawCapturedAt: T3, observationRole: 'provider_reported',
        payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', finishReason: 'end_turn' } },
      }),
      obs({
        observationId: 'h4', eventId: 'evt-span-end', seq: 4, spanId: 'sp-1',
        kind: 'span_end', capturedAt: T4, rawCapturedAt: T4, payload: { durationMs: 3000 },
      }),
      obs({ observationId: 'h5', eventId: 'evt-interaction-end', seq: 5, kind: 'interaction_end', capturedAt: T5, rawCapturedAt: T5 }),
    ]);
    const result = evidenceToLegacyTrace(record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hash = result.report.mappings.find((m) => m.path === 'events[2].requestEnvelope.nativeContentHash');
    expect(hash?.outcome).toBe('unavailable');
    expect(hash?.reason).not.toContain('sha256'); // structural reason, never the hash value
  });

  it('reports observationRole "unobservable" as an event-specific unavailable mapping', () => {
    const result = evidenceToLegacyTrace(buildRecord([
      obs({ observationId: 'u0', eventId: 'evt-interaction-start', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
      obs({
        observationId: 'u1', eventId: 'evt-span-start', seq: 1, spanId: 'sp-1',
        kind: 'span_start', capturedAt: T1, rawCapturedAt: T1,
        payload: { span: { kind: 'model', name: 'model:m', parentSpanId: null } },
      }),
      obs({
        observationId: 'u2', eventId: 'evt-req', seq: 2, spanId: 'sp-1',
        kind: 'model_request', capturedAt: T2, rawCapturedAt: T2, observationRole: 'client_sent',
        payload: { requestEnvelope: { model: 'm', provider: 'p', providerNativeFidelity: 'structurally_faithful' } },
      }),
      obs({
        observationId: 'u3', eventId: 'evt-usage', seq: 3, spanId: 'sp-1',
        kind: 'model_usage', capturedAt: T2, rawCapturedAt: T2,
        observationRole: 'unobservable', evidenceStatus: 'unknown',
        payload: { usage: { evidenceStatus: 'unknown' } },
      }),
      obs({
        observationId: 'u4', eventId: 'evt-resp', seq: 4, spanId: 'sp-1',
        kind: 'model_response', capturedAt: T3, rawCapturedAt: T3, observationRole: 'provider_reported',
        payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', finishReason: 'end_turn' } },
      }),
      obs({
        observationId: 'u5', eventId: 'evt-span-end', seq: 5, spanId: 'sp-1',
        kind: 'span_end', capturedAt: T4, rawCapturedAt: T4, payload: { durationMs: 3000 },
      }),
      obs({ observationId: 'u6', eventId: 'evt-interaction-end', seq: 6, kind: 'interaction_end', capturedAt: T5, rawCapturedAt: T5 }),
    ]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const role = result.report.mappings.find((m) => m.path === 'events[3].observationRole');
    expect(role?.outcome).toBe('unavailable');
    expect(role?.reason).toContain('unobservable');
  });
});

describe('evidenceToLegacyTrace — event-kind mapping', () => {
  it('projects every canonical event kind to its legacy type or omits it with an unavailable mapping', () => {
    const result = evidenceToLegacyTrace(allKindsRecord());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const view = result.view;
    expect(view.events.map((e) => e.type)).toEqual([
      'provider_request',
      'provider_response',
      'provider_response',
      'inference',
      'tool_call',
      'tool_result',
      'context',
      'provider_error',
    ]);

    // Omitted kinds carry unavailable mappings; mapped kinds carry partial
    // mappings keyed by the canonical kind name (paths use canonical event
    // indices, not view indices, because omitted events are skipped).
    for (const [kind] of Object.entries(CANONICAL_EVENT_MAPPINGS)) {
      const m = result.report.mappings.find(
        (x) => x.outcome === 'partial' && x.reason.includes(`kind "${kind}"`),
      );
      expect(m, `expected a partial mapping for ${kind}`).toBeDefined();
    }
    const omitted = CANONICAL_EVENT_KINDS_WITHOUT_LEGACY_EQUIVALENT;
    const omittedMappings = result.report.mappings.filter(
      (m) => m.outcome === 'unavailable' && m.stage === 'evidence_to_legacy_trace',
    );
    for (const kind of omitted) {
      expect(
        omittedMappings.some((m) => m.reason.includes(`"${kind}"`)),
        `expected an unavailable mapping mentioning ${kind}`,
      ).toBe(true);
    }
  });

  it('approximates observation roles with ContentPhase and reports partial', () => {
    const result = evidenceToLegacyTrace(allKindsRecord());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const phases = result.view.events.map((e) => e.contentPhase);
    expect(phases).toEqual([
      'sent',       // client_sent
      'observed',   // provider_reported
      'observed',   // provider_reported
      'observed',   // provider_reported
      'transformed',// application_constructed
      'returned',   // returned
      'transformed',// application_constructed
      'returned',   // returned
    ]);
    for (const m of result.report.mappings) {
      if (m.outcome === 'partial' && m.path.startsWith('events[')) {
        expect(m.reason).toContain('ContentPhase');
      }
    }
  });

  it('reports context contributions as unavailable loss on model_request and context_assembled', () => {
    // The all-kinds fixture carries contributions on both kinds that can
    // express them: model_request (events[2]) and context_assembled
    // (events[14]). Both must produce an unavailable mapping at their exact
    // event path — neither may disappear silently.
    const result = evidenceToLegacyTrace(allKindsRecord());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const contributionPaths = result.report.mappings
      .filter((m) => m.path.endsWith('.contextContributions'))
      .map((m) => m.path)
      .sort();
    expect(contributionPaths).toEqual([
      'events[14].contextContributions',
      'events[2].contextContributions',
    ]);
    for (const m of result.report.mappings) {
      if (!m.path.endsWith('.contextContributions')) continue;
      expect(m.outcome).toBe('unavailable');
      expect(m.reason).toContain('context-contribution');
      // Structural reason only: no artifact ids, locators, positions, or
      // provenance states are echoed.
      expect(m.reason).not.toContain('art-1');
      expect(m.reason).not.toContain('whole');
    }
  });

  it('does not report context contributions when no event carries the field', () => {
    // The minimal fixture has neither model_request nor context_assembled
    // contributions; an absent field must not produce a mapping.
    const result = evidenceToLegacyTrace(buildRecord(minimalObservations()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.report.mappings.some((m) => m.path.endsWith('.contextContributions')),
    ).toBe(false);
  });

  it('reports an empty contextContributions array as present on context_assembled', () => {
    // `contextContributions: []` is a present field (an empty contribution
    // list), so the mapping is emitted — matching model_request semantics.
    const record = buildRecord([
      obs({ observationId: 'e0', eventId: 'evt-start', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
      obs({
        observationId: 'e1', eventId: 'evt-ctx', seq: 1, kind: 'context_assembled',
        capturedAt: T1, rawCapturedAt: T1, observationRole: 'application_constructed',
        payload: { contextContributions: [] },
      }),
      obs({ observationId: 'e2', eventId: 'evt-end', seq: 2, kind: 'interaction_end', capturedAt: T2, rawCapturedAt: T2 }),
    ]);
    const result = evidenceToLegacyTrace(record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.report.mappings.some(
        (m) => m.path === 'events[1].contextContributions' && m.outcome === 'unavailable',
      ),
    ).toBe(true);
  });

  it('emits one legacy provider_response per canonical chunk (no aggregation)', () => {
    const CHUNK_BODY = 'chunk-native-body-should-not-leak';
    const record = buildRecord([
      obs({ observationId: 'c0', eventId: 'evt-start', seq: 0, kind: 'interaction_start', capturedAt: T0 }),
      obs({ observationId: 'c1', eventId: 'evt-req', seq: 1, kind: 'model_request', capturedAt: T1, observationRole: 'client_sent', payload: { requestEnvelope: { model: 'm', provider: 'p', providerNativeFidelity: 'structurally_faithful' } } }),
      obs({ observationId: 'c2', eventId: 'evt-chunk-0', seq: 2, kind: 'model_response_chunk', capturedAt: T2, observationRole: 'provider_reported', payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', chunkIndex: 0, providerNative: { text: CHUNK_BODY } } } }),
      obs({ observationId: 'c3', eventId: 'evt-chunk-1', seq: 3, kind: 'model_response_chunk', capturedAt: T3, observationRole: 'provider_reported', payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', chunkIndex: 1, providerNative: { text: CHUNK_BODY } } } }),
      obs({ observationId: 'c4', eventId: 'evt-chunk-2', seq: 4, kind: 'model_response_chunk', capturedAt: T3, observationRole: 'provider_reported', payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', chunkIndex: 2, providerNative: { text: CHUNK_BODY } } } }),
      obs({ observationId: 'c5', eventId: 'evt-end', seq: 5, kind: 'interaction_end', capturedAt: T3 }),
    ]);
    const result = evidenceToLegacyTrace(record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // One legacy event per chunk, each `provider_response`, ordered by seq.
    const chunkEvents = result.view.events.filter((e) => e.type === 'provider_response');
    expect(chunkEvents).toHaveLength(3);
    expect(result.view.events.map((e) => e.id)).toEqual([
      'evt-req',
      'evt-chunk-0',
      'evt-chunk-1',
      'evt-chunk-2',
    ]);
    // No aggregation occurred: total projected events include all three chunks.
    expect(result.view.events).toHaveLength(4);
    // Chunk payload/native content never appears in the legacy view.
    expect(JSON.stringify(result.view)).not.toContain(CHUNK_BODY);
    for (const event of result.view.events) {
      expect(event.payloadRef).toBeUndefined();
      expect(event.metadata).toBeUndefined();
    }
  });

  it('preserves seq ordering over equal timestamps', () => {
    const record = buildRecord([
      obs({ observationId: 's0', eventId: 'evt-start', seq: 0, kind: 'interaction_start', capturedAt: T0 }),
      // Equal timestamps, distinct seq — ordering must follow seq, not time.
      obs({ observationId: 's1', eventId: 'evt-req', seq: 1, kind: 'model_request', capturedAt: T3, observationRole: 'client_sent', payload: { requestEnvelope: { model: 'm', provider: 'p', providerNativeFidelity: 'structurally_faithful' } } }),
      obs({ observationId: 's2', eventId: 'evt-resp', seq: 2, kind: 'model_response', capturedAt: T3, observationRole: 'provider_reported', payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful' } } }),
      obs({ observationId: 's3', eventId: 'evt-end', seq: 3, kind: 'interaction_end', capturedAt: T3 }),
    ]);
    const result = evidenceToLegacyTrace(record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Projected order follows canonical seq, and every projected event carries
    // a string timestamp (ordering is never emitted as a null/undefined key).
    expect(result.view.events.map((e) => e.id)).toEqual(['evt-req', 'evt-resp']);
    for (const event of result.view.events) {
      expect(typeof event.timestamp).toBe('string');
      expect(event.timestamp.length).toBeGreaterThan(0);
    }
  });
});

describe('evidenceToLegacyTrace — determinism and immutability', () => {
  it('produces deeply equal views and reports across repeated calls', () => {
    const record = buildRecord(minimalObservations());
    const first = evidenceToLegacyTrace(record);
    const second = evidenceToLegacyTrace(record);
    expect(first).toEqual(second);
  });

  it('does not mutate the input record', () => {
    const record = buildRecord(minimalObservations());
    const snapshot = JSON.stringify(record);
    evidenceToLegacyTrace(record);
    evidenceToLegacyTrace(record);
    expect(JSON.stringify(record)).toBe(snapshot);
    // The derived trace view and observations arrays are untouched.
    expect(record.trace.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('reports the canonical seq ordering restriction as partial loss', () => {
    const result = evidenceToLegacyTrace(buildRecord(minimalObservations()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The legacy Trace has no seq field; canonical seq ordering is preserved by
    // event order and the loss is reported (never a null ordering key).
    const seqValues = result.report.mappings.filter((m) => m.path === 'trace.events[].seq');
    expect(seqValues[0]?.outcome).toBe('partial');
    expect(seqValues[0]?.reason).toContain('seq');
  });
});

describe('evidenceToLegacyTrace — redacted/missing/unknown and safety', () => {
  const SECRET = 'sk-secret-abc123';
  const NATIVE_TEXT = 'provider-native-body-should-not-leak';

  function mixedStatusRecord(): EvidenceRecord {
    const observations = [
      obs({ observationId: 'm0', eventId: 'evt-start', seq: 0, kind: 'interaction_start', capturedAt: T0 }),
      obs({
        observationId: 'm1', eventId: 'evt-redacted', seq: 1, kind: 'model_request',
        capturedAt: T1, observationRole: 'client_sent', evidenceStatus: 'redacted',
        payload: {
          redaction: { policy: 'standard', reasons: ['sensitive'] },
          requestEnvelope: {
            model: 'm', provider: 'p', providerNativeFidelity: 'structurally_faithful',
            providerNative: { apiKey: SECRET, text: NATIVE_TEXT },
          },
        },
      }),
      obs({
        observationId: 'm2', eventId: 'evt-missing', seq: 2, kind: 'model_response',
        capturedAt: T2, observationRole: 'returned', evidenceStatus: 'missing',
        payload: {
          missing: { reason: 'not captured at boundary', reportedBy: { captureSurface: 'client_side', observationBoundary: 'application_constructed' } },
          responseEnvelope: { providerNativeFidelity: 'structurally_faithful', providerNative: { text: NATIVE_TEXT } },
        },
      }),
      obs({
        observationId: 'm3', eventId: 'evt-unknown', seq: 3, kind: 'model_usage',
        capturedAt: T2, observationRole: 'unobservable', evidenceStatus: 'unknown',
        payload: { usage: { evidenceStatus: 'unknown' } },
      }),
      obs({
        observationId: 'm4', eventId: 'evt-truncated', seq: 4, kind: 'tool_result',
        capturedAt: T2, observationRole: 'returned', evidenceStatus: 'truncated',
        payload: { truncation: { maxLength: 100, originalLength: 5000 }, toolResult: { stdout: NATIVE_TEXT } },
      }),
      obs({ observationId: 'm5', eventId: 'evt-end', seq: 5, kind: 'interaction_end', capturedAt: T3 }),
    ];
    return buildRecord(observations);
  }

  it('never turns redacted/missing/unknown evidence into content', () => {
    const result = evidenceToLegacyTrace(mixedStatusRecord());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Mapped events (model_request redacted, model_response missing, model_usage
    // unknown, tool_result truncated) carry no content excerpts or payloadRefs.
    for (const event of result.view.events) {
      expect(event.payloadRef).toBeUndefined();
      expect(event.metadata).toBeUndefined();
    }
  });

  it('does not leak secrets or provider-native bodies into the legacy view', () => {
    const result = evidenceToLegacyTrace(mixedStatusRecord());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.view);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(NATIVE_TEXT);
    expect(serialized).not.toContain('apiKey');
  });

  it('reports unavailable mappings for redacted/missing/unknown kinds without fabricating content', () => {
    const result = evidenceToLegacyTrace(mixedStatusRecord());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const unavailable = result.report.mappings.filter((m) => m.outcome === 'unavailable');
    expect(unavailable.length).toBeGreaterThan(0);
    for (const m of unavailable) {
      expect(m.reason).not.toContain(SECRET);
      expect(m.reason).not.toContain(NATIVE_TEXT);
    }
  });
});

describe('evidenceToLegacyTrace — structured failure (authoritative validation)', () => {
  it('returns ok:false for a non-object record with a stable code', () => {
    const result = evidenceToLegacyTrace(null as unknown as EvidenceRecord);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]!.stage).toBe('evidence_to_legacy_trace');
    expect(result.issues[0]!.message.length).toBeGreaterThan(0);
  });

  it('rejects an unsupported evidence schema version', () => {
    const record = buildRecord(minimalObservations());
    const bad = { ...record, evidenceSchemaVersion: '2.0.0' } as EvidenceRecord;
    const result = evidenceToLegacyTrace(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some((i) => i.code === PROJECTION_ISSUE_CODES.unsupportedSchemaVersion),
    ).toBe(true);
  });

  it('rejects an invalid canonical event (unknown kind) via the authoritative validator', () => {
    const record = buildRecord(minimalObservations());
    // Deliberately inject an observation shape the validator must reject.
    const bad = {
      ...record,
      rawObservations: [
        {
          ...record.rawObservations[0]!,
          kind: 'not_a_real_kind',
          payload: null,
        },
      ],
    } as unknown as EvidenceRecord;
    const result = evidenceToLegacyTrace(bad);
    expect(result.ok).toBe(false);
  });

  it('rejects a serialized trace that disagrees with its authoritative observations', () => {
    const record = buildRecord(minimalObservations());
    // Serialized trace claims a different interactionId than the observations derive.
    const bad = {
      ...record,
      trace: { ...record.trace, interactionId: 'different-trace-id' },
    } as EvidenceRecord;
    const result = evidenceToLegacyTrace(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some((i) => i.code === PROJECTION_ISSUE_CODES.traceDerivationConflict),
    ).toBe(true);
  });

  it('rejects a lifecycle-invalid record (terminal status lacking required terminal evidence)', () => {
    const record = buildRecord(minimalObservations());
    // Serialized trace declares status "completed"/finishedAt but the
    // observations provide no interaction_end terminal evidence, so the
    // derived lifecycle does not match (a derivation conflict).
    const bad = {
      ...record,
      trace: {
        ...record.trace,
        status: 'completed',
        finishedAt: record.trace.finishedAt,
      },
      rawObservations: record.rawObservations.filter(
        (o) => o.kind !== 'interaction_end',
      ),
    } as EvidenceRecord;
    const result = evidenceToLegacyTrace(bad);
    expect(result.ok).toBe(false);
  });

  it('validates the complete authoritative record: parseEvidenceRecord is the entry gate', () => {
    const record = buildRecord(minimalObservations());
    // A valid record stays valid.
    expect(evidenceToLegacyTrace(record).ok).toBe(true);
    // A record missing analysis/completeness derivations is rejected.
    const stripped = {
      rawObservations: record.rawObservations,
      trace: record.trace,
      evidenceSchemaVersion: '1.0.0',
      captureBoundary: record.captureBoundary,
    } as EvidenceRecord;
    expect(evidenceToLegacyTrace(stripped).ok).toBe(false);
  });
});

describe('evidenceToLegacyTrace — field-level loss mappings (present fields only)', () => {
  const NATIVE_HASH = 'sha256:' + 'a'.repeat(64);
  const DECL_SENTINELS = ['secrets-v1', 'authorization-header', 'capture_failed', 'client_side', '100', '5000'];

  /** Byte-faithful request/response record carrying every optional envelope field. */
  function fullEnvelopeRecord(): EvidenceRecord {
    return buildRecord([
      obs({ observationId: 'f0', eventId: 'evt-start', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
      obs({
        observationId: 'f1', eventId: 'evt-req', seq: 1, kind: 'model_request',
        capturedAt: T1, rawCapturedAt: T1, observationRole: 'client_sent', evidenceStatus: 'captured',
        payload: {
          requestEnvelope: {
            model: 'm', provider: 'p', providerNativeFidelity: 'byte_faithful',
            messages: [{ role: 'user', content: 'hello' }],
            providerNative: { text: 'request-body' },
            nativeEncoding: 'utf-8', nativeContentType: 'application/json',
            nativeContentHash: NATIVE_HASH,
          },
        },
      }),
      obs({
        observationId: 'f2', eventId: 'evt-resp', seq: 2, kind: 'model_response',
        capturedAt: T2, rawCapturedAt: T2, observationRole: 'provider_reported',
        payload: {
          responseEnvelope: {
            providerNativeFidelity: 'structurally_faithful',
            finishReason: 'end_turn',
            providerNative: { text: 'response-body' },
            usage: { evidenceStatus: 'captured', inputTokens: { value: 4, evidenceStatus: 'captured' } },
            chunkIndex: 0,
          },
        },
      }),
      obs({ observationId: 'f3', eventId: 'evt-end', seq: 3, kind: 'interaction_end', capturedAt: T3, rawCapturedAt: T3 }),
    ]);
  }

  it('reports every present request-envelope field as unavailable with a structural reason', () => {
    const result = evidenceToLegacyTrace(fullEnvelopeRecord());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byPath = new Map(result.report.mappings.map((m) => [m.path, m]));
    const expected = [
      'events[1].requestEnvelope.providerNativeFidelity',
      'events[1].requestEnvelope.messages',
      'events[1].requestEnvelope.providerNative',
      'events[1].requestEnvelope.nativeEncoding',
      'events[1].requestEnvelope.nativeContentType',
      'events[1].requestEnvelope.nativeContentHash',
    ];
    for (const path of expected) {
      const mapping = byPath.get(path);
      expect(mapping, `mapping for ${path} must exist`).toBeDefined();
      expect(mapping!.stage).toBe('evidence_to_legacy_trace');
      expect(mapping!.outcome).toBe('unavailable');
      expect(mapping!.reason.length).toBeGreaterThan(10);
      expect(mapping!.reason).not.toContain('hello');
      expect(mapping!.reason).not.toContain('request-body');
      expect(mapping!.reason).not.toContain(NATIVE_HASH);
    }
  });

  it('reports every present response-envelope field as unavailable with a structural reason', () => {
    const result = evidenceToLegacyTrace(fullEnvelopeRecord());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byPath = new Map(result.report.mappings.map((m) => [m.path, m]));
    const expected = [
      'events[2].responseEnvelope.providerNativeFidelity',
      'events[2].responseEnvelope.finishReason',
      'events[2].responseEnvelope.providerNative',
      'events[2].responseEnvelope.usage',
      'events[2].responseEnvelope.chunkIndex',
    ];
    for (const path of expected) {
      const mapping = byPath.get(path);
      expect(mapping, `mapping for ${path} must exist`).toBeDefined();
      expect(mapping!.stage).toBe('evidence_to_legacy_trace');
      expect(mapping!.outcome).toBe('unavailable');
      expect(mapping!.reason).not.toContain('end_turn');
      expect(mapping!.reason).not.toContain('response-body');
    }
  });

  it('emits no envelope-field mappings for optional fields the record does not carry', () => {
    // minimalObservations: the request has messages+providerNative but no
    // native byte fields; the response has finishReason+providerNative but no
    // usage, chunkIndex, or native byte fields. Absent fields must produce no
    // presence mapping — the report only declares losses it can substantiate.
    const result = evidenceToLegacyTrace(buildRecord(minimalObservations()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = new Set(result.report.mappings.map((m) => m.path));
    expect(paths.has('events[2].requestEnvelope.nativeEncoding')).toBe(false);
    expect(paths.has('events[2].requestEnvelope.nativeContentType')).toBe(false);
    expect(paths.has('events[2].requestEnvelope.nativeContentHash')).toBe(false);
    expect(paths.has('events[3].responseEnvelope.usage')).toBe(false);
    expect(paths.has('events[3].responseEnvelope.chunkIndex')).toBe(false);
    expect(paths.has('events[3].responseEnvelope.nativeContentHash')).toBe(false);
    // Present fields still get their mappings.
    expect(paths.has('events[2].requestEnvelope.messages')).toBe(true);
    expect(paths.has('events[2].requestEnvelope.providerNative')).toBe(true);
    expect(paths.has('events[3].responseEnvelope.finishReason')).toBe(true);
    expect(paths.has('events[3].responseEnvelope.providerNative')).toBe(true);
  });

  it('reports the usage record and only the token fields actually present', () => {
    const result = evidenceToLegacyTrace(buildRecord(allKindsObservations()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byPath = new Map(result.report.mappings.map((m) => [m.path, m]));
    // all-kinds model_usage (events[5]) carries input/output/total tokens.
    expect(byPath.get('events[5].usage.evidenceStatus')?.outcome).toBe('unavailable');
    expect(byPath.get('events[5].usage.inputTokens')?.outcome).toBe('unavailable');
    expect(byPath.get('events[5].usage.outputTokens')?.outcome).toBe('unavailable');
    expect(byPath.get('events[5].usage.totalTokens')?.outcome).toBe('unavailable');
    for (const m of result.report.mappings.filter((x) => x.path.includes('usage'))) {
      expect(m.reason).not.toContain('3');
      expect(m.reason).not.toContain('1');
      expect(m.reason).not.toContain('4');
    }

    // A usage record carrying only evidenceStatus produces no token mappings.
    const bare = evidenceToLegacyTrace(buildRecord([
      obs({ observationId: 'u0', eventId: 'evt-start', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
      obs({
        observationId: 'u1', eventId: 'evt-usage', seq: 1, kind: 'model_usage',
        capturedAt: T1, rawCapturedAt: T1, observationRole: 'provider_reported',
        payload: { usage: { evidenceStatus: 'captured' } },
      }),
      obs({ observationId: 'u2', eventId: 'evt-end', seq: 2, kind: 'interaction_end', capturedAt: T2, rawCapturedAt: T2 }),
    ]));
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    const barePaths = new Set(bare.report.mappings.map((m) => m.path));
    expect(barePaths.has('events[1].usage.evidenceStatus')).toBe(true);
    expect(barePaths.has('events[1].usage.inputTokens')).toBe(false);
    expect(barePaths.has('events[1].usage.outputTokens')).toBe(false);
    expect(barePaths.has('events[1].usage.totalTokens')).toBe(false);
  });

  it('reports every error-event field as unavailable with a structural reason', () => {
    // all-kinds carries the error event at events[15] with actor,
    // lifecycleTarget, lifecycleEffect, and an error payload whose message
    // is a sentinel that must never reach the view or any mapping reason.
    const result = evidenceToLegacyTrace(buildRecord(allKindsObservations()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byPath = new Map(result.report.mappings.map((m) => [m.path, m]));
    for (const path of [
      'events[15].actor',
      'events[15].lifecycleTarget',
      'events[15].lifecycleEffect',
      'events[15].error',
    ]) {
      const mapping = byPath.get(path);
      expect(mapping, `mapping for ${path} must exist`).toBeDefined();
      expect(mapping!.stage).toBe('evidence_to_legacy_trace');
      expect(mapping!.outcome).toBe('unavailable');
      expect(mapping!.reason.length).toBeGreaterThan(10);
    }
    // Structural reasons only: no error type, message, actor value, or
    // lifecycle vocabulary value is echoed, and the sentinel message never
    // reaches the projected view or the report.
    for (const m of result.report.mappings) {
      expect(m.reason).not.toContain('timeout');
      expect(m.reason).not.toContain(ALL_KINDS_ERROR_MESSAGE);
    }
    const serialized = JSON.stringify(result.view);
    expect(serialized).not.toContain('timeout');
    expect(serialized).not.toContain(ALL_KINDS_ERROR_MESSAGE);
  });

  it('emits no error-field mappings for events that are not error events', () => {
    // The minimal fixture has no error event; cancelled/retry (all-kinds)
    // carry lifecycle fields but must not receive error-field mappings.
    const result = evidenceToLegacyTrace(buildRecord(allKindsObservations()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = new Set(result.report.mappings.map((m) => m.path));
    expect(paths.has('events[16].lifecycleTarget')).toBe(false); // cancelled
    expect(paths.has('events[16].lifecycleEffect')).toBe(false);
    expect(paths.has('events[17].error')).toBe(false); // retry
    for (const m of result.report.mappings) {
      expect(m.path).not.toBe('events[2].actor');
      expect(m.path).not.toBe('events[3].error');
    }
  });

  it('reports raw missing/redaction/truncation declarations without echoing declaration values', () => {
    const observations = [
      obs({ observationId: 'd0', eventId: 'evt-start', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
      obs({
        observationId: 'd1', eventId: 'evt-redacted', seq: 1, kind: 'model_request',
        capturedAt: T1, rawCapturedAt: T1, observationRole: 'client_sent', evidenceStatus: 'redacted',
        payload: {
          redaction: { policy: 'secrets-v1', reasons: ['authorization-header'] },
          requestEnvelope: { model: 'm', provider: 'p', providerNativeFidelity: 'structurally_faithful' },
        },
      }),
      obs({
        observationId: 'd2', eventId: 'evt-missing', seq: 2, kind: 'model_response',
        capturedAt: T2, rawCapturedAt: T2, observationRole: 'returned', evidenceStatus: 'missing',
        payload: {
          missing: { reason: 'capture_failed', reportedBy: { captureSurface: 'client_side', observationBoundary: 'returned' } },
          responseEnvelope: { providerNativeFidelity: 'structurally_faithful' },
        },
      }),
      obs({
        observationId: 'd3', eventId: 'evt-truncated', seq: 3, kind: 'tool_result',
        capturedAt: T2, rawCapturedAt: T2, observationRole: 'returned', evidenceStatus: 'truncated',
        payload: { truncation: { maxLength: 100, originalLength: 5000 }, toolResult: { stdout: 'x' } },
      }),
      obs({ observationId: 'd4', eventId: 'evt-end', seq: 4, kind: 'interaction_end', capturedAt: T3, rawCapturedAt: T3 }),
    ];
    const result = evidenceToLegacyTrace(buildRecord(observations));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byPath = new Map(result.report.mappings.map((m) => [m.path, m]));
    expect(byPath.get('rawObservations[1].payload.redaction')?.outcome).toBe('unavailable');
    expect(byPath.get('rawObservations[2].payload.missing')?.outcome).toBe('unavailable');
    expect(byPath.get('rawObservations[3].payload.truncation')?.outcome).toBe('unavailable');
    for (const m of result.report.mappings) {
      for (const sentinel of DECL_SENTINELS) {
        expect(m.reason, `declaration value "${sentinel}" must never appear in a reason`).not.toContain(sentinel);
      }
    }
    const serialized = JSON.stringify(result.view);
    expect(serialized).not.toContain('authorization-header');
    expect(serialized).not.toContain('capture_failed');
  });
});
