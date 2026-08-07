# Evidence projection loss-and-mapping matrix

**Scope:** compatibility projections (Spec 014 §6) — canonical
`EvidenceRecord` → legacy `Trace`/`TraceEvent` view (`evidenceToLegacyTrace`),
legacy `Trace`/`TraceEvent` → legacy `AgentRun` view
(`legacyTraceToAgentRun`), and the composed canonical → `AgentRun` view
(`evidenceToAgentRun`, an explicit composition of the first two). Projected
views are **ephemeral and non-authoritative** (Spec 014 §6.5).

**Slice:** Spec 014 slice 4 (projection parity and loss verification).
This document is the human-facing form of the executable claim table in
`packages/core/src/evidenceProjections/projectionMappingMatrix.ts`; the
conformance test
`packages/core/src/evidenceProjections/projectionMappingMatrix.test.ts`
pins the claim IDs and **enforces every runtime claim against an actual
projection report over a real fixture** (the check fails when the expected
report entry is absent, when the matrix classification disagrees with the
runtime outcome, or when a declared reason fragment is missing from either
the documented reason or the report mapping's reason). The two must stay
exactly aligned: the table below mirrors the executable table claim for
claim, classification for classification, reason for reason, and the
conformance test pins that mirror (claim IDs, order, classifications, and
reasons) against this document directly.

**Classification vocabulary** (Spec 014 §6.2) — every mapping is exactly one of:

- `exact` — the legacy target expresses the value/behavior and both pipeline
  paths are exactly equal;
- `partial` — mapped with documented loss (approximation or reduced
  vocabulary);
- `inferred` — the projection derived a value that was not directly present
  (for example a deterministically synthesized identifier or the trace-level
  provider/model derived from the first `model_request` envelope);
- `unavailable` — the legacy target cannot express it; the mapping is
  explicit and nothing is fabricated.

A `defect` would be an expressible value that differs, loss that is
unreported, or an inaccurate classification/reason — the parity tests treat
any such observation as a failure, and none is currently known.

**Claim verification modes** — every claim carries exactly one:

- `runtime` — the conformance test runs the named projection over the named
  fixture and asserts the actual report entry: mapping `path` + `stage` +
  `outcome` (plus a constrained `reasonIncludes` fragment where given), a
  `reportField` equality, and a `viewAbsence` guarantee — the listed markers
  stay out of **both** the projected view and the projection report, in any
  representation: as strings, as raw `Uint8Array` bytes, or as numeric
  arrays (a byte-aware walk, never a `JSON.stringify` heuristic — a leaked
  byte array serializes as an index object and would fool a string check).
  **Every supplied constraint is asserted
  together** — a passing `viewAbsence`/`reportField` check never
  substitutes for an absent mapping entry. A claim can no longer cite a check
  it does not perform. Two binding invariants close the conformance loop:
  every mapping-search claim must classify its runtime outcome exactly
  (`runtime.outcome === classification` — a mismatch fails even when the
  report contains the runtime outcome), and every non-exact mapping-search
  claim must carry a non-empty `reasonIncludes` fragment that occurs in
  **both** the claim's documented `reason` and the actual matching report
  mapping's reason (constraining the real rationale, never a generic word
  such as “legacy” or “unavailable”).
- `gateVerified` — the exact paired-view equality gate
  (`packages/reports/src/projectionParity.test.ts`) proves value-level
  preservation; classification is `exact`. The matrix test also asserts the
  preserved ids/timestamps directly against the canonical record.
- `conceptual` — a documentation-only claim with an explicit explanation of
  why no runtime report entry exists (for example a §2.2 primitive family row
  whose executable check lives on another claim, or an absence guarantee
  enforced by the dedicated sentinel suites named in `Verified by`).

## Parity subject and verification

Each paired fixture contains one canonical `EvidenceRecord` (built
deterministically in memory through the public `@signalglass/evidence`
contract) and one legacy `Trace` describing the same interaction. The
semantic gate is exact deep equality:
`evidenceToLegacyTrace(record).view === legacyTrace`. Both pipelines then
run through the real public APIs — direct legacy path
(`legacyTraceToAgentRun` → `analyzeRun` → `renderTerminal`/`renderJson`/
`renderHtml`) and canonical path (`evidenceToAgentRun` → `analyzeRun` → the
same three report functions) — and produce **identical** `AgentRun` views,
complete `AnalysisResult` values (with the wall clock frozen and asserted),
and identical terminal/JSON/HTML strings. See
`packages/reports/src/projectionParity.test.ts`. There are no broad
snapshots and no normalization of findings, IDs, order, tokens, smells,
recommendations, or report text.

The matrix below uses claim IDs `E2L-###` (evidence-to-legacy).

