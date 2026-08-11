import { describe, expect, it } from 'vitest';
import type { EvidenceObservation } from './types-trace.js';
import type { EventRecord } from './types-event.js';
import type { CaptureBoundary, StreamingCaptureBoundary, TraceCompleteness } from './types-record.js';
import { normalizeEvidenceRecord, parseEvidenceRecord, validateStreamingRecordBudgets } from './validate.js';
import { serializeEvidenceRecord } from './serialize.js';
import { obs, T0, T1, T2, T3, T4, T5 } from './fixtures.js';
import {
  CLIENT_REQUEST_FAILURE_CODES,
  MALFORMED_STREAM_CODES,
  OBSERVATION_FAILURE_CODES,
  UPSTREAM_FAILURE_CODES,
} from './vocabulary.js';

const COMPLETE_STATUS_COUNTS: TraceCompleteness['eventsByStatus'] = {
  captured: 0, redacted: 0, truncated: 0, missing: 0, unknown: 0, not_applicable: 0,
};
// @ts-expect-error Spec 014 keeps eventsByStatus closed to EvidenceStatus keys.
const ARBITRARY_STATUS_COUNTS: TraceCompleteness['eventsByStatus'] = { ...COMPLETE_STATUS_COUNTS, arbitrary: 1 };
void ARBITRARY_STATUS_COUNTS;

const LEGACY_MODEL_RESPONSE_EVENT = {
  eventId: 'legacy-response', traceId: 'legacy-trace', spanId: 'legacy-span', seq: 1,
  kind: 'model_response', capturedAt: T0, evidenceStatus: 'captured', observationRole: 'provider_reported',
  responseEnvelope: {
    providerNativeFidelity: 'structurally_faithful', finishReason: 'stop',
    providerNative: { id: 'legacy' }, usage: { total_tokens: 1 }, chunkIndex: 0,
  },
} satisfies Extract<EventRecord, { kind: 'model_response' }>;

const STREAMING_MODEL_RESPONSE_EVENT = {
  eventId: 'stream-response', traceId: 'stream-trace', spanId: 'stream-span', seq: 1,
  kind: 'model_response', capturedAt: T0, evidenceStatus: 'captured', observationRole: 'provider_reported',
  responseEnvelope: {
    providerNativeFidelity: 'structurally_faithful',
    responseMeta: { statusCode: 200, contentType: 'text/event-stream' },
  },
} satisfies Extract<EventRecord, { kind: 'model_response' }>;

const STREAMING_MODEL_RESPONSE_CHUNK_EVENT = {
  eventId: 'stream-chunk', traceId: 'stream-trace', spanId: 'stream-span', seq: 2,
  kind: 'model_response_chunk', capturedAt: T0, evidenceStatus: 'captured', observationRole: 'provider_reported',
  responseEnvelope: { providerNativeFidelity: 'structurally_faithful', choiceIndex: 0, deltaText: 'ok' },
} satisfies Extract<EventRecord, { kind: 'model_response_chunk' }>;

// @ts-expect-error Schema-1.1 response metadata cannot be combined with chunk-only fields.
const INVALID_STREAMING_MODEL_RESPONSE_EVENT = { ...STREAMING_MODEL_RESPONSE_EVENT, responseEnvelope: { ...STREAMING_MODEL_RESPONSE_EVENT.responseEnvelope, finishReason: 'stop' } } satisfies Extract<EventRecord, { kind: 'model_response' }>;
// @ts-expect-error Response metadata is never valid on a chunk event.
const INVALID_STREAMING_MODEL_RESPONSE_CHUNK_EVENT = { ...STREAMING_MODEL_RESPONSE_CHUNK_EVENT, responseEnvelope: { ...STREAMING_MODEL_RESPONSE_CHUNK_EVENT.responseEnvelope, responseMeta: { statusCode: 200 } } } satisfies Extract<EventRecord, { kind: 'model_response_chunk' }>;
void [LEGACY_MODEL_RESPONSE_EVENT, STREAMING_MODEL_RESPONSE_EVENT, STREAMING_MODEL_RESPONSE_CHUNK_EVENT, INVALID_STREAMING_MODEL_RESPONSE_EVENT, INVALID_STREAMING_MODEL_RESPONSE_CHUNK_EVENT];

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

