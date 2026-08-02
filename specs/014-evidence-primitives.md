# Spec 014: Evidence primitives

## Status

Draft — proposed but not ready for implementation. This spec defines the
first **additive** TypeScript implementation increment of the accepted
[Spec 013 — Evidence model](013-evidence-model.md) contract. Acceptance of
this spec would authorize implementation; it would not mean that any evidence
primitives already exist. No runtime code is written by this spec and no
acceptance criterion below is satisfied yet (all unchecked).

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
- **Acceptance ≠ implementation.** Marking this spec Accepted would
  authorize implementation of the slices in §8; it would not mean the
  primitives exist. Spec 013's §14 acceptance criteria stay unchecked
  regardless of what Spec 014 achieves.

## Scope

- The proposed package/module boundary for canonical evidence primitives and
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

## 1. Proposed implementation surface

### 1.1 Package boundary

The narrowest appropriate boundary is a new workspace package
**`packages/evidence`** exporting **`@signalglass/evidence`**, added beside
the existing packages exactly as Spec 001 structures them (own `package.json`,
`tsconfig.json`, `src/index.ts`, exports pointing at `./dist/index.js` and
`./dist/index.d.ts`; `vitest.config.ts` gains a matching workspace alias in
the implementation PR). This matches the architectural foundation's
incremental-migration principle: "new evidence primitives are added beside
the current v0.x models."

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
  `@signalglass/evidence` as a dependency of `@signalglass/core` gives every
  consumer access without changing their imports.

Compatibility projections (canonical ↔ legacy) live in `@signalglass/core`
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
- `serializeEvidence` / `parseEvidenceTrace` JSON-safe round-trip functions
  (§5.7);
- deterministic helpers that are pure and dependency-free: sequence and
  completeness derivation, hash-path selection and RFC 8785 (JCS)
  canonicalization for `contentHash`, media-type and hash-format checks
  (§4–§5).

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
013 §4.3 requires each trace to carry a derived completeness record and
validators must verify serialized completeness. Derived and administrative
types are otherwise referenced by id or field where Spec 013 requires, but are
not implemented in the first slice.

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

#### 2.2.1 Trace envelope (`EvidenceTrace`)

- **Category:** evidence (top-level container).
- **Responsibility:** the authoritative serialized evidence record of one
  interaction (Spec 013 §1.2): one interaction, one trace.
- **Fields:** `interactionId`, `traceId` (equal; invariant), `evidenceSchemaVersion`,
  `captureProfile: { name, version }`, `captureSurface`, `observationBoundary`,
  `startedAt`, `finishedAt?` (present iff a terminal state was observed, §4.7),
  `status`, `conditions?`, `spans[]`, `events[]`,
  `completeness?` (derived; MAY be serialized, MUST be consistent when present).
- **Discriminant/id rules:** `traceId` is the reference identifier; nested
  records reference the trace by `traceId` only. `interactionId === traceId`
  MUST hold (validated). ULID-style ids recommended (Spec 013 §2.1).
- **Append-only:** the trace and its records are immutable once captured;
  nothing is mutated in place. Corrections are new records or completeness
  notes, never in-place edits.
- **Observation boundary:** `captureSurface` + `observationBoundary` declare
  the trace-level boundary; records inherit unless they override.
- **Serialization:** JSON object; both `interactionId` and `traceId`
  serialized at top level (never inferred from each other).
- **Validation:** identity equality, version presence, boundary vocabulary,
  status vocabulary and lifecycle presence rules (§4.7), seq/span/event
  cross-checks, completeness consistency (§4, §5).
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
  `startSeq`, `endSeq?` (present iff a terminal state was observed, §4.7),
  `startedAt`, `finishedAt?` (same rule as `endSeq`, §4.7), `durationMs?`,
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
  the `span_start` event's `seq`; `endSeq` present iff a terminal state was
  observed and equals the cited terminal event's `seq` (§4.7); `endSeq` ≥
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
    `context_provider`, `capture`}, observed error payload,
    `observationRole`;
  - `cancelled` — who/what requested cancellation, `observationRole`;
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
  error/cancelled carry roles; status/fidelity matrix rules (§5.4).
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
  `deriveCompleteness(trace)`; MAY be serialized on the trace (the docs'
  examples do), MUST be consistent with the trace when present.
