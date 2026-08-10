import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeEvidenceRecord,
  type CaptureBoundary,
  type ContentLeaf,
  type EvidenceObservation,
  type EvidenceRecord,
  type StreamingCaptureBoundary,
} from '@signalglass/evidence';
import {
  createMetadataSafePolicy,
  EvidenceStorage,
  StorageConfigError,
  type PersistencePolicy,
  type PersistencePolicyDecision,
} from './evidenceStorage.js';

const T0 = '2026-08-10T12:00:00.000Z';
const T1 = '2026-08-10T12:00:00.100Z';
const T2 = '2026-08-10T12:00:00.200Z';
const T3 = '2026-08-10T12:00:00.300Z';
const T4 = '2026-08-10T12:00:00.400Z';
const T5 = '2026-08-10T12:00:00.500Z';

const REDACTION = {
  policy: 'detector-v1',
  reasons: ['masked-pattern'],
  spanCount: 1,
  maskedCodePoints: 1,
};

function truncation(text: string) {
  const retainedLength = Array.from(text).length;
  return { maxLength: 240, originalLength: retainedLength + 1, retainedLength };
}

function observation(
  index: number,
  value: Omit<EvidenceObservation, 'observationId' | 'eventId' | 'traceId' | 'rawCapturedAt'>,
): EvidenceObservation {
  return {
    observationId: `s2-observation-${index}`,
    eventId: `s2-event-${index}`,
    traceId: 's2-trace',
    rawCapturedAt: value.capturedAt,
    ...value,
  };
}

interface StreamingRecordOptions {
  schemaVersion?: string;
  messages?: unknown;
  requestStatus?: EvidenceObservation['evidenceStatus'];
  deltaText?: string;
  deltaStatus?: EvidenceObservation['evidenceStatus'];
  deltaRedaction?: unknown;
  deltaTruncation?: unknown;
  captureProfileVersion?: string;
  detectorVersion?: string;
}

