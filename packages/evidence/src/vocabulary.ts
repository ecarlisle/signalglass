/**
 * Closed vocabularies for the canonical evidence model (Spec 013 §3–§5,
 * Spec 014 §2.2). Every vocabulary below is a closed set at validation time:
 * an unknown value is a validation error (§5.3, §5.4 of Spec 014).
 */

/** Evidence payload status (Spec 013 §4.1). `inferred` is NOT an evidence status. */
export const EVIDENCE_STATUSES = [
  'captured',
  'redacted',
  'truncated',
  'missing',
  'unknown',
  'not_applicable',
] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/** Observation role: who saw the content, at which boundary (Spec 013 §5.1). */
export const OBSERVATION_ROLES = [
  'application_constructed',
  'client_sent',
  'provider_reported',
  'returned',
  'unobservable',
] as const;

export type ObservationRole = (typeof OBSERVATION_ROLES)[number];

/** Capture surface (Spec 014 §2.2.10; docs/capture-profiles.md). */
export const CAPTURE_SURFACES = [
  'client_side',
  'ingress_proxy',
  'tool',
  'mcp',
  'context_provider',
] as const;

export type CaptureSurface = (typeof CAPTURE_SURFACES)[number];

/** Provider-native payload fidelity (Spec 013 §3.2). */
export const PROVIDER_NATIVE_FIDELITIES = [
  'structurally_faithful',
  'byte_faithful',
] as const;

export type ProviderNativeFidelity = (typeof PROVIDER_NATIVE_FIDELITIES)[number];

/**
 * Canonical event kinds (Spec 013 §3.1). Lifecycle control events carry no
 * payload and no observationRole (Spec 013 §5.1).
 */
export const EVENT_KINDS = [
  'interaction_start',
  'interaction_end',
  'span_start',
  'span_end',
  'model_request',
  'model_response',
  'model_response_chunk',
  'model_usage',
  'tool_call',
  'tool_result',
  'mcp_request',
  'mcp_result',
  'retrieval_request',
  'retrieval_result',
  'context_provider_request',
  'context_provider_result',
  'context_assembled',
  'error',
  'cancelled',
  'retry',
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

/** Lifecycle control event kinds: carry no payload, no observationRole. */
export const CONTROL_EVENT_KINDS = [
  'interaction_start',
  'interaction_end',
  'span_start',
  'span_end',
] as const;

export type ControlEventKind = (typeof CONTROL_EVENT_KINDS)[number];

/** Span kinds (Spec 014 §2.2.2). */
export const SPAN_KINDS = [
  'model',
  'tool',
  'mcp',
  'retrieval',
  'context_provider',
  'context_assembly',
] as const;

export type SpanKind = (typeof SPAN_KINDS)[number];

/** Context artifact kinds (Spec 013 §6.1). */
export const ARTIFACT_KINDS = [
  'message',
  'file',
  'document',
  'fragment',
  'tool_result',
  'mcp_response',
  'retrieval_result',
  'context_provider_result',
  'repository_content',
  'manual',
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** Content locator types (Spec 013 §6.2). */
export const CONTENT_LOCATOR_TYPES = ['whole', 'range', 'fragment', 'hash'] as const;

export type ContentLocatorType = (typeof CONTENT_LOCATOR_TYPES)[number];

/** Provenance state of a context contribution (Spec 013 §6.2). */
export const PROVENANCE_STATES = ['recorded', 'inferred_after'] as const;

export type ProvenanceState = (typeof PROVENANCE_STATES)[number];

/** Lifecycle target of an error/cancelled event (Spec 014 §2.2.12, §4.7). */
export const LIFECYCLE_TARGETS = ['trace', 'span', 'none'] as const;

export type LifecycleTarget = (typeof LIFECYCLE_TARGETS)[number];

/** Lifecycle effect of an error/cancelled event (Spec 014 §2.2.12, §4.7). */
export const LIFECYCLE_EFFECTS = ['fail', 'cancel', 'none'] as const;

export type LifecycleEffect = (typeof LIFECYCLE_EFFECTS)[number];

/** Declared failing actor on `error` events (Spec 013 §3.3). */
export const ERROR_ACTORS = [
  'agent',
  'model',
  'tool',
  'mcp',
  'retrieval',
  'context_provider',
  'capture',
] as const;

export type ErrorActor = (typeof ERROR_ACTORS)[number];

/** Trace/span status vocabulary (Spec 014 §2.2.12, §4.7). */
export const TRACE_STATUSES = ['completed', 'failed', 'cancelled', 'unknown'] as const;

export type TraceStatus = (typeof TRACE_STATUSES)[number];
export type SpanStatus = (typeof TRACE_STATUSES)[number];

/** contentHashUnavailableReason closed vocabulary (Spec 013 §6.1). */
export const CONTENT_HASH_UNAVAILABLE_REASONS = ['unsupported_canonicalizer'] as const;

export type ContentHashUnavailableReason = (typeof CONTENT_HASH_UNAVAILABLE_REASONS)[number];

/** Declared monotonic clock basis (Spec 014 §2.2.12, §4.3). */
export const CLOCK_BASIS_VALUES = ['monotonic-performance-now-ms'] as const;

export type ClockBasis = (typeof CLOCK_BASIS_VALUES)[number];