## EvidenceTrace (`EvidenceTrace`, Spec 014 §2.2.1; Spec 013 §1.1, §1.2, §2)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-001 | `Trace.id` | exact | legacy `Trace.id` preserves the canonical `traceId`; ids are opaque, caller-supplied, and never content-derived | paired projection gate; `evidenceToLegacyTrace.test.ts` "projects a minimal completed record into a valid legacy Trace" |
| E2L-002 | `Trace.id` (value-preserving) | exact | the canonical `interactionId` equals the `traceId` (validated invariant); the value is preserved by legacy `Trace.id`, though the separate `interactionId` field is not carried | `evidenceToLegacyTrace.test.ts` "reports interactionId as exact (value preserved by legacy Trace.id)" |
| E2L-003 | `ProjectionReport.sourceSchemaVersion` | exact | the projection report records the canonical `evidenceSchemaVersion`; legacy `Trace` itself carries no schema version | `evidenceToLegacyTrace.test.ts` "reports exact, partial, inferred, and unavailable mappings"; matrix report-field check (`sourceSchemaVersion` = `"1.0.0"`) |
| E2L-004 | `Trace.mode` + `Trace.capturePolicy` | partial | legacy StorageMode is not carried by canonical evidence; the projected view defaults to mode "standard" with its default capture policy, and the canonical captureProfile name/version is not representable | `evidenceToLegacyTrace.test.ts` "reports exact, partial, inferred, and unavailable mappings" |
| E2L-005 | (no legacy field) | unavailable | legacy `Trace` has no capture-surface field; the declared capture surface is not projected | `evidenceToLegacyTrace.test.ts` "reports completeness, capture surface, observation boundary, and evidenceStatus loss" |
| E2L-006 | (no legacy field) | unavailable | legacy `Trace` has no observation-boundary field; the declared observation boundary is not projected (reported separately from the capture surface) | same test as E2L-005 |
| E2L-007 | `Trace.startedAt` | exact | legacy `startedAt` preserves the canonical `startedAt` | paired projection gate |
| E2L-008 | `Trace.endedAt` | exact | legacy `endedAt` preserves the canonical `finishedAt` when a terminal state was observed | paired projection gate (completed fixture) |
| E2L-009 | `Trace.endedAt` (omitted) | unavailable | canonical trace has no observed terminal time (status "unknown"); legacy endedAt is omitted and the unobserved termination is never fabricated | paired projection gate (lifecycle-only fixture); matrix runtime check (`trace.finishedAt` unavailable) |
| E2L-010 | `Trace.status` | partial | the canonical four-state status vocabulary (completed/failed/cancelled/unknown) is approximated by the three-value legacy set (success/error/started): completed→success, failed→error, cancelled→error (no legacy cancellation status), unknown→started (termination unobserved) | `evidenceToLegacyTrace.test.ts` "reports legacy status vocabulary loss as partial" |
| E2L-011 | (no legacy field) | unavailable | legacy Trace has no conditions field; canonical experimental/environmental conditions are not projected (mapping emitted only when conditions are present) | `evidenceToLegacyTrace.test.ts` "reports conditions and span loss only when those fields are present"; matrix runtime check (`trace.conditions`, enriched fixture) |
| E2L-012 | (no legacy span concept) | unavailable | legacy `Trace` has no span records; span hierarchy, kind, name, lifecycle status, `seq` ordering, and timing are not projected | `evidenceToLegacyTrace.test.ts` "reports conditions and span loss only when those fields are present"; matrix runtime check (`trace.spans`, minimal fixture) |
| E2L-013 | `Trace.events[]` | partial | the canonical event set is larger than the legacy TraceEventType vocabulary; mapped kinds project in seq order and kinds without a legacy equivalent are omitted with unavailable mappings | `evidenceToLegacyTrace.test.ts` "projects every canonical event kind…"; conceptual — the executable per-kind checks are rows E2L-024..E2L-043 |

## SpanRecord (Spec 014 §2.2.2; Spec 013 §1.3)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-014 | (omitted) | unavailable | the canonical kind "span_start" has no legacy TraceEventType; span_start/span_end control events are omitted rather than mis-mapped to a content-bearing legacy kind | `evidenceToLegacyTrace.test.ts` "projects every canonical event kind…"; matrix runtime check (`kind "span_start"`, minimal fixture) |
| E2L-015 | (no legacy span status) | unavailable | legacy has no span records, so span lifecycle status, `endSeq`, and `finishedAt` semantics have no target to express | matrix runtime check (`trace.spans` with `status` in the reason, enriched fixture) |
| E2L-016 | (no legacy duration field) | unavailable | legacy TraceEvent has no durationMs field and no clock-basis contract; span durationMs is not projected | `evidenceToLegacyTrace.test.ts` "reports conditions and span loss only when those fields are present"; matrix runtime check (`trace.spans[0].durationMs`, enriched fixture) |

