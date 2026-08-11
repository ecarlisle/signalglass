/**
 * Provider-neutral deterministic evidence assembler (Spec 016 S4, L4).
 * No clocks, randomness, I/O, provider adapters, or persistence live here.
 */
import {
  CLIENT_REQUEST_FAILURE_CODES,
  COMPLETENESS_DERIVATION_ALGORITHM_VERSION,
  INTERNAL_DECODER_FAILURE_CODES,
  MALFORMED_STREAM_CODES,
  OBSERVATION_FAILURE_CODES,
  TRANSPORT_FAILURE_CODES,
  UPSTREAM_FAILURE_CODES,
  collapseObservations,
  deriveCompleteness,
  deriveTrace,
  parseEvidenceRecord,
  utf8Encode,
  type CaptureBoundary,
  type ClientRequestFailureCode,
  type EvidenceObservation,
  type EvidenceRecord,
  type EvidenceStructuralAnalysis,
  type EventRecord,
  type InternalDecoderFailureCode,
  type MalformedStreamCode,
  type ObservationFailureCode,
  type ObservationTerminal,
  type RequestMessages,
  type ResponseMetadata,
  type StreamingCaptureBoundary,
  type StreamingLossFacts,
  type TransportFailureCode,
  type UnmappedDeltaFieldCategory,
  type UpstreamFailureCode,
} from '@signalglass/evidence';
import {
  CAPTURE_PROFILE_NAME,
  CAPTURE_PROFILE_VERSION,
  DETECTOR_NAME,
  DETECTOR_VERSION,
  countCodePoints,
  normalizeRequestMessages,
  retainText,
} from './retention.js';

export const STREAMING_ASSEMBLER_NAME = 'signalglass.streaming.assembler' as const;
export const STREAMING_ASSEMBLER_VERSION = '1.0.0' as const;
export const OPENAI_SSE_DECODER_CONTRACT_NAME = 'signalglass.providers.openai-sse' as const;
export const OPENAI_SSE_DECODER_CONTRACT_VERSION = '1.0.0' as const;

export const DEFAULT_EVIDENCE_BUDGETS: EvidenceBudgets = {
  maxCanonicalEvents: 10_000,
  maxRawObservations: 20_000,
  maxRawObservationPayloadBytes: 4 * 1024 * 1024,
  maxRetainedContentCodePoints: 262_144,
  maxSerializedEvidenceBytes: 16 * 1024 * 1024,
  maxIdLengthBytes: 128,
};

export type EvidenceBudgets = StreamingCaptureBoundary['budgets'];

export type AssemblerDecodedEvent =
  | {
      kind: 'chunk';
      choiceIndex: number;
      chunkIndex: number;
      delta: string | null;
      finishReason?: string;
      unmappedDeltaFields?: readonly UnmappedDeltaFieldCategory[];
    }
  | { kind: 'usage'; inputTokens?: number; outputTokens?: number; totalTokens?: number }
  | { kind: 'provider-error'; code: 'provider-error-frame'; description: string };

export type AssemblyTerminal =
  | { kind: 'completed' }
  | { kind: 'upstream-failed'; code: UpstreamFailureCode }
  | { kind: 'client-cancelled' }
  | { kind: 'ingress-cancelled' }
  | { kind: 'malformed-stream'; code: MalformedStreamCode }
  | { kind: 'request-failed'; code: ClientRequestFailureCode }
  | { kind: 'observation-detached'; code: ObservationFailureCode | InternalDecoderFailureCode };

export type FinalizationValue = {
  eventId: string;
  observationId: string;
  capturedAt: string;
};

export type FinalizationBundle = readonly [FinalizationValue, FinalizationValue];

export type AssemblerBoundaryFacts = Pick<
  StreamingCaptureBoundary,
  'upstream' | 'clientResponse' | 'decoderDisposition' | 'remainder'
> & { losses: StreamingLossFacts };

