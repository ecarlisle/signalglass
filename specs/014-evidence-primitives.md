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
- Graphify, MCP, retrieval, or provider-specific instrumentation.
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

- the evidence record types and vocabulary types of §2;
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
(`src/internal/hash.ts`), time and id helpers (`src/internal/time.ts`,
`src/internal/id.ts`), and the RFC 6838 media-type and hash-format checks
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
  `@signalglass/cli`, `apps/*`, and any external validation, schema, or
  serialization library. The repository has no established validation
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
types. Provider-, storage-, and UI-specific logic lives in their existing
packages (`@signalglass/providers`, `@signalglass/storage`, `apps/*`) and is
out of scope here.

## 2. Initial primitive inventory

### 2.1 Classification

Every primitive carries one classification, mirroring Spec 013 §1.1:

- **evidence** — an observation of what happened at a declared boundary;
- **measurement** — a deterministic derivation over evidence (deferred, §2.3);
- **interpretation** — a labeled judgment (deferred, §2.3);
- **administrative metadata** — a record about operations on evidence, never
  merged into payload status (deferred where possible, §2.3).

The evidence core contains only **evidence** primitives plus the
vocabulary/value types they need. Derived and administrative types are
referenced by id or field where Spec 013 requires, but are not implemented in
the first slice.

### 2.2 In-slice primitives

For each primitive: **category**, **responsibility**, **key fields**,
**discriminant/id rules**, **append-only expectation**, **observation
boundary**, **serialization**, **validation**, **relationships**, and
**slice**.

#### 2.2.1 Trace envelope (`EvidenceTrace`)

- **Category:** evidence (top-level container).
- **Responsibility:** the authoritative serialized evidence record of one
  interaction (Spec 013 §1.2): one interaction, one trace.
- **Fields:** `interactionId`, `traceId` (equal; invariant), `evidenceSchemaVersion`,
  `captureProfile: { name, version }`, `captureSurface`, `observationBoundary`,
  `startedAt`, `finishedAt`, `status`, `conditions?`, `spans[]`, `events[]`,
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
  status vocabulary, seq/span/event cross-checks, completeness consistency
  (§4, §5).
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
  `startSeq`, `endSeq`, `startedAt`, `finishedAt`, `durationMs?`,
  `status`, `participants?`.
- **Discriminant/id rules:** `kind` ∈ {`model`, `tool`, `mcp`, `retrieval`,
  `context_provider`, `context_assembly`}; `spanId` opaque, unique within
  trace; `parentSpanId` establishes hierarchy only, never ordering.
- **Append-only:** yes, as above.
- **Observation boundary:** inherits trace boundary unless overridden.
- **Serialization:** JSON object; `null` for structural absence
  (`parentSpanId`).
- **Validation:** span ids unique; parent ids resolve or are null; `startSeq`
  ≤ `endSeq`; `span_start`/`span_end` events exist and bound the range;
  `durationMs` present only with a declared clock basis.
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

- **Category:** derived (computed from evidence; not itself evidence).
- **Responsibility:** a derived description of which evidence was captured,
  redacted, truncated, missing, or unknown, plus sequence gaps, duplicates,
  and the boundary statement (Spec 013 §4.3). Never invents evidence.
- **Fields:** `eventsByStatus: Record<EvidenceStatus, number>`, `seqGaps[]`,
  `duplicatesDetected[]`, `boundaryStatement`.
- **Discriminant/id rules:** none.
- **Append-only:** derived; recomputable by a deterministic pure function
  `deriveCompleteness(trace)`; MAY be serialized on the trace (the docs'
  examples do), MUST be consistent with the trace when present.
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
  the roles.
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
- `ClockBasis` — declared basis for monotonic `durationMs`; initial slice
  defines the value `monotonic-performance-now-ms` (see §4.3 and §12).
- `CapturedAt` / timestamps — ISO 8601 UTC with millisecond precision.
- `EvidenceSchemaVersion` — semantic version string, recorded directly or
  inherited through the trace reference (Spec 013 §10).
- `TraceStatus` / `SpanStatus` — initial closed vocabulary derived from the
  lifecycle events and the normative examples: `completed` | `failed` |
  `cancelled` (see §12, open question 3).

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
- **Streaming-native capture**, **native byte capture**, **MCP/tool spans**,
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
- The exact generation scheme (ULID vs. UUIDv7 vs. capture-surface-owned
  prefixed counters) is **not settled by Spec 013 or the repository**; it is
  open question 1 (§12). Until resolved, the primitives accept any opaque
  string satisfying uniqueness and immutability, and the eventual scheme MUST
  NOT make ids ordering-significant.
