/**
 * Shared compatibility-projection contract (Spec 014 §6.2–§6.5).
 *
 * Every projection returns an explicit `ProjectionResult<T>` and never throws
 * on expected invalid or lossy input. Three outcomes are distinguished:
 *
 * - `ok: true` with all mappings `exact` — successful exact projection;
 * - `ok: true` with `partial`/`inferred`/`unavailable` entries — successful
 *   lossy projection (loss from otherwise valid input is a success, never a
 *   failure);
 * - `ok: false` with structured `ProjectionIssue[]` — no valid target view
 *   can be constructed.
 *
 * Projections are pure and deterministic: identical input plus identical
 * projection version produce deeply equal views and reports. They create
 * ephemeral, non-authoritative views by default (Spec 014 §6.5).
 *
 * All contracts use `type` declarations per repository convention.
 */

/** Which projection stage produced a mapping or issue. */
export type ProjectionStage =
  | 'evidence_to_legacy_trace'
  | 'legacy_trace_to_agent_run';

/** Mapping outcome vocabulary (Spec 014 §6.2). */
export type ProjectionOutcome = 'exact' | 'partial' | 'inferred' | 'unavailable';

/** One loss/identity mapping entry inside a projection report. */
export type ProjectionMapping = {
  /** Input path, e.g. `events[3]` or `trace.status`. */
  path: string;
  /** Which projection produced this mapping. */
  stage: ProjectionStage;
  /** `exact` | `partial` | `inferred` | `unavailable`. */
  outcome: ProjectionOutcome;
  /** Why the mapping is not exact; never echoes payload content or secrets. */
  reason: string;
};

/**
 * Projection report (Spec 014 §6.5). Carries the projection's own version
 * and the schema version it was produced from; consumers can tell which
 * layer produced which shape.
 */
export type ProjectionReport = {
  /** Version of the projection function that produced this report. */
  projectionVersion: string;
  /** Version of the input contract this report was produced from. */
  sourceSchemaVersion: string;
  /** Ordered loss/identity mappings, in projection stage order. */
  mappings: ProjectionMapping[];
};

/**
 * Structured projection issue. `code` is a stable machine-readable code,
 * `path` locates the input, and `message` MUST NOT echo captured payload
 * values, provider-native bodies, or secrets (Spec 014 §10).
 */
export type ProjectionIssue = {
  path: string;
  stage: ProjectionStage;
  code: string;
  message: string;
};

/**
 * Explicit success/failure result of a projection (Spec 014 §6.2).
 * `ok: true` views always satisfy the target contract's invariants; a
 * projection never emits an invalid view and never throws on expected
 * invalid or lossy input.
 */
export type ProjectionResult<T> =
  | { ok: true; view: T; report: ProjectionReport }
  | { ok: false; report: ProjectionReport; issues: ProjectionIssue[] };

/**
 * Version of the canonical-evidence → legacy `Trace`/`TraceEvent` projection
 * (Spec 014 §6.5). Bumped whenever the mapping table or phase approximation
 * semantics change.
 */
export const EVIDENCE_TO_LEGACY_TRACE_PROJECTION_VERSION = '1.0.0';

/**
 * Version of the legacy `Trace`/`TraceEvent` → legacy `AgentRun` projection.
 */
export const LEGACY_TRACE_TO_AGENT_RUN_PROJECTION_VERSION = '1.0.0';

/**
 * Version of the composed canonical-evidence → legacy `AgentRun` projection.
 */
export const EVIDENCE_TO_AGENT_RUN_PROJECTION_VERSION = '1.0.0';

/**
 * Source-schema version recorded for legacy `Trace`/`TraceEvent` inputs.
 * The v0.x legacy contract carries no explicit schema version, so reports
 * produced from it use this documented constant.
 */
export const LEGACY_TRACE_SCHEMA_VERSION = 'legacy-trace-v0';

/** Stable machine-readable issue codes for the projection modules. */
export const PROJECTION_ISSUE_CODES = {
  /** Canonical input rejected by the authoritative validator (record shape, raw observations, or per-event structural issues). */
  invalidEvidenceRecord: 'invalid_evidence_record',
  /** Canonical record uses an unsupported `evidenceSchemaVersion`. */
  unsupportedSchemaVersion: 'unsupported_schema_version',
  /** Canonical record's serialized derived views disagree with the deterministic derivation. */
  traceDerivationConflict: 'trace_derivation_conflict',
  /** Canonical record violates lifecycle/terminal-evidence rules. */
  lifecycleInvalid: 'invalid_lifecycle',
  /** Legacy trace lacks an array `events` collection. */
  invalidEventCollection: 'invalid_event_collection',
  /** A legacy `events` entry fails the projection-boundary shape/vocabulary checks. */
  invalidLegacyEvent: 'invalid_legacy_event',
} as const;

export type ProjectionIssueCode =
  (typeof PROJECTION_ISSUE_CODES)[keyof typeof PROJECTION_ISSUE_CODES];
