import type { EvidenceObservation, EvidenceRecord, ResponseMetadata, StreamingLossFacts } from '@signalglass/evidence';
import {
  assembleTrace,
  buildTerminalBoundaryPreviews,
  observationFromDecodedEvent,
  type AssemblerBoundaryFacts,
  type AssemblerDecodedEvent,
  type AssemblyTerminal,
  type EvidenceBudgets,
  type TerminalReservationState,
} from '@signalglass/streaming';
import { retainText } from '@signalglass/streaming';
import type { EvidenceStorage, SaveOutcome } from '@signalglass/storage';
import { EvidenceContentionError } from '@signalglass/storage';
import { createStreamingIdAllocator, type StreamingIdAllocator } from './streamingIds.js';

export type PersistenceFailureCode = 'contention-exhausted' | 'storage-unavailable';
type DetachmentCode = Extract<AssemblyTerminal, { kind: 'observation-detached' }>['code'];

export interface StreamingEvidenceRuntime {
  evidenceStorage?: EvidenceStorage;
  evidenceBudgets?: EvidenceBudgets;
  onEvidenceRecord?: (record: EvidenceRecord, traceId: string) => void;
  onSaveOutcome?: (outcome: SaveOutcome, traceId: string) => void;
  onEvidenceSaveError?: (code: PersistenceFailureCode, traceId: string) => void;
}

export type EvidenceSessionInput = {
  traceId: string;
  provider: string;
  model: string;
  requestMessages: readonly unknown[];
  responseMeta?: ResponseMetadata;
  losses: StreamingLossFacts;
  decoderDisposition: 'not-applicable' | 'openai-sse' | 'unsupported-encoding';
};

export type FinalTransportFacts = Pick<AssemblerBoundaryFacts, 'upstream' | 'clientResponse' | 'remainder'>;

export class StreamingEvidenceSession {
  readonly #input: EvidenceSessionInput;
  readonly #budgets: EvidenceBudgets | undefined;
  readonly #allocator: StreamingIdAllocator;
  #observations: readonly EvidenceObservation[] = [];
  #state: TerminalReservationState = 'completion-possible';
  #losses: StreamingLossFacts;
  #detachedCode: DetachmentCode | undefined;
  #terminal: AssemblyTerminal | undefined;

  constructor(input: EvidenceSessionInput, budgets?: EvidenceBudgets) {
    this.#input = input;
    this.#budgets = budgets;
    this.#losses = input.losses;
    this.#allocator = createStreamingIdAllocator(input.traceId);
    if (input.decoderDisposition === 'openai-sse') this.#initializeSsePrefix();
  }

  get detached(): boolean {
    return this.#detachedCode !== undefined;
  }