## EventRecord common fields (Spec 014 §2.2.3; Spec 013 §3.1)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-017 | `TraceEvent.id` | exact | TraceEvent.id preserves the canonical eventId; ids are opaque, capture-time, and never ordering-significant | paired projection gate (gateVerified) |
| E2L-018 | `TraceEvent.traceId` | exact | `TraceEvent.traceId` preserves the canonical event `traceId` | paired projection gate (gateVerified) |
| E2L-019 | `Trace.events[]` order | partial | legacy Trace has no seq field; canonical seq ordering is preserved by event order (including ties resolved by seq over equal timestamps), but the seq value itself is not representable | `evidenceToLegacyTrace.test.ts` "preserves seq ordering over equal timestamps" and "reports the canonical seq ordering restriction as partial loss" |
| E2L-020 | `TraceEvent.timestamp` | exact | `TraceEvent.timestamp` preserves the canonical `capturedAt` | paired projection gate (gateVerified) |
| E2L-021 | (no legacy field) | unavailable | legacy TraceEvent has no evidenceStatus field; redacted/truncated/missing/unknown evidence is never turned into content | `evidenceToLegacyTrace.test.ts` "reports completeness, capture surface, observation boundary, and evidenceStatus loss" |
| E2L-022 | `TraceEvent.contentPhase` | partial | ContentPhase is the documented approximation of observation roles; every conversion is partial, and role "unobservable" has no phase approximation (reported unavailable, E2L-055) | `evidenceToLegacyTrace.test.ts` "approximates observation roles with ContentPhase and reports partial" |
| E2L-023 | `TraceEvent.type` | partial | kind maps to the documented TraceEventType equivalent with vocabulary loss (see the per-kind rows E2L-024..E2L-043) | `evidenceToLegacyTrace.test.ts` "maps kinds to their documented legacy types"; conceptual — the executable per-kind checks are rows E2L-024..E2L-043 |

## Closed canonical event kinds (Spec 013 §3.1) — one claim per kind

Every kind is accounted for by exactly one of `CANONICAL_EVENT_MAPPINGS`
(mapped, `partial`) or `CANONICAL_EVENT_KINDS_WITHOUT_LEGACY_EQUIVALENT`
(omitted, `unavailable`); the matrix conformance test enforces exclusivity,
classification agreement, and a runtime check over the `all-kinds` fixture
for every kind row.

