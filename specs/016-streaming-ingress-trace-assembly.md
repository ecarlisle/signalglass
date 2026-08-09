# Spec 016: Streaming ingress and trace assembly

## Status

**Draft.** Proposed for acceptance; **implementation is prohibited until this
spec is Accepted**. No runtime code is produced by this PR. The proposed
modules, contracts, and constants below are named but **not created** until an
accepted implementation slice.

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
completeness declarations, and persists that record exactly once at stream
termination through the append-only evidence store
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
| [Spec 014](014-evidence-primitives.md) | `@signalglass/evidence` types/validators/serialization the assembler's output must satisfy; §4.6 (streamed observations ordered by the single sequencing surface) is implemented by this spec; §4.7 terminal-state rules bind the assembler's status decisions. |
| [Spec 015](015-append-only-evidence-store.md) | `EvidenceStorage.saveEvidenceRecord` — the only persistence path for assembled records; the `metadata-safe` reference policy is the default admission contract the assembler's default output must satisfy. |
| [`docs/ingress.md`](../docs/ingress.md) | Current non-streaming live-mode data flow; Spec 016's implementation updates it. |
| [`docs/trace-model.md`](../docs/trace-model.md) | "Streaming response event refinement" is listed as future work; the legacy `Trace` path becomes a compatibility projection (Spec 016 §7). |
| [`docs/privacy.md`](../docs/privacy.md) | Default capture/persistence boundaries the assembler must honor (metadata-safe defaults, env-var-only keys, no raw payloads by default). |
| [`docs/roadmap.md`](../docs/roadmap.md) | Streaming milestone; slice #23 (this spec); slice #40 (reliability/recovery — crash-recovery journaling is deferred to it). |

## Scope

Define, for a **streaming** OpenAI-compatible interaction observed by
`apps/ingress`:

1. The assembly/persistence boundary: one canonical record, one save, at
   stream termination (Spec 016 §1).
2. Deterministic identity and `seq` ordering (Spec 016 §2).
3. Streaming transparency: byte/order-transparent, backpressured passthrough
   with no silent frame mutation, and the four observation layers
   (Spec 016 §3).
4. The full SSE parsing and terminalization matrix (Spec 016 §4).
5. The evidence-status vocabulary and the loss mapping for every assembled
   payload (Spec 016 §5).
6. Capture vs. persistence policy boundaries (Spec 016 §6).
7. Legacy coexistence: canonical-authoritative dual emission with divergence
   detection (Spec 016 §7).
8. The deterministic error/cancellation state machine (Spec 016 §8).
9. Package boundaries and the proposed module layout (Spec 016 §9).
10. Public contracts, versioning, and internal-vs-public exports (Spec 016 §10).

The spec also defines the data flow (§11), privacy and diagnostic rules (§12),
persistence interaction (§13), declared losses and crash limitations (§14),
the phased implementation sequence (§15), the testing and conformance
requirements (§16), acceptance criteria (§17), the criterion-to-test mapping
(§18), and the narrow open questions (§19).

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
  explicitly **not** added; the crash limitation is declared (§1.3, §14).
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
| **Sequencing surface** | The single capture component that assigns `seq` at observation time (Spec 013 §2.2). In this spec it is the assembler (§2). |
| **SSE frame** | One server-sent-event block: field lines terminated by a blank line. The parser's output unit (§3, §4). |
| **Transport byte** | The raw upstream response bytes observed at the ingress boundary. Never mutated by the ingress (§3). |
| **Parsed stream event** | The provider decoder's interpretation of a frame's `data` value: `chunk` / `usage` / `done` / `error` (closed union, §10). |
| **Canonical event** | An `EventRecord` (Spec 013 §3.1) the assembler derives from parsed stream events and lifecycle signals. |
| **Terminal marker** | The `[DONE]` data frame that signals normal stream termination. |
| **Terminalization** | The assembler's deterministic transition into exactly one terminal state (§4, §8). |
| **Terminal reason** | `completed` / `upstream-failed` / `client-cancelled` / `ingress-cancelled` / `malformed-truncated` (§8). |
| **Passthrough** | Forwarding the upstream response bytes to the client with content and order preserved (§3). |
| **Backpressure** | Slowing or pausing the upstream read when the client cannot consume (§3). |
| **Dual emission** | Emitting both the canonical record (Spec 015) and the legacy `Trace` (Spec 007 path) for one interaction (§7). |
| **Divergence detection** | Comparing the canonical record's legacy projection with the independently emitted legacy trace (§7). |
| **Completeness summary** | The assembler-level accounting of what was observed, dropped, and declared (§10). |
| **Capture profile** | The named, versioned bundle of collection settings recorded on the trace (`captureProfile`, Spec 013 §9). |
| **Declared content** | Content admitted only under an owning `redacted`/`truncated` declaration (Spec 015 `metadata-safe`). |

---

## 1. Assembly and persistence boundary

**Decision 1 — one canonical record, one save, at stream termination; no
checkpointing or revisions; the crash limitation is declared honestly.**

### 1.1 Single canonical save

- Each observed streaming interaction produces **exactly one** `EvidenceRecord`
  (§11 data flow), assembled in memory across the whole stream.
- The record is handed to persistence **exactly once**, at terminalization
  (§8), through the only permitted persistence path:
  `EvidenceStorage.saveEvidenceRecord(record)` (Spec 015). The save is the
  synchronous call on the terminalization path.
- There is **no checkpointing**: no partial records, no in-progress writes,
  no revisions, no upserts, and no periodic snapshots of the assembled
  observations. The append-only contract of Spec 015 is unchanged; the
  assembler adds no second write path.
- An interaction that reaches terminalization always produces a record — even
  when the terminal state is a failure or cancellation (§8). The `status`
  vocabulary (`completed` / `failed` / `cancelled` / `unknown`) is never
  invented; it is derived from the observed terminal event per Spec 014 §4.7.

### 1.2 Persistence timing is terminalization

- The save happens after the terminal event is observed and the final `seq`
  is assigned — never before the stream is known to have ended.
- The client response and the persistence save are **independent**:
  - the ingress finalizes the client's response (forwarded bytes, connection
    close, or error envelope) first and always;
  - the save outcome is observable (§13) but never rewrites the interaction
    outcome and never alters client traffic (§7.3).

### 1.3 Honest crash limitation

- If the process crashes, is killed, or loses power **before**
  terminalization, the interaction has **no persisted record**. This is a
  declared loss, not a defect to be papered over:
  - the loss is stated in `docs/ingress.md` and `docs/roadmap.md` (§14);
  - the spec does **not** fabricate a record, a "recovered" identity, a
    completion, or a placeholder document for an unpersisted stream;
  - crash-recovery journaling for interrupted streams is explicitly deferred
    (roadmap #40, "Reliability, recovery, and incomplete-trace handling").
- If the process crashes **after** the save returned `stored`, the record is
  durable per Spec 015 (WAL, transactional save).

### 1.4 No conditional persistence based on outcome

- The assembler does not decide to skip the save because the terminal state
  is a failure; failed, cancelled, and malformed interactions are persisted
  like completed ones (subject to the storage-safety gate and persistence
  policy, which may refuse a specific record — §13).

---

## 2. Identity and deterministic ordering

**Decision 2 — sequence numbers and opaque identities are the only ordering
and identity keys; timestamps and content hashes never order or identify.**

### 2.1 Identity

- `traceId` == `interactionId` (Spec 013 §1.2, §2.1): a single opaque value
  assigned by the ingress **when the request is first observed** — the moment
  `POST /v1/chat/completions` headers are received, before the body is read or
  parsed. Every subsequent failure (including an unreadable body) is recorded
  against this identity, so "one observed request → one record" holds by
  construction.
- Identity is opaque, capture-time, immutable, and **never derived from
  content** (no request-hash, no message-hash, no body digest as identity).
  ULID-style values are recommended; `crypto.randomUUID`-style uniqueness is
  acceptable. Identity is assigned fresh per observed request; a retrying
  client that re-POSTs produces a new interaction with a new identity.
- `eventId` values are opaque, assigned at capture, unique within the trace.
- `chunkIndex` is **semantic, not transport-derived**: it is the parsed
  chunk's choice `index` when the provider supplies one (OpenAI per-choice
  index), otherwise the ordinal of content-bearing chunks within the choice.
  It is never the transport frame counter and never a byte offset (§5, E2L-073
  precedent in the projection matrix).