- Identifiers MUST NOT be used for ordering; only `seq` orders events (§4.1).

### 3.3 Versions

- Every evidence record carries `evidenceSchemaVersion` directly or inherits
  it through its trace reference (Spec 013 §10). Standalone records (for
  example a standalone artifact) carry it explicitly.
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
  `serializeEvidence` re-emits them verbatim. "Ignore unknown fields" never
  permits discarding them when evidence is re-serialized.
- **Unknown discriminant values** (an event `kind`, artifact `kind`, locator
  `type`, or fidelity value not in the closed vocabulary): a validation
  **error**, because the record's semantics cannot be safely interpreted.
  The error identifies the field path and the unknown value's presence
  without echoing content.
- **Newer schema versions:** a record whose `evidenceSchemaVersion` the
  validator does not support MUST be refused with a version error (or
  accepted only through an explicit, versioned projection); it MUST NOT be
  silently misread. This is the boundary between forward compatibility and
  strict validation, and it is explicit: **unknown additive fields are
  tolerated and preserved; unknown discriminants and unsupported versions
  are refused.**
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
  span `startSeq`/`endSeq` consistent with `span_start`/`span_end` events.
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
everything that must survive verbatim:

- Normalized: vocabulary values, timestamps, identifiers, envelopes'
  normalized common fields.
- Preserved: `providerNative` payloads at their declared fidelity, retained
  byte sequences (`byte_faithful`) without decoding or transformation, and
  unknown additive fields (passthrough, §5.3).
- The two are explicit: normalization never rewrites native payloads, and
  preserved fields never bypass validation of the fields the contract owns.

### 5.7 Serialization rules

- `serializeEvidence(record)` produces the JSON-safe form: plain objects,
  arrays, strings, numbers, booleans, and `null` for structural absence only.
- Retained byte payloads (`byte_faithful`) are represented in memory as
  `Uint8Array` and serialized as base64 with `nativeEncoding` declared; the
  exact base64 representation is pinned in the fixture contract (slice 2,
  §12 open question 2). Fidelity claims are to the retained bytes only.
- No canonical-JSON requirement for storage serialization; deterministic
  canonicalization exists only where Spec 013 requires it (content hashing,
  §4.5). The serialized form is self-describing (schema version present) and
  MUST be interpretable without the current application build (Spec 013 §10).
- Serialization preserves unknown additive fields (§5.3) and does not
  reorder or reformat retained content.

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
evidence) is **deferred**: Spec 013 requires the trace inverse only, and the
offline run files are legacy inputs whose consumers will be migrated via the
evidence → `AgentRun` view first (§8, §12 open question 4).

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

