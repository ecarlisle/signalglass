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
  FAILURE_CLASSIFICATION_ROWS,
  assembleTrace,
  classifyFailureCode,
  countBudgetAllows,
  normalizeRequestMessages,
  retainText,
  measureFinalizableSnapshotBytes,
  type AssemblerOptions,
  type AssemblyTerminal,
  type TerminalBoundaryPreview,
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

function previewFacts(
  losses: StreamingLossFacts,
  overrides: Partial<AssemblerOptions['boundaryFacts']>,
): AssemblerOptions['boundaryFacts'] {
  return {
    upstream: { outcome: 'response-completed' },
    clientResponse: { outcome: 'flushed' },
    decoderDisposition: 'openai-sse',
    remainder: { knowledge: 'protocol-terminal-observed', lastObservedFramePosition: 3, rawForwardedBytes: 48 },
    losses,
    ...overrides,
  };
}

function terminalBoundaryPreviews(losses: StreamingLossFacts): readonly TerminalBoundaryPreview[] {
  const sse = (terminal: AssemblyTerminal, overrides: Partial<AssemblerOptions['boundaryFacts']> = {}): TerminalBoundaryPreview => ({
    terminal,
    boundaryFacts: previewFacts(losses, overrides),
  });
  const detached = (code: typeof OBSERVATION_FAILURE_CODES[number] | 'decode-error'): TerminalBoundaryPreview =>
    sse({ kind: 'observation-detached', code }, { remainder: { knowledge: 'unknown', lastObservedFramePosition: 3, rawForwardedBytes: 48 } });
  return [
    sse({ kind: 'completed' }),
    sse({ kind: 'completed' }, { clientResponse: { outcome: 'closed-before-completion' } }),
    ...UPSTREAM_FAILURE_CODES.flatMap((code): TerminalBoundaryPreview[] => {
      if (code === 'http-error-status') return [sse({ kind: 'upstream-failed', code }, {
        clientResponse: { outcome: 'local-error-flushed' }, decoderDisposition: 'not-applicable',
        remainder: { knowledge: 'transport-eof-observed' },
        losses: { ...losses, providerErrorBody: 'not-retained' },
      })];
      if (code === 'non-sse-response') return [sse({ kind: 'upstream-failed', code }, {
        decoderDisposition: 'not-applicable', remainder: { knowledge: 'transport-eof-observed' },
      })];
      if (code === 'provider-error-frame') return [sse({ kind: 'upstream-failed', code }, {
        losses: { ...losses, providerErrorBody: 'not-retained' },
      })];
      return [
        sse({ kind: 'upstream-failed', code }, {
          upstream: { outcome: 'connection-failed' }, clientResponse: { outcome: 'local-error-flushed' },
          decoderDisposition: 'not-applicable', remainder: { knowledge: 'unknown' },
        }),
        sse({ kind: 'upstream-failed', code }, {
          upstream: { outcome: 'stream-ended-prematurely' }, clientResponse: { outcome: 'closed-before-completion' },
          remainder: { knowledge: 'unknown', lastObservedFramePosition: 3, rawForwardedBytes: 48 },
        }),
      ];
    }),
    ...MALFORMED_STREAM_CODES.flatMap((code): TerminalBoundaryPreview[] => [
      sse({ kind: 'malformed-stream', code }, {
        remainder: { knowledge: code === 'sse-partial-frame-at-eof' || code === 'sse-eof-without-done'
          ? 'transport-eof-observed' : 'protocol-terminal-observed' },
      }),
      sse({ kind: 'malformed-stream', code }, {
        clientResponse: { outcome: 'closed-before-completion' },
        remainder: { knowledge: code === 'sse-partial-frame-at-eof' || code === 'sse-eof-without-done'
          ? 'transport-eof-observed' : 'protocol-terminal-observed' },
      }),
    ]),
    ...CLIENT_REQUEST_FAILURE_CODES.flatMap((code): TerminalBoundaryPreview[] => [
      sse({ kind: 'request-failed', code }, {
        upstream: { outcome: 'not-started' }, clientResponse: { outcome: 'not-started' },
        decoderDisposition: 'not-applicable', remainder: { knowledge: 'not-applicable' },
        losses: { ...losses, messageContent: 'omitted', deltaContent: 'not-observed', providerNative: 'not-applicable', providerErrorBody: 'not-applicable', wireBytes: 'not-applicable', unmappedDeltaFields: [], sseMetadataObservedButNotRetained: false, contentTypeParametersDropped: false },
      }),
      sse({ kind: 'request-failed', code }, {
        upstream: { outcome: 'not-started' }, clientResponse: { outcome: 'local-error-flushed' },
        decoderDisposition: 'not-applicable', remainder: { knowledge: 'not-applicable' },
        losses: { ...losses, messageContent: 'omitted', deltaContent: 'not-observed', providerNative: 'not-applicable', providerErrorBody: 'not-applicable', wireBytes: 'not-applicable', unmappedDeltaFields: [], sseMetadataObservedButNotRetained: false, contentTypeParametersDropped: false },
      }),
    ]),
    sse({ kind: 'client-cancelled' }, {
      upstream: { outcome: 'cancelled-by-ingress', cause: 'client-disconnect' }, clientResponse: { outcome: 'not-started' },
      decoderDisposition: 'not-applicable', remainder: { knowledge: 'unknown' },
    }),
    sse({ kind: 'client-cancelled' }, {
      upstream: { outcome: 'cancelled-by-ingress', cause: 'client-disconnect' }, clientResponse: { outcome: 'closed-before-completion' },
      remainder: { knowledge: 'unknown', lastObservedFramePosition: 3, rawForwardedBytes: 48 },
    }),
    ...(['ingress-shutdown', 'configured-limit'] as const).flatMap((cause): TerminalBoundaryPreview[] => [
      sse({ kind: 'ingress-cancelled' }, {
        upstream: { outcome: 'cancelled-by-ingress', cause }, clientResponse: { outcome: 'not-started' },
        decoderDisposition: 'not-applicable', remainder: { knowledge: 'unknown' },
      }),
      sse({ kind: 'ingress-cancelled' }, {
        upstream: { outcome: 'cancelled-by-ingress', cause }, clientResponse: { outcome: 'closed-before-completion' },
        remainder: { knowledge: 'unknown', lastObservedFramePosition: 3, rawForwardedBytes: 48 },
      }),
    ]),
    ...OBSERVATION_FAILURE_CODES.map(detached),
    ...INTERNAL_DECODER_FAILURE_CODES.map(detached),
  ];
}

function options(overrides: Partial<AssemblerOptions> = {}): AssemblerOptions {
  const values = Array.from({ length: 32 }, (_, index) => index);
  const base: Omit<AssemblerOptions, 'terminalBoundaryPreviews'> = {
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
  };
  const merged = { ...base, ...overrides } as Omit<AssemblerOptions, 'terminalBoundaryPreviews'>;
  const decodedDeltas = merged.decodedEvents.filter((event) => event.kind === 'chunk' && event.delta !== null);
  const previewLosses: StreamingLossFacts = merged.initialState !== undefined || decodedDeltas.length === 0
    ? merged.boundaryFacts.losses
    : {
      ...merged.boundaryFacts.losses,
      deltaContent: decodedDeltas.some((event) => retainText(event.delta!).truncated)
        ? 'partially-retained'
        : 'fully-retained',
    };
  return {
    ...merged,
    terminalBoundaryPreviews: overrides.terminalBoundaryPreviews
      ?? terminalBoundaryPreviews(previewLosses),
  };
}