- `observationId` values are assigned by the assembler at the capture
  boundary, unique and immutable (Spec 014 §2.1).

### 2.2 Sequence ordering

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
  sequenced. A frame dropped at the parser or decoder boundary leaves **no
  seq gap** (no position was assigned); the loss is disclosed through the
  evidence status and the boundary statement (§5), exactly as Spec 013 §2.2
  requires for events that never reached the sequencing surface. Seq gaps in
  the canonical record therefore cannot occur in this slice by construction;
  the completeness derivation still detects and reports any that a future
  slice or an external producer could introduce.
- **Ordering of multi-choice streams:** chunks are sequenced in the order
  their frames were observed crossing the boundary (the sole sequencing
  surface). `chunkIndex` carries the choice identity; it never reorders.

### 2.3 One sequencing surface per trace

- Cross-surface federation remains deferred (Spec 013 §1.2). The ingress is
  the only surface that adds observations to the interaction's record.

---

## 3. Streaming transparency

**Decision 3 — the ingress is byte/order-transparent and backpressured, never
silently mutates frames, and separates four observation layers.**

### 3.1 Four layers

| Layer | What it is | Owned by | Mutated by the ingress? |
|---|---|---|---|
| **Transport bytes** | The exact upstream response body bytes observed at the boundary. | `apps/ingress` passthrough | **Never.** Content and order are preserved to the client. |
| **SSE frames** | Incremental parsing of transport bytes into frames (§4). | `@signalglass/streaming` parser | Parser is a read-only observer; the forwarded stream is untouched. |
| **Parsed stream events** | Provider decoding of frame `data` into the closed `StreamEvent` union (§10). | `@signalglass/providers` (openai-compatible decoder) | Read-only. |
| **Canonical events / record** | The assembler's derivation into `EventRecord`s and the canonical record. | `@signalglass/streaming` assembler + `@signalglass/evidence` derivation | Applies only to the evidence copy, never to the forwarded bytes. |

The layers are strict: the parser never interprets provider semantics, the
provider decoder never touches bytes or persistence, the assembler never sees
transport bytes, and no layer writes to the client socket.

### 3.2 Byte/order transparency

- The client receives the upstream response body **byte-identical in content
  and order** to what the ingress observed (SSE data bytes, line endings,
  comments, frame boundaries, and the terminal marker included). The ingress
  does not re-chunk, re-wrap, inject, remove, or reorder frames.
- The HTTP response headers the client sees are the ingress's own: a bounded
  allowlist (see §3.4) plus `x-signalglass-trace-id`. Upstream response
  headers are not forwarded wholesale (privacy, §12).
- The only responses the ingress generates are (a) pre-stream rejections
  (invalid request, no provider, missing key — unchanged from Spec 006) and
  (b) the normalized error envelope when the upstream dispatch produced **no
  stream at all** (connect failure, timeout before response, non-2xx status —
  unchanged from Spec 006). Once a 2xx stream is being forwarded, the ingress
  never injects or rewrites content; a mid-stream failure is surfaced by
  terminating the client connection as the upstream terminated (with the
  connection closed and the error recorded in evidence), never by fabricating
  a synthetic frame or a `[DONE]`.

### 3.3 No silent frame mutation

- "Silent" is the operative word: the ingress performs **no** frame mutation
  at all in this slice. Every byte observed is forwarded; every observation
  recorded in evidence is derived from the same bytes. There is no
  transformation to declare because there is no transformation.
- Content-encoding: the ingress requests `Accept-Encoding: identity` on
  upstream dispatch in this slice. If an upstream still returns an encoded
  body, the ingress forwards the encoded bytes unchanged (transparency holds)
  and classifies the interaction per §4.9 (encoded streams are not parsed;
  the frame parser is fed only the decoded copy when decoding is possible, and
  never mutates the forwarded bytes). Encoded-stream support is a later
  capture-fidelity slice; the spec does not pretend to parse what it cannot.

### 3.4 Response headers observed

- The assembler records a bounded, non-sensitive subset of the upstream
  response metadata on the canonical record: HTTP `statusCode` and
  `content-type`. The exact transport fields are captured in an **additive
  optional `responseMeta` field on the response envelope** (proposed additive
  extension under Spec 013 §10 additive-evolution rules; the field is not part
  of the Spec 014 types yet — the implementation slice adds it with the
  documented conformance-table impact on the `metadata-safe` policy). Full
  header lists, cookies, and `set-cookie` are never retained (§12).
- `x-signalglass-trace-id` continues to be added to client responses (Spec
  006 behavior preserved).

### 3.5 Backpressure

- The passthrough is a pipe with standard Node backpressure semantics: when
  the client socket cannot consume, the upstream response read is paused;
  when the client resumes, reading resumes. The assembler is a **tee** on the
  same byte stream and must never bypass backpressure (it must not buffer the
  whole stream eagerly and must not force reads the client is not consuming).
- Slow clients slow the upstream read (and therefore slow assembly); fast
  clients stream at upstream speed. No unbounded buffering: the assembler
  keeps only the current partial frame plus per-observation bounded excerpts
  (§6), not a full stream copy.
- The ingress's own upstream dispatch timeout is an **idle timeout** (no
  bytes received for the configured window, default 30 000 ms, unchanged from
  `forward.ts` semantics): long-running streams are supported; idle streams
  terminalize per §8.

---

## 4. SSE parsing and terminalization matrix

**Decision 4 — the parser and the assembler handle the full observed-stream
matrix deterministically; every input maps to exactly one outcome.**

### 4.1 Frame grammar (normative)

- A frame is a sequence of field lines terminated by a blank line (two line
  terminators). Each field line is `name:value`, `name:` (empty value), or a
  comment line starting with `:` (ignored).
- Line terminators: `CRLF`, `LF`, and lone `CR` are all accepted; the parser
  is terminator-agnostic and never normalizes them in the forwarded stream.
- `data:` lines in one frame are concatenated with `\n` into the frame's
  value. `event:`, `id:`, and `retry:` fields are parsed and ignored by this
  slice (recorded only as declared, non-retained protocol metadata when
  useful); only `data` is decoded.
- The parser is **incremental**: it buffers bytes across TCP chunks and
  yields complete frames only; a partial frame at stream end is a
  terminalization input (§4.10).
- `[DONE]` is a data frame whose value is exactly the string `[DONE]`. It is
  the protocol terminal marker; it is **not** a canonical event and carries
  no content.

### 4.2 Byte handling

- Transport bytes are buffered per-stream in the parser; bytes are decoded to
  UTF-8 **per complete frame** (never mid-frame), so multi-byte UTF-8
  sequences split across TCP chunks decode correctly.
- Invalid UTF-8 in a data value is a malformed-stream input (§4.10).
- Frame size is bounded by a per-frame cap (default 16 MiB, configurable);
  exceeding it is a malformed-stream input with a declared loss, never an
  unbounded buffer.

### 4.3 Parsed stream events (provider decoding)

The openai-compatible decoder interprets a frame's `data` value as JSON and
returns exactly one of the closed `StreamEvent` union (§10):