export type AssemblerOptions = {
  traceId: string;
  interactionId: string;
  modelSpanId: string;
  provider: string;
  model: string;
  requestMessages: readonly unknown[];
  responseMeta?: ResponseMetadata;
  decodedEvents: readonly AssemblerDecodedEvent[];
  terminal: AssemblyTerminal;
  boundaryFacts: AssemblerBoundaryFacts;
  ids: {
    eventIds: readonly string[];
    observationIds: readonly string[];
  };
  capturedAtBySeq: readonly string[];
  finalizationBundle: FinalizationBundle;
  evidenceBudgets?: EvidenceBudgets;
  /** Spec 014 observations supplied by replay/capture paths, admitted atomically. */
  additionalRawObservations?: readonly EvidenceObservation[];
};

export type AssemblyWarning =
  | 'provider-error-terminal-overrode-input'
  | 'candidate-structurally-rejected'
  | 'candidate-budget-rejected';

export type AssemblyResult = {
  trace: EvidenceRecord['trace'];
  boundary: CaptureBoundary;
  warnings: readonly AssemblyWarning[];
  record: EvidenceRecord;
};

export const FAILURE_CLASSIFICATION = {
  requestFailed: CLIENT_REQUEST_FAILURE_CODES,
  upstreamFailed: UPSTREAM_FAILURE_CODES,
  malformedStream: MALFORMED_STREAM_CODES,
  observationDetached: [...OBSERVATION_FAILURE_CODES, ...INTERNAL_DECODER_FAILURE_CODES],
} as const;

const TERMINAL_SUFFIX_ALTERNATIVES: readonly AssemblyTerminal[] = [
  { kind: 'completed' },
  ...UPSTREAM_FAILURE_CODES.map((code) => ({ kind: 'upstream-failed' as const, code })),
  ...MALFORMED_STREAM_CODES.map((code) => ({ kind: 'malformed-stream' as const, code })),
  ...CLIENT_REQUEST_FAILURE_CODES.map((code) => ({ kind: 'request-failed' as const, code })),
  { kind: 'client-cancelled' },
  { kind: 'ingress-cancelled' },
  ...OBSERVATION_FAILURE_CODES.map((code) => ({ kind: 'observation-detached' as const, code })),
];

export type TerminalReservationState = 'completion-possible' | 'span-closed';

export function reservedTerminalSuffixCount(state: TerminalReservationState): 1 | 2 {
  return state === 'completion-possible' ? 2 : 1;
}

export function countBudgetAllows(
  canonicalEvents: number,
  rawObservations: number,
  budgets: EvidenceBudgets,
  state: TerminalReservationState,
): boolean {
  const reserved = reservedTerminalSuffixCount(state);
  return canonicalEvents <= budgets.maxCanonicalEvents - reserved
    && rawObservations <= budgets.maxRawObservations - reserved;
}

/** Validate exact configured limits; invalid combinations are refused, never clamped. */
export function validateEvidenceBudgets(budgets: EvidenceBudgets): void {
  assertRange('maxCanonicalEvents', budgets.maxCanonicalEvents, 1_000, 1_000_000);
  assertRange('maxRawObservations', budgets.maxRawObservations, 2_000, 2_000_000);
  assertRange('maxRawObservationPayloadBytes', budgets.maxRawObservationPayloadBytes, 1_048_576, 67_108_864);
  assertRange('maxRetainedContentCodePoints', budgets.maxRetainedContentCodePoints, 16_384, 16_777_216);
  assertRange('maxSerializedEvidenceBytes', budgets.maxSerializedEvidenceBytes, 1_048_576, 67_108_864);
  assertRange('maxIdLengthBytes', budgets.maxIdLengthBytes, 16, 256);
  if (budgets.maxRawObservations < budgets.maxCanonicalEvents) {
    throw new RangeError('maxRawObservations must be greater than or equal to maxCanonicalEvents');
  }
}

