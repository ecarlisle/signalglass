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
  serializeEvidenceRecord,
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
  /** Narrow resumable assembly state for an already-open or already-closed model span. */
  initialState?: {
    observations: readonly EvidenceObservation[];
    state: TerminalReservationState;
  };
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
  budgetMeasurements: {
    actualSerializedEvidenceBytes: number;
    maximumFinalizableSnapshotBytes: number;
    rawObservationPayloadBytes: number;
    preterminalRawObservationPayloadBytes: number;
    maximumFinalizableRawPayloadBytes: number;
    terminalAlternatives: readonly {
      terminal: AssemblyTerminal;
      suffixCount: number;
      serializedBytes: number;
      rawPayloadBytes: number;
      boundary: CaptureBoundary;
    }[];
  };
};

export const FAILURE_CLASSIFICATION = {
  requestFailed: CLIENT_REQUEST_FAILURE_CODES,
  upstreamFailed: UPSTREAM_FAILURE_CODES,
  malformedStream: MALFORMED_STREAM_CODES,
  observationDetached: [...OBSERVATION_FAILURE_CODES, ...INTERNAL_DECODER_FAILURE_CODES],
} as const;

export type FailureClassificationRow = {
  code: ClientRequestFailureCode | UpstreamFailureCode | MalformedStreamCode | ObservationFailureCode | InternalDecoderFailureCode;
  terminal: Extract<ObservationTerminal, 'request-failed' | 'upstream-failed' | 'malformed-stream' | 'observation-detached'>;
  eventKind: 'error';
  eventCode: string;
  actor: 'capture' | 'model';
  observationRole: 'application_constructed' | 'provider_reported' | 'unobservable';
  lifecycleTarget: 'trace' | 'none';
  lifecycleEffect: 'fail' | 'none';
  traceStatus: 'failed' | 'unknown';
  completenessTerminal: ObservationTerminal;
};

function classificationRow(
  code: FailureClassificationRow['code'],
  terminal: FailureClassificationRow['terminal'],
): FailureClassificationRow {
  if (terminal === 'request-failed') return {
    code, terminal, eventKind: 'error', eventCode: code, actor: 'capture',
    observationRole: 'application_constructed', lifecycleTarget: 'trace', lifecycleEffect: 'fail',
    traceStatus: 'failed', completenessTerminal: terminal,
  };
  if (terminal === 'observation-detached') return {
    code, terminal, eventKind: 'error', eventCode: code === 'decode-error' ? 'internal-capture-error' : code,
    actor: 'capture', observationRole: 'unobservable', lifecycleTarget: 'none', lifecycleEffect: 'none',
    traceStatus: 'unknown', completenessTerminal: terminal,
  };
  return {
    code, terminal, eventKind: 'error', eventCode: code, actor: 'model',
    observationRole: 'provider_reported', lifecycleTarget: 'trace', lifecycleEffect: 'fail',
    traceStatus: 'failed', completenessTerminal: terminal,
  };
}

export const FAILURE_CLASSIFICATION_ROWS: readonly FailureClassificationRow[] = [
  ...CLIENT_REQUEST_FAILURE_CODES.map((code) => classificationRow(code, 'request-failed')),
  ...UPSTREAM_FAILURE_CODES.map((code) => classificationRow(code, 'upstream-failed')),
  ...MALFORMED_STREAM_CODES.map((code) => classificationRow(code, 'malformed-stream')),
  ...OBSERVATION_FAILURE_CODES.map((code) => classificationRow(code, 'observation-detached')),
  ...INTERNAL_DECODER_FAILURE_CODES.map((code) => classificationRow(code, 'observation-detached')),
];

const TERMINAL_SUFFIX_ALTERNATIVES: readonly AssemblyTerminal[] = [
  { kind: 'completed' },
  ...UPSTREAM_FAILURE_CODES.map((code) => ({ kind: 'upstream-failed' as const, code })),
  ...MALFORMED_STREAM_CODES.map((code) => ({ kind: 'malformed-stream' as const, code })),
  ...CLIENT_REQUEST_FAILURE_CODES.map((code) => ({ kind: 'request-failed' as const, code })),
  { kind: 'client-cancelled' },
  { kind: 'ingress-cancelled' },
  ...OBSERVATION_FAILURE_CODES.map((code) => ({ kind: 'observation-detached' as const, code })),
  ...INTERNAL_DECODER_FAILURE_CODES.map((code) => ({ kind: 'observation-detached' as const, code })),
];