type EvidenceToLegacyTrace = (evidence: EvidenceTrace) => {
  view: LegacyTraceView;                     // v0.x Trace/TraceEvent shape
  report: ProjectionReport;
};
type EvidenceToAgentRun = (evidence: EvidenceTrace) => {
  view: AgentRunView;                        // legacy AgentRun shape
  report: ProjectionReport;
};
type LegacyTraceToEvidence = (trace: LegacyTrace) => {
  view: EvidenceTrace;                       // canonical shape
  report: ProjectionReport;
};
```

- Projections return an explicit result (`view` + `report`); they never
  throw on lossy mappings and never silently drop information without a
  report entry.
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
  receive a derived sequence only by an explicit, documented rule (open
  question 5, §12); the projection MUST record the derivation as `inferred`
  and MUST NOT claim observation-time assignment. Legacy `ContentPhase`
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
9. Where identifier generation cannot be settled from the repository, the
   open decision is stated precisely (§12, open question 1); no canonical
   algorithm is invented here.

## 8. Additive implementation sequence

Each slice is independently reviewable, testable, and mergeable; none
requires a flag-day migration, and none begins storage or capture migration.

1. **Evidence package foundation.** Create `packages/evidence` with the §2
   types, the §3 discriminants/versions, the §5 validators and serialization,
   and the §4 ordering/hash helpers. Add the `@signalglass/evidence` workspace
   alias to `vitest.config.ts`. No other package changes.
2. **Deterministic fixtures and negative controls.** Extract the nine
   normative serialized examples from `docs/evidence-model.md` into JSON
   fixtures under `packages/evidence/src/fixtures/`; add negative controls
   (status/fidelity matrix rejections, media-type boundary cases, hash-format
   cases, seq/duplicate/gap cases, unknown-discriminant and unsupported-version
   cases) mirroring the self-tests in `scripts/validate-evidence-examples.mjs`;
   pin the retained-byte serialization form (§5.7) in the fixture contract.
3. **Compatibility projections beside legacy types.** Add
   `packages/core/src/evidenceProjections/` (canonical → legacy trace,
   canonical → `AgentRun` view, legacy trace → canonical) with projection
   reports and explicit loss metadata; add `@signalglass/core`'s workspace
   dependency on `@signalglass/evidence`. Legacy modules are untouched.
4. **Selected internal callers construct evidence records** beside legacy
   behavior — for example, the ingress emits canonical evidence for new
   captures while continuing to emit legacy traces — with no persistence
   change. Wire-through tests only; no consumer switches.
5. **Parity verification.** Run the existing analyzer and report tests
   against projected views; verify deterministic outputs; explicitly
   document projection loss and backfill mapping cases; confirm
   `scripts/validate-evidence-examples.mjs` self-tests still pass unchanged.
6. **Later specifications** (not this spec): persistence and migration;
   collector/adapter ingress onto evidence; native byte capture; streaming
   capture; MCP and tool spans; Graphify provenance; deterministic
   measurements; dashboard migration; privacy, retention, and redaction
   workflows.

Later concerns that require separate specifications include, explicitly:
storage/migration (schema, indices, tombstones), collector/adapter ingress,
native byte capture, streaming capture, MCP and tool spans, Graphify
provenance, deterministic measurements, dashboard migration, and
privacy/retention/redaction workflows.

## 9. Testing and conformance

### 9.1 Test inventory

Future implementation tests MUST cover, using Vitest and fixed fixtures:

- valid record construction for every §2.2 record type;
- malformed and incomplete records (missing required fields, invalid enums,
  non-JSON-safe values);
- every discriminated-union variant (all event kinds, span kinds, locator
  types, fidelity values);
- unknown discriminants and unsupported schema versions (refused) versus
  unknown additive fields (preserved on round trip);
- identifier and reference integrity (`interactionId === traceId`,
  cross-reference resolution, uniqueness);
- wall-clock and monotonic timing (ties resolved by `seq`, clock-basis
  declaration, no fabricated durations);
- deterministic event ordering (contiguous `seq`, duplicate and gap
  handling, completeness consistency);
- JSON serialization and parsing round trips, including unknown-field
  preservation and retained-byte encoding;
- retained/native content-hash selection (`contentHash` vs
  `nativeContentHash`, hash-path selection from artifact fields);
- valid and invalid RFC 6838 content types (including
  `application/vnd.example+json` and parameter rejection);
- completeness and unavailable-value handling (missing/unknown/not_applicable
  never carry content, fidelity, or hashes);
- canonical → legacy `Trace` projection and its report;
- legacy `Trace` → canonical inverse projection (derived `seq` labeled
  `inferred`);
- canonical → `AgentRun` projection (token fields `unavailable` until the
  measurement layer exists);
- explicitly lossy projections (report entries for `partial`/`unavailable`);
- projection determinism (same input + version → same view and report);
- no fabrication of unavailable evidence (projections never invent content or
  convert unknown to certainty);
- browser-safe and Node-safe package boundaries (no Node-only imports
  reachable from the package's public surface).

### 9.2 Fixtures and determinism

Tests MUST use fixed fixtures and injected, controlled inputs. They MUST NOT
require live providers, network access, current prices, nondeterministic
clocks, or random identifiers — clocks and id generators are injected and
controlled so tests are deterministic. The nine normative examples in
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
  unsupported versions are refused; invalid evidence is never defaulted or
  coerced (§5.3–§5.5).
- **Making projections nondeterministic** — rejected: projections are pure,
  versioned functions with explicit loss reports (§6.5).
- **Treating Graphify or MCP concepts as core evidence dependencies** —
  rejected: Graphify/MCP activity appears only through the canonical
  provider-neutral event kinds and capture surfaces (Spec 013 §3.1, §5);
  instrumentation belongs to later specs.
- **Introducing optimization behavior into the observation path** — rejected:
  the evidence core is observability-only; optimization is explicit
  experimental condition or optional analysis, never core (foundation
  principles 1 and 6).

## 12. Open questions and decision discipline

Decisions necessary for the first slice that the repository can already
settle are settled in this spec (§1–§8). Genuinely unresolved questions are
stated precisely below, with why they cannot be settled now and where they
will be resolved:

1. **Identifier generation scheme.** Spec 013 §2.1 recommends ULID-style
   trace ids but does not fix a scheme for `spanId`, `eventId`, and
   `artifactId`. The repository has no existing id utility. Until resolved:
   primitives accept opaque unique strings; ids are never ordering keys.
   **Resolved by:** the slice-1 implementation experiment, choosing between
   ULID, UUIDv7, and capture-surface-owned prefixed counters, with the
   criteria: uniqueness within a trace, opacity, capture-time assignment,
   immutability, and ordering independence. Not a correctness blocker for
   the spec.
2. **JSON representation of retained `byte_faithful` bytes.** Spec 013
   requires preserving the exact native byte sequence but does not pin its
   JSON form. This spec proposes base64 with `nativeEncoding` declared
   (§5.7). **Resolved by:** the slice-2 fixture contract, which pins the
   exact encoding and round-trip tests.
3. **Trace/span status vocabulary.** The normative examples use
   `"completed"`; Spec 013 defines `error` and `cancelled` events but no
   closed trace-status vocabulary. This spec proposes the initial closed set
   `completed | failed | cancelled` (§2.2.12). **Resolved by:** the
   lifecycle/federation spec if a reviewer finds the proposed set wrong;
   until then the proposed set is the contract for the slice.
4. **Legacy `AgentRun` → canonical evidence direction.** Spec 013 §11.2
   requires only the trace inverse; the offline-run-file direction is
   deferred here (§6.1). **Resolved by:** the collector/adapter-ingress
   spec, which will decide whether legacy offline run files are parsed into
   evidence or remain legacy inputs.
5. **Derived `seq` for legacy traces in the inverse projection.** A legacy
   `Trace` has no `seq`; the inverse projection must order its events.
   This spec requires the derivation to be labeled `inferred` and recorded in
   the projection report (§6.3) but does not fix the derivation rule (event
   timestamp order with documented tie handling is the candidate).
   **Resolved by:** the projection implementation slice (slice 3), which
   must fix and test the rule; the report makes the choice auditable.

These are the only open questions. There are no broad "TBD" entries: every
other decision needed to implement the first slice is specified above.

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
- [ ] Unknown additive fields are preserved on round trips; unknown
  discriminants and unsupported schema versions are refused; no silent
  coercion (§5.3–§5.5).
- [ ] Compatibility projections are specified in both required directions:
  canonical evidence → legacy `Trace`/`TraceEvent` and → legacy `AgentRun`
  views, plus the Spec 013-required inverse (legacy `Trace` → canonical
  evidence) (§6).
- [ ] Projection loss and unavailable values are explicit through a
  projection report (`exact`/`partial`/`inferred`/`unavailable`), and
  projections never fabricate evidence (§6.2–§6.3).
- [ ] Deterministic ordering and identity behavior is defined: `seq` is the
  only ordering key; ids are opaque, capture-time, and never
  ordering-significant; ties resolve by `seq`; monotonic durations declare a
  clock basis (§3–§4, §7).
- [ ] Initial and deferred primitive inventories are distinguishable; the
  evidence core contains no measurements, interpretations, cost, smells,
  recommendations, or optimization logic (§2.2–§2.3).
- [ ] Implementation slices are independently testable and mergeable, with
  no flag-day migration and no storage/capture migration in any slice (§8).
- [ ] Evidence remains separate from measurements and interpretations
  (§2.1); derived and administrative records never merge into payload
  status.
- [ ] No storage, collector, Graphify, MCP, or dashboard implementation is
  included in this spec's scope or planned slices (§8.2 non-goals).
- [ ] Documentation and index references are consistent: the spec index
  lists Spec 014 as Draft, and the roadmap and glossary reference it
  without claiming implementation exists.

## Tests

Spec 014 is documentation-only; no production code changes are made by this
spec. The test plan in §9 is the contract for the future implementation
PRs, mapped to the acceptance criteria above (valid construction, malformed
records, all union variants, unknown discriminants/versions, reference
integrity, timing, deterministic ordering, serialization, hash selection,
media types, completeness, both projection directions, explicit loss,
projection determinism, no fabrication, and package-boundary checks).

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
