# Spec 016: Streaming ingress and trace assembly

## Status

**Draft — revision 3 (second architectural correction pass).** Proposed for
acceptance; **implementation is prohibited until this spec is Accepted**. No
runtime code is produced by this PR. The proposed modules, contracts, and
constants below are named but **not created** until an accepted
implementation slice.

Revision 3 resolves the revision-2 review blockers: both lifecycle outcomes
(observation terminal and transport end) are persisted structurally in the
canonical record; declared losses move into the canonical 1.1 completeness
contract; the fabricated post-detachment frame count is removed; response
metadata gets one universal home (a `model_response` event at response-header
observation); the implementation-slice order is corrected (1.1 foundation
first); the persistence policy is versioned to
`signalglass.persistence.metadata-safe` v1.1.0; persistence observations are
split into structured `SaveOutcome` observations and leak-free environmental
failures (contention is never a `SaveOutcome`); the usage contract uses the
real `UsageRecord`/`UsageValue` shapes; duplicate choice indexes are rejected
and unmapped delta fields are declared losses; terminal-event sequencing is
reconciled (`error`/`cancelled`, then exactly one `interaction_end`); the
versioned identity fields are tightened (literal names, semantic versions,
bump table); and all claims, counts, and mappings are updated.

This spec is forecast-only in `docs/roadmap.md` (anticipated PR #23,
documentation-only; the implementation slices are a later, accepted
implementation PR).

## Purpose

Define how the OpenAI-compatible ingress ([Spec 006](006-ingress-openai-compatible.md))
observes a **streaming** chat-completions interaction and assembles **one
canonical `EvidenceRecord`** ([Spec 013](013-evidence-model.md),
[Spec 014](014-evidence-primitives.md)) from the observed pipeline — client
request → upstream dispatch → response headers → ordered SSE chunks → usage →
finish reason → `[DONE]` → errors/cancellation — with both lifecycle outcomes
recorded, structured declared losses, and persistence exactly once after the
client response path finishes, through the append-only evidence store
([Spec 015](015-append-only-evidence-store.md)).

Spec 006 implemented the non-streaming path only and explicitly declared
streaming a non-goal. Spec 014 §4.6 deferred streamed-observation ordering to
"later specifications" — this is that specification. Spec 015 provides the
append-only save/retrieve contract the assembled record is persisted through.
This spec sits between them: it turns an observed SSE byte stream into
evidence, without changing the evidence model's semantics, without adding a
second sequencing surface, and without letting provider shapes become the
internal model.

## Relationship to prior specs and docs

| Prior artifact | Relationship |
|---|---|
| [Spec 006](006-ingress-openai-compatible.md) | Non-streaming `POST /v1/chat/completions` forwarding, normalized error envelope, env-var API keys. Spec 016 extends the same endpoint for `stream: true` requests. |
| [Spec 013](013-evidence-model.md) | Canonical evidence contract this spec assembles: `model_response`, `model_response_chunk`, `model_usage`, `error`, `cancelled`, `interaction_start/end`, `span_start/end`, evidence statuses, observation roles, capture boundary. |
| [Spec 014](014-evidence-primitives.md) | `@signalglass/evidence` types/validators/serialization the assembler's output must satisfy; §4.6 (streamed observations ordered by the single sequencing surface) is implemented by this spec; §4.7 terminal-state rules bind the assembler's status decisions; `TraceCompleteness` (Spec 014 §2.2.9) gains the 1.1 fields (§13); `ResponseEnvelope.chunkIndex` semantics are refined additively (§13). |
| [Spec 015](015-append-only-evidence-store.md) | `EvidenceStorage.saveEvidenceRecord` — the only persistence path for assembled records; `SaveOutcome` (a closed status union **without** `contention` — exhaustion throws `EvidenceContentionError`); the `metadata-safe` reference policy and its versioning contract (§14); the storage-safety gate is non-bypassable. |
| [`docs/ingress.md`](../docs/ingress.md) | Current non-streaming live-mode data flow; Spec 016's implementation updates it. |
| [`docs/trace-model.md`](../docs/trace-model.md) | "Streaming response event refinement" is listed as future work; the legacy `Trace` path becomes a compatibility projection (Spec 016 §9). |
| [`docs/privacy.md`](../docs/privacy.md) | Default capture/persistence boundaries the assembler must honor (metadata-safe defaults, env-var-only keys, no raw payloads by default). |
| [`docs/roadmap.md`](../docs/roadmap.md) | Streaming milestone; slice #23 (this spec); slice #40 (reliability/recovery — crash-recovery journaling is deferred to it). |

## Scope

Define, for a **streaming** OpenAI-compatible interaction observed by
`apps/ingress`:

1. The two lifecycles — client passthrough and evidence observation — and
   their separation (Spec 016 §1).
2. Both lifecycle outcomes persisted independently in the canonical record
   (observation terminal + transport end + delivery outcome) (Spec 016 §2).
3. The assembly/persistence boundary: one canonical record, one save, after
   the client response path finishes (Spec 016 §3).
4. Deterministic identity and `seq` ordering (Spec 016 §4).
5. Streaming transparency: response-**body**-byte/order-transparent,
   backpressured passthrough with no silent frame mutation, and the four
   observation layers (Spec 016 §5).
6. SSE parsing, provider-neutral multi-choice normalization, and the
   terminalization matrix (Spec 016 §6).
7. The evidence-status vocabulary and the structured loss mapping for every
   assembled payload (Spec 016 §7).
8. Collection vs. persistence policy boundaries, including the
   collection-time privacy process (Spec 016 §8).
9. Legacy coexistence: canonical-authoritative dual emission with divergence
   detection (Spec 016 §9).
10. The deterministic terminal state machine and the single terminal-event
    sequence (Spec 016 §10).
11. Package boundaries and the proposed module layout (Spec 016 §11).
12. Public contracts: provider-boundary output types, closed vocabularies,
    and the completeness summary (Spec 016 §12).
13. The canonical schema extension: additive `evidenceSchemaVersion` 1.1.0
    and its exact fields (Spec 016 §13).
14. Persistence-policy versioning: `metadata-safe` v1.1.0 (Spec 016 §14).
15. The structured assembler-version location (Spec 016 §15).
16. Persistence outcomes: structured `SaveOutcome` observations vs. leak-free
    environmental failures (Spec 016 §16).

The spec also defines the data flow (§17), privacy and diagnostic rules
(§18), declared losses and crash limitations (§19), the phased implementation
sequence (§20), the testing and conformance requirements (§21), acceptance
criteria (§22), the criterion-to-test mapping (§23), open questions (§24),
documentation impact (§25), and references (§26).

## Non-goals

The following are **excluded from this spec** (no implementation in this
spec's PR, no planning delegation into its slices; each is a later slice in
the roadmap):

