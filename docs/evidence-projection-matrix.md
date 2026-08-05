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
conformance test `packages/core/src/evidenceProjections/projectionMappingMatrix.test.ts`
pins the claim IDs and verifies that the matrix's paths, outcomes, and
reasons exist in actual projection reports. The two must stay aligned.

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
| E2L-002 | (no legacy field) | unavailable | legacy `Trace` has no `interactionId`; only `traceId` is preserved, so the `interactionId === traceId` invariant is not representable | paired projection gate (fixture carries no `interactionId`) |
| E2L-003 | `ProjectionReport.sourceSchemaVersion` | unavailable | legacy `Trace` carries no schema version; the projection report records the canonical `sourceSchemaVersion` instead | `evidenceToLegacyTrace.test.ts` "reports exact, partial, inferred, and unavailable mappings" |
| E2L-004 | `Trace.mode` + `Trace.capturePolicy` | partial | legacy `StorageMode` is not carried by canonical evidence; the view defaults to `standard` with its default capture policy; the canonical `captureProfile` name/version is not representable | `evidenceToLegacyTrace.test.ts` "reports exact, partial, inferred, and unavailable mappings" |
| E2L-005 | (no legacy field) | unavailable | legacy `Trace` has no capture-surface or observation-boundary fields | `evidenceToLegacyTrace.test.ts` "reports hashes, completeness, capture surface, and evidenceStatus loss" |
| E2L-006 | (no legacy field) | unavailable | legacy has no observation-boundary field (bundled with E2L-005) | same test as E2L-005 |
| E2L-007 | `Trace.startedAt` | exact | legacy `startedAt` preserves the canonical `startedAt` | paired projection gate |
| E2L-008 | `Trace.endedAt` | exact | legacy `endedAt` preserves the canonical `finishedAt` when a terminal state was observed | paired projection gate (completed fixture) |
| E2L-009 | `Trace.endedAt` (omitted) | unavailable | canonical trace has no observed terminal time (status `unknown`); `endedAt` is omitted, never fabricated | paired projection gate (lifecycle-only fixture); matrix runtime check |
| E2L-010 | `Trace.status` | partial | canonical status vocabulary is smaller: `completed`→`success`, `failed`→`error`, `cancelled`→`error` (no legacy cancellation status), `unknown`→`started` | `evidenceToLegacyTrace.test.ts` "reports legacy status vocabulary loss as partial" |
| E2L-011 | (no legacy field) | unavailable | legacy `Trace` has no `conditions`; canonical experimental/environmental conditions are not projected | matrix claim checks |
| E2L-012 | (no legacy span concept) | unavailable | legacy `Trace` has no span records or hierarchy; span lifecycle control events have no legacy equivalent | `evidenceToLegacyTrace.test.ts` "projects every canonical event kind…" |
| E2L-013 | `Trace.events[]` | partial | the canonical event set is larger than the legacy `TraceEventType` vocabulary; mapped kinds project in `seq` order, kinds without an equivalent are omitted with `unavailable` mappings | `evidenceToLegacyTrace.test.ts` "projects every canonical event kind…" |

## SpanRecord (Spec 014 §2.2.2; Spec 013 §1.3)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-014 | (omitted) | unavailable | legacy `TraceEventType` has no span-lifecycle type; `span_start`/`span_end` control events are omitted rather than mis-mapped to a content-bearing legacy kind | `evidenceToLegacyTrace.test.ts` "projects every canonical event kind…" |
| E2L-015 | (no legacy span status) | unavailable | legacy has no span records, so span status, `endSeq`, and `finishedAt` semantics have no target | matrix claim checks |
| E2L-016 | (no legacy duration field) | unavailable | legacy `TraceEvent` has no `durationMs` and no clock-basis contract; span `durationMs` is not projected | matrix claim checks |