function terminalError(
  code: string,
  actor: 'model' | 'capture',
  target: 'trace' | 'none',
  effect: 'fail' | 'none',
  seq: number,
): EvidenceObservation {
  return obs({
    observationId: `terminal-${seq}`, eventId: `terminal-event-${seq}`, traceId: 'stream-trace', seq,
    kind: 'error', capturedAt: T4, rawCapturedAt: T4, observationRole: 'provider_reported', spanId: null,
    evidenceStatus: 'captured', payload: { actor, lifecycleTarget: target, lifecycleEffect: effect, error: { type: code } },
  });
}

function withoutChunkTerminal(code: string, upstream: StreamingCaptureBoundary['upstream'], disposition: StreamingCaptureBoundary['decoderDisposition'] = 'openai-sse') {
  const source = observations().slice(0, 4);
  source.push(terminalError(code, 'model', 'trace', 'fail', 4));
  const base = streamingBoundary().streaming!;
  const boundary = streamingBoundary({
    upstream,
    clientResponse: upstream.outcome === 'response-completed' ? { outcome: 'local-error-flushed' } : { outcome: 'closed-before-completion' },
    decoderDisposition: disposition,
    remainder: { knowledge: upstream.outcome === 'response-completed' ? 'transport-eof-observed' : 'unknown', rawForwardedBytes: 0 },
    losses: {
      ...base.losses,
      deltaContent: 'not-observed',
      ...(['http-error-status', 'provider-error-frame'].includes(code) ? { providerErrorBody: 'not-retained' as const } : {}),
    },
    assembly: {
      assembler: base.assembly.assembler,
      ...(disposition === 'openai-sse' ? { decoderContract: base.assembly.decoderContract } : {}),
    },
  });
  return { source, boundary };
}

