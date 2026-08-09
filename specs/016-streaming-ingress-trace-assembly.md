# Spec 016: Streaming ingress and trace assembly

## Status

**Draft — revision 4 (third architectural correction pass).** Proposed for
acceptance; **implementation is prohibited until this spec is Accepted**. No
runtime code is produced by this PR. The proposed modules, contracts, and
constants below are named but **not created** until an accepted
implementation slice.

Revision 4 resolves the revision-3 review blockers, which all concerned
contracts that normalized away missing or unobservable facts:

1. **The EvidenceRecord authority model is preserved**: a new authoritative
   additive 1.1 source, `captureBoundary.streaming`, carries the minimal
   recorded streaming boundary facts; `completeness.lifecycle`,
   `completeness.declaredLosses`, and `boundaryStatement` are deterministic
   **derivations** recomputed by `deriveCompleteness` and verified at parse —
   derived completeness is never independently authoritative (§13.4).
2. **Upstream transport and client-facing response delivery are modeled
   separately** with closed vocabularies (`UpstreamOutcome`,
   `ClientResponseOutcome`) and a complete cross-field validity matrix
   (§2, §12).
3. **Excerpt statuses are honest**: `truncated` only when characters were
   actually removed, `redacted` only when content was actually masked,
   `captured` when the retained representation is complete at the declared
   boundary — and the `metadata-safe` v1.1.0 policy explicitly admits
   bounded, detector-scanned captured content (§8, §14).
4. **Remainder semantics corrected**: a four-value `RemainderKnowledge`,
   defined trailing-after-`[DONE]` behavior, the loss rename to
   `remainder-after-observation-detach-not-observed`, a 1-based frame
   position, and an exact `rawForwardedBytes` basis (§12, §6).
5. **The implemented Spec 015 persistence contract is matched exactly**:
   `policy-crash` removed (policy exceptions are `policy-failed` /
   `reason: 'exception'` `SaveOutcome`s); `PersistenceObservation` retains
   the full typed `SaveOutcome`; internal results are separated from
   leak-free log projections (§16).
6. **Schema-version coupling is tightened** with conditional validation:
   the presence of `captureBoundary.streaming` identifies a streaming
   record; 1.1-owned fields on a 1.0.0 record are rejected; required 1.1
   fields when the streaming identity is present; the field count is
   corrected to six serialized fields (§13).
7. **The metadata-only `model_response` envelope is fully specified**
   (§6.6, §13.3).
8. **All claims, counts, and mappings are updated** (100 test groups ↔ 44
   acceptance criteria, many-to-many).

This spec is forecast-only in `docs/roadmap.md` (anticipated PR #23,
documentation-only; the implementation slices are a later, accepted
implementation PR).

## Purpose

Define how the OpenAI-compatible ingress ([Spec 006](006-ingress-openai-compatible.md))
observes a **streaming** chat-completions interaction and assembles **one
canonical `EvidenceRecord`** ([Spec 013](013-evidence-model.md),
[Spec 014](014-evidence-primitives.md)) from the observed pipeline — client
request → upstream dispatch → response headers → ordered SSE chunks → usage →
finish reason → `[DONE]` → errors/cancellation — with the streaming boundary
facts recorded **authoritatively** under `captureBoundary.streaming`, their
lifecycle/loss derivations recomputed into completeness, and persistence
exactly once after the client response path finishes, through the append-only
evidence store ([Spec 015](015-append-only-evidence-store.md)).

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
| [Spec 014](014-evidence-primitives.md) | The authority model this spec must preserve: `rawObservations` and `captureBoundary` authoritative; `trace`, `analysis`, `completeness` deterministic derivations; `deriveCompleteness(trace, analysis, captureBoundary)` the completeness source; parsing compares serialized derivatives against recomputed derivatives (§13.4). `ResponseEnvelope.chunkIndex` semantics are refined additively (§13). |
| [Spec 015](015-append-only-evidence-store.md) | `EvidenceStorage.saveEvidenceRecord` — the only persistence path; `SaveOutcome` (a closed status union **without** `contention`; `policy-failed` with `reason: 'exception'` for caught policy exceptions); exhaustion throws `EvidenceContentionError`; the `metadata-safe` reference policy and its versioning contract (§14); the storage-safety gate is non-bypassable. |
| [`docs/ingress.md`](../docs/ingress.md) | Current non-streaming live-mode data flow; Spec 016's implementation updates it. |
| [`docs/trace-model.md`](../docs/trace-model.md) | "Streaming response event refinement" is listed as future work; the legacy `Trace` path becomes a compatibility projection with divergence detection (Spec 016 §19.4, §21.11). |
| [`docs/privacy.md`](../docs/privacy.md) | Default capture/persistence boundaries the assembler must honor (metadata-safe defaults, env-var-only keys, no raw payloads by default). |
| [`docs/roadmap.md`](../docs/roadmap.md) | Streaming milestone; slice #23 (this spec); slice #40 (reliability/recovery — crash-recovery journaling is deferred to it). |

## Scope

Define, for a **streaming** OpenAI-compatible interaction observed by
`apps/ingress`:

1. The two lifecycles — client passthrough and evidence observation — and
   their separation (Spec 016 §1).
2. The upstream transport and the client-facing response delivery modeled
   as independent outcomes with a complete cross-field validity matrix
   (Spec 016 §2).
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
8. Collection vs. persistence policy boundaries, including the honest
   excerpt-status semantics and the collection-time privacy process
   (Spec 016 §8).
9. The error taxonomy: closed code vocabularies and the closed
   `error`/`cancelled` event shapes (actor / lifecycleTarget /
   lifecycleEffect; `requestedBy`), with one classification per terminal
   (Spec 016 §9).
10. The deterministic terminal state machine and the single terminal-event
    sequence (Spec 016 §10).
11. Package boundaries and the proposed module layout (Spec 016 §11).
12. Public contracts: provider-boundary output types, closed vocabularies,
    and the completeness summary (Spec 016 §12).
13. The canonical schema extension: additive `evidenceSchemaVersion` 1.1.0,
    the authoritative `captureBoundary.streaming` source, the derived
    lifecycle/loss fields, conditional 1.0/1.1 validation, and the exact
    metadata-only `model_response` envelope (Spec 016 §13).
14. Persistence-policy versioning: `metadata-safe` v1.1.0 (Spec 016 §14).
15. The structured assembler-version location (Spec 016 §15).
16. Persistence outcomes: the exact `SaveOutcome` observation vs. leak-free
    environmental failures (Spec 016 §16).

The spec also defines the data flow (§17), observability and reporting
(§18), documentation and privacy commitments including the honest
crash/no-record declaration and the preserved legacy coexistence (§19), the
phased implementation sequence (§20), the testing and conformance
requirements (§21), acceptance criteria (§22), the criterion-to-test mapping
(§23), deferred work (§24), open questions (§25 — none), and references
(§26).

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
| **Transport lifecycle** | The lifecycle that owns the client socket and the upstream connection: request received → response forwarded → ended; its end is recorded as the two independent upstream and client-response outcomes (§1.2, §2). |
| **Observation lifecycle** | The evidence-assembly lifecycle: the assembler's state machine (§1.3, §10). Observer failures degrade it; they never end the transport lifecycle. |
| **Observation terminal** | The terminal state of the observation lifecycle — one of the seven `TerminalReason` values (§10). |
| **Upstream outcome** | The end state of the upstream connection/response — one of the four `UpstreamOutcome` values (§2.1). |
| **Client-response outcome** | The end state of the client-facing ingress response — one of the four `ClientResponseOutcome` values (§2.2). |
| **Remainder knowledge** | What the observer knows about the stream tail after the terminal — one of the four `RemainderKnowledge` values (§12.4). |
| **Authoritative fact** | A recorded input: `rawObservations` and `captureBoundary` (incl. `captureBoundary.streaming`). Trusted after validation; never recomputed (§13.4). |
| **Derived fact** | A deterministic recomputation: `trace`, `analysis`, `completeness` (incl. `lifecycle`, `declaredLosses`, `boundaryStatement`). Verified at parse against recomputation (§13.4). |
| **Sequencing surface** | The single capture component that assigns `seq` at observation time (Spec 013 §2.2). In this spec it is the assembler (§4). |
| **Observer failure** | Any failure of the parsing/decoding/assembly machinery (exception, configured bound exceeded, unsupported encoding, decode failure) — distinguished from malformed provider protocol (§1.4). |
| **Malformed provider protocol** | The provider's stream violates the observed protocol (invalid JSON/UTF-8 in data, invalid or duplicate choice index, EOF/partial frame without `[DONE]`) — a provider-side observation, not an observer failure (§1.4). |
| **Observation detachment** | The explicit degraded state after an observer failure: canonical extraction stops; the transport passthrough continues unaffected; the record finalizes with status `unknown` (§1.4, §10). |
| **SSE frame** | One server-sent-event block: field lines terminated by a blank line. The parser's output unit (§5, §6). |
| **Transport byte** | The raw upstream response-body bytes observed at the ingress boundary, exactly as read from the socket (no decoding, no decompression). Never mutated by the ingress (§5). |
| **Parsed stream event** | A provider-neutral normalized event from the decoder's frame result: `chunk` / `usage` / `provider-error` (§6, §12). |
| **Canonical event** | An `EventRecord` (Spec 013 §3.1) the assembler derives from parsed stream events and lifecycle signals. |
| **Response-metadata event** | The single canonical `model_response` event emitted when response headers are observed, before any chunk/usage/error, carrying `responseMeta` (§6.7, §13.3). |
| **Terminal marker** | The `[DONE]` data frame that signals normal protocol termination. |
| **Terminal reason** | One of the closed `TerminalReason` values (§10, §12). |
| **Passthrough** | Forwarding the upstream response-body bytes to the client with content and order preserved (§5). |
| **Backpressure** | Slowing or pausing the upstream read when the client cannot consume (§5). |
| **Dual emission** | Emitting both the canonical record (Spec 015) and the legacy `Trace` (Spec 007 path) for one interaction (§9). |
| **Divergence detection** | Comparing the canonical record's legacy projection with the independently emitted legacy trace (§9). |
| **Completeness summary** | The assembler-level accounting of what was observed, dropped, and declared (§12.5); its persisted projection is the derived `completeness` (§13.4). |
| **Capture profile** | The named, versioned bundle of collection settings recorded on the trace (`captureProfile`, Spec 013 §9). |
| **Declared content** | Content admitted under an owning `redacted`/`truncated` declaration (Spec 015 `metadata-safe`). |
| **Bounded captured content** | Content admitted as `captured` (complete at the declared boundary) under the explicit `metadata-safe` v1.1.0 rule — bounded by the configured cap and passed through the versioned sensitive detector (§8.5, §14). |
| **Retained excerpt** | The bounded representation of content the collection process retains: normalized text, an honest owning status, and the owning declarations (§8). |
| **Save outcome** | The structured `SaveOutcome` returned by `saveEvidenceRecord` (Spec 015) — never includes contention (§16). |
| **Environmental failure** | A persistence failure that is not a `SaveOutcome`: thrown `EvidenceContentionError` or storage-layer exceptions caught by this slice, reduced to a closed leak-free code (§16). |

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

**The transport lifecycle spans two independent systems — the upstream
connection and the client-facing ingress response.** Their end states are
observed separately and recorded separately (§2): the upstream outcome and
the client-response outcome are independent facts with their own closed
vocabularies, and the cross-field validity matrix forbids impossible pairs.

### 1.2 Transport lifecycle

States:

```text
awaiting-response → forwarding → ended
```

The transport lifecycle's end is **not one reason but two independent
outcomes** (§2): the **upstream outcome** (how the upstream connection/body
ended: `not-started` / `response-completed` / `connection-failed` /
`stream-ended-prematurely`) and the **client-response outcome** (how the
client-facing ingress response ended: `not-started` / `flushed` /
`closed-before-completion` / `local-error-flushed`). Only four client-impact
situations can stop forwarding, and each is recorded as the appropriate pair
(§2.5): the upstream body fully read and flushed (`response-completed` +
`flushed`); the client socket closes mid-stream (`client-cancelled` +
`closed-before-completion`); ingress shutdown or a configured ingress limit
forces cancellation (`ingress-cancelled` + `closed-before-completion`);
upstream connection error, timeout, or premature EOF (`stream-ended-prematurely`
+ `closed-before-completion`). The four-value end-reason vocabulary of the
revision-3 draft (`TransportEndReason` / `DeliveryOutcome`) is **removed** —
it could not represent pre-dispatch paths and conflated two independent
systems.

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
`observation-detached`. The observation terminal, the upstream outcome, and
the client-response outcome are **independent**: any may occur first, none
rewrites another, and persistence waits for the client-response end (§3.2).

### 1.4 Malformed provider protocol vs. internal observer failure

Two failure classes are distinguished with different trace statuses, actors,
roles, and completeness:

| Class | Examples | Trace status | Terminal event | Actor / lifecycle targeting | Completeness |
|---|---|---|---|---|---|
| **Malformed provider protocol** | `data` value is not valid JSON; invalid UTF-8 in a data value; non-integer/negative/duplicate choice index; EOF or partial frame without `[DONE]` | `failed` | `error` — the record's **final** event (Spec 014 §4.7: no `interaction_end` after a terminal declaration) | actor `model`; `lifecycleTarget: "trace"`, `lifecycleEffect: "fail"`; observationRole `provider_reported` (the provider's stream was observed to violate the protocol) | Declares the malformed frame and the unobserved remainder |
| **Unrecognized provider extension** (valid JSON, unknown shape) | A frame that decodes to no recognized chunk/usage/error/done shape | Unaffected (not terminal) | None | — | Declared loss `unrecognized-extension-frame`; observation **continues** |
| **Internal observer failure** | Parser/decoder/assembler exception; frame-overflow observation bound; unsupported content-encoding; decoder-tee decode failure | `unknown` | Informational `error` (actor `capture`, `lifecycleTarget: "none"`, `lifecycleEffect: "none"`) — the record's **final** event; no `interaction_end` | actor `capture`; observationRole `unobservable` | Declares observation detachment and the unknown remainder |

Rules:

- **An unrecognized extension is not a provider failure.** A successfully
  forwarded interaction is never labeled a model failure merely because
  SignalGlass could not decode an extension. The frame is a declared loss
  (`unrecognized-extension-frame`) and canonical extraction continues with
  the next frame.