// fallow-ignore-next-line complexity -- closed Spec 016 observation-state matrix
export function assembleTrace(options: AssemblerOptions): AssemblyResult {
  const budgets = options.evidenceBudgets ?? DEFAULT_EVIDENCE_BUDGETS;
  validateEvidenceBudgets(budgets);
  assertIdentityInputs(options, budgets);

  const normalizedRequest = normalizeRequestMessages(options.requestMessages);
  const warnings: AssemblyWarning[] = [];
  const retained: EvidenceObservation[] = [];
  let ordinaryIdPosition = 0;
  let terminal = options.terminal;
  let detachedCode: ObservationFailureCode | InternalDecoderFailureCode | undefined;

  const nextOrdinary = (): FinalizationValue => {
    const eventId = options.ids.eventIds[ordinaryIdPosition];
    const observationId = options.ids.observationIds[ordinaryIdPosition];
    const capturedAt = options.capturedAtBySeq[ordinaryIdPosition];
    if (eventId === undefined || observationId === undefined || capturedAt === undefined) {
      throw new RangeError('ordinary event ids, observation ids, and timestamps must cover every non-terminal candidate');
    }
    ordinaryIdPosition += 1;
    return { eventId, observationId, capturedAt };
  };

  const baseEvents: EventBlueprint[] = [{ kind: 'interaction_start', spanId: null, evidenceStatus: 'captured' }];
  if (terminal.kind !== 'request-failed') {
    baseEvents.push({
      kind: 'model_request', spanId: options.modelSpanId,
      evidenceStatus: normalizedRequest.status,
      observationRole: 'client_sent',
      payload: {
        requestEnvelope: {
          model: options.model,
          provider: options.provider,
          providerNativeFidelity: 'structurally_faithful',
          messages: normalizedRequest.messages satisfies RequestMessages,
        },
      },
    });
    baseEvents.push({
      kind: 'span_start', spanId: options.modelSpanId, evidenceStatus: 'captured',
      rawPayload: { span: { kind: 'model', name: 'model', parentSpanId: null } },
    });
    if (options.responseMeta !== undefined) {
      baseEvents.push({
        kind: 'model_response', spanId: options.modelSpanId,
        evidenceStatus: 'captured', observationRole: 'provider_reported',
        payload: {
          responseEnvelope: {
            providerNativeFidelity: 'structurally_faithful',
            responseMeta: normalizeResponseMetadata(options.responseMeta),
          },
        },
      });
    }
  }

  const decodedBlueprints: EventBlueprint[] = [];
  if (terminal.kind !== 'request-failed') {
    for (const decoded of options.decodedEvents) {
      if (decoded.kind === 'provider-error') {
        if (terminal.kind !== 'upstream-failed' || terminal.code !== 'provider-error-frame') {
          warnings.push('provider-error-terminal-overrode-input');
        }
        terminal = { kind: 'upstream-failed', code: 'provider-error-frame' };
        break;
      }
      if (decoded.kind === 'chunk') decodedBlueprints.push({ ...chunkBlueprint(decoded), spanId: options.modelSpanId });
      else decodedBlueprints.push({ ...usageBlueprint(decoded), spanId: options.modelSpanId });
    }
  }

  const lossFacts = deriveLossFacts(
    options.boundaryFacts.losses,
    normalizedRequest,
    options.decodedEvents,
    terminal.kind !== 'request-failed',
    options.responseMeta,
  );
  if (
    terminal.kind === 'upstream-failed'
    && (terminal.code === 'http-error-status' || terminal.code === 'provider-error-frame')
  ) {
    lossFacts.providerErrorBody = 'not-retained';
  }
  let effectiveBoundaryFacts = options.boundaryFacts;
  if (terminal.kind === 'observation-detached') {
    effectiveBoundaryFacts = withUnknownRemainder(options.boundaryFacts);
  }
  let boundary = buildBoundary(effectiveBoundaryFacts, lossFacts, budgets);

  const admitOne = (observation: EvidenceObservation): ObservationFailureCode | undefined => {
    const verdict = admitCandidate(
      retained, observation, boundary, options, budgets, normalizedRequest.retainedCodePoints,
    );
    if (verdict === 'structural') {
      warnings.push('candidate-structurally-rejected');
      return 'internal-capture-error';
    }
    if (verdict === 'budget') {
      warnings.push('candidate-budget-rejected');
      return 'record-budget-exceeded';
    }
    retained.push(observation);
    return undefined;
  };

  for (const blueprint of [...baseEvents, ...decodedBlueprints]) {
    const allocation = nextOrdinary();
    const observation = observationFromBlueprint(blueprint, allocation, retained.length, options.traceId);
    detachedCode = admitOne(observation);
    if (detachedCode !== undefined) break;
  }

  if (detachedCode === undefined) {
    for (const observation of options.additionalRawObservations ?? []) {
      detachedCode = admitOne(observation);
      if (detachedCode !== undefined) break;
    }
  }

  if (detachedCode !== undefined) {
    terminal = { kind: 'observation-detached', code: detachedCode };
    boundary = buildBoundary(
      withUnknownRemainder(options.boundaryFacts),
      lossFacts,
      budgets,
    );
  }

  const terminalSeq = nextCanonicalSeq(retained);
  const terminalObservations = buildTerminalObservations(
    terminal,
    terminalSeq,
    options.traceId,
    options.modelSpanId,
    options.finalizationBundle,
  );
  const finalObservations = [...retained, ...terminalObservations];
  const record = buildRecord(finalObservations, boundary);
  const parsed = parseEvidenceRecord(record);
  if (!parsed.ok) {
    const codes = parsed.issues.map((issue) => issue.code).join(', ');
    throw new Error(`assembleTrace produced invalid evidence (${codes})`);
  }
  if (utf8Encode(JSON.stringify(record)).byteLength > budgets.maxSerializedEvidenceBytes) {
    throw new RangeError('reserved terminal suffix exceeds maxSerializedEvidenceBytes');
  }
  return { trace: record.trace, boundary, warnings, record };
}

