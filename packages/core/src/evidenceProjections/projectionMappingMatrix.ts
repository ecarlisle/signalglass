/**
 * Executable loss-and-mapping claim table for the compatibility projections
 * (Spec 014 slice 4). Mirrors `docs/evidence-projection-matrix.md`; the
 * matrix conformance test (`projectionMappingMatrix.test.ts`) verifies that
 * every claim carries a stable ID and valid classification, that the
 * canonical event-kind coverage is exclusive over the mapping tables, and
 * that every presentable-info claim is enforced against a real projection
 * report over a real fixture (path, stage, outcome, and constrained reason
 * must all match — the check fails when the expected report entry is absent).
 *
 * Claim verification modes (exactly one per claim):
 * - `runtime` — the conformance test runs the named projection over the
 *   named fixture and asserts the actual report entry (path + stage +
 *   outcome, plus a constrained `reasonIncludes` fragment where given), a
 *   `reportField` equality, or a `viewAbsence` guarantee (serialized view
 *   contains none of the markers).
 * - `gateVerified` — the exact paired-view equality gate
 *   (`packages/reports/src/projectionParity.test.ts`) proves value-level
 *   preservation; classification must be `exact`.
 * - `conceptual` — a documentation-only claim with an explicit explanation
 *   of why no runtime entry exists (for example a §2.2 primitive family row
 *   whose executable check lives on another claim, or an absence guarantee
 *   enforced by the dedicated sentinel suites named in `verifiedBy`).
 *
 * Classification vocabulary (Spec 014 §6.2):
 * - `exact` — the legacy target expresses the value with no loss;
 * - `partial` — mapped with documented loss (approximation or reduced
 *   vocabulary);
 * - `inferred` — the projection derived a value that was not directly present
 *   (for example a deterministically synthesized identifier);
 * - `unavailable` — the legacy target cannot express it and the mapping is
 *   explicit.
 *
 * Mixed primitives use one row per outcome; a primitive with mixed outcomes is
 * never collapsed into a single misleading classification.
 *
 * This module is internal to the projection test suite: it is not re-exported
 * from `@signalglass/core`'s public surface (Spec 014 §1.2 keeps the public
 * exports minimal). The doc file is the human-facing reference; this table is
 * the executable form.
 */
import type { EventKind } from '@signalglass/evidence';
import type { ProjectionOutcome } from './types.js';

/** Fixture used by a runtime check in the matrix conformance test. */
export type MatrixFixtureName =
  | 'lifecycle-only'
  | 'minimal'
  | 'chunks'
  | 'all-kinds'
  | 'enriched';

/** Projection stage names used by the runtime checks. */
export type MatrixProjectionStage =
  | 'evidence_to_legacy_trace'
  | 'legacy_trace_to_agent_run'
  | 'evidence_to_agent_run';

/**
 * Runtime-verification descriptor. Executed by the matrix conformance test:
 * the projection runs over `fixture` and the resulting report must contain a
 * mapping matching `path` + `outcome` (+ `reasonIncludes` when given) in the
 * `stage` mappings (or in any stage when `stage` is omitted), or the report
 * field `reportField` must equal `expected`, or the serialized view must not
 * contain any `viewAbsence` marker. The check fails when the expected entry
 * is absent.
 */
export type MatrixRuntimeCheck = {
  fixture: MatrixFixtureName;
  projection?: MatrixProjectionStage;
  /** Exact mapping path (or `reasonIncludes` for kind rows with dynamic paths). */
  path?: string;
  outcome?: ProjectionOutcome;
  /** Constrained reason fragment the mapping reason must include. */
  reasonIncludes?: string;
  /** Restrict the search to one stage's mappings. */
  stage?: MatrixProjectionStage;
  /** Report attribute compared with `expected` (e.g. `sourceSchemaVersion`). */
  reportField?: string;
  expected?: string;
  /** Markers that must never appear in the serialized projection view. */
  viewAbsence?: readonly string[];
};

/** One row of the loss-and-mapping matrix. */
export type ProjectionMatrixClaim = {
  /** Stable claim ID (registry pinned by `projectionMappingMatrix.test.ts`). */
  id: string;
  /** Spec 014 §2.2 primitive name this claim covers. */
  primitive: string;
  /** Governing Spec 013 section/concept. */
  spec013: string;
  /** Legacy target field or behavior. */
  legacyTarget: string;
  /** Only `exact`, `partial`, `inferred`, or `unavailable`. */
  classification: ProjectionOutcome;
  /** Concrete reason for every non-exact mapping. */
  reason: string;
  /** Exact test file and test/claim that verifies it. */
  verifiedBy: string;
  /** Runtime report-alignment check (executed by the conformance test). */
  runtime?: MatrixRuntimeCheck;
  /** Documentation-only claim; explanation of why no runtime check exists. */
  conceptual?: string;
  /** Verified by the exact paired-view equality gate (classification exact). */
  gateVerified?: true;
};