- **Derivation contract (`deriveCompleteness`):** MUST be pure and
  deterministic; MUST operate only on explicit evidence and capture-boundary
  declarations; MUST NOT fabricate observations (it never invents missing
  events or statuses); MUST report unavailable or incomplete inputs (for
  example, a trace whose boundary cannot be determined yields an incomplete
  completeness record, not an invented boundary statement); and MUST NOT
  calculate quality, cost, recommendations, smells, or optimization claims.
- **Validation:** counts match the events; gaps and duplicates match the seq
  analysis; a serialized completeness record that disagrees with its trace is
  rejected.
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
- `TraceStatus` / `SpanStatus` — an explicit Draft decision ratified with
  this spec (§4.7): `completed` | `failed` | `cancelled` | `unknown`,
  with the meanings and validator rules in §4.7. Status is evidence-scoped
  lifecycle state, never a quality judgment; absence of an observed error is
  not proof of success; `unknown` represents an unobservable terminal state.

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

- Duplicates: same `eventId` twice in one trace is a duplicate. Persistence
  MUST detect it and record a single event plus a completeness note; the
  first observed copy (lowest `seq`) wins; a conflicting later copy MUST be
  reported in the completeness record, never silently merged. Collapsing a
  duplicate does not create a gap.
- Drops: a `seq` gap proves an assigned sequence position is absent from
  retained evidence; the completeness record reports the gap and adjacent
  event ids. SignalGlass MUST NOT invent the missing event. An event that
  failed before assignment produces no gap and is disclosed through the
  boundary statement or an explicit `missing` record — never inferred from
  sequence position.

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

Status is an explicit Draft decision ratified with this spec; it describes
observed lifecycle state and is tightly scoped evidence/administrative state,
never a quality judgment.

- **Values.** `completed` — the capture surface observed a normal terminal
  lifecycle event (`interaction_end`/`span_end`) with no observed failure or
  cancellation claiming the record. It records that the lifecycle was
  observed to end normally; it is **not** proof of success of the underlying
  work: absence of an observed error is not evidence of success. `failed` —
  an `error` event was observed that declares the failure of the trace/span
  (with its declared actor and observation role, Spec 013 §3.3); the status
  records the observed failure, never provider-internal failure. `cancelled`
  — a `cancelled` event was observed for the trace/span (recording who/what
  requested cancellation, Spec 013 §3.3). `unknown` — the terminal state
  could not be observed (for example capture ended before the terminal event,
  or the boundary could not observe completion); `unknown` is an honest
  representation of unavailability and MUST NOT be defaulted to `completed`.
- **Terminal-state availability contract.** Finish fields are present exactly
  when a terminal state was observed — never fabricated. The internal type
  MAY represent the terminal state as this discriminated union, and the
  serialized record MUST follow the same presence rules:

```ts
type TraceTerminalState =
  | { status: "completed"; finishedAt: string }   // interaction_end observed
  | { status: "failed"; finishedAt: string }      // terminal error event observed
  | { status: "cancelled"; finishedAt: string }   // cancelled event observed
  | { status: "unknown" };                         // termination not observed

type SpanTerminalState =
  | { status: "completed"; endSeq: number; finishedAt: string }  // span_end observed
  | { status: "failed"; endSeq: number; finishedAt: string }     // terminal error observed
  | { status: "cancelled"; endSeq: number; finishedAt: string }  // cancelled observed
  | { status: "unknown" };                                        // termination not observed
```

  Presence rules: `finishedAt` (trace) is present iff the trace status is
  `completed`, `failed`, or `cancelled`, and is absent (not serialized, never
  `null`) when status is `unknown`; span `endSeq` and `finishedAt` follow the
  same rule. A present `finishedAt`/`endSeq` MUST be supported by observed
  evidence (§5.4): for `completed` it equals the `interaction_end`/`span_end`
  event's `capturedAt`/`seq`; for `failed` and `cancelled` it equals the
  terminal `error`/`cancelled` event's `capturedAt`/`seq`. No `null` sentinel
  is used for unobserved finish fields (Spec 013 §2.1 reserves `null` for
  structural absence of parentage/attachment, not for lifecycle fields).