| Claim | Kind | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|---|
| E2L-024 | `interaction_start` | (omitted) | unavailable | the canonical kind "interaction_start" has no legacy lifecycle control event type; mapping to a content-bearing legacy kind would be semantically wrong | `evidenceToLegacyTrace.test.ts` all-kinds test; matrix runtime check (lifecycle-only fixture) |
| E2L-025 | `interaction_end` | (omitted) | unavailable | the canonical kind "interaction_end" has no legacy lifecycle control event type | all-kinds test; matrix runtime check |
| E2L-026 | `span_start` | (omitted) | unavailable | the canonical kind "span_start" has no legacy span-lifecycle event type | all-kinds test; matrix runtime check |
| E2L-027 | `span_end` | (omitted) | unavailable | the canonical kind "span_end" has no legacy span-lifecycle event type | all-kinds test; matrix runtime check |
| E2L-028 | `model_request` | `provider_request` | partial | kind "model_request": canonical model_request maps to the legacy provider_request control event; the request envelope, messages, and provider-native content are never inlined into legacy excerpts | "projects a minimal completed record…"; sentinel tests; matrix runtime check |
| E2L-029 | `model_response` | `provider_response` | partial | kind "model_response": canonical model_response maps to the legacy provider_response control event; provider-native response content is not projected | all-kinds test; sentinel tests; matrix runtime check |
| E2L-030 | `model_response_chunk` | `provider_response` (one per chunk) | partial | legacy has no chunk type; every canonical chunk becomes its own provider_response event in seq order (no aggregation) and the chunk kind/index semantics are lost | "emits one legacy provider_response per canonical chunk (no aggregation)"; `projectionParity.test.ts` streaming-chunks block; matrix runtime check (chunks fixture) |
| E2L-031 | `model_usage` | `inference` | partial | kind "model_usage": canonical model_usage maps to the legacy inference event type, but numeric token accounting is unavailable until the measurement layer exists (Spec 014 §6.3) | `evidenceToAgentRun.test.ts` "leaves token fields unavailable (no invented token counts)" |
| E2L-032 | `tool_call` | `tool_call` | partial | kind "tool_call": canonical tool_call maps to the legacy tool_call type; tool arguments are not inlined into a legacy excerpt (no safe excerpt is synthesized) | all-kinds test; matrix runtime check |
| E2L-033 | `tool_result` | `tool_result` | partial | kind "tool_result": canonical tool_result maps to the legacy tool_result type; tool output is not inlined into a legacy excerpt | all-kinds test; matrix runtime check |
| E2L-034 | `mcp_request` | (omitted) | unavailable | the canonical kind "mcp_request" has no legacy MCP concept; mapping to tool_call would conflate the MCP protocol boundary | all-kinds test; matrix runtime check |
| E2L-035 | `mcp_result` | (omitted) | unavailable | the canonical kind "mcp_result" has no legacy MCP concept | all-kinds test; matrix runtime check |
| E2L-036 | `retrieval_request` | (omitted) | unavailable | the canonical kind "retrieval_request" has no legacy retrieval concept | all-kinds test; matrix runtime check |
| E2L-037 | `retrieval_result` | (omitted) | unavailable | the canonical kind "retrieval_result" has no legacy retrieval concept | all-kinds test; matrix runtime check |
| E2L-038 | `context_provider_request` | (omitted) | unavailable | the canonical kind "context_provider_request" has no legacy context-provider protocol concept | all-kinds test; matrix runtime check |
| E2L-039 | `context_provider_result` | (omitted) | unavailable | the canonical kind "context_provider_result" has no legacy context-provider protocol concept | all-kinds test; matrix runtime check |
| E2L-040 | `context_assembled` | `context` | partial | kind "context_assembled": canonical context_assembled maps to the legacy context event; artifact references and assembled content are not inlined | all-kinds test; matrix runtime check |
| E2L-041 | `error` | `provider_error` | partial | kind "error": canonical error maps to the single legacy provider_error type; the canonical actor, lifecycleTarget, and lifecycleEffect vocabulary is not representable | all-kinds test; matrix runtime check; the per-field error losses are the separate rows E2L-084..E2L-087 |
| E2L-042 | `cancelled` | (omitted) | unavailable | the canonical kind "cancelled" has no legacy cancellation type | all-kinds test; matrix runtime check |
| E2L-043 | `retry` | (omitted) | unavailable | the canonical kind "retry" has no legacy retry type | all-kinds test; matrix runtime check |

## RequestEnvelope (Spec 014 §2.2.4; Spec 013 §3.2)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-044 | `Trace.provider` + `Trace.model` | inferred | legacy trace-level provider/model are derived from the first canonical model_request envelope in seq order; reported inferred and never presented as canonical evidence | "projects a minimal completed record…" (provider/model); `projectionParity.test.ts` agent-run parity |
| E2L-045 | (no legacy excerpt) | unavailable | normalized request messages are not representable in the legacy excerpt surface; `payloadRef` is not synthesized and messages are never inlined (provider-native bodies are the separate row E2L-069) | field-loss suite; `evidenceToAgentRun.test.ts` "does not leak provider-native bodies or authorization material"; sentinel assertions; matrix runtime check (`events[2].requestEnvelope.messages` unavailable, enriched fixture, with the request-body sentinel additionally asserted absent from the view) |
| E2L-046 | (no legacy hash/byte contract) | unavailable | legacy has no content-hash or byte-fidelity contract; the real envelope `nativeContentHash` is reported `unavailable` when present | `evidenceToLegacyTrace.test.ts` "reports byte_faithful nativeContentHash loss against the real envelope field"; matrix runtime check (`events[2].requestEnvelope.nativeContentHash`, enriched fixture) |

## ResponseEnvelope (Spec 014 §2.2.5; Spec 013 §3.2)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-047 | (no legacy excerpt) | unavailable | the canonical response finishReason (no legacy finish-reason field) is not representable in the legacy vocabulary and is never projected into a legacy excerpt; provider-native response content is the separate row E2L-072 | field-loss suite; sentinel assertions; `evidenceToAgentRun.test.ts` "does not leak provider-native bodies or authorization material"; matrix runtime check (`events[4].responseEnvelope.finishReason` unavailable, enriched fixture, with the response-body sentinel additionally asserted absent from the view) |
| E2L-048 | `AgentRun`/`Turn` token fields | unavailable | the canonical `responseEnvelope.usage` record (with per-field evidence status) has no legacy field; it is not projected and token values are never invented from character counts (Spec 014 §6.3) — verified against the actual `responseEnvelope.usage` field, not the separate `model_usage` event | field-loss suite; `evidenceToAgentRun.test.ts` "leaves token fields unavailable (no invented token counts)"; matrix runtime check (`events[4].responseEnvelope.usage` unavailable, enriched fixture) |