- Pi hooks / provider-boundary capture (roadmap #24), Pi agent/tool/MCP
  instrumentation (#25), Graphify capture (#27).
- Deterministic measurements — token accounting, latency/duration, cost
  (#26). The assembler computes no `durationMs` and no token counts; it only
  records provider-reported usage verbatim as evidence.
- Trace query/read API (#28), React trace explorer and comparison UI
  (#29/#30), secure export (#31).
- Retention, deletion records, tombstones, purging (#38).
- Replay package (#35).
- OpenTelemetry export/import (#37).
- A second provider adapter (#36) — `openai-compatible` only.
- Revisions/upserts of canonical records, checkpointing, and crash-recovery
  journaling for interrupted streams (#40). Mid-stream persistence is
  explicitly **not** added; the crash limitation is declared (§3.3, §19.2).
- Native-byte retention (`byte_faithful` envelopes) as a default and raw
  byte-payload persistence; `structurally_faithful` is the default fidelity
  and byte retention is out of scope (a later capture-fidelity slice).
- Client streaming input (streaming request bodies) — the request body is a
  single bounded JSON document (existing `readJsonBody` behavior).
- Automatic upstream retries — exactly one dispatch attempt per interaction;
  the `retry` event kind is not emitted by this slice.
- Automatic optimization of any kind, and any mutation of client traffic
  other than the documented passthrough and error-path envelopes.

## RFC-style terms

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## Terminology

| Term | Meaning |
|---|---|
| **Streaming interaction** | One observed `POST /v1/chat/completions` request with `stream: true`, its upstream dispatch, and its response stream. Exactly one `EvidenceRecord`. |
| **Transport lifecycle** | The lifecycle that owns the client socket and the upstream connection: request received → response forwarded → ended. Only client cancellation, ingress shutdown/limit, or upstream transport failure ends it (§1.2). |
| **Observation lifecycle** | The evidence-assembly lifecycle: the assembler's state machine (§1.3, §10). Observer failures degrade it; they never end the transport lifecycle. |
| **Observation terminal** | The terminal state of the observation lifecycle — one of the seven `TerminalReason` values (§10). |
| **Transport end** | The end reason of the transport lifecycle — one of the four `TransportEndReason` values (§2). |
| **Delivery outcome** | Whether the response body was fully flushed (`flushed`) or the connection ended before completion was observed (`closed`) (§2). |
| **Sequencing surface** | The single capture component that assigns `seq` at observation time (Spec 013 §2.2). In this spec it is the assembler (§4). |
| **Observer failure** | Any failure of the parsing/decoding/assembly machinery (exception, configured bound exceeded, unsupported encoding, decode failure) — distinguished from malformed provider protocol (§1.4). |
| **Malformed provider protocol** | The provider's stream violates the observed protocol (invalid JSON/UTF-8 in data, invalid or duplicate choice index, EOF/partial frame without `[DONE]`) — a provider-side observation, not an observer failure (§1.4). |
| **Observation detachment** | The explicit degraded state after an observer failure: canonical extraction stops; the transport passthrough continues unaffected; the record finalizes with status `unknown` (§1.4, §10). |
| **SSE frame** | One server-sent-event block: field lines terminated by a blank line. The parser's output unit (§5, §6). |
| **Transport byte** | The raw upstream response-body bytes observed at the ingress boundary, exactly as read from the socket (no decoding, no decompression). Never mutated by the ingress (§5). |
| **Parsed stream event** | A provider-neutral normalized event from the decoder's frame result: `chunk` / `usage` / `provider-error` (§6, §12). |
| **Canonical event** | An `EventRecord` (Spec 013 §3.1) the assembler derives from parsed stream events and lifecycle signals. |
| **Response-metadata event** | The single canonical `model_response` event emitted when response headers are observed, before any chunk/usage/error, carrying `responseMeta` (§6.6, §13.3). |
| **Terminal marker** | The `[DONE]` data frame that signals normal stream termination. |
| **Terminal reason** | One of the closed `TerminalReason` values (§10, §12). |
| **Passthrough** | Forwarding the upstream response-body bytes to the client with content and order preserved (§5). |
| **Backpressure** | Slowing or pausing the upstream read when the client cannot consume (§5). |
| **Dual emission** | Emitting both the canonical record (Spec 015) and the legacy `Trace` (Spec 007 path) for one interaction (§9). |
| **Divergence detection** | Comparing the canonical record's legacy projection with the independently emitted legacy trace (§9). |
| **Completeness summary** | The assembler-level accounting of what was observed, dropped, and declared (§12). |
| **Capture profile** | The named, versioned bundle of collection settings recorded on the trace (`captureProfile`, Spec 013 §9). |
| **Declared content** | Content admitted only under an owning `redacted`/`truncated` declaration (Spec 015 `metadata-safe`). |
| **Retained excerpt** | The bounded representation of content the collection process retains: normalized text, an owning `truncated`/`redacted` status, and the owning declarations (§8). |
| **Save outcome** | The structured `SaveOutcome` status union returned by `saveEvidenceRecord` (Spec 015) — never includes contention (§16). |
| **Environmental failure** | A persistence failure that is not a `SaveOutcome`: thrown `EvidenceContentionError` or storage/policy exceptions caught by this slice, reduced to a closed leak-free code (§16). |

---

## 1. Two lifecycles: client passthrough and evidence observation

**Decision 1 — the client passthrough lifecycle and the evidence-observation
lifecycle are distinct. An observer/parser/decoder failure must not destroy
the upstream request, stop reading bytes the client needs, inject a frame, or
truncate an otherwise forwardable response. Neither lifecycle is rewritten
from the other.**

### 1.1 Why two lifecycles

The revision-1 draft treated parse/observe failures as terminalization
inputs while also promising they never affect client traffic — a
contradiction. The resolution is structural: the ingress runs **two
independent lifecycles over the same byte stream**:

1. **Transport/passthrough lifecycle** — owns the client socket and the
   upstream connection. Its only job is to move response-body bytes from the
   upstream to the client with content and order preserved, under
   backpressure. **Nothing in the observation layer can end it.**
2. **Evidence-observation lifecycle** — the assembler state machine (§10).
   Its only job is to turn observed bytes into canonical evidence. Its
   failures affect the evidence, never the transport.

The observation layer is a **tee** on the transport byte stream: it consumes
a copy and feeds nothing back into the forwarded stream.

**Both lifecycle outcomes are observed facts, and both are persisted
independently in the canonical record** (§2): the observation terminal (from
the observation lifecycle) and the transport end with its delivery outcome
(from the transport lifecycle). One is never derived from the other.

### 1.2 Transport lifecycle

States:

```text
awaiting-response → forwarding → ended
```

End reasons (closed set) — **the only reasons forwarding stops**:

| End reason | Trigger | Client impact |
|---|---|---|
| `response-complete` | Upstream response body fully read and fully flushed to the client | Normal close |
| `client-cancelled` | Client socket closes/disconnects mid-stream | Connection closed (client-initiated) |
| `ingress-shutdown` | Server shutdown or a configured ingress limit forces cancellation | Connection closed by ingress |
| `upstream-transport-failure` | Upstream connection error, timeout, or premature EOF mid-stream | Connection closed; no further bytes possible |

No other event may stop forwarding — in particular, **no observer failure
(parser exception, decoder exception, frame overflow, unsupported encoding,
decode failure) may stop forwarding, destroy the upstream request, or
truncate an otherwise forwardable response.** A malformed provider frame is
forwarded to the client exactly as received (§1.4).

The transport lifecycle can end **after** the observation lifecycle has
already terminalized (e.g. `[DONE]` parsed, then the client disconnects
before the final bytes flush, or ingress shutdown interrupts delivery) —
these facts are recorded separately, never merged (§2).

### 1.3 Observation lifecycle

The observation lifecycle is the assembler's state machine (§10). Its
terminal states are: `completed`, `upstream-failed`, `client-cancelled`,
`ingress-cancelled`, `malformed-stream`, `request-failed`, and
`observation-detached`. The observation terminal and the transport end are
**independent**: either may occur first, and persistence waits for the
transport end (§3.2).

### 1.4 Malformed provider protocol vs. internal observer failure

Two failure classes are distinguished with different trace statuses, actors,
roles, and completeness:

| Class | Examples | Trace status | Terminal event | Actor / role | Completeness |
|---|---|---|---|---|---|
| **Malformed provider protocol** | `data` value is not valid JSON; invalid UTF-8 in a data value; non-integer/negative/duplicate choice index; EOF or partial frame without `[DONE]` | `failed` | `error` (terminal) | `model` / `provider_reported` (the provider's stream was observed to violate the protocol) | Declares the malformed frame and the unobserved remainder |
| **Unrecognized provider extension** (valid JSON, unknown shape) | A frame that decodes to no recognized chunk/usage/error/done shape | Unaffected (not terminal) | None | — | Declared loss `unrecognized-extension-frame`; observation **continues** |
| **Internal observer failure** | Parser/decoder/assembler exception; frame-overflow observation bound; unsupported content-encoding; decoder-tee decode failure | `unknown` | Informational `error` (actor `capture`, `lifecycleTarget: "none"`, `lifecycleEffect: "none"`) — non-terminal | `capture` / `unobservable` | Declares observation detachment and the unknown remainder |

Rules:

- **An unrecognized extension is not a provider failure.** A successfully
  forwarded interaction is never labeled a model failure merely because
  SignalGlass could not decode an extension. The frame is a declared loss
  (`unrecognized-extension-frame`) and canonical extraction continues with
  the next frame.
- **A malformed provider protocol frame is a provider-side observation**:
  the provider's stream is observed to violate the protocol. The canonical
  record terminalizes `malformed-stream` (trace `failed`, actor `model`,
  role `provider_reported`). The **client still receives the frame bytes
  unchanged** — protocol classification is an observation decision, not a
  transport decision.
- **An internal observer failure detaches observation** (§1.5): canonical
  extraction stops, the record finalizes with status `unknown` (the
  termination could not be observed — Spec 014 §4.7), and an informational
  `error` event (actor `capture`, target `none`, effect `none`) makes the
  failure visible without declaring the interaction failed. The transport
  passthrough is untouched.

### 1.5 Observation detachment

After an observer failure:

1. Canonical event extraction **stops** (or never starts, e.g. unsupported
   encoding at response start).
2. Subsequent unobserved frames receive **no `seq`** (nothing was assigned at
   the sequencing surface; Spec 013 §2.2).
3. **No later `[DONE]`, content, or completion is inferred** if observation
   was detached — the record's status stays `unknown` even if the client
   later receives a complete stream.
4. The completeness summary declares the observation boundary honestly
   (§12.3): `observationDetached: true`, the last observed frame position
   when known, `remainderObservation: 'unknown'`, and **no inferred frame
   count** for anything the observer could not see.
5. Persistence occurs only after the client response path has actually
   finished (§3.2, §16) — including after observation degradation.

---

## 2. Both lifecycle outcomes persisted independently

**Decision 2 — the observation terminal and the transport end are separate
observed facts; both are persisted structurally in the canonical record;
response delivery is recorded as `flushed` or `closed`; neither lifecycle
rewrites the other.**

### 2.1 The two persisted facts

Every streaming record assembled by this spec persists, additively on the
canonical completeness (Spec 016 §13.2):

```ts
// canonical 1.1 — serialized at EvidenceRecord.completeness.lifecycle
lifecycle: {
  observation: { terminal: TerminalReason };           // the observation lifecycle's terminal
  transport: { end: TransportEndReason; delivery: DeliveryOutcome };
}
```

- `TerminalReason` (closed, §12.2): `completed | upstream-failed |
  client-cancelled | ingress-cancelled | malformed-stream | request-failed |
  observation-detached` — the observation terminal, from the assembler's
  state machine.
- `TransportEndReason` (closed): `response-complete | client-cancelled |
  ingress-shutdown | upstream-transport-failure` — the transport lifecycle's
  end reason (§1.2).
- `DeliveryOutcome` (closed): `flushed | closed`.
  - `flushed`: the ingress wrote every byte it received and observed response
    completion (`finish`) — the response was delivered to the OS for the
    client. (TCP delivery beyond the socket is not observable and is not
    claimed.)
  - `closed`: the connection ended before completion was observed — client
    disconnect, ingress shutdown/limit, or upstream failure mid-delivery —
    including cases where some bytes had already been written.
- **Independence rule**: the observation terminal comes only from the
  observation lifecycle; the transport end/delivery come only from the
  transport lifecycle. `trace.status` is derived **only** from the
  observation terminal (§10.3). The transport facts are recorded alongside;
  they never change the status, and the observation terminal never rewrites
  the transport facts.

### 2.2 Combinations that must be representable

| Observation terminal | Transport end | Meaning (all persisted as-is) |
|---|---|---|
| `completed` (`[DONE]` parsed) | `response-complete`, `flushed` | Normal completion |
| `completed` (`[DONE]` parsed) | `client-cancelled`, `closed` | `[DONE]` parsed, then the client disconnected before the response finished |
| `completed` (`[DONE]` parsed) | `ingress-shutdown`, `closed` | `[DONE]` parsed, then ingress shutdown interrupted delivery |
| `observation-detached` | `response-complete`, `flushed` | Observer detached early, but the transport still delivered everything |
| `observation-detached` | `client-cancelled`, `closed` | Observer detached, then the client cancelled |
| `malformed-stream` | `response-complete`, `flushed` | Malformed observation terminalized, yet the passthrough completed successfully |
| `malformed-stream` | `upstream-transport-failure`, `closed` | Both failed (possibly the same underlying event, recorded in each lifecycle's own vocabulary) |
| `client-cancelled` | `client-cancelled`, `closed` | Both lifecycles observed the same client disconnect |
| `request-failed` | `response-complete` (no response existed) | Not representable — a request that never dispatched has no transport response; `transport.end` is still recorded with the end reason the transport observed (`client-cancelled`, `ingress-shutdown`, or `upstream-transport-failure` when applicable), or `response-complete` is never asserted for a path with no response |

**Precedence/independence rule**: the first observed terminal wins within
each lifecycle independently. `[DONE]` before client close ⇒ observation
`completed` AND transport `client-cancelled` (never "cancelled" as the
trace status — the observation genuinely completed). A malformed observation
followed by successful passthrough ⇒ `malformed-stream` AND
`response-complete`/`flushed` (the trace stays `failed`; the transport fact
records that the client nevertheless received the bytes).

### 2.3 Persistence of the lifecycle facts

- The lifecycle facts are persisted **in the canonical record** (1.1
  `completeness.lifecycle`), not only in an ephemeral assembler result or
  logs (§13.2). They round-trip through serializer/parser, survive storage
  retrieval, and are covered by the `metadata-safe` v1.1.0 policy matrix
  (§14).
- The assembler's `CompletenessSummary` carries the same facts pre-save
  (§12.3); the canonical record is the durable source.

### 2.4 Race tests required

- `[DONE]` parsed, then client close before response finish → observation
  `completed`, transport `client-cancelled`/`closed`, both persisted.
- Observation detaches, then the transport completes → observation
  `observation-detached`, transport `response-complete`/`flushed`, both
  persisted.
- Malformed observation, then successful passthrough completion → observation
  `malformed-stream`, transport `response-complete`/`flushed`, both
  persisted.
---

## 3. Assembly and persistence boundary

**Decision 3 — one canonical record, one save, after the client response
path finishes; no checkpointing or revisions; the crash limitation is
declared honestly.**

### 3.1 Single canonical save

- Each observed streaming interaction produces **exactly one**
  `EvidenceRecord` (§17 data flow), assembled in memory across the whole
  stream.
- The record is handed to persistence **exactly once**, after the transport
  lifecycle has ended (§3.2), through the only permitted persistence path:
  `EvidenceStorage.saveEvidenceRecord(record)` (Spec 015).
- There is **no checkpointing**: no partial records, no in-progress writes,
  no revisions, no upserts, no periodic snapshots. The append-only contract
  of Spec 015 is unchanged; the assembler adds no second write path.
- An interaction that reaches a terminal observation state always produces a
  record — including failures, cancellations, and detached observations
  (status `unknown`). The `status` vocabulary
  (`completed` / `failed` / `cancelled` / `unknown`) is never invented; it is
  derived from the observation terminal per §10.3.

### 3.2 Persistence timing: after the response path finishes

- **Observation terminal and response-path completion are separate.**
  The assembler reaches its terminal observation state when the terminal
  event is observed (e.g. `[DONE]` may be parsed — and canonical completion
  determined — before the final bytes have flushed to the client).
- The **save waits until the client response path has finished or closed**
  (`finish`/`close`), not until the observation terminal:
  - a synchronous Spec 015 save MUST NOT occur in the forwarding/backpressure
    data path;
  - the save runs once, after the response path ended, on the
    terminalization/finalization path outside any data handler;
  - a storage failure is therefore always post-response and can neither
    delay nor mutate client bytes (§16).
- The client response and the persistence save are independent: the ingress
  finalizes the client's response first and always; the save outcome is
  observable (§16) but never rewrites the interaction outcome.

### 3.3 Honest crash limitation

- If the process crashes, is killed, or loses power **before** the save,
  the interaction has **no persisted record**. This is a declared loss, not
  a defect to be papered over:
  - the loss is stated in `docs/ingress.md` and `docs/roadmap.md` (§19.2);
  - the spec does **not** fabricate a record, a "recovered" identity, a
    completion, or a placeholder document for an unpersisted stream;
  - `crash-no-record` is a **system-level declaration** (§19.2), never a
    per-record loss code: a record that exists was persisted, so the code
    cannot appear on it, and a crashed interaction has no record to carry it;
  - crash-recovery journaling for interrupted streams is explicitly deferred
    (roadmap #40, "Reliability, recovery, and incomplete-trace handling").
- If the process crashes **after** the save returned `stored`, the record is
  durable per Spec 015 (WAL, transactional save).

### 3.4 No conditional persistence based on outcome

- The assembler does not skip the save because the terminal state is a
  failure, cancellation, or detached observation; failed, cancelled,
  malformed, and detached interactions are persisted like completed ones
  (subject to the storage-safety gate and persistence policy, which may
  refuse a specific record — §16).

---

## 4. Identity and deterministic ordering

**Decision 4 — sequence numbers and opaque identities are the only ordering
and identity keys; timestamps and content hashes never order or identify;
choice identity is honest (rejected duplicates, declared unmapped fields).**

### 4.1 Identity

- `traceId` == `interactionId` (Spec 013 §1.2, §2.1): a single opaque value
  assigned by the ingress **when the request is first observed** — the moment
  `POST /v1/chat/completions` headers are received, before the body is read
  or parsed. Every subsequent failure (including an unreadable body) is
  recorded against this identity, so "one observed request → one record"
  holds by construction.
- Identity is opaque, capture-time, immutable, and **never derived from
  content** (no request-hash, no message-hash, no body digest as identity).
  ULID-style values are recommended; uniqueness per installation is required
  and global uniqueness SHOULD be pursued. Identity is assigned fresh per
  observed request; a retrying client that re-POSTs produces a new
  interaction with a new identity.
- `eventId` values are opaque, assigned at capture, unique within the trace.
- `observationId` values are assigned by the assembler at the capture
  boundary, unique and immutable (Spec 014 §2.1).

### 4.2 Choice identity vs. chunk ordinal (multi-choice)

- **`choiceIndex` (additive, §13) is the normalized choice identity**: which
  choice a chunk belongs to. It is derived from the provider's
  `choices[i].index` when present and valid, else the array position, else
  `0` for a single choice (§6.3). It is **never** a chunk counter.
- **`chunkIndex` is the per-choice content-chunk ordinal**: a 0-based
  counter of content-bearing chunks *within one choice*, maintained by the
  assembler per `choiceIndex`. For a single-choice stream this is identical
  to the existing fixture semantics (0, 1, 2, …), so the existing
  `trace-3` fixture and the projection-matrix claim E2L-073 remain valid.
- The two are **never interchangeable**: `choiceIndex` answers "which
  choice", `chunkIndex` answers "which chunk of that choice".
- **Duplicate `choice.index` values within one frame are rejected as
  malformed** (`sse-invalid-choice-index`, §6.3): two distinct choices
  claiming one identity in the same frame is ambiguity the contract refuses.
  The same `choiceIndex` **across frames** identifies the same choice stream
  and is its continuation (chunks accumulate per-choice ordinals). With the
  same-frame rejection, `choiceIndex` is unique within a frame by
  construction, and across frames it is a stable choice identity.

### 4.3 Sequence ordering

- The assembler is the trace's **single authoritative sequencing surface**
  (Spec 013 §2.2). It assigns `seq` to every canonical event at the point of
  observation, **before** terminalization and before persistence. Persistence
  and replay never assign `seq`.
- `seq` starts at `0` (`interaction_start`) and is strictly increasing and
  contiguous **as assigned**: every subsequent canonical event's `seq` is
  exactly one greater than its predecessor's. The assembler never renumbers,
  never backfills, and never compresses.
- **Timestamps never order.** `capturedAt` (ISO 8601 UTC) may tie between
  events; ties are resolved by `seq` (Spec 013 §2.3). The assembler MAY use a
  single captured timestamp for events observed in one burst.
- **Content hashes never order or identify.** `nativeContentHash` /
  `contentHash` (when present in later slices) are integrity fields, never
  ordering keys and never identity (Spec 013 §2.1).
- **Frames that fail to parse get no `seq`.** Only canonical events are
  sequenced. A frame dropped at the parser or decoder boundary — or any
  frame observed after observation detachment — leaves **no seq gap** (no
  position was assigned); the loss is disclosed through the evidence status,
  the declared-loss codes, and the completeness summary, never through a
  fabricated gap in the canonical sequence.

---

## 5. Streaming transparency

**Decision 5 — the ingress forwards the upstream response-body bytes with
content and order preserved, under backpressure, with zero frame mutation.
Transparency applies to the response body bytes; response headers are
ingress-constructed via a validated bounded allowlist. Encoded streams are
forwarded as-is and observed through a bounded decoder tee.**

### 5.1 The transparency boundary: response body bytes, not headers

- Transparency — "forward unchanged" — applies to the **response body
  bytes** observed at the ingress boundary: every byte received from the
  upstream connection is written to the client connection in order, and
  nothing is injected into or removed from that byte stream, except that the
  stream is necessarily re-chunked at the TCP layer by Node (a chunked write
  has no observable content semantics).
- **Response headers are not transparent.** The upstream's response headers
  are never forwarded wholesale. The ingress constructs the client's response
  headers from a **validated bounded allowlist**:
  - `content-type` — forwarded when present and valid (media type only;
    parameters are dropped and declared lost; see §13.3);
  - `content-encoding` — forwarded when present and a single token;
  - `x-signalglass-trace-id` — added by the ingress (Spec 006);
  - no other upstream response header value is retained or forwarded
    (set-cookie, authorization, x-api-key, custom provider headers, and all
    others are excluded structurally).
- Wording rule for this spec and its derived docs: **"no response header
  values are retained except the validated bounded allowlist"** — never "no
  header values", because `content-type` (and `content-encoding`) are
  retained header values by design.
- `content-length` is **never** forwarded: the ingress re-chunks the
  passthrough, Node sets `transfer-encoding`, and a forwarded stale
  `content-length` would corrupt the client's framing.

### 5.2 The four observation layers

The ingress reads the upstream response as **raw `Buffer` chunks** (the
streaming slice must not use `res.setEncoding('utf8')`, which pre-decodes
and hides wire bytes). Each chunk passes through four strictly separated
layers:

```text
L1  transport bytes     raw Buffer chunks as read from the socket (wire bytes; never mutated)
L2  SSE frames          the parser's incremental framing of the byte stream (fields, [DONE])
L3  parsed stream events  the decoder's provider-neutral normalized events (§6.2, §12)
L4  canonical events    EventRecords assembled by the assembler (Spec 013 shapes)
```

- L1 is the only layer with byte access; L2–L4 operate on copies/derived
  values and can never mutate the forwarded bytes.
- A provider's decoded JSON content lives only in L3/L4. **Raw provider
  JSON is retained only under the `providerNative` contract with explicit
  fidelity and status (§7.2, §12.1)**; otherwise it is a declared loss
  (`provider-native-not-retained`).

### 5.3 Backpressure

- The upstream read is paused when the client cannot consume (backpressure):
  the passthrough never buffers unboundedly, and a slow client pauses the
  upstream read (`readable.pause()` / stream flow control).
- Idle-timeout semantics (30 s default): the client response is closed after
  an idle period with no forward progress. This is a transport decision (an
  ingress limit), so it ends the transport lifecycle via
  `ingress-shutdown`-class cancellation (§1.2); the observation lifecycle
  records `ingress-cancelled` (§10) when it is still active.
- There is **no total-response timeout** that kills long-lived streams; the
  existing 30 s `forwardToUpstream` timeout covers the upstream request
  establishment, not the response stream.

### 5.4 Zero frame mutation

- The ingress never injects, removes, reorders, or rewrites SSE frames. In
  particular:
  - no synthetic `[DONE]` is appended if the stream ends mid-way;
  - no keep-alive comment is inserted;
  - no frame is re-serialized;
  - no malformed frame is repaired before forwarding.
- A mid-stream upstream failure means the connection ends as the upstream
  ended it — truncated at the transport layer, never "completed" by
  synthesis. Only the pre-dispatch error path (Spec 006) generates an
  envelope, and it does so only when no response bytes have been sent.

### 5.5 Encoded streams

The upstream MAY ignore `Accept-Encoding: identity` (a preference, not a
guarantee) and return an encoded body. The contract is implementable and
byte-exact:

| Case | Passthrough | Observation |
|---|---|---|
| No `content-encoding` (identity) | Raw bytes forwarded unchanged | Parser parses bytes directly |
| `content-encoding: gzip` / `deflate` | **Raw encoded wire bytes forwarded unchanged** (Node's `http`/`https` client does not auto-decompress; the ingress does not decode the forwarded stream) | A **bounded decoder tee** (`zlib`) decodes a copy; the parser consumes the decoded copy |
| `content-encoding` unsupported (`br`, `zstd`, unknown) | Raw bytes forwarded unchanged | `observation-encoding-unsupported`: observation detaches (§1.4); passthrough untouched |
| Decoder tee failure mid-stream | Raw bytes forwarded unchanged | `observation-decode-failure`: observation detaches; passthrough untouched |

- `content-encoding` (when present and valid) is forwarded in the header
  allowlist so the client can decode; `content-length` is never forwarded
  (§5.1).
- **An encoded `text/event-stream` is an SSE response**, not a
  "non-SSE response": it takes the SSE observation path (over the decoded
  copy) and its outcomes are the SSE outcomes (§6.5). `non-sse-response`
  refers to a 2xx response whose `content-type` is not `text/event-stream`
  at all (§6.5).
- The decoder tee is bounded (same 16 MiB frame cap); a decode failure is an
  internal observer failure (`observation-decode-failure`), never a provider
  protocol verdict.

### 5.6 Byte-boundary verification

- The implementation must prove byte transparency by test (§21 T55–T56):
  for every encoded/plain scenario, the bytes written to the client are
  exactly the bytes read from the upstream (header construction excepted).
---

## 6. SSE parsing, multi-choice normalization, and terminalization

**Decision 6 — the parser and decoder produce ordered, provider-neutral,
frame-level results; one frame expands to zero or more canonical events in
deterministic order; choice identity and chunk ordinal are distinct;
duplicate choice indexes in one frame are rejected; unmapped delta fields are
declared losses; the terminalization matrix is closed.**

### 6.1 The parser (L2)

`createSseParser()` (proposed in `@signalglass/streaming`, §11) implements a
strict SSE framing of the raw byte stream (per the
[SSE specification](https://html.spec.whatwg.org/multipage/server-sent-events.html))
with the streaming-terminalization extension (`[DONE]` data frame). Its
behavior matrix:

| Input | Behavior |
|---|---|
| Comment lines (`:`) | Skipped (not canonical events) |
| Blank lines | Frame terminator |
| `data:` lines (multiline) | Joined with `\n` (spec-conformant) |
| `event:` / `id:` / `retry:` fields | Parsed; not canonical events (their values are not retained) |
| CRLF, LF, CR line endings | Accepted per spec |
| Frame split across chunks | Accumulated until the blank line; memory-bounded (16 MiB frame cap) |
| Multi-byte UTF-8 split across chunks | Decoded **per frame** (chunks are not concatenated into one string; each frame is decoded independently) |
| `data: [DONE]` exact value (no trailing whitespace) | Terminal marker → frame with `data: "[DONE]"`; any other value is an ordinary data frame |
| Invalid UTF-8 in a frame | Parser-level malformed signal: `sse-invalid-utf8` (L2) → assembler treats as malformed provider protocol (§1.4) |
| Partial frame at EOF | `sse-partial-frame-at-eof` → malformed provider protocol |
| Frame exceeding 16 MiB | Parser-level overflow signal: the observation bound is exceeded → `observation-detached` via `frame-overflow` (an observer failure, §1.4) — the parser resets its frame buffer and continues framing subsequent bytes |
| EOF without `[DONE]` (no partial frame) | `sse-eof-without-done` → malformed provider protocol |

### 6.2 The decoder (L3) — frame-level normalized result

The decoder (`decodeSseFrame(frame)` in `@signalglass/providers`, §11)
returns a **frame-level result**:

```ts
type FrameDecodeResult =
  | { kind: 'events'; events: readonly StreamDecodedEvent[] }   // ordered, zero-or-more (§12)
  | { kind: 'done' }                                            // [DONE] frame
  | { kind: 'malformed'; code: MalformedStreamCode }            // §12
  | { kind: 'unrecognized' }                                    // valid JSON, unknown shape → declared loss; observation continues
  | { kind: 'decode-error'; code: StreamDecodeErrorCode };      // internal decoder failure → observer failure
```

- **One frame yields zero-or-more events, in order.** The assembler assigns
  `seq` to each event in array order — one frame produces a contiguous run
  of canonical events.
- `{ kind: 'events', events: [] }` is legal (e.g. a frame carrying only
  unretained fields) and contributes no canonical events.
- `decode-error` is an internal observer failure (detach, §1.4);
  `malformed` is malformed provider protocol.

### 6.3 Multi-choice normalization (L3 → L4)

For a chunk frame with provider `choices` array:

| Situation | Decision |
|---|---|
| Expansion order | **Array order**: `choices[0]`, `choices[1]`, … Each choice's chunk yields one `chunk` event in that order. |
| `choice.index` present and a non-negative integer | Canonical `choiceIndex` = that value |
| `choice.index` absent | Canonical `choiceIndex` = array position |
| Single choice, no index | Canonical `choiceIndex` = `0` |
| `choice.index` negative or non-integer | `sse-invalid-choice-index` → malformed provider protocol (terminal) |
| **Duplicate `choice.index` within one frame** | **`sse-invalid-choice-index` → malformed provider protocol (terminal).** Two distinct choices claiming one identity in one frame is ambiguous; the contract refuses it rather than guessing (§4.2). |
| Same `choiceIndex` across frames | Normal: the same choice streams multiple chunks; per-choice ordinal increments (continuation of one choice identity) |
| Out-of-order `choice.index` values across frames | Preserved (identity, not order); `seq` = observation order |
| `chunkIndex` | Per-choice content-chunk ordinal (0-based), maintained **per `choiceIndex`** (§4.2) |
| Frame with several choices AND usage | Choice `chunk` events (array order), then the frame-level `usage` event last |
| Frame with several choices AND per-choice finish reasons | Each choice's chunk carries its own `finishReason` |
| Frame-level usage + per-choice usage both present | Frame-level usage is canonical (OpenAI usage is top-level); per-choice nested usage is **discarded and declared** as `unrecognized-provider-field` (§12.1 — `StreamDecodedEvent.chunk` has **no** `usage` field) |

- A chunk event's delta is the provider-neutral normalized text of the
  choice's content delta (a string; `null` when the chunk carries no content,
  e.g. only a finish reason).
- **Valid OpenAI-compatible delta fields not represented by
  `delta: string | null` are declared losses, never silently reduced to
  `null`**: `role`, `tool_calls`, `refusal`, `audio`, multimodal content
  parts, and any future extension field are declared
  `unmapped-delta-fields` (§7.3) unless retained under the `providerNative`
  contract. The canonical text delta is retained as an excerpt; the
  structured sub-fields are not mapped into the canonical model by this
  slice.
- **Raw provider JSON is never emitted by the decoder** into the canonical
  model except under the `providerNative` retention contract (§7.2, §12.1).
- Retention (excerpting/masking) is applied by the assembler's collection
  layer at L4 per the capture profile (§8.2), not by the decoder.

### 6.4 Usage and finish-reason placement matrix

| Frame content | Canonical handling |
|---|---|
| Usage before any finish | `model_usage` event at its observation position; subsequent chunks allowed |
| Usage after finish | `model_usage` event at its observation position; the record remains `completed` if `[DONE]` follows |
| Usage-only terminal chunk | One `model_usage` event; no content event; completes only via a following `[DONE]` |
| No usage anywhere | Declared absence: no usage event; `declaredLosses` includes `provider-usage-absent`; **never** a fabricated zero-usage record |
| Finish reason on a chunk | Recorded on that chunk's envelope (`finishReason`), at its observation position |
| No finish reason before `[DONE]` | Declared absence (`finish-reason-absent`); `completed` still requires the observed `[DONE]` |
| Provider-reported finish reasons | Bounded label, ≤128 code points, validated per Spec 014 label rules; unknown reasons are preserved as observed (not classified as errors) |

### 6.5 Terminalization matrix

| Terminal | Trigger (observed) | Trace status | Canonical terminal event |
|---|---|---|---|
| `completed` | `[DONE]` frame observed (first observed terminal wins) | `completed` | `interaction_end`; model span `completed` |
| `upstream-failed` | Upstream HTTP error; connection error/timeout/TLS loss; non-SSE 2xx; provider error frame | `failed` | `error` (terminal) then `interaction_end`; model span `unknown` |
| `client-cancelled` | Client disconnect mid-stream | `cancelled` | `cancelled` (requestedBy `client`) then `interaction_end`; model span `unknown` |
| `ingress-cancelled` | Ingress shutdown/limit cancellation (idle timeout included) | `cancelled` | `cancelled` (requestedBy `ingress`) then `interaction_end`; model span `unknown` |
| `malformed-stream` | `sse-invalid-data-json`, `sse-invalid-utf8`, `sse-invalid-choice-index`, `sse-partial-frame-at-eof`, `sse-eof-without-done` | `failed` | `error` (actor `model`, role `provider_reported`) then `interaction_end`; model span `unknown` |
| `request-failed` | Request rejected before dispatch (invalid/incomplete/over-limit/unroutable/key-unavailable) | `failed` | `error` (actor per §10.4) then `interaction_end`; no model span |
| `observation-detached` | Internal observer failure (no terminal event was observable) | `unknown` | Informational `error` (actor `capture`, target `none`, effect `none`); `interaction_end`; model span `unknown` |

Terminal rules (Spec 014 §4.7):

- **The first observed terminal wins** within the observation lifecycle;
  the transport lifecycle's end is recorded separately and independently
  (§2).
- **Terminal-event sequence** (§10.5): the causal terminal event
  (`error` or `cancelled`) is emitted first at its `seq`; then
  **`interaction_end` is emitted exactly once** as the final canonical
  event; **nothing follows `interaction_end`** — no second `interaction_end`,
  no later `error`/`cancelled`/chunk/usage, no double emission.
- On trace-level failure or cancellation the model span ends `unknown` —
  never `completed` by inference. No wall-clock "completion" is synthesized.
- **No terminalization by wall clock.** The assembler never finalizes
  "completed" because time passed; an undecidable stream ends as one of the
  other terminals or via ingress cancellation at a limit.

### 6.6 Response-metadata event (`model_response`)

- When response headers are observed — **any** upstream status — the
  assembler emits exactly **one** canonical `model_response` event as the
  **first response-derived event** (immediately after `model_request` /
  `span_start`; before any chunk, usage, `[DONE]`, or error), carrying
  `responseMeta` on its `ResponseEnvelope` (§13.3).
- This gives response metadata one universal home on every path that
  observes headers: usage-first streams, `[DONE]`-only streams, streams
  with no content chunks, non-SSE 2xx responses, and upstream HTTP errors.
- **No duplication**: `responseMeta` appears only on this single
  `model_response` event — never on chunk/usage/error envelopes. The
  `ErrorPayload` carries no status field (§13.3 removes the draft's
  `upstreamStatus`); `responseMeta.statusCode` is the single upstream-status
  home on header-observed paths. Paths that never observe headers
  (connect/timeout/TLS failures, `request-failed`) have **no** status and
  **no** `model_response`.
- A metadata-only `model_response` (no content, no finish reason, no usage)
  is legal in streaming; the legacy projection maps it with declared loss
  (§13.5).

---

## 7. Evidence status vocabulary and loss mapping

**Decision 7 — every assembled payload carries a closed-set evidence status;
declared losses are closed codes persisted structurally in the canonical
completeness; absence is declared, zeros are never fabricated, and statuses
never collapse to `null`.**

### 7.1 Evidence statuses (Spec 013 §4 / Spec 014 §5)

`EvidenceStatus = 'captured' | 'redacted' | 'truncated' | 'missing' | 'unavailable'`
(closed, from `@signalglass/evidence`). Assembly rules:

- **Control events** (`interaction_start`, `interaction_end`, `span_start`,
  `span_end`): status `captured` (metadata only; never content-bearing).
- **Request messages**: default profile retains bounded excerpts → owning
  status `truncated` (length boundary only) or `redacted` (a sensitive span
  was masked); never `captured` for full content by default (§8).
- **Chunk deltas**: retained excerpt → `truncated` or `redacted` (same
  rule); the retained representation is the excerpt, with the owning
  declaration (§8).
- **Usage**: provider-reported values → field-level `captured` on each
  `UsageValue` (§13.6); captured zero is a real observation
  (`inputTokens: { value: 0, evidenceStatus: 'captured' }`), distinct from
  absence (no usage event, no fields).
- **Provider error frame / transport errors**: status `captured` (structural
  text only, §8.4).
- **Absent usage / absent finish reason / unretained content / unmapped
  delta fields**: declared via `MissingDeclaration` /
  `TruncationDeclaration` / `RedactionDeclaration` on the raw observation
  payload and via the canonical `declaredLosses` (§7.3); never encoded as
  `null` statuses and never as fabricated zeros.
- Statuses are always present on evidence records (never omitted, never
  `null`).

### 7.2 Fidelity and the `providerNative` retention contract

- Default fidelity: `structurally_faithful` (Spec 014). The retained
  representation is a bounded, structurally faithful excerpt of the
  normalized content — never raw bytes.
- Raw provider JSON is retained **only** when the capture profile requests
  it under the `providerNative` contract with explicit `providerNativeFidelity`
  and an owning status (`truncated`/`redacted` — it is declared content, so
  `metadata-safe` admits it as such). Otherwise it is a declared loss
  `provider-native-not-retained`. The default profile does not request it.

### 7.3 Declared-loss codes (closed; persisted in canonical completeness)

`declaredLosses` is a `readonly DeclaredLossCode[]` — a **closed code list**,
serialized at `EvidenceRecord.completeness.declaredLosses` (§13.2),
validated (unknown codes are refused), deterministically derived
(deduplicated, ordered by the table below), and classified by the
`metadata-safe` v1.1.0 policy (§14). Fixed display sentences are derived
from the codes for the boundary statement. **`boundaryStatement` is derived
from these codes and is never the only persisted loss record.**

| Code | Meaning (derived display sentence) |
|---|---|
| `request-body-not-retained` | The full request body was not retained. |
| `message-content-not-retained` | Request message content beyond the retained excerpt was not retained. |
| `delta-content-not-retained` | Chunk delta content beyond the retained excerpt was not retained. |
| `unmapped-delta-fields` | Content-delta sub-fields not represented by the canonical text delta (role, tool_calls, refusal, audio, multimodal, future extensions) were not retained. |
| `provider-native-not-retained` | The provider-native payload was not retained. |
| `provider-error-body-not-retained` | The provider error frame's raw body was not retained. |
| `provider-usage-absent` | The provider reported no usage. |
| `finish-reason-absent` | The stream ended without a finish reason. |
| `unrecognized-provider-field` | Provider JSON fields not mapped to the canonical model (including per-choice nested usage) were not retained. |
| `unrecognized-extension-frame` | A frame that decoded to no recognized shape was not retained. |
| `frame-after-observation-detach` | Frames observed after observation detached were not retained. |
| `remainder-after-client-cancellation` | The stream remainder after client cancellation was not retained. |
| `remainder-after-ingress-cancellation` | The stream remainder after ingress cancellation was not retained. |
| `response-header-values-not-retained` | Upstream response header values outside the allowlist were not retained. |
| `content-type-parameters-not-retained` | Media-type parameters were dropped from the retained `content-type`. |
| `wire-bytes-not-retained` | Transport bytes were not retained (only excerpts and metadata). |
| `encoded-content-not-observed` | The encoded stream could not be decoded for observation. |
| `original-content-masked` | Content matching the sensitive detector was masked at collection. |

`crash-no-record` is **not** in this list and must never appear on a record:
it is a system-level declaration for interactions that were never persisted
(§19.2).

Deterministic derivation rules:

- Order: the table order above (fixed, canonical).
- Deduplication: each code appears at most once per record; repeated losses
  of the same kind collapse to one code.
- Derivation: codes are computed from observed facts at finalization (§17);
  they are never a static list and never copied from the boundary statement
  (the reverse: the boundary statement is derived from them).

The completeness summary and boundary statement are derived from the
observed facts + these codes; the boundary statement never invents content,
statuses, or reasons.
---

## 8. Collection vs. persistence policy boundaries

**Decision 8 — collection, persistence, and export are independent policies
(Spec 007 §3; `docs/capture-profiles.md`). The default collection process
runs a collection-time privacy pipeline (structural exclusion + versioned
sensitive detector + masking/excerpting, with owning statuses and declared
losses) before evidence is formed; the Spec 015 storage-safety gate and the
persistence policy still run, non-bypassably, on every save. The default
claim is "expected admissible, rejection still possible", never
"rejection impossible".**

### 8.1 Default capture profile

- Default capture profile: `signalglass.collection.ingress-metadata-safe`,
  version `1.0.0`, recorded on the trace (`captureProfile`, Spec 013 §9).
  Collection policy (what is captured), persistence policy (what is stored —
  `metadata-safe`, §14), and export policy (out of scope here) are three
  independent policies.
- Default retained values per interaction:
  - structural metadata (routing, model, timing, ids, statuses, seq,
    lifecycle facts, declared losses);
  - request messages and chunk deltas as **bounded retained excerpts**
    (default max length 240 characters; §8.3);
  - provider-reported usage values, verbatim (as `UsageValue`s, §13.6);
  - normalized finish reasons;
  - structural error text (§8.4);
  - response metadata: `statusCode` + normalized `content-type`
    (+ `content-encoding` when present) via `responseMeta` on the
    `model_response` event (§13.3);
  - the completeness summary with structured declared losses and lifecycle
    facts.
- **Not retained by default**: raw request bodies, raw provider payloads
  (`provider-native-not-retained`), raw wire bytes, unmapped delta sub-fields
  (`unmapped-delta-fields`), and any header values outside the allowlist
  (§5.1).

### 8.2 The collection-time privacy process

Collection runs **before** evidence is formed and **before** any persistence
decision, and is independent of the persistence policy (it is not a
pre-filter that the persistence policy can be blamed for bypassing):

1. **Structural exclusion** — sensitive header fields (authorization,
   cookie, set-cookie, x-api-key, and the documented secret list) never
   enter evidence at all; there is no content to redact because the values
   are excluded at the boundary (Spec 006 bearer handling and Spec 015
   metadata-safe already guarantee this).
2. **Detect-then-retain** — a **versioned sensitive detector**
   (`signalglass.collection.sensitive-detector` v1.0.0) scans the **full
   candidate text** (the complete decoded message content or chunk delta,
   before any length boundary is applied) for credential-shaped spans
   (API-key/token patterns compatible with the Spec 015 safety vocabulary:
   S1/S2/S3 credential patterns, plus the documented detector patterns).
3. **Mask or omit** — matched spans are masked (replaced with a fixed
   placeholder) or the whole value is omitted, per the profile's
   redaction rule. Masking happens before the length boundary, so a
   credential that straddles the 240-character boundary is masked in full.
4. **Retain the excerpt** — after masking, the length boundary is applied.
   The owning status is:
   - `redacted` — any span was masked (`original-content-masked` loss);
   - `truncated` — only the length boundary applied;
   both carry the owning `RedactionDeclaration`/`TruncationDeclaration` on
   the raw observation payload (Spec 013 §2.2.12, §5.8; projection rows
   E2L-078..080).
5. **Declare** — the loss codes and declarations are attached; the
   `metadata-safe` classification then sees **declared** content, never raw
   secrets.
6. **The gate still runs** — the Spec 015 storage-safety gate and the
   persistence policy are **non-bypassable** and run on every save,
   including saves of records produced by the collection pipeline.

### 8.3 Excerpt bounds (decided, not tuning-only)

- Default excerpt max length: **240 characters** (matches the Spec 015
  `metadata-safe` expectation of bounded declared content).
- Valid configured range: **64–4096 characters**.
- Changing the default excerpt length requires a **capture-profile version
  bump** (the profile is versioned and recorded per record, §15). The range
  and the version-bump rule are normative, so this is no longer an open
  question.

### 8.4 Structural error text

- Error payloads contain fixed, bounded, **structural** text: a closed error
  code (Spec 006 style), a bounded description (≤200 chars) built from
  structural facts, and no headers, no secrets, no raw provider error bodies.
  The provider's raw error body is declared lost
  (`provider-error-body-not-retained`).
- The description never embeds: request URLs with query strings, API keys,
  authorization values, cookies, or raw payload excerpts.

### 8.5 The honest admission claim

- **Construction invariant (tested)**: default-profile records are expected
  to be policy-admissible under `metadata-safe` v1.1.0 — the collection
  pipeline is designed and tested so that no default record carries an
  S1/S2/S3/S5/S6 witness (sentinel tests §21 T62–T67: a credential beginning
  before the excerpt boundary, crossing it, or beginning after it is
  masked/omitted in full).
- **Honest limit**: a safety **rejection remains a possible outcome** — e.g.
  a credential fragment the versioned detector does not recognize can reach
  the gate. A rejection is surfaced as `safety-rejected`, is **never called
  a code defect automatically**, and is investigated as a detector-coverage
  gap. The spec therefore claims *expected admissible with tested
  construction invariant*, never *admissible by construction* and never
  *rejection impossible*.
- API keys remain env-var-only (Spec 006): the assembler never reads,
  retains, or records key values; the upstream authorization header is built
  at dispatch from the env var and excluded from evidence structurally.

---

## 9. Legacy coexistence

**Decision 9 — the canonical record is authoritative; the legacy `Trace`
becomes a compatibility projection. Dual emission is allowed from the same
observed stream; divergence is surfaced, never silently reconciled;
persistence failures never affect client traffic.**

### 9.1 Canonical-authoritative

- For streaming interactions, the canonical `EvidenceRecord` (Spec 013/015)
  is the **source of truth**. The legacy `Trace` (Spec 007 path) is a
  **compatibility projection** for existing consumers (report generation,
  UI), not a second authority.
- Projection is `evidenceToLegacyTrace` (`@signalglass/core`,
  `evidenceProjections`), which already maps canonical events to legacy
  `Trace`/`TraceEvent` shapes with declared loss (projection matrix,
  E2L-* rows including E2L-073 for `chunkIndex`; new rows for the additive
  fields §13.5).

### 9.2 Dual emission

- The ingress MAY emit both the canonical record (Spec 015) and a legacy
  trace for the same observed stream — **dual emission**, from the same
  observation, never from two separate observations of the same interaction.
- In dual-emission mode the canonical record is authoritative; the legacy
  trace is derived.
- If a store cannot persist the canonical record (older storage, unsupported
  version), the ingress MAY persist only the legacy trace as a degraded
  compatibility path — declared, never silently preferred over the
  canonical path.

### 9.3 Divergence detection

- **Divergence detection** compares the canonical record's legacy projection
  (`evidenceToLegacyTrace`) with the independently emitted legacy trace.
- Divergences (status, event count, identity) are **surfaced** (logs,
  counters, diagnostics) and **never silently reconciled** — the canonical
  record is not rewritten to match the legacy trace, and the legacy trace is
  not rewritten to match the projection.
- A parity test keeps `evidenceToLegacyTrace(canonical) == legacy` for
  shared semantics (see §21 T73).

### 9.4 Client traffic isolation

- No persistence outcome — stored, rejected, conflicted, failed, or
  crash-before-save — ever delays, mutates, retries, or reorders client
  traffic. The client response is finalized independently of the save
  (§3.2, §16).

---

## 10. Terminal state machine and sequencing

**Decision 10 — a single, closed, deterministic state machine governs the
observation lifecycle. Its seven terminal states are the only states from
which a record finalizes. `finalized` is an operation, not a state;
persistence outcomes are observations, never states, and never rewrite the
terminal. The terminal-event sequence is fixed: causal event, then exactly
one `interaction_end`, then nothing.**

### 10.1 State diagram (observation lifecycle)

```text
                 ┌───────────────┐
                 │  initialized  │──────────────┐ (assembler destroyed
                 └──────┬────────┘              │  without observation)
                        │ request observed      ▼
                 ┌──────▼────────┐        ┌──────────────┐
                 │request-observed│       │  aborted     │ (outcome:
                 └──────┬────────┘       │ (no record)  │  AbortReason)
                        │ dispatch        └──────────────┘
        ┌───────────────┼───────────────┐
        │ invalid body/ │ valid body     │ unroutable/
        │ over-limit/   ▼                │ key unavailable
        │ incomplete    │                │ (pre-dispatch)
        │               ▼                ▼
   ┌────────────┐       │        ┌──────────────┐
   │ request-   │       │        │  dispatched  │
   │ failed     │◄──────┘        └───┬────────┬──┘
   └─────┬──────┘          HTTP err│  non-SSE│ 2xx text/event-stream
        │                  /connect│         ▼
        │                   /timeout│   ┌──────────────┐
        │                   /TLS    │   │  streaming   │
        │                           │   └──┬───────┬───┘
   ┌────▼─────┐                ┌─────▼──┐  │       │
   │ upstream-│◄───────────────┤ (fail) │  │       │
   │  failed  │                └────────┘  │       │
   └──────────┘                            │       │
        terminals:  completed · upstream-failed · client-cancelled
                    ingress-cancelled · malformed-stream · request-failed
                    observation-detached
        (no transitions out of a terminal; finalized is the operation
         that produces the outcome; persistence observations are separate)
```

### 10.2 Transition table

| From | Event | To | Notes |
|---|---|---|---|
| `initialized` | Request observed (headers) | `request-observed` | identity assigned |
| `initialized` | Assembler destroyed without observation | `aborted` | outcome `{ outcome: 'aborted', reason }`; no record |
| `request-observed` | Body parsed, valid; dispatch begun | `dispatched` | `model_request` + `span_start` |
| `request-observed` | Body invalid / incomplete / over-limit / unroutable / key unavailable | `request-failed` | no dispatch; closed codes §12.2 |
| `dispatched` | Upstream HTTP error / non-SSE 2xx / connect / timeout / TLS / connection lost | `upstream-failed` | §6.5; `model_response` emitted first when headers were observed (§6.6) |
| `dispatched` | 2xx, `content-type: text/event-stream` | `streaming` | headers observed; `model_response` emitted |
| `streaming` | `[DONE]` observed | `completed` | first observed terminal wins |
| `streaming` | Malformed protocol (invalid JSON/UTF-8/choice index incl. same-frame duplicates; partial frame or EOF without `[DONE]`) | `malformed-stream` | |
| `streaming` | Client disconnect | `client-cancelled` | |
| `streaming` | Ingress shutdown/limit (idle timeout included) | `ingress-cancelled` | |
| `streaming` | Provider error frame / mid-stream connection loss | `upstream-failed` | |
| `streaming` | Observer failure (parser/decoder/assembler exception, frame overflow, unsupported encoding, decode failure) | `observation-detached` | transport continues |
| any terminal | `finalize()` operation | — | produces `AssemblerOutcome`; persistence runs after transport end (§3.2) |

Illegal transitions are rejected (the assembler is a closed machine): e.g.
`completed → client-cancelled`, `streaming → streaming`, any transition out
of a terminal, any event after `interaction_end`. **No wall-clock
transition**: no path from any state to `completed` except the observed
`[DONE]`.

### 10.3 States, outcomes, and statuses — one vocabulary

`AssemblerState` (public, closed): the seven terminals above plus
`initialized` / `request-observed` / `dispatched` / `streaming` — **no
`finalized` state** (finalization is an operation) and **no persistence
states** (persistence observations are not assembler states and never appear
as if they rewrite the terminal).

```ts
type AssemblerState =
  | 'initialized' | 'request-observed' | 'dispatched' | 'streaming'
  | 'completed' | 'upstream-failed' | 'client-cancelled'
  | 'ingress-cancelled' | 'malformed-stream' | 'request-failed'
  | 'observation-detached';

type AssemblerOutcome =
  | { outcome: 'recorded'; terminal: TerminalReason; record: EvidenceRecord;
      summary: CompletenessSummary }
  | { outcome: 'aborted'; reason: AbortReason };   // 'no-request-observed' | 'assembler-misuse'
```

- `TerminalReason` (closed) = the seven terminals: `completed |
  upstream-failed | client-cancelled | ingress-cancelled | malformed-stream |
  request-failed | observation-detached`. The diagram, the transition table,
  `AssemblerState`, `AssemblerOutcome`, `TerminalReason`, the event mapping,
  trace status, acceptance criteria, and test mapping all use exactly this
  vocabulary.
- `CompletenessSummary.terminalReason: TerminalReason` (the
  `AssemblerOutcome['terminal']` self-reference is gone); the outcome's
  `terminal` and the summary's `terminalReason` are the same closed value
  when `outcome: 'recorded'`.
- `aborted` is a **sibling outcome** with its own closed `AbortReason`, not
  a terminal state and not a terminal reason; there is no `reason: string`
  for aborts (§12.2).
- `trace.status` is derived **only** from the observation terminal:
  `completed → completed`; `upstream-failed | malformed-stream |
  request-failed → failed`; `client-cancelled | ingress-cancelled →
  cancelled`; `observation-detached → unknown`. The transport end is
  recorded (§2) and never changes this derivation.

### 10.4 Terminal → trace status → actor/role mapping (agreed everywhere)

| Terminal | Trace status | Canonical terminal event | Actor | Role | Target | Effect |
|---|---|---|---|---|---|---|
| `completed` | `completed` | `interaction_end` | `model` | `provider_reported` | `trace` | `complete` |
| `upstream-failed` (HTTP/provider error frame) | `failed` | `error` | `model` | `provider_reported` | `trace` | `fail` |
| `upstream-failed` (connect/timeout/TLS/lost/non-SSE) | `failed` | `error` | `model` | `unobservable` | `trace` | `fail` |
| `client-cancelled` | `cancelled` | `cancelled` | `agent` | `client_sent` | `trace` | `cancel` |
| `ingress-cancelled` | `cancelled` | `cancelled` | `capture` | `unobservable` | `trace` | `cancel` |
| `malformed-stream` | `failed` | `error` | `model` | `provider_reported` | `trace` | `fail` |
| `request-failed` | `failed` | `error` | `agent` (invalid/incomplete/over-limit/unroutable) or `capture` (key-unavailable) | `client_sent` / `unobservable` | `trace` | `fail` |
| `observation-detached` | `unknown` | informational `error` (target `none`, effect `none`) | `capture` | `unobservable` | `none` | `none` |

- **`upstream-key-unavailable` is classified exactly once**: it occurs
  **before dispatch** (the env-var key is resolved at dispatch time, before
  any request is sent), so it is a `request-failed` code with actor
  `capture` / role `unobservable`. It is **not** a member of
  `UpstreamFailureCode` and appears **only** in the `request-failed` row
  (§12.2).
- Trace-level failure/cancellation leaves the model span `unknown` (§6.5);
  `unknown` is reserved for observations whose termination could not be
  observed (never for "probably failed").

### 10.5 Terminal-event sequence (single, everywhere)

The final canonical sequence of every recorded interaction is:

```text
… [events] → causal terminal event (error | cancelled | informational error)
           → interaction_end            (exactly one, the final event)
           → nothing
```

- The causal terminal event is emitted first, at its own `seq` (§4.3).
- `interaction_end` is emitted **exactly once**, immediately after, as the
  final canonical event. **Nothing follows `interaction_end`** — no second
  `interaction_end`, no later events of any kind.
- `completed` has no causal terminal event other than the observed `[DONE]`
  itself; its `interaction_end` closes the sequence.
- This sequence is used identically in the state table (§10.2), the event
  mapping (§10.4), the terminalization matrix (§6.5), acceptance criterion
  15 (§22), and the tests (T19, T34, T35, T46–T48).

### 10.6 Persistence observations are not states

After `finalize()`, the save outcome is an observation:
`PersistenceObservation` (§16) — either a structured `SaveOutcome` status or
a leak-free environmental-failure code. It is recorded/reported and **never
rewrites** the terminal state, the trace status, or the assembled record.
---

## 11. Package boundaries

**Decision 11 — a new network-free `@signalglass/streaming` package hosts
the parser, assembler, and stream contracts; the provider decoder lives in
`@signalglass/providers`; wiring lives in `apps/ingress`; persistence stays
in `@signalglass/storage`; projections stay in `@signalglass/core`. The
packages are named here but not created by this PR.**

### 11.1 Module map (proposed; not created)

| Package | Module | Contents | Depends on |
|---|---|---|---|
| `@signalglass/streaming` (new) | `sse.ts` | `createSseParser()`, `SseFrame`, parser-level malformed/overflow signals (§6.1) | `@signalglass/evidence` only (parser math, no provider knowledge) |
| `@signalglass/streaming` (new) | `assembler.ts` | `createStreamAssembler()`, state machine (§10), sequencing (§4), collection layer (§8.2), completeness summary, `assembleEvidenceRecord()` | `@signalglass/evidence` only |
| `@signalglass/streaming` (new) | `types.ts` | `SseFrame`, `FrameDecodeResult`, `StreamDecodedEvent`, `AssemblerInput`, `AssemblerState`, `AssemblerOutcome`, `CompletenessSummary`, `TerminalReason`, `TransportEndReason`, `DeliveryOutcome`, `AbortReason`, `DeclaredLossCode`, `ObservationFailureCode`, `PersistenceObservation`, `EnvironmentalFailureCode`, `CancellationSource` (§12) | nothing (types) |
| `@signalglass/providers` | `openaiAdapter.ts` (+ `sse.ts` decoder) | `decodeSseFrame(frame: SseFrame): FrameDecodeResult` — OpenAI-compatible decode to provider-neutral events; provider-native retention under `providerNative` (§7.2) | `@signalglass/streaming` (types), `@signalglass/evidence` |
| `apps/ingress` | `streamHandler.ts` | HTTP wiring: raw-Buffer read, passthrough, backpressure, header allowlist, decoder tee, error envelopes, `model_response` response-metadata event, transport-end observation, response completion, delayed save (§3.2) | `@signalglass/streaming`, `@signalglass/providers`, `@signalglass/storage` |
| `@signalglass/storage` | `evidenceStorage.ts` (unchanged API) | `saveEvidenceRecord` — the only persistence path; `SaveOutcome` (no contention); `EvidenceContentionError` | unchanged |
| `@signalglass/core` | `evidenceProjections/` (unchanged) | `evidenceToLegacyTrace` — legacy projection + divergence detection (§9) | unchanged |

### 11.2 Boundary rules

- `@signalglass/streaming` is **network-free**: no sockets, no HTTP, no
  buffering of unbounded streams, and **zero provider knowledge** — it never
  parses provider JSON. Provider decoding is `@signalglass/providers`'s
  job; the assembler consumes only `StreamDecodedEvent`s.
- Provider-native JSON stays in `@signalglass/providers` unless retained
  under the canonical `providerNative` contract (§7.2) — and that contract's
  value is a canonical envelope field, not an import of provider shapes into
  `@signalglass/streaming`.
- `apps/ingress` is the only place that touches sockets; persistence calls
  go through `@signalglass/storage`; projections through `@signalglass/core`.
- The additive schema support (§13) and policy rows (§14) live in
  `@signalglass/evidence` and `@signalglass/storage` as the 1.1 foundation
  (slice S1/S2, §20) — before any slice that emits 1.1 records.

---

## 12. Public contracts: provider-boundary types and closed vocabularies

**Decision 12 — every public vocabulary is a closed discriminated union; no
`reason: string` for aborts; `declaredLosses` is a closed code list
persisted in the canonical record; the completeness summary reports only
observable facts; internal helpers stay internal.**

### 12.1 Provider-boundary output (L3, provider-neutral)

```ts
/** Normalized, provider-neutral output of the decoder. */
type StreamDecodedEvent =
  | {
      kind: 'chunk';
      choiceIndex: number;          // normalized choice identity (§6.3)
      delta: string | null;         // normalized content delta text; null when the chunk carries no content
      finishReason?: string;        // bounded label (≤128 cp), when the choice reported one
      // NOTE: no usage field. Per-choice nested usage is discarded and
      // declared `unrecognized-provider-field` (§6.3); frame-level usage is
      // the canonical usage source.
    }
  | { kind: 'usage'; usage: NormalizedUsage }
  | { kind: 'provider-error'; code: ProviderErrorFrameCode; type?: string };
```

- `ProviderErrorFrameCode = 'provider-error-frame'` (closed, single member):
  a structural code, never the provider's own error type as an open string —
  the provider error `type` (when reported) is a bounded label (≤128 cp);
  the provider's raw error body is a declared loss
  (`provider-error-body-not-retained`).
- `NormalizedUsage` uses the existing `UsageRecord`/`UsageValue` shapes
  exactly (§13.6): `{ evidenceStatus: 'captured'; inputTokens?: UsageValue;
  outputTokens?: UsageValue; totalTokens?: UsageValue }` with
  `UsageValue = { value?: number; evidenceStatus?: EvidenceStatus; reason?:
  string }`. Captured `0` (`{ value: 0, evidenceStatus: 'captured' }`) is
  distinct from absence (field omitted); the record-level
  `evidenceStatus: 'captured'` applies to the usage as a whole.
- **The decoder never emits raw provider JSON.** Provider-native content is
  retained only via the `providerNative` envelope contract (§7.2) in
  `@signalglass/providers` itself.
- **Unmapped delta sub-fields** (role, tool_calls, refusal, audio,
  multimodal, future extensions) are declared losses
  (`unmapped-delta-fields`), never silently reduced to `null` (§6.3).

### 12.2 Closed vocabularies

```ts
type MalformedStreamCode =
  | 'sse-invalid-data-json'      // data value not valid JSON
  | 'sse-invalid-utf8'           // invalid UTF-8 in a frame
  | 'sse-invalid-choice-index'   // non-integer, negative, or same-frame-duplicate choice index
  | 'sse-partial-frame-at-eof'   // partial frame at EOF
  | 'sse-eof-without-done';      // EOF without [DONE]

type StreamDecodeErrorCode = 'decoder-exception' | 'decoder-invalid-output';

type ObservationFailureCode =
  | 'parser-exception'
  | 'decoder-exception'
  | 'assembler-exception'
  | 'frame-overflow'             // configured observation bound exceeded
  | 'encoding-unsupported'       // content-encoding not decodable
  | 'decode-failure';            // bounded decoder tee failed

type UpstreamFailureCode =
  | 'upstream-http-error'
  | 'upstream-connect-failure'
  | 'upstream-timeout'
  | 'upstream-tls-failure'
  | 'upstream-connection-lost'
  | 'provider-error-frame'
  | 'non-sse-response';          // 2xx whose content-type is not text/event-stream
  // NOTE: upstream-key-unavailable is NOT here — it occurs before dispatch
  // and is classified under request-failed (§10.4).

type ClientRequestFailureCode =
  | 'client-request-invalid'     // malformed JSON / schema
  | 'client-request-incomplete'  // connection lost mid-body
  | 'client-request-over-limit'  // body over the 10 MB readJsonBody cap
  | 'client-request-unroutable'  // model unknown / provider not configured
  | 'upstream-key-unavailable';  // env-var API key missing/unresolvable; actor capture

type CancellationSource = 'client' | 'ingress';

type TerminalReason =
  | 'completed'
  | 'upstream-failed'
  | 'client-cancelled'
  | 'ingress-cancelled'
  | 'malformed-stream'
  | 'request-failed'
  | 'observation-detached';

type TransportEndReason =
  | 'response-complete'          // upstream body fully read and flushed to the client
  | 'client-cancelled'           // client socket closed mid-stream
  | 'ingress-shutdown'           // server shutdown / ingress limit
  | 'upstream-transport-failure';// upstream error/timeout/premature EOF

type DeliveryOutcome = 'flushed' | 'closed';  // §2.1

type AbortReason = 'no-request-observed' | 'assembler-misuse';  // no string

type DeclaredLossCode = /* closed list, §7.3 */;

type RemainderObservation = 'observed' | 'unknown';  // §12.3

type EnvironmentalFailureCode =
  | 'contention-exhausted'       // EvidenceContentionError caught (§16)
  | 'storage-unavailable'        // storage/database-level failure caught (§16)
  | 'policy-crash';              // persistence policy threw (§16)

type PersistenceObservation =
  | { kind: 'save-outcome'; status: SaveOutcomeStatus }        // §16
  | { kind: 'environmental-failure'; code: EnvironmentalFailureCode };

type SaveOutcomeStatus =   // exactly Spec 015's statuses; NO contention
  | 'stored' | 'already-present' | 'conflict' | 'invalid'
  | 'unsupported-version' | 'safety-rejected' | 'policy-rejected'
  | 'policy-failed' | 'clock-failed';
```

Rules:

- **No `reason: string`** on aborted outcomes, errors, or terminal events —
  every reason/code is a closed union member. Display text is derived.
- **`declaredLosses: readonly DeclaredLossCode[]`** — closed codes, not free
  strings; serialized into the canonical record (`completeness.declaredLosses`,
  §13.2); the boundary statement is the derived, fixed display text and is
  **not** an equivalent substitute for the structured codes.
- **`seqGaps` is removed from `CompletenessSummary`** — it was always empty
  by the assembly contract (dropped frames leave no canonical gap, §4.3);
  canonical completeness owns gap semantics. Unparseable or unobserved
  frames are disclosed via statuses, loss codes, and the summary's honest
  remainder fields (§12.3), never via a gap array or an invented count.
- The old `terminalReason: AssemblerOutcome['terminal']` self-reference is
  gone; `CompletenessSummary.terminalReason: TerminalReason` is the closed
  type (§10.3).
- `TransportEndReason` and `DeliveryOutcome` are the transport-lifecycle
  facts persisted in `completeness.lifecycle` (§2, §13.2).
- `PersistenceObservation` never contains `contention` as a `save-outcome`
  status: contention exhaustion is `EnvironmentalFailureCode
  'contention-exhausted'` (§16).

### 12.3 Completeness summary (assembler-level, honest facts only)

```ts
type CompletenessSummary = {
  terminalReason: TerminalReason;
  observedFrames: number;                    // frames the parser actually delivered (§6.1)
  retainedEvents: number;                    // canonical events retained
  observationDetached: boolean;              // true iff observation detached (§1.5)
  lastObservedFramePosition?: number;        // ordinal of the last parsed frame, when frames were parsed;
                                             // ABSENT when no frame was ever parsed (e.g. unsupported encoding)
  remainderObservation: RemainderObservation; // 'observed' | 'unknown' (§12.4)
  rawForwardedBytes?: number;                // OPTIONAL: transport-measured bytes written to the client socket,
                                             // counted without parsing; absent when the transport cannot measure
  eventsByStatus: Readonly<Record<EvidenceStatus, number>>;
  declaredLosses: readonly DeclaredLossCode[];
  boundaryStatement: string;                 // derived fixed display sentences (§7.3); never invented content
};
```

- **No fabricated post-detachment frame counts.** The count of frames after
  detachment is not observable when the content encoding is unsupported,
  decoder output is unavailable, the parser has detached, or frame
  boundaries cannot be recovered — SignalGlass does not report a number it
  cannot know. The honest facts are `observationDetached`, the last
  observed position (when known), `remainderObservation: 'unknown'`, and —
  only if the transport can measure it without parsing — `rawForwardedBytes`
  (a byte count, never a frame count).
- `observedFrames` counts only frames the parser actually delivered; after
  detachment the parser may still frame bytes (it is a pure function of the
  stream), but those frames are **not** counted as observed canonical
  content and never receive `seq`; the loss is declared
  (`frame-after-observation-detach`).

### 12.4 Remainder observation

| Situation | `remainderObservation` |
|---|---|
| `completed` (observed `[DONE]`) | `observed` (the stream's end was observed) |
| `malformed-stream` at EOF (`sse-eof-without-done` / partial frame) | `observed` (the stream's end was observed) |
| `observation-detached` | `unknown` |
| `client-cancelled` / `ingress-cancelled` with unread remainder | `unknown` |
| `upstream-failed` mid-stream (connection lost) | `unknown` |
| `request-failed` (no response existed) | `unknown` (nothing was observed; recorded with the loss codes for the request) |

### 12.5 Assembler entry points

```ts
createSseParser(): SseParser;                  // @signalglass/streaming (L2)
createStreamAssembler(opts): StreamAssembler;  // @signalglass/streaming (L4, state machine)
```

- `AssemblerInput` (closed): `{ kind: 'request-observed'; ... } |
  { kind: 'response-headers'; ... } | { kind: 'frame'; frame: SseFrame } |
  { kind: 'done'; ... } | { kind: 'client-cancelled' } |
  { kind: 'ingress-cancelled' } | { kind: 'observer-failure';
  code: ObservationFailureCode } | { kind: 'transport-failure';
  code: UpstreamFailureCode } | { kind: 'transport-end';
  end: TransportEndReason; delivery: DeliveryOutcome } | { kind: 'finalize' }`.
- Internal helpers (frame splitting internals, status derivation, excerpt
  application) are **not exported**; only the public contracts in this
  section are public.

---

## 13. Canonical schema extension (additive 1.1.0)

**Decision 13 — the canonical schema advances additively:
`evidenceSchemaVersion` 1.1.0. Six additive fields enter the canonical
types — `responseMeta`, `choiceIndex`, `completeness.declaredLosses`,
`completeness.lifecycle`, `trace.assembly`, and the refined
`completeness`/usage semantics — with exact shapes, validation,
policy-classification, projection-loss, and fixture consequences. MAJOR-1
compatibility is preserved: 1.0.0 validators already accept 1.1.0 records.**

### 13.1 Version mechanics

- `SUPPORTED_EVIDENCE_SCHEMA_VERSION` stays `1.0.0`;
  `isSupportedEvidenceSchemaVersion` and `checkEvidenceSchemaVersion` already
  accept any additive MAJOR-1 version (additive-by-default evolution,
  `docs/model-versioning.md`).
- **`evidenceSchemaVersion` recorded on 1.1.0 records is `1.1.0`** — the
  explicit additive minor, not the supported constant. This makes the minor
  self-describing while preserving MAJOR-1 compatibility.
- 1.0.0 validators: unknown additive fields are preserved and round-trip
  (Spec 014 §5.3 `validate-fields.ts`) — a 1.0.0 validator accepts a 1.1.0
  record and preserves the new fields. **This is a compatibility property,
  not a substitute for owned validation**: 1.1.0 validators validate the
  owned semantics of every 1.1 field, and no slice relies on
  unknown-additive-field preservation to ship unvalidated fields (§20).
- 1.1.0 validators accept 1.0.0 records (all new fields optional).

### 13.2 The additive fields (owner/path/serialized names)

| Field | Owner | Path (serialized) | Type |
|---|---|---|---|
| `choiceIndex` | `ResponseEnvelope` (additive optional; present on every chunk assembled by this spec) | `payload.responseEnvelope.choiceIndex` | non-negative integer |
| `responseMeta` | `ResponseEnvelope` (additive optional; present on the single response-metadata `model_response` event, §6.6) | `payload.responseEnvelope.responseMeta` | `{ statusCode: number; contentType?: string; contentEncoding?: string }` |
| `declaredLosses` | `TraceCompleteness` (additive optional; present on every record assembled by this spec) | `completeness.declaredLosses` | `readonly DeclaredLossCode[]` (closed, ordered, deduplicated; §7.3) |
| `lifecycle` | `TraceCompleteness` (additive optional; present on every record assembled by this spec) | `completeness.lifecycle` | `{ observation: { terminal: TerminalReason }; transport: { end: TransportEndReason; delivery: DeliveryOutcome } }` |
| `assembly` | `EvidenceTrace` (additive optional; present on every record assembled by this spec) | `trace.assembly` | `{ name: 'signalglass.streaming.assembler'; version: string; decoderContract?: { name: 'signalglass.providers.openai-sse'; version: string } }` |

- **No `upstreamStatus` field.** The revision-2 draft added
  `ErrorPayload.upstreamStatus`; revision 3 removes it. The upstream status
  is a header-observation fact and lives in `responseMeta.statusCode` on the
  `model_response` event (§6.6); `ErrorPayload` carries only its structural
  code and bounded description. This eliminates status duplication and gives
  response metadata one universal home.
- The fields are on the existing canonical owners (`ResponseEnvelope`,
  `TraceCompleteness`, `EvidenceTrace`) — **not** on a new
  transport-observation structure — so there is no new envelope type in 1.1.0.
- `chunkIndex` semantics are refined additively: **per-choice content-chunk
  ordinal** (§4.2), fixture-compatible with the existing single-choice
  fixtures.

### 13.3 `responseMeta` exact shape and placement

```ts
responseMeta?: {
  statusCode: number;             // integer, 100–599 inclusive
  contentType?: string;           // RFC 6838 media type, lowercased type/subtype,
                                  // no parameters (params dropped + declared
                                  // content-type-parameters-not-retained), ≤128 cp
  contentEncoding?: string;       // lowercase token, ≤32 cp; ABSENT when identity/none
};
```

- **Placement**: exactly one `model_response` event per interaction **iff
  response headers were observed**, emitted before any chunk/usage/error
  (§6.6); `responseMeta` is recorded on that event. **No duplication**: it
  never appears on chunk, usage, or error envelopes.
- **Absence rules**:
  - `responseMeta` absent when no response headers were observed
    (connect/timeout/TLS failure, `request-failed`, `client-cancelled`
    before the response);
  - `contentType` absent when the upstream sent none;
  - `contentEncoding` absent when identity/none — never an empty string or a
    fabricated value.
- **Per-path matrix**:

| Path | `model_response` with `responseMeta` |
|---|---|
| Normal stream (chunks → usage → `[DONE]`) | Emitted first (headers observed), before chunks |
| Usage-first stream (first event is usage) | Emitted first, before the usage event |
| `[DONE]`-only stream | Emitted first, before the done terminal |
| Stream with no content chunks | Emitted first (headers observed) |
| Non-SSE 2xx response | Emitted (headers observed), then the `error` (non-sse-response) |
| Upstream HTTP error | Emitted (headers observed) with `statusCode`, then the `error` (upstream-http-error) |
| Connect/timeout/TLS failure | Not emitted (no headers); `error` only; no status anywhere |
| `request-failed` / pre-dispatch | Not emitted |

- **Raw vs normalized**: `statusCode` is the raw integer; `contentType` is
  the normalized media type (parameters stripped); `contentEncoding` is the
  normalized lowercase token. Unknown fields **inside** `responseMeta` fail
  closed (rejected), while unknown fields elsewhere round-trip per §13.1.
- **Validation** (in `@signalglass/evidence`, slice S1): integer bounds for
  `statusCode`; grammar for `contentType` and `contentEncoding`; length
  bounds; `choiceIndex` non-negative integer.
- **Policy classification**: the `metadata-safe` v1.1.0 matrix (§14) adds
  rows: `responseMeta.statusCode` and `choiceIndex` as meta (bounded
  integers), `responseMeta.contentType`/`contentEncoding` as bounded labels.

### 13.4 Declared losses and lifecycle in canonical completeness

- `completeness.declaredLosses`: closed-code array, deterministic order
  (§7.3 table order), deduplicated; validated by `parseEvidenceRecord`
  (1.1) — any unknown code is a parse refusal; serializer/parser round-trip;
  storage retrieval parity; `metadata-safe` v1.1.0 bounded-label-array row.
- `completeness.lifecycle`: observation terminal + transport end + delivery
  (§2); each value validated against its closed union; round-trip and
  retrieval parity; `metadata-safe` v1.1.0 bounded-label rows.
- The `boundaryStatement` remains derived from the structured codes (§7.3)
  and is **not** the persisted loss record.

### 13.5 Projection and fixture consequences

- **Projection matrix**: new loss rows — `responseMeta`, `choiceIndex`
  (identity), `completeness.declaredLosses`, `completeness.lifecycle`, and
  `trace.assembly` are `unavailable` in the legacy projection; a
  metadata-only `model_response` maps to a legacy response with declared
  content loss; the existing E2L-073 (`chunkIndex` unavailable) is
  unchanged.
- **Fixtures** (updated additively, slice S1): a new multi-choice streaming
  fixture carries `choiceIndex` per chunk and per-choice `chunkIndex`; a
  streaming fixture carries `responseMeta` on the first `model_response`,
  `assembly` on the trace, and `declaredLosses`/`lifecycle` on completeness;
  the existing `trace-3` fixture remains valid (additive fields are
  optional; its single-choice `chunkIndex` 0/1/2 semantics are unchanged).
  All 1.1.0 fixture records pass `parseEvidenceRecord` (1.1.0) and the
  `metadata-safe` v1.1.0 policy.

### 13.6 Usage normalization (exact shapes)

Provider numeric usage becomes `UsageValue`/`UsageRecord` as follows (the
actual `@signalglass/evidence` shapes, Spec 013 §3.3):

```ts
UsageValue  = { value?: number; evidenceStatus?: EvidenceStatus; reason?: string };
UsageRecord = { evidenceStatus: EvidenceStatus; reason?: string;
                inputTokens?: UsageValue; outputTokens?: UsageValue; totalTokens?: UsageValue };
```

| Provider report (OpenAI keys) | Canonical usage |
|---|---|
| `prompt_tokens: 3`, `completion_tokens: 1`, `total_tokens: 4` | `{ evidenceStatus: 'captured', inputTokens: { value: 3, evidenceStatus: 'captured' }, outputTokens: { value: 1, evidenceStatus: 'captured' }, totalTokens: { value: 4, evidenceStatus: 'captured' } }` |
| `total_tokens: 4` only (partial) | `{ evidenceStatus: 'captured', totalTokens: { value: 4, evidenceStatus: 'captured' } }` — absent fields are **omitted**, never fabricated |
| `prompt_tokens: 0`, `total_tokens: 0` | captured zero: `inputTokens: { value: 0, evidenceStatus: 'captured' }`, `totalTokens: { value: 0, evidenceStatus: 'captured' }` — a real observation, distinct from absence |
| No usage in the stream | no usage event; `provider-usage-absent` declared; never a fabricated zero record |
| Malformed usage block | no usage event; `unrecognized-provider-field` declared |
| Per-choice nested usage | discarded; `unrecognized-provider-field` declared; frame-level usage canonical (§6.3) |

- Every provider-supplied number is wrapped as
  `{ value: n, evidenceStatus: 'captured' }`; field-level status is
  `captured` for provider-reported values. The record-level
  `evidenceStatus` is `captured` for any parsed usage block. No plain
  numbers appear in the canonical usage shape.
- Exact serialized-shape tests are required (§21 T85).

### 13.7 Compatibility statement

- MAJOR-1 compat: 1.1.0 is a strict additive superset of 1.0.0.
- Existing 1.0.0 records, fixtures, validators, and stores are unaffected;
  existing tests remain green (contract changed only by addition).
- The 1.1.0 minor does not alter any existing field's meaning except the
  additive refinement of `chunkIndex`'s definition (per-choice ordinal,
  §4.2), which is consistent with every existing fixture.
- 1.1.0 records presented to the **v1.0.0 persistence policy** are
  `policy-rejected` (unknown-additive-field), never silently reinterpreted
  (§14.3).
---

## 14. Persistence-policy versioning: `metadata-safe` v1.1.0

**Decision 14 — the persistence-policy change is versioned.
`signalglass.persistence.metadata-safe` v1.0.0 (Spec 015) has a closed
permitted-field matrix; the 1.1 additive fields change admission behavior,
so the reference policy advances to v1.1.0 with exact added rows, v1.0
compatibility, defined v1.0-policy behavior for 1.1 records, and stored
policy metadata. v1.0 is never silently reinterpreted.**

### 14.1 Why a new policy version

Spec 015's `signalglass.persistence.metadata-safe` v1.0.0 classifies every
canonical field through a closed permitted-field matrix; undeclared present
fields are rejected (`unknown-additive-field`). The 1.1 additive fields
(`responseMeta`, `choiceIndex`, `completeness.declaredLosses`,
`completeness.lifecycle`, `trace.assembly`) are new present fields — v1.0.0
has no rows for them. Their admission is a policy decision, so the policy
itself advances to **v1.1.0**.

### 14.2 v1.1.0 added matrix rows

| Field path | Classification | Admissible |
|---|---|---|
| `payload.responseEnvelope.responseMeta.statusCode` | meta (bounded integer 100–599) | yes |
| `payload.responseEnvelope.responseMeta.contentType` | bounded label (≤128 cp, RFC 6838 grammar) | yes |
| `payload.responseEnvelope.responseMeta.contentEncoding` | bounded label (≤32 cp, token grammar) | yes |
| `payload.responseEnvelope.choiceIndex` | meta (non-negative integer) | yes |
| `completeness.declaredLosses` | bounded-label array (closed codes only, ≤64 entries) | yes |
| `completeness.lifecycle.observation.terminal` | bounded label (closed `TerminalReason`) | yes |
| `completeness.lifecycle.transport.end` | bounded label (closed `TransportEndReason`) | yes |
| `completeness.lifecycle.transport.delivery` | bounded label (closed `DeliveryOutcome`) | yes |
| `trace.assembly.name` | literal label (`signalglass.streaming.assembler`) | yes |
| `trace.assembly.version` | bounded label (semantic version, §15) | yes |
| `trace.assembly.decoderContract.name` | literal label (`signalglass.providers.openai-sse`) | yes |
| `trace.assembly.decoderContract.version` | bounded label (semantic version) | yes |

All v1.0 rows are unchanged. The v1.1.0 matrix is closed, like v1.0.0's:
fields outside it are rejected.

### 14.3 Compatibility and non-reinterpretation

- **v1.0 record → v1.1.0 policy**: accepted (all new fields optional;
  additive).
- **v1.1 record → v1.0.0 policy**: **`policy-rejected` with
  `unknown-additive-field`** for each 1.1 field — the v1.0 matrix is closed
  and is **never silently reinterpreted** to admit the new fields. Tests
  prove this behavior (no downgrade, no implicit acceptance).
- **Stored policy metadata**: the policy `name`/`version` active at save
  time are recorded with the record per Spec 015's stored-policy-metadata
  mechanism (bounded policy-version metadata, unspoofable reference-policy
  identity) — so a record stored under v1.1.0 is distinguishable from one
  stored under v1.0.0.
- **Policy identity**: `signalglass.persistence.metadata-safe` v1.1.0 is a
  new branded reference-policy instance (Spec 015 brand check applies);
  spoofed plain objects are rejected.

### 14.4 Tests required

- v1.1.0 accepts every 1.1 fixture record (§13.5).
- v1.0.0 rejects a 1.1 record (`unknown-additive-field`), never
  reinterpreted.
- v1.1.0 accepts a v1.0 record unchanged.
- Stored policy metadata reflects the version that made the decision.
- Matrix closures: an unknown field inside a new container is rejected.

---

## 15. Structured assembler version

**Decision 15 — the assembler identity and versions are recorded
structurally on the record, with literal names validated exactly, semantic
versions, defined absence, and a version-bump table. The `boundaryStatement`
is derived text, never the version source of truth.**

### 15.1 `trace.assembly` (additive, §13.2)

```ts
assembly: {
  name: 'signalglass.streaming.assembler';     // LITERAL: validated exactly, not an arbitrary string
  version: string;                             // semantic version (semver), validated
  decoderContract?: {
    name: 'signalglass.providers.openai-sse';  // LITERAL: validated exactly
    version: string;                           // semantic version, validated
  };
}
```

- **Literal-name validation**: `assembly.name` must equal
  `signalglass.streaming.assembler` exactly; `decoderContract.name` must
  equal `signalglass.providers.openai-sse` exactly. Any other value is a
  parse refusal (1.1 validation), never a bounded-string free-for-all.
- **Semantic-version validation**: `assembly.version` and
  `decoderContract.version` are validated as semantic versions
  (`major.minor.patch`); invalid versions are parse refusals.
- **Absence behavior**: `assembly` is present on every record assembled by
  this spec (required on 1.1 streaming records). `decoderContract` is
  **absent** when no decoder participated — e.g. a future non-provider
  stream source, or an assembly path with no provider decoding. Absence is
  explicit; no placeholder decoder entry is fabricated.
- **Bump table** — exactly which observable changes require which version
  bump:

| Observable change | Version to bump |
|---|---|
| Assembler output change (event set, sequencing, status derivation, completeness fields) | `ASSEMBLER_ALGORITHM_VERSION` (`assembly.version`) |
| Decoder mapping change (provider shapes → `StreamDecodedEvent`) | `decoderContract.version` |
| Capture-settings change (excerpt length default, redaction rules, detector version) | capture-profile version (`signalglass.collection.ingress-metadata-safe`) |
| Additive canonical-shape change | `evidenceSchemaVersion` minor (e.g. 1.1.0 → 1.2.0) |
| Non-additive semantic change to the canonical model | `evidenceSchemaVersion` major |
| Persistence-policy admission change | persistence-policy version (`signalglass.persistence.metadata-safe`) |

- `ASSEMBLER_ALGORITHM_VERSION` is a semver constant in
  `@signalglass/streaming` (initial `1.0.0`); the capture profile and policy
  versions are constants in their packages; all are recorded per record.
- `boundaryStatement` remains human-facing explanatory text derived from the
  structured fields and loss codes (§7.3); it is **not** the version source
  of truth.

---

## 16. Persistence outcomes: `SaveOutcome` vs. environmental failures

**Decision 16 — persistence observations separate the structured
`SaveOutcome` statuses (Spec 015) from leak-free environmental/configuration
failures. Contention exhaustion is a thrown `EvidenceContentionError`, never
a `SaveOutcome`; this slice catches it into a closed leak-free code.**

### 16.1 The Spec 015 API reality

- `saveEvidenceRecord` returns `SaveOutcome` — a **closed status union
  without `contention`**: `stored | already-present | conflict | invalid |
  unsupported-version | safety-rejected | policy-rejected | policy-failed |
  clock-failed` (§12.2, verified against `packages/storage/src/evidenceStorage.ts`).
- **Contention exhaustion throws** `EvidenceContentionError`
  (`code: 'EVIDENCE_CONTENTION_EXHAUSTED'`) when a competing write could not
  be resolved within the bounded retry policy (Spec 015 §5.2). Its message
  is fixed and carries no record content, identity, or secret. It is an
  **environmental error, not a structured outcome**: the record was neither
  stored nor observed.

### 16.2 The observation contract

```ts
type PersistenceObservation =
  | { kind: 'save-outcome'; status: SaveOutcomeStatus }
  | { kind: 'environmental-failure'; code: EnvironmentalFailureCode };

type EnvironmentalFailureCode = 'contention-exhausted' | 'storage-unavailable' | 'policy-crash';
```

- `save-outcome` carries exactly the `SaveOutcome.status` value (plus, when
  `stored`, the Spec 015 identity/digest/manifest per the API — those are
  API contract fields, not diagnostics).
- `environmental-failure` carries only the closed code:
  - `contention-exhausted` — `EvidenceContentionError` caught;
  - `storage-unavailable` — storage/database-level failure caught
    (open/IO/read-path errors that are not `SaveOutcome`s);
  - `policy-crash` — the persistence policy threw during evaluation.
- **Leak-free rule**: diagnostics derived from a caught exception carry
  only the closed code. **Never** copy exception messages, identities,
  documents, digests, or payload values into diagnostics.
- **A thrown exception is never claimed to be a `SaveOutcome`.** The two
  kinds are disjoint; tests assert that an exhausted contention path yields
  `{ kind: 'environmental-failure', code: 'contention-exhausted' }` and
  never a `save-outcome` with a contention status.

### 16.3 Timing and isolation (unchanged from §3.2)

- The save runs only after the client response path finished/closed; a
  synchronous save never runs in the forwarding/backpressure data path.
- Any persistence failure — outcome or environmental — is post-response and
  can neither delay nor mutate client bytes (§9.4).
- The observation never rewrites the terminal state, the trace status, or
  the record (§10.6).
---

## 17. Data flow

```text
client POST /v1/chat/completions {stream:true}
   │  identity assigned at header observation (traceId == interactionId)
   ▼
readJsonBody (bounded, 10 MB) ──invalid/incomplete/over-limit──► request-failed (§10.2)
   │ valid
   ▼
assemble model_request (bounded excerpt messages) + span_start(model)
   │
   ▼
dispatch to upstream (env-var API key; Accept-Encoding: identity; 30 s establish timeout)
   │ key unavailable at resolution ──► request-failed (actor capture) — before dispatch
   │
   ├── connect/timeout/TLS failure (no headers) ──► upstream-failed; no model_response; no status
   ├── HTTP error / non-SSE 2xx (headers observed) ──► model_response(responseMeta) → error
   └── 2xx text/event-stream
        │
        ▼
   response headers: allowlist (content-type, content-encoding) + x-signalglass-trace-id
   model_response event emitted (responseMeta; first response-derived event)
   response body: raw Buffers
        │
        ├── L1 transport bytes ──► client socket (passthrough, backpressured, byte-exact)
        │         │
        │         └── tee: decoder (gzip/deflate) ── unsupported/decode-failure ──► observation-detached
        │
        ▼
   L2 parser (frames) ──parser-level malformed ──► malformed-stream
        │
        ▼
   L3 decoder (FrameDecodeResult; provider-neutral events; multi-choice normalization)
        │   ├── unrecognized ──► declared loss; continue
        │   ├── decode-error ──► observation-detached
        │   └── malformed (incl. same-frame duplicate choice index) ──► malformed-stream
        ▼
   L4 assembler: canonical events (seq assigned; choiceIndex/chunkIndex; usage;
                 finish reasons; evidence statuses; declarations; declared losses)
        │
        ▼
   terminal observed (first wins): completed / upstream-failed / client-cancelled /
                      ingress-cancelled / malformed-stream / request-failed /
                      observation-detached
        │
        ▼
   causal terminal event → interaction_end (exactly once; nothing after)   (§10.5)
        │
        ▼
   transport end observed independently: TransportEndReason + DeliveryOutcome (§2)
        │
        ▼
   client response finish/close   (never blocked by storage)
        │
        ▼
   finalize(): CompletenessSummary (honest facts only, §12.3) + 1.1 record
        │            (completeness.declaredLosses, completeness.lifecycle,
        │             trace.assembly, responseMeta, choiceIndex)
        ▼
   saveEvidenceRecord (exactly once) ──► PersistenceObservation (§16)
        │       save-outcome status | environmental-failure code (leak-free)
        │       (never rewrites outcome)
        ├── legacy projection (dual emission) + divergence detection (§9)
        └── crash before save ──► system-level declared loss: no record (§3.3, §19.2)
```

## 18. Privacy and diagnostic rules

- **API keys**: env-var-only (Spec 006). The assembler never reads, retains,
  or records key values; the upstream authorization header is built at
  dispatch and excluded from evidence structurally. No secrets, tokens, or
  credential material may appear in any record, log, error text, boundary
  statement, or diagnostic (§8.4).
- **No raw payloads by default**: no raw request bodies, raw provider JSON,
  raw wire bytes, or full tool results are retained by the default profile
  (§8.1, §7.3 codes).
- **No response header values except the validated bounded allowlist**
  (§5.1): `content-type` (normalized), `content-encoding` (token), and the
  `x-signalglass-trace-id` the ingress itself adds. Cookie, auth, and other
  sensitive header values never enter evidence or logs.
- **Bounded response metadata**: `responseMeta` holds only `statusCode` plus
  the two normalized header values, on the single `model_response` event
  (§13.3).
- **Structural error text**: closed codes + fixed bounded descriptions,
  secret-free by construction (§8.4).
- **Leak-free persistence diagnostics**: environmental failures are reduced
  to closed codes; exception messages, identities, documents, digests, and
  payload values are never copied into diagnostics (§16.2).
- **Redaction/truncation**: the collection-time privacy process
  (detect-then-retain, §8.2) masks credential spans before the length
  boundary; owning statuses and declarations are recorded; masked content is
  declared loss `original-content-masked`.
- **Diagnostics**: logs carry trace ids, state names, and closed codes, not
  payloads; divergence-detection counters surface projection mismatches
  without content (§9.3).
- **Local databases and `.signalglass/` data directories are never
  committed** (repository rule; unchanged).

---

## 19. Declared losses and crash limitations

### 19.1 Per-record declared losses (canonical, structured)

Every assembled record carries `completeness.declaredLosses` — closed codes,
deterministic order, deduplicated (§7.3) — computed from what was actually
observed, never a static list. Examples:

| Situation | Declared losses |
|---|---|
| Default profile, completed single-choice stream with usage | `provider-native-not-retained`, `request-body-not-retained`, `message-content-not-retained` (excerpted), `delta-content-not-retained`, `wire-bytes-not-retained`, `content-type-parameters-not-retained` (when params dropped), possibly `original-content-masked` |
| Provider reported no usage | + `provider-usage-absent` |
| No finish reason before `[DONE]` | + `finish-reason-absent` |
| Delta carries role/tool_calls/refusal/audio sub-fields | + `unmapped-delta-fields` |
| Per-choice nested usage | + `unrecognized-provider-field` |
| Unrecognized extension frame | + `unrecognized-extension-frame` (observation continues) |
| Observation detached mid-stream | + `frame-after-observation-detach`, `encoded-content-not-observed` (when encoding), etc. |
| Client cancellation mid-stream | + `remainder-after-client-cancellation` |
| Ingress cancellation | + `remainder-after-ingress-cancellation` |
| Upstream HTTP error | + `provider-error-body-not-retained` (error body), `request-body-not-retained`, `wire-bytes-not-retained` |

### 19.2 Crash limitations (system-level, declared in docs)

| Failure | Consequence | Declared where |
|---|---|---|
| Crash/kill/power loss before save | No record for the interaction — `crash-no-record` is a **system-level declaration**, never a per-record code (a record that exists was persisted; a crashed interaction has no record to carry it) | This spec §3.3; `docs/ingress.md`; `docs/roadmap.md` #40 |
| Crash after `stored` returned | Record durable per Spec 015 | Spec 015 |
| Crash mid-observation | No partial/checkpointed record; no fabricated recovery | §3.3; roadmap #40 defers recovery journaling |
| Storage unavailable at save time | `policy-failed`/`clock-failed` `save-outcome`, or `environmental-failure` code; record lost (no queue in this slice) | §16 |

The ingress never fabricates a "recovered" identity, a completion, or a
placeholder record for an unpersisted stream.
---

## 20. Implementation slices (corrected order)

The spec is implemented in five ordered slices once Accepted. **The complete
1.1 canonical foundation precedes any slice that emits or consumes 1.1
records.** Every slice builds and tests against the contracts it actually
uses; no slice relies on casts or on unknown-additive-field preservation as a
substitute for owned validation. Each slice is a separate accepted
implementation PR with its own acceptance criteria, tests, and review; none
of the modules exist until its slice.

| # | Slice | Delivers | Depends on |
|---|---|---|---|
| S1 | **Canonical 1.1 foundation** (`@signalglass/evidence`): 1.1 types (`responseMeta`, `choiceIndex`, `completeness.declaredLosses`, `completeness.lifecycle`, `trace.assembly`), owned validation (bounds, grammars, closed-code refusal, literal names, semver), serializer/parser round trips, 1.1 fixtures, version contracts (1.0↔1.1 both directions) | The types and validators every later slice emits records against | Evidence (existing) |
| S2 | **Versioned policy + projections**: `signalglass.persistence.metadata-safe` v1.1.0 matrix rows (§14.2), v1.0/v1.1 interaction tests (§14.4), projection-loss rows (§13.5) | Policy rows classify the 1.1 fields S1 defined | S1 |
| S3 | **`@signalglass/streaming`: `types.ts` + `sse.ts`** — closed vocabularies (§12.2), `CompletenessSummary` (§12.3), `createSseParser()` and the SSE parser matrix (§6.1) | Parser and contracts; emits no records | S1, S2 |
| S4 | **`@signalglass/streaming`: `assembler.ts` + `@signalglass/providers` decoder** — `decodeSseFrame` (L3, multi-choice normalization, provider-neutral events), `createStreamAssembler()` (state machine §10, sequencing §4, collection layer §8.2, `model_response` response-metadata event §6.6, `CompletenessSummary`, 1.1 records with `declaredLosses`/`lifecycle`/`assembly`) | The assembler emits 1.1 records against the S1/S2 contracts | S1, S2, S3 |
| S5 | **`apps/ingress` wiring + persistence + legacy**: `streamHandler.ts` (raw-Buffer read, passthrough, backpressure, header allowlist, decoder tee, transport-end observation, error envelopes), save-after-response-completion (§3.2), `PersistenceObservation` split (§16), dual emission + divergence detection (§9), end-to-end tests | Network slice; persistence integration | S1–S4 |

S1 and S2 are the 1.1 foundation and MUST land before any slice that emits
or consumes 1.1 records (S4, S5). S3 needs S1/S2 only for the types it
imports (vocabularies, completeness). No slice emits records with unvalidated
fields; `parseEvidenceRecord` (1.1) is the gate in every slice that produces
a record. Tests in §21 map to slices as annotated.

---

## 21. Testing and conformance requirements

### 21.1 Test groups (85 named groups)

Groups are named so the acceptance-criteria mapping (§22) can reference them.
Slice annotations: `S1`…`S5`.

**SSE parsing (10) — S3**

- T01 `SSE: frame splitting and reassembly across chunks`
- T02 `SSE: CRLF/LF/CR line endings`
- T03 `SSE: comment and blank lines`
- T04 `SSE: multiline data joined with \n`
- T05 `SSE: event/id/retry fields parsed, values not retained`
- T06 `SSE: split multi-byte UTF-8 decoded per frame`
- T07 `SSE: [DONE] exact-value terminal marker`
- T08 `SSE: invalid UTF-8 → sse-invalid-utf8`
- T09 `SSE: partial frame at EOF → sse-partial-frame-at-eof`
- T10 `SSE: 16 MiB frame cap → overflow signal, parser resets, observation bound declared`

**Multi-choice normalization (8) — S3/S4**

- T11 `MultiChoice: frame with several choices expands in array order`
- T12 `MultiChoice: choiceIndex normalization (provider index / position / single-choice 0)`
- T13 `MultiChoice: per-choice chunk ordinals are independent (chunkIndex vs choiceIndex)`
- T14 `MultiChoice: same choiceIndex across frames is continuation (ordinals continue); out-of-order indexes preserved, never renumbered`
- T15 `MultiChoice: negative/non-integer choice index → sse-invalid-choice-index`
- T16 `MultiChoice: frame with several choices AND usage → choices then usage; per-choice finish reasons; one frame → multiple contiguous canonical events`
- T17 `MultiChoice: fixtures + projection parity (choiceIndex/chunkIndex semantics; E2L rows)`
- T18 `MultiChoice: adversarial duplicates — same-frame duplicate choice.index → sse-invalid-choice-index (malformed); repeated duplicate across frames → continuation with declared identity; never merged silently`

**Assembly (8) — S4**

- T19 `Assembler: full-stream canonical sequence and ordering (incl. terminal-event sequence: causal event → interaction_end → nothing)`
- T20 `Assembler: seq contiguity/uniqueness; no renumbering; no fabricated gaps`
- T21 `Assembler: identity determinism (traceId/interactionId/eventId/observationId opaque)`
- T22 `Assembler: usage placement matrix (before/after finish; usage-only terminal chunk; absent)`
- T23 `Assembler: finish reason on the carrying chunk; never fabricated`
- T24 `Assembler: captured zero distinct from absent; no fabricated zeros`
- T25 `Assembler: model span lifecycle (completed; unknown on failure/cancel/detach)`
- T26 `Assembler: [DONE] without usage/finish completes with declarations`

**Terminalization (9) — S4**

- T27 `Terminal: EOF without [DONE] → malformed-stream`
- T28 `Terminal: upstream HTTP error → upstream-failed (model_response with responseMeta.statusCode first; error event; no upstreamStatus field)`
- T29 `Terminal: connect/timeout/TLS → upstream-failed (no headers observed; no model_response; no status anywhere)`
- T30 `Terminal: non-SSE 2xx → upstream-failed (non-sse-response); model_response emitted; bytes forwarded unchanged`
- T31 `Terminal: provider error frame → upstream-failed (provider-error-frame)`
- T32 `Terminal: client disconnect → client-cancelled (stops upstream reading)`
- T33 `Terminal: ingress cancellation/shutdown → ingress-cancelled`
- T34 `Terminal: precedence — first observed terminal wins within the observation lifecycle (EOF vs [DONE]; cancel vs failure)`
- T35 `StateMachine: closed transition table; illegal transitions rejected; no transitions out of terminal; no wall-clock completion; finalized is an operation; persistence outcomes are not states`

**Request failure (3) — S4**

- T36 `RequestFailure: invalid/incomplete/over-limit/unroutable → request-failed (codes, actor/role, no dispatch, identity recorded, no model span)`
- T37 `RequestFailure: upstream-key-unavailable → request-failed (actor capture), classified exactly once; absent from UpstreamFailureCode and the upstream-failed mapping`
- T38 `RequestFailure: no response → no model_response, no status anywhere; request-level declared losses`

**Two lifecycles / transport end (10) — S5**

- T39 `Lifecycle: observer failures never stop forwarding, never destroy the upstream request, never inject or truncate frames`
- T40 `Lifecycle: malformed provider frame → canonical malformed-stream terminal while passthrough continues byte-unchanged`
- T41 `Lifecycle: unrecognized extension frame → declared loss, observation continues, no model failure`
- T42 `Lifecycle: internal parser/decoder exception → observation-detached (status unknown, informational capture error), passthrough continues`
- T43 `Lifecycle: frame overflow → observation-detached without unbounded buffering, passthrough continues`
- T44 `Lifecycle: unsupported/undecodable content-encoding → observation-detached, passthrough continues`
- T45 `Lifecycle: after detach — no seq, no content, no [DONE] inference; remainderObservation unknown; no inferred frame count (honest facts only)`
- T46 `Race: [DONE] parsed then client close before response finish → observation completed + transport client-cancelled/closed, both persisted`
- T47 `Race: observation detaches then transport completes → observation-detached + response-complete/flushed, both persisted`
- T48 `Race: malformed observation + successful passthrough completion → malformed-stream + response-complete/flushed, both persisted; delivery flushed vs closed distinguished`

**Encoded-stream transparency (6) — S5**

- T49 `Encoded: upstream honors Accept-Encoding: identity → direct parse`
- T50 `Encoded: gzip despite identity → raw gzip bytes forwarded; observer decodes copy; content-encoding forwarded`
- T51 `Encoded: unsupported content-encoding → passthrough unchanged, observation-detached`
- T52 `Encoded: observer decode failure → passthrough unchanged`
- T53 `Encoded: header consistency (content-encoding forwarded; content-length never)`
- T54 `Encoded: encoded text/event-stream is SSE, not non-SSE (own capture outcome)`

**Transparency/backpressure (4) — S5**

- T55 `Transparency: response body bytes identical to upstream (body boundary, not headers)`
- T56 `Transparency: no silent frame mutation (no synthetic [DONE], no injection/removal/reorder/rewrite)`
- T57 `Backpressure: slow client pauses upstream read`
- T58 `Transparency: header allowlist (content-type, content-encoding, trace id); no other upstream header values; content-length never forwarded`

**Collection privacy (6) — S4/S5**

- T59 `Privacy: detect-then-retain — detector scans full text before excerpting`
- T60 `Privacy: credential begins before / crosses / begins after the 240-char boundary — masked in full (sentinels)`
- T61 `Privacy: owning status redacted vs truncated; RedactionDeclaration/TruncationDeclaration recorded; original-content-masked loss`
- T62 `Privacy: secrets never in outputs (sentinels across records, logs, errors, boundary statements)`
- T63 `Privacy: no raw payloads by default; provider-native not retained without explicit fidelity/status; unmapped delta fields declared`
- T64 `Privacy: admission invariant — default records reach the Spec 015 gate with no S1/S2/S3/S5/S6 witness; a rejection is surfaced and never auto-labeled a code defect`

**Persistence (7) — S5**

- T65 `Persistence: exactly one save, after client response finish/close — save-call order asserted vs finish/close`
- T66 `Persistence: synchronous save never runs in the data/backpressure path`
- T67 `Persistence: save-outcome observations (kind save-outcome); record not rewritten`
- T68 `Persistence: environmental failures — EvidenceContentionError → contention-exhausted, leak-free diagnostics, never a save-outcome; storage-unavailable; policy-crash`
- T69 `Persistence: storage failure post-response never delays or mutates client bytes`
- T70 `Persistence: crash mid-stream leaves no record (declared); crash-no-record never appears on a record; no fabricated recovery`
- T71 `Persistence: conflict/idempotency per Spec 015; unsupported-version handling; no down-conversion`

**Legacy coexistence (3) — S5**

- T72 `Legacy: dual emission from one observation`
- T73 `Legacy: divergence detection surfaced, never silently reconciled; parity`
- T74 `Legacy: client traffic isolation (no persistence path affects traffic)`

**Contracts/versioning/schema (11) — S1/S2/S3**

- T75 `Contracts: closed unions (incl. TransportEndReason, DeliveryOutcome, RemainderObservation, EnvironmentalFailureCode); no reason: string for aborted; declaredLosses closed; seqGaps removed`
- T76 `Contracts: internal exports stay internal; public entry points per §12.5`
- T77 `Versioning: trace.assembly literal names validated exactly; semver versions; decoderContract absence; version-bump table honored`
- T78 `Schema: completeness.lifecycle — observation terminal + transport end + delivery persisted structurally and independently; round-trip; storage retrieval parity; projection loss; never rewritten from each other`
- T79 `Schema: completeness.declaredLosses — serialized path; validation (unknown codes refused); deterministic order/dedup; round-trip; retrieval parity; projection loss; boundaryStatement derived, not the persisted record`
- T80 `Schema: responseMeta placement — usage-only / [DONE]-only / no-content / HTTP-error / non-SSE paths; single model_response; no duplication; absence per path`
- T81 `Schema: additive 1.1 fields validate and round-trip; 1.0 records read by 1.1 readers and vice versa`
- T82 `Schema: metadata-safe v1.1.0 matrix rows; v1.0 policy rejects a 1.1 record (never silently reinterpreted); stored policy metadata; closure of new containers`
- T83 `Schema: usage contract — UsageRecord/UsageValue exact shapes, per-field status, captured zero vs absence, partial usage; per-choice nested usage discarded + declared`
- T84 `Schema: 1.1 fixtures pass parseEvidenceRecord(1.1) + metadata-safe v1.1.0; projection loss rows; slice-order honesty (each slice builds against contracts it uses; no casts or unknown-field-preservation substitutes)`
- T85 `Schema: usage serialized-shape tests (exact JSON shapes for the §13.6 matrix)`

### 21.2 Conformance requirements

- Every acceptance criterion (§22) is covered by at least one test group;
  the mapping is **many-to-many** — a criterion may be covered by several
  groups and a group may cover several criteria — and is declared as such
  (§23).
- Tests run under `pnpm test` (Vitest) with the repository's existing
  conventions; fixtures live under `@signalglass/evidence/src/fixtures/`
  and per-package `__tests__`.
- S1 ships fixture/contract tests for the serialized 1.1 shapes (incl. the
  usage-shape matrix); S2 ships policy-matrix and non-reinterpretation
  tests; S5 ships end-to-end and race tests. Regression tests accompany
  every bug fixed during implementation.
- No blocking architecture question may be left labeled as an
  "implementation detail" in review; every point in §24 is normatively
  resolved.

---

## 22. Acceptance criteria

A spec implementation is complete only when **all** criteria below are
satisfied by tests (per the repository's spec workflow):

1. **Two lifecycles separated** — an observer/parser/decoder failure never
   stops forwarding, never destroys the upstream request, never injects a
   frame, and never truncates an otherwise forwardable response; only
   client cancellation, ingress shutdown/limit, or upstream transport
   failure ends the transport lifecycle. [T39–T45]
2. **Both lifecycle outcomes persisted independently** — the observation
   terminal and the transport end with its delivery outcome are recorded
   structurally in the canonical record; neither rewrites the other; trace
   status is derived only from the observation terminal. [T46–T48, T78]
3. **Honest observer-failure semantics** — malformed provider protocol
   terminalizes `malformed-stream` (trace `failed`, actor `model`, role
   `provider_reported`); internal observer failure detaches observation
   (trace `unknown`, informational capture error); an unrecognized
   extension is a declared loss, never a model failure. [T40–T44]
4. **Observation detachment discipline** — after detach: no `seq`, no
   content, no inferred `[DONE]`/completion; `remainderObservation:
   'unknown'`; no fabricated frame counts. [T45]
5. **Single canonical save** — exactly one `EvidenceRecord` per observed
   streaming interaction, saved exactly once via `saveEvidenceRecord`; no
   checkpointing, revisions, or upserts. [T65]
6. **Save after response completion** — the save is invoked only after the
   client response path finished/closed; no synchronous save in the
   forwarding/backpressure data path; a storage failure is post-response
   and never delays or mutates client bytes. [T65, T66, T69]
7. **Deterministic identity** — opaque `traceId == interactionId` assigned
   at request observation, never content-derived; fresh per observed
   request; one observed request → one record (including request-failed).
   [T21, T36]
8. **Single sequencing surface** — the assembler assigns contiguous `seq`
   from 0; timestamps and content hashes never order or identify;
   unparseable frames leave no fabricated gap. [T19, T20]
9. **Multi-choice normalization** — `choiceIndex` (normalized choice
   identity) and `chunkIndex` (per-choice ordinal) are distinct and never
   interchanged; array-order expansion; **duplicate `choice.index` within
   one frame is rejected as malformed**; the same index across frames is
   one choice's continuation; out-of-order indexes preserved; per-choice
   finish reasons; frame-level usage after choice events; one frame →
   multiple contiguous canonical events. [T11–T18]
10. **Provider delta-field losses** — valid OpenAI-compatible delta fields
    not represented by `delta: string | null` (role, tool_calls, refusal,
    audio, multimodal, future extensions) are declared losses, never
    silently reduced to `null`. [T63, T83]
11. **Frame-level decode contract** — `decodeSseFrame` returns an ordered
    zero-or-more `events` result (or `done`/`malformed`/`unrecognized`/
    `decode-error`); one frame expands deterministically. [T11, T16, T17]
12. **Provider-neutral output** — the decoder emits normalized events
    (string deltas, `UsageRecord`/`UsageValue` usage, bounded finish
    reasons, structural provider error codes); raw provider JSON stays in
    `@signalglass/providers` unless retained under the `providerNative`
    contract with explicit fidelity/status; per-choice nested usage is
    discarded and declared. [T17, T63, T83]
13. **Closed vocabularies** — `MalformedStreamCode`, `StreamDecodeErrorCode`,
    `ObservationFailureCode`, `UpstreamFailureCode`,
    `ClientRequestFailureCode`, `CancellationSource`, `TerminalReason`,
    `TransportEndReason`, `DeliveryOutcome`, `RemainderObservation`,
    `AbortReason`, `DeclaredLossCode`, `EnvironmentalFailureCode`,
    `PersistenceObservation` are closed unions; no `reason: string` for
    aborts; `declaredLosses` is a closed code list with derived display
    sentences; `seqGaps` is removed. [T75, T76]
14. **Coherent terminal state machine** — the seven terminal states and the
    diagram, transition table, `AssemblerState`, `AssemblerOutcome`,
    `TerminalReason`, event mapping, trace status, criteria, and tests
    agree exactly; `finalized` is an operation, not a state; persistence
    outcomes are observations, never state rewrites; no wall-clock
    completion; first observed terminal wins; `upstream-key-unavailable`
    is classified exactly once under `request-failed` (actor `capture`)
    and is absent from `UpstreamFailureCode` and the `upstream-failed`
    mapping. [T27–T38]
15. **Terminal-event sequence** — the causal terminal event (`error`/
    `cancelled`) is emitted first at its `seq`; `interaction_end` is
    emitted exactly once as the final canonical event; nothing follows
    `interaction_end`. [T19, T34, T35, T46–T48]
16. **Collection-time privacy process** — versioned sensitive detector
    scans full text before excerpting; credential spans are masked/omitted
    before the length boundary; owning `redacted`/`truncated` statuses and
    declarations are recorded; the Spec 015 gate and persistence policy
    still run non-bypassably. [T59–T64]
17. **Sentinel coverage** — credentials beginning before, crossing, and
    beginning after the excerpt boundary are masked in full. [T60]
18. **Honest admission claim** — default records are *expected* admissible
    (tested construction invariant: no S1/S2/S3/S5/S6 witness), while a
    safety rejection remains an honest possible outcome that is surfaced
    and never auto-labeled a code defect. [T64]
19. **Canonical schema extension** — additive 1.1.0 (`responseMeta`,
    `choiceIndex`, `completeness.declaredLosses`, `completeness.lifecycle`,
    `trace.assembly`) with exact owner/path/shapes, absence rules, owned
    validation, round-trip preservation, `metadata-safe` v1.1.0 matrix
    rows, projection-loss rows, and 1.1 fixtures; MAJOR-1 compat both
    directions; **no `upstreamStatus` field** (removed in revision 3).
    [T77–T85]
20. **responseMeta universal placement** — a single `model_response` event
    is emitted when response headers are observed, before any chunk/usage/
    error, on every path (usage-first, `[DONE]`-only, no-content-chunk,
    non-SSE 2xx, upstream HTTP error); `responseMeta` appears only there;
    absence is defined for header-less paths; no duplication. [T28–T30,
    T80]
21. **Structured declared losses persisted** —
    `completeness.declaredLosses` is canonical and structural: exact
    serialized path and type, deterministic derivation and
    ordering/deduplication, validation and unknown-code refusal,
    serializer/parser round trips, storage retrieval parity,
    `metadata-safe` v1.1.0 classification, projection loss, fixtures and
    tests; `boundaryStatement` is derived from the codes and is not the
    only persisted loss record; `crash-no-record` never appears on a
    record. [T79]
22. **Structured assembler version** — `trace.assembly` with literal name
    validated exactly, semantic-version validation, `decoderContract`
    absence behavior, and the version-bump table; `boundaryStatement`
    derived, not authoritative. [T77]
23. **Encoded-stream transparency** — raw-Buffer reads; exact encoded wire
    bytes forwarded; bounded decoder tee for observation; unsupported
    encoding → detached observation; encoded SSE is an SSE outcome, not
    non-SSE; header consistency (content-encoding forwarded, content-length
    never). [T49–T54]
24. **Body-bytes transparency boundary** — transparency applies to the
    response body; response headers are the validated bounded allowlist plus
    `x-signalglass-trace-id`; the "no header values except the allowlist"
    wording is used consistently. [T55, T56, T58]
25. **Byte/order-transparent passthrough** — response body bytes reach the
    client unchanged and in order under backpressure, with zero frame
    mutation. [T55–T57]
26. **Complete SSE parser matrix** — comments, blank lines, multiline data,
    CRLF/LF/CR, split frames, split UTF-8 decoded per frame, `[DONE]`
    exact-value, malformed JSON/UTF-8, partial frame at EOF, frame cap.
    [T01–T10]
27. **Usage/finish honesty** — usage placement matrix honored; usage uses
    the exact `UsageRecord`/`UsageValue` shapes; absent usage and absent
    finish reason are declared, never fabricated zeros or invented reasons;
    captured zero distinct from absent; `completed` requires the observed
    `[DONE]`. [T22–T26, T83, T85]
28. **Evidence-status closure** — every payload carries a closed-set status;
    statuses never omitted or `null`; captured zero distinct from absent;
    `unknown` reserved for unobservable terminations. [T24, T25, T45]
29. **Default-privacy guarantees** — env-var-only keys; no raw payloads by
    default; no response header values beyond the allowlist; structural
    error text; secrets never reach records/logs/errors. [T58, T62, T63]
30. **Legacy coexistence** — canonical authoritative; dual emission from one
    observation; divergence detection surfaced, never silently reconciled;
    client traffic unaffected by any persistence path. [T72–T74]
31. **Package boundaries** — `@signalglass/streaming` network-free with zero
    provider knowledge, depending only on `@signalglass/evidence`; provider
    decoding in `@signalglass/providers`; wiring in `apps/ingress`;
    persistence in `@signalglass/storage`; projections in `@signalglass/core`.
    [T75, T76]
32. **Contract hygiene** — public entry points are exactly the closed unions
    and `createSseParser()`/`createStreamAssembler()`; internal helpers are
    not exported. [T75, T76]
33. **End-to-end validity** — every assembled record passes
    `parseEvidenceRecord` (1.1.0) before save; the legacy projection and
    derived completeness agree with the record's canonical events. [T17,
    T26, T73, T84]
34. **Slice-order honesty** — the complete 1.1 foundation precedes any slice
    that emits 1.1 records; every slice builds and tests against the
    contracts it actually uses; no casts and no reliance on
    unknown-additive-field preservation as a substitute for owned
    validation. [T84]
35. **Persistence-policy versioning** — `metadata-safe` v1.1.0 with exact
    added matrix rows; v1.0 records accepted; a 1.1 record presented to the
    v1.0 policy is `policy-rejected` (never silently reinterpreted); stored
    policy metadata reflects the deciding version. [T82]
36. **Save-outcome vs environmental split** — contention exhaustion is an
    `environmental-failure` (`contention-exhausted`), never a `SaveOutcome`;
    environmental diagnostics carry only closed codes (leak-free); a thrown
    exception is never claimed to be a `SaveOutcome`. [T68]

---

## 23. Criterion-to-test mapping

The mapping is **many-to-many**: acceptance criteria (§22) and test groups
(§21.1) do not align 1:1. Each criterion is covered by at least one group
and most criteria are covered by several; several groups (e.g. T40–T45,
T75–T85) cover multiple criteria. The table in §22 lists each criterion's
covering groups inline; the reverse index is the group list in §21.1 with
its slice annotation. Completeness of coverage is verified mechanically in
the implementation review by checking every criterion against its listed
groups and every listed group against a criterion.

---

## 24. Open questions

**None.** Every item previously open is now resolved normatively:

- `responseMeta` shape, placement (single `model_response` at header
  observation), and absence per path — resolved (§13.3, §6.6);
  `upstreamStatus` removed (§13.2).
- Error-code spellings and vocabularies — resolved, closed (§12.2);
  `upstream-key-unavailable` classified exactly once (§10.4).
- Excerpt cap — resolved: default 240, valid range 64–4096, profile-version
  bump rule (§8.3).
- Encoded-stream transparency — resolved (§5.5).
- Persistence timing — resolved (§3.2, §16).
- Legacy divergence policy — resolved (§9.3).
- Duplicate choice indexes — resolved: same-frame rejection (§6.3, §4.2).
- Unmapped delta fields — resolved: declared losses (§6.3, §7.3).
- Lifecycle facts — resolved: both persisted structurally (§2, §13.2).
- Post-detachment counts — resolved: honest facts only, no inferred frame
  counts (§12.3).
- Persistence-policy version — resolved: v1.1.0 (§14).
- Contention — resolved: environmental failure, never a `SaveOutcome` (§16).

Deferred work is listed under Non-goals and §20 slices, not as open
questions. If a reviewer identifies a genuinely undecided point, it must be
resolved by an amended Accepted spec before implementation.

---

## 25. Documentation impact

When the spec is Accepted and implemented, the following docs change (docs
are **not** changed by this Draft PR beyond the index/roadmap updates
already made):

- `docs/ingress.md` — streaming data flow, two lifecycles, header allowlist,
  encoded-stream handling, crash limitation.
- `docs/trace-model.md` — streaming event refinement, legacy trace as
  compatibility projection.
- `docs/evidence-model.md` / `docs/model-versioning.md` — additive 1.1.0
  fields (`responseMeta`, `choiceIndex`, `completeness.declaredLosses`,
  `completeness.lifecycle`, `trace.assembly`) and the additive-minor
  mechanism.
- `docs/evidence-projection-matrix.md` — new loss rows (responseMeta,
  choiceIndex, completeness.declaredLosses, completeness.lifecycle,
  trace.assembly).
- `docs/privacy.md` — collection-time privacy process, detect-then-retain,
  excerpt bounds.
- `docs/capture-profiles.md` — the `signalglass.collection.ingress-metadata-safe`
  profile v1.0.0.
- `docs/architecture.md` — package map gains `@signalglass/streaming`.
- `docs/roadmap.md` — milestone #23 moves from forecast to Accepted when
  this spec is accepted.
- `specs/000-index.md` — Spec 016 row status transitions Draft → Accepted →
  Implemented.
- `specs/015-append-only-evidence-store.md` — reference to the v1.1.0
  policy minor and the v1.0 non-reinterpretation contract.

---

## 26. References

- [Spec 006 — Ingress, OpenAI-compatible](006-ingress-openai-compatible.md)
- [Spec 007 — Storage and privacy](007-storage-and-privacy.md)
- [Spec 013 — Evidence model](013-evidence-model.md)
- [Spec 014 — Evidence primitives](014-evidence-primitives.md)
- [Spec 015 — Append-only evidence store](015-append-only-evidence-store.md)
- [`docs/ingress.md`](../docs/ingress.md), [`docs/trace-model.md`](../docs/trace-model.md),
  [`docs/privacy.md`](../docs/privacy.md), [`docs/capture-profiles.md`](../docs/capture-profiles.md),
  [`docs/model-versioning.md`](../docs/model-versioning.md),
  [`docs/evidence-projection-matrix.md`](../docs/evidence-projection-matrix.md),
  [`docs/architecture.md`](../docs/architecture.md), [`docs/roadmap.md`](../docs/roadmap.md)
- [Server-Sent Events — HTML Standard](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119)