function resumedOptions(
  observations: readonly EvidenceObservation[],
  state: 'completion-possible' | 'span-closed',
  overrides: Partial<AssemblerOptions> = {},
): AssemblerOptions {
  const base = options();
  const hasDelta = observations.some((observation) => observation.kind === 'model_response_chunk'
    && typeof (observation.payload['responseEnvelope'] as Record<string, unknown> | undefined)?.['deltaText'] === 'string');
  return options({
    decodedEvents: [],
    requestMessages: [],
    initialState: { observations, state },
    boundaryFacts: {
      ...base.boundaryFacts,
      losses: { ...base.boundaryFacts.losses, deltaContent: hasDelta ? 'fully-retained' : 'not-observed' },
    },
    ...overrides,
  });
}

function rawPayloadByteLength(observation: EvidenceObservation): number {
  return utf8Encode(JSON.stringify(observation.payload)).byteLength;
}

const RESUMED_CAPACITY_PADDING = { padding: 'x'.repeat(5_100_000) };

function withResumedCapacityPadding(
  observations: readonly EvidenceObservation[],
): readonly EvidenceObservation[] {
  return observations.map((observation) => observation.kind === 'model_request'
    ? {
      ...observation,
      payload: {
        ...observation.payload,
        requestEnvelope: {
          ...observation.payload['requestEnvelope'] as Record<string, unknown>,
          providerNative: RESUMED_CAPACITY_PADDING,
        },
      },
    }
    : observation);
}