## ContextArtifact (Spec 014 §2.2.6; Spec 013 §6.1)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-049 | (no legacy artifact concept) | unavailable | legacy has no artifact records; `artifactId`, `payloadRef`, `contentHash`, and provenance are not projected | "reports context contributions as unavailable loss on model_request"; conceptual — an `EvidenceRecord` can reference artifacts only through `ContextContribution` references (`artifactId` + `locator`); no projection input in this slice carries standalone `ContextArtifact` payload/hash/provenance data, so no runtime report entry can exist for artifact-level loss (the reference-level loss is the executable row E2L-050) |

## ContextContribution (Spec 014 §2.2.7; Spec 013 §6.2)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-050 | (no legacy contribution concept) | unavailable | legacy `Trace` has no context-contribution concept; artifact references on `model_request` are not projected and the loss is reported | "reports context contributions as unavailable loss on model_request"; matrix runtime check (`events[1].contextContributions`, chunks fixture) |

## Condition (Spec 014 §2.2.8; Spec 013 §1.1)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-051 | (no legacy field) | unavailable | legacy Trace has no conditions field; experimental/environmental conditions are not projected | `evidenceToLegacyTrace.test.ts` "reports conditions and span loss only when those fields are present"; conceptual — the `Condition` primitive loss is executed by the E2L-011 runtime check (enriched fixture) |

## Completeness (Spec 014 §2.2.9; Spec 013 §4.3)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-052 | (no legacy completeness record) | unavailable | legacy Trace has no completeness record; the canonical derived completeness (eventsByStatus, seqGaps, duplicatesDetected, boundaryStatement) is not projected. The mapping path is the canonical record path "completeness" (Spec 014 §2.2.9 uses the finalized derived type TraceCompleteness) | `evidenceToLegacyTrace.test.ts` "reports completeness, capture surface, observation boundary, and evidenceStatus loss"; matrix runtime check (`completeness` unavailable, minimal fixture) |

## Observation boundary and capture surface (Spec 014 §2.2.10; Spec 013 §5)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-053 | `TraceEvent.contentPhase` | partial | observation roles are approximated by legacy `ContentPhase` with the same boundary discipline (phase labels describe where content was observed, never provider-internal state) | "approximates observation roles with ContentPhase and reports partial" |
| E2L-054 | (no legacy field) | unavailable | legacy `Trace` has no capture-surface or observation-boundary fields | "reports completeness, capture surface, observation boundary, and evidenceStatus loss"; conceptual — executed by the E2L-005 runtime check (`trace.captureSurface`, minimal fixture) |
| E2L-055 | (no `ContentPhase` approximation) | unavailable | role "unobservable" has no ContentPhase approximation; the per-event mapping reports events[i].observationRole unavailable, and the unobservable evidence is never turned into content | `evidenceToLegacyTrace.test.ts` "reports observationRole "unobservable" as an event-specific unavailable mapping" and "never turns redacted/missing/unknown evidence into content"; matrix runtime check (`events[3].observationRole`, enriched fixture) |

## Capture profile reference and collection policy (Spec 014 §2.2.11; Spec 013 §9)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-056 | `Trace.mode` + `Trace.capturePolicy` | partial | legacy StorageMode maps to collection-policy capture settings, not a fixed evidence field; the projected view defaults to standard mode and the canonical captureProfile name/version is not representable | "reports exact, partial, inferred, and unavailable mappings"; conceptual — executed by the E2L-004 runtime check (`trace.captureProfile` partial, minimal fixture) |
| E2L-057 | `Trace.capturePolicy` (defaults) | partial | the projected view carries the default standard-mode capture policy; the canonical record does not carry per-field collection decisions onto the legacy shape | "projects a minimal completed record…" (mode `standard`, default capture policy); conceptual — collection-policy defaults are an attribute of view construction, no separate report entry exists beyond E2L-004 |