## EventRecord common fields (Spec 014 §2.2.3; Spec 013 §3.1)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-017 | `TraceEvent.id` | exact | `TraceEvent.id` preserves the canonical `eventId`; ids are opaque, capture-time, never ordering-significant | paired projection gate |
| E2L-018 | `TraceEvent.traceId` | exact | `TraceEvent.traceId` preserves the canonical event `traceId` | paired projection gate |
| E2L-019 | `Trace.events[]` order | partial | legacy `Trace` has no `seq` field; canonical `seq` ordering is preserved by event order (ties resolve by `seq` over equal timestamps), but the `seq` value is not representable | `evidenceToLegacyTrace.test.ts` "preserves seq ordering over equal timestamps" and "reports the canonical seq ordering restriction as partial loss" |
| E2L-020 | `TraceEvent.timestamp` | exact | `TraceEvent.timestamp` preserves the canonical `capturedAt` | paired projection gate |
| E2L-021 | (no legacy field) | unavailable | legacy `TraceEvent` has no `evidenceStatus`; redacted/truncated/missing/unknown evidence is never turned into content | `evidenceToLegacyTrace.test.ts` "reports hashes, completeness, capture surface, and evidenceStatus loss" |
| E2L-022 | `TraceEvent.contentPhase` | partial | `ContentPhase` is the documented approximation of observation roles (Spec 013 §11.2); every conversion is partial, and `unobservable` has no phase approximation | `evidenceToLegacyTrace.test.ts` "approximates observation roles with ContentPhase and reports partial" |
| E2L-023 | `TraceEvent.type` | partial | kind maps to the documented `TraceEventType` equivalent with vocabulary loss (see per-kind rows E2L-024..E2L-043) | `evidenceToLegacyTrace.test.ts` "maps kinds to their documented legacy types" |

## Closed canonical event kinds (Spec 013 §3.1) — one claim per kind

Every kind is accounted for by exactly one of `CANONICAL_EVENT_MAPPINGS`
(mapped, `partial`) or `CANONICAL_EVENT_KINDS_WITHOUT_LEGACY_EQUIVALENT`
(omitted, `unavailable`); the matrix conformance test enforces exclusivity
and classification agreement.

| Claim | Kind | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|---|
| E2L-024 | `interaction_start` | (omitted) | unavailable | legacy has no lifecycle control event type; mapping to a content-bearing kind would be semantically wrong | `evidenceToLegacyTrace.test.ts` all-kinds test |
| E2L-025 | `interaction_end` | (omitted) | unavailable | legacy has no lifecycle control event type | all-kinds test |
| E2L-026 | `span_start` | (omitted) | unavailable | legacy has no span-lifecycle event type | all-kinds test |
| E2L-027 | `span_end` | (omitted) | unavailable | legacy has no span-lifecycle event type | all-kinds test |
| E2L-028 | `model_request` | `provider_request` | partial | maps to the legacy provider-request control event; envelope, messages, and provider-native content are never inlined into legacy excerpts | "projects a minimal completed record…"; sentinel tests |
| E2L-029 | `model_response` | `provider_response` | partial | maps to the legacy provider-response control event; provider-native response content is not projected | all-kinds test; sentinel tests |
| E2L-030 | `model_response_chunk` | `provider_response` (one per chunk) | partial | legacy has no chunk type; every canonical chunk becomes its own `provider_response` in `seq` order (**no aggregation**) and chunk kind/index semantics are lost | "emits one legacy provider_response per canonical chunk (no aggregation)"; `projectionParity.test.ts` streaming-chunks block |
| E2L-031 | `model_usage` | `inference` | partial | maps to the legacy inference event type, but numeric token accounting is `unavailable` until the measurement layer exists (Spec 014 §6.3) | `evidenceToAgentRun.test.ts` "leaves token fields unavailable (no invented token counts)" |
| E2L-032 | `tool_call` | `tool_call` | partial | maps to the legacy type; tool arguments are not inlined (no safe excerpt synthesized) | all-kinds test |
| E2L-033 | `tool_result` | `tool_result` | partial | maps to the legacy type; tool output is not inlined | all-kinds test |
| E2L-034 | `mcp_request` | (omitted) | unavailable | legacy has no MCP concept; mapping to `tool_call` would conflate the MCP protocol boundary | all-kinds test |
| E2L-035 | `mcp_result` | (omitted) | unavailable | legacy has no MCP concept | all-kinds test |
| E2L-036 | `retrieval_request` | (omitted) | unavailable | legacy has no retrieval concept | all-kinds test |
| E2L-037 | `retrieval_result` | (omitted) | unavailable | legacy has no retrieval concept | all-kinds test |
| E2L-038 | `context_provider_request` | (omitted) | unavailable | legacy has no context-provider protocol concept | all-kinds test |
| E2L-039 | `context_provider_result` | (omitted) | unavailable | legacy has no context-provider protocol concept | all-kinds test |
| E2L-040 | `context_assembled` | `context` | partial | maps to the legacy context event; artifact references and assembled content are not inlined | all-kinds test |
| E2L-041 | `error` | `provider_error` | partial | maps to the single legacy error type; canonical `actor`, `lifecycleTarget`, and `lifecycleEffect` are not representable | all-kinds test |
| E2L-042 | `cancelled` | (omitted) | unavailable | legacy has no cancellation type | all-kinds test |
| E2L-043 | `retry` | (omitted) | unavailable | legacy has no retry type | all-kinds test |