  detach(code: DetachmentCode): void {
    if (this.#terminal !== undefined || this.#detachedCode !== undefined) return;
    this.#detachedCode = code;
  }

  observe(decoded: AssemblerDecodedEvent): void {
    if (this.#terminal !== undefined || this.#detachedCode !== undefined) return;
    if (decoded.kind === 'provider-error') {
      this.#terminal = { kind: 'upstream-failed', code: decoded.code };
      this.#losses = { ...this.#losses, providerErrorBody: 'not-retained' };
      return;
    }

    const nextLosses = lossesAfterDecodedEvent(this.#losses, decoded);
    const allocation = this.#allocator.next();
    const observation = observationFromDecodedEvent(
      decoded,
      allocation,
      this.#observations.length,
      this.#input.traceId,
      `${this.#input.traceId}-span-model`,
    );
    const result = assembleTrace(this.#assemblerOptions(
      { kind: 'completed' },
      provisionalBoundary(nextLosses, this.#input.decoderDisposition),
      [observation],
    ));
    this.#observations = result.captureState.observations;
    this.#losses = result.boundary.streaming?.losses ?? nextLosses;
    if (result.captureState.detachedCode !== undefined) {
      this.#detachedCode = result.captureState.detachedCode;
    }
  }

  finalize(
    terminal: AssemblyTerminal,
    transport: FinalTransportFacts,
    finalLosses: StreamingLossFacts,
  ): EvidenceRecord {
    const effectiveTerminal = this.#detachedCode !== undefined
      ? { kind: 'observation-detached', code: this.#detachedCode } as const
      : this.#terminal ?? terminal;
    const losses = mergeRetainedLosses(finalLosses, this.#losses, this.#input.decoderDisposition);
    const boundaryFacts: AssemblerBoundaryFacts = {
      ...transport,
      decoderDisposition: this.#input.decoderDisposition,
      losses,
    };

    if (this.#observations.length === 0) {
      const ordinaryCount = effectiveTerminal.kind === 'request-failed'
        ? 1
        : 3 + (this.#input.responseMeta === undefined ? 0 : 1);
      while (this.#allocator.eventIds.length < ordinaryCount) this.#allocator.next();
      return assembleTrace({
        ...this.#baseOptions(effectiveTerminal, boundaryFacts),
        decodedEvents: [],
        ids: {
          eventIds: this.#allocator.eventIds,
          observationIds: this.#allocator.observationIds,
        },
        capturedAtBySeq: this.#allocator.capturedAtBySeq,
      }).record;
    }

    return assembleTrace(this.#assemblerOptions(effectiveTerminal, boundaryFacts)).record;
  }

  #initializeSsePrefix(): void {
    const count = 3 + (this.#input.responseMeta === undefined ? 0 : 1);
    for (let index = 0; index < count; index += 1) this.#allocator.next();
    const boundaryFacts = provisionalBoundary(this.#losses, this.#input.decoderDisposition);
    const result = assembleTrace({
      ...this.#baseOptions({ kind: 'completed' }, boundaryFacts),
      decodedEvents: [],
      ids: {
        eventIds: this.#allocator.eventIds,
        observationIds: this.#allocator.observationIds,
      },
      capturedAtBySeq: this.#allocator.capturedAtBySeq,
    });
    this.#observations = result.captureState.observations;
    this.#losses = result.boundary.streaming?.losses ?? this.#losses;
    this.#detachedCode = result.captureState.detachedCode;
  }

  #baseOptions(terminal: AssemblyTerminal, boundaryFacts: AssemblerBoundaryFacts) {
    return {
      traceId: this.#input.traceId,
      interactionId: this.#input.traceId,
      modelSpanId: `${this.#input.traceId}-span-model`,
      provider: this.#input.provider,
      model: this.#input.model,
      requestMessages: this.#input.requestMessages,
      responseMeta: this.#input.responseMeta,
      terminal,
      boundaryFacts,
      terminalBoundaryPreviews: buildTerminalBoundaryPreviews(boundaryFacts.losses),
      finalizationBundle: this.#allocator.finalizationBundle,
      evidenceBudgets: this.#budgets,
    };
  }

  #assemblerOptions(
    terminal: AssemblyTerminal,
    boundaryFacts: AssemblerBoundaryFacts,
    additionalRawObservations: readonly EvidenceObservation[] = [],
  ) {
    return {
      ...this.#baseOptions(terminal, boundaryFacts),
      decodedEvents: [],
      ids: { eventIds: [], observationIds: [] },
      capturedAtBySeq: [],
      initialState: { observations: this.#observations, state: this.#state },
      additionalRawObservations,
    };
  }
}

export function persistEvidenceRecord(
  runtime: StreamingEvidenceRuntime,
  record: EvidenceRecord,
  traceId: string,
): void {
  let outcome: SaveOutcome | undefined;
  let failure: PersistenceFailureCode | undefined;
  if (runtime.evidenceStorage) {
    try {
      outcome = runtime.evidenceStorage.saveEvidenceRecord(record);
    } catch (error) {
      failure = error instanceof EvidenceContentionError
        ? 'contention-exhausted'
        : 'storage-unavailable';
    }
  }

  // The canonical save is authoritative and happens before any operational
  // observer can throw, stall, or otherwise interfere with persistence.
  safelyNotify(() => runtime.onEvidenceRecord?.(record, traceId));
  if (outcome !== undefined) safelyNotify(() => runtime.onSaveOutcome?.(outcome, traceId));
  if (failure !== undefined) safelyNotify(() => runtime.onEvidenceSaveError?.(failure, traceId));
}

function safelyNotify(notify: () => void): void {
  try {
    notify();
  } catch {
    // Operational observers never control transport or persistence.
  }
}

function provisionalBoundary(
  losses: StreamingLossFacts,
  decoderDisposition: EvidenceSessionInput['decoderDisposition'],
): AssemblerBoundaryFacts {
  return {
    upstream: { outcome: 'response-completed' },
    clientResponse: { outcome: 'flushed' },
    decoderDisposition,
    remainder: decoderDisposition === 'not-applicable'
      ? { knowledge: 'not-applicable' }
      : { knowledge: decoderDisposition === 'unsupported-encoding' ? 'unknown' : 'protocol-terminal-observed' },
    losses,
  };
}

function lossesAfterDecodedEvent(
  current: StreamingLossFacts,
  decoded: Exclude<AssemblerDecodedEvent, { kind: 'provider-error' }>,
): StreamingLossFacts {
  if (decoded.kind === 'usage') return current;
  const categories = new Set([...current.unmappedDeltaFields, ...(decoded.unmappedDeltaFields ?? [])]);
  if (decoded.delta === null) return { ...current, unmappedDeltaFields: [...categories] };
  const retained = retainText(decoded.delta);
  const deltaContent = current.deltaContent === 'partially-retained' || retained.truncated
    ? 'partially-retained'
    : 'fully-retained';
  return {
    ...current,
    deltaContent,
    maskedContent: current.maskedContent || retained.masked,
    unmappedDeltaFields: [...categories],
  };
}

function mergeRetainedLosses(
  finalLosses: StreamingLossFacts,
  admittedLosses: StreamingLossFacts,
  disposition: EvidenceSessionInput['decoderDisposition'],
): StreamingLossFacts {
  return {
    ...finalLosses,
    messageContent: admittedLosses.messageContent,
    deltaContent: admittedLosses.deltaContent,
    providerNative: admittedLosses.providerNative,
    providerErrorBody: admittedLosses.providerErrorBody,
    maskedContent: admittedLosses.maskedContent,
    unmappedDeltaFields: admittedLosses.unmappedDeltaFields,
    multimodalContentObserved: admittedLosses.multimodalContentObserved,
    requestMessageUnknownKeysObserved: admittedLosses.requestMessageUnknownKeysObserved,
    unrecognizedRoleObserved: admittedLosses.unrecognizedRoleObserved,
    sseMetadataObservedButNotRetained: disposition === 'openai-sse'
      ? finalLosses.sseMetadataObservedButNotRetained
      : false,
  };
}