## Identity, lifecycle, ordering, timing, fidelity, hash, status, and usage values (Spec 014 §2.2.12)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-058 | `Trace.id` / `TraceEvent.id` | exact | preserved legacy ids carry the canonical ids exactly: `traceId` → `Trace.id` and each `eventId` → `TraceEvent.id`, with no synthesis or truncation | paired projection gate (gateVerified); `projectionParity.test.ts` deterministic-id assertions |
| E2L-068 | `AgentRun` turn/context-block ids (synthesized) | inferred | turn and context-block identifiers are deterministically synthesized by the second stage (`pt-<traceId>-<n>`), scoped to the trace; reported `inferred` and never presented as canonical evidence | `legacyTraceToAgentRun.test.ts` "reports synthesized identifiers as inferred" and "scopes deterministic generated ids to the trace"; `projectionParity.test.ts` id assertions; matrix runtime check (`turns[0].id` inferred, second stage, composed projection) |
| E2L-059 | `Trace.status` | partial | the canonical four-state status vocabulary (completed/failed/cancelled/unknown) is approximated by the three-value legacy set (success/error/started); cancelled and unknown have no legacy equivalent | "reports legacy status vocabulary loss as partial" |
| E2L-060 | `Trace.events[]` order | partial | order is preserved by event order with seq tie-breaks over equal timestamps; the seq value is not representable and the restriction is reported | "preserves seq ordering over equal timestamps"; `projectionParity.test.ts` streaming-chunks block |
| E2L-061 | `Trace.startedAt`/`endedAt` + `TraceEvent.timestamp` | exact | canonical timestamps are preserved exactly on the legacy trace and events | paired projection gate (gateVerified) |
| E2L-062 | (no legacy duration field) | unavailable | legacy TraceEvent has no duration field and no clock-basis contract; durations are never fabricated | conceptual — executed by the E2L-016 runtime check (`trace.spans[0].durationMs`, enriched fixture) |
| E2L-063 | (no legacy fidelity field) | unavailable | legacy events carry no fidelity discriminant; the request and response providerNativeFidelity (structurally_faithful \| byte_faithful) are not representable and provider-native content is not projected (enforced against the actual request fidelity mapping; sentinels additionally asserted absent) | field-loss suite; sentinel assertions; matrix runtime check (`events[2].requestEnvelope.providerNativeFidelity` unavailable, enriched fixture, with the auth and both body sentinels additionally asserted absent from the view) |
| E2L-064 | (no legacy hash contract) | unavailable | legacy Trace has no content-hash contract; the actual envelope nativeContentHash fields present in a byte_faithful record are reported unavailable (there is no aggregate "trace.hashes" field — the real fields are events[i].requestEnvelope/responseEnvelope.nativeContentHash) | "reports byte_faithful nativeContentHash loss against the real envelope field"; matrix runtime checks (request envelope `events[2].requestEnvelope.nativeContentHash`, enriched fixture; the response envelope hash is the separate row E2L-083) |
| E2L-065 | (no legacy field) | unavailable | legacy TraceEvent has no evidenceStatus field; statuses are never collapsed into null or omitted fields | "reports completeness, capture surface, observation boundary, and evidenceStatus loss"; conceptual — executed by the E2L-021 runtime check |
| E2L-066 | (no legacy declarations) | unavailable | missing, redaction, and truncation declarations present in the raw observations are reported `unavailable` against their actual raw-payload paths; declaration values (policy names, reason lists, lengths, notes) are never echoed and the absent content is never fabricated | "never turns redacted/missing/unknown evidence into content" and "does not leak secrets or provider-native bodies into the legacy view"; conceptual — executed by the E2L-078..E2L-080 runtime checks (`rawObservations[1..3].payload.redaction/missing/truncation`, redacted fixture) |
| E2L-067 | `AgentRun`/`Turn` token fields | unavailable | legacy usage is a plain number; the canonical usage-record `evidenceStatus` and per-field token values (`UsageValue.value` + `UsageValue.evidenceStatus`) are not representable, and token fields stay `unavailable` until the measurement layer exists (enforced against the actual usage-record mapping) | field-loss suite; `evidenceToAgentRun.test.ts` "leaves token fields unavailable (no invented token counts)"; conceptual — executed by the E2L-074..E2L-077 runtime checks (`events[3].usage.evidenceStatus`, enriched; `events[5].usage.inputTokens/outputTokens/totalTokens`, all-kinds) |

## Field-level envelope, usage-record, and declaration loss (Spec 014 §2.2.4–§2.2.5, §2.2.12, §5.8)