type EventBlueprint = {
  kind: EventRecord['kind'];
  spanId: string | null;
  evidenceStatus: EventRecord['evidenceStatus'];
  observationRole?: EventRecord['observationRole'];
  payload?: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
};

function chunkBlueprint(decoded: Extract<AssemblerDecodedEvent, { kind: 'chunk' }>): EventBlueprint {
  const retained = decoded.delta === null ? undefined : retainText(decoded.delta);
  return {
    kind: 'model_response_chunk', spanId: '',
    evidenceStatus: retained?.leaf.evidenceStatus ?? 'captured',
    observationRole: 'provider_reported',
    payload: {
      responseEnvelope: {
        providerNativeFidelity: 'structurally_faithful',
        choiceIndex: decoded.choiceIndex,
        chunkIndex: decoded.chunkIndex,
        ...(retained !== undefined ? { deltaText: retained.leaf.text } : {}),
        ...(decoded.finishReason !== undefined ? { finishReason: [...decoded.finishReason].slice(0, 128).join('') } : {}),
      },
      ...(retained?.leaf.redaction !== undefined ? { redaction: retained.leaf.redaction } : {}),
      ...(retained?.leaf.truncation !== undefined ? { truncation: retained.leaf.truncation } : {}),
    },
  };
}

function usageBlueprint(decoded: Extract<AssemblerDecodedEvent, { kind: 'usage' }>): EventBlueprint {
  const usageValue = (value: number | undefined): { value: number; evidenceStatus: 'captured' } | undefined =>
    Number.isSafeInteger(value) && value !== undefined && value >= 0 ? { value, evidenceStatus: 'captured' } : undefined;
  return {
    kind: 'model_usage', spanId: '', evidenceStatus: 'captured', observationRole: 'provider_reported',
    payload: {
      usage: {
        evidenceStatus: 'captured',
        ...(usageValue(decoded.inputTokens) !== undefined ? { inputTokens: usageValue(decoded.inputTokens) } : {}),
        ...(usageValue(decoded.outputTokens) !== undefined ? { outputTokens: usageValue(decoded.outputTokens) } : {}),
        ...(usageValue(decoded.totalTokens) !== undefined ? { totalTokens: usageValue(decoded.totalTokens) } : {}),
      },
    },
  };
}

