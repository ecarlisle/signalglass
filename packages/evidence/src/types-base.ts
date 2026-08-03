/**
 * Base identifier, version, and declaration value types (Spec 014 §2.2.12,
 * §3.2, §5.2).
 */

/** Semantic-version string (`MAJOR.MINOR.PATCH`, e.g. `1.0.0`). */
export type SemanticVersion = string;

// Identifiers are caller-supplied opaque non-empty strings (Spec 013 §2.1).
export type TraceId = string;
export type InteractionId = string;
export type SpanId = string;
export type EventId = string;
export type ArtifactId = string;
export type ObservationId = string;
export type MeasurementId = string;
export type InterpretationId = string;

/** `sha256:` + 64 lowercase hexadecimal characters (Spec 013 §3.2, §6.1). */
export type ContentHash = string;

/** RFC 6838 media type, restricted-name syntax, no parameters. */
export type ContentType = string;

/**
 * Missing-evidence declaration (Spec 014 §2.2.12, §5.8). `reportedBy`
 * records which surface/boundary reported the absence. `missing`,
 * `unknown`, and `not_applicable` payloads may carry one; they never carry
 * content, fidelity, content type, or hash.
 */
export type MissingDeclaration = {
  reason: string;
  note?: string;
  reportedBy: { captureSurface: string; observationBoundary: string };
};

/** Redaction declaration (Spec 014 §2.2.12; Spec 013 §6.1). */
export type RedactionDeclaration = {
  policy: string;
  reasons: string[];
};

/** Truncation declaration (Spec 014 §2.2.12). */
export type TruncationDeclaration = {
  maxLength: number;
  originalLength: number;
};

/**
 * Declared experimental or environmental condition (Spec 014 §2.2.8;
 * Spec 013 §1.1). Metadata, never evidence of outcome.
 */
export type Condition = {
  label: string;
  value: unknown;
  version: string;
};

/**
 * Content locator discriminant (Spec 013 §6.2, Spec 014 §2.2.7). The
 * foundation slice defines the `type` discriminant; locator-specific detail
 * fields are deferred until the artifact/content slice.
 */
export type ContentLocator = { type: 'whole' } | { type: 'range' } | {
  type: 'fragment';
} | { type: 'hash' };

/** The recorded act of adding an artifact into a model request. */
export type ContextContribution = {
  artifactId: ArtifactId;
  locator: ContentLocator;
  position: number;
  provenanceState: 'recorded' | 'inferred_after';
};

/** Usage values with per-field evidence status (Spec 013 §3.3). */
export type UsageValue = {
  value?: number;
  evidenceStatus?: string;
  reason?: string;
};

export type UsageRecord = {
  evidenceStatus: string;
  reason?: string;
  inputTokens?: UsageValue;
  outputTokens?: UsageValue;
  totalTokens?: UsageValue;
};

/** Declared monotonic clock basis for `durationMs` (§4.3). */
export type ClockBasis = 'monotonic-performance-now-ms';

/** Collection policy mirroring `docs/capture-profiles.md` (§2.2.11). */
export type CollectionPolicy = {
  name: string;
  version: string;
  surfaces: string[];
  boundaries: string[];
  payloadCapture: Record<string, unknown>;
  redactionRules: string[];
  truncation: Record<string, unknown>;
  eventKinds: string[];
};
