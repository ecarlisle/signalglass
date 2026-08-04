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
  const observations = [
    obs({ observationId: 'k0', eventId: 'evt-interaction-start', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
    obs({
      observationId: 'k1', eventId: 'evt-span-start', seq: 1, spanId: 'sp-1',
      kind: 'span_start', capturedAt: T1, rawCapturedAt: T1,
      payload: { span: { kind: 'model', name: 'model:claude-sonnet-4', parentSpanId: null } },
    }),
    obs({
      observationId: 'k2', eventId: 'evt-model-request', seq: 2, spanId: 'sp-1',
      kind: 'model_request', capturedAt: T2, rawCapturedAt: T2, observationRole: 'client_sent',
      payload: {
        requestEnvelope: {
          model: 'claude-sonnet-4', provider: 'anthropic',
          providerNativeFidelity: 'structurally_faithful',
          messages: [{ role: 'user', content: 'hello' }],
          providerNative: { temperature: 0.2 },
        },
        contextContributions: [
          { artifactId: 'art-1', locator: { type: 'whole' }, position: 0, provenanceState: 'recorded' },
        ],
      },
    }),
    obs({
      observationId: 'k3', eventId: 'evt-model-response', seq: 3, spanId: 'sp-1',
      kind: 'model_response', capturedAt: T3, rawCapturedAt: T3, observationRole: 'provider_reported',
      payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', finishReason: 'end_turn' } },
    }),
    obs({
      observationId: 'k4', eventId: 'evt-chunk', seq: 4, spanId: 'sp-1',
      kind: 'model_response_chunk', capturedAt: T3, rawCapturedAt: T3, observationRole: 'provider_reported',
      payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', chunkIndex: 0 } },
    }),
    obs({
      observationId: 'k5', eventId: 'evt-usage', seq: 5, spanId: 'sp-1',
      kind: 'model_usage', capturedAt: T3, rawCapturedAt: T3, observationRole: 'provider_reported',
      payload: { usage: { evidenceStatus: 'captured', inputTokens: { value: 3, evidenceStatus: 'captured' }, outputTokens: { value: 1, evidenceStatus: 'captured' } } },
    }),
    obs({
      observationId: 'k6', eventId: 'evt-tool-call', seq: 6, kind: 'tool_call',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'application_constructed',
      payload: { tool: { name: 'read_file', arguments: { path: 'x' } } },
    }),
    obs({
      observationId: 'k7', eventId: 'evt-tool-result', seq: 7, kind: 'tool_result',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'returned',
      payload: { toolResult: { stdout: 'file contents' } },
    }),
    obs({
      observationId: 'k8', eventId: 'evt-mcp-request', seq: 8, kind: 'mcp_request',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'application_constructed',
      payload: { mcp: { server: 'fs', tool: 'read', arguments: { path: 'x' } } },
    }),
    obs({
      observationId: 'k9', eventId: 'evt-mcp-result', seq: 9, kind: 'mcp_result',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'returned',
      payload: { mcpResult: { content: 'ok' } },
    }),
    obs({
      observationId: 'k10', eventId: 'evt-retrieval-request', seq: 10, kind: 'retrieval_request',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'application_constructed',
      payload: { retrieval: { query: 'q', topK: 3 } },
    }),
    obs({
      observationId: 'k11', eventId: 'evt-retrieval-result', seq: 11, kind: 'retrieval_result',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'returned',
      payload: { retrievalResult: { resultCount: 3 } },
    }),
    obs({
      observationId: 'k12', eventId: 'evt-cp-request', seq: 12, kind: 'context_provider_request',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'application_constructed',
      payload: { contextProvider: { name: 'graphify', kind: 'retrieval' } },
    }),
    obs({
      observationId: 'k13', eventId: 'evt-cp-result', seq: 13, kind: 'context_provider_result',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'returned',
      payload: { contextProvider: { name: 'graphify', kind: 'retrieval' } },
    }),
    obs({
      observationId: 'k14', eventId: 'evt-context-assembled', seq: 14, kind: 'context_assembled',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'application_constructed',
      payload: { contextContributions: [{ artifactId: 'art-1', locator: { type: 'whole' }, position: 0, provenanceState: 'recorded' }] },
    }),
    obs({
      observationId: 'k15', eventId: 'evt-error', seq: 15, kind: 'error',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'returned',
      payload: { actor: 'model', lifecycleTarget: 'none', lifecycleEffect: 'none', error: { type: 'timeout' } },
    }),
    obs({
      observationId: 'k16', eventId: 'evt-cancelled', seq: 16, kind: 'cancelled',
      capturedAt: T4, rawCapturedAt: T4, observationRole: 'application_constructed',
      payload: { lifecycleTarget: 'none', lifecycleEffect: 'cancel', cancellation: { requestedBy: 'user' } },
    }),
    obs({
      observationId: 'k17', eventId: 'evt-retry', seq: 17, kind: 'retry',
      capturedAt: T4, rawCapturedAt: T4, observationRole: 'application_constructed',
      payload: { retry: { originalRequestEventId: 'evt-model-request', errorEventId: 'evt-error', attempt: 2, observedDelayMs: 500 } },
    }),
    obs({
      observationId: 'k18', eventId: 'evt-span-end', seq: 18, spanId: 'sp-1',
      kind: 'span_end', capturedAt: T4, rawCapturedAt: T4, payload: { durationMs: 3000 },
    }),
    obs({ observationId: 'k19', eventId: 'evt-interaction-end', seq: 19, kind: 'interaction_end', capturedAt: T5, rawCapturedAt: T5 }),
  ];
  return buildRecord(observations);
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

  it('reports hashes, completeness, capture surface, and evidenceStatus loss', () => {
    const result = evidenceToLegacyTrace(buildRecord(minimalObservations()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = new Set(result.report.mappings.map((m) => m.path));
    expect(paths.has('trace.hashes')).toBe(true);
    expect(paths.has('trace.completeness')).toBe(true);
    expect(paths.has('trace.captureSurface')).toBe(true);
    expect(paths.has('trace.events[].evidenceStatus')).toBe(true);
    expect(paths.has('trace.events[].seq')).toBe(true);
    expect(paths.has('trace.events[].observationRole')).toBe(true);
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

  it('reports context contributions as unavailable loss on model_request', () => {
    const result = evidenceToLegacyTrace(allKindsRecord());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.report.mappings.some(
        (m) => m.path.endsWith('.contextContributions') && m.outcome === 'unavailable',
      ),
    ).toBe(true);
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
    expect(result.view.events.map((e) => e.id)).toEqual(['evt-req', 'evt-resp']);
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

  it('never emits a null seq or timestamp as an ordering key', () => {
    const result = evidenceToLegacyTrace(buildRecord(minimalObservations()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const seqValues = result.report.mappings.filter((m) => m.path === 'trace.events[].seq');
    expect(seqValues[0]?.outcome).toBe('partial');
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

describe('evidenceToLegacyTrace — structured failure', () => {
  it('returns ok:false with a stable code for a record without a usable trace view', () => {
    const result = evidenceToLegacyTrace({} as EvidenceRecord);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.code).toBe(PROJECTION_ISSUE_CODES.invalidEvidenceRecord);
    expect(result.issues[0]!.stage).toBe('evidence_to_legacy_trace');
    expect(result.issues[0]!.path).toBe('record');
    expect(result.issues[0]!.message.length).toBeGreaterThan(0);
  });

  it('handles a record with non-array events without throwing', () => {
    const bad = { trace: { events: 'nope' } } as unknown as EvidenceRecord;
    const result = evidenceToLegacyTrace(bad);
    expect(result.ok).toBe(false);
  });
});