function observationFromBlueprint(
  blueprint: EventBlueprint,
  allocation: FinalizationValue,
  seq: number,
  traceId: string,
): EvidenceObservation {
  const spanId = blueprint.spanId === '' ? undefined : blueprint.spanId;
  return {
    observationId: allocation.observationId,
    eventId: allocation.eventId,
    traceId,
    spanId: spanId ?? null,
    seq,
    kind: blueprint.kind,
    capturedAt: allocation.capturedAt,
    evidenceStatus: blueprint.evidenceStatus,
    observationRole: blueprint.observationRole ?? null,
    payload: blueprint.rawPayload ?? blueprint.payload ?? {},
    rawCapturedAt: allocation.capturedAt,
  };
}

function admitCandidate(
  current: readonly EvidenceObservation[],
  candidate: EvidenceObservation,
  boundary: CaptureBoundary,
  options: AssemblerOptions,
  budgets: EvidenceBudgets,
  requestContentCodePoints: number,
): 'accepted' | 'structural' | 'budget' {
  if (current.some((observation) => observation.observationId === candidate.observationId)) return 'structural';
  if (!idWithinBudget(candidate.eventId, budgets) || !idWithinBudget(candidate.observationId, budgets)) return 'structural';
  const scratch = [...current, candidate];
  const collapse = collapseObservations(scratch, 'rawObservations');
  if (!collapse.ok) return 'structural';
  if (!countBudgetAllows(collapse.events.length, scratch.length, budgets, 'completion-possible')) return 'budget';
  const rawBytes = scratch.reduce((sum, observation) => sum + utf8Encode(JSON.stringify(observation.payload)).byteLength, 0);
  const reservedRawBytes = maximumTerminalRawPayloadBytes(
    nextCanonicalSeq(scratch), options.traceId, options.modelSpanId, options.finalizationBundle,
  );
  if (rawBytes + reservedRawBytes > budgets.maxRawObservationPayloadBytes) return 'budget';
  const deltaCodePoints = collapse.events.reduce((sum, event) => {
    if (event.kind !== 'model_response_chunk') return sum;
    return sum + countCodePoints(event.responseEnvelope.deltaText ?? '');
  }, 0);
  if (requestContentCodePoints + deltaCodePoints > budgets.maxRetainedContentCodePoints) return 'budget';
  const maximum = maximumFinalizableSnapshotBytes(scratch, boundary, options);
  return maximum <= budgets.maxSerializedEvidenceBytes ? 'accepted' : 'budget';
}

export function measureFinalizableSnapshotBytes(record: EvidenceRecord): number {
  return utf8Encode(JSON.stringify(record)).byteLength;
}

function maximumFinalizableSnapshotBytes(
  observations: readonly EvidenceObservation[],
  boundary: CaptureBoundary,
  options: AssemblerOptions,
): number {
  let maximum = 0;
  for (const terminal of TERMINAL_SUFFIX_ALTERNATIVES) {
    const suffix = buildTerminalObservations(
      terminal, nextCanonicalSeq(observations), options.traceId, options.modelSpanId, options.finalizationBundle,
    );
    const record = buildRecord([...observations, ...suffix], boundary);
    maximum = Math.max(maximum, measureFinalizableSnapshotBytes(record));
  }
  return maximum;
}

