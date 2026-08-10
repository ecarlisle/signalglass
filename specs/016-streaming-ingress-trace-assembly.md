# Spec 016: Streaming ingress and trace assembly

## Status

**Draft — revision 7 (focused correction pass).** Proposed for
acceptance; **implementation is prohibited until this spec is Accepted**. No
runtime code is produced by this PR. The proposed modules, contracts, and
constants below are named but **not created** until an accepted
implementation slice.

Revision 5 resolves the revision-4 review blockers, which all concerned
contracts that still conflicted with the implemented system (Spec 006
ingress behavior, Spec 014 §4.7 lifecycle derivation, Spec 015 save
pipeline):

1. **The upstream/client-response matrix is corrected against Spec 006**:
   a non-2xx upstream response is read to completion and answered with a
   **normalized SignalGlass error envelope** (`response-completed` +
   `local-error-flushed` is a valid pair, exactly as `apps/ingress` does);
   a 2xx invalid/non-object body is answered with a local 502; the non-SSE
   2xx path is decided explicitly (forwarded unchanged on the transport,
   classified `non-sse-response` on the observation side) (§2).
2. **A closed upstream cancellation outcome is added**:
   `cancelled-by-ingress` with a closed cause (`client-disconnect` /
   `ingress-shutdown` / `configured-limit`). Downstream-driven termination
   while connecting is **never** classified `connection-failed`; first-
   observed precedence is defined independently for the upstream and
   client-response outcomes (§1.2, §2).
3. **Pre-dispatch request failures are reachable**: the state machine runs
   `initial → request-observed → awaiting-response → observing-stream`;
   invalid body, missing key, over-limit, and unroutable failures transition
   from `request-observed`, and a pre-dispatch failure still produces a
   valid canonical record (`interaction_start` then the final terminal
   `error`; no model span; no `model_request`; no fabricated
   `interaction_end`) (§10, §16).
4. **The final-event contradiction is removed**: the assembler no longer
   promises "one final `interaction_end` on every result" — the Spec 014
   §4.7 invariant holds everywhere (`interaction_end` final only on
   `completed`; the terminal `error`/`cancelled`/informational `error` is
   final on the other terminals); and the architecture is corrected:
   `EvidenceRecord` authoritative, `EvidenceTrace` the canonical derived
   trace, `AgentRun` a legacy/consumer projection (§12.2, §18).
5. **The single-authority repair is finished**: `observationTerminal` is
   **removed** from the boundary (the terminal is derived from the final
   canonical event); `captureBoundary.streaming.assembly` is authoritative
   and `trace.assembly` is a verified derivation; capture-profile and
   detector identity have one authoritative home each and are cross-checked
   wherever they appear; decoder-participation follows the authoritative
   `decoderDisposition` fact — **not** `model_response` presence (the
   rev-5 "decoder-presence" wording is corrected in revision 6); mismatch
   regressions are specified (§13.2, §13.4).
6. **Loss facts are closed and applicability-aware**: raw provider property
   names are replaced by a closed category union for unmapped delta fields;
   retention booleans are replaced by closed state facts
   (`not-observed`/`fully-retained`/`partially-retained`/`omitted`;
   `not-applicable`/`retained`/`not-retained`); a loss is derived only when
   the source content existed (§7.3).
7. **Post-terminal accounting is exact**: a three-state fact
   (`none-observed` / `observed-not-retained` / `unknown`); the
   `post-terminal-content-not-retained` loss is emitted only when trailing
   content was actually observed and intentionally not retained; an unknown
   remainder uses a separate honest code; parser continuation after a
   terminal is deterministic (§6.6, §7.3).
8. **The persistence observation is operational**: `PersistenceObservation`
   is an in-memory result emitted after the save — it is **not** part of the
   canonical `EvidenceRecord` and is **not** persisted by Spec 015; the
   complete real `SaveOutcome` union is used (`stored`,
   `already-present`, `conflict`, `invalid`, `unsupported-version`,
   `safety-rejected`, `policy-rejected`, `policy-failed`, `clock-failed`);
   `EvidenceContentionError` stays separate as `contention-exhausted`;
   policy-version availability is corrected (stored metadata only on
   `stored`; `policy-rejected`/`policy-failed` carry their policy identity;
   safety rejection precedes policy evaluation) (§16, §14).
9. **Bounded-captured admission is non-spoofable**: the v1.1.0 admission
   rule depends on the mandatory Spec 015 storage-safety gate plus the
   policy's own length-bound enforcement at a closed list of admitted
   paths — never on claimed assembler/detector pedigree; unknown
   captured-content paths fail closed (§14.2).
10. **The public decoder contracts are closed again**: the provider-error
    `string` code is replaced with a closed code union; separate closed
    surfaces are declared for provider error frames, non-SSE responses,
    upstream HTTP status, transport connection failure, internal decoder
    failure, and malformed provider streams; `UpstreamFailureCode` gains
    `provider-error-frame` and `non-sse-response` (§6.2, §9.2).
11. **Determinism is scoped honestly**: nondeterministic inputs (the ID
    allocator's outputs, captured timestamps, clock readings) are explicit
    parameters of the pure assembler; determinism holds given fixed inputs
    (§12.2, §12.6).
12. **Factual reporting is corrected**: Spec 015 is **Implemented and
    merged to main** (PR #22, merge commit
    `f18a153a3065897311e5139b6c7a8caa078df759`); the PR body and this
    report state the exact committed line count.

Revision 6 resolves the revision-5 review blockers — focused contract
corrections grounded in the implemented types (`types-envelope.ts`,
`types-base.ts`, `evidenceStorage.ts`, `version.ts`):

1. **Retained delta text has a canonical home**: the additive 1.1 field
   `events[].responseEnvelope.deltaText` carries the normalized retained
   chunk-delta text — present **only** on `model_response_chunk` events
   whose normalized text was retained; absent on finish-only,
   usage-only, metadata-only, missing, and wholly-omitted paths;
   the event-level `evidenceStatus` owns the representation; per-leaf cap
   240 code points; serialization + parse validation; raw-observation
   declarations; `metadata-safe` v1.1.0 admission at a closed path;
   per-choice multi-choice semantics. The schema-field count becomes
   **seven** (§13.1, §13.5). Normalized text is never placed in
   `providerNative`.
2. **The request-message captured-content shape is exact**: the
   normalized `RequestEnvelope.messages` representation is defined —
   closed roles, string-or-part content, closed part kinds, per-leaf cap,
   unknown-key fail-closed, redaction/truncation ownership,
   multimodal/tool-call part handling, and captured-content policy paths
   (§8.7). An arbitrary object's serialized length is never treated as
   message-content attestation.
3. **Policy selection is construction-time (Spec 015)**: the operator
   constructs `EvidenceStorage` with the persistence policy
   (`EvidenceStorageConfig.persistencePolicy`); a record's capture
   profile/detector are **validation inputs, never policy selectors**;
   an unknown/unavailable policy version is a constructor/configuration
   error; `PolicyFailureReason` stays `'exception' |
   'malformed-decision'` (§14).
4. **The real `SaveOutcome` is used**: the discriminated object union
   from `@signalglass/storage` (`import type { SaveOutcome }`), with all
   typed fields preserved internally in `PersistenceObservation`;
   leak-free reduction happens only in the diagnostic projection (§16.2).
5. **Decoder participation is exact**: an authoritative closed
   `decoderDisposition` (`not-applicable` | `openai-sse` |
   `unsupported-encoding`) records whether the OpenAI SSE decoder
   participated; `assembly.decoderContract` is derived from it — not
   from `model_response` presence (§13.4).
6. **Loss types and applicability are corrected**: `RequestBodyRetention =
   'not-observed' | 'retained' | 'not-retained'`; absence losses
   (`provider-usage-absent`, `finish-reason-absent`,
   `remainder-after-client-cancellation`,
   `remainder-after-ingress-cancellation`) are derived **only when
   applicable** — never on request-failed, connect-failed, HTTP-error,
   non-SSE, or header-less paths; aggregate precedence and
   boundary-vs-event cross-validation are defined (§7.3).
7. **MAJOR-1 forward compatibility is preserved**: the schema version gate
   accepts additive minor/patch within MAJOR 1
   (`isSupportedEvidenceSchemaVersion` / `checkEvidenceSchemaVersion` in
   `version.ts`) — version-aware validation, **not** an exact
   `1.0.0 | 1.1.0` allowlist (§13.7, §15).
8. **Package and slice claims are corrected**: `@signalglass/evidence`,
   `@signalglass/storage`, and `@signalglass/core` are changed by this
   spec (schema/parse/derivation/serialization; the v1.1.0 policy;
   projection-matrix and parity rows); slice dependencies are explicit
   (§11, §20).
9. **Validation truthfulness**: the trailing whitespace near the
   `messageContent` assignment rule is removed; this PR reports the
   actual validation outputs and exit codes (see the PR body).

Revision 7 resolves the revision-6 review blockers — the contracts that
remained inconsistent or normalized losses away. Each item is grounded in
the implemented types and closes a concrete gap:

1. **Every retained request-content leaf owns its own honest state**: the
   normalized request-message shape now serializes a leaf-level
   representation (retained string + leaf `evidenceStatus` + owning
   redaction/truncation declarations with real lengths, including a value
   that was both masked and shortened) directly on the canonical
   `RequestEnvelope.messages` — raw observations and the canonical trace
   round-trip identically; the event-level status is a derived aggregate
   that never authorizes nested leaves for persistence; Rule 1/Rule 2
   inspect each leaf's own status, declaration, path, and length (§8.7,
   §14.2).
2. **The closed role type and the prose are one contract**: unrecognized
   role strings are **never preserved** — the normalized role is a closed
   discriminant (`KnownRole | 'unrecognized'` sentinel) and the raw value
   is dropped, with a closed structural loss fact/code
   (`unrecognized-role-observed` / `unrecognized-role-not-retained`);
   metadata labels are bounded (≤ 128 code points, parse-enforced), never
   content-attested (§8.7, §7.3).
3. **The in-memory evidence record is bounded**: named evidence budgets
   with decided defaults and validation (canonical/raw observation count,
   total retained content code points, serialized evidence bytes, and a
   reservation guaranteeing the final `observation-detached` event);
   exhaustion detaches with `record-budget-exceeded`, stops accumulating
   evidence, continues byte-transparent backpressured passthrough, and
   still finalizes and saves once after the response ends (§3.5, §9.2,
   §10.2).
4. **Request-body and pre-dispatch losses are phase-accurate**: a
   four-value closed union distinguishes no-bytes-observed from
   partially-observed and fully-observed-but-not-retained; distinct loss
   wording for "not fully observed" vs. "observed but not retained";
   pre-dispatch paths classify `messageContent` per stage — `omitted` +
   `message-content-not-retained` on valid pre-dispatch paths with no
   `model_request`, never `not-observed` merely because the canonical
   event was omitted (§7.3, §10.2).
5. **The excerpt cap is deterministic**: the
   `signalglass.collection.ingress-metadata-safe` v1.0.0 cap is exactly
   240 code points; the runtime-configurable 64–4096 claim is removed; a
   different cap requires a future capture-profile version **and** a
   matching policy contract (§8.3, §14.2, §15).
6. **Omitted SSE metadata is declared, and zero-frame decoder
   participation is fixed**: `event:`/`id:`/`retry:` values observed but
   not retained are a closed loss fact (`sse-metadata-not-retained`);
   comment lines are decided to be protocol keepalives (never retained,
   never counted); `decoderDisposition: 'openai-sse'` means the SSE
   decoder was selected and invoked — it may end before the first
   complete frame (§6.1, §7.3, §13.4).
