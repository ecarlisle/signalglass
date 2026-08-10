import { describe, expect, it } from 'vitest';
import type { EvidenceObservation } from './types-trace.js';
import type { CaptureBoundary, StreamingCaptureBoundary } from './types-record.js';
import { normalizeEvidenceRecord, parseEvidenceRecord } from './validate.js';
import { serializeEvidenceRecord } from './serialize.js';
import { obs, T0, T1, T2, T3, T4, T5 } from './fixtures.js';

function streamingBoundary(overrides: Partial<StreamingCaptureBoundary> = {}): CaptureBoundary {
  const streaming: StreamingCaptureBoundary = {
    upstream: { outcome: 'response-completed' },
    clientResponse: { outcome: 'flushed' },
    decoderDisposition: 'openai-sse',
    remainder: { knowledge: 'protocol-terminal-observed', lastObservedFramePosition: 2, rawForwardedBytes: 64 },
    losses: {
      requestBody: 'fully-observed-not-retained', messageContent: 'fully-retained', deltaContent: 'fully-retained',
      providerNative: 'not-retained', providerErrorBody: 'not-applicable', wireBytes: 'not-retained',
      postTerminalContent: 'none-observed', unmappedDeltaFields: [], unrecognizedExtensionFrameObserved: false,
      headerValuesBeyondAllowlist: false, contentTypeParametersDropped: false, maskedContent: false,
      contentEncodingUnsupported: false, multimodalContentObserved: false,
      requestMessageUnknownKeysObserved: false, unrecognizedRoleObserved: false,
      sseMetadataObservedButNotRetained: false,
    },
    assembly: {
      assembler: { name: 'signalglass.streaming.assembler', version: '1.0.0' },
      decoderContract: { name: 'signalglass.providers.openai-sse', version: '1.0.0' },
    },
    captureProfile: { name: 'signalglass.collection.ingress-metadata-safe', version: '1.0.0' },
    detector: { name: 'signalglass.collection.sensitive-detector', version: '1.0.0' },
    budgets: {
      maxCanonicalEvents: 1_000, maxRawObservations: 2_000, maxRawObservationPayloadBytes: 1_048_576,
      maxRetainedContentCodePoints: 16_384, maxSerializedEvidenceBytes: 1_048_576, maxIdLengthBytes: 128,
    },
    ...overrides,
  };
  return {
    captureSurface: 'ingress_proxy', observationBoundary: 'provider_reported',
    declaredEventKinds: ['interaction_start', 'span_start', 'model_request', 'model_response', 'model_response_chunk', 'span_end', 'interaction_end'],
    declaredSurfaces: ['ingress_proxy'], missingRecord: null, streaming,
  };
}