function maximumTerminalRawPayloadBytes(
  seq: number,
  traceId: string,
  modelSpanId: string,
  bundle: FinalizationBundle,
): number {
  let maximum = 0;
  for (const terminal of TERMINAL_SUFFIX_ALTERNATIVES) {
    const bytes = buildTerminalObservations(terminal, seq, traceId, modelSpanId, bundle)
      .reduce((sum, observation) => sum + utf8Encode(JSON.stringify(observation.payload)).byteLength, 0);
    maximum = Math.max(maximum, bytes);
  }
  return maximum;
}

function buildTerminalObservations(
  terminal: AssemblyTerminal,
  seq: number,
  traceId: string,
  modelSpanId: string,
  bundle: FinalizationBundle,
): EvidenceObservation[] {
  if (terminal.kind === 'completed') {
    return [
      terminalObservation({ kind: 'span_end', spanId: modelSpanId, evidenceStatus: 'captured' }, bundle[0], seq, traceId),
      terminalObservation({ kind: 'interaction_end', spanId: null, evidenceStatus: 'captured' }, bundle[1], seq + 1, traceId),
    ];
  }
  if (terminal.kind === 'client-cancelled' || terminal.kind === 'ingress-cancelled') {
    return [terminalObservation({
      kind: 'cancelled', spanId: null, evidenceStatus: 'captured', observationRole: 'application_constructed',
      payload: {
        lifecycleTarget: 'trace', lifecycleEffect: 'cancel',
        cancellation: { requestedBy: terminal.kind === 'client-cancelled' ? 'client' : 'ingress' },
      },
    }, bundle[0], seq, traceId)];
  }
  if (terminal.kind === 'observation-detached') {
    const code = terminal.code === 'decode-error' ? 'internal-capture-error' : terminal.code;
    return [terminalObservation({
      kind: 'error', spanId: null, evidenceStatus: 'captured', observationRole: 'unobservable',
      payload: {
        actor: 'capture', lifecycleTarget: 'none', lifecycleEffect: 'none',
        error: { type: code, message: structuralMessage(code) },
      },
    }, bundle[0], seq, traceId)];
  }
  const requestFailure = terminal.kind === 'request-failed';
  const code = terminal.code;
  return [terminalObservation({
    kind: 'error', spanId: null, evidenceStatus: 'captured',
    observationRole: requestFailure ? 'application_constructed' : 'provider_reported',
    payload: {
      actor: requestFailure ? 'capture' : 'model', lifecycleTarget: 'trace', lifecycleEffect: 'fail',
      error: { type: code, message: structuralMessage(code) },
    },
  }, bundle[0], seq, traceId)];
}

function terminalObservation(
  blueprint: EventBlueprint,
  allocation: FinalizationValue,
  seq: number,
  traceId: string,
): EvidenceObservation {
  return observationFromBlueprint(blueprint, allocation, seq, traceId);
}

function buildRecord(observations: readonly EvidenceObservation[], boundary: CaptureBoundary): EvidenceRecord {
  const collapse = collapseObservations(observations, 'rawObservations');
  if (!collapse.ok) throw new Error('terminal finalization produced a structural collision');
  const analysis: EvidenceStructuralAnalysis = {
    duplicateObservations: collapse.duplicateObservations,
    sequenceGaps: collapse.sequenceGaps,
    validationIssues: [],
    completenessDerivationAlgorithmVersion: COMPLETENESS_DERIVATION_ALGORITHM_VERSION,
  };
  const derived = deriveTrace(collapse.events, observations, {
    evidenceSchemaVersion: '1.1.0',
    captureProfile: { name: CAPTURE_PROFILE_NAME, version: CAPTURE_PROFILE_VERSION },
    captureBoundary: boundary,
  });
  analysis.validationIssues = derived.issues;
  const completeness = deriveCompleteness(derived.trace, analysis, boundary);
  return {
    rawObservations: observations,
    trace: derived.trace,
    analysis,
    completeness,
    evidenceSchemaVersion: '1.1.0',
    captureBoundary: boundary,
  };
}