function defineJsonParsedOwnKey(target: Record<string, unknown>, key: '__proto__' | 'constructor' | 'prototype'): void {
  const parsed = JSON.parse(`{"${key}":{"credential":"must-not-leak"}}`) as Record<string, unknown>;
  Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(parsed, key)!);
}

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
    const streaming = (value['captureBoundary'] as Record<string, unknown>)['streaming'] as Record<string, unknown>;
    expect(trace['assembly']).toEqual(streaming['assembly']);
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
    const providerErrorBeforeMeta = structuredClone(observations().slice(0, 3));
    providerErrorBeforeMeta.push(terminalError('provider-error-frame', 'model', 'trace', 'fail', 3));
    const laterResponse = observations()[3]!;
    providerErrorBeforeMeta.push({ ...laterResponse, observationId: 'late-meta', eventId: 'late-meta-event', seq: 4 });
    const ordering = normalizeEvidenceRecord(providerErrorBeforeMeta, streamingBoundary({ losses: { ...streamingBoundary().streaming!.losses, deltaContent: 'not-observed' } }), '1.1.0');
    expect(ordering.ok).toBe(false);
    if (!ordering.ok) expect(ordering.issues.map((entry) => entry.code)).toContain('response_meta_placement_invalid');
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
    const deltaBothSource = observations();
    deltaBothSource[4]!.evidenceStatus = 'redacted';
    (deltaBothSource[4]!.payload as any).redaction = { policy: 'detector-v1', reasons: ['credential'], spanCount: 1, maskedCodePoints: 4 };
    (deltaBothSource[4]!.payload as any).truncation = { maxLength: 240, originalLength: 300, retainedLength: 5 };
    const deltaBothBoundary = streamingBoundary({ losses: { ...streamingBoundary().streaming!.losses, deltaContent: 'partially-retained', maskedContent: true } });
    const deltaBoth = record('1.1.0', deltaBothBoundary, deltaBothSource);
    expect(deltaBoth.completeness.declaredLosses).toContain('delta-content-not-retained');
    const deltaEvent = deltaBoth.trace.events.find((event) => event.kind === 'model_response_chunk');
    expect(deltaEvent?.evidenceStatus).toBe('redacted');
    expect(deltaEvent && 'truncation' in deltaEvent ? deltaEvent.truncation : undefined).toBeDefined();
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

  it('T107/T115/T132 records decoder participation from successful response metadata, including zero-frame failures', () => {
    const eof = withoutChunkTerminal('sse-eof-without-done', { outcome: 'stream-ended-prematurely' });
    expect(normalizeEvidenceRecord(eof.source, eof.boundary, '1.1.0').ok).toBe(true);
    const transport = withoutChunkTerminal('connection-error', { outcome: 'stream-ended-prematurely' });
    expect(normalizeEvidenceRecord(transport.source, transport.boundary, '1.1.0').ok).toBe(true);

    const nonSse = withoutChunkTerminal('non-sse-response', { outcome: 'response-completed' }, 'not-applicable');
    ((nonSse.source[3]!.payload as any).responseEnvelope.responseMeta.contentType) = 'application/json';
    expect(normalizeEvidenceRecord(nonSse.source, nonSse.boundary, '1.1.0').ok).toBe(true);

    const upstreamError = withoutChunkTerminal('http-error-status', { outcome: 'response-completed' }, 'not-applicable');
    ((upstreamError.source[3]!.payload as any).responseEnvelope.responseMeta.statusCode) = 503;
    ((upstreamError.source[3]!.payload as any).responseEnvelope.responseMeta.contentType) = 'application/json';
    expect(normalizeEvidenceRecord(upstreamError.source, upstreamError.boundary, '1.1.0').ok).toBe(true);

    const headerless = observations().slice(0, 3);
    headerless.push(terminalError('connection-error', 'model', 'trace', 'fail', 3));
    const headerlessBoundary = streamingBoundary({
      upstream: { outcome: 'connection-failed' }, clientResponse: { outcome: 'local-error-flushed' },
      decoderDisposition: 'not-applicable', remainder: { knowledge: 'unknown' },
      losses: { ...streamingBoundary().streaming!.losses, deltaContent: 'not-observed' },
      assembly: { assembler: streamingBoundary().streaming!.assembly.assembler },
    });
    expect(normalizeEvidenceRecord(headerless, headerlessBoundary, '1.1.0').ok).toBe(true);

    const encodedSource = observations().slice(0, 4);
    ((encodedSource[3]!.payload as any).responseEnvelope.responseMeta.contentEncoding) = 'gzip';
    encodedSource.push(terminalError('observation-encoding-unsupported', 'capture', 'none', 'none', 4));
    const encodedBoundary = streamingBoundary({
      decoderDisposition: 'unsupported-encoding',
      losses: { ...streamingBoundary().streaming!.losses, deltaContent: 'not-observed', contentEncodingUnsupported: true },
      assembly: { assembler: streamingBoundary().streaming!.assembly.assembler },
    });
    expect(normalizeEvidenceRecord(encodedSource, encodedBoundary, '1.1.0').ok).toBe(true);
  });

  it('enforces status, content-type, decoder, and error-body facts for response-classification terminals', () => {
    const setResponseMeta = (candidate: ReturnType<typeof withoutChunkTerminal>, statusCode: number, contentType?: string): void => {
      const responseMeta = ((candidate.source[3]!.payload as any).responseEnvelope.responseMeta) as Record<string, unknown>;
      responseMeta['statusCode'] = statusCode;
      if (contentType === undefined) delete responseMeta['contentType'];
      else responseMeta['contentType'] = contentType;
    };
    const expectRejected = (candidate: ReturnType<typeof withoutChunkTerminal>): void => {
      const result = normalizeEvidenceRecord(candidate.source, candidate.boundary, '1.1.0');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.map((entry) => entry.code)).toContain('streaming_terminal_disagrees');
    };

    for (const statusCode of [100, 199, 300, 599]) {
      const candidate = withoutChunkTerminal('http-error-status', { outcome: 'response-completed' }, 'not-applicable');
      setResponseMeta(candidate, statusCode, statusCode === 599 ? 'text/event-stream' : 'application/json');
      expect(normalizeEvidenceRecord(candidate.source, candidate.boundary, '1.1.0').ok, `http-${statusCode}`).toBe(true);
    }
    for (const statusCode of [200, 299]) {
      const candidate = withoutChunkTerminal('http-error-status', { outcome: 'response-completed' }, 'not-applicable');
      setResponseMeta(candidate, statusCode, 'application/json');
      expectRejected(candidate);
    }
    const httpWrongDecoder = withoutChunkTerminal('http-error-status', { outcome: 'response-completed' }, 'openai-sse');
    setResponseMeta(httpWrongDecoder, 500, 'text/event-stream');
    expectRejected(httpWrongDecoder);
    const httpBodyNotApplicable = withoutChunkTerminal('http-error-status', { outcome: 'response-completed' }, 'not-applicable');
    setResponseMeta(httpBodyNotApplicable, 500, 'application/json');
    httpBodyNotApplicable.boundary.streaming!.losses.providerErrorBody = 'not-applicable';
    expectRejected(httpBodyNotApplicable);

    for (const [statusCode, contentType] of [[200, 'application/json'], [299, undefined]] as const) {
      const candidate = withoutChunkTerminal('non-sse-response', { outcome: 'response-completed' }, 'not-applicable');
      setResponseMeta(candidate, statusCode, contentType);
      expect(normalizeEvidenceRecord(candidate.source, candidate.boundary, '1.1.0').ok, `non-sse-${statusCode}`).toBe(true);
    }
    for (const statusCode of [199, 300]) {
      const candidate = withoutChunkTerminal('non-sse-response', { outcome: 'response-completed' }, 'not-applicable');
      setResponseMeta(candidate, statusCode, 'application/json');
      expectRejected(candidate);
    }
    const falselyNonSse = withoutChunkTerminal('non-sse-response', { outcome: 'response-completed' }, 'not-applicable');
    setResponseMeta(falselyNonSse, 200, 'text/event-stream');
    expectRejected(falselyNonSse);

    for (const statusCode of [200, 299]) {
      const candidate = withoutChunkTerminal('provider-error-frame', { outcome: 'response-completed' }, 'openai-sse');
      setResponseMeta(candidate, statusCode, 'text/event-stream');
      expect(normalizeEvidenceRecord(candidate.source, candidate.boundary, '1.1.0').ok, `provider-frame-${statusCode}`).toBe(true);
    }
    for (const [statusCode, contentType] of [[199, 'text/event-stream'], [300, 'text/event-stream'], [200, 'application/json']] as const) {
      const candidate = withoutChunkTerminal('provider-error-frame', { outcome: 'response-completed' }, 'openai-sse');
      setResponseMeta(candidate, statusCode, contentType);
      expectRejected(candidate);
    }
    const providerFrameWrongDecoder = withoutChunkTerminal('provider-error-frame', { outcome: 'response-completed' }, 'not-applicable');
    setResponseMeta(providerFrameWrongDecoder, 200, 'text/event-stream');
    expectRejected(providerFrameWrongDecoder);
    const providerFrameBodyNotApplicable = withoutChunkTerminal('provider-error-frame', { outcome: 'response-completed' }, 'openai-sse');
    providerFrameBodyNotApplicable.boundary.streaming!.losses.providerErrorBody = 'not-applicable';
    expectRejected(providerFrameBodyNotApplicable);
  });

  it('rejects completed terminals without an observed SSE protocol terminal and accepts both valid delivery outcomes', () => {
    expect(normalizeEvidenceRecord(observations(), streamingBoundary(), '1.1.0').ok).toBe(true);
    const completedBeforeFlush = streamingBoundary({ clientResponse: { outcome: 'closed-before-completion' } });
    expect(normalizeEvidenceRecord(observations(), completedBeforeFlush, '1.1.0').ok).toBe(true);

    const nonSseSource = observations().filter((event) => event.kind !== 'model_response_chunk');
    ((nonSseSource.find((event) => event.kind === 'model_response')!.payload as any).responseEnvelope.responseMeta.contentType) = 'application/json';
    const base = streamingBoundary().streaming!;
    const nonSseBoundary = streamingBoundary({
      decoderDisposition: 'not-applicable',
      remainder: { knowledge: 'transport-eof-observed', rawForwardedBytes: 64 },
      losses: { ...base.losses, deltaContent: 'not-observed' },
      assembly: { assembler: base.assembly.assembler },
    });
    const nonSseResult = normalizeEvidenceRecord(nonSseSource, nonSseBoundary, '1.1.0');
    expect(nonSseResult.ok).toBe(false);
    if (!nonSseResult.ok) expect(nonSseResult.issues.map((entry) => entry.code)).toContain('streaming_terminal_disagrees');

    const missingDoneBoundary = streamingBoundary({ remainder: { knowledge: 'transport-eof-observed', rawForwardedBytes: 64 } });
    const missingDoneResult = normalizeEvidenceRecord(observations(), missingDoneBoundary, '1.1.0');
    expect(missingDoneResult.ok).toBe(false);
    if (!missingDoneResult.ok) expect(missingDoneResult.issues.map((entry) => entry.code)).toContain('streaming_terminal_disagrees');
  });

  it('T165 accepts every malformed and upstream failure code only with its authoritative outcome', () => {
    for (const code of MALFORMED_STREAM_CODES) {
      const candidate = withoutChunkTerminal(code, { outcome: 'stream-ended-prematurely' });
      expect(normalizeEvidenceRecord(candidate.source, candidate.boundary, '1.1.0').ok, code).toBe(true);
    }
    for (const code of UPSTREAM_FAILURE_CODES) {
      const transport = ['connection-error', 'upstream-timeout', 'tls-failure'].includes(code);
      const sseProviderError = code === 'provider-error-frame';
      const candidate = withoutChunkTerminal(code, { outcome: transport ? 'connection-failed' : 'response-completed' }, sseProviderError ? 'openai-sse' : 'not-applicable');
      if (transport) candidate.source.splice(3, 1);
      else if (!sseProviderError) {
        ((candidate.source[3]!.payload as any).responseEnvelope.responseMeta.contentType) = 'application/json';
        if (code === 'http-error-status') ((candidate.source[3]!.payload as any).responseEnvelope.responseMeta.statusCode) = 500;
      }
      candidate.source[candidate.source.length - 1]!.seq = candidate.source.length - 1;
      expect(normalizeEvidenceRecord(candidate.source, candidate.boundary, '1.1.0').ok, code).toBe(true);
    }
  });

  it('T165 proves request codes cannot be relabeled as model failures', () => {
    for (const code of CLIENT_REQUEST_FAILURE_CODES) {
      const source = [observations()[0]!, terminalError(code, 'capture', 'trace', 'fail', 1)];
      const boundary = streamingBoundary({
        upstream: { outcome: 'not-started' }, clientResponse: { outcome: 'local-error-flushed' }, decoderDisposition: 'not-applicable',
        remainder: { knowledge: 'not-applicable' },
        losses: { ...streamingBoundary().streaming!.losses, messageContent: 'not-observed', deltaContent: 'not-observed' },
        assembly: { assembler: streamingBoundary().streaming!.assembly.assembler },
      });
      expect(normalizeEvidenceRecord(source, boundary, '1.1.0').ok, code).toBe(true);
      (source[1]!.payload as any).actor = 'model';
      expect(normalizeEvidenceRecord(source, boundary, '1.1.0').ok, `${code}-relabeled`).toBe(false);
    }
  });

  it('T165 proves observer codes cannot be relabeled as model failures', () => {
    for (const code of OBSERVATION_FAILURE_CODES) {
      const source = observations().slice(0, 3);
      source.push(terminalError(code, 'capture', 'none', 'none', 3));
      const boundary = streamingBoundary({
        upstream: { outcome: 'connection-failed' }, clientResponse: { outcome: 'local-error-flushed' }, decoderDisposition: 'not-applicable',
        remainder: { knowledge: 'unknown' }, losses: { ...streamingBoundary().streaming!.losses, deltaContent: 'not-observed' },
        assembly: { assembler: streamingBoundary().streaming!.assembly.assembler },
      });
      expect(normalizeEvidenceRecord(source, boundary, '1.1.0').ok, code).toBe(true);
      (source[3]!.payload as any).actor = 'model';
      (source[3]!.payload as any).lifecycleTarget = 'trace';
      (source[3]!.payload as any).lifecycleEffect = 'fail';
      expect(normalizeEvidenceRecord(source, boundary, '1.1.0').ok, `${code}-relabeled`).toBe(false);
    }
  });

  it('T165 accepts only client or ingress as cancellation requesters', () => {
    const cancelled = observations().slice(0, 4);
    cancelled.push(obs({
      observationId: 'cancelled', eventId: 'cancelled-event', traceId: 'stream-trace', seq: 4,
      kind: 'cancelled', capturedAt: T4, rawCapturedAt: T4, observationRole: 'provider_reported', spanId: null,
      evidenceStatus: 'captured', payload: { lifecycleTarget: 'trace', lifecycleEffect: 'cancel', cancellation: { requestedBy: 'client' } },
    }));
    const cancellationBoundary = streamingBoundary({
      upstream: { outcome: 'cancelled-by-ingress', cause: 'client-disconnect' }, clientResponse: { outcome: 'closed-before-completion' },
      remainder: { knowledge: 'unknown' }, losses: { ...streamingBoundary().streaming!.losses, deltaContent: 'not-observed' },
    });
    expect(normalizeEvidenceRecord(cancelled, cancellationBoundary, '1.1.0').ok).toBe(true);
    ((cancelled[4]!.payload as any).cancellation.requestedBy) = 'ingress';
    cancellationBoundary.streaming!.upstream.cause = 'ingress-shutdown';
    expect(normalizeEvidenceRecord(cancelled, cancellationBoundary, '1.1.0').ok).toBe(true);
    ((cancelled[4]!.payload as any).cancellation.requestedBy) = 'other';
    const invalidRequester = normalizeEvidenceRecord(cancelled, cancellationBoundary, '1.1.0');
    expect(invalidRequester.ok).toBe(false);
    if (!invalidRequester.ok) expect(invalidRequester.issues.map((entry) => entry.code)).toContain('cancellation_requester_invalid');
  });

  it('cross-validates provider-native retention against owned event payloads', () => {
    const retainedSource = observations();
    ((retainedSource[4]!.payload as any).responseEnvelope.providerNative) = { id: 'chunk-native' };
    const retainedBoundary = streamingBoundary({ losses: { ...streamingBoundary().streaming!.losses, providerNative: 'retained' } });
    expect(normalizeEvidenceRecord(retainedSource, retainedBoundary, '1.1.0').ok).toBe(true);

    const retainedWithoutPayload = normalizeEvidenceRecord(observations(), retainedBoundary, '1.1.0');
    expect(retainedWithoutPayload.ok).toBe(false);
    if (!retainedWithoutPayload.ok) expect(retainedWithoutPayload.issues.map((entry) => entry.code)).toContain('completeness_disagrees_with_derivation');

    const nonRetainedWithPayload = normalizeEvidenceRecord(retainedSource, streamingBoundary(), '1.1.0');
    expect(nonRetainedWithPayload.ok).toBe(false);
    if (!nonRetainedWithPayload.ok) expect(nonRetainedWithPayload.issues.map((entry) => entry.code)).toContain('completeness_disagrees_with_derivation');

    expect(normalizeEvidenceRecord(observations(), streamingBoundary(), '1.1.0').ok).toBe(true);
  });

  it('T150 validates every budget range, feasibility, and record-owned size limits', () => {
    const base = jsonRecord();
    for (const [expected, change] of [
      ['streaming_budget_out_of_range', (v: Record<string, unknown>) => (((v['captureBoundary'] as any).streaming.budgets.maxCanonicalEvents) = 999)],
      ['streaming_budget_infeasible', (v: Record<string, unknown>) => { (v['captureBoundary'] as any).streaming.budgets.maxCanonicalEvents = 5000; (v['captureBoundary'] as any).streaming.budgets.maxRawObservations = 2000; }],
    ] as const) {
      const result = mutate(base, change);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.map((entry) => entry.code)).toContain(expected);
    }
    const parsed = parseEvidenceRecord(base);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const streaming = parsed.record.captureBoundary.streaming!;
    const observationsBase = parsed.record.rawObservations;
    const trace = parsed.record.trace;
    const checks: Array<[string, Record<string, unknown>, readonly EvidenceObservation[], typeof trace]> = [
      ['raw_payload_budget_exceeded', base, [{ ...observationsBase[0]!, payload: { padding: 'x'.repeat(1_048_577) } }], trace],
      ['retained_content_budget_exceeded', base, observationsBase, { ...trace, events: [{ ...(trace.events.find((event) => event.kind === 'model_response_chunk') as any), responseEnvelope: { providerNativeFidelity: 'structurally_faithful', choiceIndex: 0, deltaText: 'x'.repeat(16_385) } }] }],
      ['serialized_evidence_budget_exceeded', { ...base, futurePadding: 'x'.repeat(1_048_577) }, observationsBase, trace],
      ['evidence_id_budget_exceeded', base, [{ ...observationsBase[0]!, observationId: 'x'.repeat(129) }], trace],
      ['canonical_event_budget_exceeded', base, observationsBase, { ...trace, events: Array.from({ length: 1_001 }, () => trace.events[0]!) }],
      ['raw_observation_budget_exceeded', base, Array.from({ length: 2_001 }, () => observationsBase[0]!), trace],
    ];
    for (const [expected, input, raw, traceValue] of checks) {
      const issues: Array<{ code: string; path: string; message: string }> = [];
      validateStreamingRecordBudgets(input, raw, traceValue, streaming, issues);
      expect(issues.map((entry) => entry.code), expected).toContain(expected);
    }
  });

  it('applies every streaming record-owned budget during normalization and serialization', () => {
    const expectNormalizationIssue = (
      expected: string,
      source: readonly EvidenceObservation[],
      boundary: CaptureBoundary = streamingBoundary(),
    ): void => {
      const result = normalizeEvidenceRecord(source, boundary, '1.1.0');
      expect(result.ok, expected).toBe(false);
      if (!result.ok) expect(result.issues.map((entry) => entry.code), expected).toContain(expected);
    };

    const oversizedId = observations();
    oversizedId[0] = { ...oversizedId[0]!, observationId: 'x'.repeat(129) };
    expectNormalizationIssue('evidence_id_budget_exceeded', oversizedId);

    const oversizedRawPayload = observations();
    oversizedRawPayload[0] = { ...oversizedRawPayload[0]!, payload: { padding: 'x'.repeat(1_048_577) } };
    expectNormalizationIssue('raw_payload_budget_exceeded', oversizedRawPayload);

    const oversizedRetainedContent = observations();
    ((oversizedRetainedContent[2]!.payload as any).requestEnvelope.messages) = Array.from(
      { length: 69 },
      (_, index) => ({ role: 'user', name: `message-${index}`, content: { text: 'x'.repeat(240), evidenceStatus: 'captured' } }),
    );
    expectNormalizationIssue('retained_content_budget_exceeded', oversizedRetainedContent);

    const excessiveEvents = observations();
    const usageEvents = Array.from({ length: 994 }, (_, index) => obs({
      observationId: `usage-observation-${index}`,
      eventId: `usage-event-${index}`,
      traceId: 'stream-trace',
      seq: 0,
      spanId: 'stream-span',
      kind: 'model_usage',
      capturedAt: T3,
      rawCapturedAt: T3,
      observationRole: 'provider_reported',
      payload: { usage: { evidenceStatus: 'captured' } },
    }));
    excessiveEvents.splice(5, 0, ...usageEvents);
    excessiveEvents.forEach((event, index) => { event.seq = index; });
    expectNormalizationIssue('canonical_event_budget_exceeded', excessiveEvents);

    const rawReplaySource = [
      ...Array.from({ length: 2_001 }, (_, index) => ({ ...observations()[0]!, observationId: `replay-${index}` })),
      ...observations().slice(1),
    ];
    expectNormalizationIssue('raw_observation_budget_exceeded', rawReplaySource);

    const serializedSource = observations();
    ((serializedSource[2]!.payload as any).requestEnvelope.providerNative) = { padding: 'x'.repeat(600_000) };
    const retainedNativeLosses = { ...streamingBoundary().streaming!.losses, providerNative: 'retained' as const };
    expectNormalizationIssue('serialized_evidence_budget_exceeded', serializedSource, streamingBoundary({ losses: retainedNativeLosses }));

    const widenedBoundary = streamingBoundary({
      losses: retainedNativeLosses,
      budgets: { ...streamingBoundary().streaming!.budgets, maxSerializedEvidenceBytes: 67_108_864 },
    });
    const widened = normalizeEvidenceRecord(serializedSource, widenedBoundary, '1.1.0');
    expect(widened.ok).toBe(true);
    if (!widened.ok) return;
    widened.record.captureBoundary.streaming!.budgets.maxSerializedEvidenceBytes = 1_048_576;
    const reparsed = parseEvidenceRecord(widened.record);
    expect(reparsed.ok).toBe(false);
    if (!reparsed.ok) expect(reparsed.issues.map((entry) => entry.code)).toContain('serialized_evidence_budget_exceeded');
    expect(() => serializeEvidenceRecord(widened.record)).toThrow(/serialized_evidence_budget_exceeded/);
    expect(() => serializeEvidenceRecord(widened.record, { allowBudgetExcess: true })).not.toThrow();
    widened.record.captureBoundary.streaming!.detector.name = 'invalid.detector';
    expect(() => serializeEvidenceRecord(widened.record, { allowBudgetExcess: true }))
      .toThrow(/versioned_identity_invalid/);
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

    const unsafeLegacy = JSON.parse(serializeEvidenceRecord(legacy.record)) as Record<string, unknown>;
    const unsafeNative = JSON.parse('{"safe":"retained","__proto__":{"polluted":true},"constructor":{"bad":1},"prototype":{"bad":2}}');
    const rawLegacyResponse = (unsafeLegacy['rawObservations'] as any[]).find((event) => event.kind === 'model_response');
    const traceLegacyResponse = ((unsafeLegacy['trace'] as any).events as any[]).find((event) => event.kind === 'model_response');
    rawLegacyResponse.payload.responseEnvelope.providerNative = structuredClone(unsafeNative);
    traceLegacyResponse.responseEnvelope.providerNative = structuredClone(unsafeNative);
    const sanitizedLegacy = parseEvidenceRecord(unsafeLegacy);
    expect(sanitizedLegacy.ok).toBe(true);
    if (sanitizedLegacy.ok) {
      const serialized = JSON.parse(serializeEvidenceRecord(sanitizedLegacy.record));
      const rawNative = serialized.rawObservations.find((event: any) => event.kind === 'model_response').payload.responseEnvelope.providerNative;
      const traceNative = serialized.trace.events.find((event: any) => event.kind === 'model_response').responseEnvelope.providerNative;
      expect(rawNative).toEqual({ safe: 'retained' });
      expect(traceNative).toEqual({ safe: 'retained' });
      expect(({} as any).polluted).toBeUndefined();
    }

    const bad = JSON.parse(serializeEvidenceRecord(legacy.record)) as Record<string, unknown>;
    (bad['captureBoundary'] as Record<string, unknown>)['streaming'] = streamingBoundary().streaming;
    expect(parseEvidenceRecord(bad).ok).toBe(false);
  });

  it('future MAJOR-1 minors validate known 1.1 fields and preserve unknown additive fields', () => {
    const future = jsonRecord();
    future['evidenceSchemaVersion'] = '1.9.0';
    (future['trace'] as any).evidenceSchemaVersion = '1.9.0';
    (future['trace'] as any).futureTrace = { retained: true };
    (future['trace'] as any).assembly.assembler.build = { retained: true };
    (future['captureBoundary'] as any).streaming.futureBoundary = JSON.parse('{"retained":true,"nested":{"keep":"yes","constructor":{"bad":1},"prototype":{"bad":2}}}');
    const parsed = parseEvidenceRecord(future);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect((parsed.record.captureBoundary.streaming as any).futureBoundary).toEqual({ retained: true, nested: { keep: 'yes' } });
      expect((parsed.record.trace.assembly as any).assembler.build).toEqual({ retained: true });
      expect(JSON.parse(serializeEvidenceRecord(parsed.record)).trace.assembly.assembler.build).toEqual({ retained: true });
    }
    (future['rawObservations'] as any[])[4].payload.responseEnvelope.choiceIndex = -1;
    expect(parseEvidenceRecord(future).ok).toBe(false);
  });

  it('rejects capture-profile pedigree mismatches while preserving owned-field authority', () => {
    const base = jsonRecord();
    const result = mutate(base, (value) => { ((value['captureBoundary'] as any).streaming.captureProfile.version) = '1.0.1'; });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((entry) => entry.code)).toContain('capture_profile_pedigree_disagrees');
  });

  it('rejects JSON-parsed prototype-sensitive own keys at multiple closed nesting levels without leakage or pollution', () => {
    const base = jsonRecord();
    const targets = [
      (value: any) => value.captureBoundary.streaming.budgets,
      (value: any) => value.captureBoundary.streaming.upstream,
      (value: any) => value.rawObservations[2].payload.requestEnvelope.messages[0].content,
      (value: any) => value.rawObservations[3].payload.responseEnvelope.responseMeta,
    ];
    for (const key of ['__proto__', 'constructor', 'prototype'] as const) {
      for (const select of targets) {
        const value = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
        defineJsonParsedOwnKey(select(value), key);
        const before = Object.getPrototypeOf(value);
        const result = parseEvidenceRecord(value);
        expect(result.ok).toBe(false);
        expect(Object.getPrototypeOf(value)).toBe(before);
        expect(({} as any).credential).toBeUndefined();
        if (!result.ok) {
          expect(result.issues.map((entry) => entry.code)).toContain('closed_shape_unknown_key');
          expect(JSON.stringify(result.issues)).not.toContain('must-not-leak');
        }
      }
    }
  });

  it('rejects every safe unknown key on representative closed Spec 016 shapes', () => {
    const base = jsonRecord();
    for (const select of [
      (value: any) => value.captureBoundary.streaming.losses,
      (value: any) => value.captureBoundary.streaming.budgets,
      (value: any) => value.captureBoundary.streaming.assembly.assembler,
      (value: any) => value.captureBoundary.streaming.upstream,
      (value: any) => value.rawObservations[2].payload.requestEnvelope.messages[0],
      (value: any) => value.rawObservations[3].payload.responseEnvelope.responseMeta,
    ]) {
      const value = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      select(value).futureClosedField = true;
      const result = parseEvidenceRecord(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.map((entry) => entry.code)).toContain('closed_shape_unknown_key');
    }
  });

  it('returns only the unsupported-version issue for malformed and unsupported schema versions', () => {
    for (const version of ['1.2.foo', '1.x', '2.1.0']) {
      const normalized = normalizeEvidenceRecord(observations(), streamingBoundary(), version);
      expect(normalized.ok).toBe(false);
      if (!normalized.ok) expect(normalized.issues.map((entry) => entry.code)).toEqual(['unsupported_evidence_schema_version']);
    }
  });

  it('measures payload-less control observations without throwing', () => {
    const base = jsonRecord();
    delete (base['rawObservations'] as any[])[0].payload;
    expect(() => parseEvidenceRecord(base)).not.toThrow();
  });
});