export const PROJECTION_MAPPING_MATRIX: ReadonlyArray<ProjectionMatrixClaim> = [
  // ---- EvidenceTrace (Spec 014 §2.2.1; Spec 013 §1.1, §1.2, §2) ----
  {
    id: 'E2L-001',
    primitive: 'EvidenceTrace',
    spec013: '§1.2 interaction serialized as one record; §2.1 identifiers',
    legacyTarget: 'Trace.id',
    classification: 'exact',
    reason: 'legacy Trace.id preserves the canonical traceId; ids are opaque, caller-supplied, and never content-derived',
    verifiedBy: 'packages/reports/src/projectionParity.test.ts — "paired projection gate" (exact view equality); packages/core/src/evidenceProjections/evidenceToLegacyTrace.test.ts — "projects a minimal completed record into a valid legacy Trace"',
    runtime: { fixture: 'minimal', path: 'trace.traceId', outcome: 'exact' },
  },
  {
    id: 'E2L-002',
    primitive: 'EvidenceTrace',
    spec013: '§1.2 interactionId === traceId invariant',
    legacyTarget: 'Trace.id (value-preserving)',
    classification: 'exact',
    reason: 'the canonical interactionId equals the traceId (validated invariant); the value is preserved by legacy Trace.id, though the separate interactionId field is not carried',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports interactionId as exact (value preserved by legacy Trace.id)"',
    runtime: { fixture: 'minimal', path: 'trace.interactionId', outcome: 'exact' },
  },
  {
    id: 'E2L-003',
    primitive: 'EvidenceTrace',
    spec013: '§10 versioning',
    legacyTarget: 'ProjectionReport.sourceSchemaVersion',
    classification: 'exact',
    reason: 'the projection report records the canonical evidenceSchemaVersion; legacy Trace itself carries no schema version',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports exact, partial, inferred, and unavailable mappings" (sourceSchemaVersion "1.0.0"); projectionMappingMatrix.test.ts report-field check',
    runtime: { fixture: 'minimal', reportField: 'sourceSchemaVersion', expected: '1.0.0' },
  },
  {
    id: 'E2L-004',
    primitive: 'EvidenceTrace',
    spec013: '§9 capture profiles and policy separation',
    legacyTarget: 'Trace.mode + Trace.capturePolicy',
    classification: 'partial',
    reason: 'legacy StorageMode is not carried by canonical evidence; the projected view defaults to mode "standard" with its default capture policy, and the canonical captureProfile name/version is not representable',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports exact, partial, inferred, and unavailable mappings" (trace.captureProfile partial)',
    runtime: { fixture: 'minimal', path: 'trace.captureProfile', outcome: 'partial' },
  },
  {
    id: 'E2L-005',
    primitive: 'EvidenceTrace',
    spec013: '§5 observation boundaries',
    legacyTarget: '(no legacy field)',
    classification: 'unavailable',
    reason: 'legacy Trace has no capture-surface field; the declared capture surface is not projected',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports completeness, capture surface, observation boundary, and evidenceStatus loss"',
    runtime: { fixture: 'minimal', path: 'trace.captureSurface', outcome: 'unavailable' },
  },
  {
    id: 'E2L-006',
    primitive: 'EvidenceTrace',
    spec013: '§5.1 boundary-scoped observation roles',
    legacyTarget: '(no legacy field)',
    classification: 'unavailable',
    reason: 'legacy Trace has no observation-boundary field; the declared observation boundary is not projected (reported separately from the capture surface)',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports completeness, capture surface, observation boundary, and evidenceStatus loss"',
    runtime: { fixture: 'minimal', path: 'trace.observationBoundary', outcome: 'unavailable' },
  },
  {
    id: 'E2L-007',
    primitive: 'EvidenceTrace',
    spec013: '§2.3 timestamps and durations',
    legacyTarget: 'Trace.startedAt',
    classification: 'exact',
    reason: 'legacy startedAt preserves the canonical startedAt',
    verifiedBy: 'paired projection gate; evidenceToLegacyTrace.test.ts — "projects a minimal completed record into a valid legacy Trace"',
    runtime: { fixture: 'minimal', path: 'trace.startedAt', outcome: 'exact' },
  },
  {
    id: 'E2L-008',
    primitive: 'EvidenceTrace',
    spec013: '§2.3; §4.7 terminal observation',
    legacyTarget: 'Trace.endedAt',
    classification: 'exact',
    reason: 'legacy endedAt preserves the canonical finishedAt when a terminal state was observed',
    verifiedBy: 'paired projection gate (completed fixture); evidenceToLegacyTrace.test.ts — "projects a minimal completed record into a valid legacy Trace"',
    runtime: { fixture: 'minimal', path: 'trace.finishedAt', outcome: 'exact' },
  },
  {
    id: 'E2L-009',
    primitive: 'EvidenceTrace',
    spec013: '§4.7 unobserved lifecycle termination',
    legacyTarget: 'Trace.endedAt (omitted)',
    classification: 'unavailable',
    reason: 'canonical trace has no observed terminal time (status "unknown"); legacy endedAt is omitted and the unobserved termination is never fabricated',
    verifiedBy: 'paired projection gate (lifecycle-only fixture); projectionMappingMatrix.test.ts runtime check',
    runtime: { fixture: 'lifecycle-only', path: 'trace.finishedAt', outcome: 'unavailable' },
  },
  {
    id: 'E2L-010',
    primitive: 'EvidenceTrace',
    spec013: '§4.7 trace/span status vocabulary',
    legacyTarget: 'Trace.status (success | error | started)',
    classification: 'partial',
    reason: 'the canonical four-state status vocabulary (completed/failed/cancelled/unknown) is approximated by the three-value legacy set (success/error/started): completed→success, failed→error, cancelled→error (no legacy cancellation status), unknown→started (termination unobserved)',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports legacy status vocabulary loss as partial"',
    runtime: { fixture: 'minimal', path: 'trace.status', outcome: 'partial' },
  },
  {
    id: 'E2L-011',
    primitive: 'EvidenceTrace',
    spec013: '§1.1 conditions metadata',
    legacyTarget: '(no legacy field)',
    classification: 'unavailable',
    reason: 'legacy Trace has no conditions field; canonical experimental/environmental conditions are not projected (mapping emitted only when conditions are present)',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports conditions and span loss only when those fields are present"; projectionMappingMatrix.test.ts runtime check',
    runtime: { fixture: 'enriched', path: 'trace.conditions', outcome: 'unavailable' },
  },
  {
    id: 'E2L-012',
    primitive: 'EvidenceTrace',
    spec013: '§1.3 spans versus events; §2.2 span ordering',
    legacyTarget: '(no legacy span concept)',
    classification: 'unavailable',
    reason: 'legacy Trace has no span records; span hierarchy, kind, name, lifecycle status, seq ordering, and timing are not projected',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports conditions and span loss only when those fields are present"; projectionMappingMatrix.test.ts runtime check',
    runtime: { fixture: 'minimal', path: 'trace.spans', outcome: 'unavailable' },
  },
  {
    id: 'E2L-013',
    primitive: 'EvidenceTrace',
    spec013: '§3.1 canonical event kinds',
    legacyTarget: 'Trace.events[]',
    classification: 'partial',
    reason: 'the canonical event set is larger than the legacy TraceEventType vocabulary; mapped kinds project in seq order and kinds without a legacy equivalent are omitted with unavailable mappings',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "projects every canonical event kind to its legacy type or omits it with an unavailable mapping"',
    conceptual:
      'aggregate row for the event-set mapping; the executable per-kind checks live on rows E2L-024..E2L-043, and the mapping-table exclusivity test in evidenceToLegacyTrace.test.ts covers the complete EVENT_KINDS set',
  },

  // ---- SpanRecord (Spec 014 §2.2.2; Spec 013 §1.3) ----
  {
    id: 'E2L-014',
    primitive: 'SpanRecord',
    spec013: '§1.3 spans versus events',
    legacyTarget: '(no legacy span records; span_start/span_end events omitted)',
    classification: 'unavailable',
    reason: 'legacy TraceEventType has no span-lifecycle type; span_start/span_end control events are omitted rather than mis-mapped to a content-bearing legacy kind',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "projects every canonical event kind to its legacy type or omits it with an unavailable mapping"',
    runtime: { fixture: 'minimal', reasonIncludes: 'kind "span_start"' },
  },
  {
    id: 'E2L-015',
    primitive: 'SpanRecord',
    spec013: '§4.7 span status (completed/failed/cancelled/unknown), endSeq, finishedAt',
    legacyTarget: '(no legacy span status)',
    classification: 'unavailable',
    reason: 'legacy has no span records, so span lifecycle status, endSeq, and finishedAt semantics have no target to express',
    verifiedBy: 'projectionMappingMatrix.test.ts runtime check over the enriched fixture',
    runtime: { fixture: 'enriched', path: 'trace.spans', outcome: 'unavailable', reasonIncludes: 'status' },
  },
  {
    id: 'E2L-016',
    primitive: 'SpanRecord',
    spec013: '§2.3 monotonic durations with a declared clock basis',
    legacyTarget: '(no legacy duration field)',
    classification: 'unavailable',
    reason: 'legacy TraceEvent has no durationMs field and no clock-basis contract; span durationMs is not projected',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports conditions and span loss only when those fields are present"; projectionMappingMatrix.test.ts runtime check',
    runtime: { fixture: 'enriched', path: 'trace.spans[0].durationMs', outcome: 'unavailable' },
  },

  // ---- EventRecord common fields (Spec 014 §2.2.3; Spec 013 §3.1) ----
  {
    id: 'E2L-017',
    primitive: 'EventRecord',
    spec013: '§2.1 identifiers',
    legacyTarget: 'TraceEvent.id',
    classification: 'exact',
    reason: 'TraceEvent.id preserves the canonical eventId; ids are opaque, capture-time, and never ordering-significant',
    verifiedBy: 'paired projection gate (view event ids match the fixture)',
    gateVerified: true,
  },
  {
    id: 'E2L-018',
    primitive: 'EventRecord',
    spec013: '§1.2 nested records reference traceId only',
    legacyTarget: 'TraceEvent.traceId',
    classification: 'exact',
    reason: 'TraceEvent.traceId preserves the canonical event traceId',
    verifiedBy: 'paired projection gate',
    gateVerified: true,
  },
  {
    id: 'E2L-019',
    primitive: 'EventRecord',
    spec013: '§2.2 deterministic sequence ordering',
    legacyTarget: 'Trace.events[] order',
    classification: 'partial',
    reason: 'legacy Trace has no seq field; canonical seq ordering is preserved by event order (including ties resolved by seq over equal timestamps), but the seq value itself is not representable',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "preserves seq ordering over equal timestamps" and "reports the canonical seq ordering restriction as partial loss"',
    runtime: { fixture: 'minimal', path: 'trace.events[].seq', outcome: 'partial' },
  },
  {
    id: 'E2L-020',
    primitive: 'EventRecord',
    spec013: '§2.3 timestamps',
    legacyTarget: 'TraceEvent.timestamp',
    classification: 'exact',
    reason: 'TraceEvent.timestamp preserves the canonical capturedAt',
    verifiedBy: 'paired projection gate',
    gateVerified: true,
  },
  {
    id: 'E2L-021',
    primitive: 'EventRecord',
    spec013: '§4 evidence status',
    legacyTarget: '(no legacy field)',
    classification: 'unavailable',
    reason: 'legacy TraceEvent has no evidenceStatus field; redacted/truncated/missing/unknown evidence is never turned into content',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports completeness, capture surface, observation boundary, and evidenceStatus loss"',
    runtime: { fixture: 'minimal', path: 'trace.events[].evidenceStatus', outcome: 'unavailable' },
  },
  {
    id: 'E2L-022',
    primitive: 'EventRecord',
    spec013: '§5.1 observation roles; §11.2 ContentPhase mapping',
    legacyTarget: 'TraceEvent.contentPhase',
    classification: 'partial',
    reason: 'ContentPhase is the documented approximation of observation roles; every conversion is partial, and role "unobservable" has no phase approximation (reported unavailable, E2L-055)',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "approximates observation roles with ContentPhase and reports partial"',
    runtime: { fixture: 'minimal', path: 'trace.events[].observationRole', outcome: 'partial' },
  },
  {
    id: 'E2L-023',
    primitive: 'EventRecord',
    spec013: '§3.1 canonical event kinds',
    legacyTarget: 'TraceEvent.type',
    classification: 'partial',
    reason: 'kind maps to the documented TraceEventType equivalent with vocabulary loss (see the per-kind rows E2L-024..E2L-043)',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "maps kinds to their documented legacy types"',
    conceptual:
      'aggregate row for kind→type mapping; the executable per-kind checks live on rows E2L-024..E2L-043',
  },

  // ---- Closed canonical event kinds (Spec 013 §3.1), one row each ----
  {
    id: 'E2L-024',
    primitive: 'EventRecord — kind interaction_start',
    spec013: '§3.1 lifecycle control events',
    legacyTarget: '(omitted)',
    classification: 'unavailable',
    reason: 'legacy has no lifecycle control event type; mapping to a content-bearing legacy kind would be semantically wrong',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "projects every canonical event kind to its legacy type or omits it with an unavailable mapping"',
    runtime: { fixture: 'lifecycle-only', reasonIncludes: 'kind "interaction_start"' },
  },
  {
    id: 'E2L-025',
    primitive: 'EventRecord — kind interaction_end',
    spec013: '§3.1 lifecycle control events',
    legacyTarget: '(omitted)',
    classification: 'unavailable',
    reason: 'legacy has no lifecycle control event type',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — all-kinds projection test',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "interaction_end"' },
  },
  {
    id: 'E2L-026',
    primitive: 'EventRecord — kind span_start',
    spec013: '§3.1 lifecycle control events',
    legacyTarget: '(omitted)',
    classification: 'unavailable',
    reason: 'legacy has no span-lifecycle event type',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — all-kinds projection test',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "span_start"' },
  },
  {
    id: 'E2L-027',
    primitive: 'EventRecord — kind span_end',
    spec013: '§3.1 lifecycle control events',
    legacyTarget: '(omitted)',
    classification: 'unavailable',
    reason: 'legacy has no span-lifecycle event type',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — all-kinds projection test',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "span_end"' },
  },
  {
    id: 'E2L-028',
    primitive: 'EventRecord — kind model_request',
    spec013: '§3.1; §11.2 legacy conversion',
    legacyTarget: 'TraceEvent provider_request',
    classification: 'partial',
    reason: 'canonical model_request maps to the legacy provider_request control event; the request envelope, messages, and provider-native content are never inlined into legacy excerpts',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "projects a minimal completed record into a valid legacy Trace"; sentinel non-leakage tests',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "model_request"' },
  },
  {
    id: 'E2L-029',
    primitive: 'EventRecord — kind model_response',
    spec013: '§3.1; §11.2',
    legacyTarget: 'TraceEvent provider_response',
    classification: 'partial',
    reason: 'canonical model_response maps to the legacy provider_response control event; provider-native response content is not projected',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — all-kinds projection test; sentinel non-leakage tests',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "model_response"' },
  },
  {
    id: 'E2L-030',
    primitive: 'EventRecord — kind model_response_chunk',
    spec013: '§3.1 streaming responses; §3.2 fidelity',
    legacyTarget: 'TraceEvent provider_response (one per chunk)',
    classification: 'partial',
    reason: 'legacy has no chunk type; every canonical chunk becomes its own provider_response event in seq order (no aggregation) and the chunk kind/index semantics are lost',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "emits one legacy provider_response per canonical chunk (no aggregation)"; projectionParity.test.ts — "streaming response chunks"',
    runtime: { fixture: 'chunks', reasonIncludes: 'chunk' },
  },
  {
    id: 'E2L-031',
    primitive: 'EventRecord — kind model_usage',
    spec013: '§7 measurement records (usage is provider-reported, token accounting is a later measurement)',
    legacyTarget: 'TraceEvent inference',
    classification: 'partial',
    reason: 'canonical model_usage maps to the legacy inference event type, but numeric token accounting is unavailable until the measurement layer exists (Spec 014 §6.3)',
    verifiedBy: 'evidenceToAgentRun.test.ts — "leaves token fields unavailable (no invented token counts)"',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "model_usage"' },
  },
  {
    id: 'E2L-032',
    primitive: 'EventRecord — kind tool_call',
    spec013: '§3.1 tool activity',
    legacyTarget: 'TraceEvent tool_call',
    classification: 'partial',
    reason: 'canonical tool_call maps to the legacy tool_call type; tool arguments are not inlined into a legacy excerpt (no safe excerpt is synthesized)',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — all-kinds projection test',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "tool_call"' },
  },
  {
    id: 'E2L-033',
    primitive: 'EventRecord — kind tool_result',
    spec013: '§3.1 tool activity',
    legacyTarget: 'TraceEvent tool_result',
    classification: 'partial',
    reason: 'canonical tool_result maps to the legacy tool_result type; tool output is not inlined into a legacy excerpt',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — all-kinds projection test',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "tool_result"' },
  },
  {
    id: 'E2L-034',
    primitive: 'EventRecord — kind mcp_request',
    spec013: '§3.1 MCP activity (type-system vocabulary only in this increment)',
    legacyTarget: '(omitted)',
    classification: 'unavailable',
    reason: 'legacy has no MCP concept; mapping to tool_call would conflate the MCP protocol boundary',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — all-kinds projection test',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "mcp_request"' },
  },
  {
    id: 'E2L-035',
    primitive: 'EventRecord — kind mcp_result',
    spec013: '§3.1 MCP activity',
    legacyTarget: '(omitted)',
    classification: 'unavailable',
    reason: 'legacy has no MCP concept',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — all-kinds projection test',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "mcp_result"' },
  },
  {
    id: 'E2L-036',
    primitive: 'EventRecord — kind retrieval_request',
    spec013: '§3.1 retrieval activity',
    legacyTarget: '(omitted)',
    classification: 'unavailable',
    reason: 'legacy has no retrieval concept',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — all-kinds projection test',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "retrieval_request"' },
  },
  {
    id: 'E2L-037',
    primitive: 'EventRecord — kind retrieval_result',
    spec013: '§3.1 retrieval activity',
    legacyTarget: '(omitted)',
    classification: 'unavailable',
    reason: 'legacy has no retrieval concept',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — all-kinds projection test',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "retrieval_result"' },
  },
  {
    id: 'E2L-038',
    primitive: 'EventRecord — kind context_provider_request',
    spec013: '§3.1 context-provider activity',
    legacyTarget: '(omitted)',
    classification: 'unavailable',
    reason: 'legacy has no context-provider protocol concept',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — all-kinds projection test',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "context_provider_request"' },
  },
  {
    id: 'E2L-039',
    primitive: 'EventRecord — kind context_provider_result',
    spec013: '§3.1 context-provider activity',
    legacyTarget: '(omitted)',
    classification: 'unavailable',
    reason: 'legacy has no context-provider protocol concept',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — all-kinds projection test',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "context_provider_result"' },
  },
  {
    id: 'E2L-040',
    primitive: 'EventRecord — kind context_assembled',
    spec013: '§3.1 context assembly; §6 provenance',
    legacyTarget: 'TraceEvent context',
    classification: 'partial',
    reason: 'canonical context_assembled maps to the legacy context event; artifact references and assembled content are not inlined',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — all-kinds projection test',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "context_assembled"' },
  },
  {
    id: 'E2L-041',
    primitive: 'EventRecord — kind error',
    spec013: '§3.3 errors, cancellation, retries',
    legacyTarget: 'TraceEvent provider_error',
    classification: 'partial',
    reason: 'canonical error maps to the single legacy provider_error type; the canonical actor, lifecycleTarget, and lifecycleEffect vocabulary is not representable',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — all-kinds projection test',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "error"' },
  },
  {
    id: 'E2L-042',
    primitive: 'EventRecord — kind cancelled',
    spec013: '§3.3 errors, cancellation, retries',
    legacyTarget: '(omitted)',
    classification: 'unavailable',
    reason: 'legacy has no cancellation type',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — all-kinds projection test',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "cancelled"' },
  },
  {
    id: 'E2L-043',
    primitive: 'EventRecord — kind retry',
    spec013: '§3.3 errors, cancellation, retries',
    legacyTarget: '(omitted)',
    classification: 'unavailable',
    reason: 'legacy has no retry type',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — all-kinds projection test',
    runtime: { fixture: 'all-kinds', reasonIncludes: 'kind "retry"' },
  },

  // ---- RequestEnvelope (Spec 014 §2.2.4; Spec 013 §3.2) ----
  {
    id: 'E2L-044',
    primitive: 'RequestEnvelope',
    spec013: '§3.2 provider neutrality; §2.2 ordering',
    legacyTarget: 'Trace.provider + Trace.model',
    classification: 'inferred',
    reason: 'legacy trace-level provider/model are derived from the first canonical model_request envelope in seq order; reported inferred and never presented as canonical evidence',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "projects a minimal completed record into a valid legacy Trace" (provider/model); projectionParity.test.ts analyzer-parity block',
    runtime: { fixture: 'minimal', path: 'trace.events[].requestEnvelope', outcome: 'inferred' },
  },
  {
    id: 'E2L-045',
    primitive: 'RequestEnvelope',
    spec013: '§3.2 messages and provider-native payload',
    legacyTarget: '(no legacy excerpt)',
    classification: 'unavailable',
    reason: 'normalized messages and provider-native request content are never inlined into the legacy excerpt surface; payloadRef is not synthesized',
    verifiedBy: 'evidenceToAgentRun.test.ts — "does not leak provider-native bodies or authorization material"; projectionParity.test.ts sentinel assertions; projectionMappingMatrix.test.ts view-absence check',
    runtime: {
      fixture: 'enriched',
      viewAbsence: ['sk-enriched-sentinel-auth', 'enriched-native-request-body'],
    },
  },
  {
    id: 'E2L-046',
    primitive: 'RequestEnvelope',
    spec013: '§3.2 byte_faithful native fields (nativeEncoding/nativeContentType/nativeContentHash)',
    legacyTarget: '(no legacy hash/byte contract)',
    classification: 'unavailable',
    reason: 'legacy has no content-hash or byte-fidelity contract; the real envelope nativeContentHash is reported unavailable when present',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports byte_faithful nativeContentHash loss against the real envelope field"',
    runtime: {
      fixture: 'enriched',
      path: 'events[2].requestEnvelope.nativeContentHash',
      outcome: 'unavailable',
    },
  },

  // ---- ResponseEnvelope (Spec 014 §2.2.5; Spec 013 §3.2) ----
  {
    id: 'E2L-047',
    primitive: 'ResponseEnvelope',
    spec013: '§3.2 responses including stream chunks and final usage',
    legacyTarget: '(no legacy excerpt)',
    classification: 'unavailable',
    reason: 'finishReason and provider-native response content are never projected into legacy excerpts',
    verifiedBy: 'projectionParity.test.ts sentinel assertions; evidenceToAgentRun.test.ts — "does not leak provider-native bodies or authorization material"; projectionMappingMatrix.test.ts view-absence check',
    runtime: {
      fixture: 'enriched',
      viewAbsence: ['enriched-native-response-body'],
    },
  },
  {
    id: 'E2L-048',
    primitive: 'ResponseEnvelope',
    spec013: '§7 usage values carry per-field evidence status',
    legacyTarget: 'AgentRun output tokens / Turn outputTokens',
    classification: 'unavailable',
    reason: 'token values are only present when a measurement exists; until the measurement layer lands, token fields are unavailable and never invented from character counts (Spec 014 §6.3)',
    verifiedBy: 'evidenceToAgentRun.test.ts — "leaves token fields unavailable (no invented token counts)"',
    runtime: { fixture: 'enriched', reasonIncludes: 'token accounting' },
  },

  // ---- ContextArtifact (Spec 014 §2.2.6; Spec 013 §6.1) ----
  {
    id: 'E2L-049',
    primitive: 'ContextArtifact',
    spec013: '§6.1 artifacts with payloadRef, contentHash, provenance',
    legacyTarget: '(no legacy artifact concept)',
    classification: 'unavailable',
    reason: 'legacy has no artifact records; artifactId, payloadRef, contentHash, and provenance are not projected',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports context contributions as unavailable loss on model_request"',
    conceptual:
      'an EvidenceRecord can reference artifacts only through ContextContribution references (artifactId + locator); no projection input in this slice carries standalone ContextArtifact payload/hash/provenance data, so no runtime report entry can exist for artifact-level loss — the reference-level loss is the executable row E2L-050',
  },

  // ---- ContextContribution (Spec 014 §2.2.7; Spec 013 §6.2) ----
  {
    id: 'E2L-050',
    primitive: 'ContextContribution',
    spec013: '§6.2 contributions reference artifacts; provenanceState',
    legacyTarget: '(no legacy contribution concept)',
    classification: 'unavailable',
    reason: 'legacy Trace has no context-contribution concept; artifact references on model_request are not projected and the loss is reported',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports context contributions as unavailable loss on model_request"',
    runtime: {
      fixture: 'chunks',
      path: 'events[1].contextContributions',
      outcome: 'unavailable',
    },
  },

  // ---- Condition (Spec 014 §2.2.8; Spec 013 §1.1) ----
  {
    id: 'E2L-051',
    primitive: 'Condition',
    spec013: '§1.1 conditions as labeled metadata',
    legacyTarget: '(no legacy field)',
    classification: 'unavailable',
    reason: 'legacy Trace has no conditions field; experimental/environmental conditions are not projected',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports conditions and span loss only when those fields are present"',
    conceptual:
      'the Condition primitive loss is executed by the E2L-011 runtime check over the enriched fixture (trace.conditions unavailable); this row lists the §2.2.8 primitive family',
  },

  // ---- Completeness (Spec 014 §2.2.9; Spec 013 §4.3) ----
  {
    id: 'E2L-052',
    primitive: 'Completeness (TraceCompleteness)',
    spec013: '§4.3 evidence-record completeness (derived, never recorded evidence)',
    legacyTarget: '(no legacy completeness record)',
    classification: 'unavailable',
    reason: 'legacy Trace has no completeness record; the canonical derived completeness (eventsByStatus, seqGaps, duplicatesDetected, boundaryStatement) is not projected. The mapping path is the canonical record path "completeness" (Spec 014 §2.2.9 uses the finalized derived type TraceCompleteness)',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports completeness, capture surface, observation boundary, and evidenceStatus loss"',
    runtime: { fixture: 'minimal', path: 'completeness', outcome: 'unavailable' },
  },

  // ---- Observation boundary and capture surface (Spec 014 §2.2.10; Spec 013 §5) ----
  {
    id: 'E2L-053',
    primitive: 'Observation boundary',
    spec013: '§5.1 boundary-scoped observation roles',
    legacyTarget: 'TraceEvent.contentPhase',
    classification: 'partial',
    reason: 'observation roles are approximated by legacy ContentPhase with the same boundary discipline (phase labels describe where content was observed, never provider-internal state)',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "approximates observation roles with ContentPhase and reports partial"',
    runtime: { fixture: 'minimal', path: 'trace.events[].observationRole', outcome: 'partial' },
  },
  {
    id: 'E2L-054',
    primitive: 'Capture surface',
    spec013: '§5 scope rules',
    legacyTarget: '(no legacy field)',
    classification: 'unavailable',
    reason: 'legacy Trace has no capture-surface or observation-boundary fields',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports completeness, capture surface, observation boundary, and evidenceStatus loss"',
    conceptual:
      'the capture-surface loss is executed by the E2L-005 runtime check (trace.captureSurface unavailable); this row lists the §2.2.10 primitive family',
  },
  {
    id: 'E2L-055',
    primitive: 'Observation role — unobservable',
    spec013: '§5.1 roles; §4 evidence status',
    legacyTarget: '(no ContentPhase approximation)',
    classification: 'unavailable',
    reason: 'role "unobservable" has no ContentPhase approximation; the per-event mapping reports events[i].observationRole unavailable, and the unobservable evidence is never turned into content',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports observationRole "unobservable" as an event-specific unavailable mapping"; "never turns redacted/missing/unknown evidence into content"',
    runtime: {
      fixture: 'enriched',
      path: 'events[3].observationRole',
      outcome: 'unavailable',
    },
  },

  // ---- Capture profile reference and collection policy (Spec 014 §2.2.11; Spec 013 §9) ----
  {
    id: 'E2L-056',
    primitive: 'Capture profile reference',
    spec013: '§9.1 three independent policies',
    legacyTarget: 'Trace.mode + Trace.capturePolicy',
    classification: 'partial',
    reason: 'legacy StorageMode maps to collection-policy capture settings, not a fixed evidence field; the projected view defaults to standard mode and the canonical captureProfile name/version is not representable',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports exact, partial, inferred, and unavailable mappings" (trace.captureProfile partial)',
    conceptual:
      'the capture-profile loss is executed by the E2L-004 runtime check (trace.captureProfile partial); this row lists the §2.2.11 primitive family',
  },
  {
    id: 'E2L-057',
    primitive: 'Collection policy',
    spec013: '§9.2 policy rules; docs/capture-profiles.md',
    legacyTarget: 'Trace.capturePolicy (defaults)',
    classification: 'partial',
    reason: 'the projected view carries the default standard-mode capture policy; the canonical record does not carry per-field collection decisions onto the legacy shape',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "projects a minimal completed record into a valid legacy Trace" (mode "standard", default capture policy)',
    conceptual:
      'collection-policy defaults are an attribute of the view construction verified by the legacy-view tests; no separate report entry exists beyond the captureProfile mapping row E2L-004',
  },

  // ---- Identity, lifecycle, ordering, timing, fidelity, hash, status, usage values (Spec 014 §2.2.12) ----
  {
    id: 'E2L-058',
    primitive: 'Identity value types',
    spec013: '§2.1 identifiers opaque, caller-supplied, never ordering-significant',
    legacyTarget: 'Trace.id / TraceEvent.id',
    classification: 'exact',
    reason: 'preserved legacy ids carry the canonical ids exactly: traceId → Trace.id and each eventId → TraceEvent.id, with no synthesis or truncation',
    verifiedBy: 'paired projection gate (view ids equal the fixture); projectionParity.test.ts deterministic-id assertions',
    gateVerified: true,
  },
  {
    id: 'E2L-068',
    primitive: 'Identity value types',
    spec013: '§2.1 identifiers opaque, caller-supplied, never ordering-significant; §11.2 legacy conversion',
    legacyTarget: 'AgentRun turn/context-block ids (synthesized)',
    classification: 'inferred',
    reason: 'turn and context-block identifiers are deterministically synthesized by the second stage (pt-<traceId>-<n>), scoped to the trace; reported inferred and never presented as canonical evidence',
    verifiedBy: 'legacyTraceToAgentRun.test.ts — "reports synthesized identifiers as inferred" and "scopes deterministic generated ids to the trace (no cross-trace collisions)"; projectionParity.test.ts deterministic-id assertions',
    runtime: {
      fixture: 'minimal',
      projection: 'evidence_to_agent_run',
      stage: 'legacy_trace_to_agent_run',
      path: 'turns[0].id',
      outcome: 'inferred',
    },
  },
  {
    id: 'E2L-059',
    primitive: 'Lifecycle status vocabulary',
    spec013: '§4.7 trace/span status',
    legacyTarget: 'Trace.status',
    classification: 'partial',
    reason: 'the canonical four-state status vocabulary (completed/failed/cancelled/unknown) is approximated by the three-value legacy set (success/error/started); cancelled and unknown have no legacy equivalent',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports legacy status vocabulary loss as partial"',
    runtime: {
      fixture: 'minimal',
      path: 'trace.status',
      outcome: 'partial',
      reasonIncludes: '"completed"',
    },
  },
  {
    id: 'E2L-060',
    primitive: 'Sequence ordering (seq)',
    spec013: '§2.2 deterministic sequence; ties resolve by seq',
    legacyTarget: 'Trace.events[] order',
    classification: 'partial',
    reason: 'order is preserved by event order with seq tie-breaks over equal timestamps; the seq value is not representable and the restriction is reported',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "preserves seq ordering over equal timestamps"; projectionParity.test.ts streaming-chunks block',
    runtime: { fixture: 'chunks', path: 'trace.events[].seq', outcome: 'partial' },
  },
  {
    id: 'E2L-061',
    primitive: 'Timing (timestamps)',
    spec013: '§2.3 timestamps',
    legacyTarget: 'Trace.startedAt/endedAt + TraceEvent.timestamp',
    classification: 'exact',
    reason: 'canonical timestamps are preserved exactly on the legacy trace and events',
    verifiedBy: 'paired projection gate; evidenceToLegacyTrace.test.ts — "preserves seq ordering over equal timestamps" (string timestamps)',
    gateVerified: true,
  },
  {
    id: 'E2L-062',
    primitive: 'Timing (monotonic durations)',
    spec013: '§2.3 monotonic durationMs requires a declared clock basis',
    legacyTarget: '(no legacy duration field)',
    classification: 'unavailable',
    reason: 'legacy TraceEvent has no duration field and no clock-basis contract; durations are never fabricated',
    verifiedBy: 'projectionMappingMatrix.test.ts runtime check over the enriched fixture',
    conceptual:
      'the duration loss is executed by the E2L-016 runtime check (trace.spans[0].durationMs unavailable); this row lists the §2.2.12 timing family',
  },
  {
    id: 'E2L-063',
    primitive: 'Provider-native fidelity',
    spec013: '§3.2 fidelity discriminants (structurally_faithful | byte_faithful)',
    legacyTarget: '(no legacy fidelity field)',
    classification: 'unavailable',
    reason: 'legacy events carry no fidelity discriminant; provider-native content is not projected and fidelity is not representable',
    verifiedBy: 'projectionParity.test.ts sentinel assertions; projectionMappingMatrix.test.ts view-absence check',
    runtime: {
      fixture: 'enriched',
      viewAbsence: ['sk-enriched-sentinel-auth', 'enriched-native-request-body'],
    },
  },
  {
    id: 'E2L-064',
    primitive: 'Hashes (contentHash / nativeContentHash)',
    spec013: '§4.5 hash selection and scope; §3.2 native hash',
    legacyTarget: '(no legacy hash contract)',
    classification: 'unavailable',
    reason: 'legacy Trace has no content-hash contract; the actual envelope nativeContentHash fields present in a byte_faithful record are reported unavailable (there is no aggregate "trace.hashes" field — the real fields are events[i].requestEnvelope/responseEnvelope.nativeContentHash)',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports byte_faithful nativeContentHash loss against the real envelope field"',
    runtime: {
      fixture: 'enriched',
      path: 'events[2].requestEnvelope.nativeContentHash',
      outcome: 'unavailable',
    },
  },
  {
    id: 'E2L-065',
    primitive: 'Evidence status values',
    spec013: '§4.1 status values',
    legacyTarget: '(no legacy field)',
    classification: 'unavailable',
    reason: 'legacy TraceEvent has no evidenceStatus field; statuses are never collapsed into null or omitted fields',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "reports completeness, capture surface, observation boundary, and evidenceStatus loss"',
    conceptual:
      'the evidence-status loss is executed by the E2L-021 runtime check (trace.events[].evidenceStatus unavailable); this row lists the §2.2.12 status family',
  },
  {
    id: 'E2L-066',
    primitive: 'Missing / redaction / truncation declarations',
    spec013: '§4 evidence status; docs/privacy.md',
    legacyTarget: '(no legacy declarations)',
    classification: 'unavailable',
    reason: 'missing, redaction, and truncation declarations are not representable in the legacy vocabulary and are never fabricated into content',
    verifiedBy: 'evidenceToLegacyTrace.test.ts — "never turns redacted/missing/unknown evidence into content" and "does not leak secrets or provider-native bodies into the legacy view"',
    conceptual:
      'these are absence guarantees over redacted fixtures; the dedicated redaction/leak suites named in verifiedBy execute them, and no report entry exists because no mapping is emitted for content that must not appear',
  },
  {
    id: 'E2L-067',
    primitive: 'Usage value types (UsageValue with per-field evidence status)',
    spec013: '§7.1 usage as provider-reported values with per-field status',
    legacyTarget: 'AgentRun/Turn token fields',
    classification: 'unavailable',
    reason: 'legacy usage is a plain number; per-field evidence status is not representable, and token fields stay unavailable until the measurement layer exists',
    verifiedBy: 'evidenceToAgentRun.test.ts — "leaves token fields unavailable (no invented token counts)"',
    runtime: { fixture: 'enriched', reasonIncludes: 'token accounting' },
  },
];

