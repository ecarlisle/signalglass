/**
 * @signalglass/evidence — dependency-free canonical evidence primitives
 * (Spec 014 foundation slice). Zero runtime dependencies; works in Node and
 * browsers; never imports provider, storage, or analysis code.
 *
 * Public surface (Spec 014 §1.2):
 * - evidence record and vocabulary types (§2, §5.2);
 * - discriminant, identifier, and version constants (§3);
 * - runtime validators and the parse-result type (§5);
 * - `serializeEvidenceRecord` / `parseEvidenceRecord` JSON round-trip
 *   functions, plus the derivative `serializeEvidenceExport` (§5.7);
 * - deterministic pure helpers: sequence/completeness derivation,
 *   `projectCanonicalEvent`, RFC 8785 (JCS) canonicalization, canonical
 *   Base64 (RFC 4648 §4), media-type and hash-format checks (§4–§5).
 */
// Vocabulary constants + types
export {
  EVIDENCE_STATUSES,
  OBSERVATION_ROLES,
  CAPTURE_SURFACES,
  PROVIDER_NATIVE_FIDELITIES,
  EVENT_KINDS,
  CONTROL_EVENT_KINDS,
  SPAN_KINDS,
  ARTIFACT_KINDS,
  CONTENT_LOCATOR_TYPES,
  PROVENANCE_STATES,
  LIFECYCLE_TARGETS,
  LIFECYCLE_EFFECTS,
  ERROR_ACTORS,
  TRACE_STATUSES,
  CONTENT_HASH_UNAVAILABLE_REASONS,
  CLOCK_BASIS_VALUES,
} from './vocabulary.js';
export type {
  EvidenceStatus,
  ObservationRole,
  CaptureSurface,
  ProviderNativeFidelity,
  EventKind,
  ControlEventKind,
  SpanKind,
  ArtifactKind,
  ContentLocatorType,
  ProvenanceState,
  LifecycleTarget,
  LifecycleEffect,
  ErrorActor,
  TraceStatus,
  SpanStatus,
  ContentHashUnavailableReason,
  ClockBasis,
} from './vocabulary.js';

// Types
export type {
  SemanticVersion,
  TraceId,
  InteractionId,
  SpanId,
  EventId,
  ArtifactId,
  ObservationId,
  MeasurementId,
  InterpretationId,
  ContentHash,
  ContentType,
  MissingDeclaration,
  RedactionDeclaration,
  TruncationDeclaration,
  Condition,
  ContentLocator,
  ContextContribution,
  UsageValue,
  UsageRecord,
  ClockBasis as ClockBasisType,
  CollectionPolicy,
} from './types-base.js';
export type {
  NativeByteFields,
  RequestEnvelope,
  ResponseEnvelope,
} from './types-envelope.js';
export type { ContextArtifact } from './types-artifact.js';
export type {
  ToolCall,
  ToolResult,
  McpRequest,
  McpResult,
  RetrievalRequest,
  RetrievalResult,
  ContextProvider,
  RetryRecord,
  ErrorPayload,
  EventCommon,
  EventRecord,
} from './types-event.js';
export type {
  EvidenceObservation,
  SpanRecord,
  EvidenceTrace,
} from './types-trace.js';
export type {
  ObservationId as ObservationIdType,
  ObservationIdentitySet,
  ObservationPosition,
  CanonicalEventDigest,
  DiscardedPosition,
  DuplicateObservation,
  SequenceGap,
  ValidationIssue,
  EvidenceStructuralAnalysis,
} from './types-analysis.js';
export type {
  CaptureBoundary,
  TraceCompleteness,
  EvidenceRecord,
  EvidenceRecordParseResult,
} from './types-record.js';

// Version support
export {
  SUPPORTED_EVIDENCE_SCHEMA_VERSION,
  SUPPORTED_MAJOR,
  NORMALIZATION_ALGORITHM_VERSION,
  COMPLETENESS_DERIVATION_ALGORITHM_VERSION,
  CANONICAL_EVENT_PROJECTION_ALGORITHM_VERSION,
  isSupportedEvidenceSchemaVersion,
  checkEvidenceSchemaVersion,
} from './version.js';
export type { VersionCheck } from './version.js';

// Deterministic helpers
export { projectCanonicalEvent } from './project.js';
export type { ProjectedEvent } from './project.js';
export { deriveCompleteness } from './completeness.js';
export { sortUtf8, toJsonView } from './normalize.js';
export { canonicalJson, isJsonSafe } from './internal/jcs.js';
export { sha256Hex, sha256Value, utf8Encode } from './internal/sha256.js';
export { base64Encode, base64Decode, isCanonicalBase64 } from './internal/base64.js';
export { isContentHash, isContentType, isJsonContentType, isSemanticVersion, majorVersion } from './internal/formats.js';
export { isTimestamp } from './internal/time.js';

// Runtime validation and parse/serialize
export { parseEvidenceRecord, normalizeEvidenceRecord } from './validate.js';
export type { NormalizeOptions } from './validate.js';
export { serializeEvidenceRecord, serializeEvidenceExport } from './serialize.js';

// Public per-record validators
export {
  isEvidenceStatus,
  isObservationRole,
  isEventKind,
  isSpanKind,
  isArtifactKind,
  isContextArtifact,
  isCaptureBoundary,
  isRequestEnvelope,
  isResponseEnvelope,
  isEvidenceObservation,
  isSpanRecord,
  isEventRecord,
  isIdentifierString,
} from './guards.js';