- **A malformed provider protocol frame is a provider-side observation**:
  the provider's stream is observed to violate the protocol. The canonical
  record terminalizes `malformed-stream` (trace `failed`, actor `model`,
  `lifecycleTarget: "trace"`, `lifecycleEffect: "fail"`, observationRole
  `provider_reported`); the `error` event is the record's **final** event
  (no `interaction_end` after it — Spec 014 §4.7). The **client still
  receives the frame bytes unchanged** — protocol classification is an
  observation decision, not a transport decision.
- **An internal observer failure detaches observation** (§1.5): canonical
  extraction stops, the record finalizes with status `unknown` (the
  termination could not be observed — Spec 014 §4.7), and an informational
  `error` event (actor `capture`, `lifecycleTarget: "none"`,
  `lifecycleEffect: "none"`, observationRole `unobservable`) makes the
  failure visible without declaring the interaction failed; it is the
  record's **final** event and no `interaction_end` is fabricated. The
  transport passthrough is untouched.

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
   (§12.5): `observationDetached: true`, the last observed frame position
   when known, `remainderObservation: 'unknown'`, and **no inferred frame
   count** for anything the observer could not see.
5. Persistence occurs only after the client response path has actually
   finished (§3.2, §16) — including after observation degradation.
---

## 2. Upstream transport and client-response delivery as independent outcomes

**Decision 2 — the upstream connection/body and the client-facing ingress
response are two different systems with two closed outcome vocabularies, a
complete cross-field validity matrix, and authoritative persistence under
`captureBoundary.streaming`. No impossible pair is allowed, and no upstream
failure is fabricated merely because no upstream request existed.**

### 2.1 Upstream outcome (the upstream connection/body)

```ts
type UpstreamOutcome =
  | 'not-started'               // no upstream dispatch occurred:
                                //   invalid request, missing API key, unroutable model, over-limit body
  | 'response-completed'        // upstream response body fully read (any status: 2xx SSE, non-SSE 2xx, HTTP error body)
  | 'connection-failed'         // connect/timeout/TLS failure before response headers were observed
  | 'stream-ended-prematurely'; // failure after the response started: mid-stream connection loss or premature EOF
```

- **`not-started` covers every pre-dispatch failure** — an invalid request
  never creates an upstream request, so no upstream failure is fabricated
  for it. (Revision 3's combined `TransportEndReason` could not represent
  this; it is now a first-class value.)
- `connection-failed` means the upstream never delivered response headers.
- `stream-ended-prematurely` means headers were observed and the body was
  cut short.

### 2.2 Client-response outcome (the client-facing ingress response)

```ts
type ClientResponseOutcome =
  | 'not-started'               // client disconnected before any response bytes were sent
  | 'flushed'                   // every forwarded byte was written and the response finished
  | 'closed-before-completion'  // the connection ended before completion was observed
  | 'local-error-flushed';      // the ingress flushed its own normalized error envelope (Spec 006)
```

- `flushed` means the ingress wrote every byte it received and observed
  response completion (`finish`). TCP delivery beyond the socket is not
  observable and is not claimed.
- `local-error-flushed` is the client-facing outcome for pre-dispatch and
  connect-failure paths where the ingress returns its own normalized error
  envelope (Spec 006 behavior): invalid request → 4xx, missing key →
  error, unroutable → 4xx, connect failure → 502.
- `not-started` is the outcome when the client disconnected before any
  response began.

### 2.3 Cross-field validity matrix (upstream × client-response)

| upstream \ clientResponse | `not-started` | `flushed` | `closed-before-completion` | `local-error-flushed` |
|---|---|---|---|---|
| `not-started` | ✓ client disconnected before any response (pre-dispatch) | ✗ | ✓ client disconnected while the local error was being written | ✓ **invalid request / missing key / unroutable → local 4xx/error flushed** |
| `response-completed` | ✓ client gone before any byte forwarded | ✓ **normal completion** | ✓ `[DONE]` parsed, then client closed before flush | ✗ |
| `connection-failed` | ✓ client gone during connect failure | ✗ | ✓ client disconnected while the 502 was being written | ✓ **connect failure → local 502 flushed** |
| `stream-ended-prematurely` | ✓ failed before any byte forwarded | ✗ | ✓ **mid-stream upstream failure after response bytes started** | ✗ |

Rules:

- **Impossible pairs are rejected**: a response marked `flushed` can never
  pair with `connection-failed`/`stream-ended-prematurely`/`not-started`
  (a flush that "completes" requires the upstream body to have completed);
  `local-error-flushed` never pairs with `response-completed` or
  `stream-ended-prematurely` (a completed/prematurely-ended upstream body is
  forwarded, never replaced by a local error).
- **No fabricated upstream failure**: paths that never dispatched
  (`not-started` upstream) are exactly the pre-dispatch failures; they are
  never described as upstream failures.
- The matrix is enforced by validation: a `captureBoundary.streaming` whose
  pair is invalid fails parse (§13.4). Tests cover every cell (§21 T91).

### 2.4 Authoritative persistence: `captureBoundary.streaming`

Both outcomes, the observation terminal, the remainder knowledge, the loss
facts, and the assembler identity are recorded **authoritatively** in the
additive 1.1 field `captureBoundary.streaming` (§13.4):

```ts
captureBoundary.streaming = {
  observationTerminal: TerminalReason;
  upstream: { outcome: UpstreamOutcome };
  clientResponse: { outcome: ClientResponseOutcome };
  remainder: {
    knowledge: RemainderKnowledge;              // §12.4
    lastObservedFramePosition?: number;         // 1-based (§12.3)
    rawForwardedBytes?: number;                 // basis defined in §12.3
  };
  losses: { /* closed fact set, §7.3/§13.4 */ };
  assembly: { /* §15 */ };
};
```

The derived `completeness.lifecycle` and `completeness.declaredLosses` are
recomputed from this authoritative source by `deriveCompleteness` and
verified at parse (§13.4). There is **one authority per fact** — the
authoritative input is trusted after validation; the derived copies are
recomputed and compared, never independently authoritative.

### 2.5 Scenarios and required tests

| Scenario | observationTerminal | upstream.outcome | clientResponse.outcome |
|---|---|---|---|
| Invalid request, local 4xx flushed | `request-failed` | `not-started` | `local-error-flushed` |
| Missing API key, local error flushed | `request-failed` | `not-started` | `local-error-flushed` |
| Connect failure, local 502 flushed | `upstream-failed` | `connection-failed` | `local-error-flushed` |
| Mid-stream upstream failure after bytes started | `upstream-failed` (or `observation-detached`) | `stream-ended-prematurely` | `closed-before-completion` |
| Client disconnect before response headers | `client-cancelled` | `connection-failed` | `not-started` |
| `[DONE]` parsed, then client close before flush | `completed` | `response-completed` | `closed-before-completion` |
| Normal completion | `completed` | `response-completed` | `flushed` |
| Malformed observation, passthrough still completes | `malformed-stream` | `response-completed` | `flushed` |

Tests: T49 (invalid 4xx), T50 (missing key), T51 (502), T52 (mid-stream
failure), T53 (disconnect before headers), T46 (`[DONE]` then close), T91
(validity matrix). The observation terminal and the two outcomes are
recorded independently and never rewrite each other.

---

## 3. Assembly and persistence boundary

**Decision 3 — one canonical record, one save, after the client response
path finishes; no checkpointing or revisions; the crash limitation is
declared honestly.**

### 3.1 Single canonical save

- Each observed streaming interaction produces **exactly one**
  `EvidenceRecord` (§17 data flow), assembled in memory across the whole
  stream.
- The record is handed to persistence **exactly once**, after the
  client-response path has ended (§3.2), through the only permitted
  persistence path: `EvidenceStorage.saveEvidenceRecord(record)` (Spec 015).
- There is **no checkpointing**: no partial records, no in-progress writes,
  no revisions, no upserts, no periodic snapshots. The append-only contract
  of Spec 015 is unchanged; the assembler adds no second write path.
- An interaction that reaches a terminal observation state always produces a
  record — including failures, cancellations, and detached observations
  (status `unknown`). The `status` vocabulary
  (`completed` / `failed` / `cancelled` / `unknown`) is never invented; it is
  derived from the observation terminal per §10.3.

### 3.2 Persistence timing: after the response path finishes

- **Observation terminal and client-response completion are separate.**
  The assembler reaches its terminal observation state when the terminal
  event is observed (e.g. `[DONE]` may be parsed — and canonical completion
  determined — before the final bytes have flushed to the client).
- The **save waits until the client-response path has ended** (`finish`/
  `close`), not until the observation terminal:
  - a synchronous Spec 015 save MUST NOT occur in the forwarding/backpressure
    data path;
  - the save runs once, after the client-response end, on the
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
  ingress limit), so it ends the client-response path via
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

- The implementation must prove byte transparency by test (§21 T60–T61):
  for every encoded/plain scenario, the bytes written to the client are
  exactly the bytes read from the upstream (header construction excepted).

---

## 6. SSE parsing, multi-choice normalization, and terminalization

**Decision 6 — the parser and decoder produce ordered, provider-neutral,
frame-level results; one frame expands to zero or more canonical events in
deterministic order; choice identity and chunk ordinal are distinct;
duplicate choice indexes in one frame are rejected; unmapped delta fields are
declared losses; the terminalization matrix is closed; trailing content after
`[DONE]` is forwarded, never canonicalized, and honestly accounted.**

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
  contract. The canonical text delta is retained; the structured sub-fields
  are not mapped into the canonical model by this slice.
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
| `completed` | `[DONE]` frame observed (first observed terminal wins) | `completed` | `span_end` (model span) then **`interaction_end`** — the record's final event |
| `upstream-failed` | Upstream HTTP error; connection error/timeout/TLS loss; non-SSE 2xx; provider error frame | `failed` | **`error`** (actor `model`, `lifecycleTarget: "trace"`, `lifecycleEffect: "fail"`) — the record's final event; no `interaction_end`; model span `unknown` |
| `client-cancelled` | Client disconnect mid-stream | `cancelled` | **`cancelled`** (requestedBy `client`, `lifecycleTarget: "trace"`, `lifecycleEffect: "cancel"`) — the record's final event; no `interaction_end`; model span `unknown` |
| `ingress-cancelled` | Ingress shutdown/limit cancellation (idle timeout included) | `cancelled` | **`cancelled`** (requestedBy `ingress`, `lifecycleTarget: "trace"`, `lifecycleEffect: "cancel"`) — the record's final event; no `interaction_end`; model span `unknown` |
| `malformed-stream` | `sse-invalid-data-json`, `sse-invalid-utf8`, `sse-invalid-choice-index`, `sse-partial-frame-at-eof`, `sse-eof-without-done` | `failed` | **`error`** (actor `model`, `lifecycleTarget: "trace"`, `lifecycleEffect: "fail"`, observationRole `provider_reported`) — the record's final event; no `interaction_end`; model span `unknown` |
| `request-failed` | Request rejected before dispatch (invalid/incomplete/over-limit/unroutable/key-unavailable) | `failed` | **`error`** (actor `capture`, `lifecycleTarget: "trace"`, `lifecycleEffect: "fail"`) — the record's final event; no `interaction_end`; no model span |
| `observation-detached` | Internal observer failure (no terminal event was observable) | `unknown` | Informational **`error`** (actor `capture`, `lifecycleTarget: "none"`, `lifecycleEffect: "none"`) — the record's final event; no `interaction_end`; model span `unknown` |

Terminal rules (Spec 014 §4.7):

- **The first observed terminal wins** within the observation lifecycle;
  the upstream outcome and the client-response outcome are recorded
  separately and independently (§2).
- **Terminal-event sequence** (§10.5): each terminal ends with **exactly one
  final canonical event** — `interaction_end` for `completed` only; the
  causal `error` (`lifecycleTarget: "trace"`, `lifecycleEffect: "fail"`) as
  the final event for `upstream-failed` / `malformed-stream` /
  `request-failed`; the `cancelled` declaration (`lifecycleTarget: "trace"`,
  `lifecycleEffect: "cancel"`) as the final event for `client-cancelled` /
  `ingress-cancelled`; the informational `error` (`lifecycleEffect: "none"`)
  as the final event for `observation-detached`. **Nothing follows the final
  event** — no `interaction_end` after a terminal declaration (Spec 014 §4.7
  rejects it as `terminal_declaration_not_final`), no second terminal event,
  no later chunk/usage, no double emission.
- On trace-level failure or cancellation the model span ends `unknown` —
  never `completed` by inference. No wall-clock "completion" is synthesized.
- **No terminalization by wall clock.** The assembler never finalizes
  "completed" because time passed; an undecidable stream ends as one of the
  other terminals or via ingress cancellation at a limit.

### 6.6 Trailing content after `[DONE]` (and after any terminal)

- **`[DONE]` proves the protocol terminal marker was observed — it does not
  prove transport EOF or the absence of trailing bytes.** Trailing bytes or
  frames after `[DONE]`:
  - **are still forwarded** — the passthrough never stops at `[DONE]`;
    `[DONE]` is an observation concept, not a transport concept;
  - **never create canonical events** — after the observation terminal, the
    assembler accepts no canonical input; nothing is sequenced after the
    terminal event, and the final canonical event (per §10.5) is emitted at
    terminalization, never followed by content events;
  - **are parsed for structural accounting** — the parser MAY continue
    framing after the terminal so the observer can state honestly whether
    trailing frames existed (feeding `losses.postTerminalContentNotRetained`
    and `observedFrames`); canonicalization never resumes. (Where framing is
    impossible — unsupported encoding, decode failure — the facts are
    recorded as unobserved, not invented.)
  - **are declared as not retained** — `post-terminal-content-not-retained`
    (§7.3) is declared when content after the observation terminal was
    observed or could not be excluded; trailing bytes are **never called
    nonexistent merely because `[DONE]` was seen** — the remainder knowledge
    (§12.4) records exactly what was observed.
- The same rules apply after any terminal that precedes the transport end
  (e.g. content after a malformed frame, or after observation detachment).

### 6.7 Response-metadata event (`model_response`)

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
  (`upstream.outcome: 'connection-failed'`, `request-failed`) have **no**
  status and **no** `model_response`.
- The metadata-only `model_response` envelope's complete canonical shape is
  specified in §13.3.
---

## 7. Evidence status vocabulary and loss mapping