One executable row per present field; these are the field-specific counterparts of the family rows E2L-045/047/048/063/066/067 (the family rows themselves are conceptual references whose executable checks live here, on the request, response, usage-record, and declaration rows). Every row is enforced against the actual report entry for the exact field path, over the fixture that carries the field.

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-069 | (no legacy field) | unavailable | legacy `TraceEvent` has no provider-native payload field; the canonical request `providerNative` body is not projected (never flattened into an excerpt) | field-loss suite; matrix runtime check (`events[2].requestEnvelope.providerNative` unavailable, enriched fixture, request-body sentinel additionally asserted absent from the view) |
| E2L-070 | (no legacy field) | unavailable | legacy `TraceEvent` has no native-encoding field; the canonical request `nativeEncoding` is not projected | field-loss suite; matrix runtime check (`events[2].requestEnvelope.nativeEncoding` unavailable, enriched fixture) |
| E2L-071 | (no legacy field) | unavailable | legacy `TraceEvent` has no native-content-type field; the canonical request `nativeContentType` is not projected | field-loss suite; matrix runtime check (`events[2].requestEnvelope.nativeContentType` unavailable, enriched fixture) |
| E2L-072 | (no legacy field) | unavailable | legacy `TraceEvent` has no provider-native payload field; the canonical response `providerNative` body is not projected (never flattened into an excerpt) | field-loss suite; matrix runtime check (`events[4].responseEnvelope.providerNative` unavailable, enriched fixture, auth and response-body sentinels additionally asserted absent from the view) |
| E2L-073 | (no legacy field) | unavailable | legacy `TraceEvent` has no chunk-index field; streaming chunk index semantics are not representable in the legacy vocabulary | field-loss suite; matrix runtime check (`events[2].responseEnvelope.chunkIndex` unavailable, chunks fixture) |
| E2L-074 | (no legacy field) | unavailable | legacy usage is a plain number with no per-field evidence-status surface; the canonical usage-record `evidenceStatus` is not projected | field-loss suite; matrix runtime check (`events[3].usage.evidenceStatus` unavailable, enriched fixture) |
| E2L-075 | `AgentRun`/`Turn` token fields | unavailable | legacy usage is a plain number; the canonical usage `inputTokens` value and its per-field evidence status are not projected (token accounting is a later measurement) | field-loss suite; matrix runtime check (`events[5].usage.inputTokens` unavailable, all-kinds fixture) |
| E2L-076 | `AgentRun`/`Turn` token fields | unavailable | legacy usage is a plain number; the canonical usage `outputTokens` value and its per-field evidence status are not projected (token accounting is a later measurement) | field-loss suite; matrix runtime check (`events[5].usage.outputTokens` unavailable, all-kinds fixture) |
| E2L-077 | `AgentRun`/`Turn` token fields | unavailable | legacy usage is a plain number; the canonical usage `totalTokens` value and its per-field evidence status are not projected (token accounting is a later measurement) | field-loss suite; matrix runtime check (`events[5].usage.totalTokens` unavailable, all-kinds fixture) |
| E2L-078 | (no legacy declarations) | unavailable | the canonical redaction declaration is not representable in the legacy vocabulary; redacted evidence is never turned into content and declaration values are never echoed | "never turns redacted/missing/unknown evidence into content"; matrix runtime check (`rawObservations[1].payload.redaction` unavailable, redacted fixture) |
| E2L-079 | (no legacy declarations) | unavailable | the canonical missing-evidence declaration is not representable in the legacy vocabulary; the reported absence is never fabricated into content and declaration values are never echoed | "never turns redacted/missing/unknown evidence into content"; matrix runtime check (`rawObservations[2].payload.missing` unavailable, redacted fixture) |
| E2L-080 | (no legacy declarations) | unavailable | the canonical truncation declaration is not representable in the legacy vocabulary; the truncated value is never fabricated into content and declaration values are never echoed | "never turns redacted/missing/unknown evidence into content"; matrix runtime check (`rawObservations[3].payload.truncation` unavailable, redacted fixture) |
| E2L-081 | (no legacy field) | unavailable | legacy `TraceEvent` has no native-encoding field; the canonical response `nativeEncoding` is not projected | field-loss suite; matrix runtime check (`events[4].responseEnvelope.nativeEncoding` unavailable, enriched fixture) |
| E2L-082 | (no legacy field) | unavailable | legacy `TraceEvent` has no native-content-type field; the canonical response `nativeContentType` is not projected | field-loss suite; matrix runtime check (`events[4].responseEnvelope.nativeContentType` unavailable, enriched fixture) |
| E2L-083 | (no legacy hash contract) | unavailable | legacy `Trace` has no content-hash contract; the response envelope `nativeContentHash` present in a byte_faithful record is reported `unavailable` | "reports byte_faithful nativeContentHash loss against the real envelope field"; matrix runtime check (`events[4].responseEnvelope.nativeContentHash` unavailable, enriched fixture) |

## Field-level error-event loss (Spec 014 §3.3)

