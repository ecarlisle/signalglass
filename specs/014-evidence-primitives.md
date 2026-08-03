# Spec 014: Evidence primitives

## Status

Accepted — ready for implementation.

This specification defines the first additive TypeScript implementation
increment of the accepted Spec 013 evidence contract. Acceptance authorizes
implementation of the slices defined in this specification; it does not mean
that the evidence primitives already exist or that any acceptance criterion
has been satisfied. No runtime code is written by this spec and no acceptance
criterion below is satisfied yet (all unchecked).

## Purpose

Turn the accepted Spec 013 evidence contract into a precise, testable first
implementation slice: a provider-neutral TypeScript package of canonical
evidence primitives (types, runtime validators, and JSON-safe serialization)
plus documented compatibility projections for the legacy v0.x models
(`Trace`/`TraceEvent`, `AgentRun`) from Specs 002–004. The increment is
additive: it introduces canonical records **beside** the existing runtime
model, without a breaking replacement or a storage/capture migration.

## Relationship to Spec 013

- **Spec 013 is the accepted canonical evidence contract.** It is
  authoritative for design and implementation planning and supersedes the
  legacy model specifications (002, 003, 004). This spec implements a slice
  of that contract; it does not restate it.
- **Spec 014 defines the first additive TypeScript implementation increment
  of Spec 013.** It maps Spec 013's normative records to TypeScript `type`
  declarations, runtime validation, and serialization rules, and it defines
  the compatibility projections Spec 013 §11 requires.
- **Spec 014 MUST conform to Spec 013 and MUST NOT silently reinterpret or
  weaken it.** Where this spec appears to conflict with Spec 013, Spec 013
  wins and the discrepancy MUST be surfaced as an issue rather than resolved
  locally. Spec 014 introduces no second content-type, hashing,
  canonicalization, or versioning contract; it references the Spec 013 rules
  (§6.1 content hashes, §3.2 native fidelity, §10 versioning) exactly.
- **Recorded evidence remains authoritative.** Evidence, measurements,
  interpretations, and administrative metadata remain separate (§1.1 of
  Spec 013). This spec's evidence core contains no measurement, cost,
  interpretation, smell, recommendation, or optimization logic.
- **Existing legacy consumers require temporary compatibility support.** The
  v0.x `Trace`/`TraceEvent` and `AgentRun` shapes remain in use by ingress,
  storage, reports, CLI, and the dashboard until those consumers migrate.
  Spec 014 defines deterministic compatibility projections so legacy
  consumers keep working while canonical evidence is introduced beside them.
- **Acceptance ≠ implementation.** Acceptance authorizes implementation of
  the slices in §8; it does not mean the primitives exist. Spec 013's §14
  acceptance criteria stay unchecked regardless of what Spec 014 achieves.

## Scope

- The package/module boundary for canonical evidence primitives and
  its dependency rules (§1).
- TypeScript representations of the initial Spec 013 records: trace envelope,
  spans, events (all canonical kinds), request/response envelopes, context
  artifacts and contributions, conditions, completeness, observation
  boundaries, capture-profile reference and collection policy, timing, hashes,
  and version fields (§2).
- Discriminants, identifiers, versions, ordering, and identity rules (§3–§4).
- Runtime validation and JSON-safe serialization contract (§5).
- Compatibility projections in both required directions with explicit loss
  handling (§6).
- Additive implementation sequence and later-spec boundaries (§8).
- Future test and conformance plan (§9) and the privacy/security boundary
  (§10).

## Non-goals

Spec 014 explicitly does not cover, and its implementation must not include:

- Replacing or migrating persistent storage, or changing the storage schema.
- Switching collectors, the ingress, or provider adapters to the new
  primitives.
- Modifying provider requests or responses.
- Graphify, MCP, retrieval, or provider-specific instrumentation — and, in
  particular, MCP/tool capture, adapters, lifecycle integration, and runtime
  emission. Defining provider-neutral record kinds for MCP/tool activity
  (Spec 013 §3.1) is type-system vocabulary (§2.2), not MCP observation.
- Dashboards or visualization.
- Measurement or interpretation algorithms (token counting, latency,
  duration, cost, smells, recommendations).
- Token or cost derivation.
- Replay execution.
- Prompt rewriting, compression, summarization, optimization, or
  deduplication.
- Removing legacy types.
- Claiming response reproducibility.
- Implementing every possible Spec 013 record in the first slice.

## RFC-style terms

- **MUST** — a normative requirement; an implementation is not conformant
  unless it is met.
- **MUST NOT** — a normative prohibition.
- **SHOULD** — a recommendation; deviation is permitted only with documented
  justification.
- **MAY** — an optional capability.
- **Undefined** — no contract is offered; implementations MUST NOT rely on it.

## 1. Implementation surface

### 1.1 Package boundary

The narrowest appropriate boundary is a new workspace package
**`packages/evidence`** exporting **`@signalglass/evidence`**, added beside
the existing packages exactly as Spec 001 structures them (own `package.json`,
`tsconfig.json`, `src/index.ts`, exports pointing at `./dist/index.js` and
`./dist/index.d.ts`; `vitest.config.ts` gains a matching workspace alias in
the implementation PR). This matches the architectural foundation’s
incremental-migration principle: “new evidence primitives are added beside
the current v0.x models.”

Rationale for a separate package rather than a module inside
`@signalglass/core`:

- `@signalglass/core` is the legacy analysis package (types, token
  estimation, smells, recommendations, traces). The evidence core MUST NOT
  depend on analysis, and placing canonical records inside the analysis
  package would entangle the layers the foundation keeps separate.
- A zero-dependency package makes the "evidence core depends on nothing"
  rule mechanically enforceable (`package.json` has no runtime
  dependencies).
- Legacy consumers already depend on `@signalglass/core`; adding
  `@signalglass/evidence` as a dependency of `@signalglass/core` allows
  `@signalglass/core` to consume canonical evidence for its compatibility
  projections. That dependency does **not** make evidence APIs available
  through existing `@signalglass/core` imports.

**Import contract:** canonical evidence types, validators, serialization, and
  helpers MUST be imported **directly from `@signalglass/evidence`**.
  `@signalglass/core` depends on `@signalglass/evidence` so its compatibility
  projections can consume canonical records, but existing `@signalglass/core`
  imports do **not** expose evidence-package APIs automatically. Compatibility
  projection functions remain exported from `@signalglass/core`. No broad
  re-export through `@signalglass/core` is introduced unless an existing
  repository requirement clearly supports it.

**Consumers that use canonical evidence APIs must add the appropriate
  dependency and import them directly from `@signalglass/evidence`.**

Compatibility projections (canonical → legacy `Trace`/`TraceEvent`, legacy `Trace`/`TraceEvent` → legacy `AgentRun`, canonical → legacy `AgentRun`) live in `@signalglass/core`
as new modules (`packages/core/src/evidenceProjections/`), beside the legacy
types they convert, not inside `@signalglass/evidence`. This keeps the
evidence package pure and puts compatibility glue at the legacy layer where
the legacy shapes and their consumers live. `@signalglass/core` therefore
gains one workspace dependency on `@signalglass/evidence`.

### 1.2 Public exports

`@signalglass/evidence` exports, from `src/index.ts`:

- the evidence record types and vocabulary types of §2 — canonical
  evidence primitives plus the narrowly coupled, deterministic completeness
  contract Spec 013 §4.3 requires (`CompletenessRecord` and the pure
  `deriveCompleteness` derivation, §2.2.9);
- the discriminant and identifier rules of §3 as types and constants;
- runtime validators and the parse result type (§5);
- `serializeEvidenceRecord` / `parseEvidenceRecord` JSON-safe round-trip
  functions
  (§5.7);
- deterministic helpers that are pure and dependency-free: sequence and
  completeness derivation, the canonical event projection used for replay
  comparison, hash-path selection and RFC 8785 (JCS) canonicalization for
  `contentHash`, media-type and hash-format checks (§4–§5).

The package MUST NOT export the legacy `Trace`, `TraceEvent`, `AgentRun`,
`Turn`, `ContextBlock`, or `ContentPhase` shapes, and MUST NOT export any
provider, storage, dashboard, or analysis API.

### 1.3 Internal-only helpers

Implementation helpers that are not part of the public contract live in
`src/internal/` and MUST NOT be re-exported: low-level guard combinators
(`src/internal/guards.ts`), JSON canonicalization and hashing
(`src/internal/hash.ts`), time helpers and id syntax/validation helpers
(`src/internal/time.ts`, `src/internal/id.ts` — the package validates
caller-supplied ids; it does not generate them, §3.2), and the RFC 6838
media-type and hash-format checks
(`src/internal/formats.ts`). The media-type and hash rules are already
implemented in the repository's dependency-free semantic validator
(`scripts/validate-evidence-examples.mjs`); the package validators MUST stay
consistent with that script, and the script's envelope, status/fidelity,
artifact-hash, and completeness rules are the baseline to port (see §5.4).

### 1.4 Permitted and prohibited dependencies

- **Permitted:** none at runtime. Dev dependencies are limited to the
  workspace's existing `typescript` and `vitest` (matching every other
  package). `@signalglass/evidence` has no runtime dependency on any
  package — including `@signalglass/core`.
- **Prohibited:** `@signalglass/core`, `@signalglass/providers`,
  `@signalglass/storage`, `@signalglass/parsers`, `@signalglass/reports`,
  `@signalglass/cli`, `apps/*`, any external validation, schema, or
  serialization library, and any MCP protocol or tool-runtime library
  (record kinds are vocabulary only, §2.2). The repository has no established validation
  library; the established approach is dependency-free hand-rolled guards
  (as in `scripts/validate-evidence-examples.mjs`), and Spec 014 keeps that
  approach rather than introducing a competing validation system.
- **Projections:** `@signalglass/core` MAY depend on `@signalglass/evidence`
  (workspace) for the projection modules only. Nothing may depend on the
  evidence package through storage, ingress, or dashboard layers in this
  spec.

### 1.5 Where runtime validation belongs

Validation lives in `@signalglass/evidence` (the package that owns the
record types). Consumers of the types use the package's validators and parse
entry points; they MUST NOT re-implement validation. The
`scripts/validate-evidence-examples.mjs` script remains the independent
semantic checker for the docs' serialized examples and MUST continue to pass
unchanged after any implementation.

### 1.6 JSON-safe serialization

All canonical records are plain JSON-serializable data: `string`, `number`,
`boolean`, `null` (structural absence only), arrays, and objects. There are
no class instances, no `Map`/`Set`, no `Date` objects, and no `bigint` in
serialized records. In-memory representations MAY use `Uint8Array` for
retained byte payloads (see §5.7); the serialized form MUST be JSON-safe.
Serialization is deterministic only where Spec 013 requires it (content-hash
canonicalization, §4.5); otherwise it preserves the retained representation
without reordering or reformatting evidence.

### 1.7 Node/browser/provider/storage/UI independence

`@signalglass/evidence` MUST compile and run in Node and browsers: no
Node-only imports (`node:*`, `fs`, `crypto` is allowed only via a
dependency-free SHA-256 implementation or a guarded injection point, and
`crypto` availability MUST be injectable so browsers are not required to
polyfill it), no DOM types, no provider types, no storage types, no UI
types, and no MCP protocol or tool-runtime types. Provider-, storage-, and
UI-specific logic lives in their existing
packages (`@signalglass/providers`, `@signalglass/storage`, `apps/*`) and is
out of scope here.

## 2. Initial primitive inventory

### 2.1 Classification

Every primitive carries one classification, mirroring Spec 013 §1.1:

- **evidence** — an observation of what happened at a declared boundary;
- **measurement** — a deterministic derivation over evidence (deferred, §2.3);
- **interpretation** — a labeled judgment (deferred, §2.3);
- **administrative metadata** — a record about operations on evidence, never
  merged into payload status (deferred where possible, §2.3);
- **derived** — a description computed from evidence (Spec 013 §1.1
  classifies trace completeness as *Derived*).

The evidence core contains only **evidence** primitives plus the
vocabulary/value types they need, with one exception: the `CompletenessRecord`
and its deterministic derivation (§2.2.9) are in the first slice because Spec
013 §4.3 requires each `EvidenceRecord` to carry one derived completeness
record and validators must verify serialized completeness. Derived and
administrative types are otherwise referenced by id or field where Spec 013
requires, but are not implemented in the first slice.

### 2.2 In-slice primitives

For each primitive: **category**, **responsibility**, **key fields**,
**discriminant/id rules**, **append-only expectation**, **observation
boundary**, **serialization**, **validation**, **relationships**, and
**slice**.

**Record kinds versus instrumentation.** Including provider-neutral
span/event/artifact kinds for tool, MCP, retrieval, and context-provider
activity (the Spec 013 §3.1 vocabulary) defines record types; it does **not**
implement MCP/tool observation. Capture, instrumentation, adapters, lifecycle
integration, and runtime emission for those systems are deferred to later
specifications (§8.2), and `@signalglass/evidence` MUST NOT depend on any MCP
implementation, MCP protocol library, tool runtime, or provider API. Merely
defining a provider-neutral record kind does not implement MCP observation.

#### 2.2.1 Canonical trace view (`EvidenceTrace`)

- **Category:** evidence (top-level container).
- **Responsibility:** the deterministic canonical trace derived from the raw
  observations in the authoritative `EvidenceRecord` (§5.2). It is the
  normalized view of one interaction, not an independently authoritative
  serialized evidence record.
- **Fields:** `interactionId`, `traceId` (equal; invariant), `evidenceSchemaVersion`,
  `captureProfile: { name, version }`, `captureSurface`, `observationBoundary`,
  `startedAt`, `finishedAt?` (present iff a terminal state was observed, §4.7),
  `status`, `conditions?`, `spans[]`, `events[]`.