**Decision 7 — every assembled payload carries a closed-set evidence status
that describes the transformation actually applied; declared losses are
closed codes derived from authoritative boundary facts and persisted through
the derived `completeness.declaredLosses`; absence is declared, zeros are
never fabricated, and statuses never collapse to `null`.**

### 7.1 Evidence statuses (Spec 013 §4 / Spec 014 §5) — honest assignment

`EvidenceStatus = 'captured' | 'redacted' | 'truncated' | 'missing' | 'unknown' | 'not_applicable'`
(closed, from `@signalglass/evidence`). Assignment rules — **each status
describes the transformation actually applied to the retained representation**:

| Status | Assigned only when |
|---|---|
| `truncated` | The retained representation is **shorter than the post-redaction candidate** — characters were actually removed by the length boundary. |
| `redacted` | Content was **actually masked or omitted by redaction** (a sensitive span matched the versioned detector). |
| `captured` | The retained representation is **complete at the declared boundary** — every character of the (post-redaction) content is present. |
| `missing` | The value is genuinely absent (per Spec 013 §4.1). |
| `unknown` / `not_applicable` | Not determinable / not applicable at the declared boundary (per Spec 013 §4.1; e.g. the detached stream tail). |

- **Benign content shorter than the cap is `captured`, not `truncated`.**
  Applying the length boundary to content that fits within it removes
  nothing; declaring `truncated` would declare a loss that did not occur.
  The revision-3 rule ("`truncated` whenever the boundary is applied") is
  revoked.
- `truncated` and `redacted` carry the owning
  `TruncationDeclaration`/`RedactionDeclaration` on the raw observation
  payload (Spec 013 §2.2.12, §5.8; projection rows E2L-078..080). Declaration
  lengths must agree with the actual transformation (`maxLength` /
  `originalLength` reflect real character counts).
- **Loss codes follow the same honesty rule**: `message-content-not-retained`
  and `delta-content-not-retained` are declared **only when content was
  actually not retained** (the candidate exceeded the cap, or no excerpt was
  retained); fully retained benign content produces no such loss.
- Per-kind rules:
  - **Control events** (`interaction_start`, `interaction_end`,
    `span_start`, `span_end`): `captured` (metadata only).
  - **Request messages**: benign content ≤ cap → `captured`; content > cap →
    `truncated`; masked spans → `redacted`.
  - **Chunk deltas**: same rule (benign ≤ cap → `captured`; > cap →
    `truncated`; masked → `redacted`).
  - **Usage**: provider-reported values → field-level `captured` on each
    `UsageValue` (§13.6); captured zero is a real observation
    (`inputTokens: { value: 0, evidenceStatus: 'captured' }`), distinct from
    absence (no usage event, no fields).
  - **Provider error / transport errors**: `captured` (structural text only,
    §8.4).
  - **Empty content** (e.g. an empty message string or an empty delta):
    `captured` — the empty representation is complete at the declared
    boundary; nothing was removed.
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

### 7.3 Declared-loss codes (closed; persisted as the derived completeness field)

`declaredLosses` is a `readonly DeclaredLossCode[]` — a **closed code list**,
**derived** by `deriveCompleteness` from the authoritative
`captureBoundary.streaming.losses` facts (+ the canonical events/trace),
serialized at `EvidenceRecord.completeness.declaredLosses` (§13.4),
validated (unknown codes are refused), deterministically ordered
(deduplicated, ordered by the table below), and classified by the
`metadata-safe` v1.1.0 policy (§14). **`boundaryStatement` is derived from
these codes and is never the only persisted loss record.**

| Code | Meaning (derived display sentence) | Derived from |
|---|---|---|
| `request-body-not-retained` | The full request body was not retained. | `losses.fullRequestBodyRetained === false` |
| `message-content-not-retained` | Request message content beyond the retained representation was not retained. | `losses.messagesContentRetained === true && any message truncated` (events) |
| `delta-content-not-retained` | Chunk delta content beyond the retained representation was not retained. | `losses.deltaContentRetained === true && any delta truncated` (events) |
| `unmapped-delta-fields` | Content-delta sub-fields not represented by the canonical text delta (role, tool_calls, refusal, audio, multimodal, future extensions) were not retained. | `losses.unmappedDeltaFields.length > 0` |
| `provider-native-not-retained` | The provider-native payload was not retained. | `losses.providerNativeRetained === false` |
| `provider-error-body-not-retained` | The provider error frame's raw body was not retained. | `losses.providerErrorBodyRetained === false` |
| `provider-usage-absent` | The provider reported no usage. | no `model_usage` event observed |
| `finish-reason-absent` | The stream ended without a finish reason. | no chunk envelope carried `finishReason` |
| `unrecognized-provider-field` | Provider JSON fields not mapped to the canonical model (including per-choice nested usage) were not retained. | `losses` / decoder facts |
| `unrecognized-extension-frame` | A frame that decoded to no recognized shape was not retained. | `losses.unrecognizedExtensionFrameObserved === true` |
| `remainder-after-observation-detach-not-observed` | Content after observation detached was not observed or retained. | `observationTerminal === 'observation-detached'` |
| `remainder-after-client-cancellation` | The stream remainder after client cancellation was not retained. | `observationTerminal === 'client-cancelled'` (or `clientResponse.outcome === 'closed-before-completion'` with client cancellation) |
| `remainder-after-ingress-cancellation` | The stream remainder after ingress cancellation was not retained. | `observationTerminal === 'ingress-cancelled'` |
| `post-terminal-content-not-retained` | Content after the observation terminal was not retained. | `losses.postTerminalContentNotRetained === true` (§6.6) |
| `response-header-values-not-retained` | Upstream response header values outside the allowlist were not retained. | `losses.headerValuesBeyondAllowlist === true` |
| `content-type-parameters-not-retained` | Media-type parameters were dropped from the retained `content-type`. | `losses.contentTypeParametersDropped === true` |
| `wire-bytes-not-retained` | Transport bytes were not retained (only excerpts and metadata). | `losses.wireBytesRetained === false` |
| `encoded-content-not-observed` | The encoded stream could not be decoded for observation. | `losses.contentEncodingUnsupported === true` |
| `original-content-masked` | Content matching the sensitive detector was masked at collection. | `losses.maskedContent === true` |

Notes:

- `crash-no-record` is **not** in this list and must never appear on a
  record: it is a system-level declaration for interactions that were never
  persisted (§19.2).
- The previous code `frame-after-observation-detach` is **renamed** to
  `remainder-after-observation-detach-not-observed`: unsupported encoding or
  parser detachment may make frame boundaries unknowable, so the code
  describes content (not frame counts) after detachment and states the
  honest not-observed status.
- Deterministic derivation: order = table order above; deduplication = each
  code at most once; derivation = from `captureBoundary.streaming.losses`
  facts + canonical events, never a static list and never copied from the
  boundary statement.

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
persistence policy still run, non-bypassably, on every save. Benign content
that fits the cap is `captured` under an explicit new `metadata-safe` v1.1.0
rule. The default claim is "expected admissible, rejection still possible",
never "rejection impossible".**

### 8.1 Default capture profile

- Default capture profile: `signalglass.collection.ingress-metadata-safe`,
  version `1.0.0`, recorded on the trace (`captureProfile`, Spec 013 §9).
  Collection policy (what is captured), persistence policy (what is stored —
  `metadata-safe` v1.1.0, §14), and export policy (out of scope here) are
  three independent policies.
- Default retained values per interaction:
  - structural metadata (routing, model, timing, ids, statuses, seq,
    authoritative streaming boundary facts, declared losses);
  - request messages and chunk deltas as **bounded retained representations**
    (default cap 240 characters; §8.3) with honest owning statuses: benign
    content that fits the cap is `captured`; shortened content is
    `truncated`; masked content is `redacted`;
  - provider-reported usage values, verbatim (as `UsageValue`s, §13.6);
  - normalized finish reasons;
  - structural error text (§8.4);
  - response metadata: `statusCode` + normalized `content-type`
    (+ `content-encoding` when present) via `responseMeta` on the
    `model_response` event (§13.3);
  - the completeness summary with derived lifecycle/loss fields.
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
4. **Retain with an honest status** — after masking, the length boundary is
   applied, and the owning status describes the transformation actually
   applied (§7.1):
   - `redacted` — a span was actually masked (`original-content-masked`);
   - `truncated` — characters were actually removed (retained length <
     post-redaction candidate length);
   - `captured` — the retained representation is complete at the declared
     boundary (benign content that fits the cap);
   the owning `RedactionDeclaration`/`TruncationDeclaration` (when present)
   records real lengths.
5. **Declare** — the loss codes and declarations are attached; the
   `metadata-safe` v1.1.0 classification then sees either declared content
   or bounded captured content that passed the detector (§8.5, §14).
6. **The gate still runs** — the Spec 015 storage-safety gate and the
   persistence policy are **non-bypassable** and run on every save,
   including saves of records produced by the collection pipeline.

### 8.3 Excerpt bounds (decided, not tuning-only)

- Default cap: **240 characters**.
- Valid configured range: **64–4096 characters**.
- The cap is the **maximum retained length**; content shorter than the cap is
  retained in full (status `captured`). Only content exceeding the cap is
  shortened (status `truncated`).
- Changing the default cap requires a **capture-profile version bump** (the
  profile is versioned and recorded per record, §15). The range and the
  version-bump rule are normative, so this is no longer an open question.

### 8.4 Structural error text

- Error payloads contain fixed, bounded, **structural** text: a closed error
  code (Spec 006 style), a bounded description (≤200 chars) built from
  structural facts, and no headers, no secrets, no raw provider error bodies.
  The provider's raw error body is declared lost
  (`provider-error-body-not-retained`).
- The description never embeds: request URLs with query strings, API keys,
  authorization values, cookies, or raw payload excerpts.

### 8.5 Bounded captured content and the v1.1.0 admission rule

- **Decision**: benign content that fits the cap and passed the versioned
  sensitive detector is retained as `captured` (complete at the declared
  boundary) and is admitted by an **explicit new `metadata-safe` v1.1.0
  rule**: *bounded captured content (≤ the configured cap) that passed the
  versioned sensitive detector is admissible as captured content.*
- **Why a new rule is required**: the v1.0.0 policy admits content-bearing
  fields only under an owning `redacted`/`truncated` declaration
  (`isDeclaredContent`); a `captured` content-bearing field is rejected by
  v1.0.0. The v1.1.0 rule makes the honest `captured` status admissible.
- **Privacy and admission consequences (explicit)**: a `captured` value is
  real content in the store — it is not hidden behind a redaction
  declaration, so the **versioned sensitive detector is the sole content
  protection** for the bounded captured text. Consequences:
  - the detector version is part of the capture profile and is recorded
    (§15);
  - the cap bounds the maximum retained text (≤ configured cap, default
    240);
  - a detector miss can reach the storage-safety gate; a rejection is
    surfaced as `safety-rejected` and is never auto-labeled a code defect
    (§8.6);
  - the admission is explicit and versioned — **Spec 015 v1.0.0 is not
    weakened and is never silently reinterpreted**; v1.0.0 remains the
    declared-only policy, and 1.1 records are rejected by v1.0.0 (§14.3).

### 8.6 The honest admission claim