// fallow-ignore-next-line complexity
function streamingRecord(options: StreamingRecordOptions = {}): EvidenceRecord {
  const messages = options.messages ?? [{ role: 'user', content: { text: 'hello', evidenceStatus: 'captured' } }];
  const requestStatus = options.requestStatus ?? 'captured';
  const deltaText = options.deltaText ?? 'world';
  const deltaStatus = options.deltaStatus ?? 'captured';
  const captureProfileVersion = options.captureProfileVersion ?? '1.0.0';
  const detectorVersion = options.detectorVersion ?? '1.0.0';
  const messageContent = requestStatus === 'truncated'
    || JSON.stringify(messages).includes('"truncation"')
    ? 'partially-retained' as const
    : 'fully-retained' as const;
  const deltaContent = deltaStatus === 'truncated' || options.deltaTruncation !== undefined
    ? 'partially-retained' as const
    : 'fully-retained' as const;
  const multimodalContentObserved = JSON.stringify(messages).includes('"image_url"');
  const source: EvidenceObservation[] = [
    observation(0, { seq: 0, kind: 'interaction_start', spanId: null, capturedAt: T0, evidenceStatus: 'captured', observationRole: null, payload: null }),
    observation(1, { seq: 1, kind: 'span_start', spanId: 's2-span', capturedAt: T1, evidenceStatus: 'captured', observationRole: null, payload: { span: { kind: 'model', name: 'model:test', parentSpanId: null } } }),
    observation(2, {
      seq: 2, kind: 'model_request', spanId: 's2-span', capturedAt: T2,
      evidenceStatus: requestStatus, observationRole: 'client_sent',
      payload: { requestEnvelope: { model: 'test', provider: 'openai-compatible', providerNativeFidelity: 'structurally_faithful', messages } },
    }),
    observation(3, {
      seq: 3, kind: 'model_response', spanId: 's2-span', capturedAt: T3,
      evidenceStatus: 'captured', observationRole: 'provider_reported',
      payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', responseMeta: { statusCode: 200, contentType: 'text/event-stream' } } },
    }),
    observation(4, {
      seq: 4, kind: 'model_response_chunk', spanId: 's2-span', capturedAt: T3,
      evidenceStatus: deltaStatus, observationRole: 'provider_reported',
      payload: {
        responseEnvelope: { providerNativeFidelity: 'structurally_faithful', choiceIndex: 0, chunkIndex: 0, deltaText, finishReason: 'stop' },
        ...(options.deltaRedaction !== undefined ? { redaction: options.deltaRedaction } : {}),
        ...(options.deltaTruncation !== undefined ? { truncation: options.deltaTruncation } : {}),
      },
    }),
    observation(5, { seq: 5, kind: 'span_end', spanId: 's2-span', capturedAt: T4, evidenceStatus: 'captured', observationRole: null, payload: { durationMs: 300 } }),
    observation(6, { seq: 6, kind: 'interaction_end', spanId: null, capturedAt: T5, evidenceStatus: 'captured', observationRole: null, payload: null }),
  ];
  const maskedContent = requestStatus === 'redacted' || deltaStatus === 'redacted';
  const streaming: StreamingCaptureBoundary = {
    upstream: { outcome: 'response-completed' },
    clientResponse: { outcome: 'flushed' },
    decoderDisposition: 'openai-sse',
    remainder: { knowledge: 'protocol-terminal-observed', lastObservedFramePosition: 2, rawForwardedBytes: 64 },
    losses: {
      requestBody: 'fully-observed-not-retained', messageContent, deltaContent,
      providerNative: 'not-retained', providerErrorBody: 'not-applicable', wireBytes: 'not-retained',
      postTerminalContent: 'none-observed', unmappedDeltaFields: [], unrecognizedExtensionFrameObserved: false,
      headerValuesBeyondAllowlist: false, contentTypeParametersDropped: false, maskedContent,
      contentEncodingUnsupported: false, multimodalContentObserved,
      requestMessageUnknownKeysObserved: false, unrecognizedRoleObserved: false,
      sseMetadataObservedButNotRetained: false,
    },
    assembly: {
      assembler: { name: 'signalglass.streaming.assembler', version: captureProfileVersion },
      decoderContract: { name: 'signalglass.providers.openai-sse', version: '1.0.0' },
    },
    captureProfile: { name: 'signalglass.collection.ingress-metadata-safe', version: captureProfileVersion },
    detector: { name: 'signalglass.collection.sensitive-detector', version: detectorVersion },
    budgets: {
      maxCanonicalEvents: 1_000, maxRawObservations: 2_000, maxRawObservationPayloadBytes: 1_048_576,
      maxRetainedContentCodePoints: 16_384, maxSerializedEvidenceBytes: 1_048_576, maxIdLengthBytes: 128,
    },
  };
  const boundary: CaptureBoundary = {
    captureSurface: 'ingress_proxy', observationBoundary: 'provider_reported',
    declaredEventKinds: source.map((item) => item.kind), declaredSurfaces: ['ingress_proxy'],
    missingRecord: null, streaming,
  };
  const normalized = normalizeEvidenceRecord(source, boundary, options.schemaVersion ?? '1.1.0');
  if (!normalized.ok) throw new Error(normalized.issues.map((issue) => `${issue.code}:${issue.path}`).join(';'));
  return normalized.record;
}

function legacyRecord(capturedMessages = false): EvidenceRecord {
  const source: EvidenceObservation[] = [
    observation(0, { seq: 0, kind: 'interaction_start', spanId: null, capturedAt: T0, evidenceStatus: 'captured', observationRole: null, payload: null }),
    observation(1, {
      seq: 1, kind: 'model_request', spanId: null, capturedAt: T1,
      evidenceStatus: capturedMessages ? 'captured' : 'redacted', observationRole: 'client_sent',
      payload: { requestEnvelope: { model: 'test', provider: 'openai-compatible', providerNativeFidelity: 'structurally_faithful', ...(capturedMessages ? { messages: [{ role: 'user', content: 'hello' }] } : {}) } },
    }),
    observation(2, { seq: 2, kind: 'interaction_end', spanId: null, capturedAt: T2, evidenceStatus: 'captured', observationRole: null, payload: null }),
  ];
  const boundary: CaptureBoundary = {
    captureSurface: 'ingress_proxy', observationBoundary: 'client_sent',
    declaredEventKinds: source.map((item) => item.kind), declaredSurfaces: ['ingress_proxy'], missingRecord: null,
  };
  const normalized = normalizeEvidenceRecord(source, boundary, '1.0.0', { captureProfile: { name: 'dev-basic', version: '1.0.0' } });
  if (!normalized.ok) throw new Error(normalized.issues.map((issue) => issue.code).join(';'));
  return normalized.record;
}