- **Discriminant/id rules:** `traceId` is the reference identifier; nested
  records reference the trace by `traceId` only. `interactionId === traceId`
  MUST hold (validated). ULID-style ids recommended (Spec 013 §2.1).
- **Append-only:** the raw observations from which the trace is derived are
  immutable once captured; normalization never mutates them. Corrections are
  new observations, never in-place edits.
- **Observation boundary:** `captureSurface` + `observationBoundary` declare
  the trace-level boundary; records inherit unless they override.
- **Serialization:** JSON object; both `interactionId` and `traceId`
  serialized at top level (never inferred from each other).
- **Validation:** identity equality, version presence, boundary vocabulary,
  status vocabulary and lifecycle presence rules (§4.7), seq/span/event
  cross-checks, and agreement with deterministic normalization (§4, §5).
- **Relationships:** parent of all spans/events; referenced by artifacts,
  measurements, and interpretations by `traceId`.
- **Slice:** in (first).

#### 2.2.2 Span record (`SpanRecord`)

- **Category:** evidence (structure).
- **Responsibility:** a structured segment of an interaction with a lifecycle
  — model request, tool call, MCP call, retrieval, context-provider call, or
  context assembly (Spec 013 §1.1, §3.1). Content lives on events, never on
  spans.
- **Fields:** `spanId`, `kind`, `name`, `parentSpanId` (null for root),
  `startSeq`, `endSeq?` (present only for `completed` spans, equals the
  observed `span_end` event's `seq`, §4.7), `startedAt`, `finishedAt?`
  (present iff a terminal state was observed, §4.7), `durationMs?`,
  `status`, `participants?`.
- **Discriminant/id rules:** `kind` ∈ {`model`, `tool`, `mcp`, `retrieval`,
  `context_provider`, `context_assembly`}; `spanId` opaque, unique within
  trace; `parentSpanId` establishes hierarchy only, never ordering.
- **Append-only:** yes, as above.
- **Observation boundary:** inherits trace boundary unless overridden.
- **Serialization:** JSON object; `null` for structural absence
  (`parentSpanId`).
- **Validation:** span ids unique; parent ids resolve or are null; `startSeq`
  present (a span exists because its `span_start` was observed) and matches
  the `span_start` event's `seq`; `endSeq` present only for `completed` spans
  and equals the observed `span_end` event's `seq` (§4.7); `endSeq` ≥
  `startSeq` when present; `span_end` required only for `completed` spans —
  never required and never fabricated for `failed`, `cancelled`, or `unknown`
  spans (§4.7); `durationMs` present only with a declared clock basis.
- **Relationships:** parent→child hierarchy; aggregates events via `spanId`.
- **Slice:** in.

#### 2.2.3 Event record (`EventRecord`)

- **Category:** evidence (content).
- **Responsibility:** a discrete observed occurrence attached to a span or the
  trace root, carrying content, evidence status, and the deterministic
  sequence position (Spec 013 §1.1, §3.1).
- **Fields (common):** `eventId`, `traceId`, `spanId` (null = trace root),
  `seq`, `kind`, `capturedAt`, `evidenceStatus`, `observationRole` (on
  payload-bearing events; lifecycle control events inherit the capture
  surface's declared boundary and carry no payload), plus kind-specific
  payload fields:
  - `interaction_start` / `interaction_end` — trace lifecycle boundaries;
  - `span_start` / `span_end` — span lifecycle boundaries;
  - `model_request` — `requestEnvelope`, `contextContributions?`;
  - `model_response` — `responseEnvelope`;
  - `model_response_chunk` — chunk payload at declared fidelity;
  - `model_usage` — `usage` with per-field evidence status;
  - `tool_call` / `tool_result` — tool id/name, payload;
  - `mcp_request` / `mcp_result` — server, method, payload;
  - `retrieval_request` / `retrieval_result` — query/source, payload;
  - `context_provider_request` / `context_provider_result` — provider
    `{ name, kind }`, payload;
  - `context_assembled` — snapshot reference or hash of assembled context;
  - `error` — `actor` ∈ {`agent`, `model`, `tool`, `mcp`, `retrieval`,
    `context_provider`, `capture`}, `lifecycleTarget` ∈ {`trace`, `span`,
    `none`}, `lifecycleEffect` ∈ {`fail`, `none`}, observed error payload,
    `observationRole`;
  - `cancelled` — `lifecycleTarget` ∈ {`trace`, `span`, `none`},
    `lifecycleEffect: "cancel"`, who/what requested cancellation,
    `observationRole`; target `none` records a non-terminal cancellation
    request or occurrence and changes no trace/span status;
  - `retry` — `originalRequestEventId`, `errorEventId?`, attempt count, delay.
- **Discriminant/id rules:** `kind` is the discriminant (closed vocabulary
  above); `eventId` opaque, unique within trace; `seq` is the sole
  deterministic ordering key (contiguous from 0, §4.1).
- **Append-only:** yes.
- **Observation boundary:** every payload-bearing event declares
  `observationRole` (Spec 013 §5.1); status and role are independent axes.
- **Serialization:** JSON object per kind; `spanId: null` for trace-root
  events; `null` never represents status.
- **Validation:** kind ∈ vocabulary; seq rules (§4.1); status ∈ vocabulary;
  role ∈ vocabulary on payload-bearing kinds; retry references resolve;
  error/cancelled carry `lifecycleTarget`, `lifecycleEffect`, and roles;
  `lifecycleTarget: "span"` requires non-null `spanId` matching the attached
  span; `lifecycleTarget: "trace"` requires `spanId: null`; status/fidelity
  matrix rules (§5.4).
- **Relationships:** belongs to a span or trace root; may reference other
  events (`retry.originalRequestEventId`, `errorEventId`); may carry
  envelopes and context contributions.
- **Slice:** in.

#### 2.2.4 Request envelope (`RequestEnvelope`)

- **Category:** evidence.
- **Responsibility:** canonical wrapper for an application-visible request:
  normalized common fields plus the provider-native payload at a declared
  fidelity (Spec 013 §3.2).
- **Fields:** `model`, `provider`, `providerNativeFidelity`,
  `messages` (normalized), `providerNative` (native payload at declared
  fidelity), and — only when `byte_faithful` and `captured` —
  `nativeEncoding`, `nativeContentType`, `nativeContentHash`.
- **Discriminant/id rules:** none; fidelity is a closed two-value
  discriminant (`structurally_faithful` | `byte_faithful`).
- **Append-only:** yes.
- **Observation boundary:** `observationRole` on the enclosing event
  (typically `client_sent` or `application_constructed`).
- **Serialization:** JSON object; `providerNative` is preserved, never
  flattened into a generic prompt string.
- **Validation:** fidelity declared; `byte_faithful` requires `captured`,
  `nativeEncoding`, `nativeContentType`, `nativeContentHash`; `redacted` /
  `truncated` / `missing` / `unknown` / `not_applicable` native payloads
  MUST NOT carry `nativeContentHash`; `nativeContentHash` is
  `sha256:<64 lowercase hex>`; `structurally_faithful` NEVER implies byte
  fidelity.
- **Relationships:** carried by `model_request` events; normalized fields are
  the canonical common model — a provider-specific shape MUST NOT become the
  internal model.
- **Slice:** in.

#### 2.2.5 Response envelope (`ResponseEnvelope`)

- **Category:** evidence.
- **Responsibility:** canonical wrapper for an application-visible response,
  including stream chunks and final usage (Spec 013 §3.2).
- **Fields:** `finishReason?`, `providerNativeFidelity`, `providerNative`,
  `usage?` (provider-reported, with per-field status), and the same native
  fields as §2.2.4 when `byte_faithful` and `captured`.
- **Discriminant/id rules:** none beyond fidelity.
- **Append-only / boundary / serialization / validation / slice:** as
  §2.2.4; usage values carry explicit evidence status (a captured numeric
  zero is a real value, never `null`).

#### 2.2.6 Context artifact (`ContextArtifact`)

- **Category:** evidence.
- **Responsibility:** a referenceable unit of context with payload and
  provenance (Spec 013 §6.1); self-describing hashing path.
- **Fields:** `artifactId`, `kind` ∈ {`message`, `file`, `document`,
  `fragment`, `tool_result`, `mcp_response`, `retrieval_result`,
  `context_provider_result`, `repository_content`, `manual`},
  `evidenceStatus` (top level, never inside `payloadRef`), `payloadRef`
  (payload-reference fields only), `contentFidelity`, `contentType`,
  `contentHash?`, `contentCanonicalizer?`, `contentHashUnavailableReason?`,
  `provenance`, and — for standalone artifacts — `traceId` and
  `evidenceSchemaVersion` explicitly (Spec 013 §6.1).
- **Discriminant/id rules:** `artifactId` opaque, unique within trace;
  hashing path selected from the artifact's own fields
  (`contentFidelity` + `contentType` + `contentCanonicalizer`), never from
  enclosing context.
- **Append-only:** yes.
- **Observation boundary:** inherits trace unless overridden.
- **Serialization:** JSON object; `contentHash` and `contentHashUnavailableReason`
  are mutually exclusive; `contentHash` never implies possession of
  discarded originals.
- **Validation:** the full §6.1 matrix: `byte_faithful` → hash retained bytes
  directly; `structurally_faithful` JSON → RFC 8785 (JCS) + UTF-8;
  `structurally_faithful` non-JSON → declared versioned canonicalizer;
  no supported canonicalizer → `contentHashUnavailableReason:
  "unsupported_canonicalizer"` and no hash; `missing`/`unknown`/`not_applicable`
  → no `contentFidelity`, no `contentType`, no hash; `redacted`/`truncated`
  hash only the retained representation; media type in RFC 6838 restricted-name
  syntax with no parameters.
- **Relationships:** referenced by `contextContributions` via `artifactId`;
  may be standalone (self-describing) or enclosed by a trace.
- **Slice:** in.

#### 2.2.7 Context contribution (`ContextContribution`)

- **Category:** evidence.
- **Responsibility:** the recorded act of adding context into a model request
  (Spec 013 §6.2).
- **Fields:** `artifactId`, `locator` ∈ {`whole`, `range`, `fragment`,
  `hash`} with locator-specific details, `position`, `provenanceState` ∈
  {`recorded`, `inferred_after`}.
- **Discriminant/id rules:** none beyond the locator discriminant;
  `inferred_after` MUST be labeled and MUST NOT be presented as observed.
- **Append-only:** yes.
- **Observation boundary:** observed at capture when `recorded`; derived when
  `inferred_after`.
- **Serialization:** JSON object.
- **Validation:** `artifactId` resolves to a known artifact; locator shape
  matches its type; position is a non-negative integer.
- **Relationships:** references artifacts; carried by `model_request` events.
- **Slice:** in.

#### 2.2.8 Condition (`Condition`)

- **Category:** evidence (metadata).
- **Responsibility:** a declared, labeled experimental or environmental
  condition attached to an interaction; metadata, never evidence of outcome
  (Spec 013 §1.1).
- **Fields:** `label`, `value`, `version`.
- **Discriminant/id rules:** none; label is the key.
- **Append-only / boundary / serialization / validation:** trivial metadata;
  no payload status; JSON object.
- **Relationships:** owned by the trace envelope (`conditions`).
- **Slice:** in (it appears on the trace envelope and is trivial); MAY be
  deferred to a later slice without blocking anything else if the reviewer
  prefers a tighter first slice.

#### 2.2.9 Completeness record (`CompletenessRecord`)

- **Category:** derived — Spec 013 §1.1 classifies trace completeness as
  **Derived**; it is not recorded evidence, not a measurement, and not an
  interpretation, and it must never become a general-purpose analysis layer.
- **Responsibility:** a derived description of which evidence was captured,
  redacted, truncated, missing, or unknown, plus sequence gaps, duplicates,
  and the boundary statement (Spec 013 §4.3). Never invents evidence;
  unobserved lifecycle termination is reported (boundary statement /
  explicit `missing` record) per §4.7, never fabricated.
- **Fields:** `eventsByStatus: Record<EvidenceStatus, number>`, `seqGaps[]`,
  `duplicatesDetected[]`, `boundaryStatement`.
- **Discriminant/id rules:** none.
- **Append-only:** derived; recomputable by a deterministic pure function
  `deriveCompleteness(trace, analysis, boundary)`; serialized exactly once as
  `EvidenceRecord.completeness`, never on `EvidenceTrace`.
- **Derivation contract (`deriveCompleteness`):** MUST be pure and
  deterministic; signature:

```ts
function deriveCompleteness(
  trace: EvidenceTrace,
  analysis: EvidenceStructuralAnalysis,
  boundary: CaptureBoundary
): TraceCompleteness;
```

  MUST operate only on explicit evidence, the provided structural analysis,
  and capture-boundary declarations; MUST NOT fabricate observations (it
  never invents missing events or statuses); MUST report unavailable or
  incomplete inputs (for example, a trace whose boundary cannot be
  determined yields an incomplete completeness record, not an invented
  boundary statement); and MUST NOT calculate quality, cost, recommendations,
  smells, or optimization claims.
- **Validation:** counts match the events; gaps and duplicates match the
  structural analysis; `EvidenceRecord.completeness` MUST equal the
  deterministic derivation from trace, analysis, and boundary or parsing
  rejects the record.
- **Relationships:** derived from the trace it describes.
- **Slice:** in (the derivation function and the type).

#### 2.2.10 Observation boundary and capture surface

- **Category:** evidence (metadata).
- **Responsibility:** the declared scope of what a capture surface could and
  could not observe (Spec 013 §5).
- **Vocabulary:** `observationRole` ∈ {`application_constructed`,
  `client_sent`, `provider_reported`, `returned`, `unobservable`};
  `captureSurface` ∈ {`client_side`, `ingress_proxy`, `tool`, `mcp`,
  `context_provider`} (the surface list already used by
  `docs/capture-profiles.md`); trace-level `observationBoundary` is one of
  the roles. Including `tool` and `mcp` in this vocabulary is type-system
  vocabulary, not tool/MCP instrumentation (§2.2, “Record kinds versus
  instrumentation”).
- **Validation:** role and surface vocabularies; `unobservable` requires
  `evidenceStatus: "unknown"`; a claim is scoped to the boundary where it was
  observed.
- **Slice:** in (types + constants + validation).

#### 2.2.11 Capture profile reference and collection policy

- **Category:** evidence metadata (collection context); the full profile
  bundle also carries administrative configuration.
- **Responsibility:** record which collection profile was in effect (Spec 013
  §9.2: the collection profile version belongs to the capture context and is
  recorded on the trace; persistence and export policy versions never appear
  on canonical raw evidence).
- **Fields:** on the trace, `captureProfile: { name, version }`; the
  `CollectionPolicy` type mirrors `docs/capture-profiles.md` (surfaces,
  boundaries, payload capture, redaction rules, truncation, event kinds).
- **Validation:** canonical records MUST NOT carry persistence or export
  policy fields; the validator rejects them (as
  `scripts/validate-evidence-examples.mjs` already does).
- **Slice:** in for the trace-level reference and `CollectionPolicy`;
  persistence and export policy types deferred (§2.3).

#### 2.2.12 Vocabulary and value types

- `EvidenceStatus` ∈ {`captured`, `redacted`, `truncated`, `missing`,
  `unknown`, `not_applicable`} — never `null`, never omitted; `inferred` is
  NOT an evidence status and MUST NOT appear on evidence records.
- `ObservationRole`, `CaptureSurface` (above).
- `ContentHash` / `NativeContentHash` — `sha256:<64 lowercase hex>`.
- `ContentHashUnavailableReason` — closed vocabulary: `unsupported_canonicalizer`.
- `MissingDeclaration` — `{ reason, note?, reportedBy: { captureSurface,
  observationBoundary } }` (shape as in the docs' example 9).
- `RedactionDeclaration` — `{ policy, reasons[] }`.
- `TruncationDeclaration` — `{ maxLength, originalLength }`.
- `ClockBasis` — declared basis for monotonic `durationMs`; the initial
  slice defines the value `monotonic-performance-now-ms` (§4.3).
- `CapturedAt` / timestamps — ISO 8601 UTC with millisecond precision.
- `EvidenceSchemaVersion` — semantic-version string (`MAJOR.MINOR.PATCH`,
  as in the normative examples' `1.0.0`), recorded directly or inherited
  through the trace reference (Spec 013 §10, `docs/versioning.md`).
- `TraceStatus` / `SpanStatus` — an explicit decision ratified with
  this spec (§4.7): `completed` | `failed` | `cancelled` | `unknown`,
  with the meanings and validator rules in §4.7. Status is evidence-scoped
  lifecycle state, never a quality judgment; absence of an observed error is
  not proof of success; `unknown` represents an unobservable terminal state.
- `LifecycleTarget` — `trace` | `span` | `none`. Declares which record
  an `error` or `cancelled` event targets for terminal effect.
- `LifecycleEffect` — `fail` | `cancel` | `none`. Declares the terminal
  effect on the targeted record. `error` events carry `fail` or `none`;
  `cancelled` events carry `cancel`. A `none` effect means the event
  terminates no lifecycle (recoverable/informational).

### 2.3 Explicitly deferred primitives and capabilities

These are out of the first implementation slice and MUST NOT be implemented
as part of Spec 014:

- **Measurement record** (`MeasurementRecord`) — deterministic derivations
  (token counts, latency, duration, cost); requires the deterministic
  measurements spec.
- **Interpretation record** (`InterpretationRecord`) — smells,
  recommendations, findings, explanations; requires the optional-analysis
  layer.
- **Run projection** — session-level grouping of interactions; a projection,
  not a canonical container (handled in §6).
- **Persistence and export policy types** — administrative configuration;
  belong to the storage and export specifications, never on canonical
  records.
- **Distributed trace federation** (Spec 013 §1.2, deferred by Spec 013
  itself).
- **Streaming-native capture**, **native byte capture**, **MCP/tool capture
  and instrumentation** (adapters, lifecycle integration, runtime emission),
  **Graphify provenance**, **deterministic measurements**, **dashboard
  migration**, and **privacy/retention/redaction workflows** — each requires
  its own later specification (§8.2).
- Any provider adapter, collector, or storage integration.

## 3. Discriminants, identifiers, and versions

### 3.1 Discriminants

- `EventRecord` is a discriminated union on `kind` with the closed
  vocabulary of Spec 013 §3.1 (§2.2.3). The `type`-based union MUST NOT be
  widened by adding kinds at runtime; new kinds require a schema version
  change and are handled as §5.3.
- `SpanRecord` discriminates on `kind` (§2.2.2).
- `ContentLocator` discriminates on `type` ∈ {`whole`, `range`, `fragment`,
  `hash`}.
- `ProviderNativeFidelity` ∈ {`structurally_faithful`, `byte_faithful`}.
- Envelope native payload is preserved, not discriminated by provider.

### 3.2 Identifiers

- Assigned at capture time; immutable; opaque; MUST NOT be derived from
  content (Spec 013 §2.1). Content-derived identity is a hash field, never
  an id.
- `traceId` / `interactionId`: unique within an installation, SHOULD be
  globally unique; ULID-style values recommended. The equality invariant is
  validated.
- `spanId`, `eventId`, `artifactId`: unique within the trace; opaque.
- **Generation is the caller's responsibility, not the evidence core's.** The
  evidence package does not generate ids: constructors and parsers accept
  caller-supplied opaque ids; validators verify syntax (non-empty opaque
  string), uniqueness within the trace, and reference integrity; ids carry
  no ordering semantics (§4.1). This resolves the previously reported
  id-generation question: no ULID/UUIDv7/counter choice is made here because
  generation belongs to the capture surface (or the caller), not to the
  evidence core.
- **Projections preserve valid legacy ids where possible** (§6.3). When a
  synthesized id is unavoidable in a projection, it MUST be produced by an
  explicitly versioned deterministic projection rule and reported as
  `inferred` in the projection report; it is never presented as observed.
- Identifiers MUST NOT be used for ordering; only `seq` orders events (§4.1).

### 3.3 Versions

- Every evidence record carries `evidenceSchemaVersion` directly or inherits
  it through its trace reference (Spec 013 §10). Standalone records (for
  example a standalone artifact) carry it explicitly. The format is
  semantic-version syntax (`MAJOR.MINOR.PATCH`, as in the normative examples'
  `1.0.0`), per Spec 013 §10 and `docs/versioning.md`; **MAJOR is the
  compatibility boundary** (§5.3): compatible additive minor/patch revisions
  within a supported MAJOR are accepted, and an unknown MAJOR is breaking.
- Schema evolution is additive by default: adding fields with defined
  defaults MUST NOT break readers of older records; removing or reinterpreting
  fields is a breaking change requiring a new version and a projection
  (`docs/model-versioning.md`).
- Version identifiers for derivations are recorded with the derived record,
  never assumed from the current build — deferred with the measurement layer,
  but the rule is inherited from Spec 013 §10 for when that layer lands.
- Projection functions carry their own projection version (§6.5).

## 4. Determinism, identity, and ordering

### 4.1 Sequence ordering (`seq`)

- Every event carries `seq`: a non-negative integer, strictly increasing and
  **contiguous** within the trace, assigned by the trace's authoritative
  sequencing surface at observation time (Spec 013 §2.2). First event `seq`
  0; each subsequent event exactly one greater at assignment.
- `seq` is the **only** deterministic ordering key. Timestamps, hierarchy,
  ids, and arrival order are never ordering keys.
- Two events MUST NOT share a `seq` within a trace. A retained trace that lost
  an event shows a gap and MUST be marked incomplete; contiguity is never
  restored by renumbering retained events.
- Persistence and replay never assign `seq`.
- Spans reference their `startSeq`/`endSeq`; concurrency = overlapping ranges
  with no ancestor relationship. `parentSpanId` is hierarchy-only metadata.

### 4.2 Timestamps

- `capturedAt` — ISO 8601 UTC with millisecond precision, set by the capture
  surface. May tie; ties are resolved by `seq`, never by the timestamp.
- `startedAt` / `finishedAt` on the trace and spans — same format and rules.
- `persistedAt` MAY record when a record reached persistence; it is
  administrative metadata, never an ordering key, and MUST NOT appear on
  canonical raw evidence records as a policy field (§9.2 of Spec 013).

### 4.3 Monotonic timing

- `durationMs` is derived from a monotonic clock at capture and the clock
  basis MUST be declared (`ClockBasis`). Initial slice defines
  `monotonic-performance-now-ms`; the vocabulary is open to extension by
  later capture specs, and any extension MUST be additive (a new string
  value), never a reinterpretation of an existing one.
- When no trustworthy monotonic clock is available, `durationMs` MUST NOT be
  recorded with a basis claiming monotonicity. Duration is a measurement
  concern: the measurement layer (later spec) records missing durations
  explicitly with an unavailable status; a span MUST NOT fabricate a
  duration from wall-clock subtraction.

### 4.4 Duplicates, drops, and gaps

**Processing order (normative):** validators MUST apply duplicate and gap
analysis in this deterministic order:

1. Validate raw observations and their unique immutable `observationId`
   values.
2. Apply `projectCanonicalEvent` to every observation.
3. Group semantically equal same-ID/same-sequence projections as exact replay
   groups, preserving every participating observation identity.
4. Reject multiple conflicting projections within any same-ID/same-sequence
   position.
5. Resolve each same-ID/different-sequence group by retaining its lowest
   sequence position and recording every observation identity at every
   retained or discarded position.
6. Reject different-ID/same-sequence collisions among the remaining canonical
   candidates.
7. Validate retained event-ID and sequence uniqueness.
8. Derive gaps from retained sequence positions.
9. Derive completeness only for a trace that remains valid after structural
   validation.

This processing is invariant under permutation of the same already identified
raw observations. Array position, arrival order, timestamps, opaque
`observationId`/`eventId` values, and content digests never select a winner.
`seq` remains the only canonical event-ordering and permitted collision-
resolution field. Normalization preserves the raw observation array untouched;
it does not reorder that captured evidence into `seq` order.

**Collision cases:**

- **Exact replay:** two or more observations have semantically equal
  `projectCanonicalEvent` results, including identical `eventId` and `seq`.
  - Collapse to one retained event.
  - Preserve every raw observation and report the complete set of
    participating observation identities without a representative.
  - Report the replay duplicate in the completeness record
    (`duplicateDetected`).
  - Do not report a sequence gap because the assigned position remains
    represented.

- **Same-ID, same-sequence content conflict:** same `eventId` and same
  `seq`, but conflicting `projectCanonicalEvent` results (any retained
  canonical event field differs).
  - They are not exact replays.
  - **Reject the trace as invalid**. Do not select a winner based on
    "first observed," opaque identifier ordering, content hashes, or
    arrival order.
  - Emit a structured validation issue identifying the event-ID/content
    conflict without echoing sensitive payload content.
  - Do not derive or serialize a valid canonical trace or authoritative
    completeness record from an arbitrarily selected candidate.

- **Different-ID, same-sequence collision:** after same-ID/different-sequence
  resolution, different retained `eventId` candidates claim the same `seq`.
  - **Reject the trace as invalid** because canonical sequence uniqueness
    is violated.
  - Do not use identifier ordering, arrival order, timestamps, or content
    hashes as a tie-breaker.
  - Emit a structured sequence-collision validation issue.
  - Do not retain an arbitrary winner or infer a gap while both
    candidates claim the same assigned position.

- **Same-ID, different-sequence conflict:** the same `eventId` occurs at two
  or more different `seq` positions; any position may itself contain an exact
  replay group.
  - Retain the lowest-`seq` position because `seq` provides a deterministic
    distinction in this case, preserving every observation identity there.
  - Report the duplicate conflict in the completeness record.
  - Record every higher discarded position exactly once, including every
    observation identity at that position. Report it as a gap unless another
    independently valid retained event occupies it.
  - Never renumber retained events.

**Drops:** a `seq` gap proves an assigned sequence position is absent from
retained evidence; the completeness record reports the gap and adjacent
event ids. SignalGlass MUST NOT invent the missing event. An event that
failed before assignment produces no gap and is disclosed through the
boundary statement or an explicit `missing` record — never inferred from
sequence position.

**Architectural principles preserved:**

- Sequencing occurs at the observation boundary.
- Canonical events are never reordered or renumbered during validation.
- Duplicate processing must not silently alter observed evidence.
- Uncertainty and incompleteness remain visible.
- Completeness represents incomplete but structurally valid evidence; it
  must not convert an ambiguous or structurally invalid collision into a
  valid trace.

### 4.5 Hash selection and scope

- `contentHash` hashes the **retained representation** as bytes; the path is
  selected from the artifact's own fields (Spec 013 §6.1, §2.2.6 here). No
  second hashing contract is introduced.
- `nativeContentHash` is envelope-level, over the exact native byte sequence
  observed at the boundary; rules and compatibility with `contentHash` are
  exactly Spec 013 §3.2.
- Stable serialization for hashing: `structurally_faithful` JSON uses RFC
  8785 (JCS) + UTF-8; non-JSON structured formats use their declared versioned
  canonicalizer; no supported canonicalizer → `contentHashUnavailableReason`.
- Hash input is retained payload content only; metadata and envelope fields
  are excluded unless part of the retained payload.
- `redacted`/`truncated` retained representations hash only what remains;
  hashes of low-entropy or secret content (authorization headers, tokens, API
  keys) MUST NOT be retained (Spec 013 §6.1).

### 4.6 Streamed and concurrent observations

- Streaming chunks and concurrent spans are ordered by the sequencing
  surface's single `seq` sequence (§4.1); there is exactly one authoritative
  sequencing surface per trace. Cross-surface federation is deferred (Spec
  013 §1.2).
- Projection ordering: projection functions are pure and deterministic;
  identical input records + identical projection version produce identical
  output (§6.5). Object-property order, generated ids, and wall-clock
  timestamps alone never determine output order.

### 4.7 Trace and span status

Status is an explicit decision ratified with this spec; it describes
observed lifecycle state and is tightly scoped evidence/administrative state,
never a quality judgment.

- **Values.** `completed` — the capture surface observed a normal terminal
  lifecycle event (`interaction_end`/`span_end`) as the record's final
  applicable event, with no prior event in the record's applicable scope
  explicitly declaring terminal failure or cancellation of that same record.
  It records that the lifecycle was observed to end normally; it is **not**
  proof of success of the underlying work: absence of an observed error is
  not evidence of success. `failed` — an `error` event was observed that
  explicitly declares failure of the trace or span (with its declared `actor`
  and observation role, Spec 013 §3.3) as the record's final applicable
  event. The status records the observed failure, never provider-internal
  failure. `cancelled` — a `cancelled` event was observed that explicitly
  declares cancellation of the trace or span (recording who/what requested
  cancellation, Spec 013 §3.3) as the record's final applicable event.
  `unknown` — the terminal state could not be observed (for example capture
  ended before the terminal event, or the boundary could not observe
  completion); `unknown` is an honest representation of unavailability and
  MUST NOT be defaulted to `completed`.
- **Terminal-state availability contract.** Finish fields are present exactly
  when a terminal state was observed — never fabricated. The internal type
  MUST represent the terminal state as this discriminated union (or an
  equivalent compile-time contract that makes invalid field/status
  combinations unrepresentable), and the serialized record MUST follow the
  same presence rules:

```ts
type TraceTerminalState =
  | { status: "completed"; finishedAt: string }   // interaction_end observed
  | { status: "failed"; finishedAt: string }      // terminal error event observed
  | { status: "cancelled"; finishedAt: string }   // cancelled event observed
  | { status: "unknown" };                         // termination not observed

type SpanTerminalState =
  | { status: "completed"; endSeq: number; finishedAt: string }  // span_end observed
  | { status: "failed"; finishedAt: string }                     // terminal error observed
  | { status: "cancelled"; finishedAt: string }                  // cancelled observed
  | { status: "unknown" };                                       // termination not observed
```

  Presence rules: `finishedAt` (trace) is present iff the trace status is
  `completed`, `failed`, or `cancelled`, and is absent (not serialized, never
  `null`) when status is `unknown`; span `endSeq` is present only for
  `completed` spans and equals the observed `span_end` event's `seq`; span
  `finishedAt` is present iff the span status is `completed`, `failed`, or
  `cancelled`, and is absent when status is `unknown`. A present
  `finishedAt`/`endSeq` MUST be supported by observed evidence (§5.4): for
  `completed` it equals the `interaction_end`/`span_end` event's
  `capturedAt`/`seq`; for `failed` and `cancelled` spans it equals the
  terminal `error`/`cancelled` event's `capturedAt` (no `endSeq`); for `failed`
  and `cancelled` traces it equals the terminal `error`/`cancelled` event's
  `capturedAt`. No `null` sentinel is used for unobserved finish fields (Spec
  013 §2.1 reserves `null` for structural absence of parentage/attachment, not
  for lifecycle fields).
- **Validation rules.** The status MUST be declared by the capture surface
  at capture and MUST be coherent with the observed lifecycle events (the
  validator checks this). Lifecycle targeting and terminal effects are
  determined exclusively from the structured `lifecycleTarget` and
  `lifecycleEffect` fields on `error` and `cancelled` events — never from
  `actor`, `observationRole`, or free-form payload text.
  - `completed` (trace/span) requires the observed normal terminal event
    (`interaction_end`/`span_end`) as the record's final applicable event;
    validators MUST NOT accept `completed` without it. A `completed` status
    is valid only when no prior event in the record's applicable scope has
    `lifecycleTarget` matching that record and `lifecycleEffect` ∈
    {`fail`, `cancel`}.
  - `failed` requires an observed `error` event with `lifecycleEffect:
    "fail"` and `lifecycleTarget` matching the record (`trace` or `span`)
    as the record's final applicable event. Such a terminal failure
    declaration MUST be the final applicable event for that record; a later
    `interaction_end`/`span_end` for the same record contradicts the earlier
    terminal declaration and MUST fail validation. An `error` with
    `lifecycleEffect: "none"` (recoverable/informational) does not set
    lifecycle status. An `error` with `lifecycleTarget: "span"` and
    `lifecycleEffect: "fail"` does not automatically fail the containing
    trace or parent spans.
  - `cancelled` requires an observed `cancelled` event with
    `lifecycleEffect: "cancel"` and `lifecycleTarget` matching the record
    as the record's final applicable event. Such a terminal cancellation
    declaration MUST be the final applicable event for that record; a later
    `interaction_end`/`span_end` for the same record contradicts the earlier
    terminal declaration and MUST fail validation. A `cancelled` event with
    `lifecycleTarget` not matching the record does not automatically cancel
    it.
  - `unknown` requires no terminal event; validators MUST NOT require
    `interaction_end`/`span_end` when the lifecycle was not observed to
    finish.
  - Validators MUST NOT infer `completed`/`failed`/`cancelled` from
    incomplete evidence, and wall-clock time is never used to invent
    lifecycle completion: a trace with no observed terminal event cannot
    become `completed` because time passed.
  - A serialized record whose events contradict its declared status (for
    example `completed` without `interaction_end`, or a present
    `finishedAt`/`endSeq` not equal to the cited terminal event's
    `capturedAt`/`seq`) is rejected.
  - **Final applicable event scope.**
    - For a trace terminal state, the final applicable event is the event
      with the greatest canonical `seq` in the trace; the required terminal
      event (`interaction_end` for `completed`, an `error` with
      `lifecycleTarget: "trace"` and `lifecycleEffect: "fail"` for
      `failed`, a `cancelled` with `lifecycleTarget: "trace"` and
      `lifecycleEffect: "cancel"` for `cancelled`) MUST be that event.
    - For a span terminal state, the final applicable event is the event
      with the greatest canonical `seq` among events attached to that span
      (`spanId` match); the required terminal event (`span_end` for
      `completed`, an `error` with `lifecycleTarget: "span"` and
      `lifecycleEffect: "fail"` for `failed`, a `cancelled` with
      `lifecycleTarget: "span"` and `lifecycleEffect: "cancel"` for
      `cancelled`) MUST be that event.
    - Later events belonging to unrelated spans must not invalidate a failed,
      cancelled, or completed span.
    - An `error` only terminates a span when `lifecycleTarget: "span"` and
      `lifecycleEffect: "fail"`. An `error` or `cancelled` with
      `lifecycleTarget: "trace"` does not automatically terminate child
      spans, and one with `lifecycleTarget: "none"` terminates no lifecycle.
    - Timestamps never determine which event is final; `seq` is the sole
      authority.
  - **Preserved example.** A tool-span `error` with `lifecycleTarget:
    "span"`, `lifecycleEffect: "fail"`, followed by the trace's
    `interaction_end`, yields a `failed` tool span and a `completed` trace
    — the child span's terminal declaration does not propagate to the trace.
    A trace-level `error` with `lifecycleTarget: "trace"`,
    `lifecycleEffect: "fail"`, followed by `interaction_end`, is
    contradictory and invalid.
- **Completeness.** Unobserved termination is missing lifecycle evidence and
  MUST be reported: the completeness record's boundary statement (or an
  explicit `missing` record) discloses that termination was not observed
  (Spec 013 §4.3); it is never inferred from sequence position or clock
  time.

## 5. TypeScript and runtime-validation contract

### 5.1 Compile-time types versus runtime validation

Compile-time `type` declarations describe well-formed records; they are
NOT a runtime guarantee. Untrusted serialized input (JSON from a file,
a socket, an external tool) MUST pass runtime validation before it is
treated as evidence. The two layers MUST agree: every validator is written
against the same field rules the types declare, and the validation rules
are ported from the repository's existing dependency-free semantic
validator (`scripts/validate-evidence-examples.mjs`) so the docs' serialized
examples and the package accept/reject the same inputs.

### 5.2 Validation entry points and result types

- `parseEvidenceRecord(input: unknown): EvidenceRecordParseResult` — the
  primary entry point; validates the full serialized evidence record
  (identity, seq, spans, events, envelopes, artifacts, completeness
  consistency) and returns the parsed `EvidenceRecord` with its canonical
  trace, structural analysis, and derived completeness.
- Per-record validators: `isEvidenceStatus`, `isObservationRole`, `isEventKind`,
  `isContentHash`, `isContentType`, and record-level guards
  (`isContextArtifact`, `isRequestEnvelope`, ...) for composability.
- Raw observation type:

```ts
type EvidenceObservation = {
  observationId: string;
  eventId: string;
  traceId: string;
  spanId: string | null;
  seq: number;
  kind: string;
  capturedAt: string;
  evidenceStatus: EvidenceStatus;
  observationRole: ObservationRole | null;
  payload: unknown;                    // kind-specific payload
  rawCapturedAt: string;               // identical to capturedAt for observations; may differ for replays
};
```

- Canonical replay-comparison projection:

```ts
declare function projectCanonicalEvent(
  observation: EvidenceObservation
): EventRecord;
```

  `projectCanonicalEvent` excludes `observationId`, `rawCapturedAt`, and every
  other field used solely for raw-capture provenance or observation-container
  metadata. It retains every canonical `EventRecord` field: `eventId`,
  `traceId`, `spanId`, `seq`, `kind`, `capturedAt`, `evidenceStatus`,
  `observationRole`, every kind-specific payload field, and applicable unknown
  additive event fields preserved under §5.3. It MUST NOT alter, redact,
  normalize away, or silently discard event evidence to manufacture equality.
  This is the only projection used for exact-replay classification,
  same-ID/same-sequence content-conflict detection, optional canonical-content
  digests, and parser verification of serialized duplicate analysis. Exact
  replay requires semantic equality of the projected events, including equal
  `eventId` and `seq`.

- Authoritative evidence record type (serialized form):

```ts
type EvidenceRecord = {
  rawObservations: readonly EvidenceObservation[];
  trace: EvidenceTrace;
  analysis: EvidenceStructuralAnalysis;
  completeness: TraceCompleteness;
  evidenceSchemaVersion: string;
  captureBoundary: CaptureBoundary;
};
```

- The `rawObservations` array contains **every captured observation**,
  including every replay or conflicting copy. Each observation receives a
  unique, immutable, opaque `observationId` at the capture boundary. The
  serialized array preserves captured array order for lossless authoritative
  round trips, but that order is not semantically authoritative, does not
  imply arrival or capture order, and is never a normalization tie-breaker.
  If capture order is evidence for a future use case, it MUST be recorded as
  an explicit captured field rather than inferred from array position. The
  array is never modified by normalization; it is authoritative captured
  evidence.
- The `trace` field is the deterministic normalized canonical trace
  derived from `rawObservations` per the collision rules in §4.4.
- The `analysis` field summarizes duplicate observations and sequence
  gaps derived from `rawObservations` and `trace`.
- The `completeness` field is derived from `trace`, `analysis`, and
  `captureBoundary` per `deriveCompleteness`.
- Result type (single discriminator, no nested result wrappers):

```ts
type EvidenceRecordParseResult =
  | {
      ok: true;
      record: EvidenceRecord;
    }
  | {
      ok: false;
      issues: readonly ValidationIssue[];
    };
```

- Structural analysis types (referencing raw observations):

```ts
type ObservationIdentitySet = readonly string[];

type ObservationPosition = {
  seq: number;
  observationIds: ObservationIdentitySet;
};

type CanonicalEventDigest = {
  algorithm: "sha256";
  projectionAlgorithmVersion: string;
  canonicalization: "rfc8785-jcs-utf8";
  value: string; // sha256:<64 lowercase hexadecimal characters>
};

type DuplicateObservation =
  | {
      classification: "exact_replay";
      eventId: string;
      seq: number;
      observationIds: ObservationIdentitySet;
      canonicalContentDigest?: CanonicalEventDigest;
      normalizationAlgorithmVersion: string;
    }
  | {
      classification: "same_id_different_seq";
      eventId: string;
      retainedPosition: ObservationPosition;
      discardedPositions: readonly {
        seq: number;
        observationIds: ObservationIdentitySet;
        positionIndependentlyRepresented: boolean;
      }[];
      normalizationAlgorithmVersion: string;
    };

type SequenceGap = {
  startSeq: number;
  endSeq: number;                       // exclusive; gap covers [startSeq, endSeq)
  adjacentRetainedEventIds: [string, string] | [string] | [];
};

type EvidenceStructuralAnalysis = {
  duplicateObservations: readonly DuplicateObservation[];
  sequenceGaps: readonly SequenceGap[];
  validationIssues: readonly ValidationIssue[];
  completenessDerivationAlgorithmVersion: string;
};

type CaptureBoundary = {
  captureSurface: CaptureSurface;
  observationBoundary: ObservationRole;
  declaredEventKinds: readonly string[];
  declaredSurfaces: readonly CaptureSurface[];
  missingRecord: MissingDeclaration | null;
};
```

- Every `observationIds` collection contains unique identities and is
  semantically set-like: order carries no evidence precedence, and permutation
  does not change semantic equality. Deterministic serialization sorts a copy
  lexicographically by unsigned UTF-8 bytes; that serialization rule MUST NOT
  affect collision resolution or event ordering.
- An exact-replay group contains every participating `observationId` and has
  no retained representative. Two-copy and three-or-more-copy replays use the
  same shape. If present, `canonicalContentDigest` is SHA-256 over the RFC 8785
  (JCS) canonical JSON bytes of `projectCanonicalEvent`, encoded as UTF-8; its
  projection algorithm version is explicit. It is distinct from payload
  `contentHash` and envelope `nativeContentHash`, is only an integrity or
  comparison aid, and MUST NOT affect ordering, precedence, or winner
  selection.
- For a same-ID/different-sequence relationship, the lowest `seq` is the
  `retainedPosition`, and its identity set contains every observation at that
  position. `discardedPositions` contains every higher sequence position
  exactly once, serializes in ascending `seq`, retains every observation
  identity at each position, and records whether that position is occupied by
  another independently valid retained event. Structural analysis references
  but never replaces any raw observation.
- `CaptureBoundary` records the declared observation boundary and declared
  event kinds/surfaces for completeness derivation (§2.2.9).
- The parser returns `EvidenceRecordParseResult` with the full
  `EvidenceRecord` containing raw observations, canonical trace, structural
  analysis, and derived completeness.

- Validation functions never throw for malformed input; they return an
  `EvidenceRecordParseResult`. Throwing is reserved for programming
  errors in the callers, not for invalid evidence.
- Malformed serialization and structurally invalid evidence produce
  deterministic issue reporting with `ok: false`.
- Invalid ambiguous collisions (same-ID/same-seq content conflict,
  different-ID/same-seq collision) produce `ok: false` with structured
  issues and no `record`.

### 5.3 Unknown fields, unknown discriminants, and newer versions

- **Unknown fields on known shapes:** preserved, not errors. Forward
  tolerance per Spec 013 §10: older readers MUST tolerate unknown additive
  fields in newer records without failing, and MUST preserve them on
  read-modify-write round trips. `parseEvidenceRecord` retains unknown fields
  (in an explicit passthrough slot on the internal record) and
  `serializeEvidenceRecord` re-emits them at their original structural paths with
  equivalent JSON values — never discarded and never interpreted as known
  evidence. "Ignore unknown fields" never permits discarding them when
  evidence is re-serialized. Ordinary unknown-field preservation does NOT
  claim lexical JSON byte fidelity: after JSON parsing, whitespace, number
  spelling (for example `1.0` vs `1`), escape spelling, and object-key
  formatting are not preserved — only the parsed JSON values are. If exact
  raw bytes must be retained, that is the byte-fidelity contract
  (`byte_faithful` retained representation, §5.7), which ordinary
  unknown-field preservation never implies.
- **Unknown discriminant values** (an event `kind`, artifact `kind`, locator
  `type`, or fidelity value not in the closed vocabulary): a validation
  **error**, because the record's semantics cannot be safely interpreted.
  The error identifies the field path and the unknown value's presence
  without echoing content.
- **Compatible version policy (Spec 013 §10 additive evolution).** The
  validator:
  - accepts the exact supported `evidenceSchemaVersion`;
  - accepts later additive **minor/patch revisions within a supported MAJOR
    version** when all required known fields and known discriminants remain
    valid — additive evolution means older readers MUST tolerate unknown
    additive fields in newer records (Spec 013 §10, `docs/model-versioning.md`);
  - preserves unknown additive fields during parse/serialize round trips
    (below);
  - rejects an **unknown or breaking MAJOR version** — removing or
    reinterpreting fields is a breaking change requiring a new version and a
    projection, never silent misreading (Spec 013 §10);
  - rejects **unknown discriminants** when their semantics are required to
    interpret the record safely (below);
  - never silently discards unknown fields;
  - returns **structured compatibility or validation errors** through the
    `EvidenceRecordParseResult` of §5.2 whenever safe interpretation is
    impossible.
  Four situations are deliberately distinguished: **unknown additive
  fields** (tolerated and preserved), **unknown discriminants** (refused
  when semantics are required), **compatible newer revisions** (accepted
  within a supported MAJOR), and **breaking or unsupported revisions**
  (refused with a structured version error, or accepted only through an
  explicit versioned projection). A record whose version cannot be handled
  is refused with a version error; it MUST NOT be silently misread.
- Unknown fields MUST NOT be interpreted as evidence fields: an unknown field
  named like a known field is still validated per the known field's rules if
  it occupies that position, and preserved otherwise.

### 5.4 Field, enum, and format validation

- **Required-field and enum validation:** every field rule from §2.2 is a
  validation rule. `evidenceStatus` is required on every evidence payload;
  it is never defaulted or coerced. Missing required fields and out-of-vocabulary
  enum values are errors.
- **Identifiers:** non-empty opaque strings; uniqueness within the trace;
  `interactionId === traceId`; cross-references resolve (`traceId`,
  `spanId`, `eventId`, `artifactId`, `originalRequestEventId`,
  `errorEventId`, measurement/interpretation inputs).
- **Timestamps:** ISO 8601 UTC with millisecond precision; ties allowed,
  resolved by `seq`.
- **Sequence:** non-negative integers; contiguous from 0; no duplicates;
  span `startSeq` required and matched to `span_start`; `endSeq` present
  only for `completed` spans and equals the observed `span_end` event's `seq`
  (§4.7).
- **Lifecycle coherence:** status-driven presence rules (§4.7) — `completed`
  requires the observed `interaction_end`/`span_end` as the record's
  final applicable event with no prior `lifecycleTarget`/`lifecycleEffect`
  declaration targeting that record; `failed`/`cancelled` require an `error`
  with `lifecycleEffect: "fail"` or `cancelled` with `lifecycleEffect:
  "cancel"` targeting the record as the final applicable event; `unknown`
  requires no terminal event; present `finishedAt`/`endSeq` equal the cited
  terminal event's `capturedAt`/`seq`; wall-clock absence never upgrades
  `unknown`.
- **Final observed event scope:** trace final event = greatest `seq` in trace;
  span final event = greatest `seq` among that span's events; required
  terminal event must be that final event; later unrelated span events do not
  invalidate a span; an `error` only terminates its declared span; timestamps
  never determine finality (§4.7).
- **Hashes:** `sha256:` followed by exactly 64 lowercase hexadecimal
  characters.
- **Media types:** RFC 6838 type/subtype restricted-name syntax — the same
  rule the repository already enforces in
  `scripts/validate-evidence-examples.mjs` (`MEDIA_TYPE_RE`): a type or
  subtype of 1–127 characters, first character alphanumeric, remaining
  characters from `A-Za-z0-9!#$&^_.+-`. Media-type parameters (for example
  `;charset=utf-8`) are rejected. There is no second content-type registry.
- **Fidelity/status matrix:** the envelope and artifact matrices of Spec 013
  §3.2/§6.1 are validated exactly (byte_faithful requires captured and the
  native fields; redacted/truncated hash only retained representations;
  missing/unknown/not_applicable carry no fidelity, content type, or hash;
  `contentHash` and `contentHashUnavailableReason` are mutually exclusive;
  etc.).
- **Vocabularies:** event kinds, span kinds, artifact kinds, roles, statuses,
  surfaces, locator types, and `contentHashUnavailableReason` are closed sets
  at validation time; see §5.3 for unknown-value behavior.

### 5.5 No silent coercion

- String `"5"` for `seq`, `0` for a missing boolean, a timestamp string in
  the wrong format, or a numeric status: all are **errors**, never coerced.
- A missing `evidenceStatus` is an error, never defaulted to `captured`.
- A `redacted` payload with a hash is permitted only over the retained
  representation and never implies possession of the original; a
  `structurally_faithful` envelope never implies byte fidelity.

### 5.6 Normalized versus preserved values

Parsing returns the canonicalized internal representation **and** preserves
everything that must survive round trips at the value level:

- Normalized: vocabulary values, timestamps, identifiers, envelopes'
  normalized common fields.
- Preserved: `providerNative` payloads at their declared fidelity, retained
  byte sequences (`byte_faithful`) without decoding or transformation, and
  unknown additive fields as parsed JSON values at their original structural
  paths (passthrough, §5.3 — value-level preservation, never lexical bytes).
- The two are explicit: normalization never rewrites native payloads, and
  preserved fields never bypass validation of the fields the contract owns.

### 5.7 Serialization rules

- **Authoritative evidence record serialization:** `serializeEvidenceRecord(record: EvidenceRecord)` produces the JSON-safe form: plain objects, arrays, strings, numbers, booleans, and `null` for structural absence only. The serialized output is the full `EvidenceRecord` containing:
  1. `rawObservations` — every captured observation, lossless;
  2. `trace` — the deterministic normalized canonical trace;
  3. `analysis` — structural analysis (duplicate observations, sequence gaps, validation issues);
  4. `completeness` — derived completeness;
  5. `evidenceSchemaVersion`;
  6. `captureBoundary`.
- **Normalized export serialization (derivative):** `serializeEvidenceExport(trace: EvidenceTrace, analysis: EvidenceStructuralAnalysis, completeness: TraceCompleteness, captureBoundary: CaptureBoundary)` produces a JSON-safe form containing only the canonical trace, reported structural analysis, derived completeness, and declared boundary. This export **omits `rawObservations`** and MUST:
  - declare in its metadata that raw observations are omitted;
  - declare the reduced verification boundary;
  - NOT be described as the authoritative evidence record;
  - label duplicate analysis as reported derived metadata;
  - declare that omitted observations cannot be independently proved,
    reconstructed, or revalidated without the authoritative `EvidenceRecord`;
  - retain enough declared boundary information to interpret its completeness
    honestly;
  - MAY validate internal consistency among its retained trace, reported
    analysis, completeness, and declared boundary, but MUST NOT claim
    evidentiary authority for observations it omits.
- **Retained-byte representation (`byte_faithful`) — pinned contract.**
  Retained byte payloads are represented in memory as `Uint8Array` and
  serialized in JSON as **Base64 per RFC 4648 §4**: the standard alphabet
  (`A–Z`, `a–z`, `0–9`, `+`, `/`), emitted as one contiguous string with no
  whitespace or line breaks. The exact spelling of the encoding name is
  `base64`. **Padding is exactly the canonical number of `=` characters RFC
  4648 §4 requires for the encoded length** — zero, one, or two: an input
  length divisible by 3 encodes with **zero** `=` characters, and a
  canonical value whose data length requires no padding MUST NOT be rejected
  for lacking `=`. Validators reject noncanonical forms: omitted required
  padding, superfluous padding (more `=` than canonical), malformed padding
  (for example `=` in a non-final position), URL-safe alphabet (`-`/`_`),
  and embedded whitespace or line breaks. Canonicality is validated by
  strict parsing or, equivalently, by decode-and-re-encode equivalence: a
  value is canonical iff re-encoding the decoded bytes reproduces it exactly.
  Decoders MUST accept only the canonical form (strictness keeps round trips
  lossless and deterministic); unpadded-when-required, over-padded,
  URL-safe, or whitespace-containing variants are never accepted.
  `nativeEncoding` records the observed bytes' original character encoding
  (for example `utf-8`), a field separate from the JSON transport encoding.
  Hashes relate to the **decoded** retained byte sequence: `nativeContentHash`
  is computed over the exact native byte sequence observed at the boundary,
  and `byte_faithful` `contentHash` over the retained bytes — never over the
  Base64-encoded text (§4.5; Spec 013 §3.2, §6.1). Fidelity claims are to
  the retained bytes only.
- No canonical-JSON requirement for storage serialization; deterministic
  canonicalization exists only where Spec 013 requires it (content hashing,
  §4.5). The serialized form is self-describing (schema version present) and
  MUST be interpretable without the current application build (Spec 013 §10).
- Serialization preserves unknown additive fields as parsed values (§5.3,
  value-level, never lexical bytes) and does not reorder or reformat
  retained native content.
- **Authoritative record round-trip (exact replay):** For an authoritative
  `EvidenceRecord` containing an exact replay group:
  1. every participating observation remains in `rawObservations`;
  2. one canonical event remains in `trace`;
  3. structural analysis reports the complete set of stable observation
     identities without a representative;
  4. `completeness` reflects the replay deterministically;
  5. serializing and parsing again reproduces equivalent `rawObservations`,
     `trace`, `analysis`, and `completeness`;
  6. the second parse does not reject the historical duplicate metadata.
- **Authoritative record round-trip (same-ID/different-seq conflict):**
  1. every observation at every involved position remains in
     `rawObservations`;
  2. the lowest-`seq` position becomes canonical in `trace`;
  3. each higher position appears exactly once in `discardedPositions` and is
     reported as a gap unless independently occupied;
  4. `retainedPosition` and each discarded position preserve their complete
     set of stable observation identities without replacing raw evidence;
  5. the result round-trips semantically.
- **Semantic round-trip equality (authoritative record):** the following are
  preserved under parse–serialize–parse of an `EvidenceRecord`:
  - `rawObservations` (lossless);
  - `trace` (retained canonical events);
  - `analysis` (structural duplicate analysis);
  - `captureBoundary`;
  - `completeness`.
  Raw array order and every `observationId` are preserved for this lossless
  round trip. Semantic equivalence of normalized results instead compares:
  canonical events by `seq`; exact-replay relationships by classification,
  event identity, sequence, and normalized set-like `observationIds`;
  same-ID/different-sequence relationships by event identity, retained
  position, ascending discarded positions, and each position's normalized
  set-like `observationIds` and independent-representation status;
  sequence gaps by `(startSeq, endSeq)` with
  `adjacentRetainedEventIds` compared as the ordered boundary tuple;
  completeness status maps by key/value and duplicate collections
  canonically; and validation issues by stable code, path, and normalized
  identifier collections rather than emission order. Raw serialized array
  order is intentionally excluded from normalized semantic equivalence.
  Byte-for-byte equality is unnecessary unless the existing serialization
  contract already requires it.

### 5.8 Unavailable or incomplete evidence

- `missing`, `unknown`, and `not_applicable` payloads validate with their
  status and MAY carry a `MissingDeclaration` (`reportedBy` records which
  surface/boundary reported the absence); they carry no content, no fidelity,
  no content type, and no hash.
- An `EvidenceRecord` with a real sequence gap whose serialized completeness
  **accurately documents that gap** (counts, gap positions, duplicate
  detections, boundary statement all match the deterministic derivation)
  remains parseable as an explicitly incomplete trace. The completeness
  record MUST document the gap; parsers MUST NOT repair or renumber.
- An `EvidenceRecord` whose serialized `completeness` **contradicts** its
  retained events, structural analysis, or the deterministic
  `deriveCompleteness` derivation (incorrect status counts, claimed
  nonexistent gaps, omitted duplicate or gap information, contradictory
  completeness status) is **invalid and MUST be rejected**. An `incomplete`
  label never overrides contradictory metadata.
- Parsing never fabricates events, content, or values to fill gaps.
- **Validation order (normative):**
  1. Parse raw serialized structure.
  2. Validate raw observations and unique, present, immutable observation
     identities.
  3. Apply `projectCanonicalEvent` without using raw array order.
  4. Group exact replays and reject conflicting projections within each
     same-ID/same-sequence position.
  5. Resolve same-ID/different-sequence groups and their retained/discarded
     position provenance.
  6. Reject different-ID/same-sequence collisions among remaining candidates.
  7. Deterministically derive the canonical trace and structural analysis,
     including duplicate observations and gaps.
  8. Compare serialized `trace` and `analysis` with those derivations using
     the semantic collection rules of §5.2.
  9. Derive completeness from the trace, analysis, and capture boundary.
  10. Require serialized `EvidenceRecord.completeness` to have exact semantic
     equality with that derivation.
  11. Reject disagreement without repairing or overwriting serialized
     metadata.
- **Parser distinctions:** A parser MUST distinguish:
  - valid historical duplicate provenance that cannot be inferred from the
    retained event array alone;
  - duplicate provenance inconsistent with the serialized raw observations
    or normalization record;
  - completeness metadata inconsistent with valid structural analysis.
- **Normalized exports without raw duplicate copies:** Such an export MUST
  declare omitted evidence and its reduced verification boundary, carry
  duplicate analysis only as reported derived metadata, and state that
  discarded raw observations cannot be independently proved, reconstructed,
  or revalidated without the authoritative `EvidenceRecord`. It MAY verify
  internal consistency among retained fields but is not authoritative for
  omitted observations.
- **Negative test requirements (validators MUST reject):**
  - Undocumented sequence gap (gap exists but completeness record omits it).
  - Completeness metadata claiming a nonexistent gap.
  - Incorrect status counts in completeness record.
  - Omitted duplicate or gap information.
  - Contradictory completeness status.
  - Serialized duplicate provenance inconsistent with raw observations.
  - Missing, duplicate, fabricated, or omitted participating observation
    identities in structural provenance.
  - A canonical-content digest that does not match the declared versioned
    `projectCanonicalEvent` bytes.
  - Serialized completeness inconsistent with structural analysis.
  - Fabricated duplicate provenance when the available evidence boundary
    permits that verification.
  - A correctly documented incomplete trace (all gaps, duplicates, and
    boundary statement match derivation) MUST remain parseable.

## 6. Compatibility projections

### 6.1 Directions and authority

Required directions (implemented in `@signalglass/core`'s
`evidenceProjections` modules, beside the legacy types):

1. **Canonical evidence → legacy `Trace`/`TraceEvent` view** — lets the
   dashboard, storage, and reports keep consuming the v0.x shape from
   canonical evidence.
2. **Legacy `Trace`/`TraceEvent` view → legacy `AgentRun` view** — lets the
   existing offline analyzer and reports run over canonical evidence via the
   documented legacy chain; this is the `Trace → AgentRun` conversion
   required by Spec 013 §11.2.
3. **Canonical evidence → legacy `AgentRun` view** — a convenience projection
   that MUST be equivalent to composing (1) then (2) for all representable
   `AgentRun` fields. Implementations MAY provide this as a direct function
   or as an explicit composition; either way the projection report MUST
   reflect the composed loss metadata (see §6.5).

The authoritative input is an **`EvidenceRecord`**. Projection functions read
its deterministic `trace` view; they never alter or overwrite the record, and
redacted/missing/unknown evidence is never fabricated into false certainty
during projection.

**Legacy `Trace`/`TraceEvent` → canonical evidence is NOT required.**
Spec 013 §11.2 requires legacy `Trace`/`TraceEvent` to be expressed as a
compatibility view *projected from* canonical evidence, and the legacy
`Trace → AgentRun` conversion to be expressed as a documented projection.
It does not require importing legacy traces into canonical evidence. A
future migration/import specification may define a legacy-import process,
but it must address provenance, inferred fields, observation boundaries,
and whether imported records are canonical evidence or a distinct
compatibility/import representation. That contract is out of scope for
Spec 014.

### 6.2 Projection function contracts

Stable conceptual function boundaries (types only, not implemented here):

```ts
type ProjectionReport = {
  projectionVersion: string;                 // version of this function
  sourceSchemaVersion: string;               // version of the input contract
  mappings: Array<{
    path: string;                            // input path, e.g. "events[3]"
    stage: "evidence_to_legacy_trace" | "legacy_trace_to_agent_run"; // which projection produced this mapping
    outcome: "exact" | "partial" | "inferred" | "unavailable";
    reason: string;                          // why the mapping is not exact
  }>;
};

type ProjectionIssue = {
  path: string;                              // input path, e.g. "events"
  stage: "evidence_to_legacy_trace" | "legacy_trace_to_agent_run";
  code: string;                              // stable machine code, e.g. "missing_event_collection"
  message: string;                           // human-readable; MUST NOT echo payload values
};

type ProjectionResult<T> =
  | { ok: true; view: T; report: ProjectionReport }
  | { ok: false; report: ProjectionReport; issues: ProjectionIssue[] };

type EvidenceToLegacyTrace = (record: EvidenceRecord) => ProjectionResult<LegacyTraceView>;
type LegacyTraceToAgentRun = (trace: LegacyTrace) => ProjectionResult<AgentRunView>;
type EvidenceToAgentRun = (record: EvidenceRecord) => ProjectionResult<AgentRunView>;
```

- Projections return an explicit `ProjectionResult` and never throw on
  expected invalid or lossy input. Three outcomes are distinguished:
  **successful exact projection** (`ok: true`, all mappings `exact`),
  **successful lossy or partial projection** (`ok: true` with
  `partial`/`inferred`/`unavailable` report entries — loss from otherwise
  valid input always returns a successful view, never a failure), and
  **failure** (`ok: false` with structured `ProjectionIssue[]`) when a valid
  target record cannot be constructed — for example the `LegacyTraceToAgentRun`
  projection cannot process an absent, non-array, or otherwise invalid legacy
  `events` collection. A projection never emits an invalid view: every
  `ok: true` view satisfies its target contract's invariants.
- Callers distinguish **exact**, **partial**, **inferred**, and
  **unavailable** mappings from the report. `partial` means a field was
  mapped with documented loss; `inferred` means the projection derived a
  value that was not directly present (for example a deterministically
  synthesized legacy identifier reported as `inferred` and never presented
  as canonical evidence); `unavailable` means the target field cannot be
  populated and the mapping is explicit.
- The `EvidenceToAgentRun` projection MAY be implemented as a direct function
  or as an explicit composition of `EvidenceToLegacyTrace` followed by
  `LegacyTraceToAgentRun`. Composition failure behavior is deterministic:
  - if `EvidenceToLegacyTrace` returns `ok: false`, the composed
    `EvidenceToAgentRun` MUST return `ok: false` with the first stage's
    report and issues, and MUST NOT invoke `LegacyTraceToAgentRun`;
  - if `EvidenceToLegacyTrace` succeeds but `LegacyTraceToAgentRun`
    returns `ok: false`, the composed `EvidenceToAgentRun` MUST return
    `ok: false` with the concatenated mappings from the first stage and
    the second stage's report and issues;
  - a successful composition concatenates mappings from both stages in
    stage order, each attributed with its `stage` field.
  A direct `EvidenceToAgentRun` implementation MUST produce a report that
  is semantically equivalent to this composed report (including
  stage-attributed mappings and issues) for all representable `AgentRun`
  fields.

### 6.3 Loss, missing, and unavailable values

- **Canonical → legacy `Trace`:** canonical `seq`, `observationRole`, and
  `evidenceStatus` have no exact legacy equivalent in all cases; the v0.x
  `ContentPhase` is a documented approximation of observation roles (§11.2 of
  Spec 013) and every such conversion is reported as `partial`. Canonical
  event kinds map to `TraceEventType` vocabulary with a documented mapping
  table; kinds with no legacy equivalent are reported `unavailable` and are
  either dropped from the view (with a report entry) or represented as a
  control/metadata event — never mapped to the wrong legacy kind.
- **Legacy `Trace` → `AgentRun`:** this is the documented legacy conversion
  required by Spec 013 §11.2. The projection applies the same `ContentPhase`
  mapping and loss metadata rules; it operates on the legacy `Trace` view,
  not on canonical evidence directly.
- **Canonical → `AgentRun`:** token values are only present when a
  measurement exists; until the measurement layer lands, token fields are
  `unavailable`, never invented from text length. Smells/recommendations are
  interpretations and MUST NOT appear in a projection as evidence. If
  implemented as a composition of canonical→legacy Trace then legacy
  Trace→AgentRun, the report MUST reflect the composed loss metadata (see
  §6.5).
- Projections never fabricate evidence and never convert `unknown`/`missing`
  into content.

### 6.4 Round-trip expectations and known non-equivalences

- No byte-for-byte or full semantic round-trip equivalence is claimed:
  canonical evidence → legacy `Trace` → legacy `AgentRun` is NOT identity,
  and legacy `Trace` → `AgentRun` is NOT identity. The projections are
  one-way compatibility views, not invertible bijections.
- Documented non-equivalences include: `seq` (canonical-only), the full
  canonical event-kind vocabulary (legacy has a smaller, differently named
  set), `evidenceStatus` vs. legacy excerpt semantics, `contentHash` and
  `nativeContentHash` (legacy has no hash contract), completeness records
  (legacy has none), and per-field evidence status on usage (legacy usage is
  a plain number).
- Where loss is unavoidable, the projection MUST carry explicit loss metadata
  (the report's `partial`/`unavailable` entries), and callers MUST NOT
  present a projected view as authoritative evidence.

### 6.5 Determinism, versioning, and report composition

- Projection functions are pure: identical input records and identical
  projection version produce identical views and identical reports. No
  randomness, no wall-clock reads, no environment dependence.
- Each projection function carries its own projection version
  (`report.projectionVersion`), and the output carries the schema version it
  was produced from (model-versioning: "Projection output carries its own
  projection version and the schema version it was produced from").
- **Report composition for `EvidenceToAgentRun`:** when `EvidenceToAgentRun`
  is implemented as a composition of `EvidenceToLegacyTrace` followed by
  `LegacyTraceToAgentRun`, the composed `ProjectionReport` MUST be
  constructed by concatenating the `mappings` arrays from both stages in
  order (canonical→legacy Trace mappings first with `stage: "evidence_to_legacy_trace"`,
  then legacy Trace→AgentRun mappings with `stage: "legacy_trace_to_agent_run"`).
  The composed report's `projectionVersion` records the
  `EvidenceToAgentRun` projection version; its `sourceSchemaVersion` records
  the `EvidenceRecord` schema version. Any `issues` from a failed second stage
  are included with their `stage` field. A direct `EvidenceToAgentRun`
  implementation MUST produce a report that is semantically equivalent to
  this composed report (including stage-attributed mappings and issues) for
  all representable `AgentRun` fields.
- Projections create **ephemeral views by default**: they are computed on
  demand and are not stored records. Persisting a projection (for caching,
  export, or redacted export) is a later storage/export concern and MUST
  record provenance linking it to its source records, projection version,
  and policy context — never authoritative evidence.

## 7. Deterministic ordering and identity decisions

For implementers, the decisions of §3–§4 are normative and summarized here:

1. `seq` is the only ordering key; contiguous from 0; assigned by the one
   authoritative sequencing surface at observation time; gaps mark
   incomplete traces (§4.1).
2. Ties between wall-clock timestamps resolve by `seq`, never by timestamp
   (§4.2).
3. Monotonic `durationMs` requires a declared clock basis; no basis, no
   monotonic claim (§4.3).
4. Exact replay groups (semantically equal `projectCanonicalEvent` results,
   including identical `eventId` and `seq`) collapse to one retained event
   without selecting a raw-observation representative; same-ID/same-seq
   projected-content conflicts are rejected; same-ID/different-seq groups
   retain the lowest sequence position and record every identity at every
   discarded position; different-ID/same-seq collisions are then rejected
   among remaining candidates; unoccupied discarded positions are gaps;
   retained events are never renumbered (§4.4).
5. Hash selection comes from the artifact's own fields; scope is the retained
   representation (§4.5).
6. IDs are opaque, capture-time, immutable, non-content-derived, and never
   ordering-significant (§3.2).
7. Object-property order, generated ids, and wall-clock timestamps alone
   never determine event or projection order (§4.6).
8. Absence of a trustworthy monotonic clock means no monotonic duration claim
   — never a fabricated duration (§4.3).
9. ID generation is the caller's/capture surface's responsibility: the
   evidence core accepts caller-supplied opaque ids and validates syntax,
   uniqueness, and reference integrity; no generation algorithm is defined
   by this spec (§3.2).
10. Trace/span status is a defined vocabulary — `completed` | `failed` |
    `cancelled` | `unknown` — describing observed lifecycle state, never a
    quality judgment (§4.7).

## 8. Additive implementation sequence

Each slice is independently reviewable, testable, and mergeable; none
requires a flag-day migration, and none begins storage, capture, collector,
adapter, or ingress migration. Spec 014 implementation ends with the
provider-neutral evidence package, deterministic validators/serialization and
fixtures, the compatibility projections beside the legacy model, and
projection parity and loss verification — nothing more.

1. **Evidence package foundation.** Create `packages/evidence` with the §2
   types, the §3 discriminants/versions, the §5 validators and serialization,
   and the §4 ordering/hash helpers. Add the `@signalglass/evidence` workspace
   alias to `vitest.config.ts`. No other package changes.
2. **Deterministic fixtures and negative controls.** Extract the nine
   normative serialized examples from `docs/evidence-model.md` into JSON
   fixtures under `packages/evidence/src/fixtures/`; add negative controls
   (status/fidelity matrix rejections, media-type boundary cases, hash-format
   cases, seq/duplicate/gap cases, version-compatibility and
   unknown-discriminant cases) mirroring the self-tests in
   `scripts/validate-evidence-examples.mjs`;
   pin the retained-byte Base64 serialization contract (§5.7) with
   round-trip fixtures (canonical acceptance including zero-padding
   encodings; omitted/superfluous/malformed padding and URL-safe and
   whitespace rejection; hashes over decoded bytes) and the
   version-compatibility cases of §5.3 (compatible minor/patch accepted;
   unknown MAJOR refused).
3. **Compatibility projections beside legacy types.** Add
   `packages/core/src/evidenceProjections/` (canonical → legacy trace,
   legacy trace → `AgentRun` view, canonical → `AgentRun` view as composition
   or direct convenience projection) with projection reports and explicit
   loss metadata; add `@signalglass/core`'s workspace dependency on
   `@signalglass/evidence`. Legacy modules are untouched.
4. **Projection parity and loss verification.** Run the existing analyzer
   and report tests against projected views; verify deterministic outputs;
   explicitly document projection loss and backfill mapping cases; confirm
   `scripts/validate-evidence-examples.mjs` self-tests still pass unchanged.
5. **Later specifications** (not this spec): persistence and migration;
   collector/adapter ingress onto evidence; native byte capture; streaming
   capture; MCP/tool capture and instrumentation; Graphify provenance;
   deterministic measurements; dashboard migration; privacy, retention, and
   redaction workflows.

**Scope boundary.** None of the slices converts collectors, adapters, ingress
paths, provider requests or responses, persistence, or capture pipelines to
emit canonical evidence; those conversions belong to later specifications
(slice 5). The only canonical-record construction during Spec 014
implementation is **test construction** — fixtures and projection-test inputs
built in memory inside the package's and projection modules' test suites
(slices 2 and 4) — explicitly not production ingress adoption. No runtime
production caller constructs canonical evidence records in this increment.

Later concerns that require separate specifications include, explicitly:
storage/migration (schema, indices, tombstones), collector/adapter ingress
onto evidence, native byte capture, streaming capture, MCP/tool capture and
instrumentation, Graphify provenance, deterministic measurements, dashboard
migration, and privacy/retention/redaction workflows.

## 9. Testing and conformance

### 9.1 Test inventory

Future implementation tests MUST cover, using Vitest and fixed fixtures:

- documentation/contract checks that the public parser and serializer names
  are uniquely `parseEvidenceRecord` and `serializeEvidenceRecord`, with the
  single success/failure contract `EvidenceRecordParseResult`;
- `EvidenceRecord` as the only authoritative serialized evidence record,
  `EvidenceTrace` as its deterministic canonical view, and completeness in
  exactly one serialized location (`EvidenceRecord.completeness`);
- documentation consistency: Interaction and Trace have distinct
  classifications; Spec 013 uses its conceptual Trace/canonical trace view and
  contains no undefined `EvidenceTrace` reference; the human-facing overview
  covers all four collision cases;
- valid record construction for every §2.2 record type;
- malformed and incomplete records (missing required fields, invalid enums,
  non-JSON-safe values);
- every discriminated-union variant (all event kinds, span kinds, locator
  types, fidelity values);
- version compatibility: compatible additive minor/patch revisions within a
  supported MAJOR accepted; unknown or breaking MAJOR versions and unknown
  discriminants refused with structured errors; unknown additive fields
  preserved on round trip;
- identifier and reference integrity (`interactionId === traceId`,
  cross-reference resolution, uniqueness), plus required unique immutable
  `observationId` values on every raw observation; missing or duplicate
  observation identities are rejected deterministically;
- wall-clock and monotonic timing (ties resolved by `seq`, clock-basis
  declaration, no fabricated durations);
- deterministic event ordering (contiguous `seq`, duplicate and gap
  handling, completeness consistency);
- lifecycle targeting: `error` and `cancelled` events carry `lifecycleTarget`
  and `lifecycleEffect`; validators enforce target/effect semantics;
  `lifecycleTarget: "span"` requires matching `spanId`; `lifecycleTarget:
  "trace"` requires `spanId: null`; `lifecycleEffect: "none"` does not
  set status; child-span failure does not auto-fail trace; terminal
  declaration must be final applicable event; later unrelated spans do not
  invalidate;
- documentation-example lifecycle conformance: lifecycle events carry valid
  targets, effects, declaring parties, and observation roles; the recoverable
  timeout does not change lifecycle status; the cancellation request with
  target `none` remains non-terminal and coherent with later `span_end`,
  `interaction_end`, and completed statuses;
- canonical event projection: replay equality excludes `observationId`,
  `rawCapturedAt`, and all capture-only container metadata while retaining
  every canonical event field and applicable unknown additive event field;
  projection disagreement with serialized duplicate analysis is rejected
  deterministically; any optional canonical-content digest matches the
  versioned RFC 8785/JCS UTF-8 projection contract and is never used as an
  ordering or winner-selection key;
- duplicate handling: two-copy and three-or-more-copy exact replay groups have
  no representative and create no gap; same-ID same-seq projected-content
  conflict (reject trace as invalid), different-ID same-seq collision (reject
  trace as invalid), and same-ID different-seq relationships support several
  positions, replay groups at retained and discarded positions, and a complete
  observation-identity set plus gap status for every discarded position;
  processing order (§4.4) is enforced; retained events are never renumbered;
  permutation of conflicting input records produces the same semantic result
  and normalized validation issues;
- incomplete lifecycle records: `unknown` traces and spans without
  `finishedAt`, `endSeq`, or terminal events parse and validate; `completed`
  spans carry `endSeq` matching the observed `span_end` and require that
  event; `completed` traces require `interaction_end`; `failed`/`cancelled`
  spans carry `finishedAt` (no `endSeq`) matching their terminal event and
  never fabricate `span_end`; `failed`/`cancelled` traces carry `finishedAt`
  matching their terminal event and never fabricate `interaction_end`;
  present `finishedAt`/`endSeq` match the cited terminal event; wall-clock
  absence never upgrades `unknown`; completeness reports unobserved
  termination;
- completeness validation: correctly documented incomplete traces remain
  parseable; contradictory completeness metadata (incorrect status counts,
  nonexistent/omitted gaps, contradictory status) MUST be rejected;
  negative tests for undocumented gaps, claimed nonexistent gaps, incorrect
  status counts, omitted duplicate/gap info, contradictory status;
- authoritative record serialization: every raw exact-replay copy preserved in `rawObservations`;
- exact replay parse–serialize–parse semantic equality of full `EvidenceRecord`;
- exact-replay authoritative round trips preserving every observation and its
  stable identity;
- same-ID/different-sequence conflict: preserving every observation and
  identity at every involved position while retaining the lowest-`seq`
  canonical event and stable per-position gap provenance;
- duplicate provenance referencing only `observationId` values, never raw
  array positions;
- duplicate or missing observation identities, fabricated provenance
  identities, and omitted participating identities being rejected;
- deterministic serialization of set-like observation identity collections by
  unsigned UTF-8 byte order and discarded positions by ascending `seq`, without
  creating evidence precedence;
- serialized duplicate provenance inconsistent with raw observations being rejected;
- serialized `trace` contradicting deterministic normalization being rejected;
- serialized completeness inconsistent with derived completeness being rejected;
- fabricated duplicate provenance being rejected when the available evidence boundary permits that verification;
- a normalized export without raw duplicate copies declaring omitted evidence,
  its reduced verification boundary, and reported-derived status without
  claiming authoritative duplicate provenance or independent revalidation;
- ambiguous collision cases (same-ID/same-seq content conflict, different-ID/same-seq collision) remaining invalid;
- permutations of the same identified raw observations producing semantically
  equivalent trace, duplicate relationships, gaps, completeness, and
  normalized issues, with unordered identifier collections canonicalized only
  for comparison;
- raw array order never affecting collision resolution, while authoritative
  parse–serialize–parse preserves that serialized order;
- opaque observation identities never serving as ordering or winner-selection
  keys;
- JSON serialization and parsing round trips, including unknown-field
  preservation at value level (lexical bytes not claimed) and retained-byte
  encoding: canonical RFC 4648 §4 Base64 accepted including zero-padding
  encodings; omitted required padding, superfluous or malformed padding,
  URL-safe characters, and whitespace rejected; hashes computed over
  decoded bytes, never the encoded text;
- retained/native content-hash selection (`contentHash` vs
  `nativeContentHash`, hash-path selection from artifact fields);
- valid and invalid RFC 6838 content types (including
  `application/vnd.example+json` and parameter rejection);
- completeness and unavailable-value handling (missing/unknown/not_applicable
  never carry content, fidelity, or hashes);
- canonical → legacy `Trace` projection and its report;
- legacy `Trace` → `AgentRun` projection and its report (the documented
  legacy conversion required by Spec 013 §11.2);
- canonical → `AgentRun` projection (token fields `unavailable` until the
  measurement layer exists); equivalence with composed canonical→legacy Trace
  then legacy Trace→`AgentRun` verified;
- projection results: successful exact, successful lossy/partial (report
  entries), and explicit failure (`ok: false`) for absent, non-array, or
  invalid legacy event collections; an empty legacy `events` array in the
  `LegacyTraceToAgentRun` projection yields an empty `AgentRun` view;
  no projection returns an invalid canonical view and none throws on
  expected invalid or lossy input;
- projection report composition: composed `EvidenceToAgentRun` report
  concatenates mappings from both stages with correct ordering;
- explicitly lossy projections (report entries for `partial`/`unavailable`);
- projection determinism (same input + version → same view and report);
- no fabrication of unavailable evidence (projections never invent content or
  convert unknown to certainty);
- browser-safe and Node-safe package boundaries (no Node-only imports
  reachable from the package's public surface).

### 9.2 Fixtures and determinism

Tests MUST use fixed fixtures and injected, controlled inputs. They MUST NOT
require live providers, network access, current prices, nondeterministic
clocks, or random identifiers — clocks are injected and ids are
caller-supplied so tests are deterministic. The nine normative examples in
`docs/evidence-model.md` are the initial fixture corpus; negative controls
mirror the existing validator self-tests (§8 slice 2).

### 9.3 Demonstrating completion

Spec 014's implementation is demonstrated by its own acceptance criteria
(§13) and tests. Passing those demonstrates the first additive slice — not
Spec 013's broader contract. Spec 013's §14 acceptance criteria remain
unchecked and are outside Spec 014's completion scope; a later
implementation spec that completes the full evidence-model contract (for
example the storage or capture-spec) will check them. Spec 014 completion
MUST NOT be used to mark any Spec 013 criterion complete, and Spec 014 MUST
NOT be marked Implemented until its own criteria pass.

## 10. Privacy and security boundary

Narrow and explicit:

- Evidence primitives can represent sensitive-content classification or
  references **only when Spec 013 defines them** — through `evidenceStatus`
  (`redacted`/`truncated`), redaction/truncation declarations, and boundary
  metadata. Spec 014 invents no new `sensitive` flag or classification
  scheme.
- Validation errors MUST NOT unnecessarily echo secrets or entire captured
  payloads: `ValidationIssue.message` carries field paths and stable codes,
  never payload content, provider-native bodies, authorization material, or
  full excerpts.
- Redacted and truncated artifacts cannot claim fidelity to discarded bytes:
  `contentFidelity` describes the retained representation only, and the
  validator enforces that redacted/truncated hashes cover only what remains
  (Spec 013 §6.1).
- Administrative deletion remains possible even though evidence is
  otherwise append-only: deletion is recorded as a tombstone (a
  non-sensitive administrative record with reason and scope, retained
  outside the deleted trace where policy and law permit), never as a silent
  rewrite of authoritative evidence (Spec 013 §9.2,
  `docs/capture-profiles.md`).
- The core type package does **not** implement access control, encryption,
  retention, or redaction policy. Those are policy engines for later
  storage and export specifications; the evidence package only represents
  their effects (`redacted`/`truncated` statuses and declarations) and MUST
  NOT contain policy evaluation logic.
- Later storage and export specifications MUST define the actual controls:
  encryption at rest, retention and purging, access control, export
  redaction, and administrative-deletion workflows.

## 11. Alternatives and rejected approaches

- **Replacing legacy types immediately** — rejected: breaks ingress,
  storage, reports, CLI, and the dashboard in one step and contradicts the
  foundation's incremental-migration principle. Spec 014 is additive.
- **Beginning with a database migration** — rejected: a storage migration
  before the canonical records and projections exist would commit the
  runtime to an unvalidated shape. Storage is a later spec (§8.2).
- **Placing evidence primitives inside a provider adapter** — rejected:
  would make the canonical model provider-dependent and violate the
  provider-neutrality rule (Spec 013 §3.2).
- **Flattening provider-native content into one generic prompt string** —
  rejected: destroys fidelity and provenance; envelopes preserve
  `providerNative` at a declared fidelity (§2.2.4).
- **Mixing measurements or interpretations into evidence records** — rejected:
  violates the evidence/measurement/interpretation separation (foundation
  principle 3); measurement and interpretation records are deferred (§2.3).
- **Using TypeScript types without runtime validation** — rejected: compile
  types are no guarantee against untrusted input; the §5 validation contract
  is mandatory.
- **Silently accepting invalid data** — rejected: unknown discriminants and
  unknown or breaking MAJOR versions are refused with structured errors;
  compatible additive revisions are accepted per §5.3; invalid evidence is
  never defaulted or coerced (§5.3–§5.5).
- **Making projections nondeterministic** — rejected: projections are pure,
  versioned functions with explicit loss reports (§6.5).
- **Treating Graphify or MCP concepts as core evidence dependencies** —
  rejected: Graphify/MCP activity appears only through the canonical
  provider-neutral event kinds and capture surfaces (Spec 013 §3.1, §5);
  defining those record kinds is type-system vocabulary, not instrumentation
  (§2.2), and instrumentation belongs to later specs.
- **Introducing optimization behavior into the observation path** — rejected:
  the evidence core is observability-only; optimization is explicit
  experimental condition or optional analysis, never core (foundation
  principles 1 and 6).

## 12. Open questions and decision discipline

Decisions necessary for the first slice that the repository can already
settle are settled in this spec (§1–§8). Three questions previously reported
as open are now **resolved in this spec** and removed from this section:
identifier generation (§3.2 — caller-supplied ids; generation is outside the
evidence core), retained-byte serialization (§5.7 — RFC 4648 §4 Base64
with canonical padding), trace/span status vocabulary (§4.7 — `completed` |
`failed` | `cancelled` | `unknown`). No implementation decision essential
to the first slice remains delegated to implementers or fixture authors.

There are no broad "TBD" entries and no open questions remaining for the
first slice; every decision needed to implement it is specified above.

## 13. Acceptance criteria

- [ ] Spec 014 maps each initial primitive to its Spec 013 definition
  (§2.2), with no competing names for Spec 013 concepts.
- [ ] The package/module boundary is explicit: `packages/evidence`
  (`@signalglass/evidence`) with projections in `@signalglass/core`
  (`packages/core/src/evidenceProjections/`) (§1.1). Canonical evidence
  types, validators, serialization, and helpers are imported directly from
  `@signalglass/evidence`; `@signalglass/core` does not re-export its
  dependency's API.
- [ ] Public exports and dependency rules are defined: zero runtime
  dependencies; no provider/storage/analysis imports; projections depend on
  the evidence package, never the reverse (§1.2–§1.4).
- [ ] The TypeScript type contract and the runtime-validation contract agree,
  and both are consistent with `scripts/validate-evidence-examples.mjs`
  (§5.1).
- [ ] The compatible-version policy is explicit and consistent with Spec
  013 §10: compatible additive minor/patch revisions within a supported
  MAJOR are accepted; unknown or breaking MAJOR versions and unknown
  discriminants are refused with structured errors; unknown additive
  fields are preserved on round trips at equivalent JSON values (never
  claimed as lexical byte preservation); no silent coercion (§5.3–§5.5).
- [ ] Compatibility projections are specified in the required directions:
  canonical evidence → legacy `Trace`/`TraceEvent` view, legacy
  `Trace`/`TraceEvent` view → legacy `AgentRun` view, and canonical evidence
  → legacy `AgentRun` view (as composition or direct convenience projection
  with equivalent loss metadata) (§6).
- [ ] Projection loss and unavailable values are explicit through a
  projection report (`exact`/`partial`/`inferred`/`unavailable`),
  projections never fabricate evidence, and projection results distinguish
  successful exact, successful lossy/partial, and explicit failure
  (`ok: false`) outcomes — a projection never returns an invalid canonical
  view and never throws on expected invalid or lossy input (§6.2).
- [ ] Deterministic ordering and identity behavior is defined: `seq` is the
  only ordering key; ids are opaque, capture-time, and never
  ordering-significant; ties resolve by `seq`; monotonic durations declare a
  clock basis (§3–§4, §7).
- [ ] Initial and deferred primitive inventories are distinguishable; the
  evidence core contains no measurements, interpretations, cost, smells,
  recommendations, or optimization logic (§2.2–§2.3).
- [ ] Implementation slices are independently testable and mergeable, with
  no flag-day migration and no storage, capture, collector, adapter, or
  ingress migration in any slice; Spec 014 implementation ends at the
  package, validators/fixtures, projections, and parity verification (§8).
- [ ] Evidence remains separate from measurements and interpretations
  (§2.1); derived and administrative records never merge into payload
  status.
- [ ] No storage, collector, adapter, ingress, Graphify, MCP/tool
  capture-and-instrumentation, or dashboard implementation is included in
  this spec's scope or planned slices; provider-neutral MCP/tool record
  kinds are type-system vocabulary only (§2.2, §8).
- [ ] Documentation and index references are consistent: the spec index
  lists Spec 014 as Accepted (ready to implement, not yet implemented),
  and the roadmap and glossary reference it without claiming
  implementation exists.
- [ ] The retained-byte serialization contract is pinned: RFC 4648 §4
  standard-alphabet Base64 with the canonical padding (zero, one, or two
  `=` characters exactly as the encoded length requires), canonical
  emission, noncanonical forms rejected (omitted/superfluous/malformed
  padding, URL-safe characters, whitespace), hashes over decoded bytes
  (§5.7).
- [ ] Identifier responsibility is explicit: ids are caller-supplied opaque
  values; generation is outside the evidence core; validators enforce
  syntax, uniqueness, and reference integrity; projections preserve valid
  legacy ids and report synthesized ids as `inferred` (§3.2).
- [ ] The trace/span status vocabulary is defined and validated as
  evidence-scoped lifecycle state — `completed` | `failed` | `cancelled` |
  `unknown` — never a quality judgment; absence of an observed error is not
  success; incomplete records are representable: `unknown` traces/spans
  carry no `finishedAt`/`endSeq`/terminal event; `completed` spans carry
  `endSeq` matching the observed `span_end` and require that event;
  `completed` traces require `interaction_end`; `failed`/`cancelled` spans
  carry `finishedAt` (no `endSeq`) matching their terminal event and never
  fabricate `span_end`; `failed`/`cancelled` traces carry `finishedAt`
  matching their terminal event and never fabricate `interaction_end`;
  present `finishedAt`/`endSeq` are supported by observed evidence (§2.2,
  §4.7, §5.4).
- [ ] Lifecycle targeting is structurally represented: `error` and
  `cancelled` events carry `lifecycleTarget` ∈ {`trace`, `span`, `none`}
  and `lifecycleEffect` ∈ {`fail`, `cancel`, `none`}; validators enforce
  target/effect semantics — `lifecycleTarget: "span"` requires matching
  `spanId`; `lifecycleTarget: "trace"` requires `spanId: null`;
  `lifecycleEffect: "none"` does not set status; child-span failure does
  not auto-fail trace; terminal declaration must be final applicable event;
  timestamps never determine targeting (§2.2.3, §4.7, §5.4).
- [ ] The normative evidence-model examples validate lifecycle target/effect,
  declaring-party, and observation-role requirements: the recoverable timeout
  changes no lifecycle status, and the target-`none` cancellation request is
  non-terminal and coherent with the later completed span and trace (§2.2.3,
  §4.7, §9.1; `docs/evidence-model.md` example 8).
- [ ] Completeness is classified per Spec 013 as a derived record;
  `deriveCompleteness(trace, analysis, boundary)` is pure, deterministic,
  and free of measurement, cost, interpretation, or optimization logic
  (§2.1, §2.2.9).
- [ ] `EvidenceRecord` is the only authoritative serialized evidence record;
  its `rawObservations` are authoritative captured evidence, while
  `EvidenceTrace`, structural analysis, and completeness are deterministic
  derivations. `EvidenceRecord.completeness` is the only serialized
  completeness location, and disagreement with recomputation is rejected
  without repair (§2.2.1, §2.2.9, §5.2, §5.7–§5.8).
- [ ] Every raw observation has a unique immutable opaque `observationId`;
  duplicate provenance uses only stable observation identities; array order,
  timestamps, arrival order, identifiers, and digests never affect collision
  resolution. Permutations of the same identified observations yield
  semantically equivalent normalized trace, analysis, gaps, completeness, and
  issues, while authoritative round trips preserve the raw serialized order
  and every identity (§4.4, §5.2, §5.7, §9.1).
- [ ] `projectCanonicalEvent` is the sole replay/content-conflict comparison:
  it excludes observation-container provenance including `observationId` and
  `rawCapturedAt`, retains every canonical and applicable unknown additive
  event field, and governs parser verification and any versioned JCS/UTF-8
  SHA-256 canonical-content digest (§5.2, §9.1).
- [ ] Duplicate provenance is a discriminated union: exact replay groups have
  no representative and contain every identity; same-ID/different-sequence
  groups preserve every identity at the lowest-`seq` retained position and at
  each uniquely represented ascending discarded position, including its
  independent-occupancy/gap state. Set-like identity collections have
  deterministic serialization without evidence precedence (§4.4, §5.2,
  §5.7, §9.1).
- [ ] Normalized exports that omit `rawObservations` declare omitted evidence,
  their reduced verification boundary, and duplicate analysis as reported
  derived metadata; they do not claim authoritative duplicate provenance or
  independent revalidation without the authoritative `EvidenceRecord` (§5.7–
  §5.8).
- [ ] Structural analysis and normalization: `parseEvidenceRecord` returns
  `EvidenceRecordParseResult` containing the full `EvidenceRecord` with
  `rawObservations`, retained canonical trace, structural analysis
  (duplicate observations, sequence gaps, validation issues), and derived
  completeness; `serializeEvidenceRecord` accepts the full `EvidenceRecord`;
  exact replay provenance survives parse–serialize–parse; semantic
  round-trip equality for `rawObservations`, retained events, structural
  analysis, gaps, capture boundary, and completeness (§5.2, §5.7).
- [ ] Duplicate handling and sequence gaps follow the deterministic
  processing order (§4.4): exact replay (no gap), same-ID same-seq content
  conflict (reject trace as invalid), different-ID same-seq collision (reject
  trace as invalid), same-ID different-seq conflict (each unoccupied
  discarded position is a gap); retained events are never
  renumbered; processing order (validate raw observations/ids → project
  canonical events → group exact replays → reject same-ID/same-seq conflicts
  → resolve same-ID/different-seq groups → reject different-ID/same-seq
  collisions among remaining candidates → validate retained uniqueness →
  derive gaps → derive completeness) is normative; completeness must not
  convert an ambiguous or structurally invalid collision into a valid trace.
- [ ] Completeness metadata contradiction is rejected: an `EvidenceRecord`
  whose serialized `completeness` disagrees with the deterministic derivation
  from retained evidence, structural analysis, and capture boundary (incorrect
  status counts, claimed nonexistent gaps, omitted duplicate/gap info,
  contradictory status) is invalid and MUST be rejected; a correctly
  documented incomplete trace remains parseable; negative tests for
  undocumented gaps, nonexistent gaps, incorrect counts, omitted info, and
  contradictory status are required (§5.8).

## Tests

Spec 014 is documentation-only; no production code changes are made by this
spec. The test plan in §9 is the contract for the future implementation
PRs, mapped to the acceptance criteria above (valid construction, malformed
records, all union variants, version-compatibility acceptance and
unknown-discriminant/breaking-version refusal, reference integrity, timing,
deterministic ordering, lifecycle targeting (`lifecycleTarget`/`lifecycleEffect`),
duplicate handling (exact replay, same-ID same-seq content conflict,
  different-ID same-seq collision, same-ID different-seq),
completeness contradiction rejection, incomplete-lifecycle representation,
authoritative record round-trip (exact replay provenance, completeness
equivalence, same-ID/different-seq gap provenance),
normalized export boundary declaration, ambiguous collision rejection,
serialization and retained-byte Base64 canonicality, hash selection, media
types, completeness, canonical evidence → legacy `Trace`/`TraceEvent`, legacy
`Trace`/`TraceEvent` → legacy `AgentRun`, canonical evidence → legacy
`AgentRun`, projection report composition, projection success/failure
results, explicit loss, projection determinism, no fabrication, and
package-boundary checks).

## References

- [`specs/013-evidence-model.md`](013-evidence-model.md) — the accepted
  canonical evidence contract this spec implements.
- [`specs/002-core-domain.md`](002-core-domain.md), [`specs/003-offline-analysis.md`](003-offline-analysis.md),
  [`specs/004-trace-model.md`](004-trace-model.md) — superseded legacy
  contracts that the projections target.
- [`docs/evidence-model.md`](../docs/evidence-model.md) — human-facing
  reference and the nine normative serialized examples used as fixtures.
- [`docs/architectural-foundation.md`](../docs/architectural-foundation.md) —
  incremental-migration and evidence/measurement/interpretation separation.
- [`docs/model-versioning.md`](../docs/model-versioning.md) — additive schema
  evolution and projection-version rules.
- [`docs/capture-profiles.md`](../docs/capture-profiles.md) — collection
  policy surface and profile versioning rules.
- [`docs/glossary.md`](../docs/glossary.md) — terminology.
- [`docs/privacy.md`](../docs/privacy.md) — capture/privacy posture.
- [`specs/001-workspace.md`](001-workspace.md) — workspace and package
  layout conventions the new package follows.
- `scripts/validate-evidence-examples.mjs` — the existing dependency-free
  semantic validator whose rules the package validators port.
