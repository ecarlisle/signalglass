import { describe, expect, it } from 'vitest';
import {
  CLIENT_REQUEST_FAILURE_CODES,
  INTERNAL_DECODER_FAILURE_CODES,
  MALFORMED_STREAM_CODES,
  OBSERVATION_FAILURE_CODES,
  UPSTREAM_FAILURE_CODES,
  parseEvidenceRecord,
  serializeEvidenceRecord,
  utf8Encode,
  type EvidenceObservation,
  type StreamingLossFacts,
} from '@signalglass/evidence';
import {
  DEFAULT_EVIDENCE_BUDGETS,
  FAILURE_CLASSIFICATION,
  assembleTrace,
  classifyFailureCode,
  countBudgetAllows,
  normalizeRequestMessages,
  retainText,
  measureFinalizableSnapshotBytes,
  type AssemblerOptions,
} from './index.js';

const BASE_LOSSES: StreamingLossFacts = {
  requestBody: 'fully-observed-not-retained',
  messageContent: 'fully-retained',
  deltaContent: 'not-observed',
  providerNative: 'not-retained',
  providerErrorBody: 'not-applicable',
  wireBytes: 'not-retained',
  postTerminalContent: 'none-observed',
  unmappedDeltaFields: [],
  unrecognizedExtensionFrameObserved: false,
  headerValuesBeyondAllowlist: false,
  contentTypeParametersDropped: false,
  maskedContent: false,
  contentEncodingUnsupported: false,
  multimodalContentObserved: false,
  requestMessageUnknownKeysObserved: false,
  unrecognizedRoleObserved: false,
  sseMetadataObservedButNotRetained: false,
};

function options(overrides: Partial<AssemblerOptions> = {}): AssemblerOptions {
  const values = Array.from({ length: 32 }, (_, index) => index);
  return {
    traceId: 'trace-s4', interactionId: 'trace-s4', modelSpanId: 'span-model',
    provider: 'openai', model: 'gpt-test', requestMessages: [{ role: 'user', content: 'hello' }],
    responseMeta: { statusCode: 200, contentType: 'text/event-stream' },
    decodedEvents: [
      { kind: 'chunk', choiceIndex: 0, chunkIndex: 0, delta: 'world', finishReason: 'stop' },
      { kind: 'usage', inputTokens: 0, outputTokens: 1, totalTokens: 1 },
    ],
    terminal: { kind: 'completed' },
    boundaryFacts: {
      upstream: { outcome: 'response-completed' }, clientResponse: { outcome: 'flushed' },
      decoderDisposition: 'openai-sse',
      remainder: { knowledge: 'protocol-terminal-observed', lastObservedFramePosition: 3, rawForwardedBytes: 48 },
      losses: BASE_LOSSES,
    },
    ids: { eventIds: values.map((n) => `event-${n}`), observationIds: values.map((n) => `observation-${n}`) },
    capturedAtBySeq: values.map((n) => `2026-08-11T12:00:${String(n).padStart(2, '0')}.000Z`),
    finalizationBundle: [
      { eventId: 'terminal-event-1', observationId: 'terminal-observation-1', capturedAt: '2026-08-11T12:01:00.000Z' },
      { eventId: 'terminal-event-2', observationId: 'terminal-observation-2', capturedAt: '2026-08-11T12:01:01.000Z' },
    ],
    evidenceBudgets: DEFAULT_EVIDENCE_BUDGETS,
    ...overrides,
  };
}