function capturedToolRecord(): EvidenceRecord {
  const source: EvidenceObservation[] = [
    observation(0, { seq: 0, kind: 'interaction_start', spanId: null, capturedAt: T0, evidenceStatus: 'captured', observationRole: null, payload: null }),
    observation(1, {
      seq: 1, kind: 'tool_call', spanId: null, capturedAt: T1, evidenceStatus: 'captured',
      observationRole: 'client_sent', payload: { tool: { name: 'lookup', arguments: { query: 'near-miss' } } },
    }),
    observation(2, { seq: 2, kind: 'interaction_end', spanId: null, capturedAt: T2, evidenceStatus: 'captured', observationRole: null, payload: null }),
  ];
  const boundary: CaptureBoundary = {
    captureSurface: 'client_side', observationBoundary: 'application_constructed',
    declaredEventKinds: source.map((item) => item.kind), declaredSurfaces: ['client_side'], missingRecord: null,
  };
  const normalized = normalizeEvidenceRecord(source, boundary, '1.1.0', { captureProfile: { name: 'dev-basic', version: '1.0.0' } });
  if (!normalized.ok) throw new Error(normalized.issues.map((issue) => `${issue.code}:${issue.path}`).join(';'));
  return normalized.record;
}

function minimal11Record(): EvidenceRecord {
  const source: EvidenceObservation[] = [
    observation(0, { seq: 0, kind: 'interaction_start', spanId: null, capturedAt: T0, evidenceStatus: 'captured', observationRole: null, payload: null }),
    observation(1, { seq: 1, kind: 'interaction_end', spanId: null, capturedAt: T1, evidenceStatus: 'captured', observationRole: null, payload: null }),
  ];
  const boundary: CaptureBoundary = {
    captureSurface: 'client_side', observationBoundary: 'application_constructed',
    declaredEventKinds: source.map((item) => item.kind), declaredSurfaces: ['client_side'], missingRecord: null,
  };
  const normalized = normalizeEvidenceRecord(source, boundary, '1.1.0', { captureProfile: { name: 'dev-basic', version: '1.0.0' } });
  if (!normalized.ok) throw new Error(normalized.issues.map((issue) => `${issue.code}:${issue.path}`).join(';'));
  return normalized.record;
}