- **Construction invariant (tested)**: default-profile records are expected
  to be policy-admissible under `metadata-safe` v1.1.0 — the collection
  pipeline is designed and tested so that no default record carries an
  S1/S2/S3/S5/S6 witness (sentinel tests §21 T65–T70: a credential beginning
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

## 9. Error taxonomy

**Decision 9 — diagnostics carry only closed codes and bounded structural
descriptions; every terminal is classified exactly once; the
`error`/`cancelled` event shapes are closed (actor / lifecycleTarget /
lifecycleEffect; `requestedBy`); request-key
failures are classified under `request-failed` (actor `capture`), not under
upstream failures.**

### 9.1 The `error` and `cancelled` event shapes (closed)

Terminal error/cancellation events carry the exact canonical shapes (Spec 013
§3.3, Spec 014 §4.7; `packages/evidence/src/types-event.ts`):

```ts
// error event (EventRecord with kind 'error')
{
  kind: 'error',
  actor: ErrorActor,                        // 'agent'|'model'|'tool'|'mcp'|'retrieval'|
                                            // 'context_provider'|'capture'  (closed)
  lifecycleTarget: 'trace' | 'span' | 'none',   // closed
  lifecycleEffect: 'fail' | 'cancel' | 'none',  // closed
  error: { type: string; message?: string },    // ErrorPayload (Spec 013 §3.3)
}

// cancelled event (EventRecord with kind 'cancelled')
{
  kind: 'cancelled',
  lifecycleTarget: 'trace' | 'span' | 'none',
  lifecycleEffect: 'cancel',
  cancellation: { requestedBy: string },        // 'client' | 'ingress'
}
```

- **`error.type` carries the closed error code** (§9.2); `error.message` is
  bounded structural text ≤ 200 chars (§8.4). The payload never contains:
  exception messages, stack traces, request URLs, identities, documents,
  digests, header values, or raw provider bodies (Spec 013 §4.4; §8.4).
  Diagnostics are leak-free by construction: **internal results may be
  rich; the persisted/logged projection carries only closed codes and
  bounded structural text** (§16.3).
- Error/cancelled events are payload-bearing, so they carry `evidenceStatus`
  (`captured` — structural metadata only) and an observationRole per the
  classification source: `provider_reported` for provider-side
  classifications (`upstream-failed`, `malformed-stream`); `unobservable`
  for observer failures (`observation-detached`); `application_constructed`
  for ingress-constructed classifications (`request-failed`).
- `lifecycleTarget: "trace"` requires `spanId: null`; `lifecycleTarget:
  "span"` requires the matching `spanId`; `lifecycleTarget: "none"`
  changes no status (Spec 014 §4.7, `terminal_declaration_not_final`).

### 9.2 Closed error-code vocabularies

```ts
type ClientRequestFailureCode =
  | 'invalid-request'          // 400-class: malformed body, invalid fields, unknown model, over-limit
  | 'missing-api-key'          // no API key env var configured
  | 'key-unavailable'          // key env var referenced but unset/unresolvable at dispatch
  | 'unroutable'               // no provider matches the requested model
  | 'body-read-failure';       // the request body could not be read

type UpstreamFailureCode =      // only when an upstream request was actually dispatched
  | 'connection-error'          // connect/timeout/TLS failure before headers
  | 'http-error-status';        // upstream responded with a non-2xx status

type MalformedStreamCode =
  | 'sse-invalid-data-json'     // data field is not valid JSON
  | 'sse-invalid-utf8'          // frame bytes are not valid UTF-8
  | 'sse-invalid-choice-index'  // choice.index negative/non-integer, or duplicated within a frame
  | 'sse-partial-frame-at-eof'  // stream ended inside a frame
  | 'sse-eof-without-done';     // stream ended cleanly without a [DONE] marker

type ObservationFailureCode =    // internal observer failures (detach, §1.4)
  | 'frame-overflow'             // frame exceeded the 16 MiB cap
  | 'observation-encoding-unsupported'
  | 'observation-decode-failure'
  | 'internal-capture-error';

type TerminalReason =
  | 'completed'
  | 'upstream-failed'
  | 'client-cancelled'
  | 'ingress-cancelled'
  | 'malformed-stream'
  | 'request-failed'
  | 'observation-detached';

type AbortReason =
  | 'client-disconnect'
  | 'ingress-shutdown'
  | 'idle-timeout'
  | 'observation-detached'
  | 'request-failed';
```

- **`key-unavailable` is classified exactly once, under `request-failed`,
  with actor `capture`** (the key could not be resolved at dispatch time —
  the request never left the ingress). It is **not** a member of
  `UpstreamFailureCode`, so it never triggers the `upstream-failed` mapping
  and never fabricates an upstream outcome. (A key that is present and valid
  but rejected by the provider is an upstream `http-error-status`.)
- `invalid-request` covers every 400-class rejection — including an
  over-limit body — because these are all ingress-side decisions about the
  request itself; the body is never dispatched upstream, so no upstream
  failure is fabricated for them (§2.1).
- `AbortReason` feeds the client-response path and the
  `cancelled`/`client-cancelled`/`ingress-cancelled` terminalization paths:
  `client-disconnect` → `requestedBy: 'client'`;
  `ingress-shutdown` / `idle-timeout` → `requestedBy: 'ingress'`;
  `observation-detached` / `request-failed` produce no `cancelled` event.
  It is a **derivation aid, not a persisted field** — the persisted facts
  are the upstream/client-response outcomes and the observation terminal
  (§2.4); the abort reason is never fabricated.

### 9.3 Classification matrix (one terminal, one classification)

| Observed situation | Terminal | Error/cancelled event (when emitted) | actor / lifecycleTarget / lifecycleEffect |
|---|---|---|---|
| `[DONE]` observed | `completed` | — (no error/cancelled event; `span_end` + `interaction_end` final) | — |
| Invalid request body, missing key, key-unavailable, unroutable, over-limit | `request-failed` | `error` (final) | `capture` / `trace` / `fail` |
| Upstream connect/timeout/TLS failure | `upstream-failed` | `error` (final) | `model` / `trace` / `fail` |
| Upstream non-2xx status | `upstream-failed` | `error` (final) | `model` / `trace` / `fail` |
| Non-SSE 2xx response | `upstream-failed` | `error` (final) | `model` / `trace` / `fail` |
| Provider error frame | `upstream-failed` | `error` (final) | `model` / `trace` / `fail` |
| Malformed stream (5 codes) | `malformed-stream` | `error` (final) | `model` / `trace` / `fail` |
| Client disconnect mid-stream | `client-cancelled` | `cancelled` (final; requestedBy `client`) | — / `trace` / `cancel` |
| Ingress shutdown / idle timeout | `ingress-cancelled` | `cancelled` (final; requestedBy `ingress`) | — / `trace` / `cancel` |
| Internal observer failure | `observation-detached` | informational `error` (final) | `capture` / `none` / `none` |

Every terminal appears in exactly one row; every classification maps to
exactly one terminal. The upstream outcome and client-response outcome are
then recorded independently per §2 and never rewritten by this matrix. Each
`error`/`cancelled` row is the record's **final canonical event** (Spec 014
§4.7: no `interaction_end` after a terminal declaration); `completed` is the
only terminal whose final event is `interaction_end`.

---

## 10. The observation state machine

**Decision 10 — the assembler is a single deterministic state machine over
the observation lifecycle; every terminal is reachable from defined states;
each terminal ends with exactly one final canonical event (`interaction_end`
only on `completed`; the causal `error`/`cancelled` declaration otherwise) —
nothing follows the final event (Spec 014 §4.7).**

### 10.1 States

```text
initial ──request accepted──▶ awaiting-response
                              │  headers observed → model_response event (§6.7)
                              ▼
                         observing-stream
                              │  [DONE] → completed
                              │  upstream error → upstream-failed
                              │  provider error frame → upstream-failed
                              │  malformed frame → malformed-stream
                              │  client disconnect → client-cancelled
                              │  ingress limit/shutdown → ingress-cancelled
                              │  observer failure → observation-detached
                              ▼
                       terminal (one of the seven)
```

States: `initial`, `awaiting-response`, `observing-stream`, and the seven
terminal states (§9.2). The client-response path and the observation
lifecycle advance independently; the observation machine never waits on the
client socket.

### 10.2 Transitions

| From | Event | To |
|---|---|---|
| `initial` | Request accepted, body read, dispatch begins | `awaiting-response` |
| `awaiting-response` | Response headers observed | `observing-stream` |
| `awaiting-response` | Pre-dispatch failure (invalid/missing key/key-unavailable/unroutable/body-read) | `request-failed` |
| `awaiting-response` | Upstream connection failure | `upstream-failed` |
| `awaiting-response` | Client disconnect | `client-cancelled` |
| `awaiting-response` | Ingress shutdown/idle timeout | `ingress-cancelled` |
| `observing-stream` | `[DONE]` observed | `completed` |
| `observing-stream` | Upstream HTTP error / non-SSE 2xx / provider error frame | `upstream-failed` |
| `observing-stream` | Malformed frame (5 codes) | `malformed-stream` |
| `observing-stream` | Client disconnect | `client-cancelled` |
| `observing-stream` | Ingress shutdown/idle timeout | `ingress-cancelled` |
| `observing-stream` | Observer failure (frame-overflow, encoding-unsupported, decode-failure, internal) | `observation-detached` |

- Every terminal is reachable from defined states; no terminal is reachable
  from `initial` (a request that is never accepted produces no record —
  nothing was observed, §3.1).
- The machine **never transitions out of a terminal state**: the terminal
event is the record's **final** canonical event (`interaction_end` for
`completed`; the `error`/`cancelled`/informational `error` declaration for
the other terminals, §10.4), and no canonical event is emitted after it
(trailing bytes are accounted structurally, §6.6).
- `observation-detached` from `observing-stream` means framing of the
  canonical stream stops; the passthrough continues (§1.4).

### 10.3 Status derivation (trace.status)

`trace.status` is **derived** from the observation terminal (§1.2), never
recorded independently and never invented:

| Terminal | `trace.status` |
|---|---|
| `completed` | `completed` |
| `upstream-failed` / `malformed-stream` / `request-failed` | `failed` |
| `client-cancelled` / `ingress-cancelled` | `cancelled` |
| `observation-detached` | `unknown` |

### 10.4 Terminal event emission

- **`completed`**: `span_end` (model span) is emitted when `[DONE]` is
  observed; `interaction_end` is emitted as the record's **final** event.
- **`upstream-failed` / `malformed-stream` / `request-failed`**: the causal
  `error` event (`actor` per §9.3, `lifecycleTarget: "trace"`,
  `lifecycleEffect: "fail"`) is emitted as the record's **final** event.
  **No `interaction_end`** — Spec 014 §4.7 requires the terminal
  declaration to be the record's final applicable event and rejects an
  `error` followed by `interaction_end` (`terminal_declaration_not_final`).
- **`client-cancelled` / `ingress-cancelled`**: the `cancelled` event
  (`lifecycleTarget: "trace"`, `lifecycleEffect: "cancel"`, `requestedBy:
  'client' | 'ingress'`) is emitted as the record's **final** event. **No
  `interaction_end`** (same §4.7 rule).
- **`observation-detached`**: an **informational** `error` event (actor
  `capture`, `lifecycleTarget: "none"`, `lifecycleEffect: "none"`,
  observationRole `unobservable`) is emitted — it describes what happened
  without claiming the provider failed — and is the record's **final**
  event; the trace derives `unknown`. **No `interaction_end`** is
  fabricated (a final `interaction_end` without a terminal declaration
  would derive `completed`, which detachment must never claim).
- **Nothing follows the final event** — identical in the state table, the
  event mapping, §6.5, acceptance criterion 15, and the tests.

### 10.5 Terminal-event sequence (tested invariant)

```text
completed:        ... last content/usage (seq n) → span_end (n+1) → interaction_end (n+2)   [final]
failed:           ... last content/usage (seq n) → error (n+1, trace/fail)                    [final]
cancelled:        ... last content/usage (seq n) → cancelled (n+1, trace/cancel)               [final]
observation-detached: ... last content (seq n) → informational error (n+1, none/none)          [final]
   ── no canonical events after the final event on any terminal ──
```

Tests assert: exactly one final event per terminal; `interaction_end` only
on `completed`; the terminal declaration is always the record's final event;
nothing follows the final event; no double emission and no fabricated
`interaction_end` (T27–T35, T44, T99–T100).

---

## 11. Proposed packages and module boundaries

**Decision 11 — the streaming implementation lands as a new network-free
`@signalglass/streaming` package plus a provider adapter in
`@signalglass/providers`; ingress wiring lands in `apps/ingress`; core
models stay provider-agnostic; no package exists until a later slice.**
(This is a docs-only spec: the modules are named and specified, **not
created**.)

```text
@signalglass/streaming (new, proposed; network-free)
  createSseParser()                 L2 SSE framing (incremental, bounded, [DONE]-aware)
  SseParserOptions / FrameResult
  assembleTrace()                   L4 canonical event assembly from decoded events (the single
                                    sequencing surface, Spec 013 §2.2)
  AssemblerOptions / AssemblyResult
  captureBoundary builder           authoritative streaming boundary facts (§13.4)
  remainder/disposition helpers     post-terminal accounting (§6.6, §12.4)
  evidence-status helpers           §7.1 honest status assignment
  (pure functions only; no sockets, no streams, no http, no storage)

@signalglass/providers (extended)
  decodeSseFrame(frame)             L3 provider-neutral normalized events (§6.2, §12.1)
  openai-sse decoder                the first adapter (contract name literal §15)
  StreamDecodedEvent                provider-neutral event union (§12.1)

apps/ingress (extended)
  POST /v1/chat/completions         existing Spec 006 route gains the streaming path
  streamingForwarder                passthrough pipeline: L1–L4 wiring, backpressure (§5)
  boundedDecoderTee                 encoded-stream observation tee (§5.5)
  ingressStreamingController        client-response orchestration (Spec 006 error envelope
                                    semantics preserved; pre-dispatch paths unchanged)

@signalglass/core (unchanged in this spec)
  AgentRun / Turn / ContextBlock     provider-agnostic internal model (never extended with
                                    provider shapes)
@signalglass/evidence (unchanged)
  deriveCompleteness, parseEvidenceRecord, vocabulary, serialize  (the parse-time
  verification surface for the authoritative-vs-derived model, §13.4)
@signalglass/storage (unchanged)
  EvidenceStorage.saveEvidenceRecord (Spec 015) — the only persistence path (§3.1, §16)
```

- **Dependency direction**: `@signalglass/streaming` depends only on
  `@signalglass/evidence` types and `@signalglass/core` types; it never
  imports providers, ingress, or storage. The ingress composes
  `@signalglass/streaming` + `@signalglass/providers` + `@signalglass/evidence`.
- **Why streaming is network-free**: SSE framing, decoding, assembly,
  boundary-fact construction, and evidence-status logic are pure functions;
  keeping them out of the ingress package keeps them unit-testable without
  sockets and keeps `@signalglass/core` provider-agnostic (AGENTS.md
  architecture boundaries).
---

## 12. The assembler and the honest completeness summary

**Decision 12 — the assembler is a pure function from decoded events and
authoritative boundary facts to canonical events plus the boundary facts;
frame positions are 1-based and only assigned to actually-observed frames;
raw-forwarded bytes count exactly what was written to the client socket;
the completeness summary states observed facts and an honest remainder
knowledge — never fabricated counts and never implied completion.**

### 12.1 The provider-neutral decoded event union (L3)

```ts
type StreamDecodedEvent =
  | { kind: 'chunk'; choiceIndex: number; chunkIndex: number; delta: string | null; finishReason?: string }
  | { kind: 'usage'; inputTokens?: number; outputTokens?: number; totalTokens?: number }   // canonical usage (frame-level)
  | { kind: 'provider-error'; code: string; description: string };                          // structural, §8.4

type FrameDecodeResult = /* §6.2 */;
```

- `chunk.delta` is the normalized text delta (`string`, or `null` when the
  chunk carries no content). No `usage` field exists on `chunk` — per-choice
  nested usage is discarded and declared `unrecognized-provider-field`
  (§6.3); frame-level usage is canonical.
- `usage` fields are optional at this layer; provider numbers become
  `UsageValue { value, evidenceStatus: 'captured', reason? }` at L4 (§13.6).
- `provider-error` carries only closed codes and bounded structural text
  (§8.4, §9.1).

### 12.2 Assembler contract

`assembleTrace({ traceId, interactionId, requestMeta, requestMessages,
decodedEvents, boundaryFacts, captureProfile })` produces:

- the canonical `AgentRun`-shaped trace (Spec 013): events in `seq` order
  with `interaction_start` at `0`, one `model_request`, one
  `model_response` (when headers were observed), zero-or-more
  `chunk`/`model_usage` events, the terminal event per §10.4, and exactly
  one final `interaction_end`;
- the authoritative `captureBoundary.streaming` facts (§13.4) — the
  assembler is the **only** writer of these facts;
- an `AssemblyResult { trace, boundary, warnings }` where warnings are
  informational only (they never alter outcomes).

- The assembler assigns `seq` (§4.3), `eventId`, `observationId`, per-choice
  `chunkIndex`, and the evidence statuses (§7.1). It applies retention
  (excerpting/masking) per the capture profile (§8.2). It never emits raw
  provider JSON except under the `providerNative` contract (§7.2).
- It is deterministic: identical inputs produce identical outputs (including
  loss codes and boundary statements).
