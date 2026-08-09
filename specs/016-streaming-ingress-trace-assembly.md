# Spec 016: Streaming ingress and trace assembly

## Status

**Draft — revision 2 (architectural correction pass).** Proposed for
acceptance; **implementation is prohibited until this spec is Accepted**. No
runtime code is produced by this PR. The proposed modules, contracts, and
constants below are named but **not created** until an accepted
implementation slice.

Revision 2 resolves the first-draft review blockers: it separates the client
passthrough lifecycle from the evidence-observation lifecycle, defines
provider-neutral multi-choice decoding, closes every public vocabulary,
reconciles the terminal state machine, makes the default
collection/persistence claim honest, resolves the canonical schema extension
(additive `evidenceSchemaVersion` 1.1.0), records the assembler version
structurally, makes encoded-stream transparency implementable, clarifies the
body-vs-headers transparency boundary, tightens completion/persistence
timing, and corrects the review claims and open-questions list.

This spec is forecast-only in `docs/roadmap.md` (anticipated PR #23,
documentation-only; the implementation slices are a later, accepted
implementation PR).

## Purpose

Define how the OpenAI-compatible ingress ([Spec 006](006-ingress-openai-compatible.md))
observes a **streaming** chat-completions interaction and assembles **one
canonical `EvidenceRecord`** ([Spec 013](013-evidence-model.md),
[Spec 014](014-evidence-primitives.md)) from the observed pipeline — client
request → upstream dispatch → response headers → ordered SSE chunks → usage →
finish reason → `[DONE]` → errors/cancellation — with lifecycle and
completeness declarations, and persists that record exactly once after the
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
| [Spec 013](013-evidence-model.md) | Canonical evidence contract this spec assembles: `model_response_chunk`, `model_usage`, `error`, `cancelled`, `interaction_start/end`, `span_start/end`, evidence statuses, observation roles, capture boundary. |
| [Spec 014](014-evidence-primitives.md) | `@signalglass/evidence` types/validators/serialization the assembler's output must satisfy; §4.6 (streamed observations ordered by the single sequencing surface) is implemented by this spec; §4.7 terminal-state rules bind the assembler's status decisions; `ResponseEnvelope.chunkIndex` semantics are refined additively (§12). |
| [Spec 015](015-append-only-evidence-store.md) | `EvidenceStorage.saveEvidenceRecord` — the only persistence path for assembled records; the `metadata-safe` reference policy is the admission contract; the storage-safety gate is non-bypassable; the field/category conformance matrix gains rows for the additive fields (§12). |
| [`docs/ingress.md`](../docs/ingress.md) | Current non-streaming live-mode data flow; Spec 016's implementation updates it. |
| [`docs/trace-model.md`](../docs/trace-model.md) | "Streaming response event refinement" is listed as future work; the legacy `Trace` path becomes a compatibility projection (Spec 016 §8). |
| [`docs/privacy.md`](../docs/privacy.md) | Default capture/persistence boundaries the assembler must honor (metadata-safe defaults, env-var-only keys, no raw payloads by default). |
| [`docs/roadmap.md`](../docs/roadmap.md) | Streaming milestone; slice #23 (this spec); slice #40 (reliability/recovery — crash-recovery journaling is deferred to it). |

## Scope

Define, for a **streaming** OpenAI-compatible interaction observed by
`apps/ingress`:

1. The two lifecycles — client passthrough and evidence observation — and
   their separation (Spec 016 §1).
2. The assembly/persistence boundary: one canonical record, one save, after
   the client response path finishes (Spec 016 §2).
3. Deterministic identity and `seq` ordering (Spec 016 §3).
4. Streaming transparency: response-**body**-byte/order-transparent,
   backpressured passthrough with no silent frame mutation, and the four
   observation layers (Spec 016 §4).
5. SSE parsing, provider-neutral multi-choice normalization, and the
   terminalization matrix (Spec 016 §5).
6. The evidence-status vocabulary and the loss mapping for every assembled
   payload (Spec 016 §6).
7. Collection vs. persistence policy boundaries, including the
   collection-time privacy process (Spec 016 §7).
8. Legacy coexistence: canonical-authoritative dual emission with divergence
   detection (Spec 016 §8).
9. The deterministic terminal state machine (Spec 016 §9).
10. Package boundaries and the proposed module layout (Spec 016 §10).
11. Public contracts: provider-boundary output types and closed vocabularies
    (Spec 016 §11).
12. The canonical schema extension: additive `evidenceSchemaVersion` 1.1.0
    and its exact fields (Spec 016 §12).
13. The structured assembler-version location (Spec 016 §13).

The spec also defines the data flow (§14), privacy and diagnostic rules
(§15), persistence interaction (§16), declared losses and crash limitations
(§17), the phased implementation sequence (§18), the testing and conformance
requirements (§19), acceptance criteria (§20), the criterion-to-test mapping
(§21), open questions (§22), documentation impact (§23), and references (§24).

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
  explicitly **not** added; the crash limitation is declared (§2.3, §17).
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
| **Observation lifecycle** | The evidence-assembly lifecycle: the assembler's state machine (§1.3, §9). Observer failures degrade it; they never end the transport lifecycle. |
| **Sequencing surface** | The single capture component that assigns `seq` at observation time (Spec 013 §2.2). In this spec it is the assembler (§3). |
| **Observer failure** | Any failure of the parsing/decoding/assembly machinery (exception, configured bound exceeded, unsupported encoding, decode failure) — distinguished from malformed provider protocol (§1.4). |
| **Malformed provider protocol** | The provider's stream violates the observed protocol (invalid JSON/UTF-8 in data, invalid choice index, EOF/partial frame without `[DONE]`) — a provider-side observation, not an observer failure (§1.4). |
| **Observation detachment** | The explicit degraded state after an observer failure: canonical extraction stops; the transport passthrough continues unaffected; the record finalizes with status `unknown` (§1.4, §9). |
| **SSE frame** | One server-sent-event block: field lines terminated by a blank line. The parser's output unit (§4, §5). |
| **Transport byte** | The raw upstream response-body bytes observed at the ingress boundary, exactly as read from the socket (no decoding, no decompression). Never mutated by the ingress (§4). |
| **Parsed stream event** | A provider-neutral normalized event from the decoder's frame result: `chunk` / `usage` / `provider-error` (§5, §11). |
| **Canonical event** | An `EventRecord` (Spec 013 §3.1) the assembler derives from parsed stream events and lifecycle signals. |
| **Terminal marker** | The `[DONE]` data frame that signals normal stream termination. |
| **Terminal reason** | One of the closed `TerminalReason` values (§9, §11). |
| **Passthrough** | Forwarding the upstream response-body bytes to the client with content and order preserved (§4). |
| **Backpressure** | Slowing or pausing the upstream read when the client cannot consume (§4). |
| **Dual emission** | Emitting both the canonical record (Spec 015) and the legacy `Trace` (Spec 007 path) for one interaction (§8). |
| **Divergence detection** | Comparing the canonical record's legacy projection with the independently emitted legacy trace (§8). |
| **Completeness summary** | The assembler-level accounting of what was observed, dropped, and declared (§11). |
| **Capture profile** | The named, versioned bundle of collection settings recorded on the trace (`captureProfile`, Spec 013 §9). |
| **Declared content** | Content admitted only under an owning `redacted`/`truncated` declaration (Spec 015 `metadata-safe`). |
| **Retained excerpt** | The bounded representation of content the collection process retains: normalized text, an owning `truncated`/`redacted` status, and the owning declarations (§7). |

---

## 1. Two lifecycles: client passthrough and evidence observation

**Decision 1 — the client passthrough lifecycle and the evidence-observation
lifecycle are distinct. An observer/parser/decoder failure must not destroy
the upstream request, stop reading bytes the client needs, inject a frame, or
truncate an otherwise forwardable response.**

### 1.1 Why two lifecycles

The draft previously treated parse/observe failures as terminalization
inputs while also promising they never affect client traffic — a
contradiction. The resolution is structural: the ingress runs **two
independent lifecycles over the same byte stream**:

1. **Transport/passthrough lifecycle** — owns the client socket and the
   upstream connection. Its only job is to move response-body bytes from the
   upstream to the client with content and order preserved, under
   backpressure. **Nothing in the observation layer can end it.**
2. **Evidence-observation lifecycle** — the assembler state machine (§9).
   Its only job is to turn observed bytes into canonical evidence. Its
   failures affect the evidence, never the transport.

The observation layer is a **tee** on the transport byte stream: it consumes
a copy and feeds nothing back into the forwarded stream.

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

### 1.3 Observation lifecycle

The observation lifecycle is the assembler's state machine (§9). Its
terminal states are: `completed`, `upstream-failed`, `client-cancelled`,
`ingress-cancelled`, `malformed-stream`, `request-failed`, and
`observation-detached`. The observation terminal state and the transport end
are **independent**: either may occur first, and persistence waits for the
transport end (§16).

### 1.4 Malformed provider protocol vs. internal observer failure

Two failure classes are distinguished with different trace statuses, actors,
roles, and completeness:

| Class | Examples | Trace status | Terminal event | Actor / role | Completeness |
|---|---|---|---|---|---|
| **Malformed provider protocol** | `data` value is not valid JSON; invalid UTF-8 in a data value; non-integer/negative choice index; EOF or partial frame without `[DONE]` | `failed` | `error` (terminal) | `model` / `provider_reported` (the provider's stream was observed to violate the protocol) | Declares the malformed frame and the unobserved remainder |
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
4. The completeness summary and boundary statement declare the observation
   boundary: the frame at which extraction stopped and that the remainder is
   unknown.
5. Persistence occurs only after the client response path has actually
   finished (§2.2, §16) — including after observation degradation.

---

## 2. Assembly and persistence boundary

**Decision 2 — one canonical record, one save, after the client response
path finishes; no checkpointing or revisions; the crash limitation is
declared honestly.**

### 2.1 Single canonical save

- Each observed streaming interaction produces **exactly one**
  `EvidenceRecord` (§14 data flow), assembled in memory across the whole
  stream.
- The record is handed to persistence **exactly once**, after the transport
  lifecycle has ended (§2.2), through the only permitted persistence path:
  `EvidenceStorage.saveEvidenceRecord(record)` (Spec 015).
- There is **no checkpointing**: no partial records, no in-progress writes,
  no revisions, no upserts, no periodic snapshots. The append-only contract
  of Spec 015 is unchanged; the assembler adds no second write path.
- An interaction that reaches a terminal observation state always produces a
  record — including failures, cancellations, and detached observations
  (status `unknown`). The `status` vocabulary
  (`completed` / `failed` / `cancelled` / `unknown`) is never invented; it is
  derived per §9.

### 2.2 Persistence timing: after the response path finishes

- **Observation terminal state and response-path completion are separate.**
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

### 2.3 Honest crash limitation

- If the process crashes, is killed, or loses power **before** the save,
  the interaction has **no persisted record**. This is a declared loss, not
  a defect to be papered over:
  - the loss is stated in `docs/ingress.md` and `docs/roadmap.md` (§17);
  - the spec does **not** fabricate a record, a "recovered" identity, a
    completion, or a placeholder document for an unpersisted stream;
  - crash-recovery journaling for interrupted streams is explicitly deferred
    (roadmap #40, "Reliability, recovery, and incomplete-trace handling").
- If the process crashes **after** the save returned `stored`, the record is
  durable per Spec 015 (WAL, transactional save).

### 2.4 No conditional persistence based on outcome

- The assembler does not skip the save because the terminal state is a
  failure, cancellation, or detached observation; failed, cancelled,
  malformed, and detached interactions are persisted like completed ones
  (subject to the storage-safety gate and persistence policy, which may
  refuse a specific record — §16).

---

## 3. Identity and deterministic ordering

**Decision 3 — sequence numbers and opaque identities are the only ordering
and identity keys; timestamps and content hashes never order or identify.**

### 3.1 Identity

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

### 3.2 Choice identity vs. chunk ordinal (multi-choice)

- **`choiceIndex` (additive, §12) is the normalized choice identity**: which
  choice a chunk belongs to. It is derived from the provider's
  `choices[i].index` when present and valid, else the array position, else
  `0` for a single choice (§5.3). It is **never** a chunk counter.
- **`chunkIndex` is the per-choice content-chunk ordinal**: a 0-based
  counter of content-bearing chunks *within one choice*, maintained by the
  assembler per `choiceIndex`. For a single-choice stream this is identical
  to the existing fixture semantics (0, 1, 2, …), so the existing
  `trace-3` fixture and the projection-matrix claim E2L-073 remain valid.
- The two are **never interchangeable**: `choiceIndex` answers "which
  choice", `chunkIndex` answers "which chunk of that choice".

### 3.3 Sequence ordering

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

## 4. Streaming transparency

**Decision 4 — the ingress forwards the upstream response-body bytes with
content and order preserved, under backpressure, with zero frame mutation.
Transparency applies to the response body bytes; response headers are
ingress-constructed via a validated bounded allowlist. Encoded streams are
forwarded as-is and observed through a bounded decoder tee.**

### 4.1 The transparency boundary: response body bytes, not headers

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
    parameters are dropped and declared lost; see §12.4);
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

### 4.2 The four observation layers

The ingress reads the upstream response as **raw `Buffer` chunks** (the
streaming slice must not use `res.setEncoding('utf8')`, which pre-decodes
and hides wire bytes). Each chunk passes through four strictly separated
layers:

```text
L1  transport bytes     raw Buffer chunks as read from the socket (wire bytes; never mutated)
L2  SSE frames          the parser's incremental framing of the byte stream (fields, [DONE])
L3  parsed stream events  the decoder's provider-neutral normalized events (§5.2, §11)
L4  canonical events    EventRecords assembled by the assembler (Spec 013 shapes)
```

- L1 is the only layer with byte access; L2–L4 operate on copies/derived
  values and can never mutate the forwarded bytes.
- A provider's decoded JSON content lives only in L3/L4. **Raw provider
  JSON is retained only under the `providerNative` contract with explicit
  fidelity and status (§6.2, §11.1)**; otherwise it is a declared loss
  (`provider-native-not-retained`).

### 4.3 Backpressure

- The upstream read is paused when the client cannot consume (backpressure):
  the passthrough never buffers unboundedly, and a slow client pauses the
  upstream read (`readable.pause()` / stream flow control).
- Idle-timeout semantics (30 s default): the client response is closed after
  an idle period with no forward progress. This is a transport decision (an
  ingress limit), so it ends the transport lifecycle via
  `ingress-shutdown`-class cancellation (§1.2); the observation lifecycle
  records `ingress-cancelled` (§9) when it is still active.
- There is **no total-response timeout** that kills long-lived streams; the
  existing 30 s `forwardToUpstream` timeout covers the upstream request
  establishment, not the response stream.

### 4.4 Zero frame mutation

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

### 4.5 Encoded streams

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
  (§4.1).
- **An encoded `text/event-stream` is an SSE response**, not a
  "non-SSE response": it takes the SSE observation path (over the decoded
  copy) and its outcomes are the SSE outcomes (§5.5). `non-sse-response`
  refers to a 2xx response whose `content-type` is not `text/event-stream`
  at all (§5.5).
- The decoder tee is bounded (same 16 MiB frame cap); a decode failure is an
  internal observer failure (`observation-decode-failure`), never a provider
  protocol verdict.

### 4.6 Byte-boundary verification

- The implementation must prove byte transparency by test (§19 T47–T51):
  for every encoded/plain scenario, the bytes written to the client are
  exactly the bytes read from the upstream (header construction excepted).

---

## 5. SSE parsing, multi-choice normalization, and terminalization

**Decision 5 — the parser and decoder produce ordered, provider-neutral,
frame-level results; one frame expands to zero or more canonical events in
deterministic order; choice identity and chunk ordinal are distinct; the
terminalization matrix is closed.**

### 5.1 The parser (L2)

`createSseParser()` (proposed in `@signalglass/streaming`, §10) implements a
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

### 5.2 The decoder (L3) — frame-level normalized result

The decoder (`decodeSseFrame(frame)` in `@signalglass/providers`, §10)
returns a **frame-level result**, replacing the previous
`decodeSseFrame(frame): StreamEvent | null` shape:

```ts
type FrameDecodeResult =
  | { kind: 'events'; events: readonly StreamDecodedEvent[] }   // ordered, zero-or-more (§11)
  | { kind: 'done' }                                            // [DONE] frame
  | { kind: 'malformed'; code: MalformedStreamCode }            // §11
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

### 5.3 Multi-choice normalization (L3 → L4)

For a chunk frame with provider `choices` array:

| Situation | Decision |
|---|---|
| Expansion order | **Array order**: `choices[0]`, `choices[1]`, … Each choice's chunk yields one `chunk` event in that order. |
| `choice.index` present and a non-negative integer | Canonical `choiceIndex` = that value |
| `choice.index` absent | Canonical `choiceIndex` = array position |
| Single choice, no index | Canonical `choiceIndex` = `0` |
| `choice.index` negative or non-integer | `sse-invalid-choice-index` → malformed provider protocol (terminal) |
| Duplicate `choice.index` across choices | **Preserved as observed** (evidence is never renumbered); the choices remain distinguishable by `seq` order and by their per-choice chunk ordinals |
| Out-of-order `choice.index` values | Preserved (identity, not order); `seq` = observation order |
| Repeated index across frames | Normal: the same choice streams multiple chunks; per-choice ordinal increments |
| `chunkIndex` | Per-choice content-chunk ordinal (0-based), maintained **per `choiceIndex`** (§3.2) |
| Frame with several choices AND usage | Choice `chunk` events (array order), then the frame-level `usage` event last |
| Frame with several choices AND per-choice finish reasons | Each choice's chunk carries its own `finishReason` |
| Frame-level usage + per-choice usage both present | Frame-level usage is canonical (OpenAI usage is top-level); the per-choice occurrence is a declared loss `unrecognized-provider-field` |

- A chunk event's delta is the provider-neutral normalized text of the
  choice's content delta (a string; `null` when the chunk carries no content,
  e.g. only a finish reason or only usage). **Raw provider JSON is never
  emitted by the decoder** into the canonical model except under the
  `providerNative` retention contract (§6.2, §11.1).
- Retention (excerpting/masking) is applied by the assembler's collection
  layer at L4 per the capture profile (§7.2), not by the decoder.

### 5.4 Usage and finish-reason placement matrix

| Frame content | Canonical handling |
|---|---|
| Usage before any finish | `model_usage` event at its observation position; subsequent chunks allowed |
| Usage after finish | `model_usage` event at its observation position; the record remains `completed` if `[DONE]` follows |
| Usage-only terminal chunk | One `model_usage` event; no content event; completes only via a following `[DONE]` |
| No usage anywhere | Declared absence: no usage event; `declaredLosses` includes `provider-usage-absent`; **never** a fabricated zero-usage record |
| Finish reason on a chunk | Recorded on that chunk's envelope (`finishReason`), at its observation position |
| No finish reason before `[DONE]` | Declared absence (`finish-reason-absent`); `completed` still requires the observed `[DONE]` |
| Provider-reported finish reasons | Bounded label, ≤128 code points, validated per Spec 014 label rules; unknown reasons are preserved as observed (not classified as errors) |

### 5.5 Terminalization matrix

| Terminal | Trigger (observed) | Trace status | Canonical terminal event |
|---|---|---|---|
| `completed` | `[DONE]` frame observed (first observed terminal wins) | `completed` | `interaction_end`; model span `completed` |
| `upstream-failed` | Upstream HTTP error; connection error/timeout/TLS loss; non-SSE 2xx; provider error frame | `failed` | `error` (terminal) then `interaction_end`; model span `unknown` |
| `client-cancelled` | Client disconnect mid-stream | `cancelled` | `cancelled` (requestedBy `client`) then `interaction_end`; model span `unknown` |
| `ingress-cancelled` | Ingress shutdown/limit cancellation (idle timeout included) | `cancelled` | `cancelled` (requestedBy `ingress`) then `interaction_end`; model span `unknown` |
| `malformed-stream` | `sse-invalid-data-json`, `sse-invalid-utf8`, `sse-invalid-choice-index`, `sse-partial-frame-at-eof`, `sse-eof-without-done` | `failed` | `error` (actor `model`, role `provider_reported`) then `interaction_end`; model span `unknown` |
| `request-failed` | Request rejected before dispatch (invalid/incomplete/over-limit/unroutable) | `failed` | `error` (actor per §9.4) then `interaction_end`; no model span |
| `observation-detached` | Internal observer failure (no terminal event was observable) | `unknown` | Informational `error` (actor `capture`, target `none`, effect `none`); `interaction_end`; model span `unknown` |

Terminal rules (Spec 014 §4.7):

- **The first observed terminal wins.** Once a terminal marker or terminal
  condition is observed, later observations (e.g. a `[DONE]` after a cancel)
  do not change the terminal.
- The terminal event is the **final applicable `seq`**: nothing is appended
  after the terminal `error`/`cancelled` event except the `interaction_end`.
  There is **no `interaction_end` after a terminal `error`/`cancelled`
  double-emission** and no later event of any kind after `interaction_end`.
- On trace-level failure or cancellation the model span ends `unknown` —
  never `completed` by inference. No wall-clock "completion" is synthesized.
- **No terminalization by wall clock.** The assembler never finalizes
  "completed" because time passed; an undecidable stream ends as one of the
  other terminals or via ingress cancellation at a limit.

---

## 6. Evidence status vocabulary and loss mapping

**Decision 6 — every assembled payload carries a closed-set evidence status
and an explicit declared-loss mapping; absence is declared, zeros are never
fabricated, and statuses never collapse to `null`.**

### 6.1 Evidence statuses (Spec 013 §4 / Spec 014 §5)

`EvidenceStatus = 'captured' | 'redacted' | 'truncated' | 'missing' | 'unavailable'`
(closed, from `@signalglass/evidence`). Assembly rules:

- **Control events** (`interaction_start`, `interaction_end`, `span_start`,
  `span_end`): status `captured` (metadata only; never content-bearing).
- **Request messages**: default profile retains bounded excerpts → owning
  status `truncated` (length boundary only) or `redacted` (a sensitive span
  was masked); never `captured` for full content by default (§7).
- **Chunk deltas**: retained excerpt → `truncated` or `redacted` (same
  rule); the retained representation is the excerpt, with the owning
  declaration (§7).
- **Usage**: provider-reported values → `captured`; captured zero is a real
  observation (`inputTokens: 0`), distinct from absence (no usage event, no
  values).
- **Provider error frame / transport errors**: status `captured` (structural
  text only, §7.4).
- **Absent usage / absent finish reason / unretained content**: declared via
  `MissingDeclaration` / `TruncationDeclaration` / `RedactionDeclaration`
  on the raw observation payload and via the completeness summary; never
  encoded as `null` statuses and never as fabricated zeros.
- Statuses are always present on evidence records (never omitted, never
  `null`).

### 6.2 Fidelity and the `providerNative` retention contract

- Default fidelity: `structurally_faithful` (Spec 014). The retained
  representation is a bounded, structurally faithful excerpt of the
  normalized content — never raw bytes.
- Raw provider JSON is retained **only** when the capture profile requests
  it under the `providerNative` contract with explicit `providerNativeFidelity`
  and an owning status (`truncated`/`redacted` — it is declared content, so
  `metadata-safe` admits it as such). Otherwise it is a declared loss
  `provider-native-not-retained`. The default profile does not request it.

### 6.3 Declared-loss codes

`declaredLosses` is a `readonly DeclaredLossCode[]` — a **closed code list**
(§11.2), never free-form strings. Fixed display sentences are derived from
the codes for the boundary statement. Codes:

| Code | Meaning (derived display sentence) |
|---|---|
| `request-body-not-retained` | The full request body was not retained. |
| `message-content-not-retained` | Request message content beyond the retained excerpt was not retained. |
| `delta-content-not-retained` | Chunk delta content beyond the retained excerpt was not retained. |
| `provider-native-not-retained` | The provider-native payload was not retained. |
| `provider-error-body-not-retained` | The provider error frame's raw body was not retained. |
| `provider-usage-absent` | The provider reported no usage. |
| `finish-reason-absent` | The stream ended without a finish reason. |
| `unrecognized-provider-field` | Provider JSON fields not mapped to the canonical model were not retained. |
| `unrecognized-extension-frame` | A frame that decoded to no recognized shape was not retained. |
| `frame-after-observation-detach` | Frames observed after observation detached were not retained. |
| `remainder-after-client-cancellation` | The stream remainder after client cancellation was not retained. |
| `remainder-after-ingress-cancellation` | The stream remainder after ingress cancellation was not retained. |
| `response-header-values-not-retained` | Upstream response header values outside the allowlist were not retained. |
| `content-type-parameters-not-retained` | Media-type parameters were dropped from the retained `content-type`. |
| `wire-bytes-not-retained` | Transport bytes were not retained (only excerpts and metadata). |
| `encoded-content-not-observed` | The encoded stream could not be decoded for observation. |
| `original-content-masked` | Content matching the sensitive detector was masked at collection. |
| `crash-no-record` | No record exists because the process terminated before persistence (declared at the system level, §17). |

The completeness summary and boundary statement are derived from the
observed facts + these codes; the boundary statement never invents content,
statuses, or reasons.
---

## 7. Collection vs. persistence policy boundaries

**Decision 7 — collection, persistence, and export are independent policies
(Spec 007 §3; `docs/capture-profiles.md`). The default collection process
runs a collection-time privacy pipeline (structural exclusion + versioned
sensitive detector + masking/excerpting, with owning statuses and declared
losses) before evidence is formed; the Spec 015 storage-safety gate and the
persistence policy still run, non-bypassably, on every save. The default
claim is "expected admissible, rejection still possible", never
"rejection impossible".**

### 7.1 Default capture profile

- Default capture profile: `signalglass.collection.ingress-metadata-safe`,
  version `1.0.0`, recorded on the trace (`captureProfile`, Spec 013 §9).
  Collection policy (what is captured), persistence policy (what is stored —
  `metadata-safe` from Spec 015), and export policy (out of scope here) are
  three independent policies.
- Default retained values per interaction:
  - structural metadata (routing, model, timing, ids, statuses, seq);
  - request messages and chunk deltas as **bounded retained excerpts**
    (default max length 240 characters; §7.3);
  - provider-reported usage values, verbatim (numbers only);
  - normalized finish reasons;
  - structural error text (§7.4);
  - response metadata: `statusCode` + normalized `content-type`
    (+ `content-encoding` when present) via the additive `responseMeta`
    (§12.3);
  - the completeness summary and declared-loss codes.
- **Not retained by default**: raw request bodies, raw provider payloads
  (`provider-native-not-retained`), raw wire bytes, and any header values
  outside the allowlist (§4.1).

### 7.2 The collection-time privacy process

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

### 7.3 Excerpt bounds (decided, not tuning-only)

- Default excerpt max length: **240 characters** (matches the Spec 015
  `metadata-safe` expectation of bounded declared content).
- Valid configured range: **64–4096 characters**.
- Changing the default excerpt length requires a **capture-profile version
  bump** (the profile is versioned and recorded per record, §13). The range
  and the version-bump rule are normative, so this is no longer an open
  question.

### 7.4 Structural error text

- Error payloads contain fixed, bounded, **structural** text: a closed error
  code (Spec 006 style), a bounded description (≤200 chars) built from
  structural facts, and no headers, no secrets, no raw provider error bodies.
  The provider's raw error body is declared lost
  (`provider-error-body-not-retained`).
- The description never embeds: request URLs with query strings, API keys,
  authorization values, cookies, or raw payload excerpts.

### 7.5 The honest admission claim

- **Construction invariant (tested)**: default-profile records are expected
  to be policy-admissible under `metadata-safe` — the collection pipeline is
  designed and tested so that no default record carries an S1/S2/S3/S5/S6
  witness (sentinel tests §19 P62–P66: a credential beginning before the
  excerpt boundary, crossing it, or beginning after it is masked/omitted in
  full).
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

## 8. Legacy coexistence

**Decision 8 — the canonical record is authoritative; the legacy `Trace`
becomes a compatibility projection. Dual emission is allowed from the same
observed stream; divergence is surfaced, never silently reconciled;
persistence failures never affect client traffic.**

### 8.1 Canonical-authoritative

- For streaming interactions, the canonical `EvidenceRecord` (Spec 013/015)
  is the **source of truth**. The legacy `Trace` (Spec 007 path) is a
  **compatibility projection** for existing consumers (report generation,
  UI), not a second authority.
- Projection is `evidenceToLegacyTrace` (`@signalglass/core`,
  `evidenceProjections`), which already maps canonical events to legacy
  `Trace`/`TraceEvent` shapes with declared loss (projection matrix,
  E2L-* rows including E2L-073 for `chunkIndex`; new rows for the additive
  fields §12.6).

### 8.2 Dual emission

- The ingress MAY emit both the canonical record (Spec 015) and a legacy
  trace for the same observed stream — **dual emission**, from the same
  observation, never from two separate observations of the same interaction.
- In dual-emission mode the canonical record is authoritative; the legacy
  trace is derived.
- If a store cannot persist the canonical record (older storage, unsupported
  version), the ingress MAY persist only the legacy trace as a degraded
  compatibility path — declared, never silently preferred over the
  canonical path.

### 8.3 Divergence detection

- **Divergence detection** compares the canonical record's legacy projection
  (`evidenceToLegacyTrace`) with the independently emitted legacy trace.
- Divergences (status, event count, identity) are **surfaced** (logs,
  counters, diagnostics) and **never silently reconciled** — the canonical
  record is not rewritten to match the legacy trace, and the legacy trace is
  not rewritten to match the projection.
- A parity test keeps `evidenceToLegacyTrace(canonical) == legacy` for
  shared semantics (see §19 T71).

### 8.4 Client traffic isolation

- No persistence outcome — stored, rejected, conflicted, failed, or
  crash-before-save — ever delays, mutates, retries, or reorders client
  traffic. The client response is finalized independently of the save
  (§2.2, §16).

---

## 9. Terminal state machine

**Decision 9 — a single, closed, deterministic state machine governs the
observation lifecycle. Its seven terminal states are the only states from
which a record finalizes. `finalized` is an operation, not a state;
persistence outcomes are observations, never states, and never rewrite the
terminal.**

### 9.1 State diagram (observation lifecycle)

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
        │ invalid body/ │ valid body     │ unroutable/missing key
        │ over-limit    ▼                │
        │ (pre-dispatch)        ┌────────▼────────┐
        ▼                       │   dispatched    │
   ┌────────────┐               └───┬─────────┬───┘
   │ request-   │            HTTP err│         │ 2xx, content-type
   │ failed     │            /non-SSE│         │ text/event-stream
   └─────┬──────┘             connect/│         ▼
        │                    timeout/ │   ┌──────────────┐
        │                     TLS     │   │  streaming   │
        │                             │   └──┬───────┬───┘
        │                             │      │       │
   ┌────▼─────┐                ┌──────▼──┐   │       │
   │ upstream-│◄───────────────┤ (failed)│   │       │
   │  failed  │                └─────────┘   │       │
   └──────────┘                             … │       │
                                             │       │
        terminals:  completed · upstream-failed · client-cancelled
                    ingress-cancelled · malformed-stream · request-failed
                    observation-detached
        (no transitions out of a terminal; finalized is the operation
         that produces the outcome; persistence observations are separate)
```

### 9.2 Transition table

| From | Event | To | Notes |
|---|---|---|---|
| `initialized` | Request observed (headers) | `request-observed` | identity assigned |
| `initialized` | Assembler destroyed without observation | `aborted` | outcome `{ outcome: 'aborted', reason }`; no record |
| `request-observed` | Body parsed, valid; dispatch begun | `dispatched` | `model_request` + `span_start` |
| `request-observed` | Body invalid / incomplete / over-limit / unroutable / key unavailable | `request-failed` | no dispatch; closed codes §11.2 |
| `dispatched` | Upstream HTTP error / non-SSE 2xx / connect / timeout / TLS / connection lost | `upstream-failed` | §5.5 |
| `dispatched` | 2xx, `content-type: text/event-stream` | `streaming` | headers observed |
| `streaming` | `[DONE]` observed | `completed` | first observed terminal wins |
| `streaming` | Malformed protocol (invalid JSON/UTF-8/choice index; partial frame or EOF without `[DONE]`) | `malformed-stream` | |
| `streaming` | Client disconnect | `client-cancelled` | |
| `streaming` | Ingress shutdown/limit (idle timeout included) | `ingress-cancelled` | |
| `streaming` | Provider error frame / mid-stream connection loss | `upstream-failed` | |
| `streaming` | Observer failure (parser/decoder/assembler exception, frame overflow, unsupported encoding, decode failure) | `observation-detached` | transport continues |
| any terminal | `finalize()` operation | — | produces `AssemblerOutcome`; persistence runs after transport end (§2.2) |

Illegal transitions are rejected (the assembler is a closed machine): e.g.
`completed → client-cancelled`, `streaming → streaming`, any transition out
of a terminal, any event after `interaction_end`. **No wall-clock
transition**: no path from any state to `completed` except the observed
`[DONE]`.

### 9.3 States, outcomes, and statuses — one vocabulary

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
  request-failed | observation-detached`. The previous draft's five-reason
  list omitted `request-failed` and `observation-detached` while the diagram
  referenced `failed(agent/capture)` — reconciled here: the diagram, the
  transition table, `AssemblerState`, `AssemblerOutcome`, `TerminalReason`,
  the event mapping, trace status, acceptance criteria, and test mapping all
  use exactly this vocabulary.
- `CompletenessSummary.terminalReason: TerminalReason` — never
  `AssemblerOutcome['terminal']` (that self-reference was wrong); the
  outcome's `terminal` and the summary's `terminalReason` are the same
  closed value when `outcome: 'recorded'`.
- `aborted` is a **sibling outcome** with its own closed `AbortReason`, not
  a terminal state and not a terminal reason; there is no
  `reason: string` for aborts (§11.2).

### 9.4 Terminal → trace status → actor/role mapping (agreed everywhere)

| Terminal | Trace status | Canonical terminal event | Actor | Role | Target | Effect |
|---|---|---|---|---|---|---|
| `completed` | `completed` | `interaction_end` | `model` | `provider_reported` | `trace` | `complete` |
| `upstream-failed` (HTTP/provider error frame) | `failed` | `error` | `model` | `provider_reported` | `trace` | `fail` |
| `upstream-failed` (connect/timeout/TLS/lost/non-SSE) | `failed` | `error` | `model` | `unobservable` | `trace` | `fail` |
| `upstream-failed` (key unavailable) | `failed` | `error` | `capture` | `unobservable` | `trace` | `fail` |
| `client-cancelled` | `cancelled` | `cancelled` | `agent` | `client_sent` | `trace` | `cancel` |
| `ingress-cancelled` | `cancelled` | `cancelled` | `capture` | `unobservable` | `trace` | `cancel` |
| `malformed-stream` | `failed` | `error` | `model` | `provider_reported` | `trace` | `fail` |
| `request-failed` | `failed` | `error` | `agent` (invalid/incomplete/over-limit/unroutable) or `capture` (key unavailable) | `client_sent` / `unobservable` | `trace` | `fail` |
| `observation-detached` | `unknown` | informational `error` (target `none`, effect `none`) | `capture` | `unobservable` | `none` | `none` |

Trace-level failure/cancellation leaves the model span `unknown` (§5.5);
`unknown` is reserved for observations whose termination could not be
observed (never for "probably failed").

### 9.5 Persistence observations are not states

After `finalize()`, the save outcome is an observation: `PersistenceObservation`
(closed, §11.2) mirrors the Spec 015 `SaveOutcome` statuses
(`stored | already-present | conflict | invalid | unsupported-version |
safety-rejected | policy-rejected | policy-failed | clock-failed |
contention`). It is recorded/reported and **never rewrites** the terminal
state, the trace status, or the assembled record.

---

## 10. Package boundaries

**Decision 10 — a new network-free `@signalglass/streaming` package hosts
the parser, assembler, and stream contracts; the provider decoder lives in
`@signalglass/providers`; wiring lives in `apps/ingress`; persistence stays
in `@signalglass/storage`; projections stay in `@signalglass/core`. The
packages are named here but not created by this PR.**

### 10.1 Module map (proposed; not created)

| Package | Module | Contents | Depends on |
|---|---|---|---|
| `@signalglass/streaming` (new) | `sse.ts` | `createSseParser()`, `SseFrame`, parser-level malformed/overflow signals (§5.1) | `@signalglass/evidence` only (parser math, no provider knowledge) |
| `@signalglass/streaming` (new) | `assembler.ts` | `createStreamAssembler()`, state machine (§9), sequencing (§3), collection layer (§7.2), completeness summary, `assembleEvidenceRecord()` | `@signalglass/evidence` only |
| `@signalglass/streaming` (new) | `types.ts` | `SseFrame`, `FrameDecodeResult`, `StreamDecodedEvent`, `AssemblerInput`, `AssemblerState`, `AssemblerOutcome`, `CompletenessSummary`, `TerminalReason`, `AbortReason`, `DeclaredLossCode`, `ObservationFailureCode`, `PersistenceObservation`, `CancellationSource` (§11) | nothing (types) |
| `@signalglass/providers` | `openaiAdapter.ts` (+ `sse.ts` decoder) | `decodeSseFrame(frame: SseFrame): FrameDecodeResult` — OpenAI-compatible decode to provider-neutral events; provider-native retention under `providerNative` (§6.2) | `@signalglass/streaming` (types), `@signalglass/evidence` |
| `apps/ingress` | `streamHandler.ts` | HTTP wiring: raw-Buffer read, passthrough, backpressure, header allowlist, decoder tee, error envelopes, response completion, delayed save (§2.2) | `@signalglass/streaming`, `@signalglass/providers`, `@signalglass/storage` |
| `@signalglass/storage` | `evidenceStorage.ts` (unchanged API) | `saveEvidenceRecord` — the only persistence path | unchanged |
| `@signalglass/core` | `evidenceProjections/` (unchanged) | `evidenceToLegacyTrace` — legacy projection + divergence detection (§8) | unchanged |

### 10.2 Boundary rules

- `@signalglass/streaming` is **network-free**: no sockets, no HTTP, no
  buffering of unbounded streams, and **zero provider knowledge** — it never
  parses provider JSON. Provider decoding is `@signalglass/providers`'s
  job; the assembler consumes only `StreamDecodedEvent`s.
- Provider-native JSON stays in `@signalglass/providers` unless retained
  under the canonical `providerNative` contract (§6.2) — and that contract's
  value is a canonical envelope field, not an import of provider shapes into
  `@signalglass/streaming`.
- `apps/ingress` is the only place that touches sockets; persistence calls
  go through `@signalglass/storage`; projections through `@signalglass/core`.
- No runtime code changes in `@signalglass/core` or `@signalglass/storage`
  are required for the streaming observation itself; only additive schema
  support (§12) and projection rows touch those packages in later slices.
---

## 11. Public contracts: provider-boundary types and closed vocabularies

**Decision 11 — every public vocabulary is a closed discriminated union; no
`reason: string` for aborts; `declaredLosses` is a closed code list; the
completeness summary has no fabricated gaps; internal helpers stay
internal.**

### 11.1 Provider-boundary output (L3, provider-neutral)

```ts
/** Normalized, provider-neutral output of the decoder. */
type StreamDecodedEvent =
  | {
      kind: 'chunk';
      choiceIndex: number;          // normalized choice identity (§5.3)
      delta: string | null;         // normalized content delta text; null when the chunk carries no content
      finishReason?: string;        // bounded label (≤128 cp), when the choice reported one
      usage?: NormalizedUsage;      // per-choice usage, only when the provider nested it (§5.3)
    }
  | { kind: 'usage'; usage: NormalizedUsage }
  | { kind: 'provider-error'; code: ProviderErrorFrameCode; type?: string };
```

- `ProviderErrorFrameCode = 'provider-error-frame'` (closed, single member):
  a structural code, never the provider's own error type as an open string —
  the provider error `type` (when reported) is a bounded label (≤128 cp);
  the provider's raw error body is a declared loss
  (`provider-error-body-not-retained`).
- `NormalizedUsage` uses the existing `UsageRecord`/`UsageValue` semantics
  (`@signalglass/evidence`): `{ evidenceStatus: 'captured'; inputTokens?;
  outputTokens?; totalTokens? }` with non-negative finite numbers; captured
  `0` is distinct from absent; `usage: undefined` means absent — the
  assembler declares `provider-usage-absent`, never a zero record.
- **The decoder never emits raw provider JSON.** Provider-native content is
  retained only via the `providerNative` envelope contract (§6.2) in
  `@signalglass/providers` itself.

### 11.2 Closed vocabularies

```ts
type MalformedStreamCode =
  | 'sse-invalid-data-json'      // data value not valid JSON
  | 'sse-invalid-utf8'           // invalid UTF-8 in a frame
  | 'sse-invalid-choice-index'   // non-integer or negative choice index
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
  | 'non-sse-response'           // 2xx whose content-type is not text/event-stream
  | 'upstream-key-unavailable';  // actor capture (§9.4)

type ClientRequestFailureCode =
  | 'client-request-invalid'     // malformed JSON / schema
  | 'client-request-incomplete'  // connection lost mid-body
  | 'client-request-over-limit'  // body over the 10 MB readJsonBody cap
  | 'client-request-unroutable'; // model unknown / provider not configured

type CancellationSource = 'client' | 'ingress';

type TerminalReason =
  | 'completed'
  | 'upstream-failed'
  | 'client-cancelled'
  | 'ingress-cancelled'
  | 'malformed-stream'
  | 'request-failed'
  | 'observation-detached';

type AbortReason = 'no-request-observed' | 'assembler-misuse';  // no string

type DeclaredLossCode = /* closed list, §6.3 */;

type PersistenceObservation =   // mirrors Spec 015 SaveOutcome statuses; storage-free
  | 'stored' | 'already-present' | 'conflict' | 'invalid'
  | 'unsupported-version' | 'safety-rejected' | 'policy-rejected'
  | 'policy-failed' | 'clock-failed' | 'contention';
```

Rules:

- **No `reason: string`** on aborted outcomes, errors, or terminal events —
  every reason/code is a closed union member. Display text is derived.
- **`declaredLosses: readonly DeclaredLossCode[]`** — closed codes, not free
  strings; the boundary statement is the derived, fixed display text.
- **`seqGaps` is removed from `CompletenessSummary`** — it was always empty
  by the assembly contract (dropped frames leave no canonical gap, §3.3);
  canonical completeness owns gap semantics. Unparseable or unobserved
  frames are disclosed via statuses, loss codes, and the summary's
  `unobservedFramesAfterDetach` counter, never via a gap array.
- The old `terminalReason: AssemblerOutcome['terminal']` self-reference is
  gone; `CompletenessSummary.terminalReason: TerminalReason` is the closed
  type (§9.3).
- `StreamDecodeErrorCode`, `ObservationFailureCode`, `UpstreamFailureCode`,
  and `ClientRequestFailureCode` each close a distinct failure surface
  (decoder internals, observer machinery, upstream transport, client
  request); the actor/role mapping (§9.4) consumes them to place the
  failure honestly.

### 11.3 Completeness summary

```ts
type CompletenessSummary = {
  terminalReason: TerminalReason;
  observedFrames: number;                    // frames the parser delivered
  retainedEvents: number;                    // canonical events retained
  unobservedFramesAfterDetach: number;       // frames seen after detach (0 when not detached)
  eventsByStatus: Readonly<Record<EvidenceStatus, number>>;
  declaredLosses: readonly DeclaredLossCode[];
  boundaryStatement: string;                 // derived fixed display sentences (§6.3); never invented content
};
```

### 11.4 Assembler entry points

```ts
createSseParser(): SseParser;                  // @signalglass/streaming (L2)
createStreamAssembler(opts): StreamAssembler;  // @signalglass/streaming (L4, state machine)
```

- `AssemblerInput` (closed): `{ kind: 'request-observed'; ... } |
  { kind: 'response-headers'; ... } | { kind: 'frame'; frame: SseFrame } |
  { kind: 'done'; ... } | { kind: 'client-cancelled' } |
  { kind: 'ingress-cancelled' } | { kind: 'observer-failure';
  code: ObservationFailureCode } | { kind: 'transport-failure';
  code: UpstreamFailureCode } | { kind: 'finalize' }`.
- Internal helpers (frame splitting internals, status derivation, excerpt
  application) are **not exported**; only the public contracts in this
  section are public.

---

## 12. Canonical schema extension (additive 1.1.0)

**Decision 12 — the canonical schema advances additively:
`evidenceSchemaVersion` 1.1.0. Four additive optional fields enter the
canonical types — `responseMeta`, `choiceIndex`, `error.payload.upstreamStatus`,
and `trace.assembly` — with exact shapes, validation, policy-classification,
projection-loss, and fixture consequences. MAJOR-1 compatibility is
preserved: 1.0.0 validators already accept 1.1.0 records.**

### 12.1 Version mechanics

- `SUPPORTED_EVIDENCE_SCHEMA_VERSION` stays `1.0.0`; `isSupportedEvidenceSchemaVersion`
  and `checkEvidenceSchemaVersion` already accept any additive MAJOR-1
  version (additive-by-default evolution, `docs/model-versioning.md`).
- **`evidenceSchemaVersion` recorded on 1.1.0 records is `1.1.0`** — the
  explicit additive minor, not the supported constant. This makes the minor
  self-describing while preserving MAJOR-1 compatibility.
- 1.0.0 validators: unknown additive fields are preserved and round-trip
  (Spec 014 §5.3 `validate-fields.ts`) — a 1.0.0 validator accepts a 1.1.0
  record and preserves the new fields.
- 1.1.0 validators accept 1.0.0 records (all new fields optional).

### 12.2 The additive fields (owner/path/serialized names)

| Field | Owner | Path (serialized) | Type |
|---|---|---|---|
| `choiceIndex` | `ResponseEnvelope` (additive optional; present on every chunk assembled by this spec) | `payload.responseEnvelope.choiceIndex` | non-negative integer |
| `responseMeta` | `ResponseEnvelope` (additive optional; present on the first response-bearing event of a stream) | `payload.responseEnvelope.responseMeta` | `{ statusCode: number; contentType?: string; contentEncoding?: string }` |
| `upstreamStatus` | `ErrorPayload` (additive optional; present on pre-stream HTTP/non-SSE failures) | `payload.error.upstreamStatus` | integer 100–599 |
| `assembly` | `EvidenceTrace` (additive optional; present on every record assembled by this spec) | `trace.assembly` | `{ name: string; version: string; decoderContract?: { name: string; version: string } }` |

- The fields are on `ResponseEnvelope`/`ErrorPayload`/`EvidenceTrace` (the
  existing canonical owners), **not** on a new transport-observation
  structure — the response envelope already carries `chunkIndex`, fidelity,
  and usage, so transport metadata belongs on it; there is no new envelope
  type in 1.1.0.
- `chunkIndex` semantics are refined additively: **per-choice content-chunk
  ordinal** (§3.2), fixture-compatible with the existing single-choice
  fixtures.

### 12.3 `responseMeta` exact shape

```ts
responseMeta?: {
  statusCode: number;             // integer, 100–599 inclusive
  contentType?: string;           // RFC 6838 media type, lowercased type/subtype,
                                  // no parameters (params dropped + declared
                                  // content-type-parameters-not-retained), ≤128 cp
  contentEncoding?: string;       // lowercase token, ≤32 cp; ABSENT when identity/none
};
```

- **Absence rules**: `responseMeta` is absent when no response bearing event
  exists (request-failed before dispatch, client-cancelled before response);
  `contentType` absent when the upstream sent none; `contentEncoding` absent
  when identity/none — never an empty string or a fabricated value.
- **Raw vs normalized**: `statusCode` is the raw integer; `contentType` is
  the normalized media type (parameters stripped); `contentEncoding` is the
  normalized lowercase token. Unknown fields **inside** `responseMeta` fail
  closed (rejected), while unknown fields elsewhere round-trip per §12.1.
- **Validation** (in `@signalglass/evidence`, implementation slice): integer
  bounds for `statusCode` and `upstreamStatus`; grammar for `contentType`
  and `contentEncoding`; length bounds; `choiceIndex` non-negative integer;
  `assembly` name/version bounded labels (≤64 cp) with optional
  `decoderContract`.
- **Policy classification**: the Spec 015 `metadata-safe` matrix gains
  rows: `responseMeta.statusCode` and `choiceIndex` as meta (bounded
  integers), `responseMeta.contentType`/`contentEncoding` and
  `assembly.*` as bounded labels, `upstreamStatus` as meta — all
  admissible by the reference policy. Today these paths would be rejected as
  `unknown-additive-field`; the matrix rows are a required part of the
  implementation slice (see §18).
- **Serialization**: `@signalglass/evidence` serialize/parse round-trips the
  fields; 1.1.0 parse validates them; unknown fields within `responseMeta`
  are rejected (fail closed).

### 12.4 Response metadata retention

- `responseMeta` is recorded on the **first response-bearing event** of the
  stream (first `model_response_chunk`; or the error event for pre-stream
  failures). Subsequent frames do not repeat it.
- Values come from the **validated header allowlist** (§4.1): `content-type`
  (normalized media type) and `content-encoding` (single token) plus the
  numeric status — nothing else.

### 12.5 Projection and fixture consequences

- **Projection matrix**: new loss rows — `responseMeta`, `choiceIndex`
  (identity), `upstreamStatus`, and `assembly` are `unavailable` in the
  legacy projection (the legacy `Trace` has no homes for them); the existing
  E2L-073 (`chunkIndex` unavailable) is unchanged.
- **Fixtures** (updated additively, implementation slice): a new
  multi-choice streaming fixture carries `choiceIndex` per chunk and
  per-choice `chunkIndex`; a streaming fixture carries `responseMeta` on the
  first chunk and `assembly` on the trace; the existing `trace-3` fixture
  remains valid (additive fields are optional; its single-choice
  `chunkIndex` 0/1/2 semantics are unchanged). All 1.1.0 fixture records
  pass `parseEvidenceRecord` (1.1.0) and the `metadata-safe` policy.

### 12.6 Compatibility statement

- MAJOR-1 compat: 1.1.0 is a strict additive superset of 1.0.0.
- Existing 1.0.0 records, fixtures, validators, and stores are unaffected;
  existing tests remain green (contract changed only by addition).
- The 1.1.0 minor does not alter any existing field's meaning except the
  additive refinement of `chunkIndex`'s definition (per-choice ordinal,
  §3.2), which is consistent with every existing fixture.

---

## 13. Structured assembler version

**Decision 13 — the assembler identity and versions are recorded
structurally on the record, not only in free-form `boundaryStatement`
text.**

- `trace.assembly` (additive, §12.2): `{ name, version, decoderContract? }`.
  - `name`: `signalglass.streaming.assembler` (fixed).
  - `version`: `ASSEMBLER_ALGORITHM_VERSION` — a semver constant in
    `@signalglass/streaming` (initial `1.0.0`), incremented whenever the
    assembly algorithm's observable output changes.
  - `decoderContract`: present when a decoder is involved:
    `{ name: 'signalglass.providers.openai-sse', version: <decoder version> }`.
- The capture profile is already structured: `trace.captureProfile`
  (`signalglass.collection.ingress-metadata-safe` / `1.0.0`, §7.1).
- `boundaryStatement` remains human-facing explanatory text derived from the
  structured fields and loss codes (§6.3); it is **not** the version source
  of truth.
- The three structured identities (assembly, decoder contract, capture
  profile) let any consumer resolve which algorithm/policy produced a record
  without parsing prose.
---

## 14. Data flow

```text
client POST /v1/chat/completions {stream:true}
   │  identity assigned at header observation (traceId == interactionId)
   ▼
readJsonBody (bounded, 10 MB) ──invalid/incomplete/over-limit──► request-failed (§9.2)
   │ valid
   ▼
assemble model_request (bounded excerpt messages) + span_start(model)
   │
   ▼
dispatch to upstream (env-var API key; Accept-Encoding: identity; 30 s establish timeout)
   │
   ├── HTTP error / non-SSE 2xx / connect / timeout / TLS ──► upstream-failed
   │        (error event; upstreamStatus when HTTP; responseMeta on error event)
   └── 2xx text/event-stream
        │
        ▼
   response headers: allowlist (content-type, content-encoding) + x-signalglass-trace-id
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
        │   └── malformed ──► malformed-stream
        ▼
   L4 assembler: canonical events (seq assigned; choiceIndex/chunkIndex; usage;
                 finish reasons; evidence statuses; declarations)
        │
        ▼
   terminal observed: completed / upstream-failed / client-cancelled /
                      ingress-cancelled / malformed-stream / request-failed /
                      observation-detached     (first observed terminal wins)
        │
        ▼
   transport end: client response finish/close   (never blocked by storage)
        │
        ▼
   finalize(): completeness summary + boundary statement + 1.1.0 record
        │
        ▼
   saveEvidenceRecord (exactly once) ──► PersistenceObservation (never rewrites outcome)
        │
        ├── legacy projection (dual emission) + divergence detection (§8)
        └── crash before save ──► declared loss: no record (§2.3, §17)
```

## 15. Privacy and diagnostic rules

- **API keys**: env-var-only (Spec 006). The assembler never reads, retains,
  or records key values; the upstream authorization header is built at
  dispatch and excluded from evidence structurally. No secrets, tokens, or
  credential material may appear in any record, log, error text, boundary
  statement, or diagnostic (§7.4).
- **No raw payloads by default**: no raw request bodies, raw provider JSON,
  raw wire bytes, or full tool results are retained by the default profile
  (§7.1, §6.3 codes).
- **No response header values except the validated bounded allowlist**
  (§4.1): `content-type` (normalized), `content-encoding` (token), and the
  `x-signalglass-trace-id` the ingress itself adds. Cookie, auth, and other
  sensitive header values never enter evidence or logs.
- **Bounded response metadata**: `responseMeta` holds only `statusCode` plus
  the two normalized header values (§12.3).
- **Structural error text**: closed codes + fixed bounded descriptions,
  secret-free by construction (§7.4).
- **Redaction/truncation**: the collection-time privacy process
  (detect-then-retain, §7.2) masks credential spans before the length
  boundary; owning statuses and declarations are recorded; masked content is
  declared loss `original-content-masked`.
- **Diagnostics**: logs carry trace ids, state names, and closed codes, not
  payloads; divergence-detection counters surface projection mismatches
  without content (§8.3).
- **Local databases and `.signalglass/` data directories are never
  committed** (repository rule; unchanged).

---

## 16. Persistence interaction

### 16.1 Save timing (tightened)

- The assembler reaches its terminal observation state when the terminal
  event is observed; the **save waits for the transport end** — the client
  response `finish`/`close` (§2.2).
- Sequence guarantee: for every terminal path,
  `client-response-finished/closed` occurs **before** `saveEvidenceRecord`
  is invoked. Tests assert the call order (save invoked after `finish` /
  `close`; no save during a `data` event) — §19 T69.
- A synchronous save MUST NOT run in the forwarding/backpressure data path;
  it runs on the terminalization/finalization path outside any data handler
  (§2.2).

### 16.2 Save outcomes

- The save returns a `PersistenceObservation` (Spec 015 `SaveOutcome`
  statuses, §11.2): `stored | already-present | conflict | invalid |
  unsupported-version | safety-rejected | policy-rejected | policy-failed |
  clock-failed | contention`.
- The outcome is **observed** (logged, surfaced) and never rewrites the
  terminal state, trace status, or record (§9.5).
- `conflict` (idempotency) and `already-present` are handled per Spec 015:
  a record is never silently overwritten; identity uniqueness is enforced by
  the store.

### 16.3 Storage failure post-response

- Any storage failure occurs after the client response is finalized; it can
  neither delay nor mutate client bytes (§8.4). A `policy-failed` or
  `clock-failed` outcome is reported, and the interaction is not retried by
  this slice (retries are out of scope).

### 16.4 Store-version compatibility

- A store that only supports 1.0.0 is told the record is 1.1.0; the store
  either accepts (additive tolerance, §12.1) or returns
  `unsupported-version`; the ingress does not down-convert (would fabricate
  loss semantics). The degraded legacy-trace path (§8.2) remains available.

---

## 17. Declared losses and crash limitations

### 17.1 Per-record declared losses

Every assembled record carries its `declaredLosses` (§6.3) computed from
what was actually observed — never a static list. Examples:

| Situation | Declared losses |
|---|---|
| Default profile, completed single-choice stream with usage | `provider-native-not-retained`, `request-body-not-retained`, `message-content-not-retained` (excerpted), `delta-content-not-retained`, `wire-bytes-not-retained`, `content-type-parameters-not-retained` (when params dropped), possibly `original-content-masked` |
| Provider reported no usage | + `provider-usage-absent` |
| No finish reason before `[DONE]` | + `finish-reason-absent` |
| Unrecognized extension frame | + `unrecognized-extension-frame` (observation continues) |
| Observation detached mid-stream | + `frame-after-observation-detach`, `encoded-content-not-observed` (when encoding), etc. |
| Client cancellation mid-stream | + `remainder-after-client-cancellation` |
| Ingress cancellation | + `remainder-after-ingress-cancellation` |
| Upstream HTTP error | + `provider-error-body-not-retained` (error body), `request-body-not-retained`, `wire-bytes-not-retained` |

### 17.2 Crash limitations (system-level, declared in docs)

| Failure | Consequence | Declared where |
|---|---|---|
| Crash/kill/power loss before save | No record for the interaction | This spec §2.3; `docs/ingress.md`; `docs/roadmap.md` #40 |
| Crash after `stored` returned | Record durable per Spec 015 | Spec 015 |
| Crash mid-observation | No partial/checkpointed record; no fabricated recovery | §2.3; roadmap #40 defers recovery journaling |
| Storage unavailable at save time | `policy-failed`/`clock-failed`/`contention`; record lost (no queue in this slice) | §16.3 |

The ingress never fabricates a "recovered" identity, a completion, or a
placeholder record for an unpersisted stream.
---

## 18. Implementation slices

The spec is implemented in five ordered slices once Accepted. Each slice is
a separate accepted implementation PR with its own acceptance criteria,
tests, and review; none of the modules exist until its slice.

| # | Slice | Delivers | Depends on |
|---|---|---|---|
| S1 | `@signalglass/streaming`: `sse.ts` + `types.ts` (parser + stream contracts) | `createSseParser()`, `SseFrame`, `FrameDecodeResult`, all closed vocabularies (§11), SSE parser matrix (§5.1) tests | Evidence types |
| S2 | `@signalglass/streaming`: `assembler.ts` (assembler + state machine) | `createStreamAssembler()`, `AssemblerState`/`AssemblerOutcome`, `CompletenessSummary`, sequencing, collection layer (§7.2), multi-choice L3→L4 (§5.3) tests | S1 |
| S3 | `@signalglass/providers`: OpenAI-compatible decoder | `decodeSseFrame` (L3), multi-choice normalization, provider-neutral events, providerNative retention contract tests | S1 |
| S4 | `apps/ingress`: `streamHandler.ts` wiring | Raw-Buffer read, passthrough, backpressure, header allowlist, decoder tee, error envelopes, transport lifecycle, delayed save (§2.2, §16), dual emission + divergence detection (§8) | S2, S3 |
| S5 | Additive schema 1.1.0 (`@signalglass/evidence`) + policy matrix + projections + fixtures | `responseMeta`, `choiceIndex`, `upstreamStatus`, `assembly` validation/serialization; Spec 015 matrix rows (§12.3); projection rows (§12.5); 1.1.0 fixtures; schema/version tests | S1–S4 |

S1–S4 ship against schema 1.0.0 shapes; S5 lands the 1.1.0 additive
fields. Tests in §19 map to slices as annotated.

---

## 19. Testing and conformance requirements

### 19.1 Test groups (75 named groups)

Groups are named so the acceptance-criteria mapping (§21) can reference
them. Slice annotations: `S1`…`S5`.

**SSE parsing (10) — S1**

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

**Multi-choice normalization (7) — S2/S3**

- T11 `MultiChoice: frame with several choices expands in array order`
- T12 `MultiChoice: choiceIndex normalization (provider index / position / single-choice 0)`
- T13 `MultiChoice: per-choice chunk ordinals are independent (chunkIndex vs choiceIndex)`
- T14 `MultiChoice: duplicate and out-of-order provider indexes preserved, never renumbered`
- T15 `MultiChoice: negative/non-integer choice index → sse-invalid-choice-index`
- T16 `MultiChoice: frame with several choices AND usage → choices then usage; per-choice finish reasons; one frame → multiple contiguous canonical events`
- T17 `MultiChoice: fixtures + projection parity (choiceIndex/chunkIndex semantics; E2L rows)`

**Assembly (8) — S2**

- T18 `Assembler: full-stream canonical sequence and ordering`
- T19 `Assembler: seq contiguity/uniqueness; no renumbering; no fabricated gaps`
- T20 `Assembler: identity determinism (traceId/interactionId/eventId/observationId opaque)`
- T21 `Assembler: usage placement matrix (before/after finish; usage-only terminal chunk; absent)`
- T22 `Assembler: finish reason on the carrying chunk; never fabricated`
- T23 `Assembler: captured zero distinct from absent; no fabricated zeros`
- T24 `Assembler: model span lifecycle (completed; unknown on failure/cancel/detach)`
- T25 `Assembler: [DONE] without usage/finish completes with declarations`

**Terminalization (9) — S2/S4**

- T26 `Terminal: EOF without [DONE] → malformed-stream`
- T27 `Terminal: upstream HTTP error → upstream-failed (upstreamStatus recorded)`
- T28 `Terminal: connect/timeout/TLS → upstream-failed (actor model, role unobservable)`
- T29 `Terminal: non-SSE 2xx → upstream-failed (non-sse-response); bytes forwarded unchanged`
- T30 `Terminal: provider error frame → upstream-failed (provider-error-frame)`
- T31 `Terminal: client disconnect → client-cancelled (stops upstream reading)`
- T32 `Terminal: ingress cancellation/shutdown → ingress-cancelled`
- T33 `Terminal: precedence — first observed terminal wins (EOF vs [DONE]; cancel vs failure)`
- T34 `StateMachine: closed transition table; illegal transitions rejected; no transitions out of terminal; no wall-clock completion; finalized is an operation; persistence outcomes are not states`

**Request failure (2) — S2/S4**

- T35 `RequestFailure: invalid/incomplete/over-limit/unroutable → request-failed (codes, actor/role)`
- T36 `RequestFailure: no dispatch; model span absent; identity still recorded`

**Two lifecycles / observer vs passthrough (8) — S4**

- T37 `Lifecycle: malformed provider frame → canonical malformed-stream terminal while passthrough continues byte-unchanged`
- T38 `Lifecycle: unrecognized extension frame → declared loss, observation continues, no model failure`
- T39 `Lifecycle: internal parser/decoder exception → observation-detached (status unknown, informational capture error), passthrough continues`
- T40 `Lifecycle: frame overflow → observation-detached without unbounded buffering, passthrough continues`
- T41 `Lifecycle: unsupported/undecodable content-encoding → observation-detached, passthrough continues`
- T42 `Lifecycle: after detach — no seq, no content, no [DONE] inference; completeness declares unknown remainder`
- T43 `Lifecycle: only client-cancelled / ingress-shutdown / upstream-transport-failure end the transport; observer failures never do`
- T44 `Lifecycle: persistence delayed until response completion after degradation`

**Encoded-stream transparency (6) — S4**

- T45 `Encoded: upstream honors Accept-Encoding: identity → direct parse`
- T46 `Encoded: gzip despite identity → raw gzip bytes forwarded; observer decodes copy; content-encoding forwarded`
- T47 `Encoded: unsupported content-encoding → passthrough unchanged, observation-detached`
- T48 `Encoded: observer decode failure → passthrough unchanged`
- T49 `Encoded: header consistency (content-encoding forwarded; content-length never)`
- T50 `Encoded: encoded text/event-stream is SSE, not non-SSE (own capture outcome)`

**Transparency/backpressure (4) — S4**

- T51 `Transparency: response body bytes identical to upstream (body boundary, not headers)`
- T52 `Transparency: no silent frame mutation (no synthetic [DONE], no injection/removal/reorder/rewrite)`
- T53 `Backpressure: slow client pauses upstream read`
- T54 `Transparency: header allowlist (content-type, content-encoding, trace id); no other upstream header values; content-length never forwarded`

**Collection privacy (6) — S2/S4/S5**

- T55 `Privacy: detect-then-retain — detector scans full text before excerpting`
- T56 `Privacy: credential begins before / crosses / begins after the 240-char boundary — masked in full (sentinels)`
- T57 `Privacy: owning status redacted vs truncated; RedactionDeclaration/TruncationDeclaration recorded; original-content-masked loss`
- T58 `Privacy: secrets never in outputs (sentinels across records, logs, errors, boundary statements)`
- T59 `Privacy: no raw payloads by default; provider-native not retained without explicit fidelity/status`
- T60 `Privacy: admission invariant — default records reach the Spec 015 gate with no S1/S2/S3/S5/S6 witness; a rejection is surfaced and never auto-labeled a code defect`

**Persistence (6) — S4/S5**

- T61 `Persistence: exactly one save, after client response finish/close — save-call order asserted vs finish/close`
- T62 `Persistence: synchronous save never runs in the data/backpressure path`
- T63 `Persistence: save outcomes observable via PersistenceObservation; record not rewritten`
- T64 `Persistence: storage failure post-response never delays or mutates client bytes`
- T65 `Persistence: crash mid-stream leaves no record (declared); no fabricated recovery`
- T66 `Persistence: conflict/idempotency per Spec 015; unsupported-version handling; no down-conversion`

**Legacy coexistence (3) — S4**

- T67 `Legacy: dual emission from one observation`
- T68 `Legacy: divergence detection surfaced, never silently reconciled`
- T69 `Legacy: client traffic isolation (no persistence path affects traffic)`

**Contracts/versioning/schema (6) — S1/S5**

- T70 `Contracts: closed unions; no reason: string for aborted; declaredLosses closed; seqGaps removed (canonical completeness owns)`
- T71 `Contracts: internal exports stay internal; public entry points per §11.4`
- T72 `Versioning: trace.assembly + decoderContract + captureProfile structured; boundary statement derived, not authoritative`
- T73 `Schema: responseMeta exact shape (statusCode bounds, normalized contentType, contentEncoding, absence rules, unknown fields fail closed)`
- T74 `Schema: additive 1.1.0 fields validate, round-trip, and are classified by metadata-safe (policy matrix rows); 1.0.0 records read by 1.1.0 readers and vice versa`
- T75 `Schema: 1.1.0 fixtures pass parseEvidenceRecord(1.1.0) and metadata-safe; projection loss rows added`

### 19.2 Conformance requirements

- Every acceptance criterion (§20) is covered by at least one test group;
  the mapping is **many-to-many** — a criterion may be covered by several
  groups and a group may cover several criteria — and is declared as such
  (§21).
- Tests run under `pnpm test` (Vitest) with the repository's existing
  conventions; fixtures live under `@signalglass/evidence/src/fixtures/`
  and per-package `__tests__`.
- S5 ships fixture/contract tests for the serialized 1.1.0 shape and the
  policy matrix rows, per the repository's test expectations.
- Regression tests accompany every bug fixed during implementation.

---

## 20. Acceptance criteria

A spec implementation is complete only when **all** criteria below are
satisfied by tests (per the repository's spec workflow):

1. **Two lifecycles separated** — an observer/parser/decoder failure never
   stops forwarding, never destroys the upstream request, never injects a
   frame, and never truncates an otherwise forwardable response; only
   client cancellation, ingress shutdown/limit, or upstream transport
   failure ends the transport lifecycle. [T37, T39–T43]
2. **Honest observer-failure semantics** — malformed provider protocol
   terminalizes `malformed-stream` (trace `failed`, actor `model`, role
   `provider_reported`); internal observer failure detaches observation
   (trace `unknown`, informational capture error); an unrecognized
   extension is a declared loss, never a model failure. [T37–T42]
3. **Observation detachment discipline** — after detach: no `seq`, no
   content, no inferred `[DONE]`/completion; completeness declares the
   observation boundary and the unknown remainder. [T42]
4. **Single canonical save** — exactly one `EvidenceRecord` per observed
   streaming interaction, saved exactly once via
   `saveEvidenceRecord`; no checkpointing, revisions, or upserts. [T61]
5. **Save after response completion** — the save is invoked only after the
   client response path finished/closed; no synchronous save in the
   forwarding/backpressure data path; a storage failure is post-response
   and never delays or mutates client bytes. [T61–T64]
6. **Deterministic identity** — opaque `traceId == interactionId` assigned
   at request observation, never content-derived; fresh per observed
   request; one observed request → one record (including request-failed).
   [T20, T36]
7. **Single sequencing surface** — the assembler assigns contiguous `seq`
   from 0; timestamps and content hashes never order or identify;
   unparseable frames leave no fabricated gap. [T18, T19]
8. **Multi-choice normalization** — `choiceIndex` (normalized choice
   identity) and `chunkIndex` (per-choice ordinal) are distinct and never
   interchanged; array-order expansion; duplicates/out-of-order preserved;
   negative/non-integer index → `sse-invalid-choice-index`; per-choice
   finish reasons; frame-level usage after choice events; one frame →
   multiple contiguous canonical events. [T11–T17]
9. **Frame-level decode contract** — `decodeSseFrame` returns an ordered
   zero-or-more `events` result (or `done`/`malformed`/`unrecognized`/
   `decode-error`); one frame expands deterministically. [T11, T16, T17]
10. **Provider-neutral output** — the decoder emits normalized events
    (string deltas, `UsageRecord`/`UsageValue` usage, bounded finish
    reasons, structural provider error codes); raw provider JSON stays in
    `@signalglass/providers` unless retained under the `providerNative`
    contract with explicit fidelity/status. [T17, T59]
11. **Closed vocabularies** — `MalformedStreamCode`, `StreamDecodeErrorCode`,
    `ObservationFailureCode`, `UpstreamFailureCode`,
    `ClientRequestFailureCode`, `CancellationSource`, `TerminalReason`,
    `AbortReason`, `DeclaredLossCode`, `PersistenceObservation` are closed
    unions; no `reason: string` for aborts; `declaredLosses` is a closed
    code list with derived display sentences; `seqGaps` is removed. [T70]
12. **Coherent terminal state machine** — the seven terminal states and the
    diagram, transition table, `AssemblerState`, `AssemblerOutcome`,
    `TerminalReason`, event mapping, trace status, criteria, and tests
    agree exactly; `finalized` is an operation, not a state; persistence
    outcomes are observations, never state rewrites; no wall-clock
    completion; first observed terminal wins; no `interaction_end` after a
    terminal `error`/`cancelled`; model span `unknown` on failure/cancel.
    [T26–T36]
13. **Collection-time privacy process** — versioned sensitive detector
    scans full text before excerpting; credential spans are masked/omitted
    before the length boundary; owning `redacted`/`truncated` statuses and
    declarations are recorded; the Spec 015 gate and persistence policy
    still run non-bypassably. [T55–T60]
14. **Sentinel coverage** — credentials beginning before, crossing, and
    beginning after the excerpt boundary are masked in full. [T56]
15. **Honest admission claim** — default records are *expected* admissible
    (tested construction invariant: no S1/S2/S3/S5/S6 witness), while a
    safety rejection remains an honest possible outcome that is surfaced
    and never auto-labeled a code defect. [T60]
16. **Canonical schema extension** — additive 1.1.0 (`responseMeta`,
    `choiceIndex`, `upstreamStatus`, `assembly`) with exact owner/path/
    shapes, absence rules, validation, round-trip preservation,
    `metadata-safe` matrix rows, projection-loss rows, and 1.1.0 fixtures;
    MAJOR-1 compat both directions. [T73–T75]
17. **Structured assembler version** — `trace.assembly` (name/version/
    decoderContract) recorded structurally; boundary statement derived, not
    authoritative. [T72]
18. **Encoded-stream transparency** — raw-Buffer reads; exact encoded wire
    bytes forwarded; bounded decoder tee for observation; unsupported
    encoding → detached observation; encoded SSE is an SSE outcome, not
    non-SSE; header consistency (content-encoding forwarded, content-length
    never). [T45–T50]
19. **Body-bytes transparency boundary** — transparency applies to the
    response body; response headers are the validated bounded allowlist plus
    `x-signalglass-trace-id`; the "no header values except the allowlist"
    wording is used consistently. [T51, T54]
20. **Byte/order-transparent passthrough** — response body bytes reach the
    client unchanged and in order under backpressure, with zero frame
    mutation. [T51–T53]
21. **Complete SSE parser matrix** — comments, blank lines, multiline data,
    CRLF/LF/CR, split frames, split UTF-8 decoded per frame, `[DONE]`
    exact-value, malformed JSON/UTF-8, partial frame at EOF, frame cap.
    [T01–T10]
22. **Usage/finish honesty** — usage placement matrix honored; absent usage
    and absent finish reason are declared, never fabricated zeros or
    invented reasons; `completed` requires the observed `[DONE]`. [T21–T25]
23. **Evidence-status closure** — every payload carries a closed-set status;
    statuses never omitted or `null`; captured zero distinct from absent;
    `unknown` reserved for unobservable terminations. [T23, T24, T42]
24. **Default-privacy guarantees** — env-var-only keys; no raw payloads by
    default; no response header values beyond the allowlist; structural
    error text; secrets never reach records/logs/errors. [T54, T58, T59]
25. **Legacy coexistence** — canonical authoritative; dual emission from one
    observation; divergence detection surfaced, never silently reconciled;
    client traffic unaffected by any persistence path. [T67–T69]
26. **Package boundaries** — `@signalglass/streaming` network-free with zero
    provider knowledge, depending only on `@signalglass/evidence`; provider
    decoding in `@signalglass/providers`; wiring in `apps/ingress`;
    persistence in `@signalglass/storage`; projections in `@signalglass/core`.
    [T70, T71]
27. **Contract hygiene** — public entry points are exactly the closed unions
    and `createSseParser()`/`createStreamAssembler()`; internal helpers are
    not exported. [T70, T71]
28. **End-to-end validity** — every assembled record passes
    `parseEvidenceRecord` (1.1.0) before save; the legacy projection and
    derived completeness agree with the record's canonical events. [T17,
    T25, T67]

---

## 21. Criterion-to-test mapping

The mapping is **many-to-many**: acceptance criteria (§20) and test groups
(§19.1) do not align 1:1. Each criterion is covered by at least one group
and most criteria are covered by several; several groups (e.g. T37–T42,
T70–T75) cover multiple criteria. The table in §20 lists each criterion's
covering groups inline; the reverse index is the group list in §19.1 with
its slice annotation. Completeness of coverage is verified mechanically in
the implementation review by checking every criterion against its listed
groups and every listed group against a criterion.

---

## 22. Open questions

**None.** Every item previously left open is now resolved normatively:

- `responseMeta` shape, validation, and absence rules — resolved (§12.3).
- Error-code spellings and vocabularies — resolved, closed (§11.2).
- Excerpt cap — resolved: default 240, valid range 64–4096, profile-version
  bump rule (§7.3).
- Encoded-stream transparency — resolved (§4.5).
- Persistence timing — resolved (§2.2, §16).
- Legacy divergence policy — resolved (§8.3).

Deferred work is listed under Non-goals and §18 slices, not as open
questions. If a reviewer identifies a genuinely undecided point, it must be
resolved by an amended Accepted spec before implementation.

---

## 23. Documentation impact

When the spec is Accepted and implemented, the following docs change (docs
are **not** changed by this Draft PR beyond the index/roadmap updates
already made):

- `docs/ingress.md` — streaming data flow, two lifecycles, header allowlist,
  encoded-stream handling, crash limitation.
- `docs/trace-model.md` — streaming event refinement, legacy trace as
  compatibility projection.
- `docs/evidence-model.md` / `docs/model-versioning.md` — additive 1.1.0
  fields and the additive-minor mechanism.
- `docs/evidence-projection-matrix.md` — new loss rows (responseMeta,
  choiceIndex, upstreamStatus, assembly).
- `docs/privacy.md` — collection-time privacy process, detect-then-retain,
  excerpt bounds.
- `docs/capture-profiles.md` — the `signalglass.collection.ingress-metadata-safe`
  profile v1.0.0.
- `docs/architecture.md` — package map gains `@signalglass/streaming`.
- `docs/roadmap.md` — milestone #23 moves from forecast to Accepted when
  this spec is accepted.
- `specs/000-index.md` — Spec 016 row status transitions Draft → Accepted →
  Implemented.

---

## 24. References

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