- **Validation rules.** The status MUST be declared by the capture surface
  at capture and MUST be coherent with the observed lifecycle events (the
  validator checks this).
  - `completed` (trace/span) requires the observed normal terminal event
    (`interaction_end`/`span_end`) as the record's final observed event;
    validators MUST NOT accept `completed` without it.
  - `failed` requires an observed `error` event declaring the failure as the
    record's final observed event; `cancelled` requires an observed
    `cancelled` event as the final observed event. Validators MUST NOT
    fabricate a later normal end event (`interaction_end`/`span_end`) for a
    `failed` or `cancelled` record, and MUST NOT require one. Mid-lifecycle
    `error`/`cancelled` events do not by themselves set the status — the
    record's final observed event does (a tool error followed by
    `interaction_end` is a `completed` trace).
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

- `parseEvidenceTrace(input: unknown): ParseResult<EvidenceTrace>` — the
  primary entry point; validates the full trace (identity, seq, spans,
  events, envelopes, artifacts, completeness consistency).
- Per-record validators: `isEvidenceStatus`, `isObservationRole`, `isEventKind`,
  `isContentHash`, `isContentType`, and record-level guards
  (`isContextArtifact`, `isRequestEnvelope`, ...) for composability.
- Result type (hand-rolled; no library):

```ts
type ValidationIssue = {
  path: string;          // dotted path, e.g. "events[2].seq"
  code: string;          // stable machine code, e.g. "seq_duplicate"
  message: string;       // human-readable, MUST NOT echo payload values
};

type ParseResult<T> =
  | { ok: true; value: T; issues: [] }
  | { ok: false; issues: ValidationIssue[] };
```

- Validation functions never throw for malformed input; they return a
  `ParseResult`. Throwing is reserved for programming errors in the callers,
  not for invalid evidence.

### 5.3 Unknown fields, unknown discriminants, and newer versions

- **Unknown fields on known shapes:** preserved, not errors. Forward
  tolerance per Spec 013 §10: older readers MUST tolerate unknown additive
  fields in newer records without failing, and MUST preserve them on
  read-modify-write round trips. `parseEvidenceTrace` retains unknown fields
  (in an explicit passthrough slot on the internal record) and
  `serializeEvidence` re-emits them at their original structural paths with
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
  - returns **structured compatibility or validation errors** (the
    `ParseResult` of §5.2) whenever safe interpretation is impossible.
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
  span `startSeq`/`endSeq` consistent with span lifecycle events per §4.7
  (`startSeq` required and matched to `span_start`; `endSeq` present only
  when a terminal state was observed and equal to the cited terminal event's
  `seq`).
- **Lifecycle coherence:** status-driven presence rules (§4.7) — `completed`
  requires the observed `interaction_end`/`span_end` as the record's final
  observed event; `failed`/`cancelled` require their observed
  `error`/`cancelled` evidence as the final observed event and never
  fabricate a normal end event; `unknown` requires no terminal event; present
  `finishedAt`/`endSeq` equal the cited terminal event's `capturedAt`/`seq`;
  wall-clock absence never upgrades `unknown`.
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

- `serializeEvidence(record)` produces the JSON-safe form: plain objects,
  arrays, strings, numbers, booleans, and `null` for structural absence only.
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

### 5.8 Unavailable or incomplete evidence

- `missing`, `unknown`, and `not_applicable` payloads validate with their
  status and MAY carry a `MissingDeclaration` (`reportedBy` records which
  surface/boundary reported the absence); they carry no content, no fidelity,
  no content type, and no hash.