- Idempotence: assembly is a pure function; re-running it with the same
  inputs does not duplicate events (the ingress persists once per
  interaction, §3.1).

### 12.3 Frame and byte accounting (honest numbers)

- `lastObservedFramePosition` — the 1-based position of the **last frame
  actually observed** by the parser (canonicalized or not). Only observed
  frames are counted; after observation detachment, positions are not
  assigned (framing may be impossible), so this number is simply absent
  (`undefined`) rather than guessed. It is recorded authoritatively in
  `captureBoundary.streaming.remainder` (§13.4) and surfaced in the
  completeness summary (§12.4).
- `rawForwardedBytes` — the number of response-body bytes actually written
  to the client response socket (excluding headers). Its basis is explicit:
  it is the count at the moment the client-response path ends; a write that
  was accepted by the socket but whose completion is unobservable counts
  only what the socket accepted. It is never derived from parse results and
  never used to infer frame counts.
- **No fabricated frame counts**: the spec never claims "the last N frames
  were lost" — the remainder vocabulary (§12.4) states knowledge honestly,
  and the loss codes describe content, not counts (§7.3).

### 12.4 Remainder knowledge (closed vocabulary)

```ts
type RemainderKnowledge =
  | 'protocol-terminal-observed'   // [DONE] (or terminal error frame) was observed; trailing bytes may still exist (§6.6)
  | 'transport-eof-observed'       // transport EOF was observed with no terminal marker
  | 'unknown'                      // transport ended without the observer knowing (detach, encoding, decode failure)
  | 'not-applicable';              // no upstream response existed (request-failed paths)
```

- `protocol-terminal-observed` and `transport-eof-observed` are distinct:
  `[DONE]` does not imply EOF, and EOF does not imply `[DONE]`.
- When the observer detached, the remainder is `unknown` — the spec does
  not call unobserved content "absent".
- The completeness summary (below) carries this knowledge plus the honest
  observed facts; the loss codes `remainder-after-observation-detach-not-observed`
  and `post-terminal-content-not-retained` (§7.3) are derived from it.

### 12.5 The completeness summary (derived, representation-honest)

The summary is a derived view — recomputed by `deriveCompleteness` and
verified at parse (§13.4); it is never an independently-authored document.
It contains **only facts the observer actually knows**. The summary is
assembler-level accounting; the **persisted derived projections** are
`TraceCompleteness`'s existing members (`eventsByStatus`, `seqGaps`,
`duplicatesDetected`, `boundaryStatement`) plus the additive
`completeness.lifecycle` and `completeness.declaredLosses` (§13.4) — the
assembler-internal fields below are never persisted verbatim:

```ts
CompletenessSummary (canonical 1.1 paths shown in bold):
  observedFrames: number                    // frames actually observed by the parser (L2), 1-based positions assigned
  retainedEvents: number                    // canonical events retained (L4) up to and including the terminal event
  observationDetached: boolean              // observation detached before the observation terminal could be determined
  lastObservedFramePosition?: number        // §12.3 (absent when detachment made positions unknowable)
  remainderObservation: RemainderKnowledge  // §12.4
  rawForwardedBytes?: number                // §12.3 — basis documented; optional (absent when the basis could not be established)
  boundaryStatement: string                 // derived, human-readable; length-bounded (≤ 200 chars)
```

- The revision-3 `unobservedFramesAfterDetach` counter is **removed**: it
  claimed to count what the observer could not see. Post-detachment content
  is expressed only through `remainderObservation` and the loss codes.
- `boundaryStatement` is **derived only** — generated from the observed
  facts and loss codes (e.g. `"Observation detached after frame 12; remainder
  unknown; 14 declared losses"`), never an independently authored narrative,
  and never the persisted loss record (§7.3). It stays ≤ 200 chars.
- `trace.assembly` (§15) records the assembler identity, decoder contract,
  and versions — the derivation pedigree of this summary.
---

## 13. The additive 1.1 schema and the authority model

**Decision 13 — the schema advances additively from 1.0.0 to 1.1.0 with six
new serialized fields; `captureBoundary.streaming` is the single
authoritative input holding streaming facts; `completeness.lifecycle`,
`completeness.declaredLosses`, and the summary are derived by
`deriveCompleteness` and verified at parse; `trace.assembly` records the
assembly pedigree; `responseMeta` and `choiceIndex` extend the existing
envelope; no 1.0.0 record is reinterpreted; no field is silently discarded
on downgrade.**

### 13.1 The six new serialized paths

| # | Serialized path (1.1) | Role | Owned by |
|---|---|---|---|
| 1 | `captureBoundary.streaming` | **authoritative input**: observation terminal, upstream/client-response outcomes, remainder knowledge, loss facts, assembly | assembler (the only writer) |
| 2 | `completeness.lifecycle` | derived view of the two lifecycles (§1.2, §2) | `deriveCompleteness` |
| 3 | `completeness.declaredLosses` | derived, closed loss-code list (§7.3) | `deriveCompleteness` |
| 4 | `trace.assembly` | assembly pedigree (literal names + versions, §15) | assembler |
| 5 | `events[].responseEnvelope.responseMeta` (on the `model_response` event) | upstream status + normalized content metadata (§13.3) | assembler |
| 6 | `events[].responseEnvelope.choiceIndex` (on chunk events) | normalized choice identity (§4.2, §13.5) | assembler |

Usage normalization (§13.6) is a **clarification** of existing 1.0.0 usage
shapes, not a new field. `evidenceSchemaVersion` advances 1.0.0 → 1.1.0
(additive: every 1.0.0 record remains valid and unchanged in meaning; §15).

### 13.2 The authority model (one authority per fact)

```text
authoritative input (validated at parse):
  captureBoundary.streaming                 ← assembler-written facts
  canonical events + trace fields           ← assembled from observed data

derived at parse (recomputed, compared, never trusted blindly):
  completeness.lifecycle                    ← deriveCompleteness(trace, analysis, captureBoundary)
  completeness.declaredLosses               ← deriveCompleteness(...)
  completeness summary + boundaryStatement  ← deriveCompleteness(...)

verification:
  parseEvidenceRecord recomputes deriveCompleteness and fails with
  completeness_disagrees_with_derivation if the stored derived fields
  disagree with the recomputation; captureBoundary is itself validated
  (closed vocabularies, cross-field matrix §2.3, version rules §15) and
  accepts only additive unknown keys.
```

- **Tampering with a derived field** (editing `completeness.declaredLosses`
  or `completeness.lifecycle` so it disagrees with the boundary facts) →
  parse fails with `completeness_disagrees_with_derivation`.
- **Tampering with an authoritative input** (editing
  `captureBoundary.streaming`) is caught only by the **cross-field
  validation** of the boundary facts themselves (closed vocabularies,
  impossible-pair rejection §2.3, version/literal-name rules §15) — it
  cannot be detected by comparing to a recomputation, because the boundary
  is the recomputation's input. The spec states this honestly: **one
  authority per fact**, and authoritative fields are protected by their own
  validation, not by derivation.
- No fact is recorded in two authoritative places; there is no "primary"
  and "mirror" copy of the same fact.

### 13.3 `model_response` and `responseMeta` (universal response-metadata home)

Canonical shape of the metadata-only `model_response` event — the
`EventRecord` shape of Spec 013/014 with the additive 1.1 field:

```ts
{
  eventId, traceId,
  spanId: <the model span's id>,          // event-level, non-null
  seq, kind: 'model_response', capturedAt,
  evidenceStatus: 'captured',             // event-level (metadata only)
  observationRole: 'provider_reported',   // event-level
  responseEnvelope: {
    providerNativeFidelity: 'structurally_faithful',
    // finishReason, providerNative, usage, chunkIndex, choiceIndex: ALL ABSENT here
    responseMeta: {                        // additive 1.1
      statusCode: number,                  // 100–599, required
      contentType?: string,                // normalized media type; parameters dropped
      contentEncoding?: string,            // single token when present
    },
  },
}
```

- `evidenceStatus` and `observationRole` are **event-level** fields
  (Spec 013/014 `EventCommon`), not envelope fields; the envelope itself
  carries only `providerNativeFidelity` + the additive `responseMeta`.
- Emitted **exactly once** when response headers are observed — the first
  response-derived event, before any chunk/usage/error event (§6.7). No
  duplication, and `responseMeta` never appears on chunk/usage/error
  envelopes.
- `observationRole` is additive: `'provider_reported'` for this
  metadata-only envelope (and, in later slices, `'ingress_observed'` /
  `'derived'` are reserved but not emitted by this slice).
- `statusCode` is validated 100–599; `contentType` is the normalized media
  type (parameters dropped → `content-type-parameters-not-retained`,
  §7.3); `contentEncoding` only when the upstream sent a single
  `content-encoding` token.
- **Header-less paths** (`request-failed`, `connection-failed`): no
  `model_response`, no status anywhere — `responseMeta` is not fabricated
  and the error envelope carries no status field (the draft's
  `upstreamStatus` is removed).
- Content-type header values other than `content-type`/`content-encoding`
  are excluded structurally (§5.1); the allowlist is validated per
  bounds (§13.4 validation).

### 13.4 `captureBoundary.streaming` — authoritative field (validated shape)

A streaming record also records the existing `captureBoundary` fields
(`captureSurface: 'ingress_proxy'`, `observationBoundary:
'provider_reported'` — Spec 013 §9); the streaming facts live under the
**additive** `captureBoundary.streaming` key, which parse accepts as an
additive key per Spec 014 §2.2.10.

```ts
captureBoundary.streaming = {
  observationTerminal: TerminalReason,                 // closed (§9.2)
  upstream:        { outcome: UpstreamOutcome },       // closed (§2.1)
  clientResponse:  { outcome: ClientResponseOutcome }, // closed (§2.2)
  remainder: {
    knowledge: RemainderKnowledge,                     // closed (§12.4)
    lastObservedFramePosition?: number,                // 1-based, only observed frames (§12.3)
    rawForwardedBytes?: number,                        // bytes accepted by the client socket (§12.3)
  },
  losses: {
    fullRequestBodyRetained: boolean;
    messagesContentRetained: boolean;
    deltaContentRetained: boolean;
    unmappedDeltaFields: readonly string[];            // bounded field-name list (≤ 8 entries, each ≤ 64 chars)
    providerNativeRetained: boolean;
    providerErrorBodyRetained: boolean;
    unrecognizedExtensionFrameObserved: boolean;
    postTerminalContentNotRetained: boolean;           // §6.6
    headerValuesBeyondAllowlist: boolean;
    contentTypeParametersDropped: boolean;
    wireBytesRetained: boolean;                        // default false (§8.1)
    contentEncodingUnsupported: boolean;
    maskedContent: boolean;
  },
  assembly: { /* §15.1 */ },
};
```

Parse-time validation (in addition to the field itself being additive):

- every vocabulary is closed and membership-checked (unknown value →
  parse failure);
- the upstream × clientResponse pair must satisfy the §2.3 matrix
  (impossible pairs rejected);
- `lastObservedFramePosition` ≥ 1; `rawForwardedBytes` ≥ 0 when present;
- `statusCode` 100–599; `contentType`/`contentEncoding` bounded
  (≤ 255 chars) and pattern-checked;
- `losses.unmappedDeltaFields` bounded as above;
- assembly fields validated per §15 (literal names, semver);
- unknown additive keys inside `captureBoundary.streaming` are accepted
  (forward compatibility) but never silently reinterpreted.

`deriveCompleteness` consumes these facts and the canonical events and
produces: `completeness.lifecycle`, `completeness.declaredLosses`, the
summary, and `boundaryStatement` — all verified at parse per §13.2.

### 13.5 `choiceIndex` on chunk envelopes

- Additive field on `payload.responseEnvelope.choiceIndex` (number ≥ 0) on
  chunk events only (§4.2). Absent on usage/error/`[DONE]`-derived events.
- Validated: non-negative integer; duplicate-within-frame is rejected at the
  decoder (§6.3), so no parse-time duplicate ambiguity remains.
- The existing `chunkIndex` semantics (per-choice content-chunk ordinal)
  are preserved; for single-choice streams they coincide (§4.2).

### 13.6 Usage normalization (clarification, not a new field)

- `UsageValue = { value?: number; evidenceStatus?: EvidenceStatus; reason?: string }`
  and `UsageRecord = { evidenceStatus; reason?; inputTokens?; outputTokens?;
  totalTokens? }` per Spec 013 §2.2.6/§4.1.
- Provider-reported numbers → `{ value: n, evidenceStatus: 'captured' }` per
  field. **Captured zero is a real observation**, distinct from absence
  (missing fields / no usage event).
- Partial usage = partial fields (`inputTokens` present, `outputTokens`
  absent — never zero-filled, never `null`).
- Per-choice nested usage is discarded and declared
  `unrecognized-provider-field`; frame-level usage is canonical (§6.3).
- Exact serialized-shape tests: T85 (§21).

### 13.7 1.0 → 1.1 compatibility

- A **1.0.0 record** (no streaming fields) parses under 1.1 with no change;
  its semantics are untouched. `SUPPORTED` schema versions for reading stay
  `1.0.0 | 1.1.0` (§15.3).
- A **1.1 record carrying a 1.1-owned field must not be silently
  reinterpreted by a 1.0 consumer**: when the deciding policy is 1.0.0 and
  a record carries 1.1-owned fields, the outcome is `policy-rejected`
  `unknown-additive-field` (§14.3) — never silent field-dropping. The
  parser selects its owned validation by the **declared**
  `evidenceSchemaVersion` (§15.2).
- Fixtures: the 1.1 fixture set (§21 T81) covers every 1.1 path in serialized
  form; round-trip tests cover all six fields.

---

## 14. Persistence policy and storage-safety alignment

**Decision 14 — the persistence policy advances additively to
`signalglass.persistence.metadata-safe` **v1.1.0** with an explicit rule
admitting bounded detector-scanned captured content; v1.0.0 stays
declared-only and unchanged; outcomes match the real Spec 015 API; the
decision version is recorded; unknown additive fields are refused on
downgrade, never reinterpreted.**

### 14.1 The v1.1.0 rules (additive over v1.0.0)

`signalglass.persistence.metadata-safe` v1.1.0 = v1.0.0 rules **plus**:

- **Rule 2 (new)**: bounded captured content is admissible — a
  content-bearing field with `evidenceStatus: 'captured'` is admitted when
  the retained length ≤ the configured cap (default 240, §8.3) **and** the
  value passed the versioned sensitive detector (v1.0.0 of
  `signalglass.collection.sensitive-detector`; version recorded §15.1).
- All v1.0.0 rules remain verbatim: structural exclusion, secret-scanning
  (S1/S2/S3 credential patterns), `isDeclaredContent` admission for
  `redacted`/`truncated` declared content, error/status-code thresholds,
  and the `metadata-safe` baseline (no raw payloads, no keys — Spec 015
  §5.3, §6.3).

### 14.2 Explicit added matrix rows (persistence-policy projection)

| Policy version | Record (schema) | Verdict |
|---|---|---|
| v1.1.0 | 1.1, bounded captured content, detector-passed | **admitted** (Rule 2) |
| v1.1.0 | 1.1, captured content ≤ cap, detector-miss | `safety-rejected` (gate) — surfaced, investigated as detector gap (§8.6) |
| v1.1.0 | 1.1, captured content > cap | `policy-rejected` (`truncated` required) |
| v1.1.0 | 1.1, declared content (`redacted`/`truncated`) | admitted (v1.0.0 rule) |
| v1.0.0 | 1.1 record carrying 1.1-owned fields | `policy-rejected` `unknown-additive-field` — never silently reinterpreted (§13.7) |
| v1.0.0 | 1.0 record | admitted as today (unchanged) |

### 14.3 Downgrade and unknown-additive-field

- A 1.1 record (carrying any of the six §13.1 fields) presented to a v1.0.0
  policy is refused with `policy-rejected` + `unknown-additive-field`.
  Reason: v1.0.0's admission set cannot attest the new fields; silently
  dropping them would change record meaning.
- The stored policy metadata records the **deciding version** (the policy
  version that admitted or rejected) alongside the record — so a later
  re-examination knows which rule set decided (Spec 015 policy metadata
  fields, extended additively).

### 14.4 Persistence outcomes match the real Spec 015 API

```ts
type PersistenceObservation =
  | { kind: 'save-outcome'; outcome: SaveOutcome }             // full typed Spec 015 outcome
  | { kind: 'environmental-failure'; code: EnvironmentalFailureCode };

type EnvironmentalFailureCode = 'contention-exhausted' | 'storage-unavailable';
```

- **`SaveOutcome` is the real Spec 015 type** (`stored` / `policy-rejected` /
  `safety-rejected` / `failed`), not a re-invented shape. `policy-crash` is
  **removed**: a policy exception is a policy outcome
  (`policy-failed`, `reason: 'exception' | 'malformed-decision'`), never a
  distinct environmental code (verified against `packages/storage`).
- **`EvidenceContentionError` (Spec 015) is never a `SaveOutcome`**: it
  throws (`code: 'EVIDENCE_CONTENTION_EXHAUSTED'`); the ingress maps it to
  `{ kind: 'environmental-failure', code: 'contention-exhausted' }`.
- `storage-unavailable` covers open/path/IO failures surfaced as
  environmental by the storage layer.
- **Leak-free projection**: internal results may be rich; the persisted
  `PersistenceObservation` and any logged line carry **only the closed
  codes above** — never exception messages, identities, documents, or
  digests (§9.1).
- Persistence never rewrites the interaction outcome: `trace.status` and the
  lifecycles are decided before the save (§3.2) and are unchanged by it.

### 14.5 Determinism and ordering of derived loss codes

- Ordering = §7.3 table order; deduplication = at most once per code;
  derivation = from `captureBoundary.streaming.losses` + canonical events,
  never from the boundary statement and never a static list. The projection
  matrix (§21 T82) verifies row-level verdicts for the added rows above.
---

## 15. Versioning and identity

**Decision 15 — every versioned artifact carries a semantic version; literal
identity fields are validated as literals; version bumps are mandatory for
the five artifacts listed; the deciding policy version is recorded.**

### 15.1 Versioned artifacts and the version-bump table

| Artifact | Version | Where recorded | Bump required when |
|---|---|---|---|
| Evidence schema | `1.0.0` → **`1.1.0`** (additive) | `evidenceSchemaVersion` | any additive field (§13.1) — **this spec** |
| Capture profile `signalglass.collection.ingress-metadata-safe` | `1.0.0` | `captureProfile` | changing the default cap (§8.3), detector version, redaction rule, or retained-value set |
| Sensitive detector `signalglass.collection.sensitive-detector` | `1.0.0` | inside the capture profile | changing detector patterns (each new pattern set = new detector version) |
| Assembler contract `signalglass.streaming.assembler` | semver | `trace.assembly` | changing assembly/sequencing semantics, loss derivation, or terminalization |
| Decoder contract `signalglass.providers.openai-sse` | semver | `trace.assembly` | changing decode semantics, normalized events, or fidelity rules |
| Persistence policy `signalglass.persistence.metadata-safe` | `1.0.0` → **`v1.1.0`** (additive) | policy metadata (deciding version, §14.3) | adding/removing admission rules — **this spec** |

### 15.2 `trace.assembly` (pedigree; literal + semver validation)

```ts
trace.assembly = {
  name: 'signalglass.streaming.assembler',        // literal, validated as exactly this
  version: string,                                // semver, validated
  decoderContract?: {                             // ABSENT when no decoder ran (§13.7)
    name: 'signalglass.providers.openai-sse',     // literal, validated
    version: string,                              // semver, validated
  },
  captureProfile: {
    name: 'signalglass.collection.ingress-metadata-safe',  // literal
    version: string,                              // semver
  },
  detector: {
    name: 'signalglass.collection.sensitive-detector',     // literal
    version: string,                              // semver
  },
};
```

- `trace.assembly` is **structured** (not a free-text blob): literal-name
  fields are validated as the exact literals above, version fields as
  semantic versions (parse-time validation, §13.4). A record with a wrong
  literal or invalid version fails parse.
- `decoderContract` is present on SSE/decoded paths and **absent** when no
  decoder ran (header-less paths, non-SSE). Its absence is a first-class
  state, not an omitted value.

### 15.3 Schema support matrix

| evidenceSchemaVersion | Reader support | Writer support |
|---|---|---|
| 1.0.0 | `SUPPORTED` (read) | 1.1 writer only (assembly is streaming-only) |
| 1.1.0 | `SUPPORTED` (read) | this spec's assembler (deciding version recorded) |

- `SUPPORTED` stays `1.0.0 | 1.1.0`; nothing is deprecated. `1.1.0` is
  purely additive; every 1.0.0 record means the same thing under 1.1.0.
- The parser selects owned validation by the declared
  `evidenceSchemaVersion` (§13.7) — no guessing from field presence.

---

## 16. End-to-end flows and the persistence observation

**Decision 16 — the ingress runs fixed stage order; the save happens after
the client-response path ends; save outcomes are observable as closed
`PersistenceObservation` values on a per-interaction observation surface;
the interaction outcome is never rewritten by persistence.**

### 16.1 Stage order (fixed, tested)

```text
S0  accept     → assign traceId/interactionId (§4.1)
S1  request    → read + bound the request body; validate per Spec 006 (synchronous errors
                 surface as pre-dispatch request-failed; no canonical request events yet)
S2  dispatch   → build upstream request (env-var API key only); no evidence of key values
S3  upstream   → await response headers (connection failures → upstream-failed + model_response
                 absent (§13.3)); on headers: emit model_response with responseMeta
S4  observe    → L1–L4 pipeline (§5.2): SSE parse + decode + assemble; content/usage events;
                 terminalization (§10) when the terminal is observed
S5  forward    → passthrough with backpressure (§5.3); encoded streams forwarded raw (§5.5)
S6  finalize   → client-response path ends (finish/close); record clientResponse outcome
S7  save       → single EvidenceStorage.saveEvidenceRecord (§3.2); record PersistenceObservation
S8  observe    → per-interaction observation surface (§16.2)
```

- `S5` and `S7` are strictly ordered: **no save may occur before the
  client-response path has ended** (S6 before S7). The data path never
  calls storage.
- Idle timeout (§5.3) is handled at S5/S6: the client response closes;
  the observation terminal is `ingress-cancelled` (§10.2) when the
  observation is still active.

### 16.2 Observable save results

- Each interaction exposes a per-interaction observation surface with
  `interactionId` + the final `PersistenceObservation` (§14.4):
  - `{ kind: 'save-outcome', outcome: SaveOutcome }` — the full typed
    outcome (`stored`, `policy-rejected` + reason, `safety-rejected` +
    reason, `failed`);
  - `{ kind: 'environmental-failure', code }` — `contention-exhausted`
    (from the thrown `EvidenceContentionError`) or `storage-unavailable`.
- `PersistenceObservation` is never part of the canonical event stream and
  never alters `trace.status`/lifecycles. A `safety-rejected` record is
  still a completed observation with a refused persistence — the two are
  separate outcomes (§8.6, §14.4).

### 16.3 Leak-free projection (internal vs. persisted/logged)

- **Internal** assembly/storage results may be rich (typed outcomes,
  reasons, codes).
- **Persisted/logged projections** carry only: the closed
  `PersistenceObservation` codes, bounded structural descriptions (§8.4),
  and closed error codes (§9.2). They never carry exception messages,
  stack traces, identities, documents, digests, header values, or raw
  bodies (Spec 013 §4.4). This is enforced by the projection tests
  (§21 T68, T83) and the logging layer of the ingress slice.
- `EvidenceContentionError`'s message is fixed and leak-free in Spec 015;
  the ingress still maps it to the closed code rather than propagating the
  exception text.

### 16.4 Error-envelope parity (Spec 006 preserved)

- Pre-dispatch paths keep Spec 006 behavior exactly: invalid request → 4xx
  JSON envelope; missing key → error envelope; unroutable → 4xx; over-limit
  → 4xx; connect failure → 502. These paths produce
  `clientResponse.outcome: 'local-error-flushed'` (§2.2) and never forward
  upstream bytes.
- No response bytes are sent before the upstream headers are known
  (except the pre-dispatch envelopes above); the client never observes a
  partial 200 for a failed upstream.
---

## 17. Data flow and record assembly

```text
client POST /v1/chat/completions
   │  traceId/interactionId assigned at accept (§4.1)
   ▼
[S1 request] read+bound body ──validation failure──▶ request-failed (no request events)
   ▼
[S2 dispatch] env-var API key only; upstream request
   │
   ├── connect failure ──▶ upstream-failed (no model_response, §13.3)
   ├── headers ──▶ model_response (responseMeta)  [S3]
   ▼
[S4 observe] L1 raw bytes ─▶ L2 SSE frames ─▶ L3 decoded events ─▶ L4 canonical events
   │            │              │                     │                │ seq assigned
   │            ▼              ▼                     ▼                ▼
[S5 forward]  client socket   (parser continues framing    (no canonical events
   │          under backpressure  after terminal, §6.6)     after terminal)
   ▼
[S6 finalize] client-response path ends → record clientResponse outcome (§2.2)
   ▼
[S7 save] EvidenceStorage.saveEvidenceRecord(record) — exactly once (§3.2)
   ▼
[S8 observe] PersistenceObservation surfaced per interaction (§16.2)
```

- The assembler holds the canonical record in memory across the whole
  stream and finalizes it at terminalization (§10); nothing is written
  before [S7].
- The completeness summary, `completeness.lifecycle`,
  `completeness.declaredLosses`, and `boundaryStatement` are **derived at
  parse time** by `deriveCompleteness` and verified
  (§13.2/§13.4) — the stored record carries them as derived views of the
  authoritative `captureBoundary.streaming`.

---

## 18. Observability and reporting

- Streaming interactions surface through the same evidence →
  `AgentRun` → report pipeline (Spec 013, Spec 014): `TraceCompleteness`
  fields are populated from the derived lifecycle/loss/summary values, so
  reports distinguish `completed` / `failed` / `cancelled` / `unknown`
  statuses with the honesty of §12.5.
- **Signalglass reports recommendations; it never claims automatic
  optimization** (AGENTS.md product stance): a report finding states what
  happened, why it matters, what evidence supports it, and what to inspect
  or try next — for streaming it can point at the closed loss codes and
  the observed remainder knowledge.
- The `PersistenceObservation` (§16.2) is an operational signal, not a
  report input: storage contention/refusals are surfaced as infrastructure
  observations, never conflated with trace status.
- Every smell/recommendation/finding explains: what happened (evidence),
  why it matters, evidence cited (event ids, seq ranges, loss codes), and
  next steps (bounded, concrete).

---

## 19. Documentation and privacy commitments

### 19.1 Docs to update (this spec's slice)

| Doc | Change |
|---|---|
| `docs/ingress.md` | Streaming path, transparency boundary (§5.1), stages S0–S8, save timing (§3.2), error-envelope parity |
| `docs/trace-model.md` | `model_response` + `responseMeta`, `choiceIndex`, `trace.assembly`, lifecycle/loss derivation; the legacy `Trace` path becomes a compatibility projection with divergence detection (§19.4) |
| `docs/evidence-model.md` | Canonical `model_response`/`model_response_chunk`/`model_usage` event shapes and the final-event rule (§10.5) |
| `docs/evidence-projection-matrix.md` | Added rows: v1.1.0 policy rows (§14.2), projection rows E2L-078..080 remain, new loss codes |
| `docs/model-versioning.md` | 1.1.0 additive schema; version-bump table (§15.1) |
| `docs/capture-profiles.md` | Default cap 240 (64–4096), capture-profile v1.0.0, detector v1.0.0, honest statuses |
| `docs/privacy.md` | Collection-time privacy pipeline (§8.2), bounded captured content, honest admission claim (§8.6) |
| `docs/architecture.md` | `@signalglass/streaming` proposal, L1–L4 layers |
| `docs/glossary.md` | remainder knowledge, declared losses, observation detach, transparency boundary |
| `docs/roadmap.md` | Streaming item moves to implementable; reliability item noted (§19.2) |

### 19.2 The honest crash/no-record declaration

- **If the process dies before [S7], there is no record for that
  interaction.** This is a declared, system-level limitation — documented
  in `docs/ingress.md` and `docs/roadmap.md` (the reliability item,
  "Reliability, recovery, and incomplete-trace handling"): recovery
  journaling for interrupted streams is **deferred**, not promised.
- `crash-no-record` is a **system-level declaration**, never a per-record
  loss code: a persisted record cannot carry it (it was persisted), and a
  crashed interaction has no record to carry it (§3.3, §7.3).