| Frame data | StreamEvent |
|---|---|
| JSON object with non-empty `choices[].delta` and no `[DONE]` | `chunk` (with `choiceIndex`, optional `finishReason`, optional `usage`) |
| JSON object with `choices` absent/empty and `usage` present | `usage` |
| JSON object whose `choices[].finish_reason` is present | `chunk` with `finishReason` (the finish is carried by its chunk; no separate event) |
| `[DONE]` | `done` |
| JSON object with an `error` field (OpenAI error shape) | `error` (structural code only — see §8.2; the provider's error text is never retained by default) |
| Unparseable JSON / non-object data | decoder returns `null` → assembler terminalizes per §4.10 |

A frame whose data decodes to none of the above (for example, an unknown
non-error, non-chunk object) is treated as a malformed-stream input
(`sse_unrecognized_data`) — the decoder never silently drops a frame.

### 4.4 Usage placement matrix

| Observed pattern | Canonical events (in seq order) |
|---|---|
| Content chunk with no usage | `model_response_chunk` |
| Content chunk carrying usage | `model_response_chunk` then `model_usage` |
| `usage`-only frame (empty choices) | `model_usage` |
| Usage in a chunk before the finish chunk ("usage-before-finish") | `model_response_chunk` … then `model_usage` at its observed position |
| Usage in/after the finish chunk, before `[DONE]` ("usage-after-finish") | `model_response_chunk` (finish) then `model_usage` |
| Usage-only terminal chunk then `[DONE]` | `model_usage` then terminalization |
| No usage anywhere, `[DONE]` observed | terminalization; **no `model_usage` event is fabricated** and no zeros are invented — the absence is declared (§5.3, §12) |

### 4.5 Finish reason

- `finishReason` is recorded on the `responseEnvelope` of the chunk that
  carried it (the canonical `finishReason` envelope field). A finish reason
  that never arrives is **never fabricated**; its absence is declared in the
  boundary statement (§5.3).
- `[DONE]` without any observed finish reason still yields `completed`
  (normal termination was observed); the absence of the reason is declared.

### 4.6 Terminalization inputs

The assembler accepts exactly these terminalization inputs (closed set):

| Input | Terminal reason |
|---|---|
| `done` frame (`[DONE]`) observed | `completed` |
| Upstream HTTP non-2xx (before or instead of a 2xx stream) | `upstream-failed` |
| Upstream connect/timeout/TLS/transport failure before any 2xx bytes | `upstream-failed` |
| Upstream connection ends mid-stream without `[DONE]` (EOF) | `malformed-truncated` |
| Data frame with malformed JSON / invalid UTF-8 / unrecognized data / oversized frame | `malformed-truncated` |
| Non-SSE `content-type` on a 2xx response to a streaming request | `upstream-failed` (bytes still forwarded unchanged) |
| Client disconnects mid-stream | `client-cancelled` |
| Ingress cancels (server shutdown, configured limit) | `ingress-cancelled` |
| Client request body unreadable / invalid / over limit | `upstream-failed` only in the pre-dispatch sense — see §8.4 (client-caused failures are `failed` records with actor `agent`) |

### 4.7 Terminal races

- **EOF vs. `[DONE]`:** the first observed wins. `[DONE]` observed before EOF
  → `completed` (the trailing EOF is the normal close). EOF without a prior
  `[DONE]` → `malformed-truncated`.
- **Client cancellation vs. upstream failure:** the first terminal
  transition observed wins (§8.3). Bytes already received and parsed before
  the terminal observation are included in the record; bytes after the
  terminal observation are not read (the upstream request is destroyed), and
  their absence is disclosed (§5.4), never guessed.
- **Timeout vs. EOF:** an idle timeout that fires first terminalizes
  `upstream-failed`; a stream that closes while a timeout is pending
  terminalizes on its own observed terminal.

### 4.8 Pre-stream rejection

- Requests rejected before dispatch (invalid JSON body, missing model
  routing, missing API key, body over limit) produce a record per §8.4 with
  actor `agent` / `capture` as declared, and the client receives the Spec 006
  normalized error envelope. No provider content is echoed (§12).

### 4.9 Non-stream responses to streaming requests

- If the upstream returns a 2xx response whose `content-type` is not SSE
  (for example `application/json`) for a `stream: true` request, the ingress
  forwards the body bytes unchanged and the assembler terminalizes
  `upstream-failed` with error code `non_sse_response` (§8.2). The body is
  not retained (declared loss); the interaction's stream was observed not to
  occur.

### 4.10 Malformed-stream classification

- Every malformed input is classified with a **structural error code**
  (closed set, no content echoed): `sse_invalid_data_json`,
  `sse_invalid_utf8`, `sse_unrecognized_data`, `sse_frame_overflow`,
  `sse_eof_without_done`, `sse_partial_frame_at_eof`.
- The malformed frame's bytes and the offending value are **never** retained
  or echoed (privacy, §12); the error event carries only the structural code
  and a fixed bounded message.
- `malformed-truncated` maps to canonical trace status `failed` with an
  `error` event (actor/role per §8.2), and the boundary statement declares
  the truncation explicitly (§5.4).

---

## 5. Evidence status vocabulary and loss mapping

**Decision 5 — every assembled payload carries exactly one closed evidence
status; nothing is fabricated (no zeros, finish reasons, or success), and
every mapping declares its loss.**

### 5.1 Status mapping (default metadata-safe capture profile)

| Canonical element | Default `evidenceStatus` | Notes |
|---|---|---|
| `interaction_start` / `interaction_end` | `captured` | Lifecycle control events carry no payload (Spec 013 §5.1). |
| `span_start` / `span_end` | `captured` | Span derivation metadata is structural. |
| `model_request` envelope | `truncated` when bounded excerpts are retained; `captured` when only structural metadata is retained (messages absent); `redacted` when secret-bearing content was masked | The single event-level status declares the payload's state; the policy classifies fields (§6). |
| `model_response_chunk` envelope | `truncated` (bounded delta excerpt) | `chunkIndex` and structural envelope fields are captured; the delta content is a declared truncated excerpt by default. |
| `model_usage` | `captured` | Provider-reported numeric usage under the Spec 015 numeric allowlist; absent usage never fabricates an event (§4.4). |
| `error` payload | `captured` (structural type + fixed bounded message) | Schema-owned diagnostic text; provider error bodies are never retained by default (§8.2). |
| `cancelled` payload | `captured` | `requestedBy` is a bounded structural label (`client` / `ingress`). |
| Content that existed but was not captured | `missing` / `unknown` per §5.2 | Declared, never omitted into `null` (Spec 013 §4.1). |
| `not_applicable` | Only where no such content applies | For example, a control event's absent payload. |

### 5.2 Status choice rules (normative)

- `missing` — known that content was not captured (for example, the default
  profile does not capture full request bodies; a full body is declared
  `missing` when its absence is a deliberate capture decision, while the
  retained excerpt is `truncated`).
- `unknown` — cannot determine whether content existed (for example,
  provider-side token usage when the provider reported none: whether the
  provider computed usage internally is unobservable; the declaration says
  "provider reported no usage", never "usage was zero").
- `not_applicable` — no such content applies (control events).
- Statuses are **never collapsed into `null` or omitted fields** (Spec 013
  §4.1); a captured numeric zero (a real provider-reported value) is
  recorded as `captured` with value `0`, distinct from "no usage reported".

### 5.3 No fabricated values

- No fabricated `finishReason`: only a value the provider sent is recorded.
- No fabricated usage: no `model_usage` event and no `0` when the provider
  reported none; the absence is declared in the boundary statement.
- No fabricated success: `completed` requires an observed `[DONE]`
  terminalization (§4.6) — a stream that ended without it is
  `malformed-truncated`, never completed; wall-clock time never completes a
  trace (Spec 014 §4.7).
- No fabricated identity, digest, or storedAt on persistence failure (Spec
  015 `EvidenceContentionError` and failure outcomes carry none).

### 5.4 Declared losses (every mapping declares)

The assembler's boundary statement (and the canonical derived completeness,
Spec 013 §4.3) declares, in fixed structural sentences:

- full request bodies and full delta text are not retained by default
  (truncated excerpts only);
- provider error bodies are not retained;
- usage and finish reason when not reported;
- frames dropped after a terminal observation (client-cancelled /
  ingress-cancelled) — these never received a `seq` (Spec 013 §2.2) and are
  disclosed here, never inferred from sequence position;
- malformed frames that were not retained;
- the observed presence or absence of the `[DONE]` terminal marker;
- the crash limitation (§1.3) is stated in docs, not per-record (no record
  exists for an unpersisted stream to carry it).

---

## 6. Capture and persistence policy boundaries

**Decision 6 — collection defaults are metadata-safe; persistence defaults
are the conservative Spec 015 `metadata-safe` policy; secrets, keys, and raw
payloads are never captured or persisted by default; API keys are
environment-variable-only.**

### 6.1 Collection (capture) policy

- The assembler's default capture profile is
  `signalglass.collection.ingress-metadata-safe` **v1.0.0** (recorded on the
  trace as `captureProfile`): it collects structural metadata (identity,
  routing, timestamps, lifecycle, span structure, envelope fidelity,
  `chunkIndex`, finish reason, provider-reported usage) plus **bounded
  truncated excerpts** of request messages and chunk deltas (default excerpt
  cap 240 characters, matching the legacy `maxExcerptLength` default;
  configurable).
- The default profile is **not** a full-payload profile: full request
  bodies, full delta text, provider-native envelopes beyond the declared
  excerpts, and provider error bodies are not collected (declared `missing`
  / not retained per §5).
