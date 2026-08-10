/** Evidence record and Spec 016 S1 additive schema types. */
import type {
  CaptureSurface,
  EvidenceStatus,
  ClientResponseOutcome,
  DeclaredLossCode,
  DecoderDisposition,
  ObservationRole,
  ObservationTerminal,
  PostTerminal,
  RemainderKnowledge,
  RequestBodyRetention,
  Retention3,
  Retention4,
  UnmappedDeltaFieldCategory,
  UpstreamCancellationCause,
  UpstreamOutcome,
} from './vocabulary.js';
import type { MissingDeclaration } from './types-base.js';
import type { EvidenceTrace, EvidenceObservation } from './types-trace.js';
import type { EvidenceStructuralAnalysis, SequenceGap, ValidationIssue } from './types-analysis.js';

export type StreamingLossFacts = {
  requestBody: RequestBodyRetention;
  messageContent: Retention4;
  deltaContent: Retention4;
  providerNative: Retention3;
  providerErrorBody: Retention3;
  wireBytes: Retention3;
  postTerminalContent: PostTerminal;
  unmappedDeltaFields: readonly UnmappedDeltaFieldCategory[];
  unrecognizedExtensionFrameObserved: boolean;
  headerValuesBeyondAllowlist: boolean;
  contentTypeParametersDropped: boolean;
  maskedContent: boolean;
  contentEncodingUnsupported: boolean;
  multimodalContentObserved: boolean;
  requestMessageUnknownKeysObserved: boolean;
  unrecognizedRoleObserved: boolean;
  sseMetadataObservedButNotRetained: boolean;
};

export type StreamingCaptureBoundary = {
  upstream: { outcome: UpstreamOutcome; cause?: UpstreamCancellationCause };
  clientResponse: { outcome: ClientResponseOutcome };
  decoderDisposition: DecoderDisposition;
  remainder: {
    knowledge: RemainderKnowledge;
    lastObservedFramePosition?: number;
    rawForwardedBytes?: number;
  };
  losses: StreamingLossFacts;
  assembly: {
    assembler: { name: 'signalglass.streaming.assembler'; version: string };
    decoderContract?: { name: 'signalglass.providers.openai-sse'; version: string };
  };
  captureProfile: { name: 'signalglass.collection.ingress-metadata-safe'; version: string };
  detector: { name: 'signalglass.collection.sensitive-detector'; version: string };
  budgets: {
    maxCanonicalEvents: number;
    maxRawObservations: number;
    maxRawObservationPayloadBytes: number;
    maxRetainedContentCodePoints: number;
    maxSerializedEvidenceBytes: number;
    maxIdLengthBytes: number;
  };
};

export type CaptureBoundary = {
  captureSurface: CaptureSurface;
  observationBoundary: ObservationRole;
  declaredEventKinds: readonly string[];
  declaredSurfaces: readonly CaptureSurface[];
  missingRecord: MissingDeclaration | null;
  streaming?: StreamingCaptureBoundary;
};

export type StreamingLifecycle = {
  upstream: { outcome: UpstreamOutcome; cause?: UpstreamCancellationCause };
  clientResponse: { outcome: ClientResponseOutcome };
  observation: { terminal: ObservationTerminal };
  remainder: {
    knowledge: RemainderKnowledge;
    lastObservedFramePosition?: number;
    rawForwardedBytes?: number;
  };
};

export type TraceCompleteness = {
  eventsByStatus: Record<EvidenceStatus, number>;
  seqGaps: readonly SequenceGap[];
  duplicatesDetected: readonly string[];
  boundaryStatement: string;
  lifecycle?: StreamingLifecycle;
  declaredLosses?: readonly DeclaredLossCode[];
};

export type EvidenceRecord = {
  rawObservations: readonly EvidenceObservation[];
  trace: EvidenceTrace;
  analysis: EvidenceStructuralAnalysis;
  completeness: TraceCompleteness;
  evidenceSchemaVersion: string;
  captureBoundary: CaptureBoundary;
};

export type EvidenceRecordParseResult =
  | { ok: true; record: EvidenceRecord }
  | { ok: false; issues: readonly ValidationIssue[] };