7. **Genuine 1.0 compatibility is preserved**: the closed normalized
   request-message validation applies only to Spec 016 records in schema
   ≥ 1.1.x; a 1.0.x record with an arbitrary legacy `messages` value
   parses and round-trips unchanged and is never reinterpreted as the
   normalized representation; a future minor still receives all known
   1.1 validation (§13.7, §8.7).

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
| [Spec 006](006-ingress-openai-compatible.md) | Non-streaming `POST /v1/chat/completions` forwarding, normalized error envelope, env-var API keys. **The implemented normalization behavior is the ground truth for the outcome matrix (§2.3)**: non-2xx bodies are read and answered with a normalized local error envelope; 2xx invalid bodies are answered with a local 502; valid 2xx bodies are forwarded. Spec 016 extends the same endpoint for `stream: true`. |
| [Spec 013](013-evidence-model.md) | Canonical evidence contract this spec assembles: `model_response`, `model_response_chunk`, `model_usage`, `error`, `cancelled`, `interaction_start/end`, `span_start/end`, evidence statuses, observation roles, capture boundary. |
| [Spec 014](014-evidence-primitives.md) | The authority model this spec must preserve: `rawObservations` and `captureBoundary` authoritative; `trace`, `analysis`, `completeness` deterministic derivations; `deriveCompleteness(trace, analysis, captureBoundary)` the completeness source; parsing compares serialized derivatives against recomputed derivatives (§13.4). `§4.7` terminal-finish rules (the terminal declaration is the record's final applicable event; `interaction_end`/`span_end` only on `completed`) are enforced verbatim (§10.5). |
| [Spec 015](015-append-only-evidence-store.md) | **Implemented and merged to main in PR #22** (merge commit `f18a153a3065897311e5139b6c7a8caa078df759`). `EvidenceStorage.saveEvidenceRecord` is the only persistence path; the exact `SaveOutcome` union is used (§14.4); exhaustion throws `EvidenceContentionError`; the storage-safety gate (S1/S2/S3/S5/S6) runs before policy evaluation; the `metadata-safe` v1.0.0 reference policy and its versioning contract are extended additively to v1.1.0 (§14). |
| [`docs/ingress.md`](../docs/ingress.md) | Current non-streaming live-mode data flow; Spec 016's implementation updates it. |
| [`docs/trace-model.md`](../docs/trace-model.md) | "Streaming response event refinement" is listed as future work; the legacy `Trace` path becomes a compatibility projection with divergence detection (§19.4). |
| [`docs/privacy.md`](../docs/privacy.md) | Default capture/persistence boundaries the assembler must honor (metadata-safe defaults, env-var-only keys, no raw payloads by default). |
| [`docs/roadmap.md`](../docs/roadmap.md) | Streaming milestone; slice #23 (this spec); slice #40 (reliability/recovery — crash-recovery journaling is deferred to it). |

## Scope

Define, for a **streaming** OpenAI-compatible interaction observed by
`apps/ingress`:

1. The two lifecycles — client passthrough and evidence observation — and
   their separation, including downstream-driven upstream cancellation
   (Spec 016 §1).
2. The upstream transport and the client-facing response delivery modeled
   as independent outcomes (including `cancelled-by-ingress` with a closed
   cause) with a complete cross-field validity matrix aligned to Spec 006
   (Spec 016 §2).
3. The assembly/persistence boundary: one canonical record, one save, after
   the client response path finishes (Spec 016 §3).
4. Deterministic identity and `seq` ordering (Spec 016 §4).
5. Streaming transparency: response-**body**-byte/order-transparent,
   backpressured passthrough with no silent frame mutation, the four
   observation layers, and the explicit non-SSE 2xx decision (Spec 016 §5).
6. SSE parsing, provider-neutral multi-choice normalization, and the
   terminalization matrix (Spec 016 §6).
7. The evidence-status vocabulary and the closed, applicability-aware loss
   facts for every assembled payload (Spec 016 §7).
8. Collection vs. persistence policy boundaries, including the honest
   excerpt-status semantics, the collection-time privacy process, and the
   non-spoofable v1.1.0 admission rule (Spec 016 §8, §14).
9. The error taxonomy with separate closed code surfaces (Spec 016 §9).
10. The deterministic terminal state machine — `initial →
    request-observed → awaiting-response → observing-stream` — with the
    Spec 014 §4.7 final-event sequence (Spec 016 §10).
11. Package boundaries and the proposed module layout (Spec 016 §11).
12. Public contracts: provider-boundary output types, closed vocabularies,
    the explicit-input deterministic assembler, and the completeness
    summary (Spec 016 §12).
13. The canonical schema extension: additive `evidenceSchemaVersion` 1.1.0,
    the authoritative `captureBoundary.streaming` source, the derived
    lifecycle/loss fields with one authority per fact, conditional 1.0/1.1
    validation, and the exact metadata-only `model_response` envelope
    (Spec 016 §13).
14. Persistence-policy versioning: `metadata-safe` v1.1.0 with
    non-spoofable admission (Spec 016 §14).
15. The structured assembler-version location and the version-bump table
    (Spec 016 §15).
16. Persistence outcomes: the operational `PersistenceObservation` (not part
    of the record), the exact `SaveOutcome` union, and leak-free
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
- A separate operational-observation store for `PersistenceObservation`
  values — the operational surface is emitted in-process (§16.2); a
  persistent operational store is a later, separately specified surface
  (§24).

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
| **Observation terminal** | The terminal state of the observation lifecycle — one of the seven `TerminalReason` values (§10). It is **derived from the final canonical event**, never recorded as a boundary fact (§13.2). |
| **Upstream outcome** | The end state of the upstream connection/response — one of the five `UpstreamOutcome` values, including downstream-driven `cancelled-by-ingress` (§2.1). |
| **Upstream cancellation cause** | The closed reason a `cancelled-by-ingress` upstream ended: `client-disconnect` / `ingress-shutdown` / `configured-limit` (§2.1). |
| **Client-response outcome** | The end state of the client-facing ingress response — one of the four `ClientResponseOutcome` values (§2.2). |
| **First-observed precedence** | Each outcome is recorded from whichever event was **observed first in that system** (upstream socket events vs. client/dispatch events); the two precedence decisions are independent (§2.4). |
| **Remainder knowledge** | What the observer knows about the stream tail after the terminal — one of the four `RemainderKnowledge` values (§12.4). |
| **Authoritative fact** | A recorded input: `rawObservations` and `captureBoundary` (incl. `captureBoundary.streaming`). Trusted after validation; never recomputed (§13.4). |
| **Derived fact** | A deterministic recomputation: `trace`, `analysis`, `completeness` (incl. `lifecycle`, `declaredLosses`, `boundaryStatement`) and the observation terminal. Verified at parse against recomputation (§13.4). |
| **Sequencing surface** | The single capture component that assigns `seq` at observation time (Spec 013 §2.2). In this spec it is the assembler (§4). |
| **Observer failure** | Any failure of the parsing/decoding/assembly machinery (exception, configured bound exceeded, unsupported encoding, decode failure) — distinguished from malformed provider protocol (§1.4). |
| **Malformed provider protocol** | The provider's stream violates the observed protocol (invalid JSON/UTF-8 in data, invalid or duplicate choice index, EOF/partial frame without `[DONE]`) — a provider-side observation, not an observer failure (§1.4). |
| **Observation detachment** | The explicit degraded state after an observer failure: canonical extraction stops; the transport passthrough continues unaffected; the record finalizes with status `unknown` (§1.4, §10). |
| **SSE frame** | One server-sent-event block: field lines terminated by a blank line. The parser's output unit (§5, §6). |
| **Transport byte** | The raw upstream response-body bytes observed at the ingress boundary, exactly as read from the socket (no decoding, no decompression). Never mutated by the ingress (§5). |
| **Parsed stream event** | A provider-neutral normalized event from the decoder's frame result: `chunk` / `usage` / `provider-error` (§6, §12). |
| **Canonical event** | An `EventRecord` (Spec 013 §3.1) the assembler derives from parsed stream events and lifecycle signals. |
| **Response-metadata event** | The single canonical `model_response` event emitted when response headers are observed, before any chunk/usage/error, carrying `responseMeta` (§6.7, §13.3). It is the authoritative marker that headers were observed (and therefore that a decoder ran). |
| **Terminal marker** | The `[DONE]` data frame that signals normal protocol termination. |
| **Terminal reason** | One of the closed `TerminalReason` values (§10, §12). |
| **Passthrough** | Forwarding the upstream response-body bytes to the client with content and order preserved (§5). |
| **Backpressure** | Slowing or pausing the upstream read when the client cannot consume (§5). |
| **Dual emission** | Emitting both the canonical record (Spec 015) and the legacy `Trace` (Spec 007 path) for one interaction (§19.4). |
| **Divergence detection** | Comparing the canonical record's legacy projection with the independently emitted legacy trace (§19.4). |
| **Completeness summary** | The assembler-level accounting of what was observed, dropped, and declared (§12.5); its persisted projection is the derived `completeness` (§13.4). |
| **Capture profile** | The named, versioned bundle of collection settings recorded on the trace (`trace.captureProfile`, Spec 013 §9) and authoritatively on `captureBoundary.streaming.captureProfile` (§13.4). |
| **Declared content** | Content admitted under an owning `redacted`/`truncated` declaration (Spec 015 `metadata-safe`). |
| **Bounded captured content** | Content admitted as `captured` under the explicit `metadata-safe` v1.1.0 rule — admitted only at a closed list of paths, bounded by the v1.0.0 profile cap (240 code points, per Spec 015's own counting), and subject to the mandatory storage-safety gate; **not** admitted by claimed pedigree (§14.2). |
| **Loss fact** | A closed, applicability-aware authoritative fact about retention — e.g. `'not-observed' | 'fully-retained' | 'partially-retained' | 'omitted'` or `'not-applicable' | 'retained' | 'not-retained'` (§7.3). |
| **Operational observation** | An in-memory result of the save step (`PersistenceObservation`), emitted after the save and never persisted inside the canonical record (§16.2). |
| **Retained excerpt** | The bounded representation of content the collection process retains: normalized text, an honest owning status, and the owning declarations (§8). |
| **Save outcome** | The complete typed `SaveOutcome` union returned by `saveEvidenceRecord` (Spec 015): `stored` / `already-present` / `conflict` / `invalid` / `unsupported-version` / `safety-rejected` / `policy-rejected` / `policy-failed` / `clock-failed` (§16.3). |
| **Environmental failure** | A persistence failure that is not a `SaveOutcome`: thrown `EvidenceContentionError` (→ `contention-exhausted`) or storage-layer exceptions caught by this slice, reduced to a closed leak-free code (§16.3). |

---

## 1. Two lifecycles: client passthrough and evidence observation

**Decision 1 — the client passthrough lifecycle and the evidence-observation
lifecycle are distinct. An observer/parser/decoder failure must not destroy
the upstream request, stop reading bytes the client needs, inject a frame, or
truncate an otherwise forwardable response. Neither lifecycle is rewritten
from the other; downstream-driven termination is a first-class upstream
outcome, never a fabricated upstream failure.**

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

The transport lifecycle's end is **not one reason but two independent
outcomes** (§2): the **upstream outcome** (how the upstream connection/body
ended) and the **client-response outcome** (how the client-facing ingress
response ended). Only four client-impact situations can stop forwarding, and
each is recorded as the appropriate pair (§2.5):

| Client impact | Upstream outcome | Client-response outcome |
|---|---|---|
| Upstream body fully read and the response forwarded/flushed normally (2xx SSE, or 2xx non-SSE object body forwarded unchanged) | `response-completed` | `flushed` |
| Upstream non-2xx read to completion, answered with the normalized SignalGlass error envelope (Spec 006) | `response-completed` | `local-error-flushed` |
| Upstream 2xx body invalid/non-object, answered with a local 502 | `response-completed` | `local-error-flushed` |
| Upstream connection error/timeout/TLS loss before headers, answered with a local 502 | `connection-failed` | `local-error-flushed` |
| Client socket closes mid-stream → ingress cancels the upstream | `cancelled-by-ingress` (cause `client-disconnect`) | `closed-before-completion` |
| Ingress shutdown or a configured ingress limit forces cancellation | `cancelled-by-ingress` (cause `ingress-shutdown` / `configured-limit`) | `closed-before-completion` |
| Upstream connection loss or premature EOF mid-stream (genuine upstream failure, after bytes were forwarded) | `stream-ended-prematurely` | `closed-before-completion` |

No other event may stop forwarding — in particular, **no observer failure
(parser exception, decoder exception, frame overflow, unsupported encoding,
decode failure) may stop forwarding, destroy the upstream request, or
truncate an otherwise forwardable response.** A malformed provider frame is
forwarded to the client exactly as received (§1.4).

**Downstream-driven termination is never a fabricated upstream failure**: a
client disconnect or ingress shutdown while the upstream request is awaiting
headers does **not** prove `connection-failed` — the ingress cancels the
upstream request and records `cancelled-by-ingress` with its closed cause
(§2.1, §2.4).

The transport lifecycle can end **after** the observation lifecycle has
already terminalized (e.g. `[DONE]` parsed, then the client disconnects
before the final bytes flush, or ingress shutdown interrupts delivery) —
these facts are recorded separately, never merged (§2).

### 1.3 Observation lifecycle

The observation lifecycle is the assembler's state machine (§10). Its
terminal states are: `completed`, `upstream-failed`, `client-cancelled`,
`ingress-cancelled`, `malformed-stream`, `request-failed`, and
`observation-detached`. The observation terminal is **derived from the
final canonical event** (§13.2); the upstream outcome and the client-response
outcome are **independent** authoritative facts: any may occur first, none
rewrites another, and persistence waits for the client-response end (§3.2).

### 1.4 Malformed provider protocol vs. internal observer failure

Two failure classes are distinguished with different trace statuses, actors,
lifecycle targeting, and completeness:

| Class | Examples | Trace status | Terminal event | Actor / lifecycle targeting | Completeness |
|---|---|---|---|---|---|
| **Malformed provider protocol** | `data` value is not valid JSON; invalid UTF-8 in a data value; non-integer/negative/duplicate choice index; EOF or partial frame without `[DONE]` | `failed` | `error` — the record's **final** event (Spec 014 §4.7: no `interaction_end` after a terminal declaration) | actor `model`; `lifecycleTarget: "trace"`, `lifecycleEffect: "fail"`; observationRole `provider_reported` (the provider's stream was observed to violate the protocol) | Declares the malformed frame and the unobserved remainder |
| **Unrecognized provider extension** (valid JSON, unknown shape) | A frame that decodes to no recognized chunk/usage/error/done shape | Unaffected (not terminal) | None | — | Declared loss `unrecognized-extension-frame`; observation **continues** |
| **Internal observer failure** | Parser/decoder/assembler exception; frame-overflow observation bound; evidence-budget exhaustion (§3.5); unsupported content-encoding; decoder-tee decode failure | `unknown` | Informational `error` (actor `capture`, `lifecycleTarget: "none"`, `lifecycleEffect: "none"`) — the record's **final** event; no `interaction_end` | actor `capture`; observationRole `unobservable` | Declares observation detachment and the unknown remainder |

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
response are two different systems with two closed outcome vocabularies
(including downstream-driven upstream cancellation), a complete cross-field
validity matrix aligned to the implemented Spec 006 behavior, and
authoritative persistence under `captureBoundary.streaming`. No impossible
pair is allowed, no upstream failure is fabricated merely because no upstream
request existed, and downstream-driven cancellation is never classified as an
upstream connection failure.**

### 2.1 Upstream outcome (the upstream connection/body)

```ts
type UpstreamOutcome =
  | 'not-started'               // no upstream dispatch occurred:
                                //   invalid request, missing API key, unroutable model, over-limit body, body-read failure
  | 'response-completed'        // upstream response body fully read (any status: 2xx SSE, 2xx non-SSE,
                                //   non-2xx body read for normalization, 2xx invalid-body read for the 502 path)
  | 'connection-failed'         // genuine upstream connect/timeout/TLS failure observed BEFORE response
                                //   headers — no downstream cancellation was processed first
  | 'stream-ended-prematurely'  // genuine upstream failure AFTER the response started:
                                //   mid-stream connection loss or premature EOF (no downstream cancellation
                                //   was processed first)
  | 'cancelled-by-ingress';     // downstream-driven termination: the ingress ended the upstream request
                                //   because the client disconnected or the ingress shut down / enforced a
                                //   configured limit — NOT an upstream failure

type UpstreamCancelCause =      // closed; present only when outcome === 'cancelled-by-ingress'
  | 'client-disconnect'
  | 'ingress-shutdown'
  | 'configured-limit';
```

- **`not-started` covers every pre-dispatch failure** — an invalid request
  never creates an upstream request, so no upstream failure is fabricated
  for it.
- **`connection-failed` is a genuine upstream failure** observed from the
  upstream socket (connect error, timeout, TLS failure) **before** any
  downstream cancellation was processed (§2.4).
- **`cancelled-by-ingress` is downstream-driven termination**: the client
  disconnected or the ingress shut down / enforced a limit while the
  upstream request was still in flight (awaiting headers or mid-stream),
  and the ingress ended the request. It is **never** `connection-failed`
  and **never** `stream-ended-prematurely` — the upstream did not fail; it
  was cancelled. The closed cause is recorded alongside it.
- `stream-ended-prematurely` means headers were observed, the body was cut
  short by a **genuine upstream** failure, and no downstream cancellation
  was processed first.

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
- `local-error-flushed` is the client-facing outcome whenever the ingress
  answers with its **own normalized error envelope** (Spec 006 behavior):
  pre-dispatch rejections (invalid request → 4xx/413, missing key → 500
  server_error, unroutable → 400), connection failure → 502, **upstream
  non-2xx → the normalized SignalGlass error envelope (§2.3)**, and 2xx
  invalid/non-object body → 502.
- `not-started` is the outcome when the client disconnected before any
  response began.

### 2.3 Cross-field validity matrix (upstream × client-response)

The matrix is aligned to the implemented Spec 006/ingress behavior
(`apps/ingress/src/server.ts`, `forward.ts`):

| upstream \ clientResponse | `not-started` | `flushed` | `closed-before-completion` | `local-error-flushed` |
|---|---|---|---|---|
| `not-started` | ✓ client gone before the local error was written (pre-dispatch) | ✗ | ✓ client gone while the local error was being written | ✓ **pre-dispatch rejection → local 4xx/413/500 error flushed** |
| `response-completed` | ✓ client gone before any byte forwarded | ✓ **normal completion: 2xx SSE forwarded; 2xx non-SSE object body forwarded unchanged** | ✓ `[DONE]` parsed, then client closed before flush | ✓ **upstream non-2xx read → normalized SignalGlass error envelope flushed; 2xx invalid/non-object body → local 502 flushed** |
| `connection-failed` | ✓ client gone during connect failure | ✗ | ✓ client gone while the 502 was being written | ✓ **connect/timeout/TLS failure → local 502 flushed** |
| `stream-ended-prematurely` | ✓ failed before any byte forwarded | ✗ | ✓ **mid-stream genuine upstream loss after bytes were forwarded** | ✗ |
| `cancelled-by-ingress` | ✓ cancelled before any response byte (e.g. client disconnect or shutdown while connecting) | ✗ | ✓ cancelled after the response started (client disconnect or shutdown/limit mid-stream) | ✗ |

- **14 valid cells, 6 invalid cells.** Invalid pairs: `flushed` ×
  `not-started`/`connection-failed`/`stream-ended-prematurely`/
  `cancelled-by-ingress` (a normal flush requires the upstream body to have
  completed — only `response-completed` can pair with `flushed`); and
  `local-error-flushed` × `stream-ended-prematurely`/`cancelled-by-ingress`
  (a local error envelope is written only from the pre-dispatch, connect,
  non-2xx, and invalid-body paths; once response bytes have been forwarded —
  or a downstream cancellation has occurred — the client is never handed a
  local error envelope).
- **`response-completed` + `local-error-flushed` is a valid pair** (Spec
  006): the upstream non-2xx response is read to completion and answered
  with the normalized SignalGlass error envelope; the upstream 2xx
  invalid/non-object body is read and answered with a local 502.
- **The non-SSE 2xx path is decided explicitly** (§5.4): a 2xx response
  whose `content-type` is not `text/event-stream` — with a **valid object
  body** — is **forwarded unchanged** on the transport (Spec 006 parity for
  valid 2xx bodies) and **classified `non-sse-response` on the observation
  side** (terminal `upstream-failed`). It is never simultaneously
  "forwarded unchanged" and "normalized into a local error". A 2xx
  non-SSE **invalid/non-object body** follows the Spec 006 502 path
  (normalized local error), never the passthrough.
- The matrix is enforced by validation: a `captureBoundary.streaming` whose
  pair is invalid fails parse (§13.4). Tests cover every cell (§21 T58).

### 2.4 First-observed precedence (independent per system)

The upstream outcome and the client-response outcome are each recorded from
**whichever event was observed first in that system**:

- **Upstream side**: if the upstream socket reports a genuine failure
  (error event, timeout, TLS failure, premature EOF) **before** the ingress
  processes the downstream cancellation, the upstream outcome is
  `connection-failed` / `stream-ended-prematurely`. If the downstream
  cancellation (client disconnect / ingress shutdown / limit) is processed
  **before** any upstream failure was observed, the upstream outcome is
  `cancelled-by-ingress` with its cause. The upstream outcome is decided
  exactly once, at the first of these two events.
- **Client-response side**: if the client disconnect is observed first, the
  client-response outcome is `not-started` (before any bytes) or
  `closed-before-completion` (after bytes); if the upstream failure is
  observed first while the client is still connected, the response outcome
  follows the failure path (`local-error-flushed` for pre-header failures,
  `closed-before-completion` for mid-stream failures).
- **Cancellation racing a genuine upstream failure**: the two events race;
  first-observed wins independently on each side. The matrix's valid cells
  still hold — e.g. `cancelled-by-ingress` never pairs with `flushed` or
  `local-error-flushed`, regardless of which event won.

### 2.5 Authoritative persistence: `captureBoundary.streaming`

Both outcomes (with the upstream cancellation cause), the remainder
knowledge, the loss facts, and the assembly identity are recorded
**authoritatively** in the additive 1.1 field `captureBoundary.streaming`
(§13.4):

```ts
captureBoundary.streaming = {
  upstream: { outcome: UpstreamOutcome; cause?: UpstreamCancelCause };   // cause only when cancelled-by-ingress
  clientResponse: { outcome: ClientResponseOutcome };
  decoderDisposition: DecoderDisposition;          // authoritative decoder participation (§7.3.1, §13.4)
  remainder: {
    knowledge: RemainderKnowledge;              // §12.4
    lastObservedFramePosition?: number;         // 1-based (§12.3)
    rawForwardedBytes?: number;                 // basis defined in §12.3
  };
  losses: { /* closed, applicability-aware facts, §7.3/§13.4 */ };
  assembly: { /* authoritative assembler/decoder identity, §13.4; decoderContract derived from decoderDisposition */ };
  captureProfile: { name: string; version: string };   // authoritative; cross-checked against trace.captureProfile
  detector: { name: string; version: string };         // authoritative; no derived duplicate
};
```

The derived `completeness.lifecycle` and `completeness.declaredLosses` are
recomputed from this authoritative source and the canonical events by
`deriveCompleteness` and verified at parse (§13.4). There is **one authority
per fact** — the authoritative input is trusted after validation; the
derived copies are recomputed and compared, never independently
authoritative. The **observation terminal is not recorded here**: it is
derived from the final canonical event (§13.2), so no mirror exists to
disagree with.

### 2.6 Scenarios and required tests

| Scenario | Observation terminal (derived) | upstream.outcome | clientResponse.outcome |
|---|---|---|---|
| Invalid request, local 4xx flushed | `request-failed` | `not-started` | `local-error-flushed` |
| Missing API key, local error flushed | `request-failed` | `not-started` | `local-error-flushed` |
| Upstream non-2xx body read, normalized envelope flushed | `upstream-failed` | `response-completed` | `local-error-flushed` |
| Upstream 2xx invalid/non-object body, local 502 flushed | `upstream-failed` | `response-completed` | `local-error-flushed` |
| Connect failure, local 502 flushed | `upstream-failed` | `connection-failed` | `local-error-flushed` |
| Client disconnect while awaiting headers | `client-cancelled` | `cancelled-by-ingress` (cause `client-disconnect`) | `not-started` |
| Ingress shutdown while awaiting headers | `ingress-cancelled` | `cancelled-by-ingress` (cause `ingress-shutdown`) | `not-started` |
| Client disconnect after headers (mid-stream) | `client-cancelled` | `cancelled-by-ingress` (cause `client-disconnect`) | `closed-before-completion` |
| Ingress cancellation after headers (limit/shutdown) | `ingress-cancelled` | `cancelled-by-ingress` (cause `configured-limit`/`ingress-shutdown`) | `closed-before-completion` |
| Mid-stream genuine upstream loss after bytes forwarded | `upstream-failed` | `stream-ended-prematurely` | `closed-before-completion` |
| Cancellation racing genuine upstream failure | per §2.4 first-observed | per §2.4 | per §2.4 |
| `[DONE]` parsed, then client close before flush | `completed` | `response-completed` | `closed-before-completion` |
| Normal completion | `completed` | `response-completed` | `flushed` |
| Malformed observation, passthrough still completes | `malformed-stream` | `response-completed` | `flushed` |

Tests: T45–T48 (pre-dispatch request failures), T49–T57 (upstream and
client-response outcome pairs, incl. cancellation paths and the race), T58
(full matrix), T59–T61 (first-observed precedence), T62–T63 (save timing
and lifecycle independence), T115 (decoder participation). The observation
terminal, the upstream outcome, and the client-response outcome are
recorded/derived independently and never rewrite each other.

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
  derived from the observation terminal per §10.3, which is itself derived
  from the final canonical event (§13.2).

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
  observable (§16.2) but never rewrites the interaction outcome.

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

### 3.5 Evidence budgets: bounded in-memory assembly

The record is assembled in memory across the whole stream (§3.1); the
spec therefore defines **named evidence budgets** — the stream's own chunk
count is not a bound, and a provider can emit an arbitrarily long stream
without `[DONE]`. Budgets are decided, validated at ingress configuration
(closed values; out-of-range configuration is refused at startup, never
silently clamped), and recorded conceptually with the capture profile
(§15.1; the budgets themselves are ingress configuration, not record
fields — the record carries only the profile identity):

| Budget | Default | Valid range | Counts toward |
|---|---|---|---|
| `maxCanonicalEvents` | 10,000 | 1,000 – 1,000,000 | canonical events emitted (incl. control events) |
| `maxRawObservationPayloadBytes` | 4 MiB | 1 MiB – 64 MiB | serialized raw observation payloads |
| `maxRetainedContentCodePoints` | 262,144 | 16,384 – 16,777,216 | total retained content (request leaves §8.7 + `deltaText` §13.5), code points |
| `maxSerializedEvidenceBytes` | 16 MiB | 1 MiB – 64 MiB | estimated serialized `EvidenceRecord` growth |
| `finalEventReservation` | 4 KiB | 1 KiB – 64 KiB | headroom reserved so the terminal `observation-detached` event can always be emitted |

Behavior on exhaustion (closed, deterministic):

1. **Detach observation with `record-budget-exceeded`** (§9.2 — a new
   closed member of `ObservationFailureCode`; §1.4 internal-observer
   failure). The detach is an observation decision, never a transport
   decision.
2. **Stop accumulating evidence**: no further canonical events, no further
   raw observation payloads, no further retained text. The `finalEventReservation`
   guarantees the informational `error` (actor `capture`) that finalizes
   the record fits even when the budget was hit exactly at the boundary.
3. **Continue byte-transparent, backpressured client passthrough** — the
   client traffic is never cancelled, truncated, or mutated because
   observation filled its budget (§5).
4. **Derive the honest losses**: remainder knowledge is `unknown`;
   `remainder-after-observation-detach-not-observed` is derived (the
   observation terminal is `observation-detached`); if the terminal had
   already been observed, the post-terminal fact is `unknown` and
   `post-terminal-content-unknown` is derived — the spec never asserts
   unobserved content was absent (§6.6, §7.3).
5. **Still finalize and attempt the one canonical save** after the
   client-response path ends (§3.2): the budget-exhausted record is a
   valid `observation-detached` record (status `unknown`) and takes the
   same persistence path as every other record (§16).

Adversarial tests (T125–T127, §21.13) prove a never-ending or
high-chunk-count stream cannot grow evidence memory without bound and that
the transport path is unaffected by budget exhaustion.

---

## 4. Identity and deterministic ordering

**Decision 4 — sequence numbers and opaque identities are the only ordering
and identity keys; timestamps and content hashes never order or identify;
identity is assigned at request observation; choice identity is honest
(rejected duplicates, declared unmapped fields).**

### 4.1 Identity

- `traceId` == `interactionId` (Spec 013 §1.2, §2.1): a single opaque value
  assigned by the ingress **at request observation** — the moment the
  `POST /v1/chat/completions` request is observed, before the body is read
  or parsed (§10.1, §16.1). Every subsequent failure (including an unreadable
  body) is recorded against this identity, so "one observed request → one
  record" holds by construction.
- Identity is opaque, capture-time, immutable, and **never derived from
  content** (no request-hash, no message-hash, no body digest as identity).
  ULID-style values are recommended; uniqueness per installation is required
  and global uniqueness SHOULD be pursued. Identity is assigned fresh per
  observed request; a retrying client that re-POSTs produces a new
  interaction with a new identity.
- `eventId` values are opaque, assigned at capture, unique within the trace.
- `observationId` values are assigned by the assembler at the capture
  boundary, unique and immutable (Spec 014 §2.1).
- The ID allocator's outputs and captured timestamps are **nondeterministic
  inputs supplied to the assembler** (§12.2): identity is assigned at
  observation time by the ingress, and the pure assembler never generates
  IDs or timestamps itself (§12.6).

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
  single captured timestamp for events observed in one burst; timestamps are
  explicit inputs (§12.6).
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
forwarded as-is and observed through a bounded decoder tee. Non-2xx
responses are normalized into the Spec 006 error envelope (never forwarded);
2xx bodies are forwarded unchanged unless the body is invalid (then a local
502 is returned).**

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
  ingress limit), so it ends the client-response path via the
  `configured-limit` cancellation class (§1.2); the upstream outcome is
  `cancelled-by-ingress` (cause `configured-limit`) and the observation
  lifecycle records `ingress-cancelled` (§10) when it is still active.
- There is **no total-response timeout** that kills long-lived streams; the
  existing 30 s `forwardToUpstream` timeout covers the upstream request
  establishment, not the response stream.

### 5.4 The explicit non-2xx / non-SSE / invalid-body decision

The streaming path follows the implemented Spec 006 normalization contract
exactly (`apps/ingress/src/server.ts`), applied to the streaming response:

| Upstream response | Transport (client-facing) | Observation |
|---|---|---|
| Non-2xx status (any body) | **Not forwarded.** The upstream body is read to completion (needed to close the connection cleanly), and the ingress answers with the **normalized SignalGlass error envelope** (Spec 006: `api_error` shape; status = upstream status when 4xx/5xx else 502) | Terminal `upstream-failed` (`http-error-status`); `responseMeta.statusCode` records the upstream status; `local-error-flushed` |
| 2xx, `content-type: text/event-stream` | **Forwarded unchanged** (SSE passthrough) | SSE observation path; terminal per §6.5 |
| 2xx, `content-type` not `text/event-stream`, **valid object body** | **Forwarded unchanged** (Spec 006 parity for valid 2xx bodies) | Terminal `upstream-failed` (`non-sse-response`); the interaction did not complete as a stream; `flushed` |
| 2xx, `content-type` not `text/event-stream`, **invalid/non-object body** | **Not forwarded.** Local 502 (`api_error`) flushed | Terminal `upstream-failed` (`non-sse-response`); `local-error-flushed` |

- The non-SSE 2xx path is **one decision, stated once**: valid 2xx bodies
  are forwarded unchanged (never normalized); non-2xx responses and invalid
  2xx bodies are normalized into the Spec 006 error envelope (never
  forwarded). The spec never says a single response is both.
- Zero frame mutation applies on the passthrough paths: no synthetic
  `[DONE]` is appended if the stream ends mid-way; no keep-alive comment is
  inserted; no frame is re-serialized; no malformed frame is repaired before
  forwarding.
- A mid-stream upstream failure means the connection ends as the upstream
  ended it — truncated at the transport layer, never "completed" by
  synthesis.

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
  at all (§5.4).
- The decoder tee is bounded (same 16 MiB frame cap); a decode failure is an
  internal observer failure (`observation-decode-failure`), never a provider
  protocol verdict.

### 5.6 Byte-boundary verification

- The implementation must prove byte transparency by test (§21 T65–T66):
  for every encoded/plain scenario, the bytes written to the client are
  exactly the bytes read from the upstream (header construction and the
  Spec 006 normalization paths excepted).

---

## 6. SSE parsing, multi-choice normalization, and terminalization

**Decision 6 — the parser and decoder produce ordered, provider-neutral,
frame-level results; one frame expands to zero or more canonical events in
deterministic order; choice identity and chunk ordinal are distinct;
duplicate choice indexes in one frame are rejected; unmapped delta fields
are declared losses with a closed category union; the terminalization matrix
is closed with the Spec 014 §4.7 final-event rule; parser continuation after
a terminal is deterministic; trailing content is forwarded, never
canonicalized, and honestly accounted.**

### 6.1 The parser (L2)