- The spec never fabricates a "recovered" record, identity, completion, or
  placeholder for an unpersisted stream.

### 19.3 Privacy claims (honest wording)

- **Claim**: default-collection records are **expected to be
  policy-admissible** under `metadata-safe` v1.1.0; the construction
  invariant (detector + cap + structural exclusion) is tested with
  sentinels. **Never claimed**: admissibility by construction, or that
  rejection is impossible (§8.6).
- **Claim**: full raw payloads, secrets, and API keys are **not stored** by
  default; bounded captured content (≤ cap, detector-passed) and declared
  excerpts are the only content retained (§8.1, §8.5).
- **Claim**: header values outside the allowlist are excluded structurally —
  precise wording per §5.1 ("no header values except the validated bounded
  allowlist"), never the over-broad "no header values".

### 19.4 Legacy coexistence (preserved)

- The canonical `EvidenceRecord` is authoritative; the legacy `Trace`
  continues to be emitted for compatibility, with **divergence detection**
  comparing the canonical record's legacy projection with the
  independently emitted legacy trace (Spec 013 §8; `docs/evidence-projection-matrix.md`;
  the executable claim table in
  `packages/core/src/evidenceProjections/projectionMappingMatrix.ts`).
- Streaming adds no second canonical path and no new legacy writer: the
  canonical record is the source, and the legacy view is projected
  (Spec 014 §8.3). Legacy coexistence is tested by T80–T82 and is
  unchanged by this spec's decisions.

---

## 20. Slice plan (proposed; each slice lands a green main)

Slices are additive and independently shippable; each builds and tests
against the contracts it uses (no casts; no
unknown-additive-field-preservation as a substitute for owned validation —
criterion 38, T83).

| Slice | Contents | Tests |
|---|---|---|
| **S1 — 1.1 foundation** | 1.1 schema types (six §13.1 fields), owned parse validation, `deriveCompleteness` recomputation + `completeness_disagrees_with_derivation`, serialize round-trips, 1.1 fixtures, version contracts (§13.7, §15) | T80, T81, T83, T85, T89 |
| **S2 — persistence policy v1.1.0** | `signalglass.persistence.metadata-safe` v1.1.0 rows (§14.2), deciding-version metadata, downgrade `unknown-additive-field`, projection-matrix rows | T82, T96 |
| **S3 — SSE parser + public contracts** | `@signalglass/streaming` package scaffold, `createSseParser`, `FrameResult`, `[DONE]` awareness, bounded frame cap, public stream contracts | T01–T10, T94 |
| **S4 — provider decoder + assembler** | `decodeSseFrame`, `openai-sse` decoder, `StreamDecodedEvent`, `assembleTrace`, capture boundary builder, retention/masking, multi-choice, terminalization, model_response | T11–T70, T86–T93, T95, T97–T100 |
| **S5 — ingress wiring + persistence + legacy + e2e** | apps/ingress stages S0–S8, forwarder, decoder tee, backpressure, `PersistenceObservation`, legacy coexistence, end-to-end tests | T71–T79, T63, T60–T62, T54–T59, T99–T100 |

- **Slice order rationale**: S1 establishes the canonical 1.1 types and the
  authority model before anything derives from them; S2 locks the
  persistence contract before records exist; S3–S4 build the pure pipeline
  network-free; S5 wires the network path last.
- Every slice must leave `pnpm test` and `pnpm build` green and must not
  modify `@signalglass/core` models.
---

## 21. Test groups

**100 named test groups (T01–T100)**, each mapped to at least one
acceptance criterion (§22) and at least one decision block. Tests use
Vitest; parser/decoder/assembler tests are pure-function tests; ingress
tests use an in-process server with a fake upstream.

### 21.1 SSE parsing (T01–T10)

| ID | Group | Asserts |
|---|---|---|
| T01 | basic-frame | a `data:` frame → one chunk event |
| T02 | comments-and-blanks | `:` comments and blank lines are skipped, not events |
| T03 | multiline-data | multiline `data:` joined with `\n` (spec-conformant) |
| T04 | split-frame | a frame split across two chunks accumulates correctly |
| T05 | utf8-split | multi-byte UTF-8 split across chunks decodes per frame |
| T06 | line-endings | CRLF / LF / CR accepted per spec |
| T07 | partial-at-eof | partial frame at EOF → `sse-partial-frame-at-eof` |
| T08 | eof-without-done | clean EOF without `[DONE]` → `sse-eof-without-done` |
| T09 | invalid-utf8 | invalid UTF-8 frame → `sse-invalid-utf8` |
| T10 | frame-cap | 16 MiB cap exceeded → `frame-overflow` detach; parser resets and keeps framing |

### 21.2 Multi-choice (T11–T18)

| ID | Group | Asserts |
|---|---|---|
| T11 | expansion-order | choices expanded in array order |
| T12 | index-derived | `choiceIndex` from `choice.index` |
| T13 | position-derived | `choiceIndex` = array position when `index` absent |
| T14 | single-choice | single choice → `choiceIndex` 0 |
| T15 | invalid-index | negative/non-integer index → `sse-invalid-choice-index` |
| T16 | cross-frame-continuation | same `choiceIndex` across frames is one choice's continuation; per-choice ordinals continue |
| T17 | out-of-order-preserved | out-of-order `choice.index` across frames preserved; `seq` = observation order |
| T18 | duplicate-in-frame | duplicate `choice.index` within one frame → `sse-invalid-choice-index` (ambiguity refused) |

### 21.3 Assembly (T19–T26)

| ID | Group | Asserts |
|---|---|---|
| T19 | seq-contiguity | `seq` starts at 0, strictly increasing, contiguous as assigned; frames that fail to parse leave no gap |
| T20 | one-frame-many-events | one frame → ordered zero-or-more events at consecutive `seq` |
| T21 | determinism | identical inputs → identical outputs (events, loss codes, boundary statement) |
| T22 | idempotence | re-running assembly with same inputs does not duplicate events |
| T23 | retention-applied | excerpt/mask applied per capture profile with honest statuses |
| T24 | provider-native-contract | raw provider JSON retained only under explicit `providerNative` contract |
| T25 | unmapped-delta | role/tool_calls/refusal/audio/multimodal/future delta fields → `unmapped-delta-fields`, never silent `null` |
| T26 | usage-normalization | provider numbers → `UsageValue { value, evidenceStatus: 'captured' }`; captured zero ≠ absence; partial = omitted fields; per-choice nested usage discarded + declared |

### 21.4 Terminalization (T27–T35)

| ID | Group | Asserts |
|---|---|---|
| T27 | completed | `[DONE]` → `completed`; `span_end` then `interaction_end` final; `trace.status completed`; model span `completed` |
| T28 | upstream-http-error | non-2xx upstream → `upstream-failed`; `error` (actor `model`, `lifecycleTarget: "trace"`, `lifecycleEffect: "fail"`) as the record's final event; no `interaction_end`; span `unknown` |
| T29 | non-sse-2xx | 2xx non-SSE → `upstream-failed` (same final-event shape as T28) |
| T30 | provider-error-frame | provider error frame → `upstream-failed` (same final-event shape) |
| T31 | malformed-terminal | each of the 5 `sse-*` codes → `malformed-stream`; `error` (actor `model`, trace `fail`) final; no `interaction_end` |
| T32 | client-cancelled | client disconnect → `client-cancelled`; `cancelled` (requestedBy `client`, trace `cancel`) as the record's final event; no `interaction_end` |
| T33 | ingress-cancelled | shutdown/idle timeout → `ingress-cancelled`; `cancelled` (requestedBy `ingress`, trace `cancel`) final; no `interaction_end` |
| T34 | observation-detached | observer failure → informational `error` (actor `capture`, `lifecycleTarget: "none"`, `lifecycleEffect: "none"`) as the record's final event; status `unknown`; no `interaction_end` |
| T35 | first-terminal-wins | multiple terminal triggers in one stream: first observed wins; no rewrite |

### 21.5 Request failure (T36–T38)

| ID | Group | Asserts |
|---|---|---|
| T36 | pre-dispatch | invalid/missing-key/unroutable/over-limit → `request-failed`, `local-error-flushed`, no `model_response` |
| T37 | key-unavailable-once | `key-unavailable` classified **exactly once** under `request-failed` (actor `capture`); never under `upstream-failed`; no fabricated upstream outcome |
| T38 | body-read-failure | unreadable body → `request-failed` |

### 21.6 Lifecycle / upstream-client (T39–T53)

| ID | Group | Asserts |
|---|---|---|
| T39 | boundary-facts | authoritative `captureBoundary.streaming` recorded with the closed vocabularies |
| T40 | derived-verified | derived fields recomputed at parse; tampered derived field → `completeness_disagrees_with_derivation` |
| T41 | one-authority | one authority per fact; no dual-authoritative copies |
| T42 | independent-lifecycles | upstream outcome never rewritten from clientResponse outcome and vice versa |
| T43 | status-derivation | `trace.status` derives only from the observation terminal |
| T44 | terminal-sequence | each terminal ends with exactly one final canonical event per §10.5 — `interaction_end` for `completed` only; `error` (trace `fail`) final for `upstream-failed`/`malformed-stream`/`request-failed`; `cancelled` (trace `cancel`) final for `client-cancelled`/`ingress-cancelled`; informational `error` final for `observation-detached`; nothing follows the final event; no double emission; no fabricated `interaction_end` |
| T45 | no-fabricated-counts | no `unobservedFramesAfterDetach`; `lastObservedFramePosition` counts only observed frames; remainder knowledge honest |
| T46 | done-then-close | `[DONE]` parsed, then client closes before flush → `response-completed` + `closed-before-completion` |
| T47 | disconnect-before-headers | client disconnect before response headers → `connection-failed` + `not-started` |
| T48 | malformed-but-forwarded | malformed observation, passthrough completes → `malformed-stream` + `response-completed` + `flushed` |
| T49 | invalid-4xx | invalid request, local 4xx flushed → `request-failed` + `not-started` + `local-error-flushed` |
| T50 | missing-key-envelope | missing API key, local error flushed → `request-failed` + `not-started` + `local-error-flushed` |
| T51 | connect-502 | connect failure, local 502 flushed → `upstream-failed` + `connection-failed` + `local-error-flushed` |
| T52 | mid-stream-failure | failure after response bytes started → `upstream-failed` + `stream-ended-prematurely` + `closed-before-completion` |
| T53 | disconnect-during-error | client disconnect while the local error is written → `not-started` + `closed-before-completion` |

### 21.7 Encoded stream (T54–T59)

| ID | Group | Asserts |
|---|---|---|
| T54 | gzip-tee | gzip body: raw bytes forwarded unchanged; decoder tee decodes a copy for parsing |
| T55 | deflate-tee | deflate body: same as T54 |
| T56 | unsupported-encoding | unsupported `content-encoding` → `observation-encoding-unsupported` detach; passthrough untouched |
| T57 | tee-failure | decoder tee failure mid-stream → `observation-decode-failure` detach; passthrough untouched |
| T58 | encoded-is-sse | encoded `text/event-stream` takes the SSE observation path and SSE outcomes (never `non-sse-response`) |
| T59 | encoding-headers | `content-encoding` forwarded via allowlist; `content-length` never forwarded |

### 21.8 Transparency (T60–T63)

| ID | Group | Asserts |
|---|---|---|
| T60 | byte-exact-plain | bytes written to client == bytes read from upstream (plain) |
| T61 | byte-exact-encoded | bytes written to client == bytes read from upstream (encoded) |
| T62 | backpressure | slow client pauses upstream read; no unbounded buffering |
| T63 | header-allowlist | only `content-type` / `content-encoding` / `x-signalglass-trace-id`; secret headers excluded structurally; `content-type` parameters dropped + declared |

### 21.9 Collection privacy (T64–T71)

| ID | Group | Asserts |
|---|---|---|
| T64 | structural-exclusion | authorization/cookie/set-cookie/x-api-key never enter evidence |
| T65 | sentinel-before | credential beginning before the excerpt boundary masked in full |
| T66 | sentinel-crossing | credential crossing the boundary masked in full |
| T67 | sentinel-after | credential beginning after the boundary masked/omitted |
| T68 | leak-free-projection | persisted/logged projections carry only closed codes; never exception messages, identities, documents, digests, headers, raw bodies |
| T69 | honest-statuses | benign ≤ cap `captured`; > cap `truncated`; masked `redacted`; declarations agree with real lengths |
| T70 | empty-content | empty content is `captured`, never `truncated`/`redacted` |
| T71 | admission-claim | default records expected admissible under v1.1.0 (construction invariant); a detector miss reaches the gate and is surfaced as `safety-rejected`, never auto-labeled a defect |

### 21.10 Persistence (T72–T79)

| ID | Group | Asserts |
|---|---|---|
| T72 | single-save-after-response | exactly one save, after the client-response path ends; the data path never calls storage |
| T73 | save-outcome | save outcome recorded as the full typed Spec 015 `SaveOutcome` |
| T74 | contention-exhausted | thrown `EvidenceContentionError` → `{ kind: 'environmental-failure', code: 'contention-exhausted' }` |
| T75 | storage-unavailable | open/path/IO failure → `{ kind: 'environmental-failure', code: 'storage-unavailable' }` |
| T76 | policy-crash-removed | policy exception → `policy-failed` (`reason: 'exception' | 'malformed-decision'`), never an environmental code |
| T77 | persistence-inert | `PersistenceObservation` never alters `trace.status`/lifecycles |
| T78 | safety-rejected-observation | a `safety-rejected` record is still a completed observation with refused persistence (two separate outcomes) |
| T79 | deciding-version | deciding policy version recorded in policy metadata |

### 21.11 Legacy (T80–T82)

| ID | Group | Asserts |
|---|---|---|
| T80 | v10-record | a 1.0.0 record parses under 1.1 unchanged; `SUPPORTED = 1.0.0 | 1.1.0` |
| T81 | v11-fixtures | 1.1 fixture set: all six §13.1 serialized paths round-trip |
| T82 | policy-matrix-rows | v1.1.0 policy admission rows + v1.0.0 `unknown-additive-field` downgrade row, verdict-exact |

### 21.12 Contracts / versioning / schema (T83–T100)

| ID | Group | Asserts |
|---|---|---|
| T83 | schema-versioning | `evidenceSchemaVersion` 1.1.0 additive; parser selects owned validation by declared version; no guessing from field presence |
| T84 | assembly-identity | `trace.assembly` literal names + semver validated; `decoderContract` absent when no decoder ran |
| T85 | exact-shapes | exact serialized shapes: `UsageValue`/`UsageRecord`, `responseMeta`, `choiceIndex`, `completeness.lifecycle`, `completeness.declaredLosses`, `captureBoundary.streaming` |
| T86 | model-response-once | exactly one `model_response`; first response-derived event; `responseMeta` present on header-observed paths |
| T87 | model-response-negative | no `responseMeta` on chunk/usage/error envelopes; single occurrence; header-less paths have no `model_response` and no status |
| T88 | response-meta-validated | `statusCode` 100–599; `contentType` normalized (parameters dropped + declared); `contentEncoding` single token |
| T89 | closed-vocabularies | unknown `TerminalReason`/`UpstreamOutcome`/`ClientResponseOutcome`/`RemainderKnowledge`/`DeclaredLossCode`/error code → parse failure |
| T90 | impossible-pairs | impossible upstream × client-response pairs rejected (§2.3) |
| T91 | validity-matrix | full 4×4 matrix: every valid cell observable; every invalid cell rejected |
| T92 | accounting-bounds | `lastObservedFramePosition` ≥ 1 (observed frames only); `rawForwardedBytes` ≥ 0; basis documented |
| T93 | remainder-knowledge | `protocol-terminal-observed` ≠ `transport-eof-observed`; `unknown` on detach; `not-applicable` on request-failed |
| T94 | post-terminal | trailing content forwarded, never canonicalized; `post-terminal-content-not-retained` declared; never called nonexistent |
| T95 | version-bumps | default-cap change requires capture-profile bump; detector version bump on pattern change |
| T96 | downgrade-refusal | 1.1 record to v1.0.0 policy → `policy-rejected` `unknown-additive-field`, never silent reinterpretation; deciding version recorded |
| T97 | boundaries | `@signalglass/streaming` is network-free (no socket/http/storage imports); `@signalglass/core` models unchanged |
| T98 | no-fabricated-upstream | pre-dispatch paths (`not-started`) never fabricate an upstream failure |
| T99 | terminal-sweep | on **every** terminal: exactly one final canonical event per §10.5 (`interaction_end` only on `completed`); nothing follows it; no fabricated `interaction_end` |
| T100 | matrix-consistency | §9.3 classification, §6.5 matrix, §10 state table, and tests agree cell-for-cell; every terminal appears in exactly one row |

---

## 22. Acceptance criteria

**44 acceptance criteria (AC1–AC44).** Each is covered by ≥ 1 test group
(§23). A criterion is satisfied when its groups pass on a green main.

| ID | Criterion |
|---|---|
| AC1 | Two lifecycles (observation, transport) are recorded independently; `trace.status` derives only from the observation terminal. |
| AC2 | `UpstreamOutcome` and `ClientResponseOutcome` are closed vocabularies; the 4×4 cross-field matrix is enforced; impossible pairs are rejected. |
| AC3 | Pre-dispatch failures (invalid request, missing key, key-unavailable, unroutable, over-limit, body-read) never fabricate an upstream failure or upstream outcome. |
| AC4 | Each observed interaction produces exactly one canonical record and exactly one save through `EvidenceStorage.saveEvidenceRecord`. |
| AC5 | The save happens after the client-response path ends; the data/forwarding path never calls storage. |
| AC6 | The crash-no-record limitation is declared honestly (docs + roadmap); `crash-no-record` never appears on a record. |
| AC7 | Identity is opaque, capture-time, immutable, and never derived from content; a retrying client's re-POST is a new interaction. |
| AC8 | `choiceIndex` (choice identity) and `chunkIndex` (per-choice ordinal) are distinct and never interchangeable. |
| AC9 | Duplicate `choice.index` within one frame is rejected as malformed (`sse-invalid-choice-index`). |
| AC10 | `seq` is assigned only by the assembler, starts at 0, and is contiguous as assigned; unparsed frames leave no fabricated gap. |
| AC11 | Response-body bytes are forwarded with content and order preserved, under backpressure, with zero frame mutation. |
| AC12 | Response headers are ingress-constructed from the validated bounded allowlist; secrets are excluded structurally; dropped parameters are declared. |
| AC13 | Encoded streams are forwarded raw and observed through a bounded decoder tee; unsupported encoding / decode failure detach observation only. |
| AC14 | The parser and decoder produce ordered, provider-neutral, frame-level results; one frame expands to zero-or-more canonical events in order. |
| AC15 | The terminalization matrix is closed; the first observed terminal wins; every terminal ends with exactly one final canonical event — `interaction_end` for `completed` only, the causal `error` (trace `fail`) / `cancelled` (trace `cancel`) declaration as the final event for failed/cancelled terminals, the informational `error` (effect `none`) as the final event for `observation-detached` — and nothing follows the final event (Spec 014 §4.7 `terminal_declaration_not_final`; no fabricated `interaction_end`). |
| AC16 | Trailing content after `[DONE]` is forwarded, never canonicalized, and honestly accounted (`post-terminal-content-not-retained`, remainder knowledge). |
| AC17 | Exactly one `model_response` event with `responseMeta` is emitted when headers are observed; no duplication; header-less paths have none. |
| AC18 | Evidence statuses are honest: `truncated` only when shortened, `redacted` only when masked, `captured` only when complete at the boundary, empty content `captured`. |
| AC19 | `completeness.declaredLosses` is closed, deterministically ordered/deduplicated, derived from authoritative facts, and persisted as a derived field; `boundaryStatement` is derived only. |
| AC20 | Loss codes are declared only when content was actually not retained; absence is declared (`provider-usage-absent`, `finish-reason-absent`); zeros are never fabricated. |
| AC21 | The detach loss code is `remainder-after-observation-detach-not-observed` (content-level, honest), never a fabricated frame count. |
| AC22 | Collection runs the privacy pipeline (structural exclusion → versioned detector → mask/omit → bound → honest status → declare); the storage-safety gate is non-bypassable. |
| AC23 | The default excerpt cap is 240 (valid 64–4096); changing it requires a capture-profile version bump. |
| AC24 | Benign content ≤ cap is `captured` under the explicit `metadata-safe` v1.1.0 Rule 2; v1.0.0 stays declared-only and is never reinterpreted. |
| AC25 | The admission claim is honest: expected admissible with a tested construction invariant; rejection remains possible and is surfaced as `safety-rejected`. |
| AC26 | `ErrorPayload` is closed (actor/role/target/effect + code + bounded description); diagnostics never carry exception messages, identities, documents, digests, headers, or raw bodies. |
| AC27 | `key-unavailable` is classified exactly once under `request-failed` (actor `capture`), never under `upstream-failed`. |
| AC28 | The observation state machine has the seven terminals with defined transitions; no terminal is reachable from `initial`. |
| AC29 | `@signalglass/streaming` is proposed network-free; `@signalglass/core` models remain provider-agnostic and unchanged. |
| AC30 | The assembler is a pure, deterministic, idempotent single sequencing surface; re-assembly never duplicates. |
| AC31 | Frame/byte accounting is honest: `lastObservedFramePosition` counts only observed frames; `rawForwardedBytes` has a documented basis; no fabricated counts anywhere. |
| AC32 | `RemainderKnowledge` is the closed four-value vocabulary with honest `unknown` on detach. |
| AC33 | The schema advances additively to 1.1.0 with exactly the six new serialized paths; every 1.0.0 record parses unchanged. |
| AC34 | One authority per fact: `captureBoundary.streaming` is the authoritative input; derived fields are recomputed at parse and tampering fails with `completeness_disagrees_with_derivation`. |
| AC35 | `responseMeta` and `choiceIndex` validate per §13.3/§13.5 (status 100–599; bounded normalized content type; non-negative integer). |
| AC36 | Usage normalization: provider numbers → captured `UsageValue`s; captured zero ≠ absence; partial usage = omitted fields; per-choice nested usage discarded + declared `unrecognized-provider-field`. |
| AC37 | `signalglass.persistence.metadata-safe` advances to v1.1.0 with the exact added matrix rows; the deciding version is recorded; a 1.1 record to v1.0.0 is refused as `unknown-additive-field`. |
| AC38 | Persistence outcomes match the real Spec 015 API: full typed `SaveOutcome`; `EvidenceContentionError` → `contention-exhausted`; `policy-crash` removed. |
| AC39 | `trace.assembly` records literal names + semver, validated; `decoderContract` is absent when no decoder ran. |
| AC40 | The slice plan is additive and contract-true: no casts, no unknown-additive-field preservation as a substitute for owned validation. |
| AC41 | `PersistenceObservation` is observable per interaction and never alters `trace.status`/lifecycles; a refused save is a separate outcome. |
| AC42 | Spec 006 error-envelope parity is preserved on pre-dispatch paths; no response bytes precede the upstream outcome. |
| AC43 | Documentation is updated per §19.1 with the honest privacy/crash wording of §19.2/§19.3. |
| AC44 | Reports remain recommendation-only; findings state what/why/evidence/next for streaming interactions. |

---

## 23. Coverage mapping

### 23.1 Acceptance criteria ↔ test groups (many-to-many)

| Criteria | Primary groups | Also exercised by |
|---|---|---|
| AC1, AC2, AC3 | T39–T43, T91 | T98, T99 |
| AC4, AC5 | T72 | T77 |
| AC6 | T89 (vocab closedness) + §19 doc review | — |
| AC7 | T19, T26 | T80 |
| AC8, AC9 | T11–T18 | T85 |
| AC10 | T19, T20 | T45 |
| AC11, AC12 | T60–T63 | T54–T59 |
| AC13 | T54–T59 | T60–T61 |
| AC14 | T01–T10, T20 | T11–T17 |
| AC15 | T27–T35, T44, T99, T100 | — |
| AC16 | T94 | T45 |
| AC17 | T86–T88 | T36–T38 |
| AC18 | T69, T70 | T23 |
| AC19, AC20 | T40, T85, T89 | T45, T69 |
| AC21 | T45, T89 | T93 |
| AC22 | T64–T68, T71 | T23 |
| AC23 | T95 | T69 |
| AC24, AC25 | T71, T82 | T96 |
| AC26, AC27 | T68, T37 | T36–T38 |
| AC28 | T27–T35, T99, T100 | — |
| AC29 | T97 | — |
| AC30 | T21, T22 | T19 |
| AC31 | T92, T45 | — |
| AC32 | T93 | T45 |
| AC33, AC34 | T80, T81, T83, T40, T41 | T89 |
| AC35 | T85, T88 | T86–T87 |
| AC36 | T26, T85 | T25 |
| AC37 | T82, T96 | T83 |
| AC38 | T73–T76 | T77–T78 |
| AC39 | T84 | T85 |
| AC40 | T83 | T84 |
| AC41 | T77, T78 | T72–T76 |
| AC42 | T36–T38, T49–T51 | T63 |
| AC43 | §19 doc review | — |
| AC44 | §18 doc review | T68 |

### 23.2 Decision blocks ↔ sections ↔ slices

| Decision | Section | Slice |
|---|---|---|
| 1 two lifecycles | §1 | S4 |
| 2 upstream/client outcomes | §2 | S4 |
| 3 assembly/persistence boundary | §3 | S3–S5 |
| 4 identity/ordering | §4 | S4 |
| 5 transparency | §5 | S5 |
| 6 SSE/multi-choice/terminalization | §6 | S3–S4 |
| 7 evidence statuses/losses | §7 | S4 |
| 8 collection vs persistence | §8 | S4–S5 |
| 9 error taxonomy | §9 | S4 |
| 10 state machine | §10 | S4 |
| 11 packages | §11 | S3–S5 |
| 12 assembler/remainder | §12 | S4 |
| 13 1.1 schema/authority | §13 | S1 |
| 14 persistence policy | §14 | S2 |
| 15 versioning/identity | §15 | S1–S2 |
| 16 flows/observability | §16 | S5 |

---

## 24. Deferred (explicitly out of this spec)

- **Recovery journaling** for interrupted streams (crash no-record is
  declared, not solved; roadmap reliability item).
- **Export policies** (collection and persistence are specified; export is
  out of scope).
- **Providers beyond `openai-sse`** (the adapter contract is specified; the
  decoder list is open for later slices; decoder identity is literal and
  versioned).
- **Content hashing / integrity fields** beyond the existing
  `nativeContentHash` semantics (integrity, never identity/order).
- **Cross-interaction correlation, replay, and multi-tenancy** concerns.
- **Retry/rate-limit controls** on the ingress side (provider-agnostic,
  later slice).

## 25. Open questions

**None.** Every decision above is decided with a closed vocabulary, a
validated shape, or a normative rule. The revision-4 review blockers are
each resolved by a numbered decision (D1–D8 in §Status).

## 26. References

- Specs: `006-ingress-openai-compatible.md`, `007-storage-and-privacy.md`,
  `013-evidence-model.md`, `014-evidence-primitives.md`,
  `015-append-only-evidence-store.md`.
- Docs: `docs/evidence-model.md`, `docs/trace-model.md`, `docs/ingress.md`,
  `docs/privacy.md`, `docs/capture-profiles.md`,
  `docs/evidence-projection-matrix.md`, `docs/model-versioning.md`,
  `docs/architecture.md`, `docs/glossary.md`, `docs/roadmap.md`,
  `docs/architectural-foundation.md`, `docs/decisions/0002-two-modes.md`,
  `docs/decisions/0004-evidence-first.md`.
- Code (grounding for the persistence/evidence contracts):
  `packages/evidence/src/completeness.ts` (`deriveCompleteness`),
  `packages/evidence/src/validate.ts` (`parseEvidenceRecord`,
  `completeness_disagrees_with_derivation`),
  `packages/evidence/src/types-record.ts` (`TraceCompleteness`),
  `packages/evidence/src/types-envelope.ts` (`ResponseEnvelope`),
  `packages/evidence/src/vocabulary.ts` (`model_response`),
  `packages/storage/src/evidenceStorage.ts` (`SaveOutcome`,
  `EvidenceContentionError`), `packages/storage/src/redaction.ts`
  (S1/S2/S3 credential patterns), `apps/ingress/src/forward.ts`,
  `apps/ingress/src/server.ts` (Spec 006 forwarding and envelope paths).