const directories: string[] = [];
function storage(policy: PersistencePolicy): EvidenceStorage {
  const directory = mkdtempSync(join(tmpdir(), 'signalglass-s2-policy-'));
  directories.push(directory);
  return new EvidenceStorage({ databasePath: join(directory, 'evidence.db'), persistencePolicy: policy, now: () => T5 });
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Spec 016 S2 metadata-safe v1.1.0', () => {
  it('T88/T116 constructs explicit supported versions and rejects unavailable versions at construction', () => {
    expect(createMetadataSafePolicy().version).toBe('1.0.0');
    expect(createMetadataSafePolicy('1.0.0').version).toBe('1.0.0');
    expect(createMetadataSafePolicy('1.1.0').version).toBe('1.1.0');
    expect(() => createMetadataSafePolicy('1.2.0' as '1.1.0')).toThrow(StorageConfigError);
    const copiedReference = { ...createMetadataSafePolicy('1.1.0') };
    expect(() => storage(copiedReference)).toThrow(StorageConfigError);
  });

  it.each([
    ['redacted', { text: 'masked', evidenceStatus: 'redacted', redaction: REDACTION }],
    ['truncated', { text: 'short', evidenceStatus: 'truncated', truncation: truncation('short') }],
    ['masked and shortened', { text: 'short', evidenceStatus: 'redacted', redaction: REDACTION, truncation: truncation('short') }],
  ])('T91/T123 admits Rule 1 %s leaves from raw and canonical copies', (_name, leaf) => {
    const record = streamingRecord({ messages: [{ role: 'user', content: leaf }], requestStatus: leaf.evidenceStatus as 'redacted' | 'truncated' });
    const target = storage(createMetadataSafePolicy('1.1.0'));
    expect(target.saveEvidenceRecord(record).status).toBe('stored');
    target.close();
  });

  it('T91/T123 applies event-level declarations to the single deltaText leaf', () => {
    const text = 'short';
    const record = streamingRecord({ deltaText: text, deltaStatus: 'redacted', deltaRedaction: REDACTION, deltaTruncation: truncation(text) });
    const target = storage(createMetadataSafePolicy('1.1.0'));
    expect(target.saveEvidenceRecord(record).status).toBe('stored');
    target.close();
  });

  it.each([
    { name: 'string-form', content: { text: 'safe', evidenceStatus: 'captured' } },
    { name: 'text part', content: [{ kind: 'text', text: { text: 'safe', evidenceStatus: 'captured' } }] },
    { name: 'tool call', content: [{ kind: 'tool_call', id: 'call-1', name: 'lookup', arguments: { text: 'safe', evidenceStatus: 'captured' } }] },
    { name: 'tool result', content: [{ kind: 'tool_result', toolCallId: 'call-1', content: { text: 'safe', evidenceStatus: 'captured' } }] },
    { name: 'image URL', content: [{ kind: 'image_url', url: { text: 'https://example.invalid/image', evidenceStatus: 'captured' } }] },
  ])('T91 admits the closed Rule 2 request path: $name', ({ content }) => {
    const target = storage(createMetadataSafePolicy('1.1.0'));
    expect(target.saveEvidenceRecord(streamingRecord({ messages: [{ role: 'user', content }] })).status).toBe('stored');
    target.close();
  });

  it('T91 admits responseEnvelope.deltaText through Rule 2', () => {
    const target = storage(createMetadataSafePolicy('1.1.0'));
    expect(target.saveEvidenceRecord(streamingRecord({ deltaText: 'safe' })).status).toBe('stored');
    target.close();
  });

  it.each([
    ['239 BMP code points', 'x'.repeat(239), 'stored'],
    ['240 BMP code points', 'x'.repeat(240), 'stored'],
    ['241 BMP code points', 'x'.repeat(241), 'invalid'],
    ['240 astral code points', '🙂'.repeat(240), 'stored'],
    ['241 astral code points', '🙂'.repeat(241), 'invalid'],
  ])('T130/AC20 enforces the exact code-point cap: %s', (_name, text, expected) => {
    let record: EvidenceRecord | null = null;
    try {
      record = streamingRecord({ messages: [{ role: 'user', content: { text, evidenceStatus: 'captured' } }] });
    } catch {
      expect(expected).toBe('invalid');
      return;
    }
    const target = storage(createMetadataSafePolicy('1.1.0'));
    expect(target.saveEvidenceRecord(record).status).toBe(expected);
    target.close();
  });

  it.each([
    ['capture profile', { captureProfileVersion: '1.0.1' }],
    ['detector', { detectorVersion: '1.0.1' }],
  ])('T92 rejects a spoofed %s pedigree without changing the configured policy', (_name, options) => {
    const target = storage(createMetadataSafePolicy('1.1.0'));
    const outcome = target.saveEvidenceRecord(streamingRecord(options));
    expect(outcome).toMatchObject({ status: 'policy-rejected', code: 'captured-content', policy: { version: '1.1.0' } });
    target.close();
  });

  it('T92 rejects captured content at a non-admitted path', () => {
    const target = storage(createMetadataSafePolicy('1.1.0'));
    expect(target.saveEvidenceRecord(capturedToolRecord())).toMatchObject({ status: 'policy-rejected', code: 'captured-content' });
    target.close();
  });

  it('T92/T123 rejects forged aggregate ownership and missing/malformed declarations during structural validation', () => {
    const mismatched = () => streamingRecord({ messages: [{ role: 'user', content: { text: 'masked', evidenceStatus: 'redacted' } }], requestStatus: 'captured' });
    const malformed = () => streamingRecord({ messages: [{ role: 'user', content: { text: 'masked', evidenceStatus: 'redacted', redaction: { ...REDACTION, spanCount: 0 } } }], requestStatus: 'redacted' });
    expect(mismatched).toThrow();
    expect(malformed).toThrow();
  });

  it('T89/T90 keeps v1.0.0 whole-payload behavior and refuses 1.1-owned fields', () => {
    const v10 = createMetadataSafePolicy('1.0.0');
    const legacyAccepted = storage(v10);
    expect(legacyAccepted.saveEvidenceRecord(legacyRecord()).status).toBe('stored');
    legacyAccepted.close();
    const legacyRejected = storage(createMetadataSafePolicy('1.0.0'));
    expect(legacyRejected.saveEvidenceRecord(legacyRecord(true))).toMatchObject({ status: 'policy-rejected', code: 'captured-content' });
    legacyRejected.close();
    const streamingRejected = storage(createMetadataSafePolicy('1.0.0'));
    expect(streamingRejected.saveEvidenceRecord(streamingRecord())).toMatchObject({ status: 'policy-rejected', code: 'unknown-additive-field' });
    streamingRejected.close();
    const additiveSchemaWithoutOwnedFields = storage(createMetadataSafePolicy('1.0.0'));
    expect(additiveSchemaWithoutOwnedFields.saveEvidenceRecord(minimal11Record()).status).toBe('stored');
    additiveSchemaWithoutOwnedFields.close();
  });

  it('T153 delegates schema 1.0 semantics while retaining truthful v1.1 identity', () => {
    const record = legacyRecord(true);
    const v10 = storage(createMetadataSafePolicy('1.0.0'));
    const v11 = storage(createMetadataSafePolicy('1.1.0'));
    const oldOutcome = v10.saveEvidenceRecord(record);
    const newOutcome = v11.saveEvidenceRecord(record);
    expect(oldOutcome).toMatchObject({ status: 'policy-rejected', code: 'captured-content', policy: { version: '1.0.0' } });
    expect(newOutcome).toMatchObject({ status: 'policy-rejected', code: 'captured-content', policy: { version: '1.1.0' } });
    v10.close();
    v11.close();

    const acceptedByV10 = storage(createMetadataSafePolicy('1.0.0'));
    const acceptedByV11 = storage(createMetadataSafePolicy('1.1.0'));
    expect(acceptedByV10.saveEvidenceRecord(legacyRecord())).toMatchObject({
      status: 'stored', manifest: { persistencePolicy: { version: '1.0.0' } },
    });
    expect(acceptedByV11.saveEvidenceRecord(legacyRecord())).toMatchObject({
      status: 'stored', manifest: { persistencePolicy: { version: '1.1.0' } },
    });
    acceptedByV10.close();
    acceptedByV11.close();
  });

  it.each(['1.1.0', '1.2.7'])('T91 admits known 1.1 shapes in supported MAJOR-1 schema %s', (schemaVersion) => {
    const target = storage(createMetadataSafePolicy('1.1.0'));
    expect(target.saveEvidenceRecord(streamingRecord({ schemaVersion })).status).toBe('stored');
    target.close();
  });

  it('T93/AC33 preserves safety-gate precedence over bounded admission', () => {
    const target = storage(createMetadataSafePolicy('1.1.0'));
    const record = streamingRecord({ messages: [{ role: 'user', content: { text: 'Bearer example-value', evidenceStatus: 'captured' } }] });
    expect(target.saveEvidenceRecord(record)).toEqual({ status: 'safety-rejected', reasons: ['S1'] });
    target.close();
  });

  it('T88/AC33 records the deciding v1.1 policy in the manifest and preserves it on readback', () => {
    const target = storage(createMetadataSafePolicy('1.1.0'));
    const outcome = target.saveEvidenceRecord(streamingRecord());
    expect(outcome).toMatchObject({ status: 'stored', manifest: { persistencePolicy: { name: 'signalglass.persistence.metadata-safe', version: '1.1.0' } } });
    const read = target.getStoredEvidence('s2-trace');
    expect(read).toMatchObject({ ok: true, manifest: { persistencePolicy: { version: '1.1.0' } } });
    target.close();
  });

  it('T94/AC36 keeps policy failures closed and leak-free', () => {
    const throwing: PersistencePolicy = { name: 'example.throwing', version: '1.0.0', decide: () => { throw new Error('retained-value-sentinel'); } };
    const malformed: PersistencePolicy = { name: 'example.malformed', version: '1.0.0', decide: () => ({ accept: false, code: 'retained-value-sentinel' }) as unknown as PersistencePolicyDecision };
    const first = storage(throwing);
    const second = storage(malformed);
    expect(first.saveEvidenceRecord(streamingRecord())).toEqual({ status: 'policy-failed', policy: { name: 'example.throwing', version: '1.0.0' }, reason: 'exception' });
    expect(second.saveEvidenceRecord(streamingRecord())).toEqual({ status: 'policy-failed', policy: { name: 'example.malformed', version: '1.0.0' }, reason: 'malformed-decision' });
    first.close();
    second.close();
  });

  it('T91/AC34 is deterministic under repeated direct evaluation', () => {
    const policy = createMetadataSafePolicy('1.1.0');
    const record = streamingRecord();
    expect(policy.decide(record)).toEqual(policy.decide(record));
  });

  it('T130 rejects an over-cap leaf in the policy itself as well as at structural validation', () => {
    const policy = createMetadataSafePolicy('1.1.0');
    const record = streamingRecord({ messages: [{ role: 'user', content: { text: 'x'.repeat(240), evidenceStatus: 'captured' } }] });
    const rawRequest = record.rawObservations.find((item) => item.kind === 'model_request')!;
    const rawEnvelope = (rawRequest.payload as { requestEnvelope: { messages: Array<{ content: ContentLeaf }> } }).requestEnvelope;
    rawEnvelope.messages[0]!.content.text = 'x'.repeat(241);
    const event = record.trace.events.find((item) => item.kind === 'model_request')!;
    const projectedMessages = event.requestEnvelope.messages as Array<{ content: ContentLeaf }>;
    projectedMessages[0]!.content.text = 'x'.repeat(241);
    expect(policy.decide(record)).toEqual({ accept: false, code: 'captured-content' });
  });
});