- A trace with a `seq` gap or a serialized completeness record that disagrees
  with its events is valid **only as an explicitly incomplete trace**: the
  completeness record MUST document the gap, and parsers MUST NOT repair or
  renumber. An incomplete trace is still parseable; consumers are told about
  the incompleteness through the completeness record, never through silence.
- Parsing never fabricates events, content, or values to fill gaps.

## 6. Compatibility projections

### 6.1 Directions and authority

Required directions (implemented in `@signalglass/core`'s
`evidenceProjections` modules, beside the legacy types):

1. **Canonical evidence → legacy `Trace`/`TraceEvent` view** — lets the
   dashboard, storage, and reports keep consuming the v0.x shape from
   canonical evidence.
2. **Canonical evidence → legacy `AgentRun` / offline-analysis view** — lets
   the existing offline analyzer and reports run over canonical evidence.
3. **Legacy `Trace`/`TraceEvent` → canonical evidence** — the **inverse
   projection required by Spec 013 §11.2**.

The authoritative direction is **canonical evidence**. Projections are
derived views; they never alter or overwrite authoritative evidence, and
redacted/missing/unknown evidence is never fabricated into false certainty
during projection.

Legacy `AgentRun` → canonical evidence (parsing legacy offline run files into
evidence) is **deferred** — the single open item in §12: Spec 013 §11.2
requires only the trace inverse; the offline-run direction is not needed for
the first implementation increment because no collector, adapter, or ingress
converts to canonical evidence in Spec 014's slices (§8), and legacy offline
run consumers are served by the evidence → `AgentRun` view. A later
collector/adapter-ingress specification will decide whether legacy offline run
files are parsed into evidence or remain legacy inputs. This deferral does
not weaken the required legacy `Trace` → canonical inverse projection (§6.3,
§6.6).

### 6.2 Projection function contracts

Stable conceptual function boundaries (types only, not implemented here):

```ts
type ProjectionReport = {
  projectionVersion: string;                 // version of this function
  sourceSchemaVersion: string;               // version of the input contract
  mappings: Array<{
    path: string;                            // input path, e.g. "events[3]"
    outcome: "exact" | "partial" | "inferred" | "unavailable";
    reason: string;                          // why the mapping is not exact
  }>;
};

type ProjectionIssue = {
  path: string;                              // input path, e.g. "events"
  code: string;                              // stable machine code, e.g. "missing_event_collection"
  message: string;                           // human-readable; MUST NOT echo payload values
};

type ProjectionResult<T> =
  | { ok: true; view: T; report: ProjectionReport }
  | { ok: false; report: ProjectionReport; issues: ProjectionIssue[] };

type EvidenceToLegacyTrace = (evidence: EvidenceTrace) => ProjectionResult<LegacyTraceView>;
type EvidenceToAgentRun = (evidence: EvidenceTrace) => ProjectionResult<AgentRunView>;
type LegacyTraceToEvidence = (trace: LegacyTrace) => ProjectionResult<EvidenceTrace>;
```

- Projections return an explicit `ProjectionResult` and never throw on
  expected invalid or lossy input. Three outcomes are distinguished:
  **successful exact projection** (`ok: true`, all mappings `exact`),
  **successful lossy or partial projection** (`ok: true` with
  `partial`/`inferred`/`unavailable` report entries — loss from otherwise
  valid input always returns a successful view, never a failure), and
  **failure** (`ok: false` with structured `ProjectionIssue[]`) when a valid
  target record cannot be constructed — for example the inverse projection
  cannot establish a canonical sequence from an absent, non-array, or
  otherwise invalid legacy `events` collection (§6.6). A projection never
  emits an invalid `EvidenceTrace` (or legacy view): every `ok: true` view
  satisfies its target contract's invariants.