function observations(leaf: unknown = { text: 'hello', evidenceStatus: 'captured' }): EvidenceObservation[] {
  return [
    obs({ observationId: 's0', eventId: 'se0', traceId: 'stream-trace', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
    obs({ observationId: 's1', eventId: 'se1', traceId: 'stream-trace', seq: 1, spanId: 'stream-span', kind: 'span_start', capturedAt: T1, rawCapturedAt: T1, payload: { span: { kind: 'model', name: 'model:test', parentSpanId: null } } }),
    obs({ observationId: 's2', eventId: 'se2', traceId: 'stream-trace', seq: 2, spanId: 'stream-span', kind: 'model_request', capturedAt: T2, rawCapturedAt: T2, observationRole: 'client_sent', payload: { requestEnvelope: { model: 'test', provider: 'openai-compatible', providerNativeFidelity: 'structurally_faithful', messages: [{ role: 'user', content: leaf }] } } }),
    obs({ observationId: 's3', eventId: 'se3', traceId: 'stream-trace', seq: 3, spanId: 'stream-span', kind: 'model_response', capturedAt: T3, rawCapturedAt: T3, observationRole: 'provider_reported', payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', responseMeta: { statusCode: 200, contentType: 'text/event-stream' } } } }),
    obs({ observationId: 's4', eventId: 'se4', traceId: 'stream-trace', seq: 4, spanId: 'stream-span', kind: 'model_response_chunk', capturedAt: T3, rawCapturedAt: T3, observationRole: 'provider_reported', payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', choiceIndex: 0, chunkIndex: 0, deltaText: 'world', finishReason: 'stop' } } }),
    obs({ observationId: 's5', eventId: 'se5', traceId: 'stream-trace', seq: 5, spanId: 'stream-span', kind: 'span_end', capturedAt: T4, rawCapturedAt: T4, payload: { durationMs: 3000 } }),
    obs({ observationId: 's6', eventId: 'se6', traceId: 'stream-trace', seq: 6, kind: 'interaction_end', capturedAt: T5, rawCapturedAt: T5 }),
  ];
}

function record(version = '1.1.0', boundary = streamingBoundary(), source = observations()) {
  const result = normalizeEvidenceRecord(source, boundary, version);
  if (!result.ok) throw new Error(result.issues.map((issue) => `${issue.code}:${issue.path}`).join(';'));
  return result.record;
}

function jsonRecord() { return JSON.parse(serializeEvidenceRecord(record())) as Record<string, unknown>; }
function mutate(input: Record<string, unknown>, fn: (value: Record<string, unknown>) => void) { const value = structuredClone(input); fn(value); return parseEvidenceRecord(value); }

describe('Spec 016 S1 schema foundation', () => {
  it('T102 serializes all seven 1.1 paths exactly', () => {
    const value = jsonRecord();
    const trace = value['trace'] as Record<string, unknown>;
    const completeness = value['completeness'] as Record<string, unknown>;
    const events = trace['events'] as Array<Record<string, unknown>>;
    const response = events.find((event) => event['kind'] === 'model_response')!['responseEnvelope'] as Record<string, unknown>;
    const chunk = events.find((event) => event['kind'] === 'model_response_chunk')!['responseEnvelope'] as Record<string, unknown>;
    expect((value['captureBoundary'] as Record<string, unknown>)['streaming']).toBeDefined();
    expect(((value['captureBoundary'] as any).streaming).observationTerminal).toBeUndefined();
    expect(completeness['lifecycle']).toBeDefined();
    expect(completeness['declaredLosses']).toEqual(['request-body-not-retained', 'provider-native-not-retained', 'wire-bytes-not-retained', 'provider-usage-absent']);
    expect(trace['assembly']).toEqual((value['captureBoundary'] as Record<string, unknown>)['streaming'] && ((value['captureBoundary'] as Record<string, unknown>)['streaming'] as Record<string, unknown>)['assembly']);
    expect(response['responseMeta']).toEqual({ statusCode: 200, contentType: 'text/event-stream' });
    expect(chunk['choiceIndex']).toBe(0);
    expect(chunk['deltaText']).toBe('world');
    expect(JSON.stringify(value)).not.toContain('upstreamStatus');
  });

  it('T103/T107/T109 rejects closed vocabulary, decoder, outcome, and bounds violations', () => {
    const base = jsonRecord();
    const cases = [
      (v: Record<string, unknown>) => (((v['captureBoundary'] as any).streaming.decoderDisposition) = 'other'),
      (v: Record<string, unknown>) => { delete (v['captureBoundary'] as any).streaming.assembly.decoderContract; },
      (v: Record<string, unknown>) => (((v['captureBoundary'] as any).streaming.clientResponse.outcome) = 'local-error-flushed'),
      (v: Record<string, unknown>) => (((v['captureBoundary'] as any).streaming.remainder.lastObservedFramePosition) = 0),
      (v: Record<string, unknown>) => (((v['trace'] as any).events.find((e: any) => e.kind === 'model_response').responseEnvelope.responseMeta.statusCode) = 99),
    ];
    for (const change of cases) expect(mutate(base, change).ok).toBe(false);
  });

  it('T104/T106 rejects tampering with every derived 1.1 surface', () => {
    const base = jsonRecord();
    for (const change of [
      (v: Record<string, unknown>) => (((v['completeness'] as any).lifecycle.observation.terminal) = 'failed'),
      (v: Record<string, unknown>) => (((v['completeness'] as any).declaredLosses) = []),
      (v: Record<string, unknown>) => (((v['trace'] as any).assembly.assembler.version) = '9.0.0'),
      (v: Record<string, unknown>) => (((v['trace'] as any).captureProfile.version) = '9.0.0'),
      (v: Record<string, unknown>) => (((v['completeness'] as any).boundaryStatement) = 'altered'),
    ]) {
      const result = mutate(base, change);
      expect(result.ok).toBe(false);
    }
    const completenessTamper = mutate(base, (v) => (((v['completeness'] as any).declaredLosses) = []));
    if (!completenessTamper.ok) expect(completenessTamper.issues.map((issue) => issue.code)).toContain('completeness_disagrees_with_derivation');
  });

  it('T113 validates response placement, choice bounds, and delta ownership', () => {
    const base = jsonRecord();
    expect(mutate(base, (v) => (((v['rawObservations'] as any[])[4].payload.responseEnvelope.choiceIndex) = -1)).ok).toBe(false);
    expect(mutate(base, (v) => (((v['rawObservations'] as any[])[3].payload.responseEnvelope.deltaText) = 'x')).ok).toBe(false);
    expect(mutate(base, (v) => (((v['rawObservations'] as any[])[4].payload.responseEnvelope.deltaText) = 'x'.repeat(241))).ok).toBe(false);
  });

  it('T114/T118-T121 validates the closed leaf shape and aggregate ownership', () => {
    const truncated = { text: 'short', evidenceStatus: 'truncated', truncation: { maxLength: 240, originalLength: 300, retainedLength: 5 } };
    const truncatedSource = observations(truncated);
    truncatedSource[2]!.evidenceStatus = 'truncated';
    const valid = record('1.1.0', streamingBoundary({ losses: { ...streamingBoundary().streaming!.losses, messageContent: 'partially-retained' } }), truncatedSource);
    expect(parseEvidenceRecord(valid).ok).toBe(true);
    const both = {
      text: 'masked-short', evidenceStatus: 'redacted',
      redaction: { policy: 'detector-v1', reasons: ['credential'], spanCount: 1, maskedCodePoints: 8 },
      truncation: { maxLength: 240, originalLength: 300, retainedLength: 12 },
    };
    const bothSource = observations(both);
    bothSource[2]!.evidenceStatus = 'redacted';
    const bothRecord = record('1.1.0', streamingBoundary({ losses: { ...streamingBoundary().streaming!.losses, messageContent: 'partially-retained', maskedContent: true } }), bothSource);
    const bothParsed = parseEvidenceRecord(JSON.parse(serializeEvidenceRecord(bothRecord)));
    expect(bothParsed.ok).toBe(true);
    if (bothParsed.ok) {
      const request = bothParsed.record.trace.events.find((event) => event.kind === 'model_request') as any;
      expect(request.requestEnvelope.messages[0].content).toEqual((bothParsed.record.rawObservations[2]!.payload as any).requestEnvelope.messages[0].content);
    }
    const forgedAggregate = observations(truncated);
    expect(normalizeEvidenceRecord(forgedAggregate, streamingBoundary({ losses: { ...streamingBoundary().streaming!.losses, messageContent: 'partially-retained' } }), '1.1.0').ok).toBe(false);
    const invalidLeaves = [
      { text: 'x', evidenceStatus: 'redacted' },
      { text: 'x', evidenceStatus: 'truncated', truncation: { maxLength: 120, originalLength: 3, retainedLength: 1 } },
      { text: 'x', evidenceStatus: 'captured', secretField: 'do-not-echo' },
    ];
    for (const leaf of invalidLeaves) {
      const result = normalizeEvidenceRecord(observations(leaf), streamingBoundary(), '1.1.0');
      expect(result.ok).toBe(false);
    }
  });

  it('T124 derives the closed unknown-role loss and rejects raw roles', () => {
    const source = observations();
    ((source[2]!.payload as any).requestEnvelope.messages[0].role) = 'unrecognized';
    const losses = { ...streamingBoundary().streaming!.losses, unrecognizedRoleObserved: true };
    const value = record('1.1.0', streamingBoundary({ losses }), source);
    expect(value.completeness.declaredLosses).toContain('unrecognized-role-not-retained');
    ((source[2]!.payload as any).requestEnvelope.messages[0].role) = 'raw-private-role';
    const rejected = normalizeEvidenceRecord(source, streamingBoundary({ losses }), '1.1.0');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.issues.every((issue) => !issue.message.includes('raw-private-role'))).toBe(true);
  });

  it('T128/T131/T142 derives phase/loss facts and enforces SSE applicability', () => {
    const partial = streamingBoundary({ losses: { ...streamingBoundary().streaming!.losses, requestBody: 'partially-observed-not-retained', sseMetadataObservedButNotRetained: true } });
    const value = record('1.1.0', partial);
    expect(value.completeness.declaredLosses).toEqual(expect.arrayContaining(['request-body-not-retained', 'request-body-not-fully-observed', 'sse-metadata-not-retained']));
    const bad = structuredClone(partial);
    bad.streaming!.decoderDisposition = 'unsupported-encoding';
    delete bad.streaming!.assembly.decoderContract;
    bad.streaming!.losses.contentEncodingUnsupported = true;
    expect(normalizeEvidenceRecord(observations(), bad, '1.1.0').ok).toBe(false);
  });

  it('T150 validates every budget range, feasibility, and record-owned size limits', () => {
    const base = jsonRecord();
    expect(mutate(base, (v) => (((v['captureBoundary'] as any).streaming.budgets.maxCanonicalEvents) = 999)).ok).toBe(false);
    expect(mutate(base, (v) => { (v['captureBoundary'] as any).streaming.budgets.maxCanonicalEvents = 5000; (v['captureBoundary'] as any).streaming.budgets.maxRawObservations = 2000; }).ok).toBe(false);
    expect(mutate(base, (v) => (((v['captureBoundary'] as any).streaming.budgets.maxSerializedEvidenceBytes) = 1_048_576)).ok).toBe(true);
  });

  it('T101/T117/T133 preserves genuine 1.0 messages and rejects 1.1-owned paths', () => {
    const source = observations({ arbitrary: ['legacy', { role: 'raw-secret-role' }] });
    const legacyBoundary = { ...streamingBoundary() } as CaptureBoundary;
    delete legacyBoundary.streaming;
    const legacy = normalizeEvidenceRecord(source.map((item) => item.kind === 'model_response' ? { ...item, payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful' } } } : item.kind === 'model_response_chunk' ? { ...item, payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful' } } } : item), legacyBoundary, '1.0.1');
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    const roundTrip = parseEvidenceRecord(JSON.parse(serializeEvidenceRecord(legacy.record)));
    expect(roundTrip.ok).toBe(true);
    if (roundTrip.ok) expect((roundTrip.record.trace.events.find((event) => event.kind === 'model_request') as any).requestEnvelope.messages[0].content).toEqual({ arbitrary: ['legacy', { role: 'raw-secret-role' }] });
    const bad = JSON.parse(serializeEvidenceRecord(legacy.record)) as Record<string, unknown>;
    (bad['captureBoundary'] as Record<string, unknown>)['streaming'] = streamingBoundary().streaming;
    expect(parseEvidenceRecord(bad).ok).toBe(false);
  });

  it('future MAJOR-1 minors validate known 1.1 fields and preserve unknown additive fields', () => {
    const future = jsonRecord();
    future['evidenceSchemaVersion'] = '1.9.0';
    (future['trace'] as any).evidenceSchemaVersion = '1.9.0';
    (future['trace'] as any).futureTrace = { retained: true };
    (future['captureBoundary'] as any).streaming.futureBoundary = { retained: true };
    const parsed = parseEvidenceRecord(future);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect((parsed.record.captureBoundary.streaming as any).futureBoundary).toEqual({ retained: true });
    (future['rawObservations'] as any[])[4].payload.responseEnvelope.choiceIndex = -1;
    expect(parseEvidenceRecord(future).ok).toBe(false);
  });
});