`createSseParser()` (proposed in `@signalglass/streaming`, §11) implements a
strict SSE framing of the raw byte stream (per the
[SSE specification](https://html.spec.whatwg.org/multipage/server-sent-events.html))
with the streaming-terminalization extension (`[DONE]` data frame). Its
behavior matrix:

| Input | Behavior |
|---|---|
| Comment lines (`:`) | Skipped (not canonical events). **Decided**: comment values are **protocol keepalives only** — never retained, never counted as observed SSE metadata, and never declared as a loss (they carry no semantic value; §7.3 `sse-metadata-not-retained` covers `event:`/`id:`/`retry:` only) |
| Blank lines | Frame terminator |
| `data:` lines (multiline) | Joined with `\n` (spec-conformant) |
| `event:` / `id:` / `retry:` fields | Parsed; not canonical events. **Their values are observed but not retained**, and that non-retention is a declared loss: the closed fact `losses.sseMetadataObservedButNotRetained` (set when any such field value was observed) derives the code `sse-metadata-not-retained` (§7.3). The raw provider-controlled field values are **never** persisted in the fact or the loss — only the closed boolean fact and the code |
| CRLF, LF, CR line endings | Accepted per spec |
| Frame split across chunks | Accumulated until the blank line; memory-bounded (16 MiB frame cap) |
| Multi-byte UTF-8 split across chunks | Decoded **per frame** (chunks are not concatenated into one string; each frame is decoded independently) |
| `data: [DONE]` exact value (no trailing whitespace) | Terminal marker → frame with `data: "[DONE]"`; any other value is an ordinary data frame |
| Invalid UTF-8 in a frame | Parser-level malformed signal: `sse-invalid-utf8` (L2) → assembler treats as malformed provider protocol (§1.4) |
| Partial frame at EOF | `sse-partial-frame-at-eof` → malformed provider protocol |
| Frame exceeding 16 MiB | Parser-level overflow signal: the observation bound is exceeded → `observation-detached` via `frame-overflow` (an observer failure, §1.4) — the parser resets its frame buffer and continues framing subsequent bytes |
| EOF without `[DONE]` (no partial frame) | `sse-eof-without-done` → malformed provider protocol |

**Deterministic continuation**: the parser **continues framing after every
terminal** for as long as the transport provides bytes and the observation
machinery remains operational. It stops only on (a) observation detachment
(an observer failure: unsupported encoding, decoder-tee failure,
`frame-overflow` bound, internal error), or (b) transport end. "Continues"
is the deterministic behavior — nothing about the post-terminal accounting
(§6.6) depends on a MAY; if the parser is still operational at transport
end, the post-terminal state is `none-observed` or `observed-not-retained`
exactly as observed; if it detached, the state is `unknown`.

### 6.2 The decoder (L3) — frame-level normalized result

The decoder (`decodeSseFrame(frame)` in `@signalglass/providers`, §11)
returns a **frame-level result** with closed codes only:

```ts
type MalformedStreamCode =                       // closed (also used at §9.2)
  | 'sse-invalid-data-json'
  | 'sse-invalid-utf8'
  | 'sse-invalid-choice-index'
  | 'sse-partial-frame-at-eof'
  | 'sse-eof-without-done';

type InternalDecoderFailureCode = 'decode-error';  // closed; internal decoder failure → observer failure

type FrameDecodeResult =
  | { kind: 'events'; events: readonly StreamDecodedEvent[] }   // ordered, zero-or-more (§12.1)
  | { kind: 'done' }                                            // [DONE] frame
  | { kind: 'malformed'; code: MalformedStreamCode }            // closed
  | { kind: 'unrecognized' }                                    // valid JSON, unknown shape → declared loss; observation continues
  | { kind: 'decode-error'; code: InternalDecoderFailureCode }; // internal decoder failure → observer failure (detach)
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
| Frame-level usage + per-choice usage both present | Frame-level usage is canonical (OpenAI usage is top-level); per-choice nested usage is **discarded and declared** as `per-choice-usage` (§7.3 — `StreamDecodedEvent.chunk` has **no** `usage` field) |

- A chunk event's delta is the provider-neutral normalized text of the
  choice's content delta (a string; `null` when the chunk carries no content,
  e.g. only a finish reason).
- **Valid OpenAI-compatible delta fields not represented by
  `delta: string | null` are declared losses via a closed category union,
  never silently reduced to `null` and never persisted as raw provider
  property names**: `role` → `role`, `tool_calls` → `tool-calls`, `refusal`
  → `refusal`, `audio` → `audio`, multimodal content parts → `multimodal`,
  per-choice nested usage → `per-choice-usage`, and any future extension
  field → `other-extension` (§7.3). **No raw unknown key ever reaches
  records, logs, diagnostics, or boundary text.**
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
| No usage anywhere (SSE path) | Declared absence: no usage event; `declaredLosses` includes `provider-usage-absent` **only when an SSE provider response was observed** (`decoderDisposition === 'openai-sse'`) and no usage was reported — never on request-failed, connect-failed, HTTP-error, or non-SSE paths (§7.3); **never** a fabricated zero-usage record |
| Finish reason on a chunk | Recorded on that chunk's envelope (`finishReason`), at its observation position |
| No finish reason before `[DONE]` | Declared absence (`finish-reason-absent`) **only when a finish reason was applicable to an observed SSE stream** (`decoderDisposition === 'openai-sse'`); `completed` still requires the observed `[DONE]` (§7.3) |
| Provider-reported finish reasons | Bounded label, ≤128 code points, validated per Spec 014 label rules; unknown reasons are preserved as observed (not classified as errors) |

### 6.5 Terminalization matrix

| Terminal | Trigger (observed) | Trace status | Canonical terminal event |
|---|---|---|---|
| `completed` | `[DONE]` frame observed (first observed terminal wins) | `completed` | `span_end` (model span) then **`interaction_end`** — the record's final event |
| `upstream-failed` | Upstream non-2xx; non-SSE 2xx; provider error frame; upstream connection error/timeout/TLS loss | `failed` | **`error`** (actor `model`, `lifecycleTarget: "trace"`, `lifecycleEffect: "fail"`; `error.type` per §9.3) — the record's final event; no `interaction_end`; model span `unknown` |
| `client-cancelled` | Client disconnect mid-stream | `cancelled` | **`cancelled`** (requestedBy `client`, `lifecycleTarget: "trace"`, `lifecycleEffect: "cancel"`) — the record's final event; no `interaction_end`; model span `unknown` |
| `ingress-cancelled` | Ingress shutdown/limit cancellation (idle timeout included) | `cancelled` | **`cancelled`** (requestedBy `ingress`, `lifecycleTarget: "trace"`, `lifecycleEffect: "cancel"`) — the record's final event; no `interaction_end`; model span `unknown` |
| `malformed-stream` | `sse-invalid-data-json`, `sse-invalid-utf8`, `sse-invalid-choice-index`, `sse-partial-frame-at-eof`, `sse-eof-without-done` | `failed` | **`error`** (actor `model`, `lifecycleTarget: "trace"`, `lifecycleEffect: "fail"`, observationRole `provider_reported`; `error.type` = the specific `sse-*` code) — the record's final event; no `interaction_end`; model span `unknown` |
| `request-failed` | Request rejected before dispatch (invalid/incomplete/over-limit/unroutable/key-unavailable/body-read) | `failed` | **`error`** (actor `capture`, `lifecycleTarget: "trace"`, `lifecycleEffect: "fail"`) — the record's final event; no `interaction_end`; no model span |
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

### 6.6 Trailing content after the terminal (deterministic accounting)

- **`[DONE]` proves the protocol terminal marker was observed — it does not
  prove transport EOF or the absence of trailing bytes.** Trailing bytes or
  frames after the terminal (any terminal):
  - **are still forwarded** — the passthrough never stops at a terminal
    marker; terminalization is an observation concept, not a transport
    concept;
  - **never create canonical events** — after the observation terminal, the
    assembler accepts no canonical input; nothing is sequenced after the
    final event;
  - **are parsed for structural accounting** — the parser **continues
    framing after every terminal** while the observation machinery remains
    operational (§6.1); canonicalization never resumes. This is
    deterministic, so the post-terminal fact is exactly one of:
    - `none-observed` — the parser framed to transport EOF and observed no
      trailing frame (or only comments/blank lines);
    - `observed-not-retained` — the parser observed at least one trailing
      content frame that was not retained;
    - `unknown` — the parser detached (observer failure) or could not frame,
      so the observer cannot determine whether trailing content existed;
  - **are declared via the exact fact** — `post-terminal-content-not-retained`
    is derived **only** from `observed-not-retained`; an `unknown` post-
    terminal state derives the separate honest code
    `post-terminal-content-unknown` (§7.3), which describes an unknown
    remainder **without asserting content existed**. Trailing bytes are
    **never called nonexistent merely because a terminal marker was seen**.

### 6.7 Response-metadata event (`model_response`)

- When response headers are observed — **any** upstream status — the
  assembler emits exactly **one** canonical `model_response` event as the
  **first response-derived event** (immediately after `model_request` /
  `span_start`; before any chunk, usage, `[DONE]`, or error), carrying
  `responseMeta` on its `ResponseEnvelope` (§13.3).
- This gives response metadata one universal home on every path that
  observes headers: usage-first streams, `[DONE]`-only streams, streams
  with no content chunks, non-SSE 2xx responses, and upstream non-2xx
  responses.
- **No duplication**: `responseMeta` appears only on this single
  `model_response` event — never on chunk/usage/error envelopes. The
  `ErrorPayload` carries no status field (§13.3); `responseMeta.statusCode`
  is the single upstream-status home on header-observed paths. Paths that
  never observe headers (`upstream.outcome: 'connection-failed'`,
  `'cancelled-by-ingress'` before headers, `'not-started'`) have **no**
  status and **no** `model_response`.
- The `model_response` event is the **authoritative marker that headers
  were observed** — on every header-observed path (valid SSE, non-SSE 2xx,
  upstream non-2xx, invalid-body 2xx). It is **not** a marker of decoder
  participation: the OpenAI SSE decoder participates **only** on the SSE
  observation path, recorded authoritatively by
  `captureBoundary.streaming.decoderDisposition` (§13.4). The derived
  `trace.assembly.decoderContract` is present iff
  `decoderDisposition === 'openai-sse'` (§13.4, §15.2).
- The metadata-only `model_response` envelope's complete canonical shape is
  specified in §13.3.
---

## 7. Evidence status vocabulary and loss mapping

**Decision 7 — every assembled payload carries a closed-set evidence status
that describes the transformation actually applied; declared losses are
closed codes derived from authoritative, applicability-aware boundary facts
through `completeness.declaredLosses`; absence is declared, zeros are never
fabricated, no raw provider property names are persisted, and a loss is
derived only when the source content existed or its non-retention is
genuinely known.**

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
- `truncated` and `redacted` carry the owning
  `TruncationDeclaration`/`RedactionDeclaration` **on the serialized
  retained leaf itself** — for request content on each `ContentLeaf`
  (§8.7) and for chunk deltas at event level (one leaf per chunk event,
  §13.5) — which round-trips identically through `rawObservations` and the
  canonical trace (Spec 013 §2.2.12, §5.8; projection rows E2L-078..080).
  Declaration
  lengths must agree with the actual transformation (`maxLength` /
  `originalLength` reflect real character counts; a leaf masked **and**
  shortened carries both declarations, §8.7).
- **Loss codes follow the same honesty rule**: content-retention losses are
  declared **only when content was actually not retained**; fully retained
  benign content produces no such loss (§7.3).
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

### 7.3 Loss facts and declared-loss codes

#### 7.3.1 Authoritative loss facts (closed, applicability-aware)

`captureBoundary.streaming.losses` holds **closed state facts**, never
booleans whose false-value conflates "not applicable" with "not retained",
and never raw provider-controlled strings:

```ts
type UnmappedDeltaFieldCategory =            // closed — raw provider keys are NEVER persisted
  | 'role'
  | 'tool-calls'
  | 'refusal'
  | 'audio'
  | 'multimodal'
  | 'per-choice-usage'
  | 'other-extension';

type Retention4 = 'not-observed' | 'fully-retained' | 'partially-retained' | 'omitted';
type Retention3 = 'not-applicable' | 'retained' | 'not-retained';

type RequestBodyRetention =                 // phase-accurate: observation and retention, one closed union
  | 'no-bytes-observed'                      // zero body bytes were observed (body-read failure at the start);
                                             //   there was nothing to retain and nothing was fully read
  | 'partially-observed-not-retained'        // some but not all body bytes were observed (mid-body connection
                                             //   loss, over-limit cutoff); the partial body was not retained
  | 'fully-observed-not-retained'            // the complete request body was observed and intentionally not
                                             //   retained (the default for valid requests)
  | 'retained';                              // the body was retained (never in the default profile)

type PostTerminal = 'none-observed' | 'observed-not-retained' | 'unknown';

type DecoderDisposition =                    // authoritative decoder-participation fact (§13.4)
  | 'not-applicable'                         // no SSE decoding possible/needed: header-less path, non-SSE 2xx,
                                             // upstream non-2xx, invalid-body 2xx
  | 'openai-sse'                             // the SSE observation path was selected and the OpenAI SSE decoder
                                             //   was invoked. Participation is selection/invocation, NOT
                                             //   "decoded at least one frame": headers followed by EOF or
                                             //   transport failure before the first complete frame is still
                                             //   'openai-sse' with a decoderContract (§13.4)
  | 'unsupported-encoding';                  // SSE observation path selected, but the content encoding is
                                             // unsupported — the decoder was selected but could not run

losses = {
  requestBody: RequestBodyRetention,         // phase-accurate (§7.3.1 assignment rules)
  messageContent: Retention4,                // 'not-observed' when no request-message content was ever formed;
                                             //   'omitted' when content existed but no canonical representation
                                             //   was written (valid pre-dispatch paths, §7.3.1)
  deltaContent: Retention4,                  // 'not-observed' when no content chunks were observed
  providerNative: Retention3,                // 'not-applicable' when no provider response existed (pre-dispatch)
  providerErrorBody: Retention3,             // 'not-applicable' when no provider error occurred
  wireBytes: Retention3,                     // 'not-applicable' on pre-dispatch paths (no upstream bytes)
  postTerminalContent: PostTerminal,         // §6.6 — deterministic three-state fact
  unmappedDeltaFields: readonly UnmappedDeltaFieldCategory[],  // closed categories, deduplicated, table-ordered
  unrecognizedExtensionFrameObserved: boolean,
  headerValuesBeyondAllowlist: boolean,
  contentTypeParametersDropped: boolean,
  maskedContent: boolean,
  contentEncodingUnsupported: boolean,
  multimodalContentObserved: boolean,        // any multimodal request part observed (payloads not retained, §8.7)
  requestMessageUnknownKeysObserved: boolean, // any unknown message key / unknown part kind observed (§8.7)
  unrecognizedRoleObserved: boolean,         // any unrecognized request-message role observed; the raw value is
                                             //   NEVER retained — only this closed fact + the derived loss (§8.7)
  sseMetadataObservedButNotRetained: boolean, // any `event:`/`id:`/`retry:` field value observed on the SSE
                                             //   stream and not retained; comment lines are keepalives and are
                                             //   NEVER counted here (§6.1). Raw field values are never stored
};
```

Assignment rules (applicability-aware):

- `requestBody` (phase-accurate): `'no-bytes-observed'` **only** when body
  processing ended before any byte was observed (a body-read failure at the
  start); `'partially-observed-not-retained'` when body processing ended
  with only part of the body read (mid-body connection loss, the over-limit
  cutoff); `'fully-observed-not-retained'` when the complete body was read
  and intentionally not retained (the default for valid requests);
  `'retained'` never in the default profile. An over-limit body or a
  connection failure partway through the body is **never** described as
  "no body was read" — it is `'partially-observed-not-retained'` with the
  derived wording "not fully observed" (§7.3.2).
- `messageContent`/`deltaContent`: `'fully-retained'` when every retained
  representation is complete at the boundary; `'partially-retained'` when
  any representation was shortened by the boundary; `'omitted'` when
  content existed but no canonical representation was written — including
  **valid pre-dispatch paths** (missing key, key-unavailable, unroutable)
  where the complete valid request and its normalized message content were
  observed but no `model_request` is emitted (§10.2): the fact is
  `'omitted'`, **never** `'not-observed'` merely because the canonical
  event was omitted; `'not-observed'` is exact — no request-message
  content was ever formed (invalid JSON, body-read failure, over-limit
  cutoff). Aggregate precedence across representations is defined in
  §7.3.3.
- `providerNative`: `'retained'` only under the `providerNative` contract
  (§7.2); `'not-retained'` when a provider response existed and native JSON
  was not retained; `'not-applicable'` when no provider response existed
  (pre-dispatch paths).
- `providerErrorBody`: `'not-applicable'` when **no provider error occurred**
  (e.g. completed streams, pre-dispatch rejections); `'retained'`/
  `'not-retained'` only when a provider error frame or upstream error body
  was observed.
- `wireBytes`: `'not-applicable'` on pre-dispatch paths (no upstream bytes
  existed); `'not-retained'` when upstream bytes existed and were not
  retained (the default); `'retained'` never in the default profile.
- `postTerminalContent`: exactly per §6.6 (`none-observed` /
  `observed-not-retained` / `unknown`).

#### 7.3.2 Derivation table (deterministic; persisted as the derived completeness field)

`declaredLosses` is a `readonly DeclaredLossCode[]` — a **closed code list**,
**derived** by `deriveCompleteness` from the authoritative loss facts (+ the
canonical events), serialized at `EvidenceRecord.completeness.declaredLosses`
(§13.4), validated (unknown codes are refused), deterministically ordered
(deduplicated, ordered by the table below), and classified by the
`metadata-safe` v1.1.0 policy (§14). **`boundaryStatement` is derived from
these codes and is never the only persisted loss record.**

| Code | Meaning (derived display sentence) | Derived only when |
|---|---|---|
| `request-body-not-retained` | The full request body was observed but not retained. | `losses.requestBody === 'fully-observed-not-retained'` |
| `request-body-not-fully-observed` | The request body was not fully observed (zero bytes or only part of it). Distinct wording from "observed but not retained": the body processing ended before the complete body was read. | `losses.requestBody === 'no-bytes-observed' \|\| 'partially-observed-not-retained'` |
| `message-content-not-retained` | Request message content beyond the retained representation was not retained. | `losses.messageContent === 'partially-retained' \|\| 'omitted'` — incl. valid pre-dispatch paths (missing key / key-unavailable / unroutable) where normalized message content was observed but no `model_request` was emitted (§7.3.1) |
| `delta-content-not-retained` | Chunk delta content beyond the retained representation was not retained. | `losses.deltaContent === 'partially-retained' \|\| 'omitted'` |
| `unmapped-delta-fields` | Content-delta sub-fields not represented by the canonical text delta were not retained. | `losses.unmappedDeltaFields.length > 0` |
| `provider-native-not-retained` | The provider-native payload was not retained. | `losses.providerNative === 'not-retained'` — **never** when `'not-applicable'` (no provider response) |
| `provider-error-body-not-retained` | The provider error frame's raw body was not retained. | `losses.providerErrorBody === 'not-retained'` — **never** when `'not-applicable'` (no provider error occurred) |
| `wire-bytes-not-retained` | Transport bytes were not retained (only excerpts and metadata). | `losses.wireBytes === 'not-retained'` — **never** on a pre-dispatch path (`'not-applicable'`) |
| `post-terminal-content-not-retained` | Trailing content after the terminal was actually observed and intentionally not retained. | `losses.postTerminalContent === 'observed-not-retained'` |
| `post-terminal-content-unknown` | Whether trailing content existed after the terminal could not be determined. | `losses.postTerminalContent === 'unknown'` |
| `remainder-after-observation-detach-not-observed` | Content after observation detached was not observed or retained. | observation terminal is `observation-detached` (event-derived, §13.2) |
| `remainder-after-client-cancellation` | The stream remainder after client cancellation was not retained. | observation terminal is `client-cancelled` **and a response stream/remainder existed** (headers were observed — `decoderDisposition` is `openai-sse`/`unsupported-encoding` or `model_response` exists); **never** when cancellation happened before any response bytes |
| `remainder-after-ingress-cancellation` | The stream remainder after ingress cancellation was not retained. | observation terminal is `ingress-cancelled` **and a response stream/remainder existed** (as above); **never** on pre-headers cancellation |
| `provider-usage-absent` | The provider reported no usage. | no `model_usage` event observed **and** `decoderDisposition === 'openai-sse'` (an SSE provider response was observed and the decoder was invoked) — **never** on request-failed, connect-failed, HTTP-error, non-SSE, header-less, or zero-frame-failure paths (an SSE stream that ended before producing any frame derives no usage claim) |
| `finish-reason-absent` | The stream ended without a finish reason. | no chunk envelope carried `finishReason` **and** `decoderDisposition === 'openai-sse'` (a finish reason was applicable to an observed SSE stream) — **never** on non-SSE, header-less, or zero-frame-failure paths (an SSE stream that ended before producing any frame derives no finish-reason claim) |
| `multimodal-payload-not-retained` | Multimodal request-part payloads were not retained (only bounded metadata). | `losses.multimodalContentObserved === true` (§8.7) |
| `request-message-unknown-fields` | Unknown request-message keys / unknown part kinds were not retained (fail-closed). | `losses.requestMessageUnknownKeysObserved === true` (§8.7) |
| `unrecognized-role-not-retained` | An unrecognized request-message role was observed and its raw value was not retained (the closed `'unrecognized'` sentinel replaces it). | `losses.unrecognizedRoleObserved === true` (§8.7) |
| `sse-metadata-not-retained` | SSE `event:`/`id:`/`retry:` field values were observed and not retained. Comment lines are protocol keepalives and are never counted (§6.1). | `losses.sseMetadataObservedButNotRetained === true` — only on an observed SSE stream (`decoderDisposition` is `openai-sse`/`unsupported-encoding`); never on non-SSE, header-less, or pre-dispatch paths |
| `unrecognized-provider-field` | Provider JSON fields not mapped to the canonical model were not retained. | decoder classification facts (unmapped fields beyond the closed delta categories) |
| `unrecognized-extension-frame` | A frame that decoded to no recognized shape was not retained. | `losses.unrecognizedExtensionFrameObserved === true` |
| `response-header-values-not-retained` | Upstream response header values outside the allowlist were not retained. | `losses.headerValuesBeyondAllowlist === true` |
| `content-type-parameters-not-retained` | Media-type parameters were dropped from the retained `content-type`. | `losses.contentTypeParametersDropped === true` |
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
- The previous inverted/ambiguous derivation
  (`messagesContentRetained === true && truncated`) is removed: retention is
  a single authoritative state fact, and a loss is derived from the fact
  alone — never from a boolean combined with event evidence that could
  contradict it.
- `post-terminal-content-not-retained` is emitted **only** when trailing
  content was actually observed and intentionally not retained; an unknown
  remainder derives `post-terminal-content-unknown` — the spec never asserts
  content existed merely because it could not be excluded.
- Deterministic derivation: order = table order above; deduplication = each
  code at most once; derivation = from `captureBoundary.streaming.losses`
  facts + canonical events, never a static list and never copied from the
  boundary statement.

#### 7.3.3 Aggregate precedence and cross-validation

**Aggregate precedence** — `messageContent`/`deltaContent` aggregate the
per-representation outcomes (each request message content leaf, each chunk
delta):

```text
any 'omitted'              → 'omitted'            (wholesale omission dominates)
else any 'partially-retained' → 'partially-retained'   (shortening dominates complete retention)
else any 'fully-retained'  → 'fully-retained'
else                       → 'not-observed'      (no representations existed)
```

Mixed retention (some leaves fully retained, some truncated, some omitted)
therefore yields `'omitted'` when anything was omitted wholesale,
`'partially-retained'` otherwise when anything was shortened, and
`'fully-retained'` only when every representation is complete at the
boundary. `'not-observed'` is exact: no representations existed.

**Cross-validation (boundary facts vs. event statuses and declarations)** —
`deriveCompleteness` recomputes the boundary-derived facts from the
canonical events and declarations, and parse rejects disagreement
(`completeness_disagrees_with_derivation`):

- `deltaContent === 'fully-retained'` ⇒ no `model_response_chunk` event has
  event-level `evidenceStatus: 'truncated'` and every retained `deltaText`
  is complete at the cap;
- any `model_response_chunk` with `evidenceStatus: 'truncated'` ⇒
  `deltaContent ∈ {'partially-retained', 'omitted'}`;
- `deltaContent === 'not-observed'` ⇒ **no** chunk event carries a retained
  `deltaText`;
- **leaf-level request ownership** (the aggregate never authorizes leaves):
  - the `model_request` event-level `evidenceStatus` (when present) must
    equal the §7.3.3 aggregate precedence of the leaf statuses — a forged
    aggregate that disagrees with the serialized leaves fails parse;
  - each serialized leaf's `evidenceStatus` is authoritative for that leaf
    alone: a leaf with `redacted` requires its own `redaction`
    declaration; a leaf with `truncated` requires its own `truncation`
    declaration; a leaf may carry **both** declarations (masked **and**
    shortened — neither transformation is erased), in which case its
    status is `redacted` (precedence) and both declarations must hold;
  - `truncation.maxLength` must equal the applied cap (240 for the
    v1.0.0 profile, §8.3); `truncation.originalLength` ≥
    `truncation.retainedLength`; `truncation.retainedLength` equals the
    retained leaf text length in code points; `redaction.maskedCodePoints`
    is a real masked count ≥ 1 per span, and `redaction.spanCount` ≥ 1;
  - a missing, malformed, or contradictory leaf declaration (e.g.
    `redacted` without `redaction`, or a declaration whose lengths disagree
    with the retained text) fails parse;
  - `messageContent === 'not-observed'` ⇒ no request-message content leaves
    exist (empty or absent `messages`, or no normalized messages were ever
    formed on a pre-dispatch path); `messageContent === 'omitted'` ⇒
    content leaves existed in the observed request but no canonical
    representation was written (valid pre-dispatch path, §7.3.1);
- any content leaf with owning status `redacted` ⇒ `maskedContent === true`;
- `maskedContent === true` ⇒ at least one leaf carries `redacted`;
- `providerNative === 'retained'` ⇒ at least one event carries a
  `providerNative` payload with an owning status;
- declaration lengths (`maxLength`/`originalLength`) agree with the actual
  retained representations;
- `unrecognizedRoleObserved === true` ⇒ at least one normalized message
  carries `role: 'unrecognized'` (and vice versa); the raw unknown role
  value appears nowhere in the record;
- `sseMetadataObservedButNotRetained === true` ⇒ at least one parsed SSE
  frame carried an `event:`/`id:`/`retry:` field on an observed SSE path;
- a fact and an event cannot disagree (e.g. `'fully-retained'` with a
  `truncated` status is a parse failure, not a warning).

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
rule whose admission is mechanical and non-spoofable (§14.2). The default
claim is "expected admissible, rejection still possible", never "rejection
impossible".**

### 8.1 Default capture profile

- Default capture profile: `signalglass.collection.ingress-metadata-safe`,
  version `1.0.0`, recorded authoritatively on
  `captureBoundary.streaming.captureProfile` and derived on
  `trace.captureProfile` (Spec 013 §9; §13.4 cross-check).
  Collection policy (what is captured), persistence policy (what is stored —
  `metadata-safe` v1.1.0, §14), and export policy (out of scope here) are
  three independent policies.
- Default retained values per interaction:
  - structural metadata (routing, model, timing, ids, statuses, seq,
    authoritative streaming boundary facts, declared losses);
  - request messages and chunk deltas as **bounded retained representations**
    (default cap 240 code points; §8.3) with honest owning statuses: benign
    content that fits the cap is `captured`; shortened content is
    `truncated`; masked content is `redacted`. Request messages use the
    normalized representation of §8.7; retained chunk-delta text has a
    single canonical home: `responseEnvelope.deltaText` (§13.5).
  - provider-reported usage values, verbatim (as `UsageValue`s, §13.6);
  - normalized finish reasons;
  - structural error text (§8.4);
  - response metadata: `statusCode` + normalized `content-type`
    (+ `content-encoding` when present) via `responseMeta` on the
    `model_response` event (§13.3);
  - the completeness summary with derived lifecycle/loss fields.
- **Not retained by default**: raw request bodies, raw provider payloads
  (`provider-native-not-retained`), raw wire bytes, unmapped delta sub-fields
  (closed categories, §7.3), and any header values outside the allowlist
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
   credential that straddles the 240-code-point boundary is masked in full.
4. **Retain with an honest status** — after masking, the length boundary is
   applied, and the owning status describes the transformation actually
   applied (§7.1):
   - `redacted` — a span was actually masked (`original-content-masked`);
   - `truncated` — characters were actually removed (retained length <
     post-redaction candidate length);
   - `captured` — the retained representation is complete at the declared
     boundary (benign content that fits the cap);
   each retained request-content leaf serializes its own status and its own
   `RedactionDeclaration`/`TruncationDeclaration` (real lengths; a leaf
   masked **and** shortened carries both declarations, §8.7); chunk deltas
   carry the same declarations at event level (one leaf per chunk event,
   §13.5).
5. **Declare** — the loss facts and declarations are attached; the
   `metadata-safe` v1.1.0 classification then sees either declared content
   or bounded captured content at the closed admitted paths (§14.2).
6. **The gate still runs** — the Spec 015 storage-safety gate and the
   persistence policy are **non-bypassable** and run on every save,
   including saves of records produced by the collection pipeline.

### 8.3 Excerpt bounds (decided, deterministic)

- **The `signalglass.collection.ingress-metadata-safe` v1.0.0 cap is
  exactly 240 code points** — matching the reference policy's own character
  counting (`countCodePoints`, Spec 015). There is **no
  runtime-configurable range**: parsers and policies can always know the
  interaction's cap from the serialized record because the v1.0.0 profile
  identity **is** the cap. (The revision-6 "valid 64–4096" claim is
  removed: a parser or policy cannot know a runtime-configured cap from the
  record, and the record never carries a record-supplied cap.)
- The cap is the **maximum retained length per string leaf** — each
  retained request-content leaf (§8.7) and each chunk's `deltaText`
  (§13.5) is bounded **independently** at 240 code points. **Total
  retained content is bounded by the decided evidence budget
  `maxRetainedContentCodePoints`** (§3.5) — the leaf count is **not** left
  to "the stream's own chunk count", which is not a bound.
- **Changing the cap requires a capture-profile version bump AND a matching
  policy contract**: a future profile version (e.g. `v1.1.0` with cap 512)
  is meaningless without a corresponding persistence-policy contract that
  validates against that cap; the v1.0.0 profile and the `metadata-safe`
  v1.0.0/v1.1.0 policies recognize exactly 240 code points (§14.2, §15.1).
  The version-bump rule is normative, so this is no longer an open
  question.

### 8.4 Structural error text

- Error payloads contain fixed, bounded, **structural** text: a closed error
  code (`error.type`, §9.2), a bounded description (≤200 chars) built from
  structural facts, and no headers, no secrets, no raw provider error bodies.
  The provider's raw error body is declared lost
  (`provider-error-body-not-retained` — derived only when a provider error
  actually occurred, §7.3).
- The description never embeds: request URLs with query strings, API keys,
  authorization values, cookies, or raw payload excerpts.

### 8.5 Bounded captured content and the v1.1.0 admission rule

- **Decision**: benign content that fits the cap and passed the versioned
  sensitive detector is retained as `captured` (complete at the declared
  boundary) and is admitted by an **explicit new `metadata-safe` v1.1.0
  rule** (Rule 2, §14.2).
- **Why a new rule is required**: the v1.0.0 policy admits content-bearing
  fields only under an owning `redacted`/`truncated` declaration
  (`isDeclaredContent`); a `captured` content-bearing field is rejected by
  v1.0.0 (its `captured-content` rejection code). The v1.1.0 rule makes the
  honest `captured` status admissible — **mechanically**, at a closed list
  of paths, without trusting any claimed pedigree (§14.2).
- **Privacy and admission consequences (explicit)**: a `captured` value is
  real content in the store — it is not hidden behind a redaction
  declaration, so the **versioned sensitive detector is the sole content
  protection** for the bounded captured text. Consequences:
  - the detector version is part of the capture profile and is recorded
    (§15);
  - the cap bounds the maximum retained text (≤ 240 code points for the
    v1.0.0 profile, §8.3);
  - a detector miss can reach the storage-safety gate; a rejection is
    surfaced as `safety-rejected` and is never auto-labeled a code defect
    (§8.6);
  - **the admission is mechanical, not credential-based**: the policy and
    the gate evaluate the actual submitted record (§14.2) — a caller that
    spoofs the capture-profile/detector pedigree cannot bypass either;
  - the admission is explicit and versioned — **Spec 015 v1.0.0 is not
    weakened and is never silently reinterpreted**; v1.0.0 remains the
    declared-only policy, and 1.1 records are rejected by v1.0.0 (§14.3).

### 8.6 The honest admission claim

- **Construction invariant (tested)**: default-profile records are expected
  to be policy-admissible under `metadata-safe` v1.1.0 — the collection
  pipeline is designed and tested so that no default record carries an
  S1/S2/S3/S5/S6 witness (sentinel tests §21 T72–T74: a credential beginning
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

### 8.7 The normalized request-message representation (captured-content shape)

`RequestEnvelope.messages` is typed `unknown` in the 1.0.0 model; Spec 016
**defines the exact normalized representation the streaming assembler
writes into schema ≥ 1.1.x records only** (§13.7) — the shape the
persistence rule's "message content length ≤ cap" actually measures. A
1.0.x record's `messages` value is arbitrary legacy data, parsed and
round-tripped unchanged, **never reinterpreted** as this representation
(§13.7). The normalized representation is closed and fail-closed: **an
arbitrary object's serialized length is never treated as message-content
attestation** — only the closed leaf strings below are content, measured
per leaf in code points.

**Every retained string on a content path is a serialized `ContentLeaf`**
carrying the retained string, its **own** evidence status, and its **own**
redaction/truncation declarations with real lengths. The leaf is the
canonical serialized form: the assembler writes the same value to the
canonical `model_request.requestEnvelope.messages` **and** the raw
observation payload, so serializer/parse round trips through both are
identical — there is no raw-only side channel and nothing is discarded
during projection (Spec 014 raw-observation participation).

```ts
// canonical normalized request representation (assembler L4 output, schema ≥ 1.1.x only)
type KnownRole = 'system' | 'user' | 'assistant' | 'tool' | 'developer' | 'function';
type NormalizedRole = KnownRole | 'unrecognized';   // closed; the raw unknown role string is
                                                    // NEVER retained — only the sentinel (§7.3
                                                    // unrecognized-role-not-retained)

type LeafOwnerStatus = 'captured' | 'truncated' | 'redacted';   // closed (§7.1); describes the
                                                                // transformation actually applied to THIS leaf

type RedactionDeclaration = {           // real masked-characters accounting
  spanCount: number;                    // number of sensitive spans actually masked (≥ 1)
  maskedCodePoints: number;             // real masked character count (code points, ≥ 1 per span)
};

type TruncationDeclaration = {          // real retained-characters accounting
  originalLength: number;               // post-redaction candidate length (code points)
  retainedLength: number;               // retained length (code points; equals leaf text length)
  maxLength: number;                    // the applied cap — exactly 240 for the v1.0.0 profile (§8.3)
};

type ContentLeaf = {                    // the exact serialized leaf: the only content home
  text: string;                         // retained string: post-redaction, then post-boundary
  evidenceStatus: LeafOwnerStatus;      // owns THIS leaf only — never borrowed from the event
  redaction?: RedactionDeclaration;     // present iff a span was actually masked
  truncation?: TruncationDeclaration;   // present iff characters were actually removed
};
// A leaf that was BOTH masked and shortened carries BOTH declarations; its
// evidenceStatus is 'redacted' (precedence) — neither transformation is erased.

type NormalizedContentPart =
  | { kind: 'text'; text: ContentLeaf }                       // content leaf
  | { kind: 'image_url'; url: ContentLeaf }                   // bounded URL string leaf (≤ 240);
                                                              //   the image payload is never retained
                                                              //   (§7.3 multimodal-payload-not-retained)
  | { kind: 'tool_call'; id: string; name: string; arguments: ContentLeaf }   // arguments = content leaf
  | { kind: 'tool_result'; toolCallId: string; content: ContentLeaf };        // content = content leaf

type NormalizedRequestMessage = {
  role: NormalizedRole;                 // closed role discriminant; the 'unrecognized' sentinel is
                                        //   the only trace of an unknown role value — the raw value is
                                        //   never retained and never length-measured as content
  content: ContentLeaf | readonly NormalizedContentPart[];   // string-form content is ONE leaf
  name?: string;                        // bounded metadata label (≤ 128 code points, parse-enforced),
                                        //   never content-attested
};

// RequestEnvelope.messages: readonly NormalizedRequestMessage[]  (schema ≥ 1.1.x records only)
```

Rules:

- **Array/object structure**: `messages` is an array of message objects;
  each object has exactly the permitted keys `role`, `content`, `name`.
  `content` is a single `ContentLeaf` (common string case) or an array of
  closed content parts. **A plain string is not a valid serialized leaf**
  — string-form content is the leaf object `{ text, evidenceStatus,
  redaction?, truncation? }`.
- **Role handling (one exact contract)**: `role` is a closed discriminant
  from `KnownRole | 'unrecognized'`. An unrecognized role string is
  **never preserved** — it is replaced by the `'unrecognized'` sentinel
  and the closed loss fact `unrecognizedRoleObserved` derives
  `unrecognized-role-not-retained` (§7.3). The spec never claims "closed
  roles" while preserving arbitrary strings: the raw value appears nowhere
  in the record. Role and other metadata labels are **bounded** (≤ 128
  code points, parse-enforced) and never content-attested or
  length-measured as content.
- **Content leaves (the only measured strings)**: every content string is
  a leaf: string-form `content.text`; `content[].text.text`;
  `content[].tool_call.arguments.text`;
  `content[].tool_result.content.text`; `content[].image_url.url.text`
  (bounded URL). Each leaf is measured **per leaf** in code points against
  the v1.0.0 cap (exactly 240, §8.3); total retained content is bounded by
  `maxRetainedContentCodePoints` (§3.5).
- **Leaf-level ownership**: each leaf's `evidenceStatus` and declarations
  describe that leaf's own transformation. A leaf with `captured` has no
  declarations; `truncated` requires `truncation`; `redacted` requires
  `redaction`; both requires both (§7.3.3 cross-validation).
- **The event-level status is a derived aggregate, never an authority**: the
  `model_request` event-level `evidenceStatus` (and the `messageContent`
  fact) is the §7.3.3 aggregate precedence of the leaf statuses. It
  **never authorizes nested leaves for persistence**: a `captured`
  event-level status does not make any leaf admissible, and a forged
  aggregate that disagrees with the serialized leaves fails parse.
- **Metadata (never measured)**: `role` (closed discriminant), `name`,
  `tool_call.id`, `tool_call.name`, `tool_result.toolCallId` — bounded
  labels (≤ 128 code points, parse-enforced), never content-attested.
- **Unknown-key behavior (fail-closed)**: a message key outside
  `role`/`content`/`name`, or a content part whose `kind` is outside the
  closed set, is **not normalized, not retained, and never used for length
  attestation**; it is declared via `request-message-unknown-fields`
  (§7.3) — the message's own known leaves may still be retained.
- **Multimodal/tool-call parts**: `tool_call`/`tool_result` parts retain
  their content leaves (each ≤ 240); `image_url` parts retain only the
  bounded URL leaf — the binary payload is never retained
  (`multimodal-payload-not-retained` when any multimodal part was
  observed, §7.3). Unsupported part kinds (e.g. audio) are fail-closed
  unknown parts (§8.7 unknown-key rule).
- **Captured-content policy paths** (Rule 2, §14.2) — the actual serialized
  string locations: `messages[].content.text` (string-form leaf),
  `messages[].content[].text.text`, `messages[].content[].tool_call.arguments.text`,
  `messages[].content[].tool_result.content.text`, and
  `messages[].content[].image_url.url.text`. Every other string path is a
  metadata label or excluded — never admitted as captured content. Rule 1
  and Rule 2 inspect **each leaf's own status, declaration, path, and
  length** (§14.2).
- **Version-aware scope**: the closed shape, leaf validation, and
  admitted paths apply to schema ≥ 1.1.x records only; a 1.0.x record's
  `messages` is arbitrary legacy data and is never reinterpreted (§13.7,
  T133).
- Serialization/parse validation: the shape above is enforced at parse for
  ≥ 1.1.x records (unknown keys/part kinds are only allowed to be absent —
  the normalized form never contains them); length bounds are enforced per
  leaf; raw-observation and canonical `messages` round-trip identically;
  leaf declarations cross-validate with the aggregate facts (§7.3.3).
---

## 9. Error taxonomy

**Decision 9 — diagnostics carry only closed codes and bounded structural
descriptions; every terminal is classified exactly once; the
`error`/`cancelled` event shapes are closed (actor / lifecycleTarget /
lifecycleEffect; `requestedBy`); separate closed code surfaces are declared
for provider error frames, non-SSE responses, upstream HTTP status, transport
connection failure, internal decoder failure, and malformed provider streams;
request-key failures are classified under `request-failed` (actor
`capture`), not under upstream failures.**

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
  error: { type: string; message?: string },    // ErrorPayload (Spec 013 §3.3);
                                                // type = a closed code from §9.2
}

// cancelled event (EventRecord with kind 'cancelled')
{
  kind: 'cancelled',
  lifecycleTarget: 'trace' | 'span' | 'none',
  lifecycleEffect: 'cancel',
  cancellation: { requestedBy: string },        // 'client' | 'ingress'
}
```

- **`error.type` carries the closed classification code** (§9.2);
  `error.message` is bounded structural text ≤ 200 chars (§8.4) and is
  **never the classification** — two events with the same code may have
  different bounded messages, and the message never determines any outcome.
  The payload never contains: exception messages, stack traces, request
  URLs, identities, documents, digests, header values, or raw provider
  bodies (Spec 013 §4.4; §8.4). Diagnostics are leak-free by construction:
  **internal results may be rich; the persisted/logged projection carries
  only closed codes and bounded structural text** (§16.4).
- Error/cancelled events are payload-bearing, so they carry `evidenceStatus`
  (`captured` — structural metadata only) and an observationRole per the
  classification source: `provider_reported` for provider-side
  classifications (`upstream-failed`, `malformed-stream`); `unobservable`
  for observer failures (`observation-detached`); `application_constructed`
  for ingress-constructed classifications (`request-failed`).
- `lifecycleTarget: "trace"` requires `spanId: null`; `lifecycleTarget:
  "span"` requires the matching `spanId`; `lifecycleTarget: "none"`
  changes no status (Spec 014 §4.7, `terminal_declaration_not_final`).

### 9.2 Closed code surfaces (every code is declared; descriptions never classify)

```ts
// (1) Provider error frame — the provider stream carried an `error` object frame.
type ProviderErrorFrameCode = 'provider-error-frame';

// (2) Non-SSE response — a 2xx response whose content-type is not text/event-stream.
type NonSseResponseCode = 'non-sse-response';

// (3) Upstream HTTP status — carried numerically in responseMeta.statusCode (§13.3),
//     never a classification string; 100–599.
type UpstreamStatus = number;

// (4) Transport connection failure — genuine upstream failure before response headers.
type TransportFailureCode =
  | 'connection-error'
  | 'upstream-timeout'
  | 'tls-failure';

// (5) Internal decoder failure — observer failure, detaches observation.
type InternalDecoderFailureCode = 'decode-error';

// (6) Malformed provider stream.
type MalformedStreamCode =
  | 'sse-invalid-data-json'
  | 'sse-invalid-utf8'
  | 'sse-invalid-choice-index'
  | 'sse-partial-frame-at-eof'
  | 'sse-eof-without-done';

// Terminal `error.type` values (closed). `http-error-status` is used for
// upstream non-2xx (the numeric status lives in responseMeta.statusCode).
type UpstreamFailureCode =
  | TransportFailureCode          // connection-error | upstream-timeout | tls-failure
  | 'http-error-status'
  | ProviderErrorFrameCode        // 'provider-error-frame'
  | NonSseResponseCode;           // 'non-sse-response'

type ClientRequestFailureCode =
  | 'invalid-request'             // 400-class: malformed body, invalid fields, unknown model, over-limit
  | 'missing-api-key'             // no API key env var configured
  | 'key-unavailable'             // key env var referenced but unset/unresolvable at dispatch
  | 'unroutable'                  // no provider matches the requested model
  | 'body-read-failure';          // the request body could not be read

type ObservationFailureCode =      // internal observer failures (detach, §1.4)
  | 'frame-overflow'
  | 'record-budget-exceeded'        // evidence budgets exhausted (§3.5)
  | 'observation-encoding-unsupported'
  | 'observation-decode-failure'
  | 'internal-capture-error';

type TerminalReason =              // derived from the final canonical event (§13.2)
  | 'completed'
  | 'upstream-failed'
  | 'client-cancelled'
  | 'ingress-cancelled'
  | 'malformed-stream'
  | 'request-failed'
  | 'observation-detached';

type AbortReason =                 // derivation aid (never persisted); feeds requestedBy / the cause
  | 'client-disconnect'
  | 'ingress-shutdown'
  | 'idle-timeout'
  | 'observation-detached'
  | 'request-failed';
```

- **Every code used by `FrameDecodeResult` (§6.2), the decoder, the
  assembler, and the terminal matrix is declared above.** `UpstreamFailureCode`
  now includes `provider-error-frame` and `non-sse-response` — the two
  classifications the terminal matrix uses but the revision-4 union omitted.
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
  `client-disconnect` → `requestedBy: 'client'` and upstream cause
  `client-disconnect`; `ingress-shutdown` / `idle-timeout` →
  `requestedBy: 'ingress'` and upstream cause `ingress-shutdown` /
  `configured-limit`; `observation-detached` / `request-failed` produce no
  `cancelled` event. It is a **derivation aid, not a persisted field** — the
  persisted facts are the upstream/client-response outcomes and the derived
  observation terminal (§2.5); the abort reason is never fabricated.
- `TransportFailureCode` values surface as `error.type` on the terminal
  `error` for `connection-failed` upstream outcomes; the upstream outcome is
  still recorded separately (§2).

### 9.3 Classification matrix (one terminal, one classification)

| Observed situation | Terminal | Error/cancelled event (when emitted) | actor / lifecycleTarget / lifecycleEffect | `error.type` |
|---|---|---|---|---|
| `[DONE]` observed | `completed` | — (no error/cancelled event; `span_end` + `interaction_end` final) | — | — |
| Invalid request body, missing key, key-unavailable, unroutable, over-limit | `request-failed` | `error` (final) | `capture` / `trace` / `fail` | `invalid-request` \| `missing-api-key` \| `key-unavailable` \| `unroutable` \| `body-read-failure` |
| Upstream connect/timeout/TLS failure | `upstream-failed` | `error` (final) | `model` / `trace` / `fail` | `connection-error` \| `upstream-timeout` \| `tls-failure` |
| Upstream non-2xx status | `upstream-failed` | `error` (final) | `model` / `trace` / `fail` | `http-error-status` (numeric status in `responseMeta.statusCode`) |
| Non-SSE 2xx (valid body forwarded) | `upstream-failed` | `error` (final) | `model` / `trace` / `fail` | `non-sse-response` |
| Non-SSE 2xx (invalid/non-object body → 502) | `upstream-failed` | `error` (final) | `model` / `trace` / `fail` | `non-sse-response` |
| Provider error frame | `upstream-failed` | `error` (final) | `model` / `trace` / `fail` | `provider-error-frame` |
| Malformed stream (5 codes) | `malformed-stream` | `error` (final) | `model` / `trace` / `fail` | the specific `sse-*` code |
| Client disconnect mid-stream | `client-cancelled` | `cancelled` (final; requestedBy `client`) | — / `trace` / `cancel` | — |
| Ingress shutdown / idle timeout | `ingress-cancelled` | `cancelled` (final; requestedBy `ingress`) | — / `trace` / `cancel` | — |
| Internal observer failure | `observation-detached` | informational `error` (final) | `capture` / `none` / `none` | `frame-overflow` \| `observation-encoding-unsupported` \| `observation-decode-failure` \| `internal-capture-error` |

Every terminal appears in exactly one row; every classification maps to
exactly one terminal. The upstream outcome and client-response outcome are
then recorded independently per §2 and never rewritten by this matrix. Each
`error`/`cancelled` row is the record's **final canonical event** (Spec 014
§4.7: no `interaction_end` after a terminal declaration); `completed` is the
only terminal whose final event is `interaction_end`.

---

## 10. The observation state machine

**Decision 10 — the assembler is a single deterministic state machine over
the observation lifecycle; the machine starts at request observation, so
pre-dispatch failures are reachable states with valid records; every
terminal ends with exactly one final canonical event (`interaction_end` only
on `completed`; the causal `error`/`cancelled` declaration otherwise) —
nothing follows the final event (Spec 014 §4.7).**

### 10.1 States

```text
initial ──request observed──▶ request-observed ──valid request, key/provider available──▶ awaiting-response
                              │  pre-dispatch failure (invalid/incomplete/over-limit/
                              │  unroutable/key-unavailable/body-read) ──▶ request-failed
                              ▼
                         awaiting-response
                              │  headers observed → model_response event (§6.7) → observing-stream
                              │  upstream connection failure → upstream-failed
                              │  client disconnect / ingress shutdown / limit → client-cancelled / ingress-cancelled
                              ▼
                         observing-stream
                              │  [DONE] → completed
                              │  upstream error → upstream-failed
                              │  provider error frame / non-SSE 2xx → upstream-failed
                              │  malformed frame → malformed-stream
                              │  client disconnect → client-cancelled
                              │  ingress limit/shutdown → ingress-cancelled
                              │  observer failure → observation-detached
                              ▼
                       terminal (one of the seven)
```

States: `initial`, `request-observed`, `awaiting-response`, `observing-stream`,
and the seven terminal states (§9.2). The client-response path and the
observation lifecycle advance independently; the observation machine never
waits on the client socket.

### 10.2 Transitions

| From | Event | To |
|---|---|---|
| `initial` | Request observed — assign `traceId == interactionId`, emit `interaction_start` (seq 0), begin bounded body processing | `request-observed` |
| `request-observed` | Pre-dispatch failure: invalid/incomplete body, over-limit, unroutable, key-unavailable, missing key, body-read failure | `request-failed` |
| `request-observed` | Body validated; provider/key available; dispatch begins | `awaiting-response` |
| `awaiting-response` | Response headers observed | `observing-stream` |
| `awaiting-response` | Upstream connection failure (first-observed, §2.4) | `upstream-failed` |
| `awaiting-response` | Client disconnect processed (cancels the upstream, §2.4) | `client-cancelled` |
| `awaiting-response` | Ingress shutdown/limit processed | `ingress-cancelled` |
| `observing-stream` | `[DONE]` observed | `completed` |
| `observing-stream` | Upstream HTTP error / non-SSE 2xx / provider error frame | `upstream-failed` |
| `observing-stream` | Malformed frame (5 codes) | `malformed-stream` |
| `observing-stream` | Client disconnect processed | `client-cancelled` |
| `observing-stream` | Ingress shutdown/limit processed | `ingress-cancelled` |
| `observing-stream` | Observer failure (frame-overflow, evidence-budget exhaustion §3.5, encoding-unsupported, decode-failure, internal) | `observation-detached` |

- **Every pre-dispatch failure is reachable from `request-observed`** — the
  rev-4 table wrongly transitioned invalid/missing-key/over-limit/unroutable
  from `awaiting-response`. A request observed but rejected before dispatch
  still produces a **valid canonical record**: `interaction_start` (seq 0)
  followed by the final terminal `error` (actor `capture`, trace/fail); **no
  model span, no `model_request`** (the canonical request was not observed at
  its declared boundary), and **no fabricated `interaction_end`** (Spec 014
  §4.7). The record parses: status `failed`, terminal `request-failed`.
- **Pre-dispatch body/message stage matrix** (losses are phase-accurate,
  §7.3):

  | Pre-dispatch path | Typical body observation fact | `messageContent` | Derived message-content loss |
  |---|---|---|---|
  | `invalid-request` (malformed JSON / invalid fields) | `partially-observed-not-retained` (parse ended mid-body) or `no-bytes-observed` | `not-observed` (no normalized messages were ever formed) | none (nothing existed) |
  | `body-read-failure` | `no-bytes-observed` (zero bytes) or `partially-observed-not-retained` (mid-body) | `not-observed` | none (nothing existed) |
  | `over-limit` | `partially-observed-not-retained` (cutoff) | `not-observed` | none (nothing existed) |
  | `missing-api-key` (complete valid request read) | `fully-observed-not-retained` | **`omitted`** | **`message-content-not-retained`** |
  | `key-unavailable` (complete valid request read) | `fully-observed-not-retained` | **`omitted`** | **`message-content-not-retained`** |
  | `unroutable` (complete valid request read) | `fully-observed-not-retained` | **`omitted`** | **`message-content-not-retained`** |

  The rule: `not-observed` means **no normalized messages were ever formed**
  (invalid/partial/unreadable body); `omitted` means normalized message
  content **was** observed on a valid request but no canonical
  representation was written because no `model_request` is emitted on the
  pre-dispatch path — never `not-observed` merely because the canonical
  event was omitted (§7.3.1). The exact body fact is per actual observation
  (T129 tests zero-byte, partial-body, fully parsed, and normalized-message
  stages).
- Every terminal is reachable from defined states; no terminal is reachable
  from `initial` (a request that is never observed produces no record —
  nothing was observed, §3.1).
- The machine **never transitions out of a terminal state**: the terminal
  event is the record's **final** canonical event (`interaction_end` for
  `completed`; the `error`/`cancelled`/informational `error` declaration for
  the other terminals, §10.4), and no canonical event is emitted after it
  (trailing bytes are accounted structurally, §6.6).