- Callers distinguish **exact**, **partial**, **inferred**, and
  **unavailable** mappings from the report. `partial` means a field was
  mapped with documented loss; `inferred` means the projection derived a
  value that was not directly present (for example a token estimate
  converted to an `estimated` measurement placeholder — never presented as
  observed); `unavailable` means the target field cannot be populated and
  the mapping is explicit.

### 6.3 Loss, missing, and unavailable values

- **Canonical → legacy `Trace`:** canonical `seq`, `observationRole`, and
  `evidenceStatus` have no exact legacy equivalent in all cases; the v0.x
  `ContentPhase` is a documented approximation of observation roles (§11.2 of
  Spec 013) and every such conversion is reported as `partial`. Canonical
  event kinds map to `TraceEventType` vocabulary with a documented mapping
  table; kinds with no legacy equivalent are reported `unavailable` and are
  either dropped from the view (with a report entry) or represented as a
  control/metadata event — never mapped to the wrong legacy kind.
- **Canonical → `AgentRun`:** token values are only present when a
  measurement exists; until the measurement layer lands, token fields are
  `unavailable`, never invented from text length. Smells/recommendations are
  interpretations and MUST NOT appear in a projection as evidence.
- **Inverse (legacy `Trace` → evidence):** legacy events without `seq`
  receive derived canonical `seq` values by the fixed deterministic rule of
  §6.6 (legacy array order is primary; contiguous from 0; timestamps never
  reorder). The projection MUST record the derivation as `inferred` and MUST
  NOT claim observation-time assignment. Legacy `ContentPhase`
  values map to `observationRole` per §11.2 with the same boundary discipline
  (a phase label describes where content was observed, never provider-internal
  state). Legacy redacted excerpts map to `redacted` artifacts with
  `contentFidelity`/`contentType` recorded only when the retained
  representation actually exists; no hash is fabricated when the bytes were
  not retained.
- Projections never fabricate evidence and never convert `unknown`/`missing`
  into content.

### 6.4 Round-trip expectations and known non-equivalences

- No byte-for-byte or full semantic round-trip equivalence is claimed:
  canonical evidence → legacy view → canonical evidence is NOT identity, and
  legacy → canonical → legacy is NOT identity. The projections are one-way
  compatibility views, not invertible bijections.
- Documented non-equivalences include: `seq` (canonical-only), the full
  canonical event-kind vocabulary (legacy has a smaller, differently named
  set), `evidenceStatus` vs. legacy excerpt semantics, `contentHash` and
  `nativeContentHash` (legacy has no hash contract), completeness records
  (legacy has none), and per-field evidence status on usage (legacy usage is
  a plain number).