function buildBoundary(
  facts: AssemblerBoundaryFacts,
  losses: StreamingLossFacts,
  budgets: EvidenceBudgets,
): CaptureBoundary {
  return {
    captureSurface: 'ingress_proxy',
    observationBoundary: 'provider_reported',
    declaredEventKinds: [
      'interaction_start', 'interaction_end', 'span_start', 'span_end',
      'model_request', 'model_response', 'model_response_chunk', 'model_usage',
      'error', 'cancelled',
    ],
    declaredSurfaces: ['ingress_proxy'],
    missingRecord: null,
    streaming: {
      ...facts,
      losses,
      assembly: {
        assembler: { name: STREAMING_ASSEMBLER_NAME, version: STREAMING_ASSEMBLER_VERSION },
        ...(facts.decoderDisposition === 'openai-sse' ? {
          decoderContract: { name: OPENAI_SSE_DECODER_CONTRACT_NAME, version: OPENAI_SSE_DECODER_CONTRACT_VERSION },
        } : {}),
      },
      captureProfile: { name: CAPTURE_PROFILE_NAME, version: CAPTURE_PROFILE_VERSION },
      detector: { name: DETECTOR_NAME, version: DETECTOR_VERSION },
      budgets,
    },
  };
}

// fallow-ignore-next-line complexity -- closed applicability-aware loss matrix
function deriveLossFacts(
  supplied: StreamingLossFacts,
  request: ReturnType<typeof normalizeRequestMessages>,
  decodedEvents: readonly AssemblerDecodedEvent[],
  requestWasRetained: boolean,
  responseMeta: ResponseMetadata | undefined,
): StreamingLossFacts {
  const deltas = decodedEvents.filter((event): event is Extract<AssemblerDecodedEvent, { kind: 'chunk' }> => event.kind === 'chunk' && event.delta !== null);
  const retainedDeltas = deltas.map((event) => retainText(event.delta!));
  const categories = new Set<UnmappedDeltaFieldCategory>(supplied.unmappedDeltaFields);
  for (const event of decodedEvents) {
    if (event.kind === 'chunk') for (const category of event.unmappedDeltaFields ?? []) categories.add(category);
  }
  const categoryOrder: readonly UnmappedDeltaFieldCategory[] = ['role', 'tool-calls', 'refusal', 'audio', 'multimodal', 'per-choice-usage', 'other-extension'];
  return {
    ...supplied,
    messageContent: !requestWasRetained
      ? supplied.messageContent
      : request.retainedLeafCount === 0
        ? 'not-observed'
        : request.truncatedContent ? 'partially-retained' : 'fully-retained',
    deltaContent: deltas.length === 0
      ? supplied.deltaContent
      : retainedDeltas.some((retained) => retained.truncated) ? 'partially-retained' : 'fully-retained',
    unmappedDeltaFields: categoryOrder.filter((category) => categories.has(category)),
    maskedContent: supplied.maskedContent || request.maskedContent || retainedDeltas.some((retained) => retained.masked),
    multimodalContentObserved: supplied.multimodalContentObserved || request.multimodalContentObserved,
    requestMessageUnknownKeysObserved: supplied.requestMessageUnknownKeysObserved || request.requestMessageUnknownKeysObserved,
    unrecognizedRoleObserved: supplied.unrecognizedRoleObserved || request.unrecognizedRoleObserved,
    providerErrorBody: decodedEvents.some((event) => event.kind === 'provider-error')
      ? 'not-retained'
      : supplied.providerErrorBody,
    contentTypeParametersDropped: supplied.contentTypeParametersDropped
      || responseMeta?.contentType?.includes(';') === true,
  };
}

