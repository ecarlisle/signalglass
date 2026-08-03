/**
 * Raw observation and canonical trace view types (Spec 014 §2.2.1–§2.2.2,
 * §5.2). The trace is a deterministic derivation from `rawObservations`;
 * `rawObservations` is authoritative and never mutated.
 */
import type {
  CaptureSurface,
  EvidenceStatus,
  EventKind,
  ObservationRole,
  SpanKind,
  SpanStatus,
  TraceStatus,
} from './vocabulary.js';
import type { Condition, SemanticVersion } from './types-base.js';
import type { EventRecord } from './types-event.js';

/**
 * A raw observation captured at the capture boundary. Every observation
 * receives a unique, immutable, opaque `observationId`. `kind` and
 * `evidenceStatus` use the closed vocabularies; `payload` is the kind-specific
 * payload preserved at the declared boundary. `rawCapturedAt` is identical to
 * `capturedAt` for the first observation and may differ for replays.
 */
export type EvidenceObservation = {
  observationId: string;
  eventId: string;
  traceId: string;
  spanId: string | null;
  seq: number;
  kind: EventKind;
  capturedAt: string;
  evidenceStatus: EvidenceStatus;
  observationRole: ObservationRole | null;
  /** Kind-specific payload (canonical event fields minus container metadata). */
  payload: unknown;
  /** Identical to `capturedAt` for the first observation; may differ for replays. */
  rawCapturedAt: string;
};

/**
 * Span record (Spec 014 §2.2.2). Content lives on events, never on spans.
 * `parentSpanId: null` for root spans; `startSeq` matches the observed
 * `span_start`. Terminal-finish rules (§4.7) are enforced by the validators:
 * `endSeq` present only for `completed` spans (equals the observed `span_end`
 * seq); `finishedAt` present iff a terminal state was observed; never `null`.
 */
export type SpanRecord = {
  spanId: string;
  kind: SpanKind;
  name: string;
  parentSpanId: string | null;
  startSeq: number;
  startedAt: string;
  status: SpanStatus;
  participants?: string[];
  /** Present only for completed spans; equals the observed `span_end` seq. */
  endSeq?: number;
  /** Present iff a terminal state was observed (§4.7). */
  finishedAt?: string;
  /** Monotonic duration; only with a declared clock basis (§4.3). */
  durationMs?: number;
};

/**
 * Canonical trace view (Spec 014 §2.2.1). The deterministic normalized view
 * of one interaction; not an independently authoritative serialized record.
 * `interactionId === traceId` is validated. Terminal-finish rule (§4.7):
 * `finishedAt` is absent (never `null`) when status is `unknown`.
 */
export type EvidenceTrace = {
  interactionId: string;
  traceId: string;
  evidenceSchemaVersion: SemanticVersion;
  captureProfile: { name: string; version: string };
  captureSurface: CaptureSurface;
  observationBoundary: ObservationRole;
  startedAt: string;
  status: TraceStatus;
  spans: readonly SpanRecord[];
  events: readonly EventRecord[];
  finishedAt?: string;
  conditions?: readonly Condition[];
};
