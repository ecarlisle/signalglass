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
 * Span terminal-state union: finish fields present exactly when a terminal
 * state was observed (§4.7). `endSeq` only for `completed` spans; `finishedAt`
 * for every observed terminal state; never `null`.
 */
export type SpanTerminalState =
  | { status: 'completed'; endSeq: number; finishedAt: string }
  | { status: 'failed'; finishedAt: string }
  | { status: 'cancelled'; finishedAt: string }
  | { status: 'unknown' };

/**
 * Span record (Spec 014 §2.2.2). Content lives on events, never on spans.
 * `parentSpanId: null` for root spans; `startSeq` matches the observed
 * `span_start`; `endSeq` present only for `completed` spans.
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

/** Trace terminal-state union: `finishedAt` present iff a terminal state was
 * observed (§4.7). */
export type TraceTerminalState =
  | { status: 'completed'; finishedAt: string }
  | { status: 'failed'; finishedAt: string }
  | { status: 'cancelled'; finishedAt: string }
  | { status: 'unknown' };

/**
 * Canonical trace view (Spec 014 §2.2.1). The deterministic normalized view
 * of one interaction; not an independently authoritative serialized record.
 * `interactionId === traceId` is validated. `finishedAt` is absent (never
 * `null`) when status is `unknown`.
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