/**
 * Legacy conversion-stage claim group (Spec 014 §6.1 direction 2): the legacy
 * Trace → AgentRun projection preserves the legacy conversion behavior. These
 * are documented here (not as separate claim rows) because they are exact
 * legacy-behavior preservation, not canonical-evidence loss.
 */
export const LEGACY_CONVERSION_PRESERVATION = {
  spec013: '§11.2 Trace-to-AgentRun conversion expressed as a documented projection',
  legacyTarget: 'AgentRun view (turns, context blocks, metadata sanitization)',
  classification: 'exact',
  reason:
    'the projection wraps the existing traceToAgentRun conversion with deterministic synthesized ids (reported inferred); turn-boundary, safe-excerpt, and metadata-filtering behavior are unchanged',
  verifiedBy:
    'legacyTraceToAgentRun.test.ts — "produces an AgentRun view preserving the legacy conversion behavior"; projectionParity.test.ts agent-run parity blocks',
} as const;

/** The stable claim-ID registry pinned by the conformance test. */
export const PROJECTION_MATRIX_CLAIM_IDS: ReadonlyArray<string> =
  PROJECTION_MAPPING_MATRIX.map((claim) => claim.id);

/** Event-kind rows, keyed by canonical kind, for the exclusivity check. */
export const PROJECTION_MATRIX_EVENT_KIND_CLAIMS: Readonly<Record<EventKind, string>> = {
  interaction_start: 'E2L-024',
  interaction_end: 'E2L-025',
  span_start: 'E2L-026',
  span_end: 'E2L-027',
  model_request: 'E2L-028',
  model_response: 'E2L-029',
  model_response_chunk: 'E2L-030',
  model_usage: 'E2L-031',
  tool_call: 'E2L-032',
  tool_result: 'E2L-033',
  mcp_request: 'E2L-034',
  mcp_result: 'E2L-035',
  retrieval_request: 'E2L-036',
  retrieval_result: 'E2L-037',
  context_provider_request: 'E2L-038',
  context_provider_result: 'E2L-039',
  context_assembled: 'E2L-040',
  error: 'E2L-041',
  cancelled: 'E2L-042',
  retry: 'E2L-043',
};
