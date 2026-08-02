# Spec 013: Evidence model

## Status

Draft — current authority for the target architecture. While Draft, this spec
is the target-architecture contract for design and implementation planning; it
does not override the accepted Architectural Foundation or ADR 0004, which
remain authoritative on any conflict until this spec is accepted.

## Purpose

Define SignalGlass's canonical, provider-neutral evidence model: the contract
for recording AI interactions as evidence, deriving deterministic measurements
from that evidence, and keeping interpretations clearly separate. This
specification turns the direction adopted in
[`docs/architectural-foundation.md`](../docs/architectural-foundation.md) (v0.1)
and [ADR 0004](../docs/decisions/0004-evidence-first.md) into an explicit,
implementable contract.

## Relationship to the architectural foundation

The Architectural Foundation (approved v0.1) and ADR 0004 are the authoritative
target-direction documents. This spec makes their evidence-first direction
concrete. Where this spec and the foundation conflict, the newer accepted
revision wins; where this spec and legacy v0.x documentation conflict, this
spec wins for the target architecture. Formal supersession of the legacy
documents takes effect only when this spec is accepted: until then they
remain accurate records of the implemented v0.x state, and upon acceptance
they become compatibility projections (see [§11 Legacy supersession](#11-legacy-supersession)).

## Scope

- The canonical evidence record: interactions, traces, spans, events, context
  artifacts and contributions, request/response envelopes, observation
  boundaries, completeness, measurement records, and interpretation records.
- Deterministic identity and ordering rules.
- Evidence status and uncertainty semantics.
- Capture profiles (collection / persistence / export) as a contract.
- Versioning rules for evidence and derivations.
- Formal supersession of legacy specs 002, 003, and 004 (takes effect upon
  acceptance of this spec; see §11).

## Non-goals

- Collector implementation, persistence migrations, or production TypeScript
  evidence types (future implementation specs).
- Dashboard implementation or a final visual language.
- Prompt rewriting, compression, summarization, context optimization, or
  automatic context selection.
- Evaluation of response correctness or speculative provider-internal claims.
- Replacing legacy runtime models (`Trace`, `AgentRun`) on this branch.

## RFC-style terms

- **MUST** — a normative requirement; an implementation is not conformant
  unless it is met.
- **MUST NOT** — a normative prohibition.
- **SHOULD** — a recommendation; deviation is permitted only with documented
  justification.
- **MAY** — an optional capability.
- **Undefined** — no contract is offered; implementations MUST NOT rely on it.

## 1. Canonical hierarchy

### 1.1 Entities and responsibilities

| Entity | Responsibility | Canonical? |
|---|---|---|
| **Interaction** | The enclosing logical AI exchange or task execution being observed (one agent step, one user turn, or an equivalent logical unit). The domain entity whose evidence is recorded. | Yes |
| **Trace** | The authoritative serialized evidence record of one interaction. Each interaction is serialized as exactly one trace; `traceId` is the same identifier value as the interaction's `id`. | Yes |
| **Span** | A structured, hierarchically organized segment of an interaction with a lifecycle (start/end): a model request, a tool call, an MCP call, a retrieval, a context-provider call, or context assembly. Carries hierarchy, timing, and status. | Yes |
| **Event** | A discrete observed occurrence attached to a span or to the trace root. Carries content, evidence status, and the deterministic sequence position. | Yes |
| **Run** | A derived, session-level grouping of one or more interactions (for example, an agent's task execution). A projection, not a canonical evidence container. | No (projection) |
| **Condition** | A declared, labeled experimental or environmental condition attached to an interaction (prompt variant, temperature, model version, capture surface). Conditions are metadata; they are never evidence of outcome. | Yes (metadata) |
| **Request envelope** | The canonical wrapper for an application-visible request: normalized common fields plus the provider-native payload preserved at a declared fidelity. | Yes |
| **Response envelope** | The canonical wrapper for an application-visible response (including stream chunks and final usage). Provider-native payload preserved at a declared fidelity. | Yes |
| **Context artifact** | A referenceable unit of context (message, file, document, retrieved fragment, MCP response, tool result, repository content) with payload and provenance metadata. | Yes |
| **Context contribution** | The recorded act of adding context into a model request, referencing artifacts by deterministic locator. | Yes |
| **Observation boundary** | The declared scope of what a capture surface could and could not observe, recorded with the evidence. | Yes (metadata) |
| **Trace completeness** | A derived description of which evidence was captured, redacted, truncated, missing, or unknown, and what the boundary could not observe. Never invents evidence. | Derived |
| **Measurement record** | A deterministic derivation over evidence (token counts, latency, duration, cost) with algorithm/version and input references. | Derived |
| **Interpretation record** | A labeled, optional human-facing explanation or judgment derived from measurements and evidence. | Derived |

### 1.2 An interaction is serialized as exactly one trace

**Rule:** An interaction is a domain entity; a trace is the authoritative
serialized evidence record of that entity. Each interaction is serialized as
exactly one trace, and `interactionId` (the interaction's id) and `traceId`
(the trace's id) are the same identifier value. This document uses
"interaction" when referring to the domain object and "trace" when referring
to its serialized record; they are two views of one entity, not two containers.

**Canonical serialized shape.** The serialized trace record carries both
`interactionId` and `traceId` at the top level, with equal values. This
equality is an invariant that serialization MUST enforce and that consumers
MAY rely on. `traceId` is the reference identifier: events, spans, envelopes,
artifacts, and derived records reference the trace by `traceId` only, never by
`interactionId`. Neither field is omitted, and readers are never required to
infer one from the other.

**Rationale:** Two competing top-level containers would make "interaction" and
"trace" ambiguous forever. One serialization keeps identity, ordering,
completeness, and lifecycle in a single place.

**Rejected alternatives:**

- *Trace as a federation of spans across multiple services* (OpenTelemetry
  style), with interactions as logical groupings. This splits completeness and
  ordering across containers and requires a federation concept before any
  evidence exists. Deferred to a future "distributed trace federation" concept
  that may layer spans from multiple capture surfaces under one interaction id.
- *Interaction as parent container, trace as child.* Duplicates lifecycle and
  identity without adding meaning.

**Deferred:** Cross-surface federation — one interaction observed by multiple
capture surfaces producing one merged trace — is deferred to a later spec.

### 1.3 Spans versus events

**Rule:** Spans carry **structure** (hierarchy, nesting, concurrency, timing,
status); events carry **content** (payloads, transitions, evidence status,
sequence position).

A span is a logical aggregation of its events: span start/end are marked by
`span_start`/`span_end` events, and the span's `seq` range is derived from them.
Content (request bodies, responses, tool results, errors) lives on events,
never directly on spans.

**Rationale:** Hierarchy and concurrency need a tree with lifetimes; total order
needs a flat event sequence. Keeping content on events means the deterministic
ordering key lives on every content-bearing record.

## 2. Identity and ordering

### 2.1 Identifiers

- `interactionId` — the domain identifier of the interaction; the same value
  as `traceId` (§1.2). Serialized at the trace top level; nested records never
  use it to reference the trace.
- `traceId` — stable, opaque identifier of the serialized trace record; MUST
  equal `interactionId` (§1.2). MUST be unique within a SignalGlass
  installation; SHOULD be globally unique (ULID-style values are recommended).
  Nested records reference the trace by `traceId` only.
- `spanId` — stable, opaque span identifier, unique within the trace.
- `parentSpanId` — MAY be absent on root spans. Establishes **hierarchy only**;
  it MUST NOT be used for ordering.
- Event `eventId` — stable, opaque event identifier, unique within the trace.
- Artifact, measurement, and interpretation records carry their own stable ids.

Identifiers MUST be assigned at capture time, MUST be immutable, and MUST NOT be
derived from content. Content-derived identity (for example, a hash) is a
separate `contentHash` field, never an id.

`null` is reserved for structural absence: a root span's absent
`parentSpanId`, or an event attached to the trace root via `spanId`. Evidence
statuses and measured values MUST NOT be represented by `null` or by omitted
fields (§4): absence of an evidence value is a status (`unknown`, `missing`,
`not_applicable`), never `null`.

### 2.2 Deterministic sequence ordering

**Rule:** Every event carries a `seq` — a non-negative integer, strictly
increasing **and contiguous** within the trace, assigned by the capture surface
at observation time. `seq` is the **only** deterministic ordering key. All other
ordering constructs (timestamps, hierarchy) are derived views over `seq`.

- Two events MUST NOT share a `seq` within one trace.
- `seq` values MUST be contiguous **as assigned at the sequencing surface**:
  the first event has `seq` 0, and every subsequent event's `seq` is exactly
  one greater than its predecessor's at the point of assignment. A retained
  trace that lost an event therefore shows a gap and MUST be marked incomplete
  (§2.4, §4.3); the contiguity invariant is never satisfied by silently
  renumbering retained events.
- `seq` is assigned by the trace's **authoritative sequencing surface** — the
  capture component that observes the event — at the point of observation,
  before the event is persisted or forwarded. Persistence and replay never
  assign `seq`.
- Spans reference their start/end `seq` range (`startSeq`, `endSeq`).
- Total order is `seq`; partial order is the `parentSpanId` hierarchy.
  Hierarchy is independent structural metadata: parentage is never derived
  from `seq` ranges, and `seq` ranges only describe when span boundaries were
  observed (§2.4: seq gaps may remove events from a range without changing
  parentage).
- Concurrency: two spans are concurrent when their `seq` ranges overlap and
  neither is an ancestor of the other.

**One sequencing surface per trace.** Each trace has exactly one authoritative
sequencing surface that owns its `seq` sequence. Cross-surface trace
federation (multiple capture surfaces merged into one trace) is deferred
(see §1.2); until then, records from other surfaces enter a trace only through
its sequencing surface, and this contract does not define cross-surface
ordering.

**What a sequence gap proves, and what it cannot prove.** A missing `seq` value
between two observed events proves that a sequence position was assigned but
is absent from the retained evidence: at least one event that reached the
sequencing surface was dropped before persistence or removed from retention.
A gap cannot detect an event that failed before a sequence number was
assigned — an event that never reached the sequencing surface leaves no
numerical trace. An uninterrupted `seq` range therefore does not prove complete
capture. Completely uncaptured events are disclosed through the trace
completeness record (§4.3) and the capture surface's boundary statement (§5.2)
— for example, as an explicit `missing` record when the surface knows an event
should have existed — never inferred from sequence position.

**Rationale:** Timestamps alone are insufficient ordering: capture clocks may
tie, may be adjusted, and may not reflect the true order of observation. A
monotonic sequence assigned at the point of observation is deterministic and
survives replay.

**Rejected alternatives:**

- *Ordering by wall-clock timestamps.* Rejected: ties, clock skew, and clock
  adjustments break determinism.
- *Ordering by arrival at persistence.* Rejected: delayed or out-of-order
  capture would reorder evidence relative to reality.
- *Timestamp with tie-break.* Rejected as an unnecessary second key when a
  capture-surface sequence exists.

### 2.3 Timestamps and durations

- `capturedAt` — ISO 8601 UTC wall-clock timestamp (millisecond precision), set
  by the capture surface. MAY tie with other events; ties MUST be resolved by
  `seq`, never by the timestamp.
- `durationMs` — derived from a monotonic clock at capture, recorded on spans
  and measurements. The clock basis MUST be declared.
- Delayed or out-of-order capture: `seq` is assigned at observation time;
  `persistedAt` MAY record when the record reached persistence. Ordering MUST
  use `seq`.

### 2.4 Duplicate and dropped events

- **Duplicates:** the same `eventId` appearing twice in one trace is a
  duplicate. Persistence MUST detect it and record a single event plus a
  completeness note (`duplicateDetected`), never two distinct events. The
  first observed copy wins (the one assigned the lowest `seq`); a conflicting
  later copy MUST be reported in the completeness record, never silently
  merged or resolved. Collapsing a duplicate does not create a sequence gap;
  the retained sequence stays contiguous.
- **Dropped events:** a `seq` gap (§2.2) proves that an assigned sequence
  position is absent from the retained evidence: at least one event that
  reached the sequencing surface was dropped before persistence or removed
  from retention. The completeness record MUST report the gap and the
  adjacent event ids; SignalGlass MUST NOT invent the missing event. An event
  that failed before a sequence number was assigned produces no gap; it is
  disclosed through the completeness record's boundary statement or an
  explicit `missing` record (§4.1), never inferred from sequence position.

## 3. Span and event semantics

### 3.1 Canonical event kinds

Provider-neutral event kinds:

| Kind | Meaning |
|---|---|
| `interaction_start` / `interaction_end` | Trace lifecycle boundaries. |
| `span_start` / `span_end` | Span lifecycle boundaries. |
| `model_request` / `model_response` / `model_response_chunk` / `model_usage` | Model activity, including stream chunks and provider-reported usage. |
| `tool_call` / `tool_result` | Tool invocation and result. |
| `mcp_request` / `mcp_result` | MCP server invocation and result. |
| `retrieval_request` / `retrieval_result` | Retrieval activity. |
| `context_provider_request` / `context_provider_result` | Graphify or other context-provider activity. |
| `context_assembled` | A recorded snapshot reference of assembled context for a model request. |
| `error` | An observed failure (with a declared actor). |
| `cancelled` | An observed cancellation. |
| `retry` | A reissued request; MUST reference the original request event id. |

Tool, MCP, retrieval, and context-provider activity are **spans** as well as
events: each is a span kind (`tool`, `mcp`, `retrieval`, `context_provider`,
`context_assembly`) with `span_start`/`span_end` events wrapping its request
and result events.

### 3.2 Provider neutrality and payload fidelity

**Rule:** Provider-native payloads are preserved inside
`requestEnvelope.providerNative` / `responseEnvelope.providerNative` at a
declared fidelity:

- `structurally_faithful` (default) — the payload is preserved as the parsed
  structure that was captured (for example, a JSON object), with values
  equivalent to what was observed. Field order, raw bytes, original
  whitespace, lexical formatting, and transport encoding are not preserved;
  byte-for-byte equivalence is not claimed.
- `byte_faithful` (optional) — the exact native byte sequence observed by the
  capture surface is preserved: the raw bytes or text as they crossed the
  boundary, before any decoding, normalization, envelope construction, or
  serialization. This requires recording `nativeEncoding` and
  `nativeContentType` on the envelope, and `nativeContentHash` when the native
  bytes were captured (see below).

**Native content hash.** `nativeContentHash` is an envelope-level field (a
sibling of `providerNativeFidelity`): a SHA-256 digest over exactly the native
byte sequence observed by the capture surface, before any transformation.
Representation: `sha256:<64 lowercase hexadecimal characters>`.

- **Required** when the envelope declares `byte_faithful` fidelity and the
  payload is `captured`: `byte_faithful` claims the retained bytes ARE the
  exact bytes observed at the boundary, and `nativeContentHash` is what lets
  a consumer verify them against the observed stream.
- **Optional** for `structurally_faithful` evidence when the capture surface
  also observed and retained the exact native bytes (for example, a
  transparent ingress proxy). It then verifies the observed stream without
  claiming the canonical record is byte-exact.
- **Forbidden** when the exact byte sequence was not observed or not retained
  sufficiently to compute it honestly: `missing`, `unknown`, and
  `not_applicable` payloads cannot claim a native content hash, and
  `redacted` or `truncated` payloads retained bytes that differ from what was
  observed, so a hash over the observed sequence would misrepresent the
  retained evidence.
- **Fidelity/status compatibility.** `byte_faithful` requires
  `evidenceStatus: "captured"`. `missing`, `unknown`, and `not_applicable`
  payloads cannot claim byte fidelity — nothing was observed. `redacted` or
  `truncated` payloads are byte-faithful only to their **retained
  representation**, never to the discarded original: any byte fidelity
  claimed for a redacted or truncated retained representation MUST be
  declared explicitly as fidelity to that retained representation (with its
  masking/truncation boundary), so it cannot be mistaken for fidelity to the
  original bytes. In the default contract, `redacted`/`truncated` payloads
  carry a lower declared fidelity and MUST NOT emit `nativeContentHash`.
- **Difference from `contentHash`:** `contentHash` (artifact-level, §6.1)
  hashes the retained representation according to the declared fidelity and
  canonicalization rules — for `structurally_faithful`, a canonical
  serialization of the parsed structure, which is not byte-for-byte the
  observed stream. The two digests are **equal** only when the retained
  representation is the exact observed byte sequence with no transformation
  applied (`byte_faithful`); they **differ** whenever canonicalization,
  decoding, normalization, or any other transformation was applied to the
  retained form. `nativeContentHash` never implies a canonical form.
- **External payload references:** an external reference to a native payload
  may carry `nativeContentHash` only when the hash was computed at capture
  time over the exact byte sequence the capture surface observed, and the
  reference records that the payload was captured
  (`evidenceStatus: "captured"`). A reference to content that was never
  observed, or only partially retained, MUST NOT carry the hash.

The envelope MUST record `providerNativeFidelity` and MUST NOT imply byte
fidelity unless `byte_faithful` is recorded. A provider-specific shape (for
example, an OpenAI chat-completions request) MUST NOT become the canonical
common model: the normalized envelope fields are the canonical representation,
and the native payload is preserved beside them at the declared fidelity.

**Rationale:** Normalized fields make capture, storage, comparison, and replay
provider-neutral; preserving the native payload at a declared fidelity keeps
evidence complete and falsifiable without overstating what was stored.

### 3.3 Errors, cancellation, and retries

- `error` events MUST declare the failing actor (`agent`, `model`, `tool`,
  `mcp`, `retrieval`, `context_provider`, or `capture`), the observed error,
  and the observation role under which the error was observed (§5.1). An error
  claimed at one boundary MUST NOT be attributed to another boundary without
  evidence; the error payload describes what the declaring surface observed,
  not provider-internal state.
- `cancelled` events MUST identify who or what requested cancellation and
  carry the observation role under which the cancellation was observed.
- `retry` events MUST reference the original request's `eventId` and record the
  retry policy inputs observed (attempt count, delay) without asserting the
  provider's internal policy. The associated error event MAY be referenced
  separately (for example, `errorEventId`) when that is useful.

## 4. Evidence status

### 4.1 Status values

Every evidence payload (event content, envelope, artifact payload) carries an
`evidenceStatus` with one of:

| Status | Meaning |
|---|---|
| `captured` | Content is present at its declared fidelity (§3.2: `structurally_faithful` or `byte_faithful`). |
| `redacted` | Content existed; it was removed or masked per a recorded policy. A hash MAY be present only over the retained redacted representation when policy permits (§6.1 hash semantics); it never implies possession of the original content. Hashes of secrets MUST NOT be retained. |
| `truncated` | Content existed; only a declared prefix or excerpt is stored. The truncation boundary MUST be recorded. |
| `missing` | Capture failed or did not occur; no claim is made about the content. |
| `unknown` | It cannot be determined whether the content existed (for example, provider internals). |
| `not_applicable` | No such content applies (for example, a stream-only control event has no request body). |

Evidence states MUST NOT be collapsed into `null` or omitted fields.
`unknown` (cannot determine whether the content existed), `missing` (known
not to be captured), `not_applicable` (no such content), and a captured
numeric zero (a real value, for example `output_tokens: 0`) are distinct and
MUST be represented by the statuses above, with an explicit value where one
exists — never by `null`.

### 4.2 The `inferred` status

**Rule:** `inferred` is NOT an evidence status. It exists only on derived
records (measurements and interpretations), where it MUST be applied explicitly
whenever a derivation goes beyond directly observed evidence.

**Rationale:** The legacy "estimated tokens" and "heuristic smell" labels showed
the value of explicit uncertainty labeling. Collapsing states into `null` or
`undefined` would erase the distinction between "not captured" and "never
existed"; the statuses above keep that distinction, and `inferred` is reserved
so raw evidence is never quietly guessed.

### 4.3 Trace completeness

Each trace carries a derived **completeness record** computed from its events:

- counts of events and payloads by status;
- `seq` gaps (assigned sequence positions absent from retained evidence) and
  duplicate detections;
- completely uncaptured events (never assigned a sequence position), disclosed
  here and in the boundary statement or as explicit `missing` records (§4.1),
  never inferred from sequence position;
- a boundary statement: what the interaction's observation boundary could not
  observe.

Completeness MUST be derived from the record, never fabricated, and MUST NOT
invent events to fill gaps.

## 5. Observation boundaries

### 5.1 Boundary-scoped observation roles

**Rule:** Every envelope and every **payload-bearing event** declares the
`observationRole` under which its content was captured. Lifecycle control
events (`interaction_start`, `interaction_end`, `span_start`, `span_end`) are
capture-surface control records: they inherit the capture surface's declared
boundary and carry no payload, so they do not need an `observationRole` of
their own.

| Role | Meaning |
|---|---|
| `application_constructed` | Built by the application/agent before capture (agent-side). |
| `client_sent` | Observed crossing the wire to the provider (ingress capture). |
| `provider_reported` | Reported by the provider (usage, finish reason, response). |
| `returned` | Delivered back to the caller. |
| `unobservable` | Could not be observed (provider internals, for example). |

### 5.2 Scope rules

- A claim MUST be scoped to the boundary at which it was observed. A
  `client_sent` payload proves what the client sent, not what the provider
  received or did internally.
- Provider internals MUST be represented as `unobservable` with
  `evidenceStatus: "unknown"` and a boundary declaration; they MUST NOT be
  guessed.
- Each capture surface declares its boundary on the trace and on records that
  need to override it (`captureSurface` and `observationBoundary` fields);
  records inherit the trace's declaration unless they declare an override.
- `observedAt` is not a defined observation field. Observation context is
  expressed by `observationRole` (the role under which the event was observed,
  §5.1), `evidenceStatus` (what state the payload is in, §4.1), and the
  record's `captureSurface`/`observationBoundary` (the declared scope of the
  capturing surface). These are independent axes: a `returned` payload may be
  `captured`, `redacted`, `truncated`, or `missing`, and the role never
  implies the status or vice versa.

## 6. Context provenance

### 6.1 Context artifacts

A context artifact is a referenceable unit of context:

- `artifactId` — stable id;
- `kind` — `message`, `file`, `document`, `fragment`, `tool_result`,
  `mcp_response`, `retrieval_result`, `context_provider_result`,
  `repository_content`, or `manual`;
- `evidenceStatus` — top-level artifact field: the state of the artifact's
  payload (`captured`, `redacted`, `truncated`, `missing`, `unknown`, or
  `not_applicable`; see §4.1). It is never nested inside `payloadRef`;
- `payloadRef` — reference to the content (inline or external): for inline
  content, the retained representation or excerpt; for external content, a
  locator. It contains only payload-reference fields, never `evidenceStatus`
  or `contentHash`;
- `contentFidelity` — artifact-level fidelity of the **retained**
  representation: `byte_faithful` or `structurally_faithful` (§3.2).
  Required whenever retained content exists (`captured`, `redacted`,
  `truncated`) or a `contentHash`/`contentHashUnavailableReason` is present;
  forbidden when no retained content exists (`missing`, `unknown`,
  `not_applicable`). It describes the retained representation, never
  discarded originals;
- `contentType` — the media type / format of the retained representation (an
  IANA media type such as `application/json` or `text/markdown`, or an
  equivalent registry name). Required whenever retained content exists or a
  `contentHash`/`contentHashUnavailableReason` is present; it is the
  artifact-local input that selects the hashing path;
- `contentHash` — top-level artifact field; a deterministic SHA-256 digest
  (see hash semantics below). It is never nested inside `payloadRef`;
- `contentCanonicalizer` — canonicalizer identifier (`{ name, version }`):
  required when `structurally_faithful` retained content of a non-JSON
  format carries `contentHash`; optional when the RFC 8785 (JCS) default for
  JSON is pinned to a registry version; forbidden when `contentFidelity` is
  `byte_faithful` (bytes are hashed directly, no canonicalizer applies) and
  forbidden alongside `contentHashUnavailableReason`;
- `contentHashUnavailableReason` — closed vocabulary
  (`unsupported_canonicalizer`): declares that retained content exists but
  no supported deterministic canonicalizer is available for its format.
  Required when `structurally_faithful` retained content exists and no
  canonicalizer applies; forbidden together with `contentHash` (the two
  states are mutually exclusive), forbidden when `contentFidelity` is
  `byte_faithful` (raw bytes are always directly hashable), and forbidden
  when no retained content exists (`missing`, `unknown`, `not_applicable`);
- `provenance` — source locator: path, URI, retrieval query, range, or hash.

An artifact declaration describes the **retained content**, never discarded
originals, and works identically for inline payloads and external payload
references. A standalone artifact (see below) serializes everything needed to
select its hashing path — `contentFidelity`, `contentType`, and `contentHash`
or `contentHashUnavailableReason` — without relying on an enclosing event or
envelope.

**Standalone artifacts are self-describing.** An artifact serialized inside a
trace may inherit `traceId` and `evidenceSchemaVersion` only when the enclosing
representation makes that inheritance unambiguous. A standalone artifact — any
artifact record that is not provably enclosed by its trace — MUST serialize
both `traceId` and `evidenceSchemaVersion` explicitly, and its `traceId` MUST
resolve to a known trace. Validators and readers MUST NOT rely on an unstated
enclosing context.

**Hash semantics.** `contentHash` is a SHA-256 digest whose input is the
**retained representation**, hashed as bytes. The hashing path is selected
**from the artifact's own serialized fields** — `contentFidelity`,
`contentType`, and `contentCanonicalizer` — never from an unstated enclosing
context:

| Retained representation | Hashing path | `contentHash` |
|---|---|---|
| `byte_faithful` bytes | Hash the retained byte sequence directly: the exact bytes observed by the capture surface, without decoding, normalization, canonicalization, or character-set conversion. Raw bytes are hashed as bytes; never treated as UTF-8 text. | **Required** (when `captured`) / MAY (when `redacted`/`truncated`, hashing only the retained representation) |
| `structurally_faithful` JSON | Canonicalize the retained logical value with RFC 8785 (JCS) (the schema-fixed default), encode the canonicalized value as UTF-8, and hash those bytes. | **Required** (when `captured`) / MAY (when `redacted`/`truncated`) |
| `structurally_faithful` other structured format with a supported canonicalizer | Canonicalize with the declared `contentCanonicalizer: { name, version }`, encoded as that canonicalizer's specified output encoding. | **Required** (when `captured`) / MAY (when `redacted`/`truncated`) |
| `structurally_faithful` structured content with **no** supported deterministic canonicalizer | No canonical form exists; reproducibility cannot be claimed without declaring every input needed to reproduce the bytes. | **Forbidden.** Declare `contentHashUnavailableReason: "unsupported_canonicalizer"` instead. |
| `missing` / `unknown` / `not_applicable` | No retained content exists to hash. | **Forbidden.** `contentFidelity` and `contentHashUnavailableReason` are forbidden too; claiming otherwise would imply content existed. |
| `redacted` / `truncated` | MAY hash only the retained representation (what remains after removal/masking, or the retained prefix) per the selected path above. | MAY (see rows above); never implies access to discarded content. |

- **Hash input** — only retained payload content is hashed; metadata and
  envelope fields are excluded unless they are explicitly part of the
  retained payload.
- **Equality with `nativeContentHash`** — the two digests are equal only
  when the retained representation is the exact observed byte sequence with
  no transformation applied (`byte_faithful`); they differ whenever
  canonicalization, decoding, or any other transformation was applied
  (§3.2).
- `contentHash` always hashes the **retained representation**; it never
  implies possession, verification, or reconstruction of discarded original
  content. Presence rules by `evidenceStatus`:

- `captured` — hash of the retained representation; required when a
  deterministic hashing path exists (the first three rows above), never when
  `contentHashUnavailableReason` is declared.
- `truncated` — MAY be present, hashing only the retained prefix or retained
  truncated representation, as explicitly declared (the truncation boundary
  declares the extent).
- `redacted` — MAY be present when policy permits, hashing only the retained
  redacted representation (what remains after removal/masking); it never
  implies possession of the discarded original. **Hashes are not a privacy
  mechanism:** a digest of low-entropy or secret content (authorization
  headers, tokens, API keys) is brute-forceable and MUST NOT be retained.
- `missing`, `unknown`, `not_applicable` — MUST NOT carry a content hash:
  SignalGlass cannot hash unavailable content, and claiming otherwise would
  imply content existed.

### 6.2 Context contributions

A context contribution records the act of adding context into a model request:

- references one or more artifacts;
- a deterministic locator into the artifact: `whole`, `range`, `fragment`, or
  `hash`;
- the position at which it appeared in the assembled context;
- provenance state: `recorded` (observed at capture) or `inferred_after`
  (derived later). `inferred_after` MUST be labeled as such and MUST NOT be
  presented as observed.

### 6.3 Provenance rules

- Provenance accompanies payloads; it MUST NOT alter them.
- Recorded provenance and inferred-after provenance MUST be distinguishable in
  serialized evidence.
- A `context_assembled` event carries a snapshot reference (or hash) of the
  assembled context at the boundary where it was assembled; it does not
  re-serialize the artifacts it references.

## 7. Measurement records

### 7.1 Definition

A **measurement record** is a deterministic derivation over evidence. It MUST
contain:

- `measurementId` and `type` (for example, `token_count`, `latency`,
  `duration`, `cost`, `repeated_content_ratio`);
- `value` and `unit`;
- `algorithm` — name and version of the derivation algorithm;
- `inputs` — references to the evidence it consumed (trace, event, envelope,
  and artifact ids) and the versions of those records;
- `configuration` — a reference or hash of the derivation configuration
  (tokenizer registry version, pricing table version, thresholds);
- `calculatedAt` — when the derivation ran;
- `kind` — one of:

| Kind | Meaning |
|---|---|
| `provider_reported` | The provider reported the value (for example, usage fields). |
| `locally_calculated` | Computed deterministically from captured evidence. |
| `reconciled` | Provider-reported and locally calculated values combined by a recorded rule. |
| `estimated` | Derived from a stated approximation model. MUST be labeled as an estimate. |

### 7.2 Determinism and scope

- A measurement is a **deterministic function of its declared evidence
  inputs, algorithm version, configuration, and applicable registries or
  tables** (tokenizer registry, pricing table, thresholds). The same inputs,
  algorithm version, and configuration MUST produce the same value.
- Different inputs MAY produce the same value (collisions are not a defect),
  so the input evidence and versions MUST be recorded with the result to keep
  it reproducible; changed inputs MUST be recorded, not asserted to produce a
  changed result.
- **Cost is a derivation, not evidence.** Cost records MUST reference the
  measurement(s) they multiply (token counts) and the pricing table version
  used. A cost record MUST NOT be written as if the provider billed it unless it
  is `provider_reported`.
- Measurements MUST be scoped to the observation boundary of their inputs. A
  token count computed from `client_sent` content is a statement about that
  content, not about provider-internal counts.
- Measurement records MUST NOT include subjective scores (for example, a
  "context quality score"). Quality judgments belong to interpretation records,
  where they are labeled as judgments.

## 8. Interpretation records

### 8.1 Definition

An **interpretation record** is a labeled, optional, versioned explanation or
judgment derived from measurements and evidence:

- `interpretationId`, `title`, and `kind` (for example, `smell`, `recommendation`,
  `finding`, `explanation`);
- `inputs` — the measurement and evidence records it is based on;
- `label` — a stable, non-score label (for example, `repeated-context`);
  labels MUST be versioned so their meaning is stable;
- `claim` — the judgment, written so that its evidence basis is checkable;
- `confidence` — one of `high`, `medium`, `low`, or `not_rated`. Interpretation
  confidence is an explicitly subjective field and MUST NOT be presented as a
  measurement.

### 8.2 Boundaries

- Interpretations MUST be reviewable: every claim cites the evidence or
  measurements it is based on.
- Interpretations MUST NOT alter evidence, and MUST NOT be persisted into raw
  evidence records.
- Interpretations are projections; the same trace MAY have many interpretation
  records, and none are required for the evidence to be complete.

## 9. Capture profiles and policy separation

### 9.1 Three independent policies

Collection, persistence, and export are **three independent policies**. A
change to one MUST NOT silently change another. A capture profile is a named,
versioned **bundle of policy references and configuration settings**: it
selects collection rules, persistence rules, and export defaults or permitted
export profiles, and may carry redaction configuration, retention
configuration, and environment-appropriate overrides. A profile is a
convenience bundling; it MUST NOT collapse the three policies into one, and
each policy keeps its own version and its own recording location (§9.2).

- **Collection policy** — what is observed and how: surfaces (client-side,
  ingress proxy, tool/MCP boundaries), boundaries, payload capture
  (full/excerpt), redaction and truncation rules, and event kinds.
- **Persistence policy** — retention, durability, storage form, deletion and
  purging rules, and administrative deletion handling.
- **Export policy** — what may be exported, in what shape (projections), and
  what must be excluded or redacted.

### 9.2 Rules

- **Where policy versions are recorded.** The collection policy version belongs
  to the capture context: the collection profile (or capture-surface
  declaration) in effect MUST be recorded on the trace, and records inherit it
  unless a record-level override is declared. The persistence policy version
  belongs to stored-record or storage-manifest metadata written by the storage
  layer at storage time — never to canonical raw evidence. The export policy
  version belongs to the export package or export manifest — never on
  canonical raw evidence records; the trace is not an export projection.
- **Evidence vs administrative metadata.** Collection context (what was
  observed, under which profile, by which surface) is evidence metadata.
  Persistence and export policy versions, storage timestamps, and deletion
  records are administrative metadata that describe operations on evidence,
  not observations; they are recorded beside the evidence, never merged into
  payload status.
- **Redaction stages stay distinct.** Collection-time redaction yields
  `evidenceStatus: "redacted"` at capture and is part of the evidence.
  Persistence-time removal is a deletion/tombstone operation (administrative)
  and the affected trace's completeness record notes it. Export-time
  sanitization is a projection under the export policy and MUST NOT overwrite
  authoritative evidence.
- The capture profile in effect MUST be recorded on the trace (profile name and
  version).
- Redacted exports are projections; they MUST NOT overwrite authoritative
  evidence.
- Administrative deletion MUST be recorded as a deletion record (a tombstone
  with reason and scope) rather than silently removed from the authoritative
  record, so completeness remains honest. A deletion record is an
  administrative record: it documents what was deleted, when, and under which
  policy; it does not reconstruct deleted evidence or restore trace
  completeness.
  - The tombstone MUST NOT live only inside the deleted trace, which may
    itself be purged. Where policy and law permit, it is retained separately,
    outside the deleted trace, as a non-sensitive administrative record that
    contains no deleted content, no sensitive payload data, no recoverable
    content hashes where those would create disclosure risk, and no
    identifiers the applicable deletion requirement prohibits retaining.
  - Where retaining even that record is prohibited, it is deleted as well, and
    the persistence policy MUST state explicitly that no audit evidence and no
    later completeness reconstruction survives.
- Exports and reports MUST label their policy context and MUST NOT claim to
  show evidence that the policy excluded.

## 10. Versioning

Versioning rules are detailed in [`docs/model-versioning.md`](../docs/model-versioning.md).
This spec requires:

- Every evidence record carries `evidenceSchemaVersion`, either directly or
  inherited through its trace reference; child records (events, artifacts,
  measurements, interpretations) that reference a trace inherit its schema
  version, and a record that does not reference a trace carries its own.
- The collection profile in effect is recorded on the trace (§9.2); derived
  records carry their algorithm and configuration versions. Persistence and
  export policy versions are recorded on storage and export metadata (§9.2),
  never on canonical evidence records.
- Schema evolution is **additive** by default: adding fields with defined
  defaults MUST NOT break readers of older records. Reinterpreting or removing
  fields is a **breaking change** requiring a new schema version and a projection.
- **Compatibility runs both directions.** Older readers MUST tolerate unknown
  additive fields in newer records without failing; newer readers MUST apply
  the defined default for fields absent from older records. Unknown fields
  MUST be preserved on read-modify-write round trips: "ignore unknown fields"
  never permits discarding them when evidence is re-serialized. A reader that
  cannot safely interpret a breaking version MUST refuse or require a
  projection; it MUST NOT silently misread.
- **Projections and migrations never rewrite authoritative evidence.**
  Projections are derived views of evidence; migration changes storage layout
  or indices, not the meaning of the records. Evidence is append-only:
  authoritative source records are not mutated in place. A schema migration
  produces a new version or a compatible projection and MAY store it, with
  provenance linking the new representation to its source records, the
  migration procedure, and the schema versions involved; the original remains
  preserved where retention policy permits. Deletion and retention
  requirements remain authoritative and MAY limit preservation. A reader that
  cannot safely interpret a breaking version MUST refuse it or use an explicit
  compatibility projection (§10).
- Evidence MUST remain interpretable without the current application version:
  records are self-describing and MUST NOT require the exporting application's
  code to decode them.
- Version identifiers for derivations (tokenizer registry, pricing table,
  measurement algorithms, interpretation labels) MUST be recorded with the
  derived record, never assumed from the current build.

## 11. Legacy supersession

### 11.1 Legacy specs

Upon acceptance, this spec will formally supersede the legacy v0.x model
specifications. Until then (this spec is Draft), specs 002, 003, and 004 remain
accurate records of the implemented v0.x state and are labeled in the
[spec index](000-index.md) as "legacy v0.x, pending supersession by 013", not
formally Superseded. They remain on `main` as historical records and are not
deleted.

| Spec | Legacy model | Status under 013 |
|---|---|---|
| [002 — Core domain](../specs/002-core-domain.md) | `AgentRun`, `Turn`, `ContextBlock`, token estimation, smells/recommendations | Pending supersession by 013. `AgentRun` will become a compatibility projection. |
| [003 — Offline analysis](../specs/003-offline-analysis.md) | Offline analysis pipeline over `AgentRun` | Pending supersession. Analysis will become interpretation records over evidence. |
| [004 — Trace model](../specs/004-trace-model.md) | `Trace`/`TraceEvent`, `ContentPhase`, `StorageMode` | Pending supersession. `Trace`/`TraceEvent` will become a compatibility projection over evidence. |

### 11.2 Compatible legacy concepts

- `StorageMode` (`minimal`/`standard`/`debug`) maps to collection-policy
  capture settings, not to a fixed evidence field.
- `ContentPhase` maps to observation roles (see §5.1), with the same boundary
  discipline: phase labels describe where content was observed, never
  provider-internal state.
- Token estimates map to `estimated` measurements; heuristic smells map to
  interpretation records with `low`/`medium` confidence.
- Trace-to-`AgentRun` conversion (spec 004) will become one documented
  projection; the inverse projection (evidence to trace view) will be
  supported the same way.

### 11.3 Legacy concepts that do not carry over

- "Optimization opportunity" as a first-class report output: the target
  architecture reports evidence and interpretations; optimization is an
  experimental condition or a labeled interpretation, not a canonical entity.
- Claims that application-visible requests prove provider-side behavior:
  forbidden by the observation-boundary rules (§5.2).

## 12. Visualization support

The evidence model MUST support both forensic and narrative visualization
without carrying presentation fields.

**Supporting (normative):**

- participants (`agent`, `model`, `tool`, `mcp`, `retrieval`,
  `context_provider`, `capture`) on events and spans;
- deterministic sequence (§2.2) for ordering and timeline rendering;
- span parentage and `seq` ranges for nesting and concurrency;
- provenance chains (§6) for "where did this content come from";
- transitions (`request` → `response`, `retry`, `error`, `cancelled`) for
  lifecycle rendering;
- evidence status (§4) for uncertainty rendering (redacted/truncated/missing/
  unknown/NA must remain visually distinct);
- raw evidence access (excerpts, payload refs, hashes) for drill-down.

**Not supporting (normative):**

- No panels, scenes, colors, coordinates, layouts, or other presentation fields
  in the evidence model. Storytelling is a projection; a view MUST NOT fictionalize
  intent or causality.

## 13. Examples

Full serialized evidence examples for the following are in
[`docs/evidence-model.md`](../docs/evidence-model.md) (§9). Each numbered
example is an independent trace: its own identifiers and its own `seq`
sequence starting at 0. Complete traces include `interaction_start` and
`interaction_end`; no example places an event after its terminal event, and
no partial example is presented as complete:

1. a minimal single-span interaction;
2. a model request and response with request/response envelopes;
3. streaming responses (`model_response_chunk`);
4. tool calls and results;
5. MCP calls and results;
6. retrieval with context artifacts and contributions;
7. context-provider (Graphify) activity;
8. errors, cancellation, and retries;
9. a trace with redacted, missing, and unknown evidence (including an
   explicit `missing` record), plus derived measurement and interpretation
   records that reference example 2's evidence.

The examples are normative illustrations of this spec's contract; where an
example conflicts with the prose above, the prose wins.

## 14. Acceptance criteria

- [ ] One interaction produces exactly one trace record.
- [ ] Every event carries a strictly increasing, contiguous `seq`; no record
  relies on timestamps for ordering.
- [ ] Raw evidence carries exactly one of the six evidence statuses; `inferred`
  appears only on derived records.
- [ ] Provider-native payloads survive capture at the declared fidelity
  (`structurally_faithful` or `byte_faithful`).
- [ ] Measurement records reference inputs, algorithm, and configuration
  versions; cost records reference a pricing table version.
- [ ] Collection, persistence, and export policies are independently configurable
  and recorded per capture point.
- [ ] Evidence records are self-describing and interpretable without the current
  application build.
- [ ] Legacy `Trace`/`TraceEvent` and `AgentRun` structures are expressible as
  documented projections, not as the canonical model.

## Tests

No production code changes are made on this branch. The mapping below is a
contract for future implementation specs:

- identity/ordering: `seq` contiguity, tie resolution, duplicate and gap
  handling;
- evidence status: status transitions and completeness aggregation;
- measurement determinism: same inputs → same values; cost derivation;
- projection round-trips: evidence → `Trace`/`AgentRun` and back;
- policy independence: changing export policy does not alter persistence.

## References

- [`docs/architectural-foundation.md`](../docs/architectural-foundation.md) (v0.1)
- [`docs/decisions/0004-evidence-first.md`](../docs/decisions/0004-evidence-first.md)
- [`docs/evidence-model.md`](../docs/evidence-model.md)
- [`docs/capture-profiles.md`](../docs/capture-profiles.md)
- [`docs/model-versioning.md`](../docs/model-versioning.md)
- [`docs/trace-model.md`](../docs/trace-model.md) (legacy, pending supersession by Spec 013)
- [`docs/versioning.md`](../docs/versioning.md)
- [`docs/glossary.md`](../docs/glossary.md)
- [`specs/000-index.md`](../specs/000-index.md)