function withUnknownRemainder(facts: AssemblerBoundaryFacts): AssemblerBoundaryFacts {
  return {
    ...facts,
    remainder: { ...facts.remainder, knowledge: 'unknown' },
  };
}

function normalizeResponseMetadata(meta: ResponseMetadata): ResponseMetadata {
  if (!Number.isInteger(meta.statusCode) || meta.statusCode < 100 || meta.statusCode > 599) {
    throw new RangeError('response statusCode must be an integer from 100 through 599');
  }
  const contentType = meta.contentType?.split(';', 1)[0]?.trim().toLowerCase();
  const contentEncoding = meta.contentEncoding?.trim();
  return {
    statusCode: meta.statusCode,
    ...(contentType ? { contentType: [...contentType].slice(0, 255).join('') } : {}),
    ...(contentEncoding && /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(contentEncoding)
      ? { contentEncoding: [...contentEncoding].slice(0, 255).join('') }
      : {}),
  };
}

function structuralMessage(code: string): string {
  return [...`SignalGlass observed ${code}.`].slice(0, 200).join('');
}

function assertIdentityInputs(options: AssemblerOptions, budgets: EvidenceBudgets): void {
  if (options.traceId !== options.interactionId) throw new RangeError('traceId must equal interactionId');
  const ids = [options.traceId, options.modelSpanId, ...options.ids.eventIds, ...options.ids.observationIds,
    ...options.finalizationBundle.flatMap((value) => [value.eventId, value.observationId])];
  if (ids.some((id) => !idWithinBudget(id, budgets))) throw new RangeError('assembler id exceeds maxIdLengthBytes');
  const terminalIds = options.finalizationBundle.flatMap((value) => [value.eventId, value.observationId]);
  if (new Set(terminalIds).size !== terminalIds.length) throw new RangeError('finalization bundle ids must be unique');
  const eventIds = [...options.ids.eventIds, ...options.finalizationBundle.map((value) => value.eventId)];
  const observationIds = [...options.ids.observationIds, ...options.finalizationBundle.map((value) => value.observationId)];
  if (new Set(eventIds).size !== eventIds.length || new Set(observationIds).size !== observationIds.length) {
    throw new RangeError('assembler event and observation ids must be collision-free');
  }
}

function nextCanonicalSeq(observations: readonly EvidenceObservation[]): number {
  const collapse = collapseObservations(observations, 'rawObservations');
  if (!collapse.ok || collapse.events.length === 0) return 0;
  return Math.max(...collapse.events.map((event) => event.seq)) + 1;
}

function idWithinBudget(id: string, budgets: EvidenceBudgets): boolean {
  return id.length > 0 && utf8Encode(id).byteLength <= budgets.maxIdLengthBytes;
}

function assertRange(name: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
}

/** Mechanical exhaustiveness surface for T165. */
export function classifyFailureCode(
  code: ClientRequestFailureCode | UpstreamFailureCode | MalformedStreamCode | ObservationFailureCode | InternalDecoderFailureCode,
): ObservationTerminal {
  if ((CLIENT_REQUEST_FAILURE_CODES as readonly string[]).includes(code)) return 'request-failed';
  if ((UPSTREAM_FAILURE_CODES as readonly string[]).includes(code)) return 'upstream-failed';
  if ((MALFORMED_STREAM_CODES as readonly string[]).includes(code)) return 'malformed-stream';
  if ((OBSERVATION_FAILURE_CODES as readonly string[]).includes(code) || (INTERNAL_DECODER_FAILURE_CODES as readonly string[]).includes(code)) return 'observation-detached';
  throw new RangeError(`unclassified failure code: ${String(code)}`);
}

// Keep the imported transport union mechanically tied to upstream failures.
const _transportFailureCoverage: readonly TransportFailureCode[] = TRANSPORT_FAILURE_CODES;
void _transportFailureCoverage;
