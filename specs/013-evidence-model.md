# Spec 013: Evidence model

## Status

Draft — current authority for the target architecture.

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
spec wins for the target architecture and the legacy documents become
compatibility projections (see [§11 Legacy supersession](#11-legacy-supersession)).

## Scope

- The canonical evidence record: interactions, traces, spans, events, context
  artifacts and contributions, request/response envelopes, observation
  boundaries, completeness, measurement records, and interpretation records.
- Deterministic identity and ordering rules.
- Evidence status and uncertainty semantics.
- Capture profiles (collection / persistence / export) as a contract.
- Versioning rules for evidence and derivations.
- Formal supersession of legacy specs 002, 003, and 004.

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

- `traceId` — stable, opaque identifier of a trace; the same value as the
  interaction's `id` (see §1.2). MUST be unique within a SignalGlass
  installation; SHOULD be globally unique (ULID-style values are recommended).
- `spanId` — stable, opaque span identifier, unique within the trace.
- `parentSpanId` — MAY be absent on root spans. Establishes **hierarchy only**;
  it MUST NOT be used for ordering.
- Event `eventId` — stable, opaque event identifier, unique within the trace.
- Artifact, measurement, and interpretation records carry their own stable ids.

Identifiers MUST be assigned at capture time, MUST be immutable, and MUST NOT be
derived from content. Content-derived identity (for example, a hash) is a
separate `contentHash` field, never an id.

### 2.2 Deterministic sequence ordering

**Rule:** Every event carries a `seq` — a non-negative integer, strictly
increasing **and contiguous** within the trace, assigned by the capture surface
at observation time. `seq` is the **only** deterministic ordering key. All other
ordering constructs (timestamps, hierarchy) are derived views over `seq`.

- Two events MUST NOT share a `seq` within one trace.
- `seq` values MUST be contiguous: the first event has `seq` 0, and every
  subsequent event's `seq` is exactly one greater than its predecessor's.
- `seq` is assigned by the capture surface, not by persistence or replay.
- Spans reference their start/end `seq` range (`startSeq`, `endSeq`).
- Total order is `seq`; partial order is the `parentSpanId` hierarchy.
- Concurrency: two spans are concurrent when their `seq` ranges overlap and
  neither is an ancestor of the other.

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
  completeness note (`duplicateDetected`), never two distinct events.
- **Dropped events:** because `seq` is contiguous (§2.2), any gap in `seq`
  within a trace is proof that at least one event was dropped (or never
  captured). The completeness record MUST report the gap and the adjacent
  event ids; SignalGlass MUST NOT invent the missing event.

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
  structure that was captured (for example, a JSON object), with field order
  and values equivalent to what was observed. Byte-for-byte equivalence is not
  claimed.
- `byte_faithful` (optional) — the raw bytes or text are preserved. This
  requires recording `nativeEncoding` and `nativeContentType` on the envelope;
  `nativeContentHash` SHOULD also be recorded.

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
  `mcp`, `retrieval`, `context_provider`, or `capture`), the observed error, and
  the observation boundary at which the error was observed. An error claimed at
  one boundary MUST NOT be attributed to another boundary without evidence.
- `cancelled` events MUST identify who or what requested cancellation and when
  the cancellation was observed.
- `retry` events MUST reference the original request's `eventId` and record the
  retry policy inputs observed (attempt count, delay) without asserting the
  provider's internal policy.

## 4. Evidence status

### 4.1 Status values

Every evidence payload (event content, envelope, artifact payload) carries an
`evidenceStatus` with one of:

| Status | Meaning |
|---|---|
| `captured` | Exact content is present. |
| `redacted` | Content existed; it was removed or masked per a recorded policy. The original content hash MAY be present. |
| `truncated` | Content existed; only a declared prefix or excerpt is stored. The truncation boundary MUST be recorded. |
| `missing` | Capture failed or did not occur; no claim is made about the content. |
| `unknown` | It cannot be determined whether the content existed (for example, provider internals). |
| `not_applicable` | No such content applies (for example, a stream-only control event has no request body). |

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
- `seq` gaps (dropped events) and duplicate detections;
- a boundary statement: what the interaction's observation boundary could not
  observe.

Completeness MUST be derived from the record, never fabricated, and MUST NOT
invent events to fill gaps.

## 5. Observation boundaries

### 5.1 Boundary-scoped observation roles

Each envelope and event payload records the **observation role** under which it
was captured:

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
- Each capture surface declares its boundary in every record it emits
  (`captureSurface` and `observationBoundary` fields).

## 6. Context provenance

### 6.1 Context artifacts

A context artifact is a referenceable unit of context:

- `artifactId` — stable id;
- `kind` — `message`, `file`, `document`, `fragment`, `tool_result`,
  `mcp_response`, `retrieval_result`, `context_provider_result`,
  `repository_content`, or `manual`;
- `payloadRef` — reference to the content (inline or external), with
  `evidenceStatus`;
- `contentHash` — deterministic hash of the payload;
- `provenance` — source locator: path, URI, retrieval query, range, or hash.

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

- The same measurement over the same evidence, algorithm version, and
  configuration MUST produce the same value.
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
change to one MUST NOT silently change another. A capture profile is a named
bundle of one setting from each policy, versioned, and recorded at every capture
point so evidence remains interpretable in its original policy context.

- **Collection policy** — what is observed and how: surfaces (client-side,
  ingress proxy, tool/MCP boundaries), boundaries, payload capture
  (full/excerpt), redaction and truncation rules, and event kinds.
- **Persistence policy** — retention, durability, storage form, deletion and
  purging rules, and administrative deletion handling.
- **Export policy** — what may be exported, in what shape (projections), and
  what must be excluded or redacted.

### 9.2 Rules

- The capture profile in effect MUST be recorded on the trace (profile name and
  version).
- Redacted exports are projections; they MUST NOT overwrite authoritative
  evidence.
- Administrative deletion MUST be recorded as a deletion record (a tombstone
  with reason and scope) rather than silently removed from the authoritative
  record, so completeness remains honest. A tombstone MUST NOT retain the
  deleted content or any sensitive payload data. Where legal or privacy
  requirements demand deletion without retaining identifying metadata, the
  tombstone itself MUST be deleted, and the persistence policy MUST acknowledge
  that the record is then permanently unrecoverable and completeness cannot be
  fully reconstructed.
- Exports and reports MUST label their policy context and MUST NOT claim to
  show evidence that the policy excluded.

## 10. Versioning

Versioning rules are detailed in [`docs/model-versioning.md`](../docs/model-versioning.md).
This spec requires:

- Every evidence record carries `evidenceSchemaVersion` and the capture profile
  version; derived records carry their algorithm and configuration versions.
- Schema evolution is **additive** by default: adding fields with defined
  defaults MUST NOT break readers of older records. Reinterpreting or removing
  fields is a **breaking change** requiring a new schema version and a projection.
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
| [002 — Core domain](../specs/002-core-domain.md) | `AgentRun`, `Turn`, `ContextBlock`, token estimation, smells/recommendations | Pending supersession by 013. `AgentRun` becomes a compatibility projection. |
| [003 — Offline analysis](../specs/003-offline-analysis.md) | Offline analysis pipeline over `AgentRun` | Pending supersession. Analysis becomes interpretation records over evidence. |
| [004 — Trace model](../specs/004-trace-model.md) | `Trace`/`TraceEvent`, `ContentPhase`, `StorageMode` | Pending supersession. `Trace`/`TraceEvent` become a compatibility projection over evidence. |

### 11.2 Compatible legacy concepts

- `StorageMode` (`minimal`/`standard`/`debug`) maps to collection-policy
  capture settings, not to a fixed evidence field.
- `ContentPhase` maps to observation roles (see §5.1), with the same boundary
  discipline: phase labels describe where content was observed, never
  provider-internal state.
- Token estimates map to `estimated` measurements; heuristic smells map to
  interpretation records with `low`/`medium` confidence.
- Trace-to-`AgentRun` conversion (spec 004) becomes one documented projection;
  the inverse projection (evidence to trace view) is supported the same way.

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
[`docs/evidence-model.md`](../docs/evidence-model.md) (§9):

1. a minimal single-span interaction;
2. a model request and response with request/response envelopes;
3. streaming responses (`model_response_chunk`);
4. tool calls and results;
5. MCP calls and results;
6. retrieval with context artifacts and contributions;
7. context-provider (Graphify) activity;
8. errors, cancellation, and retries;
9. a trace with redacted, truncated, missing, and unknown evidence, plus
   measurements and an interpretation.

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
- [`docs/trace-model.md`](../docs/trace-model.md) (legacy, superseded)
- [`docs/versioning.md`](../docs/versioning.md)
- [`docs/glossary.md`](../docs/glossary.md)
- [`specs/000-index.md`](../specs/000-index.md)