let cachedContentBudgetRejection: ReturnType<typeof assembleTrace> | undefined;
function contentBudgetRejection(): ReturnType<typeof assembleTrace> {
  if (cachedContentBudgetRejection !== undefined) return cachedContentBudgetRejection;
  const values = Array.from({ length: 100 }, (_, index) => index);
  cachedContentBudgetRejection = assembleTrace(options({
    requestMessages: [],
    decodedEvents: values.slice(0, 69).map((index) => ({
      kind: 'chunk' as const, choiceIndex: 0, chunkIndex: index, delta: 'x'.repeat(240),
    })),
    ids: { eventIds: values.map((n) => `event-${n}`), observationIds: values.map((n) => `observation-${n}`) },
    capturedAtBySeq: values.map((n) => new Date(Date.UTC(2026, 7, 11, 12, 0, 0, n)).toISOString()),
    evidenceBudgets: { ...DEFAULT_EVIDENCE_BUDGETS, maxRetainedContentCodePoints: 16_384 },
  }));
  return cachedContentBudgetRejection;
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
    expect(first.record.rawObservations.find((observation) =>
      observation.kind === 'interaction_start')?.payload).toBeNull();
    expect(first.record.rawObservations.find((observation) =>
      observation.kind === 'interaction_end')?.payload).toBeNull();
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

  it('uses the effective provider-error terminal for exact candidate admission and rollback finalization', () => {
    const providerNative = { padding: 'x'.repeat(1_050_000) };
    const candidate: EvidenceObservation = {
      observationId: 'provider-error-large-observation',
      eventId: 'provider-error-large-event',
      traceId: 'trace-s4',
      spanId: 'span-model',
      seq: 4,
      kind: 'model_response_chunk',
      capturedAt: '2026-08-11T12:00:04.000Z',
      evidenceStatus: 'captured',
      observationRole: 'provider_reported',
      payload: {
        responseEnvelope: {
          providerNativeFidelity: 'structurally_faithful',
          providerNative,
          choiceIndex: 0,
          chunkIndex: 0,
          deltaText: 'x',
        },
      },
      rawCapturedAt: '2026-08-11T12:00:04.000Z',
    };
    const base = options();
    const roomyOptions = options({
      decodedEvents: [{ kind: 'provider-error', code: 'provider-error-frame', description: 'not retained' }],
      terminal: { kind: 'completed' },
      additionalRawObservations: [candidate],
      boundaryFacts: {
        ...base.boundaryFacts,
        losses: { ...base.boundaryFacts.losses, deltaContent: 'fully-retained', providerNative: 'retained' },
      },
      evidenceBudgets: {
        ...DEFAULT_EVIDENCE_BUDGETS,
        maxRawObservationPayloadBytes: 67_108_864,
        maxSerializedEvidenceBytes: 67_108_864,
      },
    });
    const roomy = assembleTrace(roomyOptions);
    expect(roomy.budgetMeasurements.terminalAlternatives).toContainEqual(expect.objectContaining({
      terminal: { kind: 'upstream-failed', code: 'provider-error-frame' },
      boundary: roomy.boundary,
    }));
    const exactSerialized = roomy.budgetMeasurements.maximumFinalizableSnapshotBytes;
    const exactRaw = roomy.budgetMeasurements.preterminalRawObservationPayloadBytes
      + roomy.budgetMeasurements.maximumFinalizableRawPayloadBytes;
    const preliminaryBudgets = {
      ...DEFAULT_EVIDENCE_BUDGETS,
      maxRawObservationPayloadBytes: exactRaw,
      maxSerializedEvidenceBytes: exactSerialized,
    };
    const preliminary = assembleTrace({ ...roomyOptions, evidenceBudgets: preliminaryBudgets });
    const stableRaw = preliminary.budgetMeasurements.preterminalRawObservationPayloadBytes
      + preliminary.budgetMeasurements.maximumFinalizableRawPayloadBytes;
    const stableSerialized = preliminary.budgetMeasurements.maximumFinalizableSnapshotBytes;
    const exactBudgets = {
      ...DEFAULT_EVIDENCE_BUDGETS,
      maxRawObservationPayloadBytes: stableRaw,
      maxSerializedEvidenceBytes: stableSerialized,
    };
    const exact = assembleTrace({ ...roomyOptions, evidenceBudgets: exactBudgets });
    expect(exact.warnings).not.toContain('candidate-budget-rejected');
    expect(exact.trace.events.at(-1)).toMatchObject({ error: { type: 'provider-error-frame' } });
    expect(exact.budgetMeasurements.maximumFinalizableSnapshotBytes).toBe(stableSerialized);
    expect(exact.budgetMeasurements.actualSerializedEvidenceBytes).toBeLessThanOrEqual(stableSerialized);

    const minimallyOver = assembleTrace({
      ...roomyOptions,
      evidenceBudgets: { ...exactBudgets, maxSerializedEvidenceBytes: stableSerialized - 1 },
    });
    expect(minimallyOver.warnings).toContain('candidate-budget-rejected');
    expect(minimallyOver.record.rawObservations.some((observation) =>
      observation.observationId === candidate.observationId)).toBe(false);
    expect(minimallyOver.trace.events.at(-1)).toMatchObject({ error: { type: 'record-budget-exceeded' } });
    expect(minimallyOver.budgetMeasurements.actualSerializedEvidenceBytes).toBeLessThan(stableSerialized);

    const rejected = assembleTrace({
      ...roomyOptions,
      evidenceBudgets: exactBudgets,
      additionalRawObservations: [candidate, {
        ...candidate,
        observationId: 'provider-error-over-budget-observation',
        eventId: 'provider-error-over-budget-event',
        seq: 5,
        rawCapturedAt: '2026-08-11T12:00:05.000Z',
      }],
    });
    expect(rejected.warnings).toContain('candidate-budget-rejected');
    expect(rejected.trace.events.at(-1)).toMatchObject({ error: { type: 'record-budget-exceeded' } });
    expect(rejected.record.rawObservations.some((observation) =>
      observation.observationId === 'provider-error-over-budget-observation')).toBe(false);
    expect(rejected.boundary.streaming?.losses.providerNative).toBe('retained');
    expect(rejected.budgetMeasurements.actualSerializedEvidenceBytes).toBeLessThanOrEqual(stableSerialized);
    expect(rejected.budgetMeasurements.rawObservationPayloadBytes).toBeLessThanOrEqual(stableRaw);
  }, 30_000);

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

  it('does not claim retained delta text after detaching behind a role-only chunk', () => {
    const roleOnly = options({
      decodedEvents: [{
        kind: 'chunk', choiceIndex: 0, chunkIndex: 0, delta: null,
        unmappedDeltaFields: ['role'],
      }],
    });
    const baseline = assembleTrace(roleOnly);
    const chunk = baseline.record.rawObservations.find((observation) =>
      observation.kind === 'model_response_chunk')!;
    const result = assembleTrace({
      ...roleOnly,
      additionalRawObservations: [{
        ...chunk,
        observationId: 'role-only-sequence-collision',
        eventId: 'role-only-sequence-collision-event',
      }],
    });

    expect(result.warnings).toContain('candidate-structurally-rejected');
    expect(result.boundary.streaming?.losses.deltaContent).toBe('not-observed');
    expect(result.trace.events.find((event) =>
      event.kind === 'model_response_chunk')?.responseEnvelope.deltaText).toBeUndefined();
  });

  it('uses state-dependent terminal suffix count reservations', () => {
    const budgets = { ...DEFAULT_EVIDENCE_BUDGETS, maxCanonicalEvents: 1_000, maxRawObservations: 2_000 };
    expect(countBudgetAllows(998, 1_998, budgets, 'completion-possible')).toBe(true);
    expect(countBudgetAllows(999, 1_998, budgets, 'completion-possible')).toBe(false);
    expect(countBudgetAllows(999, 1_999, budgets, 'span-closed')).toBe(true);
  });

  it('rejects a content-budget candidate atomically and spends only the reserved detach suffix', () => {
    const result = contentBudgetRejection();
    expect(result.warnings).toContain('candidate-budget-rejected');
    expect(result.trace.events.at(-1)).toMatchObject({ kind: 'error', error: { type: 'record-budget-exceeded' } });
    expect(result.trace.events.filter((event) => event.kind === 'model_response_chunk')).toHaveLength(68);
  }, 15_000);

  it('T144 measures the exact persistence serializer for escaping, astral UTF-8, and mixed text', () => {
    const mixed = 'quote=" slash=\\ newline=\n astral=😀 accents=é漢字';
    const result = assembleTrace(options({
      requestMessages: [{ role: 'user', content: mixed }],
      decodedEvents: [{ kind: 'chunk', choiceIndex: 0, chunkIndex: 0, delta: mixed }],
    }));
    const document = serializeEvidenceRecord(result.record);
    expect(result.budgetMeasurements.actualSerializedEvidenceBytes).toBe(utf8Encode(document).byteLength);
    expect(measureFinalizableSnapshotBytes(result.record)).toBe(utf8Encode(document).byteLength);
    expect(document).toContain('\\n');
    expect(document).toContain('😀');
  });

  it('T145/T163 accepts exact serialized/raw replay boundaries and rejects boundary minus one', () => {
    const baseline = assembleTrace(options());
    const preterminal = baseline.record.rawObservations.slice(0, -2).map((observation) =>
      observation.kind === 'model_response_chunk'
        ? {
          ...observation,
          payload: {
            ...observation.payload,
            responseEnvelope: {
              ...observation.payload['responseEnvelope'] as object,
              providerNative: { padding: 'x'.repeat(45_000) },
            },
          },
        }
        : observation);
    const source = preterminal.find((observation) => observation.kind === 'model_response_chunk')!;
    const replays = Array.from({ length: 25 }, (_, index): EvidenceObservation => ({
      ...source,
      observationId: `boundary-replay-${String(index).padStart(4, '0')}-${'i'.repeat(80)}`,
      rawCapturedAt: `2026-08-11T17:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
    }));
    const candidate: EvidenceObservation = {
      ...source,
      observationId: `boundary-candidate-${'i'.repeat(80)}`,
      rawCapturedAt: '2026-08-11T18:00:00.000Z',
    };
    const boundaryFacts = {
      ...options().boundaryFacts,
      losses: {
        ...options().boundaryFacts.losses,
        deltaContent: 'fully-retained' as const,
        providerNative: 'retained' as const,
      },
    };
    const roomyOptions = resumedOptions([...preterminal, ...replays], 'completion-possible', {
      boundaryFacts,
      additionalRawObservations: [candidate],
      evidenceBudgets: {
        ...DEFAULT_EVIDENCE_BUDGETS,
        maxCanonicalEvents: 1_000,
        maxRawObservations: 2_000,
        maxRawObservationPayloadBytes: 67_108_864,
        maxSerializedEvidenceBytes: 67_108_864,
      },
    });
    const roomy = assembleTrace(roomyOptions);
    const exactSerialized = roomy.budgetMeasurements.maximumFinalizableSnapshotBytes;
    const exactRaw = roomy.budgetMeasurements.preterminalRawObservationPayloadBytes
      + roomy.budgetMeasurements.maximumFinalizableRawPayloadBytes;
    expect(exactSerialized).toBeGreaterThanOrEqual(1_048_576);
    expect(exactRaw).toBeGreaterThanOrEqual(1_048_576);

    const stableSerialized = exactSerialized - 2;
    const stable = assembleTrace({ ...roomyOptions,
      evidenceBudgets: {
        ...DEFAULT_EVIDENCE_BUDGETS,
        maxCanonicalEvents: 1_000,
        maxRawObservations: 2_000,
        maxRawObservationPayloadBytes: exactRaw,
        maxSerializedEvidenceBytes: stableSerialized,
      },
    });
    expect(stable.warnings).not.toContain('candidate-budget-rejected');
    expect(stable.budgetMeasurements.maximumFinalizableSnapshotBytes).toBe(stableSerialized);
    expect(stable.budgetMeasurements.preterminalRawObservationPayloadBytes
      + stable.budgetMeasurements.maximumFinalizableRawPayloadBytes).toBe(exactRaw);

    const serializedRejected = assembleTrace({ ...roomyOptions,
      evidenceBudgets: {
        ...DEFAULT_EVIDENCE_BUDGETS,
        maxCanonicalEvents: 1_000,
        maxRawObservations: 2_000,
        maxRawObservationPayloadBytes: 67_108_864,
        maxSerializedEvidenceBytes: stableSerialized - 1,
      },
    });
    expect(serializedRejected.warnings).toContain('candidate-budget-rejected');
    expect(serializedRejected.trace.events.at(-1)).toMatchObject({ error: { type: 'record-budget-exceeded' } });
    expect(serializedRejected.record.rawObservations.slice(0, -1)).toEqual([...preterminal, ...replays]);

    const rawRejected = assembleTrace({ ...roomyOptions,
      evidenceBudgets: {
        ...DEFAULT_EVIDENCE_BUDGETS,
        maxCanonicalEvents: 1_000,
        maxRawObservations: 2_000,
        maxRawObservationPayloadBytes: exactRaw - 1,
        maxSerializedEvidenceBytes: 67_108_864,
      },
    });
    expect(rawRejected.warnings).toContain('candidate-budget-rejected');
    expect(rawRejected.record.rawObservations.slice(0, -1)).toEqual([...preterminal, ...replays]);
  }, 30_000);

  it('T146-T147 replay grows raw and derived serialized evidence without canonical growth', () => {
    const baseline = assembleTrace(options());
    const original = baseline.record.rawObservations[4]!;
    const replay = {
      ...original,
      observationId: 'derived-growth-replay',
      rawCapturedAt: '2026-08-11T12:05:00.000Z',
    };
    const replayed = assembleTrace(options({ additionalRawObservations: [replay] }));
    expect(replayed.trace.events).toEqual(baseline.trace.events);
    expect(replayed.budgetMeasurements.rawObservationPayloadBytes).toBe(
      baseline.budgetMeasurements.rawObservationPayloadBytes + rawPayloadByteLength(replay),
    );
    expect(replayed.budgetMeasurements.actualSerializedEvidenceBytes)
      .toBeGreaterThan(baseline.budgetMeasurements.actualSerializedEvidenceBytes + rawPayloadByteLength(replay));
    expect(replayed.record.analysis.duplicateObservations).toHaveLength(1);
  });

  it('T148/T156/T157 measures each applicable real terminal snapshot and lets the maximum govern', () => {
    const base = options();
    const cancellationBoundary = base.terminalBoundaryPreviews.find((preview) =>
      preview.terminal.kind === 'client-cancelled'
      && preview.boundaryFacts.clientResponse.outcome === 'closed-before-completion')!.boundaryFacts;
    const paddedCancellation = {
      terminal: { kind: 'client-cancelled' as const },
      boundaryFacts: {
        ...cancellationBoundary,
        futureBoundaryPadding: 'x'.repeat(4_096),
      } as AssemblerOptions['boundaryFacts'],
    };
    const completed = assembleTrace(options({
      terminalBoundaryPreviews: [...base.terminalBoundaryPreviews, paddedCancellation],
    }));
    const previews = completed.budgetMeasurements.terminalAlternatives;
    expect(previews.length).toBeGreaterThan(7);
    expect(previews.some((preview) => preview.terminal.kind === 'completed' && preview.suffixCount === 2)).toBe(true);
    expect(previews.some((preview) => preview.terminal.kind === 'client-cancelled' && preview.suffixCount === 1)).toBe(true);
    expect(previews.some((preview) => preview.terminal.kind === 'malformed-stream' && preview.suffixCount === 1)).toBe(true);
    expect(previews.some((preview) => preview.terminal.kind === 'observation-detached' && preview.suffixCount === 1)).toBe(true);
    expect(previews.some((preview) => preview.terminal.kind === 'observation-detached'
      && preview.terminal.code === 'decode-error')).toBe(true);
    expect(new Set(previews.filter((preview) => preview.terminal.kind === 'completed')
      .map((preview) => preview.boundary.streaming?.clientResponse.outcome))).toEqual(
      new Set(['flushed', 'closed-before-completion']),
    );
    expect(new Set(previews.filter((preview) => preview.terminal.kind === 'client-cancelled')
      .map((preview) => preview.boundary.streaming?.clientResponse.outcome))).toEqual(
      new Set(['closed-before-completion']),
    );
    expect(new Set(previews.filter((preview) => preview.terminal.kind === 'ingress-cancelled')
      .map((preview) => preview.boundary.streaming?.upstream.cause))).toEqual(
      new Set(['ingress-shutdown', 'configured-limit']),
    );
    expect(completed.budgetMeasurements.maximumFinalizableSnapshotBytes).toBe(
      Math.max(...previews.map((preview) => preview.serializedBytes)),
    );
    const byteWorst = previews.find((preview) =>
      preview.serializedBytes === completed.budgetMeasurements.maximumFinalizableSnapshotBytes)!;
    expect(byteWorst.terminal.kind).toBe('client-cancelled');
    expect(byteWorst.suffixCount).toBe(1);
    for (const preview of previews) {
      const streaming = preview.boundary.streaming!;
      const actual = assembleTrace(options({
        terminal: preview.terminal,
        boundaryFacts: streaming as AssemblerOptions['boundaryFacts'],
      }));
      expect(actual.budgetMeasurements.actualSerializedEvidenceBytes).toBe(preview.serializedBytes);
    }
  }, 30_000);

  it('T145/T148 keeps a structurally valid over-64-MiB preview measurable and rejects it as capacity', () => {
    const baseline = assembleTrace(options());
    const preterminal = baseline.record.rawObservations.slice(0, -2);
    const candidate: EvidenceObservation = {
      observationId: 'oversized-preview-observation',
      eventId: 'oversized-preview-event',
      traceId: 'trace-s4',
      spanId: 'span-model',
      seq: preterminal.length,
      kind: 'model_response_chunk',
      capturedAt: '2026-08-11T18:30:00.000Z',
      evidenceStatus: 'captured',
      observationRole: 'provider_reported',
      payload: {
        responseEnvelope: {
          providerNativeFidelity: 'structurally_faithful',
          choiceIndex: 0,
          chunkIndex: 99,
          providerNative: { padding: 'x'.repeat(34 * 1024 * 1024) },
        },
      },
      rawCapturedAt: '2026-08-11T18:30:00.000Z',
    };
    const result = assembleTrace(resumedOptions(preterminal, 'completion-possible', {
      additionalRawObservations: [candidate],
      boundaryFacts: {
        ...options().boundaryFacts,
        losses: { ...options().boundaryFacts.losses, deltaContent: 'fully-retained', providerNative: 'retained' },
      },
      evidenceBudgets: {
        ...DEFAULT_EVIDENCE_BUDGETS,
        maxRawObservationPayloadBytes: 67_108_864,
        maxSerializedEvidenceBytes: 67_108_864,
      },
      // This regression isolates magnitude-only validation. Exhaustive
      // terminal/boundary enumeration is exercised separately with a small
      // record so the >64 MiB fixture remains bounded and deterministic.
      terminalBoundaryPreviews: [],
    }));
    const rejectedPreview = result.budgetMeasurements.rejectedCandidatePreview!;
    expect(rejectedPreview.maximumSerializedBytes).toBeGreaterThan(67_108_864);
    expect(rejectedPreview.terminalAlternatives.length).toBeGreaterThan(0);
    expect(rejectedPreview.terminalAlternatives.some((preview) => preview.serializedBytes > 67_108_864)).toBe(true);
    expect(result.warnings).toContain('candidate-budget-rejected');
    expect(result.warnings).not.toContain('candidate-structurally-rejected');
    expect(result.trace.events.at(-1)).toMatchObject({ error: { type: 'record-budget-exceeded' } });
    expect(result.record.rawObservations.some((observation) => observation.observationId === candidate.observationId)).toBe(false);
    expect(result.record.rawObservations.slice(0, -1)).toEqual(preterminal);
    expect(result.budgetMeasurements.actualSerializedEvidenceBytes).toBeLessThanOrEqual(67_108_864);
  }, 30_000);

  it('T148/T157 covers cancellation preview boundaries before and after response headers', () => {
    const baseline = assembleTrace(options());
    const beforeHeaders = baseline.record.rawObservations.slice(0, 3);
    const early = assembleTrace(resumedOptions(beforeHeaders, 'completion-possible', {
      terminal: { kind: 'client-cancelled' },
      boundaryFacts: {
        ...options().boundaryFacts,
        upstream: { outcome: 'cancelled-by-ingress', cause: 'client-disconnect' },
        clientResponse: { outcome: 'not-started' },
        decoderDisposition: 'not-applicable',
        remainder: { knowledge: 'unknown' },
        losses: { ...options().boundaryFacts.losses, deltaContent: 'not-observed' },
      },
    }));
    expect(new Set(early.budgetMeasurements.terminalAlternatives
      .filter((preview) => preview.terminal.kind === 'client-cancelled')
      .map((preview) => preview.boundary.streaming?.clientResponse.outcome))).toEqual(new Set(['not-started']));

    const afterHeaders = assembleTrace(options({ terminal: { kind: 'client-cancelled' }, boundaryFacts: {
      ...options().boundaryFacts,
      upstream: { outcome: 'cancelled-by-ingress', cause: 'client-disconnect' },
      clientResponse: { outcome: 'closed-before-completion' },
      remainder: { knowledge: 'unknown' },
    } }));
    expect(new Set(afterHeaders.budgetMeasurements.terminalAlternatives
      .filter((preview) => preview.terminal.kind === 'client-cancelled')
      .map((preview) => preview.boundary.streaming?.clientResponse.outcome))).toEqual(new Set(['closed-before-completion']));
  });

  it('T148 finalizes from the prior valid state when a response candidate exceeds its reservation', () => {
    const baseline = assembleTrace(options());
    const beforeResponse = baseline.record.rawObservations.slice(0, 3).map((observation) =>
      observation.kind === 'model_request'
        ? {
          ...observation,
          payload: {
            ...observation.payload,
            requestEnvelope: {
              ...observation.payload['requestEnvelope'] as object,
              providerNative: { padding: 'x'.repeat(600_000) },
            },
          },
        }
        : observation);
    const response = baseline.record.rawObservations.find((observation) => observation.kind === 'model_response')!;
    const boundaryFacts = {
      ...options().boundaryFacts,
      losses: {
        ...options().boundaryFacts.losses,
        deltaContent: 'not-observed' as const,
        providerNative: 'retained' as const,
      },
    };
    const roomyOptions = resumedOptions(beforeResponse, 'completion-possible', {
      boundaryFacts,
      additionalRawObservations: [response],
      decodedEvents: [],
      evidenceBudgets: { ...DEFAULT_EVIDENCE_BUDGETS, maxSerializedEvidenceBytes: 67_108_864 },
    });
    const roomy = assembleTrace(roomyOptions);
    const rejected = assembleTrace({
      ...roomyOptions,
      evidenceBudgets: {
        ...DEFAULT_EVIDENCE_BUDGETS,
        maxSerializedEvidenceBytes: roomy.budgetMeasurements.maximumFinalizableSnapshotBytes - 2,
      },
    });
    expect(rejected.warnings).toContain('candidate-budget-rejected');
    expect(rejected.trace.events.some((event) => event.kind === 'model_response')).toBe(false);
    expect(rejected.boundary.streaming?.decoderDisposition).toBe('not-applicable');
    expect(rejected.budgetMeasurements.actualSerializedEvidenceBytes)
      .toBeLessThanOrEqual(rejected.boundary.streaming!.budgets.maxSerializedEvidenceBytes);
    expect(rejected.trace.events.at(-1)).toMatchObject({ error: { type: 'record-budget-exceeded' } });
  }, 15_000);

  it('capacity-qualifies a resumed prefix against exact ordinary and rollback finalizations before its first candidate', () => {
    const base = options();
    const failureBoundary: AssemblerOptions['boundaryFacts'] = {
      upstream: { outcome: 'connection-failed' },
      clientResponse: { outcome: 'local-error-flushed' },
      decoderDisposition: 'not-applicable',
      remainder: { knowledge: 'unknown' },
      losses: { ...base.boundaryFacts.losses, deltaContent: 'not-observed', providerNative: 'retained' },
    };
    const seed = assembleTrace(options({
      responseMeta: undefined,
      decodedEvents: [],
      terminal: { kind: 'upstream-failed', code: 'connection-error' },
      boundaryFacts: {
        ...failureBoundary,
        losses: { ...failureBoundary.losses, providerNative: 'not-retained' },
      },
    }));
    const prefix = withResumedCapacityPadding(seed.record.rawObservations.slice(0, -1));
    const roomyOptions = resumedOptions(prefix, 'completion-possible', {
      terminal: { kind: 'upstream-failed', code: 'connection-error' },
      boundaryFacts: failureBoundary,
      terminalBoundaryPreviews: [],
      evidenceBudgets: {
        ...DEFAULT_EVIDENCE_BUDGETS,
        maxRawObservationPayloadBytes: 67_108_864,
        maxSerializedEvidenceBytes: 67_108_864,
      },
    });
    const roomy = assembleTrace(roomyOptions);
    const ordinary = roomy.budgetMeasurements.terminalAlternatives.find((alternative) =>
      alternative.terminal.kind === 'upstream-failed')!;
    const rollback = roomy.budgetMeasurements.terminalAlternatives.filter((alternative) =>
      alternative.terminal.kind === 'observation-detached');
    const exactLimit = roomy.budgetMeasurements.maximumFinalizableSnapshotBytes;
    expect(rollback).toHaveLength(2);
    const rollbackLimit = Math.max(...rollback.map((alternative) => alternative.serializedBytes));
    expect(rollbackLimit).toBeGreaterThan(ordinary.serializedBytes);
    expect(exactLimit).toBe(rollbackLimit);
    expect(exactLimit).toBeGreaterThanOrEqual(10_000_000);
    expect(() => assembleTrace({
      ...roomyOptions,
      evidenceBudgets: {
        ...roomyOptions.evidenceBudgets!,
        maxSerializedEvidenceBytes: ordinary.serializedBytes,
      },
    })).toThrow(/initial state exceeds evidence capacity: serialized evidence bytes/);

    const exactBudgets = {
      ...roomyOptions.evidenceBudgets!,
      maxSerializedEvidenceBytes: exactLimit,
    };
    const exact = assembleTrace({ ...roomyOptions, evidenceBudgets: exactBudgets });
    expect(exact.budgetMeasurements.maximumFinalizableSnapshotBytes).toBe(exactLimit);
    expect(exact.trace.events.at(-1)).toMatchObject({ error: { type: 'connection-error' } });

    const source = prefix.find((observation) => observation.kind === 'model_request')!;
    const conflictingCandidate: EvidenceObservation = {
      ...source,
      observationId: 'resumed-first-conflict',
      payload: {
        ...source.payload,
        requestEnvelope: {
          ...source.payload['requestEnvelope'] as Record<string, unknown>,
          model: 'conflicting-model',
        },
      },
      rawCapturedAt: '2026-08-11T19:07:00.000Z',
    };
    const rejected = assembleTrace({
      ...roomyOptions,
      evidenceBudgets: exactBudgets,
      additionalRawObservations: [conflictingCandidate],
    });
    expect(rejected.warnings).toEqual(['candidate-structurally-rejected']);
    expect(rejected.record.rawObservations.slice(0, -1)).toEqual(prefix);
    expect(rejected.record.rawObservations.some((observation) =>
      observation.observationId === conflictingCandidate.observationId)).toBe(false);
    expect(rejected.trace.events.at(-1)).toMatchObject({ error: { type: 'internal-capture-error' } });

    let firstCandidateRead = false;
    const unreadCandidate = {
      ...conflictingCandidate,
      get observationId(): string {
        firstCandidateRead = true;
        return 'unread-resumed-candidate';
      },
    };
    const prefixBeforeFailure = JSON.stringify(prefix);
    expect(() => assembleTrace({
      ...roomyOptions,
      evidenceBudgets: { ...exactBudgets, maxSerializedEvidenceBytes: exactLimit - 1 },
      additionalRawObservations: [unreadCandidate],
    })).toThrow(/initial state exceeds evidence capacity: serialized evidence bytes/);
    expect(firstCandidateRead).toBe(false);
    expect(JSON.stringify(prefix)).toBe(prefixBeforeFailure);
  }, 60_000);

  it('capacity-qualifies exact-fit and one-byte-over span-closed resumed states', () => {
    const baseline = assembleTrace(options());
    const closed = withResumedCapacityPadding(baseline.record.rawObservations.slice(0, -1));
    const base = options();
    const roomyOptions = resumedOptions(closed, 'span-closed', {
      terminalBoundaryPreviews: [],
      finalizationBundle: [
        { eventId: 'capacity-closed-end', observationId: 'capacity-closed-end-observation', capturedAt: '2026-08-11T19:08:00.000Z' },
        { eventId: 'capacity-closed-unused', observationId: 'capacity-closed-unused-observation', capturedAt: '2026-08-11T19:08:01.000Z' },
      ],
      boundaryFacts: {
        ...base.boundaryFacts,
        losses: {
          ...base.boundaryFacts.losses,
          deltaContent: 'fully-retained',
          providerNative: 'retained',
        },
      },
      evidenceBudgets: {
        ...DEFAULT_EVIDENCE_BUDGETS,
        maxRawObservationPayloadBytes: 67_108_864,
        maxSerializedEvidenceBytes: 67_108_864,
      },
    });
    const roomy = assembleTrace(roomyOptions);
    const exactLimit = roomy.budgetMeasurements.maximumFinalizableSnapshotBytes;
    expect(exactLimit).toBeGreaterThanOrEqual(10_000_000);
    const exactBudgets = {
      ...roomyOptions.evidenceBudgets!,
      maxSerializedEvidenceBytes: exactLimit,
    };
    const exact = assembleTrace({ ...roomyOptions, evidenceBudgets: exactBudgets });
    expect(exact.budgetMeasurements.maximumFinalizableSnapshotBytes).toBe(exactLimit);
    expect(exact.trace.events.at(-1)).toMatchObject({ kind: 'interaction_end' });
    expect(() => assembleTrace({
      ...roomyOptions,
      evidenceBudgets: { ...exactBudgets, maxSerializedEvidenceBytes: exactLimit - 1 },
    })).toThrow(/initial state exceeds evidence capacity: serialized evidence bytes/);
  }, 60_000);

  it('T154/T159 completes at the real two-slot canonical boundary', () => {
    const baseline = assembleTrace(options());
    const preterminal = baseline.record.rawObservations.slice(0, -2);
    const source = preterminal.find((observation) => observation.kind === 'model_response_chunk')!;
    const fillers = Array.from({ length: 998 - preterminal.length }, (_, index): EvidenceObservation => ({
      ...source,
      observationId: `count-observation-${index}`,
      eventId: `count-event-${index}`,
      seq: preterminal.length + index,
      payload: {
        responseEnvelope: {
          providerNativeFidelity: 'structurally_faithful',
          choiceIndex: 0,
          chunkIndex: index + 1,
          deltaText: 'x',
        },
      },
      rawCapturedAt: `2026-08-11T13:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
    }));
    const result = assembleTrace(resumedOptions([...preterminal, ...fillers], 'completion-possible', {
      evidenceBudgets: { ...DEFAULT_EVIDENCE_BUDGETS, maxCanonicalEvents: 1_000, maxRawObservations: 2_000 },
    }));
    expect(result.trace.events).toHaveLength(1_000);
    expect(result.trace.events.slice(-2).map((event) => event.kind)).toEqual(['span_end', 'interaction_end']);
    expect(result.warnings).not.toContain('candidate-budget-rejected');
  }, 30_000);

  it('T155 exercises the real span-closed one-slot raw boundary', () => {
    const baseline = assembleTrace(options());
    const closed = baseline.record.rawObservations.slice(0, -1);
    const source = closed.find((observation) => observation.kind === 'model_response_chunk')!;
    const replays = Array.from({ length: 1_999 - closed.length }, (_, index): EvidenceObservation => ({
      ...source,
      observationId: `raw-boundary-replay-${index}`,
      rawCapturedAt: `2026-08-11T14:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
    }));
    const finalizationBundle = [
      { eventId: 'closed-interaction-end', observationId: 'closed-interaction-observation', capturedAt: '2026-08-11T15:00:00.000Z' },
      { eventId: 'unused-closed-slot', observationId: 'unused-closed-observation', capturedAt: '2026-08-11T15:00:01.000Z' },
    ] as const;
    const result = assembleTrace(resumedOptions([...closed, ...replays], 'span-closed', {
      finalizationBundle,
      evidenceBudgets: { ...DEFAULT_EVIDENCE_BUDGETS, maxCanonicalEvents: 1_000, maxRawObservations: 2_000 },
    }));
    expect(result.record.rawObservations).toHaveLength(2_000);
    expect(result.trace.events.at(-1)).toMatchObject({ kind: 'interaction_end', eventId: 'closed-interaction-end' });
    expect(result.budgetMeasurements.terminalAlternatives).toHaveLength(2);
    expect(result.budgetMeasurements.terminalAlternatives.every((preview) =>
      preview.terminal.kind === 'completed' && preview.suffixCount === 1)).toBe(true);
    expect(new Set(result.budgetMeasurements.terminalAlternatives.map((preview) =>
      preview.boundary.streaming?.clientResponse.outcome))).toEqual(
      new Set(['flushed', 'closed-before-completion']),
    );
  }, 30_000);

  it('T158 preview acceptance and rejection never mutate finalization inputs', () => {
    const fixed = options().finalizationBundle;
    const accepted = assembleTrace(options());
    const rejected = contentBudgetRejection();
    expect(accepted.record.rawObservations.slice(-2).map(({ eventId, observationId, rawCapturedAt }) => ({ eventId, observationId, rawCapturedAt })))
      .toEqual(fixed.map(({ eventId, observationId, capturedAt }) => ({ eventId, observationId, rawCapturedAt: capturedAt })));
    expect(rejected.record.rawObservations.at(-1)).toMatchObject({
      eventId: fixed[0].eventId,
      observationId: fixed[0].observationId,
      rawCapturedAt: fixed[0].capturedAt,
    });
    expect(rejected.record.rawObservations.some((observation) => observation.eventId === fixed[1].eventId)).toBe(false);
  });

  it.each([
    ['slot 0 eventId', 0, 'eventId'],
    ['slot 1 eventId', 1, 'eventId'],
    ['slot 0 observationId', 0, 'observationId'],
    ['slot 1 observationId', 1, 'observationId'],
  ] as const)('rejects an initial-state collision with reserved %s', (_label, slot, field) => {
    const baseline = assembleTrace(options());
    const collisionBundle = [
      { eventId: 'initial-reserved-event-0', observationId: 'initial-reserved-observation-0', capturedAt: '2026-08-11T19:03:00.000Z' },
      { eventId: 'initial-reserved-event-1', observationId: 'initial-reserved-observation-1', capturedAt: '2026-08-11T19:03:01.000Z' },
    ] as const;
    const closed = baseline.record.rawObservations.slice(0, -1).map((observation, index) =>
      index === 0
        ? { ...observation, [field]: collisionBundle[slot][field] }
        : observation);
    expect(() => assembleTrace(resumedOptions(closed, 'span-closed', { finalizationBundle: collisionBundle })))
      .toThrow(/reserved finalization identity namespace/);
  });

  it.each([
    ['slot 0 eventId', 0, 'eventId'],
    ['slot 1 eventId', 1, 'eventId'],
    ['slot 0 observationId', 0, 'observationId'],
    ['slot 1 observationId', 1, 'observationId'],
  ] as const)('atomically rejects an additional candidate using reserved %s in both reservation states', (_label, slot, field) => {
    const baseline = assembleTrace(options());
    const makeCandidate = (seq: number, bundle = options().finalizationBundle): EvidenceObservation => ({
      observationId: 'reserved-collision-observation',
      eventId: 'reserved-collision-event',
      traceId: 'trace-s4',
      spanId: 'span-model',
      seq,
      kind: 'model_response_chunk',
      capturedAt: '2026-08-11T19:00:00.000Z',
      evidenceStatus: 'captured',
      observationRole: 'provider_reported',
      payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', choiceIndex: 0, chunkIndex: 101, deltaText: 'collision' } },
      rawCapturedAt: '2026-08-11T19:00:00.000Z',
      [field]: bundle[slot][field],
    });

    const preterminal = baseline.record.rawObservations.slice(0, -2);
    const completionCandidate = makeCandidate(preterminal.length);
    const completion = assembleTrace(resumedOptions(preterminal, 'completion-possible', {
      additionalRawObservations: [completionCandidate],
    }));
    expect(completion.warnings).toContain('candidate-structurally-rejected');
    expect(completion.warnings).not.toContain('candidate-budget-rejected');
    expect(completion.record.rawObservations.slice(0, -1)).toEqual(preterminal);
    expect(completion.record.rawObservations.some((observation) =>
      observation.observationId === completionCandidate.observationId && observation.eventId === completionCandidate.eventId)).toBe(false);
    expect(completion.trace.events.at(-1)).toMatchObject({ error: { type: 'internal-capture-error' } });

    const closed = baseline.record.rawObservations.slice(0, -1);
    const closedBundle = [
      { eventId: 'closed-reserved-event-0', observationId: 'closed-reserved-observation-0', capturedAt: '2026-08-11T19:01:00.000Z' },
      { eventId: 'closed-reserved-event-1', observationId: 'closed-reserved-observation-1', capturedAt: '2026-08-11T19:01:01.000Z' },
    ] as const;
    const closedCandidate = makeCandidate(closed.length, closedBundle);
    const spanClosed = assembleTrace(resumedOptions(closed, 'span-closed', {
      additionalRawObservations: [closedCandidate],
      finalizationBundle: closedBundle,
    }));
    expect(spanClosed.warnings).toContain('candidate-structurally-rejected');
    expect(spanClosed.warnings).not.toContain('candidate-budget-rejected');
    expect(spanClosed.record.rawObservations.slice(0, -1)).toEqual(closed);
    expect(spanClosed.trace.events.at(-1)).toMatchObject({ kind: 'interaction_end' });
    expect(JSON.stringify(spanClosed.record)).not.toContain('collision');
  });

  it('validates that a claimed span-closed state is genuinely eligible only for interaction_end', () => {
    const baseline = assembleTrace(options());
    const closedBundle = [
      { eventId: 'state-check-event-0', observationId: 'state-check-observation-0', capturedAt: '2026-08-11T19:02:00.000Z' },
      { eventId: 'state-check-event-1', observationId: 'state-check-observation-1', capturedAt: '2026-08-11T19:02:01.000Z' },
    ] as const;
    const withoutSpanEnd = baseline.record.rawObservations.slice(0, -2);
    expect(() => assembleTrace(resumedOptions(withoutSpanEnd, 'span-closed', { finalizationBundle: closedBundle })))
      .toThrow(/span-closed initial state/);
    expect(() => assembleTrace(resumedOptions(baseline.record.rawObservations, 'span-closed', { finalizationBundle: closedBundle })))
      .toThrow(/span-closed initial state/);
  });

  it('rejects mislabeled, open, and contradictory span-closed lifecycle states', () => {
    const baseline = assembleTrace(options());
    const closed = baseline.record.rawObservations.slice(0, -1);
    const finalSpanEnd = closed.at(-1)!;
    const prefix = closed.slice(0, -1);
    const closedBundle = [
      { eventId: 'adversarial-state-event-0', observationId: 'adversarial-state-observation-0', capturedAt: '2026-08-11T19:04:00.000Z' },
      { eventId: 'adversarial-state-event-1', observationId: 'adversarial-state-observation-1', capturedAt: '2026-08-11T19:04:01.000Z' },
    ] as const;
    const withFinalSeq = (seq: number): EvidenceObservation => ({ ...finalSpanEnd, seq });
    const lifecycleObservation = (
      kind: 'span_start' | 'span_end' | 'error',
      spanId: string,
      seq: number,
      suffix: string,
      payload: Record<string, unknown>,
    ): EvidenceObservation => ({
      observationId: `adversarial-observation-${suffix}`,
      eventId: `adversarial-event-${suffix}`,
      traceId: 'trace-s4',
      spanId,
      seq,
      kind,
      capturedAt: `2026-08-11T19:03:${String(seq).padStart(2, '0')}.000Z`,
      evidenceStatus: 'captured',
      observationRole: kind === 'error' ? 'provider_reported' : null,
      payload,
      rawCapturedAt: `2026-08-11T19:03:${String(seq).padStart(2, '0')}.000Z`,
    });

    const mislabeled = closed.map((observation) => observation.kind === 'span_start'
      ? { ...observation, payload: { span: { kind: 'tool', name: 'not-model', parentSpanId: null } } }
      : observation);
    expect(() => assembleTrace(resumedOptions(mislabeled, 'span-closed', { finalizationBundle: closedBundle })))
      .toThrow(/span-closed initial state/);

    const openSibling = [
      ...prefix,
      lifecycleObservation('span_start', 'span-open', finalSpanEnd.seq, 'open-start', {
        span: { kind: 'tool', name: 'open-tool', parentSpanId: null },
      }),
      withFinalSeq(finalSpanEnd.seq + 1),
    ];
    expect(() => assembleTrace(resumedOptions(openSibling, 'span-closed', { finalizationBundle: closedBundle })))
      .toThrow(/span-closed initial state/);

    const duplicateStart = [
      ...prefix,
      lifecycleObservation('span_start', 'span-model', finalSpanEnd.seq, 'duplicate-start', {
        span: { kind: 'model', name: 'duplicate-model', parentSpanId: null },
      }),
      withFinalSeq(finalSpanEnd.seq + 1),
    ];
    expect(() => assembleTrace(resumedOptions(duplicateStart, 'span-closed', { finalizationBundle: closedBundle })))
      .toThrow(/span-closed initial state/);

    const contradictory = [
      ...prefix,
      lifecycleObservation('error', 'span-model', finalSpanEnd.seq, 'contradiction', {
        actor: 'model', lifecycleTarget: 'span', lifecycleEffect: 'fail',
        error: { type: 'provider-error', message: 'closed before span_end' },
      }),
      withFinalSeq(finalSpanEnd.seq + 1),
    ];
    expect(() => assembleTrace(resumedOptions(contradictory, 'span-closed', { finalizationBundle: closedBundle })))
      .toThrow(/span-closed initial state/);
  });

  it('accepts a span-closed state with legitimate fully closed multi-span history', () => {
    const baseline = assembleTrace(options());
    const closed = baseline.record.rawObservations.slice(0, -1);
    const finalSpanEnd = closed.at(-1)!;
    const prefix = closed.slice(0, -1);
    const supplemental = (kind: 'span_start' | 'span_end', seq: number): EvidenceObservation => ({
      observationId: `closed-tool-observation-${kind}`,
      eventId: `closed-tool-event-${kind}`,
      traceId: 'trace-s4',
      spanId: 'span-tool',
      seq,
      kind,
      capturedAt: `2026-08-11T19:05:0${seq}.000Z`,
      evidenceStatus: 'captured',
      observationRole: null,
      payload: kind === 'span_start'
        ? { span: { kind: 'tool', name: 'completed-tool', parentSpanId: null } }
        : {},
      rawCapturedAt: `2026-08-11T19:05:0${seq}.000Z`,
    });
    const multiSpan = [
      ...prefix,
      supplemental('span_start', finalSpanEnd.seq),
      supplemental('span_end', finalSpanEnd.seq + 1),
      { ...finalSpanEnd, seq: finalSpanEnd.seq + 2 },
    ];
    const result = assembleTrace(resumedOptions(multiSpan, 'span-closed', {
      finalizationBundle: [
        { eventId: 'multi-span-end', observationId: 'multi-span-end-observation', capturedAt: '2026-08-11T19:06:00.000Z' },
        { eventId: 'multi-span-unused', observationId: 'multi-span-unused-observation', capturedAt: '2026-08-11T19:06:01.000Z' },
      ],
    }));
    expect(result.trace.spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ spanId: 'span-model', kind: 'model', status: 'completed' }),
      expect.objectContaining({ spanId: 'span-tool', kind: 'tool', status: 'completed' }),
    ]));
    expect(result.trace.events.at(-1)).toMatchObject({ kind: 'interaction_end' });
  });

  it('T160-T164 admits new canonical content and preserves the exact prior prefix on rejection', () => {
    const baseline = assembleTrace(options());
    const preterminal = baseline.record.rawObservations.slice(0, -2);
    const source = preterminal.find((observation) => observation.kind === 'model_response_chunk')!;
    const genuinelyNew: EvidenceObservation = {
      ...source,
      observationId: 'genuinely-new-observation',
      eventId: 'genuinely-new-event',
      seq: preterminal.length,
      payload: {
        responseEnvelope: {
          providerNativeFidelity: 'structurally_faithful', choiceIndex: 0, chunkIndex: 99, deltaText: 'new',
        },
      },
      rawCapturedAt: '2026-08-11T16:00:00.000Z',
    };
    const admitted = assembleTrace(options({ additionalRawObservations: [genuinelyNew] }));
    expect(admitted.trace.events.some((event) => event.eventId === genuinelyNew.eventId)).toBe(true);
    expect(admitted.trace.events).toHaveLength(baseline.trace.events.length + 1);

    const conflict: EvidenceObservation = {
      ...source,
      observationId: 'prefix-conflict',
      payload: { responseEnvelope: { ...source.payload['responseEnvelope'] as object, deltaText: 'conflict' } },
      rawCapturedAt: '2026-08-11T16:00:01.000Z',
    };
    const rejected = assembleTrace(options({ additionalRawObservations: [conflict] }));
    expect(rejected.record.rawObservations.slice(0, -1)).toEqual(preterminal);
    expect(rejected.warnings).toEqual(['candidate-structurally-rejected']);
  });

  it('T165 mechanically verifies every classification row and its emitted/derived properties', () => {
    const expectedCodes = [
      ...CLIENT_REQUEST_FAILURE_CODES,
      ...UPSTREAM_FAILURE_CODES,
      ...MALFORMED_STREAM_CODES,
      ...OBSERVATION_FAILURE_CODES,
      ...INTERNAL_DECODER_FAILURE_CODES,
    ];
    expect(FAILURE_CLASSIFICATION_ROWS.map((row) => row.code)).toHaveLength(new Set(expectedCodes).size);
    expect(new Set(FAILURE_CLASSIFICATION_ROWS.map((row) => row.code))).toEqual(new Set(expectedCodes));
    for (const row of FAILURE_CLASSIFICATION_ROWS) {
      let terminal: AssemblyTerminal;
      let overrides: Partial<AssemblerOptions> = {};
      if (row.terminal === 'request-failed') {
        terminal = { kind: 'request-failed', code: row.code as typeof CLIENT_REQUEST_FAILURE_CODES[number] };
        overrides = {
          responseMeta: undefined, decodedEvents: [], terminal,
          boundaryFacts: {
            upstream: { outcome: 'not-started' }, clientResponse: { outcome: 'local-error-flushed' },
            decoderDisposition: 'not-applicable', remainder: { knowledge: 'not-applicable' },
            losses: { ...BASE_LOSSES, messageContent: 'omitted', providerNative: 'not-applicable', wireBytes: 'not-applicable' },
          },
        };
      } else if (row.terminal === 'upstream-failed') {
        terminal = { kind: 'upstream-failed', code: row.code as typeof UPSTREAM_FAILURE_CODES[number] };
        if (row.code === 'http-error-status') overrides = {
          terminal, responseMeta: { statusCode: 503, contentType: 'application/json' }, decodedEvents: [],
          boundaryFacts: { ...options().boundaryFacts, upstream: { outcome: 'response-completed' }, clientResponse: { outcome: 'local-error-flushed' }, decoderDisposition: 'not-applicable', remainder: { knowledge: 'transport-eof-observed' } },
        };
        else if (row.code === 'non-sse-response') overrides = {
          terminal, responseMeta: { statusCode: 200, contentType: 'application/json' }, decodedEvents: [],
          boundaryFacts: { ...options().boundaryFacts, decoderDisposition: 'not-applicable', remainder: { knowledge: 'transport-eof-observed' } },
        };
        else if (row.code === 'provider-error-frame') overrides = { terminal, decodedEvents: [] };
        else overrides = {
          terminal, responseMeta: undefined, decodedEvents: [],
          boundaryFacts: { ...options().boundaryFacts, upstream: { outcome: 'connection-failed' }, clientResponse: { outcome: 'local-error-flushed' }, decoderDisposition: 'not-applicable', remainder: { knowledge: 'unknown' } },
        };
      } else if (row.terminal === 'malformed-stream') {
        terminal = { kind: 'malformed-stream', code: row.code as typeof MALFORMED_STREAM_CODES[number] };
        overrides = { terminal, decodedEvents: [] };
      } else {
        terminal = { kind: 'observation-detached', code: row.code as typeof OBSERVATION_FAILURE_CODES[number] | 'decode-error' };
        overrides = { terminal, decodedEvents: [] };
      }
      const result = assembleTrace(options(overrides));
      const final = result.trace.events.at(-1)!;
      expect(final).toMatchObject({
        kind: row.eventKind,
        actor: row.actor,
        observationRole: row.observationRole,
        lifecycleTarget: row.lifecycleTarget,
        lifecycleEffect: row.lifecycleEffect,
        error: { type: row.eventCode },
      });
      expect(result.trace.status).toBe(row.traceStatus);
      expect(result.record.completeness.lifecycle?.observation.terminal).toBe(row.completenessTerminal);
      expect(classifyFailureCode(row.code)).toBe(row.terminal);
    }
  }, 45_000);

  it.each([
    ['same-id/same-seq conflict', (source: EvidenceObservation): EvidenceObservation => ({
      ...source, observationId: 't166-conflict',
      payload: { responseEnvelope: { ...source.payload['responseEnvelope'] as object, deltaText: 'different' } },
    })],
    ['different-id/same-seq collision', (source: EvidenceObservation): EvidenceObservation => ({
      ...source, observationId: 't166-collision', eventId: 't166-collision-event',
    })],
  ])('T166 keeps %s distinct from capacity failure', (_label, mutate) => {
    const baseline = assembleTrace(options());
    const preterminal = baseline.record.rawObservations.slice(0, -2);
    const rejected = mutate(preterminal.find((observation) => observation.kind === 'model_response_chunk')!);
    const structural = assembleTrace(options({ additionalRawObservations: [rejected] }));
    expect(structural.warnings).toContain('candidate-structurally-rejected');
    expect(structural.warnings).not.toContain('candidate-budget-rejected');
    expect(structural.record.rawObservations.slice(0, -1)).toEqual(preterminal);
    expect(structural.record.rawObservations.some((observation) => observation.observationId === rejected.observationId)).toBe(false);
    expect(structural.trace.events.at(-1)).toMatchObject({
      kind: 'error', actor: 'capture', observationRole: 'unobservable',
      lifecycleTarget: 'none', lifecycleEffect: 'none', error: { type: 'internal-capture-error' },
    });
    const capacity = contentBudgetRejection();
    expect(capacity.warnings).toContain('candidate-budget-rejected');
    expect(capacity.trace.events.at(-1)).toMatchObject({ error: { type: 'record-budget-exceeded' } });
  });
});