## RequestEnvelope (Spec 014 §2.2.4; Spec 013 §3.2)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-044 | `Trace.provider` + `Trace.model` | inferred | trace-level provider/model are derived from the first canonical `model_request` envelope in `seq` order; reported `inferred`, never presented as canonical evidence | "projects a minimal completed record…" (provider/model); `projectionParity.test.ts` agent-run parity |
| E2L-045 | (no legacy excerpt) | unavailable | normalized messages and provider-native request content are never inlined into the legacy excerpt surface; `payloadRef` is not synthesized | `evidenceToAgentRun.test.ts` "does not leak provider-native bodies or authorization material"; sentinel assertions |
| E2L-046 | (no legacy hash/byte contract) | unavailable | legacy has no content-hash or byte-fidelity contract; native byte fields are not projected | `evidenceToLegacyTrace.test.ts` "reports hashes, completeness, capture surface, and evidenceStatus loss" |

## ResponseEnvelope (Spec 014 §2.2.5; Spec 013 §3.2)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-047 | (no legacy excerpt) | unavailable | `finishReason` and provider-native response content are never projected into legacy excerpts | sentinel assertions; `evidenceToAgentRun.test.ts` "does not leak provider-native bodies or authorization material" |
| E2L-048 | `AgentRun`/`Turn` token fields | unavailable | token values exist only when a measurement exists; until the measurement layer lands, token fields stay `unavailable` and are never invented from character counts (Spec 014 §6.3) | `evidenceToAgentRun.test.ts` "leaves token fields unavailable (no invented token counts)" |

## ContextArtifact (Spec 014 §2.2.6; Spec 013 §6.1)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-049 | (no legacy artifact concept) | unavailable | legacy has no artifact records; `artifactId`, `payloadRef`, `contentHash`, and provenance are not projected | "reports context contributions as unavailable loss on model_request"; matrix claim checks |

## ContextContribution (Spec 014 §2.2.7; Spec 013 §6.2)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-050 | (no legacy contribution concept) | unavailable | legacy `Trace` has no context-contribution concept; artifact references on `model_request` are not projected and the loss is reported | "reports context contributions as unavailable loss on model_request" |

## Condition (Spec 014 §2.2.8; Spec 013 §1.1)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-051 | (no legacy field) | unavailable | legacy `Trace` has no `conditions`; experimental/environmental conditions are not projected | matrix claim checks |

## Completeness (Spec 014 §2.2.9; Spec 013 §4.3)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-052 | (no legacy completeness record) | unavailable | legacy `Trace` has no completeness record; the canonical derived completeness (`eventsByStatus`, `seqGaps`, `duplicatesDetected`, `boundaryStatement`) is not projected. **Note on the §2.2.9 heading wording:** Spec 014 §2.2.9's heading uses the earlier "Completeness record (`CompletenessRecord`)" phrasing; the finalized derived type is `TraceCompleteness` (serialized once at `EvidenceRecord.completeness`). There is exactly one completeness type — `TraceCompleteness` — and the heading wording does not create a competing type. | "reports hashes, completeness, capture surface, and evidenceStatus loss" |

## Observation boundary and capture surface (Spec 014 §2.2.10; Spec 013 §5)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-053 | `TraceEvent.contentPhase` | partial | observation roles are approximated by legacy `ContentPhase` with the same boundary discipline (phase labels describe where content was observed, never provider-internal state) | "approximates observation roles with ContentPhase and reports partial" |
| E2L-054 | (no legacy field) | unavailable | legacy `Trace` has no capture-surface or observation-boundary fields | "reports hashes, completeness, capture surface, and evidenceStatus loss" |
| E2L-055 | (no `ContentPhase` approximation) | unavailable | role `unobservable` has no phase approximation and is reported `unavailable`; redacted/missing/unknown evidence is never turned into content | "never turns redacted/missing/unknown evidence into content" |

