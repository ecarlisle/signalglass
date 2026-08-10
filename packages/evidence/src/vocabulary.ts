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

/** Decoder disposition: authoritative decoder-participation fact (§13.4). */
export const DECODER_DISPOSITIONS = ['not-applicable', 'openai-sse', 'unsupported-encoding'] as const;

export type DecoderDisposition = (typeof DECODER_DISPOSITIONS)[number];

/** Observation failure codes (Spec 016 §9.2; Spec 014 §2.2.12). */
export const OBSERVATION_FAILURE_CODES = ['frame-overflow', 'record-budget-exceeded', 'observation-encoding-unsupported', 'observation-decode-failure', 'internal-capture-error'] as const;

export type ObservationFailureCode = (typeof OBSERVATION_FAILURE_CODES)[number];

/** Request-body retention phase (Spec 016 §7.3). */
export const REQUEST_BODY_RETENTION = ['no-bytes-observed', 'partially-observed-not-retained', 'fully-observed-not-retained', 'retained'] as const;

export type RequestBodyRetention = (typeof REQUEST_BODY_RETENTION)[number];

/** Post-terminal remainder knowledge (Spec 016 §6.6, §7.3). */
export const POST_TERMINAL = ['none-observed', 'observed-not-retained', 'unknown'] as const;

export type PostTerminal = (typeof POST_TERMINAL)[number];

/** Upstream outcome (Spec 016 §2.2). */
export const UPSTREAM_OUTCOMES = ['not-started', 'response-completed', 'connection-failed', 'stream-ended-prematurely', 'cancelled-by-ingress'] as const;

export type UpstreamOutcome = (typeof UPSTREAM_OUTCOMES)[number];

/** Client response outcome (Spec 016 §2.2). */
export const CLIENT_RESPONSE_OUTCOMES = ['not-started', 'flushed', 'closed-before-completion', 'local-error-flushed'] as const;

export type ClientResponseOutcome = (typeof CLIENT_RESPONSE_OUTCOMES)[number];

/** Upstream cancellation cause (Spec 016 §2.3). */
export const UPSTREAM_CANCELLATION_CAUSES = ['client-disconnect', 'ingress-shutdown', 'configured-limit'] as const;

export type UpstreamCancellationCause = (typeof UPSTREAM_CANCELLATION_CAUSES)[number];
export type UpstreamCancelCause = UpstreamCancellationCause;

/** Malformed stream codes (Spec 016 §9.1). */
export const MALFORMED_STREAM_CODES = ['sse-invalid-data-json', 'sse-invalid-utf8', 'sse-invalid-choice-index', 'sse-partial-frame-at-eof', 'sse-eof-without-done'] as const;

export type MalformedStreamCode = (typeof MALFORMED_STREAM_CODES)[number];

/** Client request failure codes (Spec 016 §10.2). */
export const CLIENT_REQUEST_FAILURE_CODES = ['invalid-request', 'missing-api-key', 'key-unavailable', 'unroutable', 'body-read-failure'] as const;

export type ClientRequestFailureCode = (typeof CLIENT_REQUEST_FAILURE_CODES)[number];

/** Transport failure codes (Spec 016 §10.2). */
export const TRANSPORT_FAILURE_CODES = ['connection-error', 'upstream-timeout', 'tls-failure'] as const;

export type TransportFailureCode = (typeof TRANSPORT_FAILURE_CODES)[number];

export const UPSTREAM_FAILURE_CODES = [...TRANSPORT_FAILURE_CODES, 'http-error-status', 'provider-error-frame', 'non-sse-response'] as const;
export type UpstreamFailureCode = (typeof UPSTREAM_FAILURE_CODES)[number];

export const INTERNAL_DECODER_FAILURE_CODES = ['decode-error'] as const;
export type InternalDecoderFailureCode = (typeof INTERNAL_DECODER_FAILURE_CODES)[number];
export type ProviderErrorFrameCode = 'provider-error-frame';
export type NonSseResponseCode = 'non-sse-response';

/** Request message role discriminant (Spec 016 §8.7). */
export const REQUEST_ROLES = ['system', 'user', 'assistant', 'tool', 'function', 'developer', 'unrecognized'] as const;

export type RequestRole = (typeof REQUEST_ROLES)[number];

export type KnownRole = Exclude<RequestRole, 'unrecognized'>;

export type NormalizedRole = RequestRole;

export const LEAF_OWNER_STATUSES = ['captured', 'truncated', 'redacted'] as const;
export type LeafOwnerStatus = (typeof LEAF_OWNER_STATUSES)[number];

export const RETENTION4_VALUES = ['not-observed', 'fully-retained', 'partially-retained', 'omitted'] as const;
export type Retention4 = (typeof RETENTION4_VALUES)[number];

export const RETENTION3_VALUES = ['not-applicable', 'retained', 'not-retained'] as const;
export type Retention3 = (typeof RETENTION3_VALUES)[number];

export const REMAINDER_KNOWLEDGE_VALUES = ['protocol-terminal-observed', 'transport-eof-observed', 'unknown', 'not-applicable'] as const;
export type RemainderKnowledge = (typeof REMAINDER_KNOWLEDGE_VALUES)[number];

export const UNMAPPED_DELTA_FIELD_CATEGORIES = ['role', 'tool-calls', 'refusal', 'audio', 'multimodal', 'per-choice-usage', 'other-extension'] as const;
export type UnmappedDeltaFieldCategory = (typeof UNMAPPED_DELTA_FIELD_CATEGORIES)[number];

export const DECLARED_LOSS_CODES = [
  'request-body-not-retained', 'request-body-not-fully-observed', 'message-content-not-retained',
  'delta-content-not-retained', 'unmapped-delta-fields', 'provider-native-not-retained',
  'provider-error-body-not-retained', 'wire-bytes-not-retained', 'post-terminal-content-not-retained',
  'post-terminal-content-unknown', 'remainder-after-observation-detach-not-observed',
  'remainder-after-client-cancellation', 'remainder-after-ingress-cancellation', 'provider-usage-absent',
  'finish-reason-absent', 'multimodal-payload-not-retained', 'request-message-unknown-fields',
  'unrecognized-role-not-retained', 'sse-metadata-not-retained', 'unrecognized-provider-field',
  'unrecognized-extension-frame', 'response-header-values-not-retained',
  'content-type-parameters-not-retained', 'encoded-content-not-observed', 'original-content-masked',
] as const;
export type DeclaredLossCode = (typeof DECLARED_LOSS_CODES)[number];

export const OBSERVATION_TERMINALS = ['completed', 'upstream-failed', 'client-cancelled', 'ingress-cancelled', 'malformed-stream', 'request-failed', 'observation-detached'] as const;
export type ObservationTerminal = (typeof OBSERVATION_TERMINALS)[number];
export type TerminalReason = ObservationTerminal;