describe('Spec 016 S4 assembler', () => {
  it('assembles a deterministic completed trace with exact event placement', () => {
    const first = assembleTrace(options());
    const second = assembleTrace(options());
    expect(first).toEqual(second);
    expect(parseEvidenceRecord(first.record)).toEqual({ ok: true, record: first.record });
    expect(first.trace.events.map((event) => event.kind)).toEqual([
      'interaction_start', 'model_request', 'span_start', 'model_response',
      'model_response_chunk', 'model_usage', 'span_end', 'interaction_end',
    ]);
    expect(first.trace.events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(first.trace.status).toBe('completed');
    expect(first.trace.events.at(-1)?.kind).toBe('interaction_end');
    const response = first.trace.events.find((event) => event.kind === 'model_response');
    expect(response?.responseEnvelope.responseMeta).toEqual({ statusCode: 200, contentType: 'text/event-stream' });
    const chunk = first.trace.events.find((event) => event.kind === 'model_response_chunk');
    expect(chunk?.responseEnvelope).toMatchObject({ choiceIndex: 0, chunkIndex: 0, deltaText: 'world', finishReason: 'stop' });
    const usage = first.trace.events.find((event) => event.kind === 'model_usage');
    expect(usage?.usage.inputTokens).toEqual({ value: 0, evidenceStatus: 'captured' });
    expect(measureFinalizableSnapshotBytes(first.record)).toBe(utf8Encode(serializeEvidenceRecord(first.record)).byteLength);
  });

  it('emits every non-completed terminal as the final event without interaction_end', () => {
    const cases = [
      [{ kind: 'upstream-failed', code: 'connection-error' }, 'error', 'failed', { outcome: 'connection-failed' }, { outcome: 'closed-before-completion' }],
      [{ kind: 'malformed-stream', code: 'sse-invalid-data-json' }, 'error', 'failed', { outcome: 'stream-ended-prematurely' }, { outcome: 'closed-before-completion' }],
      [{ kind: 'client-cancelled' }, 'cancelled', 'cancelled', { outcome: 'cancelled-by-ingress', cause: 'client-disconnect' }, { outcome: 'closed-before-completion' }],
      [{ kind: 'ingress-cancelled' }, 'cancelled', 'cancelled', { outcome: 'cancelled-by-ingress', cause: 'ingress-shutdown' }, { outcome: 'closed-before-completion' }],
      [{ kind: 'observation-detached', code: 'internal-capture-error' }, 'error', 'unknown', { outcome: 'response-completed' }, { outcome: 'flushed' }],
    ] as const;
    for (const [terminal, finalKind, status, upstream, clientResponse] of cases) {
      const result = assembleTrace(options({ terminal, boundaryFacts: { ...options().boundaryFacts, upstream, clientResponse } }));
      expect(result.trace.events.at(-1)?.kind).toBe(finalKind);
      expect(result.trace.events.some((event) => event.kind === 'interaction_end')).toBe(false);
      expect(result.trace.status).toBe(status);
    }
  });

  it('uses the closed request-failed two-event sequence', () => {
    const result = assembleTrace(options({
      terminal: { kind: 'request-failed', code: 'missing-api-key' },
      responseMeta: undefined,
      decodedEvents: [],
      boundaryFacts: {
        upstream: { outcome: 'not-started' }, clientResponse: { outcome: 'not-started' },
        decoderDisposition: 'not-applicable', remainder: { knowledge: 'not-applicable' },
        losses: { ...BASE_LOSSES, providerNative: 'not-applicable', wireBytes: 'not-applicable', messageContent: 'omitted' },
      },
    }));
    expect(result.trace.events.map((event) => event.kind)).toEqual(['interaction_start', 'error']);
    expect(result.trace.events.at(-1)).toMatchObject({ actor: 'capture', error: { type: 'missing-api-key' } });
  });

  it('masks before truncating and preserves leaf-owned declarations', () => {
    const secret = `sk-${'a'.repeat(40)}`;
    const retained = retainText(`${'x'.repeat(230)}${secret}`);
    expect(retained.leaf.evidenceStatus).toBe('redacted');
    expect(retained.leaf.redaction).toMatchObject({ spanCount: 1 });
    expect(retained.leaf.text).not.toContain(secret);
    const mixed = normalizeRequestMessages([{ role: 'future-role', content: [
      { type: 'text', text: 'safe' },
      { type: 'text', text: 'z'.repeat(241) },
      { type: 'text', text: secret },
    ] }]);
    expect(mixed.status).toBe('redacted');
    expect(mixed.unrecognizedRoleObserved).toBe(true);
    expect(mixed.messages[0]?.role).toBe('unrecognized');
    expect(JSON.stringify(mixed)).not.toContain('future-role');
  });

  it('classifies every closed failure code exactly once', () => {
    expect(classifyFailureCode('invalid-request')).toBe('request-failed');
    expect(classifyFailureCode('provider-error-frame')).toBe('upstream-failed');
    expect(classifyFailureCode('sse-invalid-choice-index')).toBe('malformed-stream');
    expect(classifyFailureCode('record-budget-exceeded')).toBe('observation-detached');
    expect(classifyFailureCode('decode-error')).toBe('observation-detached');
    const rows = Object.values(FAILURE_CLASSIFICATION).flat();
    const expected = [
      ...CLIENT_REQUEST_FAILURE_CODES,
      ...UPSTREAM_FAILURE_CODES,
      ...MALFORMED_STREAM_CODES,
      ...OBSERVATION_FAILURE_CODES,
      ...INTERNAL_DECODER_FAILURE_CODES,
    ];
    expect(rows).toHaveLength(new Set(rows).size);
    expect(new Set(rows)).toEqual(new Set(expected));
    for (const code of expected) expect(classifyFailureCode(code)).toBeTruthy();
  });

  it('derives closed loss facts from decoder categories and metadata normalization', () => {
    const result = assembleTrace(options({
      responseMeta: { statusCode: 200, contentType: 'Text/Event-Stream; charset=utf-8' },
      decodedEvents: [{
        kind: 'chunk', choiceIndex: 3, chunkIndex: 0, delta: null,
        unmappedDeltaFields: ['role', 'per-choice-usage', 'other-extension'],
      }],
    }));
    expect(result.boundary.streaming?.losses.unmappedDeltaFields).toEqual(['role', 'per-choice-usage', 'other-extension']);
    expect(result.boundary.streaming?.losses.contentTypeParametersDropped).toBe(true);
    expect(result.trace.events.find((event) => event.kind === 'model_response')?.responseEnvelope.responseMeta).toEqual({
      statusCode: 200, contentType: 'text/event-stream',
    });
    expect(JSON.stringify(result.record)).not.toContain('charset=utf-8');
  });

  it('makes a decoded provider error the first terminal and retains no provider body', () => {
    const result = assembleTrace(options({
      decodedEvents: [
        { kind: 'chunk', choiceIndex: 0, chunkIndex: 0, delta: 'before' },
        { kind: 'provider-error', code: 'provider-error-frame', description: 'Provider reported an error.' },
        { kind: 'chunk', choiceIndex: 0, chunkIndex: 1, delta: 'after' },
      ],
      terminal: { kind: 'completed' },
    }));
    expect(result.warnings).toContain('provider-error-terminal-overrode-input');
    expect(result.trace.events.filter((event) => event.kind === 'model_response_chunk')).toHaveLength(1);
    expect(result.trace.events.at(-1)).toMatchObject({ kind: 'error', error: { type: 'provider-error-frame' } });
    expect(result.boundary.streaming?.losses.providerErrorBody).toBe('not-retained');
  });

  it('admits an exact Spec 014 replay as raw-only duplicate evidence', () => {
    const baseline = assembleTrace(options());
    const original = baseline.record.rawObservations[4]!;
    const replay = {
      ...original,
      observationId: 'replay-observation',
      rawCapturedAt: '2026-08-11T12:00:59.000Z',
    };
    const result = assembleTrace(options({ additionalRawObservations: [replay] }));
    expect(result.record.rawObservations).toHaveLength(baseline.record.rawObservations.length + 1);
    expect(result.trace.events).toHaveLength(baseline.trace.events.length);
    expect(result.record.analysis.duplicateObservations).toMatchObject([
      { classification: 'exact_replay', eventId: original.eventId, seq: original.seq },
    ]);
    expect(result.trace.events.at(-1)?.seq).toBe(baseline.trace.events.at(-1)?.seq);
  });

  it.each([
    ['same-id conflict', (original: EvidenceObservation) => ({
      ...original,
      observationId: 'conflicting-observation',
      payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', choiceIndex: 0, chunkIndex: 0, deltaText: 'different' } },
      rawCapturedAt: '2026-08-11T12:00:59.000Z',
    })],
    ['same-sequence collision', (original: EvidenceObservation) => ({
      ...original,
      observationId: 'colliding-observation',
      eventId: 'colliding-event',
      rawCapturedAt: '2026-08-11T12:00:59.000Z',
    })],
  ])('routes %s separately from budget exhaustion and rolls back atomically', (_name, mutate) => {
    const baseline = assembleTrace(options());
    const rejected = mutate(baseline.record.rawObservations[4]!);
    const result = assembleTrace(options({ additionalRawObservations: [rejected] }));
    expect(result.warnings).toContain('candidate-structurally-rejected');
    expect(result.warnings).not.toContain('candidate-budget-rejected');
    expect(result.record.rawObservations.some((observation) => observation.observationId === rejected.observationId)).toBe(false);
    expect(result.trace.events.at(-1)).toMatchObject({
      kind: 'error', actor: 'capture', lifecycleTarget: 'none', lifecycleEffect: 'none',
      error: { type: 'internal-capture-error' },
    });
  });

  it('uses state-dependent terminal suffix count reservations', () => {
    const budgets = { ...DEFAULT_EVIDENCE_BUDGETS, maxCanonicalEvents: 1_000, maxRawObservations: 2_000 };
    expect(countBudgetAllows(998, 1_998, budgets, 'completion-possible')).toBe(true);
    expect(countBudgetAllows(999, 1_998, budgets, 'completion-possible')).toBe(false);
    expect(countBudgetAllows(999, 1_999, budgets, 'span-closed')).toBe(true);
  });

  it('rejects a content-budget candidate atomically and spends only the reserved detach suffix', () => {
    const chunkCount = 69;
    const count = chunkCount + 24;
    const values = Array.from({ length: count }, (_, index) => index);
    const result = assembleTrace(options({
      requestMessages: [],
      decodedEvents: values.slice(0, chunkCount).map((index) => ({
        kind: 'chunk' as const, choiceIndex: 0, chunkIndex: index, delta: 'x'.repeat(240),
      })),
      ids: { eventIds: values.map((n) => `event-${n}`), observationIds: values.map((n) => `observation-${n}`) },
      capturedAtBySeq: values.map((n) => new Date(Date.UTC(2026, 7, 11, 12, 0, 0, n)).toISOString()),
      evidenceBudgets: { ...DEFAULT_EVIDENCE_BUDGETS, maxRetainedContentCodePoints: 16_384 },
    }));
    expect(result.warnings).toContain('candidate-budget-rejected');
    expect(result.trace.events.at(-1)).toMatchObject({ kind: 'error', error: { type: 'record-budget-exceeded' } });
    expect(result.trace.events.filter((event) => event.kind === 'model_response_chunk')).toHaveLength(68);
  }, 15_000);
});