One executable row per discarded error field, emitted only for actual `error` events (the legacy `provider_error` type carries none of the canonical error payload; the kind family row is E2L-041). Reasons are structural and never echo error types, messages, or payload values.

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-084 | (no legacy field) | unavailable | legacy `TraceEvent provider_error` has no actor field; the canonical error `actor` is not projected | field-loss suite; matrix runtime check (`events[15].actor` unavailable, all-kinds fixture) |
| E2L-085 | (no legacy field) | unavailable | legacy `TraceEvent provider_error` has no lifecycle-target field; the canonical error `lifecycleTarget` is not projected | field-loss suite; matrix runtime check (`events[15].lifecycleTarget` unavailable, all-kinds fixture) |
| E2L-086 | (no legacy field) | unavailable | legacy `TraceEvent provider_error` has no lifecycle-effect field; the canonical error `lifecycleEffect` is not projected | field-loss suite; matrix runtime check (`events[15].lifecycleEffect` unavailable, all-kinds fixture) |
| E2L-087 | (no legacy field) | unavailable | legacy `TraceEvent provider_error` has no error payload field; the canonical error payload (`type`, `message`, details) is not projected | field-loss suite; matrix runtime check (`events[15].error` unavailable, all-kinds fixture, sentinel error message additionally asserted absent from the view and report) |

## Legacy Trace → AgentRun conversion preservation

The second stage is exact **legacy-behavior preservation**, not canonical
loss: the projection wraps the existing `traceToAgentRun` conversion with
deterministic synthesized ids (reported `inferred`), and turn-boundary
convention, safe-excerpt rules, and metadata filtering are unchanged
(Spec 013 §11.2). See `legacyTraceToAgentRun.test.ts` "produces an AgentRun
view preserving the legacy conversion behavior" and `projectionParity.test.ts`
agent-run parity blocks.

## Honest exclusions (no parity manufactured)

- **A literally empty canonical `EvidenceRecord`** (no observations) is not a
  supported valid record (the validator rejects it with
  `missing_interaction_start`). The valid incomplete interaction — lifecycle
  evidence only, canonical status `unknown`, legacy `started` trace with an
  empty event array and a zero-turn `AgentRun` — is the paired incomplete
  case (E2L-009, E2L-024).
- **Multiple analyzer turns cannot be paired**: the legacy converter splits
  turns on `egress_response`, which has no canonical event equivalent, so no
  multi-turn canonical fixture can express the legacy turn-boundary
  convention. The one-turn grouping is verified (E2L-068, parity tests).
- **Canonical native bodies, context contributions/artifacts, tool payloads,
  and assembled context are never converted into `payloadRef.excerpt`**, so
  no content-bearing analyzer parity is manufactured (E2L-045, E2L-047,
  E2L-049, E2L-050, E2L-063). `ContextArtifact` (E2L-049) is
  documentation-only because no projection input in this slice carries
  standalone artifact payload/hash/provenance data.
- **Tool/MCP/retrieval/context-provider events, errors/cancellation/retry,
  usage/token values, trace metadata, and conditions** either have no legacy
  equivalent (E2L-024..E2L-043, E2L-051) or no additional analyzer/report
  behavior currently expressible (E2L-031, E2L-048, E2L-067). Their existing
  projection and loss tests in `packages/core/src/evidenceProjections/` are
  retained; no fixtures or semantics are fabricated.
- **Terminal and incomplete lifecycle cases** are covered as paired fixtures
  (E2L-008, E2L-009, E2L-010, E2L-059).
- Sentinel native content in the fixtures is asserted to never appear in
  projected views, analysis, reports, or projection diagnostics
  (`projectionParity.test.ts` "determinism, immutability, and privacy"), and
  the matrix `viewAbsence` assertions carried **additionally** by E2L-045,
  E2L-047, E2L-063, E2L-069, and E2L-072 re-assert it over the enriched
  fixture on top of each claim's real report-mapping check.

## Runtime verification

- `packages/core/src/evidenceProjections/projectionMappingMatrix.test.ts` —
  pins the claim-ID registry (87 claims), validates classifications and
  claim modes (exactly one of `runtime`/`gateVerified`/`conceptual`),
  enforces event-kind exclusivity, **executes every runtime claim against an
  actual projection report over a real fixture** (mapping path + stage +
  outcome + constrained reason, with the classification-to-outcome and
  documented-reason/report-reason bindings enforced conjunctively;
  `reportField` equality; `viewAbsence` guarantees), enforces gate-verified
  identity claims at the value level, and verifies the composed
  `evidenceToAgentRun` report (both stages in stage order, first-stage
  mappings survive unchanged, `sourceSchemaVersion` stays canonical).
  `scripts/verify-projection-matrix.mjs` pins the documentation mirror
  (claim IDs, order, classifications, and reasons) against
  `docs/evidence-projection-matrix.md`.
- `packages/reports/src/projectionParity.test.ts` — paired-fixture gates,
  AgentRun parity, analyzer parity (frozen clock), exact terminal/JSON/HTML
  parity, declared-loss verification, determinism, immutability, and sentinel
  non-leakage.
- Existing projection tests: `evidenceToLegacyTrace.test.ts`,
  `legacyTraceToAgentRun.test.ts`, `evidenceToAgentRun.test.ts`.