- Full-content capture is an **opt-in** debug profile in a later slice; even
  then it remains subject to the storage-safety gate and the persistence
  policy (Spec 015), and never becomes a default.
- **Secrets:** API keys are referenced by environment-variable name only
  (`apiKeyEnv`, unchanged from Spec 006/provider-config); the key value is
  resolved at runtime and used only for upstream dispatch. The client's
  inbound `Authorization` header is read for syntactic compatibility and
  **never** stored, logged, or included in evidence. Authorization, cookie,
  proxy-authorization, and set-cookie headers are never collected from
  either side (§12).

### 6.2 Persistence policy

- The persistence policy is the Spec 015 reference policy
  `signalglass.persistence.metadata-safe` **v1.0.0** — unchanged, imported,
  never re-implemented. The assembler's default output is **policy-admissible
  by construction**: its content is either structural metadata or declared
  `truncated`/`redacted` content, and it carries no retained bytes (no
  `Uint8Array`, so the S6 short-circuit never fires for default records).
- "No permissive persistence default" means: nothing in this spec widens the
  default admission. Records that a non-default profile makes richer remain
  subject to the mandatory storage-safety gate (S1/S2/S3/S5/S6) and the
  `metadata-safe` policy; a `safety-rejected` / `policy-rejected` outcome is
  surfaced (§13), never silently persisted elsewhere.

### 6.3 Capture vs. persistence independence

- Collection and persistence remain independent policies (Spec 013 §9): the
  assembler's capture profile decides what is observed; the persistence
  policy decides what is retained. The assembler does not pre-filter to
  satisfy persistence, and persistence does not widen capture. The default
  configuration is simply aligned so that default records are admissible.

---

## 7. Legacy coexistence

**Decision 7 — canonical evidence is authoritative; the legacy `Trace` path
continues as a compatibility projection during migration; dual emission is
allowed with divergence detection; persistence failures never affect client
traffic.**

### 7.1 Canonical-authoritative

- For a streaming interaction, the canonical `EvidenceRecord` is the
  authoritative persisted artifact. Legacy `Trace`/`TraceEvent` rows
  (Spec 007 `TraceStorage`) are a compatibility surface during migration
  (Spec 013 §11; Spec 014 §6 projections).
- The legacy `Trace` may be produced either by dual emission (§7.2) or by
  projecting the canonical record through `evidenceToLegacyTrace` (Spec 014
  §6) — the projection is the migration-compatible path.

### 7.2 Dual emission

- Dual emission is **allowed**: the ingress MAY emit both the canonical
  record (Spec 015 save) and a legacy `Trace` (Spec 007 path) for the same
  interaction, so existing `--storage` consumers keep working during
  migration.
- When both are emitted, both MUST be derived from the **same observed
  stream** (same terminalization, same events), and each MUST be produced
  without mutating the other or the forwarded bytes.
- The `--storage <path>` CLI flag is reused: the canonical `EvidenceStorage`
  and the legacy `TraceStorage` share the same SQLite file (Spec 015
  coexistence contract; legacy rows untouched by canonical writes).

### 7.3 Divergence detection

- When dual emission is enabled, the ingress projects the canonical record
  (`evidenceToLegacyTrace`) and compares it with the independently emitted
  legacy trace. Agreement is the expected outcome (the parity gate of Spec
  014 slice 4 applies to the same interaction, not only fixtures).
- On divergence, the canonical record is authoritative; the divergence is
  surfaced (warning via the emit callback / log) and **never silently
  reconciled** — the legacy path is not repaired by rewriting evidence, and
  the canonical record is not altered to match.
- Divergence detection never affects client traffic.

### 7.4 Client-traffic failure impact

- Persistence failures — canonical (`SaveOutcome` refusal, contention,
  policy/safety rejection) or legacy (`TraceStorage` write failure) — **never
  alter the client response**. The response bytes are finalized first
  (§1.2); failures are surfaced through the emit callback and logs (§13).
- The only client-visible failure responses are the Spec 006 pre-stream
  rejections and the normalized upstream error envelope (§3.2), which are
  observability behaviors, not persistence outcomes.

---

## 8. Deterministic error and cancellation state machine

**Decision 8 — a closed, deterministic state machine; the first observed
terminal transition wins; storage failures are observable without rewriting
outcomes; error text carries no secrets.**

### 8.1 States

```
initialized ──request observed──▶ request observed ──dispatch──▶ dispatched
   │                                      │                        │
   │ (body unreadable / invalid /         │ (no provider,          │ (connect/timeout/
   │  over limit)                         │  missing key,          │  HTTP non-2xx)
   ▼                                      ▼                        ▼
failed(agent/capture)             failed(agent/capture)     upstream-failed
   │                                                              │
   │                                ┌─────────────────────────────┘
   │                                ▼
   │                     streaming ──▶ [chunks, usage, finish]
   │                                │
   │                                ├── [DONE] ─────────────────────▶ completed
   │                                ├── EOF/malformed ──────────────▶ malformed-truncated
   │                                ├── client disconnect ──────────▶ client-cancelled
   │                                ├── ingress cancel ─────────────▶ ingress-cancelled
   │                                ├── non-SSE 2xx ────────────────▶ upstream-failed
   │                                └── idle timeout ───────────────▶ upstream-failed
   │
   ▼
finalized ──▶ persistence: stored | already-present | conflict | invalid |
             unsupported-version | safety-rejected | policy-rejected |
             policy-failed | clock-failed | contention-exhausted (observable,
             never rewrites the record, never affects client traffic)
```

The mandate's state names are preserved: `initialized`, `request observed`,
`dispatched`, `streaming`, the five terminal states (`completed`,
`upstream-failed`, `client-cancelled`, `ingress-cancelled`,
`malformed-truncated`), `finalized`, and the observable persistence outcomes.

### 8.2 Terminal event mapping (canonical)

Every terminal state maps to exactly one canonical tail:

| Terminal | Canonical terminal event (final applicable `seq`) | Trace status | `error`/`cancelled` payload |
|---|---|---|---|
| `completed` | `interaction_end` (after `[DONE]`) | `completed` | — |
| `upstream-failed` — HTTP non-2xx | `error` | `failed` | actor `model`, role `provider_reported`, code `upstream_http_error`, fixed bounded message (status only, no body) |
| `upstream-failed` — connect/timeout/TLS | `error` | `failed` | actor `model`, role `unobservable` (no provider content was received; the reason is provider-side), code `upstream_transport_failure` |
| `upstream-failed` — non-SSE 2xx | `error` | `failed` | actor `model`, role `provider_reported`, code `non_sse_response` |
| `malformed-truncated` — bad data / EOF without `[DONE]` / partial frame | `error` | `failed` | actor `model`, role `provider_reported` (the provider's stream content was observed to be malformed/truncated), code from the closed set (§4.10) |
| `client-cancelled` | `cancelled` | `cancelled` | `requestedBy: "client"`, target `trace`, effect `cancel` |
| `ingress-cancelled` | `cancelled` | `cancelled` | `requestedBy: "ingress"`, target `trace`, effect `cancel` |
| Client-caused pre-dispatch rejection | `error` | `failed` | actor `agent` (malformed/incomplete client request), role `client_sent`, code `client_request_invalid` / `client_request_incomplete` / `client_request_over_limit`; actor `capture`, role `unobservable`, code `request_unreadable` only for ingress-internal transport failures |

Rules:

- `error` events always declare actor, `lifecycleTarget: "trace"`,
  `lifecycleEffect: "fail"` (the trace-level terminal), and the observation
  role under which the failure was observed (Spec 013 §3.3, §5.1). The model
  span in a failed/cancelled interaction terminates as **`unknown`** (no
  `span_end` observed; the child span's terminal state is never invented and
  is disclosed in the boundary statement, per Spec 014 §4.7 — a trace-level
  terminal never automatically terminates child spans).
- `cancelled` events always declare `lifecycleTarget: "trace"`,
  `lifecycleEffect: "cancel"`, and `requestedBy` (Spec 013 §3.3).
- Error codes are the closed structural set above; **error text is fixed,
  bounded, and carries no secret, no provider content, no identity, and no
  header value** (§12). Provider error bodies are never retained by default.
- `finalized` is reached after terminalization; persistence runs against the
  finalized record, and its outcome is observable (§13) without altering the
  record or the interaction status.

### 8.3 Terminal-state precedence

- The first terminal transition observed is authoritative. After a terminal
  state, no further `seq` is assigned, no further canonical events are
  appended, and no other terminal can open: the record's final applicable
  event is the terminal one, satisfying Spec 014 §4.7 (a later
  `interaction_end` after a terminal `error`/`cancelled` would be a
  contradiction and is never produced).
- Races (EOF vs. `[DONE]`, client-cancel vs. upstream failure) resolve by
  observation order (§4.7); the losing observation is disclosed in the
  boundary statement where relevant.
- Illegal transitions (for example, a `done` frame after a client-cancelled
  terminal, or a second `interaction_end`) are rejected by the assembler as
  programming errors — the state machine's transition table is closed and
  tested.

### 8.4 Pre-dispatch request failures

- A request observed at `POST /v1/chat/completions` always produces a record
  (identity is assigned at observation, §2.1), including requests rejected
  before dispatch. The canonical status is `failed` with the declared
  actor/role; the client receives the unchanged Spec 006 normalized error
  envelope. No body content is echoed (§12).

---

## 9. Package boundaries

**Decision 9 — network in `apps/ingress`, provider decoding in
`@signalglass/providers`, canonical evidence in `@signalglass/evidence`,
persistence in `@signalglass/storage`, projections in `@signalglass/core`;
proposed modules are named but not created.**

### 9.1 Module map (proposed, not created)

| Package | Existing / proposed | Responsibility in this spec |
|---|---|---|
| `apps/ingress` | existing | HTTP server, request observation, upstream dispatch, passthrough with backpressure, cancellation propagation, response headers, persistence call wiring. Proposed new module: `apps/ingress/src/streamHandler.ts`. |
| `@signalglass/providers` | existing | `openai-compatible` adapter gains the **stream decoder**: `decodeSseFrame(frame) → StreamEvent \| null` — provider-specific interpretation of frame `data` (chunk/usage/done/error JSON). Provider shapes never leak past this layer. |
| `@signalglass/streaming` | **proposed new workspace package** | Transport framing and canonical assembly, network-free and provider-agnostic: `sse.ts` (byte → frame parser), `assembler.ts` (frame/event/lifecycle inputs → canonical record; the state machine; terminalization; status mapping), `types.ts` (closed unions, §10). Depends only on `@signalglass/evidence`. |
| `@signalglass/evidence` | existing | Canonical types, validators, serialization, completeness derivation. **Unchanged** except for the proposed additive `responseMeta` field (§3.4) in the implementation slice. |
| `@signalglass/storage` | existing | `EvidenceStorage` (Spec 015) — the only persistence path. Unchanged. |
| `@signalglass/core` | existing | Legacy domain model, projections (`evidenceToLegacyTrace`, `evidenceToAgentRun`), divergence detection (§7.3). Unchanged. |

### 9.2 Boundary rules

- `@signalglass/streaming` contains **no HTTP, no sockets, no persistence,
  and no provider-JSON decoding**; it consumes `SseFrame` + lifecycle inputs
  and produces the record and completeness summary.
- `@signalglass/providers` contains the OpenAI-compatible decoding **only**;
  it produces the closed `StreamEvent` union (§10) and never touches bytes,
  persistence, or the client socket.
- `apps/ingress` wires the layers: it feeds transport bytes to the parser,
  injects the provider decoder into the assembler, owns backpressure and
  cancellation, and calls `EvidenceStorage` at terminalization.
- No layer imports `@signalglass/storage` except `apps/ingress`'s wiring;
  no layer imports `@signalglass/providers` except `apps/ingress` (and the
  streaming decoder type contract).
- OpenAI-compatible shapes must not become the internal model (AGENTS.md,
  Spec 013 §3.2): the canonical record's normalized envelope fields are the
  internal model; `providerNative` is preserved at declared fidelity only
  when a capture profile retains it (not by default, §6).

### 9.3 Dependency direction

```text
@signalglass/evidence (leaf)
        ▲
@signalglass/streaming  ──(types)──▶ @signalglass/providers (decoder)
        ▲                                        ▲
        └────────────── apps/ingress ────────────┘
                            │
                            ▼
              @signalglass/storage (EvidenceStorage)
                            │
                            ▼
              @signalglass/core (projections, divergence)
```

`@signalglass/streaming` depends only on `@signalglass/evidence`;
`@signalglass/providers` depends on `@signalglass/streaming` types for
`SseFrame`/`StreamEvent` (in addition to its existing `@signalglass/core`
dependency); `apps/ingress` depends on all of the above and `@signalglass/
storage`.

---

## 10. Public contracts and versioning

**Decision 10 — closed discriminated unions for assembler input/state/
outcome, provider adapter output, and completeness summaries; internal
exports stay internal; contracts are versioned.**

### 10.1 Closed unions (proposed, not created)

```ts
/** Transport-byte layer output (parser). */
type SseFrame = { fieldLines: readonly { name: string; value: string }[]; data: string };

/** Provider adapter output — closed. */
type StreamEvent =
  | { kind: 'chunk'; choiceIndex: number; finishReason?: string; delta?: unknown; usage?: unknown }
  | { kind: 'usage'; usage: unknown }
  | { kind: 'done' }
  | { kind: 'error'; code: string }; // structural code only; never provider text

/** Assembler input — closed. */
type AssemblerInput =
  | { type: 'request-observed'; traceId: string; startedAt: string; model?: string; provider: string }
  | { type: 'response-headers'; statusCode: number; contentType?: string }
  | { type: 'stream-event'; event: StreamEvent }
  | { type: 'upstream-error'; code: string }            // transport/timeout/HTTP
  | { type: 'client-cancelled' }
  | { type: 'ingress-cancelled' }
  | { type: 'stream-eof' }
  | { type: 'malformed'; code: string }                 // §4.10 codes
  | { type: 'client-request-invalid'; code: string };   // §8.4

/** Assembler state — closed. */
type AssemblerState =
  | 'initialized' | 'request-observed' | 'dispatched' | 'streaming'
  | 'completed' | 'upstream-failed' | 'client-cancelled'
  | 'ingress-cancelled' | 'malformed-truncated' | 'finalized';

/** Assembler outcome — closed. */
type AssemblerOutcome =
  | { terminal: 'completed' | 'upstream-failed' | 'client-cancelled'
      | 'ingress-cancelled' | 'malformed-truncated';
      record: EvidenceRecord; summary: CompletenessSummary }
  | { terminal: 'aborted'; reason: string }; // only before any observation

/** Completeness summary — closed. */
type CompletenessSummary = {
  terminalReason: AssemblerOutcome['terminal'];
  observedFrames: number;
  droppedFrames: number;
  eventsByStatus: Record<EvidenceStatus, number>;
  seqGaps: readonly unknown[]; // empty by construction in this slice
  declaredLosses: readonly string[]; // fixed structural sentences (§5.4)
  boundaryStatement: string;
};
```

The assembler entry point is proposed as
`createStreamAssembler(options: AssemblerOptions): StreamAssembler` with
`observe(input: AssemblerInput)`, `state(): AssemblerState`, and
`finalize(): AssemblerOutcome`; the parser entry point is proposed as
`createSseParser(): { push(bytes: Uint8Array): SseFrame[]; eof(): void }`.
These names are proposals for the implementation slice, not created here.

### 10.2 Internal vs. public exports

- **Public:** the closed unions above, `createSseParser`, `createStreamAssembler`,
  and the assembler options (capture profile, excerpt cap, idle timeout, frame
  cap). Public types are explicit and domain-focused (AGENTS.md code style).
- **Internal:** the parser's buffering internals, the assembler's transition
  table, status-mapping helpers, and boundary-statement composition. They are
  not exported from the package index; tests exercise them through the public
  surface.

### 10.3 Versioning

- `evidenceSchemaVersion` remains `1.0.0` (the assembler produces records the
  existing validator accepts; it introduces no schema change).
- The assembler records its capture profile `signalglass.collection.ingress-
  metadata-safe` v1.0.0 on the trace (`captureProfile`, Spec 013 §9.2) and
  records the assembler algorithm version (`ASSEMBLER_ALGORITHM_VERSION`,
  v1.0.0) in the boundary statement, so assembled evidence stays
  interpretable without the current build.
- The proposed additive `responseMeta` envelope field follows Spec 013 §10
  additive-evolution rules: optional, default-absent, older readers tolerant;
  the `metadata-safe` conformance table gains the field's classification
  (bounded structural metadata: `statusCode` integer, `contentType` label).
- Public contract changes (union member changes, entry-point signature
  changes) are breaking changes: they bump the `@signalglass/streaming`
  package version and the assembler contract version, with documented
  compatibility consequences; the evidence schema itself is untouched.
- Persistence-policy and storage-format versions are owned by Spec 015 and
  are unchanged by this spec.

---

## 11. Data flow

```text
Client / Agent Tool
  │  POST /v1/chat/completions  {stream:true}
  ▼
apps/ingress (streamHandler)
  │ 1. request observed → identity + interaction_start (seq 0)
  │ 2. body parsed, model routed, API key resolved (env only)
  │ 3. upstream dispatch (Accept-Encoding: identity; auth from env)
  ▼
Upstream provider
  │  2xx text/event-stream (or error)
  ▼
apps/ingress passthrough (byte/order transparent, backpressured)
  │  │
  │  ├─▶ client (identical bytes; x-signalglass-trace-id header)
  │  │
  │  └─▶ @signalglass/streaming parser  (transport bytes → SseFrame)
  │          └─▶ @signalglass/providers decoder (SseFrame → StreamEvent)
  │                  └─▶ @signalglass/streaming assembler
  │                        (seq assignment, canonical events,
  │                         status mapping, state machine)
  ▼
terminalization (completed | upstream-failed | client-cancelled |
                 ingress-cancelled | malformed-truncated)
  │
  ▼
finalized record → @signalglass/evidence validation (parseEvidenceRecord)
  │
  ▼
@signalglass/storage EvidenceStorage.saveEvidenceRecord (exactly once)
  │         │
  │         ├─ stored / already-present / conflict / … (observable, §13)
  │         └─ never affects client traffic
  ▼
legacy coexistence (optional): legacy Trace emit + projection parity check
```

Key invariants of the flow:

- The client response path and the evidence path are **separate tees** of the
  same bytes; evidence processing never feeds back into the response path.
- Assembly is incremental (events sequenced as frames arrive) but **persisted
  only at terminalization** (§1).
- Every terminal path reaches `finalized` and the single save; every save
  outcome is surfaced.

---

## 12. Privacy and diagnostic rules

- **API keys:** referenced by environment-variable name only
  (`apiKeyEnv`); resolved at runtime; used only for upstream dispatch;
  never stored, logged, or included in evidence (Spec 006, provider-config,
  unchanged).
- **Client credentials:** the inbound `Authorization` header and any client
  key are never stored, logged, or echoed. `x-api-key`, `cookie`, and
  `proxy-authorization` headers from either direction are never retained.
- **No raw payloads by default:** full request bodies, full chunk deltas,
  and provider error bodies are not collected by default (§6); only bounded
  truncated excerpts and structural metadata are.
- **Response metadata:** only `statusCode` and `content-type` are recorded
  (§3.4); no header values, no `set-cookie`.
- **Diagnostic text is structural:** error codes come from the closed set
  (§4.10, §8.2) and messages are fixed and bounded; no provider content, no
  identity, no header values, no secret material ever appears in error
  events, boundary statements, or logs. Sentinel tests enforce this (§16).
- **Storage-safety gate:** every save runs the mandatory non-bypassable gate
  (Spec 015 S1/S2/S3/S5/S6); default records carry no retained bytes, so S6
  never fires by default; any richer record remains fully subject to the
  gate and the `metadata-safe` policy.
- **Storage-safe results:** save outcomes and refusal reasons are
  leak-free (Spec 015), and the assembler never logs rejected values.
- **Compliance note:** live ingress observes traffic the operator has
  permission to proxy (unchanged from Spec 006/docs/privacy.md).

---

## 13. Persistence interaction

- **Single save at terminalization** through `EvidenceStorage.
  saveEvidenceRecord(record)`; the record passed is the validated
  `parseEvidenceRecord` output (§14 §16 requirement), exactly once.
- **Outcomes are observable, never rewritten into the record:** `stored`,
  `already-present`, `conflict`, `invalid`, `unsupported-version`,
  `safety-rejected`, `policy-rejected`, `policy-failed`, `clock-failed`, and
  the `EvidenceContentionError` (Spec 015) are surfaced through the emit
  callback and logs with the interaction identity and the outcome; the
  finalized record and its status are not modified by the outcome.
- **Storage admission:** the default records are policy-admissible by
  construction (§6.2). A `safety-rejected`/`policy-rejected` outcome on a
  default record indicates a configuration or code defect and is surfaced
  loudly (it should not be reachable from default assembly).
- **Conflicts:** identity is fresh per observed request (§2.1), so
  same-identity conflicts are not expected from the assembler; the Spec 015
  contract handles them defensively and the outcome is surfaced.
- **Failure isolation:** storage failures never alter client traffic
  (§7.4); the save runs after the response path is finalized (§1.2).
- **Legacy storage:** when dual emission is enabled, the legacy trace is
  emitted through the existing `TraceStorage` path with the same isolation
  guarantees; canonical writes never touch legacy rows (Spec 015
  coexistence).

---

## 14. Declared losses and crash limitations

| Loss | Declaration | Where |
|---|---|---|
| Mid-stream process crash before terminalization | No record exists for the interaction; nothing is fabricated | `docs/ingress.md`, `docs/roadmap.md` (#40); stated in this spec §1.3 |
| Full request bodies / full delta text by default | `truncated` excerpts; full content declared `missing` | Record statuses + boundary statement (§5) |
| Provider error bodies | Never retained; only the structural code + fixed message | Error events (§8.2) |
| Usage / finish reason not reported by the provider | Declared absent; never zero, never fabricated | Boundary statement (§5.3) |
| Frames after a terminal observation | Not read; disclosed in the boundary statement (no `seq` gap exists) | Boundary statement (§5.4) |
| Malformed frames | Structural code only; bytes and values never retained | Error events + boundary statement (§5.4) |
| Response headers beyond status/content-type | Not retained | §3.4, §12 |
| Byte-fidelity (`byte_faithful`) retention | Not implemented; `structurally_faithful` default | §3, Non-goals |
| Crash after `stored` | Durable per Spec 015 (WAL, transactional save) | Spec 015 |

---

## 15. Implementation slices

Recommended additive sequence **after acceptance** (each slice independently
reviewable, testable, and mergeable; none changes legacy ingress, storage, or
production consumers until the wiring slice):

1. **Contracts and the SSE frame parser.** `@signalglass/streaming` package
   scaffolding (workspace), the closed unions (`SseFrame`, `StreamEvent`,
   `AssemblerInput`, `AssemblerState`, `AssemblerOutcome`,
   `CompletenessSummary`), the incremental byte→frame parser (all line
   endings, comments, multiline data, split frames, split UTF-8, frame cap),
   and contract tests (byte-level, no network).
2. **Assembler core.** The state machine, `seq` assignment, canonical event
   mapping (including the usage placement matrix §4.4 and finish-reason
   placement §4.5), status mapping (§5), terminalization matrix (§4.6–§4.10),
   terminal precedence (§8.3), boundary-statement composition, and the
   `parseEvidenceRecord` gate on finalize.
3. **Ingress wiring and transparency.** `streamHandler.ts`: request
   observation and identity, upstream dispatch (`Accept-Encoding: identity`,
   idle timeout), passthrough with backpressure, cancellation propagation,
   response header allowlist, `x-signalglass-trace-id`, pre-stream
   rejections, and the additive `responseMeta` field (with the
   `metadata-safe` conformance-table update).
4. **Persistence and legacy coexistence.** Single save at terminalization,
   outcome surfacing, dual emission, divergence detection via
   `evidenceToLegacyTrace` parity, shared-file coexistence with
   `TraceStorage`, and failure-isolation tests.
5. **Documentation and completion evidence.** Update `docs/ingress.md`,
   `docs/architecture.md` (package map), `docs/trace-model.md`,
   `docs/privacy.md`, `docs/capture-profiles.md` (the new collection profile),
   `docs/model-versioning.md` (assembler/contract versioning and the additive
   `responseMeta`), `docs/glossary.md` (streaming terms), the roadmap, and
   the spec index; mark the spec Implemented only when all acceptance
   criteria pass.

## 16. Testing and conformance requirements

Implementation tests MUST use Vitest with fixed fixtures and **sentinel
markers** (no secrets, no real keys, no raw payloads in fixtures). Required
groups (named; mapped to acceptance criteria in §18):

**SSE parsing (bytes → frames)**
1. `SSE parser: frame splitting across every TCP chunk boundary` — a stream
   split at every byte position yields identical frames.
2. `SSE parser: CRLF, LF, and CR line endings` — all three accepted; the
   forwarded stream is untouched (byte transparency asserted separately).
3. `SSE parser: comments and blank lines` — `:` comment lines and blank
   separators are parsed and never surface as events.
4. `SSE parser: multiline data joined with \n` — concatenation rule.
5. `SSE parser: event:, id:, and retry: fields` — parsed and non-retained.
6. `SSE parser: split UTF-8 sequences across frames` — multi-byte sequences
   split at chunk boundaries decode correctly.
7. `SSE parser: [DONE] detection` — exact-value terminal marker.
8. `SSE parser: malformed JSON data field` — `null` decode → terminalization
   input; bytes never echoed.
9. `SSE parser: invalid UTF-8 data value` — malformed classification.
10. `SSE parser: oversized frame cap` — bounded loss, never unbounded
    buffering.

**Assembly (frames/events → canonical events)**
11. `Assembler: full-stream canonical sequence` — `interaction_start` →
    `span_start` → `model_request` → chunks → usage → finish → `span_end` →
    `interaction_end` with the documented seq order.
12. `Assembler: seq contiguity and uniqueness` — strictly increasing,
    contiguous, single sequencing surface.
13. `Assembler: identity determinism` — `traceId == interactionId`, opaque,
    not content-derived; `eventId`/`observationId` unique; `chunkIndex` from
    the parsed choice index, never the transport counter.
14. `Assembler: usage-before-finish chunk` — `model_usage` at its observed
    position.
15. `Assembler: usage-after-finish before [DONE]` — `model_usage` after the
    finish chunk.
16. `Assembler: usage-only terminal chunk` — `model_usage`, then `[DONE]`
    completion.
17. `Assembler: finish reason captured from the carrying chunk, never
    fabricated` — absent reason → declared, not invented.
18. `Assembler: no fabricated usage or zeros` — absent usage → no
    `model_usage`, no `0`; captured zero stays `0` (distinct).
19. `Assembler: [DONE] without usage completes` — normal termination without
    fabricated accounting.
20. `Assembler: [DONE] without finish reason completes` — absence declared.

**Terminalization and the state machine**
21. `Terminal: EOF without [DONE] → malformed-truncated` — failed trace,
    structural error code, boundary statement declares the truncation.
22. `Terminal: upstream HTTP error → upstream-failed` — actor `model`, role
    `provider_reported`; provider body never retained.
23. `Terminal: connect/timeout/TLS failure → upstream-failed` — actor
    `model`, role `unobservable`.
24. `Terminal: non-SSE 2xx response to a streaming request` — bytes forwarded
    unchanged, terminal `upstream-failed` with `non_sse_response`.
25. `Terminal: client disconnect mid-stream → client-cancelled` —
    `requestedBy: "client"`; frames after the terminal are not read and are
    disclosed.
26. `Terminal: ingress cancellation → ingress-cancelled` — `requestedBy:
    "ingress"` (shutdown path).
27. `Terminal: precedence (EOF vs [DONE], cancel vs upstream-failure)` —
    first observed terminal wins; losing observation disclosed.
28. `State machine: illegal transitions rejected` — closed transition table
    (no double terminal, no post-terminal events).
29. `Terminal: pre-dispatch rejections` — invalid body / no route / missing
    key → failed record with the declared actor (`agent`/`capture`) and the
    unchanged Spec 006 error envelope; no content echoed.
30. `Terminal: no wall-clock completion` — a stream that stalls never becomes
    `completed`; only an observed terminal marker completes (Spec 014 §4.7).

**Evidence status and losses**
31. `Evidence status: closed-vocabulary mapping for every assembled payload`
    — each payload's status from the §5.1 table.
32. `Evidence status: declared losses for every mapping` — boundary statement
    contains the fixed structural loss sentences; no invented content.
33. `Evidence status: statuses never collapse to null or omission` — absent
    usage/finish are declared, not `null`; captured `0` is distinct from
    absent.
34. `Evidence: finalize output passes parseEvidenceRecord` — derived trace,
    analysis, and completeness agree (§5.8 contract).

**Transparency and backpressure**
35. `Transparency: forwarded bytes identical to upstream bytes` — byte-for-
    byte and order-identical passthrough (including line endings, comments,
    and `[DONE]`), asserted with sentinel frame content.
36. `Transparency: no silent frame mutation` — no injection, removal,
    reorder, or rewrite ever; a mid-stream failure closes the connection
    without a synthetic frame.
37. `Backpressure: slow client pauses upstream read` — pause/resume observed
    via a controllable stream (no eager full-stream buffering).
38. `Backpressure: fast client at upstream speed` — throughput without
    artificial delay.
39. `Transparency: error paths` — pre-stream rejections and the normalized
    upstream error envelope are the only generated responses (Spec 006
    behavior preserved).

**Persistence**
40. `Persistence: exactly one save at terminalization` — one
    `saveEvidenceRecord` per interaction, at terminalization, never before.
41. `Persistence: save outcomes surfaced` — stored / already-present /
    conflict / invalid / unsupported-version / safety-rejected /
    policy-rejected / clock-failed and contention are observable; the record
    is not rewritten.
42. `Persistence: storage failure never alters client traffic` — a throwing
    or rejecting storage adapter leaves the client response identical.
43. `Persistence: crash mid-stream leaves no record` — an abort before
    terminalization produces no row; the declared loss is documented (no
    placeholder, no fabricated completion).
44. `Persistence: default records are policy-admissible` — every default
    assembly passes the Spec 015 gate and `metadata-safe` policy.
45. `Persistence: conflict/idempotency behavior` — repeat or conflicting
    same-identity saves behave per Spec 015 (already-present / conflict).

**Privacy**
46. `Privacy: secrets never in outputs` — sentinel keys/headers/patterns
    never appear in records, reports, error events, boundary statements,
    logs, or projection views (byte-aware assertions; no JSON-stringify
    heuristics).
47. `Privacy: no raw payloads persisted by default` — full bodies, deltas,
    and provider error bodies absent from default records; only declared
    excerpts.
48. `Privacy: response headers bounded` — only `statusCode`/`content-type`;
    `set-cookie` and header values never retained.
49. `Privacy: storage-safe outcomes` — refusal codes and messages leak
    nothing (Spec 015).

**Legacy coexistence**
50. `Legacy: dual emission` — canonical + legacy trace for one interaction,
    both derived from the same observed stream.
51. `Legacy: divergence detection` — a deliberately divergent legacy trace is
    flagged; the canonical record is authoritative; nothing is silently
    reconciled.
52. `Legacy: client-traffic failure impact` — legacy and canonical storage
    failures never affect the client response.

**Boundaries, contracts, versioning**
53. `Packages: boundary compliance` — compile-time checks that
    `@signalglass/streaming` imports no network/persistence/provider-JSON
    code and that provider shapes never leak into the canonical record.
54. `Contracts: closed unions` — assembler input/state/outcome, stream
    events, and completeness summaries are closed discriminated unions
    (unknown members rejected at compile time and runtime).
55. `Contracts: internal exports stay internal` — package index exposes only
    the public surface.
56. `Versioning: capture profile and assembler version recorded` —
    `captureProfile` and `ASSEMBLER_ALGORITHM_VERSION` on every record;
    `evidenceSchemaVersion` unchanged.
57. `Versioning: additive responseMeta conformance` — the additive envelope
    field is admitted by `metadata-safe` and round-trips under Spec 013 §10
    rules (older-reader tolerance).

## 17. Acceptance criteria

- [ ] A streaming interaction is assembled into exactly one canonical
  `EvidenceRecord` and saved **exactly once** at terminalization through
  `EvidenceStorage.saveEvidenceRecord`; no checkpointing, no partial saves,
  no revisions or upserts.
- [ ] A process crash before terminalization leaves **no persisted record**
  and the crash limitation is declared in the docs; nothing is fabricated to
  fill the gap.
- [ ] `traceId == interactionId` is assigned when the request is first
  observed; identity is opaque and never derived from content; each observed
  request produces exactly one record with a fresh identity.
- [ ] Every canonical event carries a strictly increasing, contiguous `seq`
  assigned by the single sequencing surface (the assembler) at observation;
  timestamps and content hashes never order or identify; frames that fail to
  parse produce no `seq` and are disclosed, never guessed.
- [ ] `chunkIndex` is the parsed choice index (or the deterministic ordinal
  within a choice), never the transport frame counter.
- [ ] The forwarded stream is byte- and order-identical to the upstream
  stream, with backpressure; the ingress performs no frame mutation of any
  kind; the only generated responses are the Spec 006 pre-stream rejections
  and the normalized upstream error envelope.
- [ ] The four observation layers (transport bytes / SSE frames / parsed
  stream events / canonical events and record) are strictly separated with
  documented contracts.
- [ ] The SSE parser handles comments, blank lines, multiline `data` values,
  CRLF/LF/CR, frames split across TCP chunks, split UTF-8 sequences, the
  `[DONE]` marker, and bounded frame sizes.
- [ ] The usage placement matrix (usage-before/after finish, usage-only
  terminal chunk, absent usage) and finish-reason placement are deterministic
  and tested; no usage or finish reason is fabricated.
- [ ] The terminalization matrix (EOF without `[DONE]`, HTTP error,
  connect/timeout, non-SSE response, client disconnect, ingress
  cancellation, malformed frames, pre-dispatch rejections) maps every input
  to exactly one terminal reason and one canonical terminal event.
- [ ] The error/cancellation state machine is closed; the first observed
  terminal transition wins; illegal transitions are rejected; the terminal
  event is the record's final applicable `seq` (Spec 014 §4.7).
- [ ] Every assembled payload carries exactly one closed evidence status;
  statuses never collapse into `null`; `completed` requires an observed
  `[DONE]`; captured zeros are distinct from absent values.
- [ ] Default collection is metadata-safe (`signalglass.collection.ingress-
  metadata-safe` v1.0.0): structural metadata plus bounded truncated
  excerpts; full bodies, deltas, and provider error bodies are not collected
  by default.
- [ ] Default records are policy-admissible: they pass the Spec 015
  storage-safety gate and the `metadata-safe` persistence policy by
  construction.
- [ ] API keys are environment-variable-only; inbound client credentials and
  sensitive headers are never stored, logged, or echoed; only
  `statusCode`/`content-type` response metadata is retained (additive
  `responseMeta`, Spec 013 §10 additive rules).
- [ ] `error` events declare actor, `lifecycleTarget`, `lifecycleEffect`, and
  the observation role; error text is fixed, bounded, structural, and
  secret-free; provider error bodies are not retained.
- [ ] Save outcomes (including refusal, policy rejection, and contention) are
  observable and never rewrite the record; storage failures never alter
  client traffic.
- [ ] Legacy coexistence: dual emission is allowed; the canonical record is
  authoritative; divergence between the legacy trace and the canonical
  projection is detected and surfaced, never silently reconciled.
- [ ] Package boundaries hold: network in `apps/ingress`, provider decoding
  in `@signalglass/providers`, canonical evidence in `@signalglass/evidence`,
  persistence in `@signalglass/storage`, projections in `@signalglass/core`,
  with the new `@signalglass/streaming` package depending only on
  `@signalglass/evidence`; no provider shape becomes the internal model.
- [ ] Public contracts are closed discriminated unions (assembler
  input/state/outcome, `StreamEvent`, `CompletenessSummary`); internal
  helpers are not exported from the package index.
- [ ] Contract versioning is explicit: `captureProfile` and
  `ASSEMBLER_ALGORITHM_VERSION` recorded on every record;
  `evidenceSchemaVersion` unchanged; the additive `responseMeta` follows the
  documented additive-evolution rules.
- [ ] The assembled record passes `parseEvidenceRecord` before the save;
  derived trace, analysis, and completeness agree with the deterministic
  derivations.
- [ ] Pre-dispatch request failures (invalid body, no route, missing key,
  body over limit) produce honest failed records with the declared actor and
  no echoed content, and the client receives the unchanged Spec 006 error
  envelope.
- [ ] Sentinel tests prove secrets, keys, headers, and raw payloads never
  appear in records, reports, projections, error events, boundary
  statements, or logs.

## 18. Criterion-to-test mapping

All 24 acceptance criteria are covered by the named groups in §16 (the
groups are the implementation PR's `describe`-level names):

| Criterion | Test groups |
|---|---|
| 1 (single save) | 40, 41 |
| 2 (crash limitation) | 43 |
| 3 (identity) | 13, 3 (determinism), 29 |
| 4 (seq ordering) | 12, 33, 34 |
| 5 (chunkIndex) | 13 |
| 6 (transparency) | 35, 36, 39 |
| 7 (layers) | 53, 7, 1–10 |
| 8 (SSE parser matrix) | 1–10 |
| 9 (usage/finish matrix) | 14–20 |
| 10 (terminalization matrix) | 21–27, 29, 30 |
| 11 (state machine) | 27, 28 |
| 12 (evidence status) | 31–33 |
| 13 (metadata-safe collection) | 44, 47 |
| 14 (policy-admissible defaults) | 44 |
| 15 (secrets/headers) | 46, 48 |
| 16 (error events) | 22–26, 29, 49 |
| 17 (outcomes, failure isolation) | 41, 42, 45 |
| 18 (legacy coexistence) | 50–52 |
| 19 (package boundaries) | 53, 54 |
| 20 (closed unions) | 54 |
| 21 (contract versioning) | 55–57 |
| 22 (record validation) | 34 |
| 23 (pre-dispatch rejections) | 29 |
| 24 (sentinel privacy) | 46, 48, 49 |

## 19. Open questions

Core behavior is decided above; the following are **narrow** and do not block
acceptance of the decided contract:

1. **Exact `responseMeta` field shape.** The mechanism (an additive optional
   envelope field carrying `statusCode` + `contentType`, Spec 013 §10 rules)
   is decided; the exact field name and serialized shape are finalized in the
   implementation slice.
2. **SSE parser error-code strings.** The closed structural codes (§4.10)
   are decided in kind; the exact string values are finalized in the
   implementation slice (they are storage-safe by construction).
3. **Default excerpt cap tuning.** The 240-character default matches the
   legacy `maxExcerptLength`; whether a shorter default is preferable for
   canonical records is a tuning decision for the implementation slice, not a
   contract change.

## 20. Documentation impact

When the spec is accepted and implemented, these docs update (this Draft PR
changes only the spec index and the roadmap):

- `docs/architecture.md` — package map gains `@signalglass/streaming` and the
  stream-decoder responsibility in `@signalglass/providers`.
- `docs/ingress.md` — streaming mode, passthrough/backpressure semantics, the
  terminalization matrix, the crash limitation, and the canonical save path.
- `docs/trace-model.md` — streaming response event refinement is delivered;
  legacy `Trace` reframed as a compatibility projection for streaming.
- `docs/privacy.md` — streaming capture defaults (metadata-safe, bounded
  excerpts, response metadata allowlist, secret-free diagnostics).
- `docs/capture-profiles.md` — the `signalglass.collection.ingress-metadata-
  safe` v1.0.0 profile.
- `docs/model-versioning.md` — assembler/contract versioning and the additive
  `responseMeta` extension.
- `docs/glossary.md` — streaming terms (SSE frame, terminalization, terminal
  reason, passthrough, backpressure, dual emission, completeness summary).
- `docs/roadmap.md` and `specs/000-index.md` — status and slice registration.

## 21. References

- `AGENTS.md`
- [`docs/architectural-foundation.md`](../docs/architectural-foundation.md)
- [`docs/architecture.md`](../docs/architecture.md)
- [`docs/ingress.md`](../docs/ingress.md)
- [`docs/trace-model.md`](../docs/trace-model.md)
- [`docs/privacy.md`](../docs/privacy.md)
- [`docs/capture-profiles.md`](../docs/capture-profiles.md)
- [`docs/model-versioning.md`](../docs/model-versioning.md)
- [`docs/glossary.md`](../docs/glossary.md)
- [`docs/roadmap.md`](../docs/roadmap.md)
- [`specs/000-index.md`](000-index.md)
- [`specs/006-ingress-openai-compatible.md`](006-ingress-openai-compatible.md)
- [`specs/013-evidence-model.md`](013-evidence-model.md)
- [`specs/014-evidence-primitives.md`](014-evidence-primitives.md)
- [`specs/015-append-only-evidence-store.md`](015-append-only-evidence-store.md)