- Where loss is unavoidable, the projection MUST carry explicit loss metadata
  (the report's `partial`/`unavailable` entries), and callers MUST NOT
  present a projected view as authoritative evidence.

### 6.5 Determinism and versioning

- Projection functions are pure: identical input records and identical
  projection version produce identical views and identical reports. No
  randomness, no wall-clock reads, no environment dependence.
- Each projection function carries its own projection version
  (`report.projectionVersion`), and the output carries the schema version it
  was produced from (model-versioning: "Projection output carries its own
  projection version and the schema version it was produced from").
- Projections create **ephemeral views by default**: they are computed on
  demand and are not stored records. Persisting a projection (for caching,
  export, or redacted export) is a later storage/export concern and MUST
  record provenance linking it to its source records, projection version,
  and policy context — never authoritative evidence.

### 6.6 Inverse-projection sequence derivation

The deterministic rule for deriving canonical `seq` values from legacy
`TraceEvent` arrays (used by the inverse projection of §6.1, required by Spec
013 §11.2):

1. **Primary authority: original legacy array order.** A legacy `Trace`
   serializes `events: TraceEvent[]`; the order in which events appear in
   that array is the order the legacy contract itself records and is the
   only ordering authority for the derived sequence.
2. **Contiguous from 0.** Canonical `seq` values are assigned contiguously
   starting at `0` (Spec 013 §2.2: the first event has `seq` 0 and each
   subsequent event is exactly one greater) in array order.
3. **Timestamps are evidence fields, never an ordering authority.** Legacy
   `timestamp` values are mapped to canonical `capturedAt` and MUST NOT
   reorder the source: array order governs even when timestamps are out of
   order, missing, or duplicated. Missing or duplicate timestamps never
   change `seq`; they are reported as `partial`/`unavailable` entries for
   the timestamp field in the projection report.
4. **Empty arrays are ordered.** An empty legacy `events` array is a valid
   ordered collection: it requires zero `seq` assignments (contiguity from 0
   holds vacuously) and yields a canonical trace whose lifecycle is
   `unknown` per §4.7 — a valid but incomplete trace whose completeness
   record reports that no lifecycle events were observed.
5. **Unavailable legacy ordering.** Only an absent, non-array, or otherwise
   invalid event collection (for example `events: null` or a non-array
   shape) lacks usable array ordering. The projection then MUST return an
   explicit failure (`ok: false` with a structured issue, §6.2) and MUST NOT
   synthesize an order — a guessed order or a fabricated view is never
   produced.
6. **Inferred, never observed.** The derived `seq` values are recorded as
   `inferred` in the projection report; the projection MUST NOT claim the
   sequence was assigned at observation time.
7. **Deterministic and versioned.** The rule is pure and deterministic
   (identical input + identical projection version → identical output,
   §6.5); the projection version records the rule version, and any change
   to the rule bumps the projection version.

Why this rule: array order is the only order the legacy contract itself
records; using timestamps as an ordering authority would reorder events
relative to the recorded legacy trace and require tie handling; contiguity
from 0 matches Spec 013's sequence invariant so downstream canonical
consumers (validators, completeness) treat the derived trace consistently.
The rule defines behavior for every case — including missing ordering — so no
implementation decision is left to the projection author.

## 7. Deterministic ordering and identity decisions

For implementers, the decisions of §3–§4 are normative and summarized here:

1. `seq` is the only ordering key; contiguous from 0; assigned by the one
   authoritative sequencing surface at observation time; gaps mark
   incomplete traces (§4.1).
2. Ties between wall-clock timestamps resolve by `seq`, never by timestamp
   (§4.2).
3. Monotonic `durationMs` requires a declared clock basis; no basis, no
   monotonic claim (§4.3).
4. Duplicates collapse by `eventId` (first/lowest-`seq` copy wins) and are
   reported in completeness; gaps are reported, never repaired (§4.4).
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
11. The inverse projection derives canonical `seq` from legacy array order,
    contiguous from 0, recorded `inferred` (§6.6).

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
   canonical → `AgentRun` view, legacy trace → canonical) with projection
   reports and explicit loss metadata; add `@signalglass/core`'s workspace
   dependency on `@signalglass/evidence`. Legacy modules are untouched.
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
  cross-reference resolution, uniqueness);
- wall-clock and monotonic timing (ties resolved by `seq`, clock-basis
  declaration, no fabricated durations);
- deterministic event ordering (contiguous `seq`, duplicate and gap
  handling, completeness consistency);
- incomplete lifecycle records: `unknown` traces and spans without
  `finishedAt`, `endSeq`, or terminal events parse and validate; `completed`
  without the observed `interaction_end`/`span_end` is rejected; `failed`/
  `cancelled` require their observed evidence as the final observed event
  and never fabricate a normal end event; present `finishedAt`/`endSeq`
  match the cited terminal event; wall-clock absence never upgrades
  `unknown`; completeness reports unobserved termination;
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
- legacy `Trace` → canonical inverse projection (derived `seq` from legacy
  array order, contiguous from 0, labeled `inferred`; missing or duplicate
  timestamps never reorder; absent/invalid array → `unavailable`);
- canonical → `AgentRun` projection (token fields `unavailable` until the
  measurement layer exists);