## Capture profile reference and collection policy (Spec 014 §2.2.11; Spec 013 §9)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-056 | `Trace.mode` + `Trace.capturePolicy` | partial | legacy `StorageMode` maps to collection-policy capture settings, not a fixed evidence field; the view defaults to `standard` mode and the canonical `captureProfile` name/version is not representable | "reports exact, partial, inferred, and unavailable mappings" |
| E2L-057 | `Trace.capturePolicy` (defaults) | partial | the projected view carries the default standard-mode capture policy; the canonical record does not carry per-field collection decisions onto the legacy shape | matrix claim checks |

## Identity, lifecycle, ordering, timing, fidelity, hash, status, and usage values (Spec 014 §2.2.12)

| Claim | Legacy target | Classification | Reason | Verified by |
|---|---|---|---|---|
| E2L-058 | `Trace.id` / `TraceEvent.id` / synthesized ids | inferred | preserved legacy ids stay exact; deterministically synthesized turn/context-block ids (`pt-<traceId>-<n>`) are reported `inferred` and never presented as canonical evidence | `legacyTraceToAgentRun.test.ts` "reports synthesized identifiers as inferred" and "scopes deterministic generated ids to the trace"; `projectionParity.test.ts` id assertions |
| E2L-059 | `Trace.status` | partial | the canonical four-value status vocabulary is approximated by the three-value legacy set (`cancelled`→`error`, `unknown`→`started`) | "reports legacy status vocabulary loss as partial" |
| E2L-060 | `Trace.events[]` order | partial | order is preserved with `seq` tie-breaks over equal timestamps; the `seq` value is not representable and the restriction is reported | "preserves seq ordering over equal timestamps"; `projectionParity.test.ts` streaming-chunks block |
| E2L-061 | `Trace.startedAt`/`endedAt` + `TraceEvent.timestamp` | exact | canonical timestamps are preserved exactly | paired projection gate |
| E2L-062 | (no legacy duration field) | unavailable | legacy has no duration field and no clock-basis contract; durations are never fabricated | matrix claim checks |
| E2L-063 | (no legacy fidelity field) | unavailable | legacy events carry no fidelity discriminant; provider-native content is not projected and fidelity is not representable | sentinel assertions |
| E2L-064 | (no legacy hash contract) | unavailable | legacy `Trace` has no content-hash contract; `contentHash` and `nativeContentHash` are not projected | "reports hashes, completeness, capture surface, and evidenceStatus loss" |
| E2L-065 | (no legacy field) | unavailable | legacy `TraceEvent` has no `evidenceStatus`; statuses are never collapsed into `null` or omitted fields | "reports hashes, completeness, capture surface, and evidenceStatus loss" |
| E2L-066 | (no legacy declarations) | unavailable | missing, redaction, and truncation declarations are not representable in the legacy vocabulary and are never fabricated into content | "never turns redacted/missing/unknown evidence into content" |
| E2L-067 | `AgentRun`/`Turn` token fields | unavailable | legacy usage is a plain number; per-field evidence status is not representable, and token fields stay `unavailable` until the measurement layer exists | `evidenceToAgentRun.test.ts` "leaves token fields unavailable (no invented token counts)" |

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
  convention. The one-turn grouping is verified (E2L-058, parity tests).
- **Canonical native bodies, context contributions/artifacts, tool payloads,
  and assembled context are never converted into `payloadRef.excerpt`**, so
  no content-bearing analyzer parity is manufactured (E2L-045, E2L-047,
  E2L-049, E2L-050, E2L-063).
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
  (`projectionParity.test.ts` "determinism, immutability, and privacy").

## Runtime verification

- `packages/core/src/evidenceProjections/projectionMappingMatrix.test.ts` —
  pins the claim-ID registry, validates classifications, enforces
  event-kind exclusivity, and asserts the matrix's paths/outcomes/reasons
  exist in actual projection reports over the fixed fixtures.
- `packages/reports/src/projectionParity.test.ts` — paired-fixture gates,
  AgentRun parity, analyzer parity (frozen clock), exact terminal/JSON/HTML
  parity, declared-loss verification, determinism, immutability, and sentinel
  non-leakage.
- Existing projection tests: `evidenceToLegacyTrace.test.ts`,
  `legacyTraceToAgentRun.test.ts`, `evidenceToAgentRun.test.ts`.