export type TerminalReservationState = 'completion-possible' | 'span-closed';

type AssemblerState = TerminalReservationState;

type TerminalSnapshot = {
  terminal: AssemblyTerminal;
  boundary: CaptureBoundary;
  suffix: readonly EvidenceObservation[];
  record: EvidenceRecord;
  serializedBytes: number;
  rawPayloadBytes: number;
};

type TerminalPreviewMaximum = {
  snapshots: readonly TerminalSnapshot[];
  serializedBytes: number;
  rawPayloadBytes: number;
};

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
  const retained: EvidenceObservation[] = [...(options.initialState?.observations ?? [])];
  if (options.initialState !== undefined) assertInitialState(retained, budgets);
  let ordinaryIdPosition = 0;
  let terminal = options.terminal;
  const state: AssemblerState = options.initialState?.state ?? 'completion-possible';
  let detachedCode: ObservationFailureCode | InternalDecoderFailureCode | undefined;
  const requestContentCodePoints = options.initialState === undefined
    ? normalizedRequest.retainedCodePoints
    : retainedRequestContentCodePoints(retained);

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
  if (options.initialState === undefined && terminal.kind !== 'request-failed') {
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

  const lossFacts = options.initialState === undefined
    ? deriveLossFacts(
      options.boundaryFacts.losses,
      normalizedRequest,
      options.decodedEvents,
      terminal.kind !== 'request-failed',
      options.responseMeta,
    )
    : { ...options.boundaryFacts.losses };
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

  const admitMany = (observations: readonly EvidenceObservation[]): ObservationFailureCode | undefined => {
    const verdict = admitCandidate(
      retained, observations, boundary, options, budgets, requestContentCodePoints, state,
    );
    if (verdict === 'structural') {
      warnings.push('candidate-structurally-rejected');
      return 'internal-capture-error';
    }
    if (verdict === 'budget') {
      warnings.push('candidate-budget-rejected');
      return 'record-budget-exceeded';
    }
    retained.push(...observations);
    return undefined;
  };

  const blueprints = options.initialState === undefined ? [...baseEvents, ...decodedBlueprints] : [];
  for (let position = 0; position < blueprints.length; position += 1) {
    const blueprint = blueprints[position]!;
    const allocation = nextOrdinary();
    const observation = observationFromBlueprint(blueprint, allocation, retained.length, options.traceId);
    if (blueprint.kind === 'model_request' && blueprints[position + 1]?.kind === 'span_start') {
      const spanBlueprint = blueprints[position + 1]!;
      const spanObservation = observationFromBlueprint(
        spanBlueprint,
        nextOrdinary(),
        retained.length + 1,
        options.traceId,
      );
      detachedCode = admitMany([observation, spanObservation]);
      position += 1;
    } else {
      detachedCode = admitMany([observation]);
    }
    if (detachedCode !== undefined) break;
  }

  if (detachedCode === undefined) {
    for (const observation of options.additionalRawObservations ?? []) {
      detachedCode = admitMany([observation]);
      if (detachedCode !== undefined) break;
    }
  }

  if (detachedCode !== undefined) {
    terminal = { kind: 'observation-detached', code: detachedCode };
    boundary = transitionBoundaryForTerminal(boundary, terminal, retained);
  }

  const previews = maximumFinalizableSnapshot(retained, boundary, options, state);
  const actual = finalizeTerminalSnapshot(retained, boundary, options, terminal, state, budgets, true);
  if (actual === undefined) {
    throw new Error('assembleTrace could not construct a valid terminal snapshot');
  }
  if (actual.serializedBytes > budgets.maxSerializedEvidenceBytes) {
    throw new RangeError('reserved terminal suffix exceeds maxSerializedEvidenceBytes');
  }
  const rawObservationPayloadBytes = actual.record.rawObservations.reduce(
    (sum, observation) => sum + rawPayloadBytes(observation),
    0,
  );
  const preterminalRawObservationPayloadBytes = retained.reduce(
    (sum, observation) => sum + rawPayloadBytes(observation),
    0,
  );
  if (rawObservationPayloadBytes > budgets.maxRawObservationPayloadBytes) {
    throw new RangeError('reserved terminal suffix exceeds maxRawObservationPayloadBytes');
  }
  return {
    trace: actual.record.trace,
    boundary: actual.boundary,
    warnings,
    record: actual.record,
    budgetMeasurements: {
      actualSerializedEvidenceBytes: actual.serializedBytes,
      maximumFinalizableSnapshotBytes: previews.serializedBytes,
      rawObservationPayloadBytes,
      preterminalRawObservationPayloadBytes,
      maximumFinalizableRawPayloadBytes: previews.rawPayloadBytes,
      terminalAlternatives: previews.snapshots.map((snapshot) => ({
        terminal: snapshot.terminal,
        suffixCount: snapshot.suffix.length,
        serializedBytes: snapshot.serializedBytes,
        rawPayloadBytes: snapshot.rawPayloadBytes,
        boundary: snapshot.boundary,
      })),
    },
  };
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

// fallow-ignore-next-line complexity -- normative atomic-admission budget matrix
function admitCandidate(
  current: readonly EvidenceObservation[],
  candidates: readonly EvidenceObservation[],
  boundary: CaptureBoundary,
  options: AssemblerOptions,
  budgets: EvidenceBudgets,
  requestContentCodePoints: number,
  state: AssemblerState,
): 'accepted' | 'structural' | 'budget' {
  const observationIds = new Set(current.map((observation) => observation.observationId));
  for (const candidate of candidates) {
    if (observationIds.has(candidate.observationId)) return 'structural';
    observationIds.add(candidate.observationId);
    if (!idWithinBudget(candidate.eventId, budgets) || !idWithinBudget(candidate.observationId, budgets)) return 'structural';
  }
  const scratch = [...current, ...candidates];
  const collapse = collapseObservations(scratch, 'rawObservations');
  if (!collapse.ok) return 'structural';
  if (!countBudgetAllows(collapse.events.length, scratch.length, budgets, state)) return 'budget';
  const rawBytes = scratch.reduce((sum, observation) => sum + rawPayloadBytes(observation), 0);
  const deltaCodePoints = collapse.events.reduce((sum, event) => {
    if (event.kind !== 'model_response_chunk') return sum;
    return sum + countCodePoints(event.responseEnvelope.deltaText ?? '');
  }, 0);
  if (requestContentCodePoints + deltaCodePoints > budgets.maxRetainedContentCodePoints) return 'budget';
  const maximum = maximumFinalizableSnapshot(scratch, boundary, options, state);
  if (maximum.snapshots.length === 0) return 'structural';
  if (rawBytes + maximum.rawPayloadBytes > budgets.maxRawObservationPayloadBytes) return 'budget';
  return maximum.serializedBytes <= budgets.maxSerializedEvidenceBytes ? 'accepted' : 'budget';
}

export function measureFinalizableSnapshotBytes(record: EvidenceRecord): number {
  return utf8Encode(serializeEvidenceRecord(record, { allowBudgetExcess: true })).byteLength;
}

function maximumFinalizableSnapshot(
  observations: readonly EvidenceObservation[],
  boundary: CaptureBoundary,
  options: AssemblerOptions,
  state: AssemblerState,
): TerminalPreviewMaximum {
  const snapshots: TerminalSnapshot[] = [];
  for (const terminal of TERMINAL_SUFFIX_ALTERNATIVES) {
    if (state === 'span-closed' && terminal.kind !== 'completed') continue;
    const alternativeBoundary = terminalEquals(terminal, options.terminal)
      ? boundary
      : transitionBoundaryForTerminal(boundary, terminal, observations);
    const snapshot = finalizeTerminalSnapshot(
      observations,
      alternativeBoundary,
      options,
      terminal,
      state,
      options.evidenceBudgets ?? DEFAULT_EVIDENCE_BUDGETS,
    );
    if (snapshot !== undefined) snapshots.push(snapshot);
  }
  return {
    snapshots,
    serializedBytes: Math.max(0, ...snapshots.map((snapshot) => snapshot.serializedBytes)),
    rawPayloadBytes: Math.max(0, ...snapshots.map((snapshot) => snapshot.rawPayloadBytes)),
  };
}

// fallow-ignore-next-line complexity -- closed state-dependent terminal finalization matrix
function finalizeTerminalSnapshot(
  observations: readonly EvidenceObservation[],
  boundary: CaptureBoundary,
  options: AssemblerOptions,
  terminal: AssemblyTerminal,
  state: AssemblerState,
  budgets: EvidenceBudgets,
  diagnose = false,
  spanClosedBundleIndex: 0 | 1 = 0,
): TerminalSnapshot | undefined {
  if (terminal.kind === 'completed' && state === 'completion-possible') {
    const spanEnd = terminalObservation(
      { kind: 'span_end', spanId: options.modelSpanId, evidenceStatus: 'captured' },
      options.finalizationBundle[0],
      nextCanonicalSeq(observations),
      options.traceId,
    );
    const afterSpan = [...observations, spanEnd];
    const collapsed = collapseObservations(afterSpan, 'rawObservations');
    if (!collapsed.ok || !countBudgetAllows(collapsed.events.length, afterSpan.length, budgets, 'span-closed')) {
      return undefined;
    }
    const closed = finalizeTerminalSnapshot(afterSpan, boundary, options, terminal, 'span-closed', budgets, diagnose, 1);
    return closed === undefined ? undefined : {
      ...closed,
      suffix: [spanEnd, ...closed.suffix],
      rawPayloadBytes: rawPayloadBytes(spanEnd) + closed.rawPayloadBytes,
    };
  }
  const seq = nextCanonicalSeq(observations);
  const suffix = buildTerminalObservations(terminal, state, seq, options, spanClosedBundleIndex);
  if (suffix === undefined) return undefined;
  const finalObservations = [...observations, ...suffix];
  const collapse = collapseObservations(finalObservations, 'rawObservations');
  if (!collapse.ok) return undefined;
  if (collapse.events.length > budgets.maxCanonicalEvents || finalObservations.length > budgets.maxRawObservations) {
    return undefined;
  }
  const record = buildRecord(finalObservations, boundary);
  const validationRecord = diagnose
    ? record
    : buildRecord(finalObservations, withValidationBudgets(boundary));
  const parsed = parseEvidenceRecord(validationRecord);
  if (!parsed.ok) {
    if (diagnose) throw new Error(`invalid terminal snapshot (${record.trace.events.map((event) => event.kind).join(' -> ')}): ${parsed.issues.map((issue) => `${issue.code}@${issue.path}`).join(', ')}`);
    return undefined;
  }
  return {
    terminal,
    boundary,
    suffix,
    record,
    serializedBytes: measureFinalizableSnapshotBytes(record),
    rawPayloadBytes: suffix.reduce((sum, observation) => sum + rawPayloadBytes(observation), 0),
  };
}

function withValidationBudgets(boundary: CaptureBoundary): CaptureBoundary {
  if (boundary.streaming === undefined) return boundary;
  return {
    ...boundary,
    streaming: {
      ...boundary.streaming,
      budgets: {
        maxCanonicalEvents: 1_000_000,
        maxRawObservations: 2_000_000,
        maxRawObservationPayloadBytes: 67_108_864,
        maxRetainedContentCodePoints: 16_777_216,
        maxSerializedEvidenceBytes: 67_108_864,
        maxIdLengthBytes: boundary.streaming.budgets.maxIdLengthBytes,
      },
    },
  };
}

// fallow-ignore-next-line complexity -- closed terminal-to-canonical-event matrix
function buildTerminalObservations(
  terminal: AssemblyTerminal,
  state: AssemblerState,
  seq: number,
  options: AssemblerOptions,
  spanClosedBundleIndex: 0 | 1,
): readonly EvidenceObservation[] | undefined {
  const { traceId, modelSpanId, finalizationBundle: bundle } = options;
  if (terminal.kind === 'completed') {
    if (state !== 'span-closed') return undefined;
    return [terminalObservation(
      { kind: 'interaction_end', spanId: null, evidenceStatus: 'captured' },
      bundle[spanClosedBundleIndex],
      seq,
      traceId,
    )];
  }
  if (state === 'span-closed') return undefined;
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

function rawPayloadBytes(observation: EvidenceObservation): number {
  return utf8Encode(JSON.stringify(observation.payload)).byteLength;
}

// fallow-ignore-next-line complexity -- closed normalized request-part traversal
function retainedRequestContentCodePoints(observations: readonly EvidenceObservation[]): number {
  const collapse = collapseObservations(observations, 'rawObservations');
  if (!collapse.ok) return 0;
  let total = 0;
  const countLeaf = (value: unknown): void => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const text = (value as Record<string, unknown>)['text'];
      if (typeof text === 'string') total += countCodePoints(text);
    }
  };
  for (const event of collapse.events) {
    if (event.kind !== 'model_request' || !Array.isArray(event.requestEnvelope.messages)) continue;
    for (const message of event.requestEnvelope.messages) {
      const content = message.content;
      if (!Array.isArray(content)) {
        countLeaf(content);
        continue;
      }
      for (const part of content) {
        if (part.kind === 'text') countLeaf(part.text);
        else if (part.kind === 'image_url') countLeaf(part.url);
        else if (part.kind === 'tool_call') countLeaf(part.arguments);
        else if (part.kind === 'tool_result') countLeaf(part.content);
      }
    }
  }
  return total;
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

function terminalEquals(left: AssemblyTerminal, right: AssemblyTerminal): boolean {
  if (left.kind !== right.kind) return false;
  if ('code' in left && 'code' in right) return left.code === right.code;
  return !('code' in left) && !('code' in right);
}

// fallow-ignore-next-line complexity -- closed terminal-specific authoritative boundary matrix
function transitionBoundaryForTerminal(
  boundary: CaptureBoundary,
  terminal: AssemblyTerminal,
  observations: readonly EvidenceObservation[],
): CaptureBoundary {
  const current = boundary.streaming;
  if (current === undefined) return boundary;
  let losses: StreamingLossFacts = {
    ...current.losses,
    providerErrorBody: terminal.kind === 'upstream-failed'
      && (terminal.code === 'http-error-status' || terminal.code === 'provider-error-frame')
      ? 'not-retained'
      : 'not-applicable',
  };
  let facts: AssemblerBoundaryFacts = {
    upstream: current.upstream,
    clientResponse: current.clientResponse,
    decoderDisposition: current.decoderDisposition,
    remainder: current.remainder,
    losses,
  };
  const collapse = collapseObservations(observations, 'rawObservations');
  const responseMeta = collapse.ok
    ? collapse.events.find((event) => event.kind === 'model_response')?.responseEnvelope.responseMeta
    : undefined;
  const hasResponse = responseMeta !== undefined;
  const isSse = responseMeta?.statusCode !== undefined
    && responseMeta.statusCode >= 200
    && responseMeta.statusCode <= 299
    && responseMeta.contentType === 'text/event-stream';
  if (terminal.kind === 'completed') {
    facts = {
      ...facts,
      upstream: { outcome: 'response-completed' },
      clientResponse: { outcome: 'flushed' },
      decoderDisposition: 'openai-sse',
      remainder: { ...facts.remainder, knowledge: 'protocol-terminal-observed' },
    };
  } else if (terminal.kind === 'request-failed') {
    losses = {
      ...losses,
      messageContent: 'omitted',
      deltaContent: 'not-observed',
      providerErrorBody: 'not-applicable',
      unmappedDeltaFields: [],
      sseMetadataObservedButNotRetained: false,
      contentTypeParametersDropped: false,
    };
    facts = {
      ...facts,
      losses,
      upstream: { outcome: 'not-started' },
      clientResponse: { outcome: 'local-error-flushed' },
      decoderDisposition: 'not-applicable',
      remainder: { knowledge: 'not-applicable' },
    };
  } else if (terminal.kind === 'client-cancelled' || terminal.kind === 'ingress-cancelled') {
    facts = {
      ...facts,
      upstream: {
        outcome: 'cancelled-by-ingress',
        cause: terminal.kind === 'client-cancelled' ? 'client-disconnect' : 'configured-limit',
      },
      clientResponse: { outcome: hasResponse ? 'closed-before-completion' : 'not-started' },
      decoderDisposition: isSse ? 'openai-sse' : 'not-applicable',
      remainder: { ...facts.remainder, knowledge: 'unknown' },
    };
  } else if (terminal.kind === 'observation-detached') {
    const retainedEvents = collapse.ok ? collapse.events : [];
    const retainedDeltas = retainedEvents.filter((event) => event.kind === 'model_response_chunk');
    const retainedRequest = retainedEvents.some((event) => event.kind === 'model_request');
    losses = {
      ...losses,
      messageContent: retainedRequest
        ? losses.messageContent
        : losses.messageContent === 'not-observed' ? 'not-observed' : 'omitted',
      deltaContent: retainedDeltas.length > 0
        ? retainedDeltas.some((event) => event.evidenceStatus === 'truncated') ? 'partially-retained' : 'fully-retained'
        : losses.deltaContent === 'not-observed' ? 'not-observed' : 'omitted',
      sseMetadataObservedButNotRetained: hasResponse && isSse
        ? losses.sseMetadataObservedButNotRetained
        : false,
    };
    facts = {
      ...facts,
      losses,
      decoderDisposition: isSse ? 'openai-sse' : 'not-applicable',
      remainder: { ...facts.remainder, knowledge: 'unknown' },
    };
  } else if (terminal.kind === 'malformed-stream') {
    facts = {
      ...facts,
      upstream: { outcome: 'response-completed' },
      clientResponse: { outcome: 'flushed' },
      decoderDisposition: isSse ? 'openai-sse' : current.decoderDisposition,
      remainder: {
        ...facts.remainder,
        knowledge: terminal.code === 'sse-partial-frame-at-eof' || terminal.code === 'sse-eof-without-done'
          ? 'transport-eof-observed'
          : 'protocol-terminal-observed',
      },
    };
  } else if (terminal.code === 'http-error-status') {
    facts = {
      ...facts,
      upstream: { outcome: 'response-completed' },
      clientResponse: { outcome: 'local-error-flushed' },
      decoderDisposition: 'not-applicable',
      remainder: { ...facts.remainder, knowledge: 'transport-eof-observed' },
    };
  } else if (terminal.code === 'non-sse-response') {
    facts = {
      ...facts,
      upstream: { outcome: 'response-completed' },
      clientResponse: { outcome: 'flushed' },
      decoderDisposition: 'not-applicable',
      remainder: { ...facts.remainder, knowledge: 'transport-eof-observed' },
    };
  } else if (terminal.code === 'provider-error-frame') {
    facts = {
      ...facts,
      upstream: { outcome: 'response-completed' },
      clientResponse: { outcome: 'flushed' },
      decoderDisposition: 'openai-sse',
      remainder: { ...facts.remainder, knowledge: 'protocol-terminal-observed' },
    };
  } else {
    facts = {
      ...facts,
      upstream: { outcome: hasResponse ? 'stream-ended-prematurely' : 'connection-failed' },
      clientResponse: { outcome: hasResponse ? 'closed-before-completion' : 'local-error-flushed' },
      decoderDisposition: isSse ? 'openai-sse' : 'not-applicable',
      remainder: { ...facts.remainder, knowledge: 'unknown' },
    };
  }
  return buildBoundary(facts, losses, current.budgets);
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

function assertInitialState(observations: readonly EvidenceObservation[], budgets: EvidenceBudgets): void {
  const ids = new Set<string>();
  for (const observation of observations) {
    if (ids.has(observation.observationId)) throw new RangeError('initial state observation ids must be unique');
    ids.add(observation.observationId);
    if (!idWithinBudget(observation.eventId, budgets) || !idWithinBudget(observation.observationId, budgets)) {
      throw new RangeError('initial state id exceeds maxIdLengthBytes');
    }
  }
  if (!collapseObservations(observations, 'rawObservations').ok) {
    throw new RangeError('initial state must satisfy Spec 014 collapse invariants');
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
  const row = FAILURE_CLASSIFICATION_ROWS.find((candidate) => candidate.code === code);
  if (row === undefined) throw new RangeError(`unclassified failure code: ${String(code)}`);
  return row.terminal;
}

// Keep the imported transport union mechanically tied to upstream failures.
const _transportFailureCoverage: readonly TransportFailureCode[] = TRANSPORT_FAILURE_CODES;
void _transportFailureCoverage;