- `observation-detached` from `observing-stream` means framing of the
  canonical stream stops; the passthrough continues (§1.4).

### 10.3 Status derivation (trace.status)

`trace.status` is **derived** from the observation terminal, which is itself
**derived from the final canonical event** (§13.2); status is never recorded
independently and never invented:

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
  `error` event (`actor`/`error.type` per §9.3, `lifecycleTarget: "trace"`,
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
  event mapping, §6.5, acceptance criterion 16, and the tests.

### 10.5 Terminal-event sequence (tested invariant)

```text
completed:        ... last content/usage (seq n) → span_end (n+1) → interaction_end (n+2)   [final]
failed:           ... last content/usage (seq n) → error (n+1, trace/fail)                    [final]
cancelled:        ... last content/usage (seq n) → cancelled (n+1, trace/cancel)               [final]
observation-detached: ... last content (seq n) → informational error (n+1, none/none)          [final]
request-failed:   interaction_start (0) → error (1, capture, trace/fail)                       [final]
   ── no canonical events after the final event on any terminal ──
```

Tests assert: exactly one final event per terminal; `interaction_end` only
on `completed`; the terminal declaration is always the record's final event;
nothing follows the final event; no double emission and no fabricated
`interaction_end` (T27–T35, T44, T107, T108).

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
  createSseParser()                 L2 SSE framing (incremental, bounded, [DONE]-aware,
                                    deterministic post-terminal continuation §6.1)
  SseParserOptions / FrameResult
  assembleTrace()                   L4 canonical event assembly from decoded events and
                                    explicit nondeterministic inputs (the single sequencing
                                    surface, Spec 013 §2.2; §12.2)
  AssemblerOptions / AssemblyResult
  captureBoundary builder           authoritative streaming boundary facts (§13.4)
  remainder/disposition helpers     post-terminal accounting (§6.6, §12.4)
  evidence-status helpers           §7.1 honest status assignment
  (pure functions only; no sockets, no streams, no http, no storage, no clock, no RNG)

@signalglass/providers (extended)
  decodeSseFrame(frame)             L3 provider-neutral normalized events (§6.2, §12.1)
  openai-sse decoder                the first adapter (contract name literal §15)
  StreamDecodedEvent                provider-neutral event union (§12.1)
  closed code surfaces              §9.2 (MalformedStreamCode, TransportFailureCode,
                                    ProviderErrorFrameCode, NonSseResponseCode,
                                    InternalDecoderFailureCode)

apps/ingress (extended)
  POST /v1/chat/completions         existing Spec 006 route gains the streaming path
  streamingForwarder                passthrough pipeline: L1–L4 wiring, backpressure (§5)
  boundedDecoderTee                 encoded-stream observation tee (§5.5)
  ingressStreamingController        client-response orchestration (Spec 006 error envelope
                                    semantics preserved: non-2xx normalization, invalid-body 502,
                                    pre-dispatch paths unchanged)

@signalglass/core (extended — projections)
  AgentRun / Turn / ContextBlock     legacy/consumer projection types (never extended with
                                    provider shapes; §12.2)
  projection-matrix + parity rows    updated for the new canonical fields (deltaText §13.5,
                                    normalized messages §8.7, decoderDisposition §13.4) in
                                    evidenceProjections/ (§21 T99/T100, §20 S5)
@signalglass/evidence (extended — schema/parse/derivation/serialization)
  schema 1.1: deltaText, decoderDisposition, RequestBodyRetention, request-message shape (§8.7)
  parseEvidenceRecord + version-aware validation (§13.7 MAJOR-1)
  deriveCompleteness (aggregate precedence + cross-validation §7.3.3), vocabulary, serialize
@signalglass/storage (extended — persistence policy)
  EvidenceStorage.saveEvidenceRecord (Spec 015) — the only persistence path (§3.1, §16)
  metadata-safe v1.1.0 reference policy (Rule 2, closed admitted paths §14.2) +
  policy-version recording + leak-free policy-failed reasons (§14.4)
```

- **Dependency direction**: `@signalglass/streaming` depends only on
  `@signalglass/evidence` types; it never imports providers, ingress, or
  storage. The ingress composes
  `@signalglass/streaming` + `@signalglass/providers` + `@signalglass/evidence`.
  `@signalglass/evidence`, `@signalglass/storage`, and `@signalglass/core`
  are **changed** by this spec (schema/parse/derivation/serialization; the
  v1.1.0 policy; projection rows) — the module map above is not a claim
  that they stay untouched.
- **Why streaming is network-free**: SSE framing, decoding, assembly,
  boundary-fact construction, and evidence-status logic are pure functions;
  keeping them out of the ingress package keeps them unit-testable without
  sockets and keeps `@signalglass/core` provider-agnostic (AGENTS.md
  architecture boundaries). The pure assembler receives every
  nondeterministic input (ids, timestamps, clock readings) as parameters
  (§12.6).
---

## 12. The assembler and the honest completeness summary

**Decision 12 — the assembler is a pure function from decoded events,
explicit nondeterministic inputs (ids, timestamps, clock readings), and
authoritative boundary facts to canonical events plus the boundary facts;
the canonical output is an `EvidenceTrace` derived from an authoritative
`EvidenceRecord` (`AgentRun` is a legacy/consumer projection); frame
positions are 1-based and only assigned to actually-observed frames;
raw-forwarded bytes count exactly what was written to the client socket;
the completeness summary states observed facts and an honest remainder
knowledge — never fabricated counts and never implied completion.**

### 12.1 The provider-neutral decoded event union (L3)

```ts
type StreamDecodedEvent =
  | { kind: 'chunk'; choiceIndex: number; chunkIndex: number; delta: string | null; finishReason?: string }
  | { kind: 'usage'; inputTokens?: number; outputTokens?: number; totalTokens?: number }   // canonical usage (frame-level)
  | { kind: 'provider-error'; code: ProviderErrorFrameCode; description: string };          // closed code; structural text (§8.4)

type FrameDecodeResult = /* §6.2 */;
```

- `chunk.delta` is the normalized text delta (`string`, or `null` when the
  chunk carries no content). No `usage` field exists on `chunk` — per-choice
  nested usage is discarded and declared `per-choice-usage` (§6.3, §7.3);
  frame-level usage is canonical.
- **Retained delta text has one canonical home**: at L4 the normalized
  retained text is written to the additive `responseEnvelope.deltaText`
  field on the `model_response_chunk` event (§13.5). It is **never**
  written into `providerNative` — that would misrepresent canonical
  normalized content as a provider-native payload.
- `usage` fields are optional at this layer; provider numbers become
  `UsageValue { value, evidenceStatus: 'captured', reason? }` at L4 (§13.6).
- `provider-error` carries the **closed** `ProviderErrorFrameCode` and
  bounded structural text (§8.4, §9.2); the description is never the
  classification.
- **Every code in this union and in `FrameDecodeResult` is declared in
  §9.2** — the decoder, the assembler, and the terminal matrix share the
  same closed surfaces.

### 12.2 Assembler contract, architecture, and final events

**Architecture (corrected)**: the authoritative artifact is the
`EvidenceRecord` (raw observations + capture boundary authoritative; trace,
analysis, completeness derived — Spec 013/014). The assembler produces the
canonical **`EvidenceTrace`** (the deterministic derived trace view:
`interactionId == traceId`, `captureProfile`, `status`, `spans`, `events`,
`finishedAt`). **`AgentRun` is a legacy/consumer projection** produced by
`@signalglass/core` projection layers (§19.4), never the assembler's output
shape and never extended with provider shapes. Reports consume the
projections (§18).

`assembleTrace({ traceId, interactionId, ids, capturedAtBySeq, requestMeta,
requestMessages, decodedEvents, boundaryFacts, captureProfile, detector,
evidenceBudgets })` produces:

- the canonical `EvidenceTrace`-shaped event list (Spec 013): events in
  `seq` order with `interaction_start` at `0`, one `model_request`, one
  `model_response` (when headers were observed), zero-or-more
  `chunk`/`model_usage` events, the terminal event per §10.4, and — **on
  `completed` only** — exactly one final `interaction_end`. Request messages
  are written in the normalized leaf-level representation of §8.7 (schema
  ≥ 1.1.x only, §13.7); retained chunk-delta text is written to
  `responseEnvelope.deltaText` (§13.5). **The assembler
  never promises "exactly one final `interaction_end`" on every result**:
  on `upstream-failed`/`malformed-stream`/`request-failed` the terminal
  `error` is final; on `client-cancelled`/`ingress-cancelled` the
  `cancelled` declaration is final; on `observation-detached` the
  informational `error` is final (Spec 014 §4.7; §10.4–§10.5).
- the authoritative `captureBoundary.streaming` facts (§13.4) — the
  assembler is the **only** writer of these facts;
- an `AssemblyResult { trace, boundary, warnings }` where warnings are
  informational only (they never alter outcomes).

**Nondeterministic inputs are explicit** (§12.6): `ids` (the ID allocator's
outputs: event IDs, observation IDs) and `capturedAtBySeq` (capture
timestamps) are supplied by the ingress at observation time. The pure
assembler never reads a clock, never draws randomness, and never generates
IDs itself.

The assembler assigns `seq` (§4.3), per-choice `chunkIndex`, and the
evidence statuses (§7.1). It applies retention (excerpting/masking) per the
capture profile (§8.2). It never emits raw provider JSON except under the
`providerNative` contract (§7.2).

**Determinism (scoped honestly)**: the assembler is deterministic **given
fixed inputs** — identical `{ ids, capturedAtBySeq, decodedEvents,
boundaryFacts, captureProfile }` produce identical outputs (including loss
codes and boundary statements). It is **not** deterministic while reading
hidden clocks or randomness; the nondeterministic inputs are declared
parameters (§12.6), and the determinism tests fix them (§21 T21, T109).

**Idempotence**: assembly is a pure function; re-running it with the same
inputs does not duplicate events (the ingress persists once per
interaction, §3.1).

### 12.3 Frame and byte accounting (honest numbers)

- `lastObservedFramePosition` — the 1-based position of the **last frame
  actually observed** by the parser (canonicalized or not). Only observed
  frames are counted; after observation detachment, positions are not
  assigned (framing may be impossible), so this number is simply absent
  (`undefined`) rather than guessed. It is recorded authoritatively in
  `captureBoundary.streaming.remainder` (§13.4) and surfaced in the
  completeness summary (§12.5).
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
  observed facts; the loss codes `remainder-after-observation-detach-not-observed`,
  `post-terminal-content-not-retained`, and `post-terminal-content-unknown`
  (§7.3) are derived from it and from the post-terminal fact.

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
CompletenessSummary (assembler-internal; persisted projections listed in §13.4):
  observedFrames: number                    // frames actually observed by the parser (L2), 1-based positions assigned
  retainedEvents: number                    // canonical events retained (L4) up to and including the terminal event
  observationDetached: boolean              // observation detached before the observation terminal could be determined
  detachCode?: ObservationFailureCode       // §9.2 — incl. 'record-budget-exceeded' (§3.5)
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
- `trace.assembly` (§15.2) is the **derived** assembly pedigree (authoritative
  copy in `captureBoundary.streaming.assembly`, §13.4) — the derivation
  pedigree of this summary.

### 12.6 Explicit nondeterministic inputs (deterministic-input contract)

- The pure assembler accepts, as **explicit parameters**: `ids` (event IDs,
  observation IDs — the ID allocator's outputs), `capturedAtBySeq` (capture
  timestamps), and any other clock readings (e.g. an observation-burst
  timestamp). The ingress supplies these from its clock/randomness at
  observation time.
- **No hidden nondeterminism**: the assembler contains no
  `Date.now()`, no `Math.random()`, no `crypto.randomUUID()`, no ambient
  clock reads. This is enforced by the package boundary tests (§21 T109)
  and the determinism tests (§21 T21).
- **Deterministic allocation from authoritative inputs is permitted** as an
  alternative (e.g. ids derived from the interaction id and seq by a fixed
  algorithm), but any such derivation must be total, collision-free within
  the trace, and documented; it still never uses wall-clock time or
  randomness.
---

## 13. The additive 1.1 schema and the authority model

**Decision 13 — the schema advances additively from 1.0.0 to 1.1.0 with
seven new serialized fields; `captureBoundary.streaming` is the single
authoritative input holding streaming facts — the observation terminal is
**not** recorded there (it is derived from the final canonical event), the
assembly identity is authoritative there (`trace.assembly` is a verified
derivation), and capture-profile/detector identity has one authoritative
home each, cross-checked wherever it appears; `completeness.lifecycle`,
`completeness.declaredLosses`, and the summary are derived by
`deriveCompleteness` and verified at parse; no 1.0.0 record is
reinterpreted; no field is silently discarded on downgrade.**

### 13.1 The seven new serialized paths

| # | Serialized path (1.1) | Role | Owned by |
|---|---|---|---|
| 1 | `captureBoundary.streaming` | **authoritative input**: upstream/client-response outcomes (+ cancellation cause), decoder participation, remainder knowledge, loss facts, assembly identity, capture profile, detector | assembler (the only writer) |
| 2 | `completeness.lifecycle` | derived view of the two lifecycles (§1.2, §2) incl. the observation terminal (derived from the final event) | `deriveCompleteness` |
| 3 | `completeness.declaredLosses` | derived, closed loss-code list (§7.3) | `deriveCompleteness` |
| 4 | `trace.assembly` | **derived** assembly pedigree (literal names + versions, §15.2); recomputed from the authoritative boundary copy and verified at parse | derivation + parse verification |
| 5 | `events[].responseEnvelope.responseMeta` | upstream status + normalized content metadata on the `model_response` event (§13.3) | assembler |
| 6 | `events[].responseEnvelope.choiceIndex` | normalized choice identity on chunk events (§4.2, §13.5) | assembler |
| 7 | `events[].responseEnvelope.deltaText` | normalized retained chunk-delta text on `model_response_chunk` events (§13.5) | assembler |

Usage normalization (§13.6) is a **clarification** of existing 1.0.0 usage
shapes, not a new field; the normalized request-message representation
(§8.7) is likewise a clarification of what the assembler writes into the
1.0.0 `RequestEnvelope.messages` field, not a new path — with the
version-aware scope that the closed leaf-level shape applies to schema
≥ 1.1.x records only and 1.0.x `messages` values are never reinterpreted
(§13.7).
`evidenceSchemaVersion` advances 1.0.0 → 1.1.0
(additive: every 1.0.0 record remains valid and unchanged in meaning; §15.3).

### 13.2 The authority model (one authority per fact; terminal derived)

```text
authoritative input (validated at parse):
  rawObservations + captureBoundary.streaming      ← assembler-written facts
  canonical events (the final event decides the observation terminal)

derived at parse (recomputed, compared, never trusted blindly):
  observation terminal                             ← derived from the final canonical event:
                                                     • final interaction_end                       → completed
                                                     • final error (trace/fail), actor 'model'      → upstream-failed
                                                       (error.type http-error-status|connection-error|upstream-timeout|
                                                       tls-failure|provider-error-frame|non-sse-response)
                                                       or malformed-stream (error.type sse-*)
                                                     • final error (trace/fail), actor 'capture'    → request-failed
                                                     • final cancelled (trace/cancel) requestedBy    → client-cancelled | ingress-cancelled
                                                     • final error (none/none)                       → observation-detached
  completeness.lifecycle                            ← deriveCompleteness(trace, analysis, captureBoundary)
  completeness.declaredLosses                       ← deriveCompleteness(...)
  completeness summary + boundaryStatement          ← deriveCompleteness(...)
  trace.assembly                                    ← copied from captureBoundary.streaming.assembly during trace derivation

verification:
  parseEvidenceRecord recomputes the derivations and fails with
  completeness_disagrees_with_derivation on disagreement; captureBoundary is
  itself validated (closed vocabularies, cross-field matrix §2.3, version
  rules §15, decoder-participation rule §13.4).
```

- **The observation terminal is not a boundary fact.** Rev-4 duplicated it
  (`captureBoundary.streaming.observationTerminal` vs. the canonical final
  event). Rev-5 **removes it**: the terminal is derived from the final
  canonical event (table above), which is itself derived from the
  authoritative raw observations. No mirror exists to disagree with; a
  hand-edited `completeness.lifecycle.observation.terminal` that disagrees
  with the event-derived terminal fails parse with
  `completeness_disagrees_with_derivation`.
- **`assembly` is authoritative in `captureBoundary.streaming`; `trace.assembly`
  is a derived copy** (rev-4 left both written independently). Parse recomputes
  `trace.assembly` from the boundary and rejects disagreement. Hand-edited
  `trace.assembly` (different version, different literal name, decoder
  present/absent contrary to the participation rule) fails parse.
- **Capture profile / detector**: `captureBoundary.streaming.captureProfile`
  and `.detector` are the **only** authoritative homes. The existing derived
  `trace.captureProfile` (Spec 013 §9) is cross-checked against the boundary
  copy (name and version) at parse; the detector identity has **no** derived
  duplicate. A mismatch (capture-profile version differs from the assembly
  pedigree or from `trace.captureProfile`) fails parse.
- **One authority per fact** is therefore literal: no fact is recorded in
  two independently-written copies.
- Tampering with a **derived field** → `completeness_disagrees_with_derivation`.
  Tampering with an **authoritative input** is caught by the boundary facts'
  own validation (closed vocabularies, impossible-pair rejection §2.3,
  literal-name/semver rules §15, decoder-participation rule §13.4) — it cannot be
  detected by comparing to a recomputation, because the boundary is the
  recomputation's input. The spec states this honestly.

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
    // finishReason, providerNative, usage, chunkIndex, choiceIndex, deltaText: ALL ABSENT here
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
- `statusCode` is validated 100–599; `contentType` is the normalized media
  type (parameters dropped → `content-type-parameters-not-retained`,
  §7.3); `contentEncoding` only when the upstream sent a single
  `content-encoding` token.
- **Header-less paths** (`request-failed`, `connection-failed`,
  `cancelled-by-ingress` before headers): no `model_response`, no status
  anywhere — `responseMeta` is not fabricated and the error envelope
  carries no status field.
- Content-type header values other than `content-type`/`content-encoding`
  are excluded structurally (§5.1); the allowlist is validated per bounds
  (§13.4 validation).

### 13.4 `captureBoundary.streaming` — authoritative field (validated shape)

A streaming record also records the existing `captureBoundary` fields
(`captureSurface: 'ingress_proxy'`, `observationBoundary:
'provider_reported'` — Spec 013 §9); the streaming facts live under the
**additive** `captureBoundary.streaming` key, which parse accepts as an
additive key per Spec 014 §2.2.10.

```ts
captureBoundary.streaming = {
  upstream: { outcome: UpstreamOutcome; cause?: UpstreamCancelCause },  // closed (§2.1); cause only when cancelled-by-ingress
  clientResponse: { outcome: ClientResponseOutcome },                   // closed (§2.2)
  decoderDisposition: DecoderDisposition,          // AUTHORITATIVE decoder-participation fact (§7.3.1):
                                                 // 'not-applicable' | 'openai-sse' | 'unsupported-encoding'
  remainder: {
    knowledge: RemainderKnowledge,                     // closed (§12.4)
    lastObservedFramePosition?: number,                // 1-based, only observed frames (§12.3)
    rawForwardedBytes?: number,                        // bytes accepted by the client socket (§12.3)
  },
  losses: {                                             // closed, applicability-aware facts (§7.3)
    requestBody: RequestBodyRetention;                  // 'no-bytes-observed' | 'partially-observed-not-retained' |
                                                        //   'fully-observed-not-retained' | 'retained' (§7.3.1)
    messageContent: Retention4;
    deltaContent: Retention4;
    providerNative: Retention3;
    providerErrorBody: Retention3;
    wireBytes: Retention3;
    postTerminalContent: PostTerminal;
    unmappedDeltaFields: readonly UnmappedDeltaFieldCategory[];   // closed categories (§7.3)
    unrecognizedExtensionFrameObserved: boolean;
    headerValuesBeyondAllowlist: boolean;
    contentTypeParametersDropped: boolean;
    maskedContent: boolean;
    contentEncodingUnsupported: boolean;
    multimodalContentObserved: boolean;                 // §8.7
    requestMessageUnknownKeysObserved: boolean;         // §8.7
    unrecognizedRoleObserved: boolean;                  // §8.7 — closed; raw role values never retained
    sseMetadataObservedButNotRetained: boolean;         // §6.1 — event:/id:/retry: values observed, not retained;
                                                        //   comments are keepalives and are never counted
  },
  assembly: {                                           // AUTHORITATIVE assembly identity (§15.1)
    assembler: { name: 'signalglass.streaming.assembler'; version: string };
    decoderContract?: { name: 'signalglass.providers.openai-sse'; version: string };  // derived from decoderDisposition
  },
  captureProfile: { name: 'signalglass.collection.ingress-metadata-safe'; version: string },  // AUTHORITATIVE
  detector: { name: 'signalglass.collection.sensitive-detector'; version: string },           // AUTHORITATIVE
  // NOTE: observationTerminal is intentionally ABSENT — derived from the final event (§13.2).
};
```

Parse-time validation (in addition to the field itself being additive):

- every vocabulary is closed and membership-checked (unknown value →
  parse failure) — including `UpstreamOutcome` (five values),
  `UpstreamCancelCause` (present iff `cancelled-by-ingress`),
  `ClientResponseOutcome`, `DecoderDisposition`, `RemainderKnowledge`, the
  loss-fact states, and `UnmappedDeltaFieldCategory`;
- the upstream × clientResponse pair must satisfy the §2.3 matrix (20 cells;
  impossible pairs rejected);
- `lastObservedFramePosition` ≥ 1; `rawForwardedBytes` ≥ 0 when present;
- `statusCode` 100–599; `contentType`/`contentEncoding` bounded
  (≤ 255 chars) and pattern-checked;
- assembly fields validated per §15 (literal names, semver);
- **decoder-participation rule**: `assembly.decoderContract` is present
  **iff `decoderDisposition === 'openai-sse'`**. Participation is
  **selection and invocation of the OpenAI SSE decoder on the SSE
  observation path — NOT "decoded at least one frame"**: an SSE response
  that ends (EOF or transport failure) before its first complete frame
  still selected and invoked the decoder, so the disposition is
  `'openai-sse'`, the contract is present, and no chunk events exist
  (terminal per §6.5 — e.g. `sse-eof-without-done` malformed or
  `upstream-failed` on transport loss). It is **not** tied to
  `model_response` presence (headers are observed on every header-observed
  path — non-SSE 2xx, upstream non-2xx, invalid-body 2xx — where no SSE
  decoding occurred). Disposition consistency: `'openai-sse'` and
  `'unsupported-encoding'` require headers observed (a `model_response`
  exists); `'unsupported-encoding'` additionally requires
  `losses.contentEncodingUnsupported === true` (the SSE observation path
  was selected — content-type `text/event-stream` — but the encoding could
  not be decoded, so the decoder was selected but could not run, and
  `decoderContract` is absent); `'not-applicable'` on header-less,
  non-SSE, and upstream-error paths. Any contradiction (decoder identity
  without `'openai-sse'`, or `'openai-sse'` without a decoder identity)
  fails parse;
- **deltaText validation**: `responseEnvelope.deltaText` is present only
  on `model_response_chunk` events; it is a string ≤ 240 code points (the
  v1.0.0 profile cap, §8.3); it is absent on finish-only, usage-only,
  metadata-only, missing, and wholly-omitted chunk events; its event-level
  `evidenceStatus` owns the representation (one leaf per chunk event) and
  must agree with the `deltaContent` fact (§7.3.3 cross-validation);
- **request-message validation is version-aware**: the closed leaf-level
  shape of §8.7 is validated on schema ≥ 1.1.x records **only**; a 1.0.x
  record's `RequestEnvelope.messages` value is arbitrary legacy data,
  parsed and round-tripped unchanged, never reinterpreted (§13.7, T133);
- **cross-checks**: derived `trace.assembly` must equal
  `captureBoundary.streaming.assembly`; derived `trace.captureProfile` must
  equal `captureBoundary.streaming.captureProfile` (name and version);
  `captureBoundary.streaming.detector` is the only detector copy;
- the derived observation terminal (§13.2) must match
  `completeness.lifecycle.observation.terminal` (verified by
  `deriveCompleteness` recomputation);
- unknown additive keys inside `captureBoundary.streaming` are accepted
  (forward compatibility) but never silently reinterpreted.

`deriveCompleteness` consumes these facts and the canonical events and
produces: `completeness.lifecycle`, `completeness.declaredLosses`, the
summary, and `boundaryStatement` — all verified at parse per §13.2.

### 13.5 `deltaText` and `choiceIndex` on chunk envelopes

#### 13.5.1 `deltaText` — the canonical home for retained streaming text

Additive 1.1 field on **`model_response_chunk` events only**:

```ts
responseEnvelope: {
  providerNativeFidelity: 'structurally_faithful',
  chunkIndex?: number,             // existing 1.0.0 field
  choiceIndex?: number,            // additive 1.1 (§4.2)
  deltaText?: string;              // additive 1.1 — normalized retained chunk-delta text
}
```

Presence rules (exact):

- **Present** only on `model_response_chunk` events whose normalized text
  was retained — every chunk event whose decoded delta produced retained
  text carries its retained representation here.
- **Absent** on: finish-only chunks (no content), usage-only events,
  metadata-only events (`model_response`), events whose content is
  `missing` (not observed), and wholly-omitted content (masked-omitted
  wholesale per the profile).
- **Never** written into `providerNative` — normalized canonical content
  is not provider-native payload (§12.1).
- **Cap**: `deltaText` length ≤ 240 code points (the v1.0.0 profile cap,
  §8.3); total retained delta text counts toward
  `maxRetainedContentCodePoints` (§3.5).
- **Status ownership**: the event-level `evidenceStatus` owns the
  `deltaText` representation (`captured` when complete at the cap,
  `truncated` when shortened, `redacted` when a sensitive span was
  masked) — a chunk delta is **one leaf per event**, so the event-level
  status **is** the leaf-level status; the owning declarations live with
  the event (mirroring `ContentLeaf` for request content, §8.7); the
  aggregate fact is `deltaContent` (§7.3) and must agree with the event
  statuses (§7.3.3).
- **Serialization/parse validation**: string-only, per-leaf cap,
  present/absent per the rules above, and consistent with
  `decoderDisposition` (a `deltaText` requires an SSE observation path).
- **Multi-choice**: `deltaText` is the normalized text of that chunk of
  that choice — per-choice identity via `choiceIndex`, per-choice content
  ordinal via `chunkIndex` (§4.2); a `deltaText` on a multi-choice stream
  is unambiguous because each chunk event carries both indexes.
- **Fixtures and projection**: serialized-shape fixtures (T113, T102) and
  the projection matrix/parity rows classify `deltaText` under the
  message-content class with the `deltaContent` fact (§21).

#### 13.5.2 `choiceIndex` on chunk envelopes

- Additive field on `events[].responseEnvelope.choiceIndex` (number ≥ 0) on
  chunk events only (§4.2). Absent on usage/error/`[DONE]`-derived events
  and on the `model_response` event.
- Validated: non-negative integer; duplicate-within-frame is rejected at the
  decoder (§6.3), so no parse-time duplicate ambiguity remains.
- The existing `chunkIndex` semantics (per-choice content-chunk ordinal)
  are preserved; for single-choice streams they coincide (§4.2).

### 13.6 Usage normalization (clarification, not a new field)

- `UsageValue = { value?: number; evidenceStatus?: EvidenceStatus; reason?: string }`
  and `UsageRecord = { evidenceStatus; reason?; inputTokens?; outputTokens?;
  totalTokens? }` per Spec 013 §2.2.6/§4.1 (exact shapes verified against
  `packages/evidence/src/types-base.ts`).
- Provider-reported numbers → `{ value: n, evidenceStatus: 'captured' }` per
  field. **Captured zero is a real observation**, distinct from absence
  (missing fields / no usage event).
- Partial usage = partial fields (`inputTokens` present, `outputTokens`
  absent — never zero-filled, never `null`).
- Per-choice nested usage is discarded and declared
  `per-choice-usage` (§6.3, §7.3); frame-level usage is canonical.
- Exact serialized-shape tests: T94 (§21).

### 13.7 Version-aware validation (MAJOR-1 forward compatibility)

The implemented version gate (`packages/evidence/src/version.ts`) accepts
**compatible additive minor/patch revisions within MAJOR 1** — it is
`majorVersion(value) === 1`, not an exact `1.0.0 | 1.1.0` allowlist. This
spec preserves that contract and layers version-aware validation on it:

- **Version 1.0.x records** (`1.0.0` today): the seven 1.1-owned paths must
  be **absent** (a 1.0 record never carries 1.1-owned fields); everything
  else parses exactly as today — **including `RequestEnvelope.messages`
  as an arbitrary `unknown` value** (Spec 014 additive parse). The closed
  normalized request-message validation of §8.7 applies **only** to Spec
  016 records in schema ≥ 1.1.x; a valid 1.0.x record with any legacy
  `messages` value parses and round-trips unchanged and is **never
  reinterpreted** as the normalized representation (T133).
- **Version ≥ 1.1.x within MAJOR 1**: the **known 1.1-owned fields receive
  owned validation** — the seven paths are validated per §13.1–§13.6
  regardless of the minor version, **including the closed leaf-level
  request-message shape of §8.7**. A future `1.2.0` record does **not**
  bypass validation of the known 1.1-owned fields.
- **Future unknown additive fields** (a future minor's fields): preserved
  as additive, never reinterpreted, never silently discarded
  (§13.4 unknown-additive-key rule).
- **Unsupported MAJOR versions are refused** (`unsupported-version` at
  save; parse refuses with the structured version error).
- **A downgrade reader** (one that only understands 1.0.0) refuses a
  record carrying 1.1-owned fields via the persistence policy
  (`policy-rejected` code `unknown-additive-field`, §14.3) — the refusal
  is a policy decision on a MAJOR-1-accepted record, not a schema-gate
  narrowing. No field is ever silently discarded on downgrade.
- If a future revision wants to change the repository from MAJOR-wide
  acceptance to an exact-version allowlist, that is a **breaking
  Spec 014/version-policy change** to be specified separately — it is not
  claimed here that the existing pipeline is an exact-version gate.
---

## 14. The persistence policy and non-spoofable v1.1.0 admission

**Decision 14 — persistence runs the real Spec 015 pipeline, unmodified:
storage-safety gate, versioned persistence policy, and contention handling
are all preserved; the policy is selected at `EvidenceStorage`
construction — a record's capture profile/detector are validation inputs,
never policy selectors; `policy-crash` is not a thing — policy exceptions
are policy failures with the closed `PolicyFailureReason = 'exception' |
'malformed-decision'`; the `metadata-safe` v1.1.0 admission of bounded
captured content is mechanical (evaluated on the actual submitted record at
closed admitted paths) and non-spoofable (a fabricated pedigree cannot
bypass the gate or the policy).**

### 14.1 The unchanged persistence pipeline (Spec 015)

Every save goes through `EvidenceStorage.saveEvidenceRecord` exactly as
implemented and specified in Spec 015. **The persistence policy is chosen
once, by the operator, at `EvidenceStorage` construction**
(`EvidenceStorageConfig.persistencePolicy` — `validatePolicyIdentity`
enforces the non-spoofable brand for the reserved reference name); a
submitted record or its capture profile never chooses which policy
 evaluates it:

1. **Version gate** — `evidenceSchemaVersion` must be a MAJOR-1 additive
   version (`checkEvidenceSchemaVersion`, `version.ts`); unsupported
   MAJOR or invalid syntax is refused (`unsupported-version`).
2. **Structural integrity** — parse + closed-vocabulary validation (§13.2),
   including version-aware validation of the known 1.1-owned fields
   (§13.7).
3. **Storage-safety gate** — the record is scanned for S1/S2/S3/S5/S6
   witnesses (credential shapes, etc.) with the versioned vocabulary; a
   witness → `safety-rejected`. The gate runs on the **actual submitted
   record** — including any bounded captured content — and cannot be
   disabled or bypassed by any field in the record.
4. **Persistence policy** — the **constructed** policy decides
   (`policy.decide(snapshot)`). The capture profile/detector metadata may
   be **required validation inputs** for a policy (the v1.1.0 policy
   admits bounded captured content only for the known profile/detector),
   but they **never switch policies**. An unknown or unavailable policy
   version is a **constructor/configuration error** (`StorageConfigError`,
   Spec 015 §3.1) — it cannot occur at save time.
5. **Admission** — `stored`, or one of the rejection outcomes
   (`already-present`, `conflict`, `invalid`, `unsupported-version`,
   `safety-rejected`, `policy-rejected`, `policy-failed`, `clock-failed`).
6. **Contention** — a thrown `EvidenceContentionError` (worker contention)
   is surfaced separately (§16.3) — it is **not** a `SaveOutcome` and never
   a `policy-crash`.

### 14.2 `metadata-safe` v1.1.0 — the additive captured-content rule

`metadata-safe` v1.1.0 = v1.0.0 **plus one additive rule** (Rule 2); v1.0.0
itself is unchanged and never reinterpreted:

- **Rule 1 (unchanged, v1.0.0)**: a content-bearing **leaf** is admissible
  only under that leaf's own `redacted`/`truncated` declaration
  (`isDeclaredContent`, evaluated per leaf — §8.7); a leaf with status
  `captured` is rejected (`captured-content`). The event-level aggregate
  status **never** authorizes a nested leaf.
- **Rule 2 (additive, v1.1.0)**: a content-bearing leaf with owning status
  `captured` is admissible **iff all of the following hold**:
  - the leaf sits at a **closed admitted path** — the request-message
    content leaves (`messages[].content.text` string-form leaf,
    `messages[].content[].text.text`,
    `messages[].content[].tool_call.arguments.text`,
    `messages[].content[].tool_result.content.text`,
    `messages[].content[].image_url.url.text`, §8.7) and the chunk-delta
    text (`responseEnvelope.deltaText`, §13.5); any other `captured`
    content-bearing leaf or field is rejected;
  - the leaf's retained length ≤ 240 code points (the v1.0.0 profile
    cap, §8.3); total retained content is bounded by the §3.5 budgets;
  - **leaf ownership is inspected, never the aggregate**: the leaf's own
    `evidenceStatus === 'captured'` and the leaf carries **no** redaction/
    truncation declaration; a leaf whose own status is `redacted`/
    `truncated` is evaluated by Rule 1; a forged event-level
    `captured` on a leaf whose own status disagrees cannot occur (parse
    rejects, §7.3.3);
  - the declared capture profile and detector are the known
    `metadata-safe` profile and the known versioned detector (§13.4) —
    these are **validation inputs** (the rule requires them for the
    bounded-captured admission) and never switch the policy;
  - the record passes the storage-safety gate (§14.1 step 3) — evaluated
    on the actual submitted value, not on any claimed classification;
  - the record's `evidenceSchemaVersion` is a MAJOR-1 version ≥ 1.1.0
    (a 1.1-owned field cannot ride on a 1.0.x record).
- Rule 2 is **mechanical**: it inspects the submitted record (leaf status,
  leaf declarations, length, path, versions, gate result) — it never
  trusts a provenance claim and never trusts an aggregate event status. A
  spoofed pedigree (a claim that the collection pipeline ran, with a
  forged profile/detector/aggregate status) cannot bypass the gate, the
  length bound, the path allowlist, the leaf-ownership check, or the
  version rule. Paths that are not
  admitted close **fail-closed** (rejected as `captured-content`), and the
  gate has no bypass.
- The policy counts **code points** (`countCodePoints`) as the reference
  implementation does, so `captured` under Rule 2 means: at most the cap
  code points of actual text, at a closed path, past the gate.

### 14.3 Version interplay (policy version ≠ schema version; policy chosen at construction)

The **constructed** policy evaluates every save; the rows below are the
complete interplay for the reference policy:

| Constructed policy | Record schema (MAJOR 1) | Outcome |
|---|---|---|
| `metadata-safe` v1.0.0 | 1.0.x, no 1.1-owned fields | v1.0.0 rules (Rule 1); `captured` content-bearing fields → `policy-rejected` `captured-content` (unchanged) |
| `metadata-safe` v1.0.0 | ≥ 1.1.x with 1.1-owned fields | v1.0.0 rules; any 1.1-owned field → `policy-rejected` `unknown-additive-field` (no silent discard, §13.7) |
| `metadata-safe` v1.1.0 | 1.0.x, no 1.1-owned fields | v1.1.0 = Rule 1 + Rule 2; Rule 2 is vacuous (no 1.1-owned `captured` fields exist) — the record is evaluated by Rule 1 |
| `metadata-safe` v1.1.0 | ≥ 1.1.x with 1.1-owned fields | v1.1.0 rules (Rule 1 + Rule 2) |

- **v1.0.0 is never weakened**: records that were admissible under v1.0.0
  remain admissible; the v1.0.0 policy text is unchanged and is never
  reinterpreted to admit `captured` content.
- **v1.1.0 is never silently downgraded**: if storage is constructed with
  v1.1.0, that policy evaluates the save — it is not swapped for v1.0.0
  based on the record.
- **No record-side policy selection**: a capture profile never chooses
  the policy; the policy is the constructed one (§14.1).
- **Unknown/unavailable policy version is a constructor/configuration
  error** (`StorageConfigError`) — it never occurs at save time and is
  **not** a `PolicyFailureReason`; `PolicyFailureReason` stays
  `'exception' | 'malformed-decision'` (Spec 015, verbatim).

### 14.4 Policy decisions, recorded

- The **deciding policy** is the constructed policy (§14.1); the
  `SaveOutcome` carries its identity (`policy: { name, version }` on
  `policy-rejected`/`policy-failed`, and the same identity in
  `StorageManifest.persistencePolicy` **only on `stored`** — rejected rows
  are not stored, so no policy metadata exists for them).
- A policy exception (a thrown error inside the policy or malformed policy
  decision) is **`policy-failed` with the closed `reason`**
  (`'exception' | 'malformed-decision'`, Spec 015 verbatim) — the
  previous `policy-crash` outcome is **removed**: it misdescribed the
  outcome as a distinct class when it is a policy failure. There is no
  `policy-crash` anywhere in the spec, the outcomes, or the tests.
- `policy-rejected` carries a closed code (`rejected` |
  `captured-content` | `unknown-additive-field` | `unbounded-label`) with
  no exception messages, no identities, no documents, no digests
  (§16.4 leak-free projections).

---

## 15. Versioning

**Decision 15 — schema, capture-profile, detector, assembly, and policy
versions are distinct, each with closed rules; literal names and semver are
validated; version-bump rules are normative; the schema version gate
accepts additive minor/patch within MAJOR 1 (not an exact
`1.0.0 | 1.1.0` allowlist), with version-aware validation of the known
1.1-owned fields.**

### 15.1 Versioned artifacts

| Artifact | Example | Rules |
|---|---|---|
| evidence schema | `evidenceSchemaVersion` = `1.0.0` / `1.1.0` (MAJOR 1) | additive bumps only; the gate accepts any additive minor/patch in MAJOR 1 (`version.ts`); 1.0.x records read unchanged; ≥ 1.1.x fields receive owned validation (§13.7) |
| capture profile | `signalglass.collection.ingress-metadata-safe` v1.0.0 (recorded per record) | the v1.0.0 excerpt cap is **exactly 240 code points** (§8.3); a different cap requires a profile version bump **and** a matching persistence-policy contract (§14.2); profile recorded on `captureBoundary.streaming.captureProfile` and derived on `trace.captureProfile` |
| sensitive detector | `signalglass.collection.sensitive-detector` v1.0.0 | recorded on `captureBoundary.streaming.detector` (single home, §13.2); bump when patterns change |
| assembly pedigree | assembler `signalglass.streaming.assembler` + decoder `signalglass.providers.openai-sse` (semver each) | **literal** names — validated, not free text; version bumps when assembly semantics change (§15.2) |
| persistence policy | `metadata-safe` v1.0.0 / v1.1.0 | §14.2–§14.4 |

### 15.2 `trace.assembly` / `captureBoundary.streaming.assembly`

- Literal names are validated: `signalglass.streaming.assembler` for the
  assembler, `signalglass.providers.openai-sse` for the first decoder
  contract. Future decoder contracts get literal names of the same shape;
  unknown literal names → parse failure.
- Versions are semver; validation rejects non-semver and rejects a
  **downgrade of a known contract** (a 1.1 record may not claim an
  assembler version older than the version that produced the 1.1 fields).
- `assembly.decoderContract` is **derived from `decoderDisposition`**:
  present iff `decoderDisposition === 'openai-sse'` (§13.4
  decoder-participation rule) — it is not tied to `model_response`
  presence.
- Authoritative in `captureBoundary.streaming.assembly`; `trace.assembly`
  derived + verified (§13.2).

### 15.3 Version-bump table (normative)

| Change | Requires | Effect on old records |
|---|---|---|
| Add a serialized field (the seven paths, or any future additive field) | `evidenceSchemaVersion` bump | old records read unchanged; downgrade policy refuses (`unknown-additive-field`) |
| Change default cap / retention behavior | capture-profile version bump **and a matching policy contract** (§8.3) | old records keep their recorded profile version |
| Change detector patterns | detector version bump | old records keep their recorded detector version |
| Change assembly semantics | assembler version bump | per-version verified derivation |
| Add decoder contract | new decoder literal + version | per-record `decoderContract` |
| Change policy rules | policy version bump (additive rule allowed) | per-declared-policy evaluation (§14.3) |
| Repurpose, drop, or reinterpret an existing field | **forbidden** (no breaking change) | — |

---

## 16. Persistence and observability outcomes

**Decision 16 — `PersistenceObservation` is an operational outcome of the
save attempt, never a persisted field on the record and never a
`SaveOutcome`; the real Spec 015 `SaveOutcome` union is used verbatim; the
`contention-exhausted` code covers worker contention with the record never
saved; operational logs and the report projection are leak-free (closed
codes, no exception messages, no identities, no documents, no digests).**

### 16.1 Persistence observation (operational, not persisted)

```ts
type PersistenceObservation =
  | { kind: 'save-outcome'; outcome: SaveOutcome }                 // real Spec 015 union (below)
  | { kind: 'environmental-failure'; code: 'contention-exhausted' | 'storage-unavailable' };
```

- `PersistenceObservation` describes the **attempt**; it is produced by the
  ingress/persistence layer and consumed by observability (§18). It is
  **never stored on the evidence record** (the record is complete before
  save; the save result cannot be a field of the thing being saved).
- `contention-exhausted`: worker contention exceeded the retry budget —
  `EvidenceContentionError` was thrown and translated; the record was
  **not saved** and no partial record exists (§16.3).
- `storage-unavailable`: the store itself is unreachable/errored (never
  an exception message — see §16.4).

### 16.2 The real `SaveOutcome` union (Spec 015, verbatim)

`SaveOutcome` is the **discriminated object union** exported by
`@signalglass/storage` — never a string-status union:

```ts
import type { SaveOutcome } from '@signalglass/storage';

type SaveOutcomeStatus = SaveOutcome['status'];   // 'stored' | 'already-present' | 'conflict' |
                                                  // 'invalid' | 'unsupported-version' | 'safety-rejected' |
                                                  // 'policy-rejected' | 'policy-failed' | 'clock-failed'

type SaveOutcome =                                 // verbatim, discriminated union (Spec 015 §3):
  | { status: 'stored'; identity: string; digest: string; manifest: StorageManifest }
  | { status: 'already-present'; identity: string; digest: string }
  | { status: 'conflict'; identity: string; existingDigest: string; suppliedDigest: string; storedAt: string }
  | { status: 'invalid'; identity: string | null; issues: readonly StorageSafeIssue[] }
  | { status: 'unsupported-version'; version: string }
  | { status: 'safety-rejected'; reasons: readonly StorageSafetyCode[] }
  | { status: 'policy-rejected'; policy: { name: string; version: string }; code: PolicyRejectionCode }
  | { status: 'policy-failed'; policy: { name: string; version: string }; reason: PolicyFailureReason }
  | { status: 'clock-failed' };
```

- `policy-crash` is **not** in the union (removed, §14.4);
  `PolicyFailureReason` stays `'exception' | 'malformed-decision'` (§14.3).
- **All typed fields are preserved internally**: `PersistenceObservation`
  (`{ kind: 'save-outcome'; outcome: SaveOutcome }`, §16.1) carries the
  full typed outcome — stored identity/digest/manifest, already-present
  identity/digest, conflict digests + timestamp, validation issues,
  unsupported version, safety reasons, and policy identity/code/reason.
  **The leak-free log projection may reduce the internal outcome to
  approved codes, but that loss occurs only in the diagnostic projection —
  never in `PersistenceObservation`** (§16.4).
- `SaveOutcomeStatus` is used by diagnostics and by the report projection
  for status-level aggregation; the full object remains available to
  in-process consumers (§18).
- The storage layer's own tests (Spec 015) remain the contract, and this
  spec's persistence tests assert the same typed outcomes (T88–T97,
  T116).

### 16.3 Contention handling

- Contention throws `EvidenceContentionError` (Spec 015): the writer
  retries per the documented budget, then surfaces
  `{ kind: 'environmental-failure', code: 'contention-exhausted' }`.
- `contention-exhausted` is **not** a `SaveOutcome` — it is a
  system-level outcome (§16.1); it is never logged with exception text.
- A contention-exhausted interaction has **no persisted record**; the
  observability projection reports it as not-stored with the closed code
  (§18), and the completeness facts still state what was observed — the
  record's absence is a persistence fact, not a completeness fact
  (contrast §19.2).

### 16.4 Leak-free operational projection

- Operational logs and the report projection emit only: closed codes
  (`SaveOutcomeStatus` + typed-safe codes, `environmental-failure` codes,
  `TerminalReason`, `UpstreamOutcome`, `ClientResponseOutcome`,
  `RemainderKnowledge`, loss codes, error codes), counts, durations, and
  bounded structural text.
- **The reduction happens only here**: the diagnostic projection may map
  the full typed `SaveOutcome` to approved status-level codes (e.g.
  `policy-rejected` + code, `safety-rejected` + reasons) — `PersistenceObservation`
  itself keeps the full typed outcome (§16.2).
- They never emit: exception messages, stack traces, request URLs with
  query strings, identities (API keys, tokens), authorization values,
  cookies, documents, digests, raw payload excerpts, or header values.
- A `policy-failed: 'exception'` observation is logged as exactly that code
  — the underlying exception text is not propagated.
---

## 17. Data flow and timing

**Decision 17 — one observation lifecycle, two independent delivery
lifecycles (upstream response and client response), and one save after the
client-response path ends; raw bytes pass through untouched with
backpressure; the canonical stream and the passthrough share the same
transport observations, so upstream outcomes are never inferred from client
behavior.**

```text
client ──(request)──▶ ingress (Spec 006 route)
                      │ assign traceId == interactionId at request observation
                      ▼
              bounded body capture ──▶ request messages (canonical, L4) ──▶ record (later, §3.1)
                      │
                      ▼
              pre-dispatch checks ──(fail)──▶ request-failed record (no upstream, no model_request)
                      │
                      ▼
              dispatch to provider (key from env var only)
                      ▼
            upstream response ──▶ L1 socket ──▶ L2 SSE framing ──▶ L3 decode ──▶ L4 assembly
                      │              │                │                │               │
                      │              │                │                │               │
                      │        (raw bytes tee)  (frame facts)    (normalized events)  (canonical events)
                      │              │
                      ▼              ▼
              client socket  ──▶ bounded decoder tee (encoded streams, §5.5)
              (backpressure:                     │
               upstream read is                  ▼
               paced by the                observation facts
               client's writability)      (losses, remainder, metadata)
                      │
                      ▼
              client-response end ──▶ save attempt (once, Spec 015 pipeline, §14.1)
                      ▼
             PersistenceObservation (§16) ──▶ observability (§18)
```

- The canonical stream is assembled from the **same transport observations**
  as the passthrough — a single observation lifecycle (§1.2). Upstream
  outcomes are recorded from what the transport actually did; they are
  never inferred from client disconnects (first-observed precedence, §2.4).
- The client-response path never gates the observation lifecycle: the
  observer continues until its own terminal (or detach), and the client
  socket is drained independently (§1.2).
- Save timing: the save attempt starts when the client-response path ends
  (§3.1) — after the client socket has been flushed/closed. All canonical
  events for the terminal are already assembled by then; the save is
  exactly once, with the terminal event included.
- Requests with no body were observed: the record exists with an empty
  request message list (empty request arrays are `captured` per §7.1). A
  never-observed request produces no record (§3.1).

---

## 18. Observability and the consumer projection

**Decision 18 — observability consumes the operational
`PersistenceObservation` plus the record's derived projections; `AgentRun`
is a legacy/consumer projection derived from the record via the existing
projection layers (`evidenceToAgentRun`), never the assembler's output
shape; reports render the projections; nothing in the observability path
re-derives or overrides the authoritative facts.**

- Per interaction, the ingress emits an observability event with: the
  closed codes (terminal, upstream outcome, client-response outcome,
  remainder knowledge, `SaveOutcome`/environmental code, declared-loss
  codes), timing, counts (observed frames, retained events), and the
  derived summary fields — all leak-free (§16.4).
- **`AgentRun` projection**: `evidenceToAgentRun` (implemented in
  `@signalglass/core`) maps the canonical record to the legacy consumer
  shape. It is **derived** — it never invents provider shapes, never
  fabricates turns for unobserved exchanges, and never replaces the record.
  Reports consume the projection; the record remains the source of truth.
- `AgentRun` statuses derive from the same terminal rules (§10.3) through
  the projection; a `request-failed` interaction projects to an `AgentRun`
  with no model turns and a failure status (no fabricated empty turn).
- The observability pipeline never re-derives `trace.status`, terminal, or
  losses independently of `deriveCompleteness` — there is exactly one
  derivation path (§13.2), and the projection consumes its output.

---

## 19. Documentation, privacy, and coexistence

**Decision 19 — this spec is docs-only: it corrects the earlier draft's
factual claims (PR #22 is merged; the remainder vocabulary; the authority
model), extends the docs, and keeps the legacy analyzer untouched; the
privacy model distinguishes an honest crash no-record from a persisted
record; legacy offline analysis coexists with the new evidence path without
reinterpretation.**

### 19.1 Status and factual corrections

- **PR #22 — the Spec 015 implementation — was MERGED** as commit
  `f18a153a` (it is the base of this branch). This spec's earlier drafts
  and the index misreported it as open/unmerged; that is corrected here
  and in `specs/000-index.md` (Spec 015 row: Implemented, merged).
- This draft (Spec 016) remains a **docs-only, Draft, unmerged** PR; it
  proposes modules it does not create (§11).
- Version-number corrections: this revision is **revision 7** of the draft
  (revisions 2, 3, 4, 5, 6, and 7 recorded in the index).
- The roadmap row for #23 stays "Draft spec 016".

### 19.2 Honest crash / no-record reporting

- A crash or worker failure **before the save attempt** (or a
  `contention-exhausted`/`storage-unavailable` outcome) means **no record
  exists**. This is declared at the system level
  (`crash-no-record` — a system declaration for interactions never
  persisted, §7.3), **never** on a record, and never presented as a
  "missing completeness fact": completeness facts exist only on records.
- The report/observability layer distinguishes: record saved (`stored`),
  record rejected (a `SaveOutcome`), record not attempted
  (crash/environmental). Each is reported with the closed code and
  nothing else (§16.4).
- The spec does not promise crash-proof storage; it promises honest
  absence reporting.

### 19.3 Privacy statements

- Privacy docs updated to state the **collection-time detect-then-retain
  pipeline** (§8.2), the **honest statuses** (§7.1), the **bounded
  captured-content admission** with the gate still running (§8.5–§8.6),
  the **normalized request-message representation** (§8.7), the **canonical
  home for retained delta text** (`responseEnvelope.deltaText`, §13.5),
  and the **leak-free projection rule** (§16.4).
- No statement in the docs claims "rejection is impossible" or that the
  collection pipeline replaces the persistence gate (§8.6).

### 19.4 Coexistence of legacy offline analysis and the evidence path

- The **legacy offline analyzer** (`@signalglass/core` traces →
  `AgentRun`) is **untouched**: offline runs that never touch the ingress
  produce legacy `AgentRun`s exactly as before; the ingress path
  additionally writes evidence records and projects them to `AgentRun`
  (§18). Both paths coexist; consumers see `AgentRun`s from either.
- The projection layers are the **canonical** bridge: `AgentRun` is a
  consumer shape, never extended with provider shapes (§12.2).
- **Divergence detection**: a record and its projected `AgentRun` are
  compared at test time (projection-parity tests, Spec 015); when the
  record's terminal is `request-failed`/`observation-detached`, the
  projection yields the documented statuses (§10.3) — the tests assert the
  derived mapping, they never patch the record.
- **Canonical vs. authoritative**: the `EvidenceRecord` is authoritative;
  the `EvidenceTrace` is the canonical derived view; the `AgentRun` is the
  legacy consumer projection. Nothing downstream rewrites the record
  (§12.2, §18).
---

## 20. Slice plan

**Decision 20 — implementation proceeds in five slices, each with a
shippable, testable outcome; the 1.1 schema foundation lands first, policy
second, parser third, decoder/assembler fourth, ingress wiring last; every
slice builds against the fields it actually consumes; no slice is
implemented in this docs-only spec.**

| Slice | Scope | Outcome | Depends on |
|---|---|---|---|
| **S1** | 1.1 schema foundation in `@signalglass/evidence`: additive `captureBoundary.streaming` parse/validation (incl. `decoderDisposition`, phase-accurate `RequestBodyRetention`, loss booleans incl. `unrecognizedRoleObserved`/`sseMetadataObservedButNotRetained`), `responseEnvelope.deltaText`, the **closed leaf-level request-message shape (§8.7) with version-aware scope** (validated on ≥ 1.1.x records only; 1.0.x `messages` parses/round-trips unchanged — T133), `record-budget-exceeded` as a closed `ObservationFailureCode`, version-aware MAJOR-1 validation, closed vocabularies, authority-model verification (deriveCompleteness recompute + disagreement failure, aggregate precedence + cross-validation incl. leaf-level rules §7.3.3) | `parseEvidenceRecord` accepts/validates 1.1 streaming records; tampering with derived fields fails parse; 1.0 records with arbitrary legacy `messages` unchanged | Spec 014/015 code (existing) |
| **S2** | `metadata-safe` v1.1.0 persistence policy (Rule 2 with the closed admitted paths §14.2, **inspecting each leaf's own status/declaration/path/length** — never the aggregate event status; cap exactly 240 code points) in `@signalglass/storage` + construction-time policy selection (Spec 015 model) + policy-version recording + leak-free `policy-failed` reasons (no `unknown-policy-version`) | persistence admits bounded captured content mechanically at closed paths; v1.0.0 unchanged; policy chosen at construction | S1 (1.1 records exist, deltaText/messages leaf shapes) |
| **S3** | `@signalglass/streaming`: L2 SSE parser (incremental, bounded, `[DONE]`-aware, deterministic post-terminal continuation, frame-overflow, **SSE-metadata fact `sseMetadataObservedButNotRetained` with comments-as-keepalives §6.1**) | parser unit-tested (T01–T12, T131); network-free | none |
| **S4** | `@signalglass/streaming` assembler + `@signalglass/providers` L3 decoder (openai-sse contract): normalization, `choiceIndex` identity, closed-category unmapped fields, usage, terminalization, honest evidence statuses, explicit nondeterministic inputs, remainder knowledge, `deltaText` assembly, **leaf-level request-message assembly with role sentinel (§8.7), evidence-budget enforcement (§3.5)** | decoder/assembler unit-tested (T13–T44, T49–T61, T72–T87, T101–T133); builds against S1 schema fields and S2 Rule 2 admitted-path contracts | S1 (schema fields), S2 (policy contracts as applicable), S3 |
| **S5** | `apps/ingress` wiring: streaming path on the existing route, passthrough pipeline + backpressure, bounded decoder tee, client-response orchestration (Spec 006 error-envelope semantics preserved), **evidence-budget configuration and validation at startup (§3.5)**, save-after-response-end, observability projection, **projection-matrix and parity rows in `@signalglass/core` updated for the new canonical fields** (deltaText, normalized leaf messages, decoderDisposition) | e2e tests (T62–T71, T98–T100, T125–T127) + parity/projection updates + integration with the existing suite | S2, S4 |

Each slice runs the full validation sequence before commit (AGENTS.md):
`pnpm test`, `pnpm build`, evidence-example validation, projection-matrix
verification, `git diff --check`, Fallow checks.

---

## 21. Test groups

**Decision 21 — 133 test groups (T01–T133) map to the 56 acceptance
criteria (§22) through the many-to-many mapping in §23. Tests live with the
slice that implements them (unit tests for parser/assembler/decoder/policy;
smoke tests for report generation; e2e for ingress wiring). Contract and
serialized-shape groups (T101–T133) assert the exact 1.1 shapes.**

### 21.1 SSE parser (L2) — T01–T12

- **T01** Incremental framing: CRLF frames split across arbitrary chunk boundaries.
- **T02** LF-only framing.
- **T03** Blank-line separation; multiple frames per buffer.
- **T04** `[DONE]` recognition (`event: [DONE]`).
- **T05** `[DONE]` ≠ EOF: trailing frames after `[DONE]` are forwarded and
  accounted (`post-terminal-content-not-retained`), never canonicalized (§6.6).
- **T06** Comment-only streams (colon lines) produce no frames.
- **T07** Multi-line `data:` fields joined per SSE spec.
- **T08** Unknown event types → `unrecognized-extension-frame` (closed
  fact, §7.3), stream continues.
- **T09** Partial frame at EOF → `sse-partial-frame-at-eof`.
- **T10** Invalid UTF-8 → `sse-invalid-utf8`.
- **T11** Frame overflow (buffer budget) → `frame-overflow` observation
  failure, detach (§1.4); passthrough continues.
- **T12** Bounded buffering: the parser never retains more than its budget
  regardless of input shape.

### 21.2 Decoder (L3) — T13–T22

- **T13** `chunk` frame → `{ kind: 'chunk', choiceIndex, chunkIndex, delta,
  finishReason? }`.
- **T14** `choice.index` normalization → `choiceIndex` identity.
- **T15** Multi-choice: same `choice.index` across frames = continuation;
  per-choice `chunkIndex` ordinal advances per choice.
- **T16** Duplicate same-frame `choice.index` → `sse-invalid-choice-index`.
- **T17** Missing/negative/invalid `choice.index` → `sse-invalid-choice-index`.
- **T18** `usage` frame → `{ kind: 'usage' }`; per-choice nested usage
  discarded + declared `per-choice-usage` (§6.3).
- **T19** `finish_reason` captured on chunk envelope.
- **T20** Unmapped delta sub-fields → closed categories
  (`role`/`tool-calls`/`refusal`/`audio`/`multimodal`/`other-extension`),
  never raw provider keys (§7.3).
- **T21** Provider `error` object frame → `{ kind: 'provider-error', code:
  'provider-error-frame' }` with bounded structural text.
- **T22** Unrecognized JSON object shapes → `unrecognized-provider-field` /
  `unrecognized-extension-frame` declared; stream continues.

### 21.3 Assembly (L4) — T23–T32

- **T23** Canonical events from a decoded stream; `seq` contiguous from 0;
  no gaps for unparsed frames.
- **T24** `model_request` / `model_response` placement; `responseMeta`
  emitted exactly once, first (§6.7).
- **T25** Chunk/usage canonical events; empty delta → `captured` (§7.1).
- **T26** Retention: benign ≤ cap → `captured`; > cap → `truncated`; masked
  → `redacted`; declaration lengths match actual transformation (§8.2).
- **T27** Final-event contract: `interaction_end` only on `completed`;
  nothing follows the terminal event (§10.5).
- **T28** `request-failed` record: `interaction_start` (0) + final `error`;
  no `model_request`, no fabricated `interaction_end`.
- **T29** No fabricated `interaction_end` on any non-`completed` terminal.
- **T30** `trace.status` derivation from terminal (§10.3).
- **T31** `span_start` / `span_end` placement around the model span.
- **T32** Determinism: identical fixed inputs → identical outputs,
  including loss codes and boundary statement (§12.6).

### 21.4 Terminalization — T33–T44

- **T33** `completed`: `[DONE]` → `span_end` + `interaction_end` (final).
- **T34** `upstream-failed` via HTTP error status: final `error`
  (`http-error-status`); numeric status in `responseMeta.statusCode`.
- **T35** `upstream-failed` via transport: `connection-error` /
  `upstream-timeout` / `tls-failure`.
- **T36** `upstream-failed` via provider error frame: `provider-error-frame`.
- **T37** `upstream-failed` via non-SSE 2xx valid object body (forwarded):
  `non-sse-response`.
- **T38** `upstream-failed` via non-SSE 2xx invalid body (local 502):
  `non-sse-response`.
- **T39** `malformed-stream`: each `sse-*` code → final `error` with that
  `error.type`.
- **T40** `client-cancelled`: final `cancelled`, `requestedBy: 'client'`.
- **T41** `ingress-cancelled`: final `cancelled`, `requestedBy: 'ingress'`.
- **T42** `observation-detached`: informational `error` (none/none) final;
  `trace.status` `unknown`; no `interaction_end`.
- **T43** `request-failed`: each `ClientRequestFailureCode` classified
  exactly once under actor `capture`.
- **T44** `error`/`cancelled` followed by `interaction_end` → rejected
  (`terminal_declaration_not_final`, Spec 014 §4.7).

### 21.5 Request failure — T45–T48

- **T45** `invalid-request` (400-class incl. over-limit body).
- **T46** `key-unavailable` / `missing-api-key`: actor `capture`, never an
  upstream outcome (§9.2).
- **T47** `unroutable`.
- **T48** `body-read-failure`: `requestBody` is `'no-bytes-observed'` (zero
  bytes) or `'partially-observed-not-retained'` (mid-body) per actual
  observation (§7.3.1); record exists with the body-read failure terminal.

### 21.6 Lifecycle / upstream–client outcomes — T49–T65

- **T49** `UpstreamOutcome 'response-completed'` recorded on success.
- **T50** `'connection-failed'` on transport failure.
- **T51** `'stream-ended-prematurely'` on EOF without `[DONE]`.
- **T52** `'not-started'` on pre-dispatch paths (never fabricated).
- **T53** `'cancelled-by-ingress'` with closed cause
  (`client-disconnect`|`ingress-shutdown`|`configured-limit`).
- **T54** `ClientResponseOutcome 'flushed'` on full client delivery.
- **T55** `'closed-before-completion'` on client close before flush.
- **T56** `'local-error-flushed'` on non-2xx normalization / invalid-body 502.
- **T57** `'not-started'` on pre-dispatch paths.
- **T58** 5×4 matrix: 14 valid cells accepted; 6 impossible pairs rejected at
  parse (§2.3).
- **T59** First-observed precedence: client disconnect first → upstream
  `cancelled-by-ingress` (`client-disconnect`) recorded; client outcome
  `closed-before-completion`.
- **T60** First-observed precedence: upstream failure first → `upstream-failed`
  terminal; client outcome per §2.4.
- **T61** No upstream outcome fabricated on pre-dispatch paths; upstream
  outcomes never inferred from client behavior (§2.4).
- **T62** Save timing: save after client-response end; exactly once per
  interaction (§3.1); terminal event included.
- **T63** Two lifecycles independent: observer continues after client close
  (detach/terminal per §1.2).
- **T64** Idle timeout → `ingress-cancelled` + `configured-limit`.
- **T65** Upstream status recorded from transport only (never derived from
  client outcome).

### 21.7 Encoded streams — T66–T71

- **T66** Gzip-encoded upstream: passthrough bytes unchanged; observation
  facts from the decoder tee (§5.5).
- **T67** Brotli-encoded upstream (when the configured decoder supports it).
- **T68** Tee decodes incrementally; `[DONE]`/frames observed from decoded
  bytes.
- **T69** Unsupported encoding → `observation-encoding-unsupported` +
  `encoded-content-not-observed` + detach; passthrough continues.
- **T70** Decode failure mid-stream → `observation-decode-failure` + detach.
- **T71** Backpressure maintained through the tee on all encoded paths.

### 21.8 Transparency — T72–T77

- **T72** Sentinel: credential beginning before the excerpt boundary is
  masked in full (§8.2).
- **T73** Sentinel: credential crossing the boundary is masked in full.
- **T74** Sentinel: credential beginning after the boundary is omitted or
  masked per the profile rule.
- **T75** Header allowlist: only `content-type`/`content-encoding`/
  `x-signalglass-trace-id` values retained; everything else excluded
  structurally (§5.1).
- **T76** `content-length` never forwarded; body-bytes-only transparency.
- **T77** `responseMeta` normalization: media-type parameters dropped and
  declared (`content-type-parameters-not-retained`).

### 21.9 Collection privacy — T78–T87

- **T78** Structural exclusion of sensitive headers (authorization, cookie,
  set-cookie, x-api-key, secret list) — nothing enters evidence (§8.2).
- **T79** API keys env-var-only; never read/retained/recorded by the
  assembler (§8.6).
- **T80** Detect-then-retain order: mask before the length boundary.
- **T81** Status honesty: benign content that fits the cap is `captured`,
  not `truncated`.
- **T82** `truncated` only when characters were removed; declaration
  lengths agree.
- **T83** `redacted` only when a span was actually masked; owning
  declaration present.
- **T84** Empty content → `captured` (§7.1).
- **T85** Loss facts closed and applicability-aware: `'not-applicable'` only
  where the source did not exist; `RequestBodyRetention` phase-accurate
  union (`no-bytes-observed` | `partially-observed-not-retained` |
  `fully-observed-not-retained` | `retained`) with distinct "not fully
  observed" vs. "observed but not retained" loss wording; no boolean
  conflation; **absence losses derived only when applicable**
  (`provider-usage-absent`/`finish-reason-absent` only on an observed SSE
  path; `remainder-after-*-cancellation` only when a response remainder
  existed); **aggregate precedence** (§7.3.3) for mixed retention; and
  **cross-validation**: boundary retention facts contradicting event
  statuses/declarations fail parse (§7.3.3).
- **T86** `unmappedDeltaFields` closed categories; raw provider keys never
  persisted.
- **T87** No full payloads, secrets, or keys in any projection (§16.4).

### 21.10 Persistence — T88–T97

- **T88** `stored` on an admissible 1.1 record.
- **T89** 1.1 record + v1.0.0 policy → `policy-rejected`
  `unknown-additive-field` (no silent discard).
- **T90** `captured` content-bearing field under v1.0.0 →
  `captured-content` (unchanged).
- **T91** v1.1.0 Rule 2: `captured` at a closed admitted path, ≤ cap,
  past the gate → admissible.
- **T92** Rule 2 rejection: non-admitted path, over-cap, or spoofed
  pedigree → `captured-content` (fail-closed, mechanical; §14.2).
- **T93** Safety gate runs on the actual submitted record; S1/S2/S3/S5/S6
  witnesses → `safety-rejected`.
- **T94** `policy-failed` with closed reason (`exception` |
  `malformed-decision` — Spec 015 verbatim, **no `unknown-policy-version`**);
  unknown policy version is a constructor error; **no `policy-crash`
  anywhere**.
- **T95** Contention → `EvidenceContentionError` → `contention-exhausted`
  (not a `SaveOutcome`; no record saved).
- **T96** `PersistenceObservation` is operational — never on the record;
  carries the **full typed `SaveOutcome`** (discriminated union, all typed
  fields preserved internally); leak-free reduction only in the diagnostic
  projection (§16.2, §16.4).
- **T97** `storage-unavailable` environmental failure.

### 21.11 Legacy coexistence — T98–T100

- **T98** Offline analyzer untouched: legacy `AgentRun` from offline traces
  unchanged.
- **T99** Projection parity: record ↔ projected `AgentRun` for every
  terminal (incl. `request-failed` → no fabricated empty turn).
- **T100** Architecture: record authoritative; trace canonical derived;
  `AgentRun` legacy projection; no provider shapes leak into core types.

### 21.12 Contracts / versioning / schema — T101–T117

- **T101** 1.0.x record parses unchanged; MAJOR-1 additive versions
  accepted by the gate (`version.ts`); version-aware validation (§13.7).
- **T102** The seven new serialized paths serialize exactly (§13.1); no
  `upstreamStatus` field anywhere.
- **T103** Closed vocabularies enforced at parse (unknown values fail):
  outcomes, causes, remainder, loss states, categories, codes (§13.4).
- **T104** Authority model: tampered derived fields
  (`completeness.lifecycle`, `declaredLosses`, `trace.assembly`,
  `boundaryStatement`) → `completeness_disagrees_with_derivation`.
- **T105** `observationTerminal` absent from the boundary; terminal derived
  from the final canonical event (§13.2).
- **T106** `trace.assembly` derived + verified against the authoritative
  boundary copy.
- **T107** Decoder-participation rule: `decoderDisposition` closed
  (`not-applicable` | `openai-sse` | `unsupported-encoding`);
  `decoderContract` derived (present iff `'openai-sse'`); disposition
  consistency per §13.4 (SSE → decoder present; encoded SSE decoded →
  decoder present; unsupported encoding → decoder selected but could not
  run, contract absent; non-SSE 2xx → absent; upstream non-2xx → absent;
  header-less failure → absent; **SSE headers followed by EOF/transport
  failure before the first complete frame → `'openai-sse'` with contract
  present and no chunk events — participation is selection/invocation,
  not frame count**, §13.4, T132).
- **T108** `trace.captureProfile` cross-checked; detector single home.
- **T109** §2.3 matrix pair validation; `lastObservedFramePosition`/`
  rawForwardedBytes` bounds; `statusCode` 100–599; content-type bounds.
- **T110** Remainder-knowledge vocabulary + summary honesty (no fabricated
  counts; `unknown` used honestly).
- **T111** Version-bump table: downgrade policy refuses
  `unknown-additive-field`; semver/literal-name validation; profile/detector
  version recording; a future minor does not bypass validation of known
  1.1-owned fields (§13.7).
- **T112** Leak-free projection: no exception messages, identities,
  documents, digests in any serialized or logged output (§16.4).
- **T113** `deltaText` contract: present only on `model_response_chunk`
  with retained text; absent on finish-only/usage-only/metadata-only/
  missing/wholly-omitted; per-leaf cap; event-level status ownership;
  raw-observation declarations; serialization + parse validation;
  multi-choice per-choice semantics; never in `providerNative` (§13.5).
- **T114** Normalized request-message shape (schema ≥ 1.1.x records only):
  array/object structure, permitted keys, **closed role discriminant with
  the `'unrecognized'` sentinel (raw unknown role values never
  retained, §8.7)**, string-or-part content where every content string is
  a serialized `ContentLeaf` with its own status and declarations, closed
  part kinds, per-leaf cap 240, unknown-key fail-closed
  (`request-message-unknown-fields`), multimodal/tool-call parts
  (`multimodal-payload-not-retained`), leaf-level ownership,
  captured-content paths (§8.7); an arbitrary object's serialized length
  is never content attestation; 1.0.x records with arbitrary legacy
  `messages` values are untouched (T133).
- **T115** Decoder participation per path: SSE → `openai-sse` (contract
  present); encoded SSE decoded → `openai-sse`; unsupported encoding →
  `unsupported-encoding` (contract absent, `encoded-content-not-observed`);
  non-SSE 2xx → `not-applicable`; upstream non-2xx → `not-applicable`;
  header-less failure → `not-applicable`; SSE headers + EOF before the
  first complete frame → `openai-sse` with contract present (§13.4, T132).
- **T116** Policy selection at construction: operator constructs storage
  with `metadata-safe` v1.0.0 or v1.1.0; capture profile/detector are
  validation inputs, never selectors; unknown/unavailable policy version
  is a constructor error; `PolicyFailureReason` stays `'exception' |
  'malformed-decision'` (§14).
- **T117** MAJOR-1 version behavior: gate accepts additive minor/patch in
  MAJOR 1; 1.0.x records carry no 1.1-owned fields; ≥ 1.1.x receives
  owned validation; future unknown additive fields preserved; unsupported
  MAJOR refused; a future minor cannot bypass known 1.1-owned validation
  (§13.7).

### 21.13 Revision-7 contract corrections — T118–T133

- **T118** Leaf-level ownership: one request carries mixed leaves
  (captured, truncated, redacted); each leaf serializes its own
  `evidenceStatus` and its own declarations; the event-level status is the
  §7.3.3 aggregate and equals the precedence of the leaf statuses (§8.7).
- **T119** A leaf that is both masked and shortened: `redaction` **and**
  `truncation` declarations coexist with real lengths (masked code points,
  original/retained/maxLength); leaf status `redacted`; neither
  transformation is erased (§8.7).
- **T120** Forged aggregate event status that disagrees with leaf ownership
  (e.g. event `captured`, leaf `truncated` with declaration) → parse
  failure `completeness_disagrees_with_derivation`; the aggregate never
  authorizes leaves (§7.3.3).
- **T121** Missing, malformed, or contradictory leaf declarations
  (`redacted` without `redaction`; declaration lengths disagreeing with
  retained text; `maxLength` ≠ 240) → parse failure (§7.3.3).
- **T122** Serializer/parse round trips through **both** `rawObservations`
  and the canonical trace preserve leaf ownership identically; no
  raw-only side channel (§8.7).
- **T123** Policy admission/rejection is per leaf — Rule 1/Rule 2 inspect
  each leaf's own status/declaration/path/length; a leaf is never admitted
  or rejected on the aggregate event status (§14.2).
- **T124** Closed role handling: known roles normalize; an unrecognized
  role string is **never retained** — the `'unrecognized'` sentinel is
  written, `unrecognizedRoleObserved === true`, and
  `unrecognized-role-not-retained` is derived; metadata labels bounded ≤
  128 (§8.7, §7.3).
- **T125** Evidence budgets — canonical-event count: a stream exceeding
  `maxCanonicalEvents` detaches with `record-budget-exceeded`, stops
  accumulating evidence, and continues byte-transparent backpressured
  passthrough; the record still saves once after the response path ends
  (§3.5).
- **T126** Evidence budgets — retained-content and serialized-growth:
  `maxRetainedContentCodePoints` / `maxSerializedEvidenceBytes` bound the
  record; `finalEventReservation` guarantees the terminal
  `observation-detached` event fits; honest losses
  (`remainder-after-observation-detach-not-observed`,
  `post-terminal-content-unknown` when applicable) are derived (§3.5).
- **T127** Adversarial: a never-ending / high-chunk-count stream (no
  `[DONE]`) cannot grow evidence memory beyond the budgets; transport
  remains unaffected and completes for the client (§3.5).
- **T128** Request-body phase accuracy: zero-byte / partial-body /
  full-body observations map to the exact `RequestBodyRetention` values;
  distinct derived loss wording — `request-body-not-fully-observed` vs.
  `request-body-not-retained` (§7.3).
- **T129** Pre-dispatch stage matrix: every pre-dispatch failure tested at
  zero-byte, partial-body, fully parsed, and normalized-message stages;
  `messageContent` is `not-observed` when no messages were formed and
  **`omitted`** + `message-content-not-retained` on valid pre-dispatch
  paths (missing key / key-unavailable / unroutable) where content was
  observed but no `model_request` is emitted (§10.2).
- **T130** Excerpt cap determinism: the v1.0.0 profile cap is exactly 240
  code points; no runtime-configurable range exists; parsers and policies
  know the cap from the profile identity alone; a different cap requires
  a profile version bump and a matching policy contract (§8.3, §14.2).
- **T131** SSE metadata loss: `event:`/`id:`/`retry:` field values observed
  but not retained → `sseMetadataObservedButNotRetained` +
  `sse-metadata-not-retained` (on an observed SSE path); raw field values
  never persisted; comment lines are protocol keepalives — never retained,
  never counted (§6.1, §7.3).
- **T132** Zero-frame decoder participation: SSE headers followed by EOF or
  transport failure before the first complete frame →
  `decoderDisposition: 'openai-sse'`, `decoderContract` present, no chunk
  events, terminal per §6.5 (participation is selection/invocation, not
  frame count) (§13.4).
- **T133** Genuine 1.0 compatibility: a valid 1.0.x record with an
  arbitrary legacy `RequestEnvelope.messages` value parses and
  round-trips unchanged; the closed §8.7 validation applies only to
  schema ≥ 1.1.x records; legacy 1.0 message shapes are never
  reinterpreted; a future minor still receives all known 1.1 validation
  (§13.7).
---

## 22. Acceptance criteria

**Decision 22 — 56 acceptance criteria (AC1–AC56). A spec is Implemented
only when every criterion is covered by tests, `pnpm test` passes, and
`pnpm build` passes (AGENTS.md).**

### 22.1 Ingress and delivery

- **AC1** — The existing Spec 006 route accepts streaming chat-completion
  requests and streams the upstream response to the client as an SSE stream,
  byte-transparent (no content mutation), with backpressure.
- **AC2** — `traceId == interactionId` is assigned at request observation;
  one canonical record is saved per interaction, exactly once, after the
  client-response path ends, including the terminal event.
- **AC3** — The observation lifecycle and the client-response lifecycle
  advance independently; a client close never fabricates an upstream
  failure (first-observed precedence, §2.4).

### 22.2 Outcome accounting

- **AC4** — `UpstreamOutcome` is the closed set
  `not-started | response-completed | connection-failed |
  stream-ended-prematurely | cancelled-by-ingress`, recorded authoritatively
  in `captureBoundary.streaming.upstream`; a pre-dispatch path records
  `not-started` (never fabricated).
- **AC5** — `ClientResponseOutcome` is the closed set
  `not-started | flushed | closed-before-completion | local-error-flushed`,
  recorded authoritatively in `captureBoundary.streaming.clientResponse`.
- **AC6** — The 5×4 upstream × client-response matrix is enforced: 14 valid
  cells accepted, 6 impossible pairs rejected at parse (§2.3).
- **AC7** — Pre-dispatch failures (invalid request, missing key,
  key-unavailable, unroutable, body-read failure, over-limit) are reachable
  from `request-observed`; each produces a valid record with the terminal
  `error` as the final event, no `model_request`, and no fabricated
  `interaction_end`.
- **AC8** — Upstream outcomes are recorded from the transport, never
  inferred from client behavior; ingress-initiated cancellation records
  `cancelled-by-ingress` with a closed cause
  (`client-disconnect | ingress-shutdown | configured-limit`).

### 22.3 Parsing, decoding, assembly

- **AC9** — The SSE parser is incremental, bounded, and `[DONE]`-aware;
  trailing content after `[DONE]` is forwarded and declared
  (`post-terminal-content-not-retained`), never canonicalized.
- **AC10** — `RemainderKnowledge` is the closed four-value vocabulary
  (§12.4); the loss is `remainder-after-observation-detach-not-observed`;
  no fabricated frame counts anywhere.
- **AC11** — The L3 decoder normalizes chunk/usage/finish-reason/provider-error
  into `StreamDecodedEvent`; `choiceIndex` is normalized identity, per-choice
  `chunkIndex` is ordinal.
- **AC12** — Duplicate same-frame `choice.index` →
  `sse-invalid-choice-index`; the same index across frames is a
  continuation.
- **AC13** — Unmapped delta fields map to closed categories
  (never raw provider keys); per-choice nested usage is discarded and
  declared `per-choice-usage`.
- **AC14** — `MalformedStreamCode` is the closed five-value set; each code
  maps to the `malformed-stream` terminal with that `error.type`.
- **AC15** — The terminal matrix (§9.3) classifies every observed situation
  to exactly one terminal; `error`/`cancelled` shapes are closed
  (actor/lifecycleTarget/lifecycleEffect; `cancellation.requestedBy`);
  `error.type` carries a closed code; `error.message` is ≤ 200 chars of
  structural text and never classifies.
- **AC16** — The terminal declaration is the record's final canonical
  event; `interaction_end` occurs only on `completed`; `error`/`cancelled`
  followed by `interaction_end` is rejected (`terminal_declaration_not_final`).
- **AC17** — `request-failed` classifications use actor `capture`;
  `key-unavailable` is classified exactly once, under `request-failed`,
  never as an upstream outcome.
- **AC18** — `trace.status` is derived from the observation terminal
  (`completed`/`failed`/`cancelled`/`unknown`), never independently recorded.

### 22.4 Evidence statuses and privacy

- **AC19** — Evidence statuses are honest: `captured` only when complete at
  the declared boundary; `truncated` only when characters were actually
  removed; `redacted` only when content was actually masked; empty content
  is `captured`. **Every retained request-content leaf owns its own status
  and its own declarations** (serialized `ContentLeaf`, §8.7); the
  event-level status is a derived aggregate that never authorizes nested
  leaves for persistence; chunk `deltaText` is one leaf per event (§13.5).
- **AC20** — The `signalglass.collection.ingress-metadata-safe` v1.0.0
  excerpt cap is **exactly 240 code points** (no runtime-configurable
  range); parsers and policies know the cap from the profile identity;
  changing it requires a capture-profile version bump and a matching
  policy contract (§8.3).
- **AC21** — Collection runs detect-then-retain: the versioned detector
  scans the full candidate text before any length boundary; masking
  precedes truncation; owning declarations carry real lengths.
- **AC22** — Error payloads are structural and bounded (≤ 200 chars), never
  embedding secrets, headers, URLs, or raw provider bodies; the provider
  raw body is declared lost only when a provider error actually occurred.
- **AC23** — `responseMeta` appears on `model_response` exactly once (the
  first response-derived event), with `statusCode` 100–599 and normalized
  `contentType`; header-less paths carry no status anywhere.

### 22.5 Assembler and architecture

- **AC24** — The assembler is pure: ids and timestamps are explicit
  parameters; identical fixed inputs produce identical outputs (including
  loss codes and boundary statement).
- **AC25** — `seq` is contiguous from 0 with no gaps for unparsed frames;
  the assembler is the single sequencing surface.
- **AC26** — The `EvidenceRecord` is authoritative, the `EvidenceTrace` is
  the canonical derived view, and `AgentRun` is a legacy/consumer
  projection; no provider shapes enter core models.
- **AC27** — `captureBoundary.streaming` is the single authoritative input;
  `observationTerminal` is not recorded there — the terminal is derived
  from the final canonical event.
- **AC28** — Single authority per fact: `trace.assembly` is derived and
  verified against the boundary; `trace.captureProfile` is cross-checked;
  the detector identity has one home; the decoder-participation rule holds
  (`decoderDisposition` authoritative; `decoderContract` derived from it,
  not from `model_response` presence).
- **AC29** — `deriveCompleteness` derives `completeness.lifecycle`,
  `completeness.declaredLosses`, and the summary; parse recomputes and
  rejects disagreement (`completeness_disagrees_with_derivation`).
- **AC30** — Declared-loss codes are a closed set derived deterministically
  from applicability-aware authoritative facts; absence losses
  (`provider-usage-absent`, `finish-reason-absent`,
  `remainder-after-client-cancellation`, `remainder-after-ingress-cancellation`)
  are derived only when applicable; `request-body-not-fully-observed` and
  `request-body-not-retained` distinguish partial from complete body
  observation (§7.3.2); `sse-metadata-not-retained` and
  `unrecognized-role-not-retained` declare observed-but-unretained SSE
  fields and unknown roles; `message-content-not-retained` is derived on
  valid pre-dispatch paths where content was observed but no `model_request`
  was emitted; aggregate precedence and leaf-level boundary-vs-event
  cross-validation hold; post-terminal accounting is the three-state fact;
  no inverted boolean derivations.

### 22.6 Schema and versioning

- **AC31** — The 1.1 schema adds exactly seven serialized paths (§13.1),
  including `events[].responseEnvelope.deltaText` for retained delta text;
  no `upstreamStatus` field; usage normalization is a clarification with
  exact `UsageValue`/`UsageRecord` shapes; the normalized request-message
  representation with serialized leaf-level ownership is defined for
  schema ≥ 1.1.x records (§8.7).
- **AC32** — 1.0.x records parse unchanged; the version gate accepts
  additive minor/patch within MAJOR 1 (not an exact `1.0.0 | 1.1.0`
  allowlist); 1.0.x records carry no 1.1-owned fields **and their
  arbitrary legacy `RequestEnvelope.messages` values parse and round-trip
  unchanged, never reinterpreted as the §8.7 representation**; ≥ 1.1.x
  fields receive owned validation (incl. the closed leaf-level
  request-message shape); future unknown additive fields are preserved;
  unsupported MAJOR versions are refused; a downgrade policy refuses
  1.1-owned fields (`unknown-additive-field`) rather than dropping them.
- **AC33** — Persistence uses the Spec 015 pipeline unmodified: the
  operator constructs `EvidenceStorage` with the persistence policy
  (construction-time selection); version gate (MAJOR-1 additive),
  structural integrity, storage-safety gate, persistence policy, and the
  real discriminated-union `SaveOutcome` are used; capture profile/detector
  are validation inputs, never policy selectors.
- **AC34** — `metadata-safe` v1.1.0 admits bounded `captured` content
  mechanically at closed admitted paths (request-message content leaves
  §8.7 and chunk `deltaText` §13.5), **inspecting each leaf's own
  status/declaration/path/length — never the aggregate event status**; a
  spoofed pedigree cannot bypass the gate, the length bound, the path
  allowlist, the leaf-ownership check, or the version rule; non-admitted
  paths fail closed; the known profile/detector are validation inputs,
  never selectors.
- **AC35** — v1.0.0 is never weakened or reinterpreted; policy version ≠
  schema version (§14.3 table holds).
- **AC36** — `policy-crash` does not exist; policy exceptions are
  `policy-failed` with closed reasons; no exception text propagates.
- **AC37** — `PersistenceObservation` is operational (never persisted) and
  carries the full typed `SaveOutcome` (discriminated union, all typed
  fields preserved internally; leak-free reduction only in the diagnostic
  projection); `contention-exhausted` is an environmental failure, not a
  `SaveOutcome`.
- **AC38** — Save starts after the client-response path ends, exactly once,
  with the terminal event included.

### 22.7 Observability, coexistence, honesty

- **AC39** — Observability is leak-free (closed codes, counts, durations,
  bounded structural text; never exception messages, identities, documents,
  digests) and never re-derives authoritative facts independently.
- **AC40** — The legacy offline analyzer is untouched; both paths coexist;
  projection parity holds for every terminal.
- **AC41** — Privacy claims are honest: "expected admissible, rejection
  still possible"; a crash/no-save is reported as `crash-no-record` at the
  system level, never as a record completeness fact.
- **AC42** — Backpressure holds end-to-end (upstream read paced by client
  writability); no unbounded buffering; the in-memory `EvidenceRecord` is
  bounded by the decided evidence budgets (§3.5) — budget exhaustion
  detaches observation (`record-budget-exceeded`) without affecting the
  byte-transparent passthrough, and the record still saves once after the
  response path ends.
- **AC43** — Encoded streams are observed through a bounded decoder tee;
  unsupported/undecodable content detaches observation with
  `encoded-content-not-observed` while the passthrough continues.
- **AC44** — No secrets, keys, or full raw payloads are stored or logged;
  API keys remain env-var-only.

### 22.8 Delivery and documentation

- **AC45** — Versioning rules are normative: literal names, semver
  validation, and the version-bump table.
- **AC46** — All criteria are covered by tests (133 groups, §21); `pnpm
  test` and `pnpm build` pass on the implementation branch.
- **AC47** — This spec is docs-only: modules are named and specified, not
  created.
- **AC48** — Factual claims are correct: PR #22 (Spec 015 implementation,
  commit `f18a153a`) is **merged**; `specs/000-index.md` reflects that
  (Implemented, merged) and records Spec 016 as revision 7, Draft.
- **AC49** — Every retained request-content leaf serializes its own
  `evidenceStatus` and its own redaction/truncation declarations with real
  lengths; a leaf masked **and** shortened carries both declarations;
  serializer/parse round trips through `rawObservations` and the canonical
  trace preserve leaf ownership identically; the event-level status is a
  derived aggregate that never authorizes leaves (§8.7, T118–T123).
- **AC50** — Request-message roles are a closed discriminant
  (`KnownRole | 'unrecognized'`); unrecognized role values are never
  retained — the sentinel is written and `unrecognized-role-not-retained`
  is derived; the spec never claims closed roles while preserving
  arbitrary strings (§8.7, §7.3, T124).
- **AC51** — The in-memory evidence record is bounded by named evidence
  budgets with decided defaults and validation (§3.5); exhaustion detaches
  with `record-budget-exceeded`, stops accumulating evidence, never
  cancels or truncates client traffic, derives honest unknown-remainder
  and detachment losses, and still finalizes and saves once after the
  response path ends (T125–T127).
- **AC52** — Request-body losses are phase-accurate
  (`no-bytes-observed | partially-observed-not-retained |
  fully-observed-not-retained | retained`) with distinct "not fully
  observed" vs. "observed but not retained" wording; pre-dispatch paths
  classify `messageContent` per stage — `omitted` +
  `message-content-not-retained` on valid pre-dispatch paths where content
  was observed but no `model_request` was emitted, never `not-observed`
  merely because the canonical event was omitted (§7.3, §10.2, T128–T129).
- **AC53** — The excerpt cap is deterministic: exactly 240 code points for
  `signalglass.collection.ingress-metadata-safe` v1.0.0; no
  runtime-configurable range; a different cap requires a future
  capture-profile version and a matching policy contract (§8.3, T130).
- **AC54** — Observed-but-unretained SSE metadata (`event:`/`id:`/`retry:`
  field values) is a closed loss fact deriving
  `sse-metadata-not-retained`; raw provider-controlled field values are
  never persisted; comment lines are decided to be protocol keepalives,
  never retained and never counted (§6.1, §7.3, T131).
- **AC55** — Decoder participation is selection/invocation, not frame
  count: SSE headers followed by EOF or transport failure before the first
  complete frame still yields `decoderDisposition: 'openai-sse'` with
  `decoderContract` present and no chunk events (§13.4, T132).
- **AC56** — Genuine 1.0 compatibility: the closed §8.7 request-message
  validation applies only to schema ≥ 1.1.x records; a valid 1.0.x record
  with an arbitrary legacy `messages` value parses and round-trips
  unchanged and is never reinterpreted; a future minor still receives all
  known 1.1 validation (§13.7, T133).

---

## 23. Test-group ↔ acceptance-criteria mapping

**Decision 23 — many-to-many mapping, every AC covered by ≥ 1 test group,
every test group tied to ≥ 1 AC.**

| AC | Test groups | AC | Test groups |
|---|---|---|---|
| AC1 | T62, T66, T71, T98 | AC25 | T23, T102, T113 |
| AC2 | T62, T96 | AC26 | T99, T100, T26 |
| AC3 | T59, T60, T63 | AC27 | T104, T105 |
| AC4 | T49–T53, T58, T61 | AC28 | T106–T108, T115, T132 |
| AC5 | T54–T58 | AC29 | T104, T110 |
| AC6 | T58, T109 | AC30 | T85, T86, T110, T124, T128, T129, T131 |
| AC7 | T28, T43, T45–T48, T129 | AC31 | T102, T103, T113, T114 |
| AC8 | T53, T59–T61, T64 | AC32 | T89, T101, T111, T117, T133 |
| AC9 | T05, T06, T110 | AC33 | T88, T93, T97, T116 |
| AC10 | T110, T69 | AC34 | T91, T92, T114, T123 |
| AC11 | T13–T15, T18, T19, T21 | AC35 | T89, T90, T116 |
| AC12 | T16, T17 | AC36 | T94 |
| AC13 | T18, T20, T86 | AC37 | T95, T96 |
| AC14 | T39 | AC38 | T62 |
| AC15 | T33–T43, T109 | AC39 | T87, T112 |
| AC16 | T27, T29, T44 | AC40 | T98, T99 |
| AC17 | T43, T46 | AC41 | T72–T74, T87, T95 |
| AC18 | T30 | AC42 | T12, T71, T125–T127 |
| AC19 | T26, T81–T84, T113, T114, T118–T120 | AC43 | T66–T70, T115, T132 |
| AC20 | T26, T111, T130 | AC44 | T78, T79, T87 |
| AC21 | T72–T74, T80, T114, T119 | AC45 | T102, T107, T111 |
| AC22 | T21, T87, T112 | AC46 | §21 all |
| AC23 | T24, T77 | AC47 | §11, §20 (docs-only) |
| AC24 | T32, T109 | AC48 | §19.1, index row |
| AC49 | T118–T123 | AC53 | T130 |
| AC50 | T124 | AC54 | T131 |
| AC51 | T125–T127 | AC55 | T132 |
| AC52 | T128, T129 | AC56 | T133 |

Coverage: every AC (1–56) appears above; every test group T01–T133 appears
at least once.

---

## 24. Deferred (explicitly out of scope)

- Export policies, retention of stored records, and storage compaction.
- A second provider adapter beyond `signalglass.providers.openai-sse`
  (roadmap #36).
- Replay, query/read APIs (roadmap #28), the explorer (roadmap #29/#30),
  and OpenTelemetry export (roadmap #37).
- PII/credential detection beyond the documented detector patterns; the
  detector is versioned and its coverage is a documented limit (§8.6).
- Performance targets and load-test numbers.

---

## 25. Open questions

**None.** The revision-7 pass resolved the seven revision-6 review blockers
— the contracts that remained inconsistent or normalized losses away:

1. (resolved) **Leaf-level ownership**: every retained request-content leaf
   serializes its own status and its own redaction/truncation declarations
   with real lengths, including a leaf both masked and shortened; the
   event-level status is a derived aggregate that never authorizes nested
   leaves; Rule 1/Rule 2 inspect each leaf (§8.7, §14.2).
2. (resolved) **Closed role type reconciled with the prose**: the raw
   unknown role value is never preserved — the normalized role is a closed
   discriminant (`KnownRole | 'unrecognized'` sentinel) with a closed loss
   fact/code (`unrecognized-role-observed` /
   `unrecognized-role-not-retained`); metadata labels are bounded and
   never content-attested (§8.7).
3. (resolved) **Bounded in-memory evidence record**: named evidence budgets
   with decided defaults and validation (§3.5); exhaustion detaches with
   `record-budget-exceeded`, keeps the passthrough byte-transparent, and
   still saves once after the response ends.
4. (resolved) **Phase-accurate request-body and pre-dispatch losses**: a
   four-value closed union distinguishes no-bytes from partial from full
   observation; distinct "not fully observed" vs. "observed but not
   retained" wording; `messageContent` is `omitted` +
   `message-content-not-retained` on valid pre-dispatch paths, never
   `not-observed` merely because the canonical event was omitted (§7.3,
   §10.2).
5. (resolved) **Deterministic excerpt cap**: exactly 240 code points for
   the v1.0.0 profile; the runtime-configurable 64–4096 claim is removed;
   a different cap requires a profile version bump and a matching policy
   contract (§8.3).
6. (resolved) **SSE metadata loss and zero-frame decoder participation**: `event:`/`id:`/`retry:`
   values observed-but-unretained are a closed fact + code; comments are
   decided keepalives; `decoderDisposition: 'openai-sse'` means
   selection/invocation, not "decoded at least one frame" (§6.1, §13.4).
7. (resolved) **Genuine 1.0 compatibility**: the closed request-message
   validation applies only to schema ≥ 1.1.x records; 1.0.x records with
   arbitrary legacy `messages` values parse and round-trip unchanged and
   are never reinterpreted; a future minor still receives all known 1.1
   validation (§13.7).

---

## 26. References

- Spec 006 — Ingress OpenAI-compatible (implemented; the route, error
  envelope, and env-var key handling this spec composes).
- Spec 007 — Storage and privacy (policies, structural exclusion).
- Spec 013 — Evidence model (canonical event shapes, capture boundary,
  completeness, vocabulary).
- Spec 014 — Evidence primitives (lifecycle derivation,
  `terminal_declaration_not_final`, `interaction_end` finality, additive
  parse).
- Spec 015 — Append-only evidence store (implemented and **merged** as
  `f18a153a`; storage-safety gate, `SaveOutcome`, `EvidenceContentionError`,
  `metadata-safe` policy).
- `packages/evidence/src/types-event.ts`, `types-record.ts`,
  `types-envelope.ts`, `types-base.ts`, `vocabulary.ts`, `derive-trace.ts`,
  `completeness.ts`, `version.ts` — the implemented contracts this spec
  matches (incl. the MAJOR-1 version gate and the `ResponseEnvelope`/
  `RequestEnvelope` shapes this spec extends additively).
- `packages/storage/src/evidenceStorage.ts` — the persistence pipeline.
- `packages/core/src/evidenceProjections/` — the projection layers
  (`evidenceToAgentRun` etc.).
- `apps/ingress/src/server.ts`, `apps/ingress/src/forward.ts` — Spec 006
  behavior this spec preserves (non-2xx normalization, invalid-body 502,
  pre-dispatch rejections).
- `docs/evidence-model.md`, `docs/capture-profiles.md`,
  `docs/privacy.md`, `docs/roadmap.md` (roadmap items #22–#31, #35–#38,
  #40), `specs/000-index.md`.