- projection results: successful exact, successful lossy/partial (report
  entries), and explicit failure (`ok: false`) for absent, non-array, or
  invalid legacy event collections; an empty legacy `events` array succeeds
  with zero `seq` assignments; no projection returns an invalid canonical
  view and none throws on expected invalid or lossy input;
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
settle are settled in this spec (§1–§8). Four questions previously reported
as open are now **resolved in this Draft** and removed from this section:
identifier generation (§3.2 — caller-supplied ids; generation is outside the
evidence core), retained-byte serialization (§5.7 — RFC 4648 §4 Base64,
padded, canonical), trace/span status vocabulary (§4.7 — `completed` |
`failed` | `cancelled` | `unknown`), and inverse-projection `seq` derivation
(§6.6 — legacy array order, contiguous from 0, `inferred`). No implementation
decision essential to the first slice remains delegated to implementers or
fixture authors.

One question genuinely remains open, stated precisely with why it cannot be
settled now and where it will be resolved:

1. **Legacy `AgentRun` → canonical evidence direction.** Spec 013 §11.2
   requires only the legacy `Trace` → canonical inverse projection; it does
   not require parsing legacy offline run files into evidence. The direction
   is not needed for the first implementation increment because no
   collector, adapter, or ingress converts to canonical evidence in Spec
   014's slices (§8), and legacy offline run consumers are served by the
   evidence → `AgentRun` view (§6.1). **Resolved by:** the later
   collector/adapter-ingress specification, which will decide whether
   legacy offline run files are parsed into evidence or remain legacy
   inputs. This deferral does not weaken the required legacy `Trace` →
   canonical inverse projection (§6.3, §6.6).

This is the only open question. There are no broad "TBD" entries: every other
decision needed to implement the first slice is specified above.

## 13. Acceptance criteria

- [ ] Spec 014 maps each initial primitive to its Spec 013 definition
  (§2.2), with no competing names for Spec 013 concepts.
- [ ] The package/module boundary is explicit: `packages/evidence`
  (`@signalglass/evidence`) with projections in `@signalglass/core`
  (`packages/core/src/evidenceProjections/`) (§1.1).
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
- [ ] Compatibility projections are specified in both required directions:
  canonical evidence → legacy `Trace`/`TraceEvent` and → legacy `AgentRun`
  views, plus the Spec 013-required inverse (legacy `Trace` → canonical
  evidence) (§6).
- [ ] Projection loss and unavailable values are explicit through a
  projection report (`exact`/`partial`/`inferred`/`unavailable`),
  projections never fabricate evidence, and projection results distinguish
  successful exact, successful lossy/partial, and explicit failure
  (`ok: false`) outcomes — a projection never returns an invalid canonical
  view and never throws on expected invalid or lossy input (§6.2, §6.6).
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
  lists Spec 014 as Draft, and the roadmap and glossary reference it
  without claiming implementation exists.
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
  carry no `finishedAt`/`endSeq`/terminal event, `completed` requires the
  observed normal terminal event, `failed`/`cancelled` require their
  observed evidence without fabricating a normal end event, and present
  `finishedAt`/`endSeq` are supported by observed evidence (§2.2, §4.7,
  §5.4).
- [ ] The inverse projection's `seq` derivation is deterministic: legacy
  array order is primary, contiguous from 0, timestamps never reorder, and
  inferred/lossy status is recorded in the projection report (§6.6).
- [ ] Completeness is classified per Spec 013 as a derived record;
  `deriveCompleteness` is pure, deterministic, and free of measurement,
  cost, interpretation, or optimization logic (§2.1, §2.2.9).

## Tests

Spec 014 is documentation-only; no production code changes are made by this
spec. The test plan in §9 is the contract for the future implementation
PRs, mapped to the acceptance criteria above (valid construction, malformed
records, all union variants, version-compatibility acceptance and
unknown-discriminant/breaking-version refusal, reference integrity, timing,
deterministic ordering, incomplete-lifecycle representation, serialization
and retained-byte Base64 canonicality, hash selection, media types,
completeness, both projection directions, the deterministic inverse `seq`
rule, projection success/failure results, explicit loss, projection
determinism, no fabrication, and package-boundary checks).

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
