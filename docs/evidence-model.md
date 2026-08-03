# SignalGlass evidence model

The evidence model is the canonical, provider-neutral contract for recording AI
interactions as **evidence**, deriving deterministic **measurements** from that
evidence, and keeping **interpretations** clearly separate. The normative
contract is [Spec 013](../specs/013-evidence-model.md); this document is the
human-facing reference with serialized examples.

Design in one paragraph: an **interaction** is the logical AI exchange being
observed, and its authoritative serialized record is an **`EvidenceRecord`**.
That record preserves raw observations and contains a deterministic canonical
**trace** view with **spans** (structure: hierarchy, timing, status) and
**events** (content: payloads, transitions, sequence position), plus structural
analysis, completeness, capture boundary, and schema identity.
Every event carries a strictly increasing `seq` assigned at observation time —
the only deterministic ordering key. Every payload declares an **evidence
status** (captured, redacted, truncated, missing, unknown, not applicable) and
an **observation role** (who saw it, at which boundary). Measurements and
interpretations are derived records that always cite the evidence they came
from. Collection, persistence, and export are three independent policies bundled
into versioned **capture profiles**.

## Records at a glance

| Record | Canonical? | Holds |
|---|---|---|
| Evidence record | Yes | Authoritative raw observations plus trace, analysis, completeness, capture boundary, and schema identity |
| Interaction | Yes (domain entity) | Logical AI exchange whose evidence is recorded |
| Trace | Derived canonical view | Identity, lifecycle, conditions, spans, and events |
| Span | Yes | Hierarchy, timing, status; aggregates its events |
| Event | Yes | Content, evidence status, sequence position |
| Request / Response envelope | Yes | Normalized fields + provider-native payload at a declared fidelity |
| Context artifact | Yes | A referenceable unit of context with provenance |
| Context contribution | Yes | The recorded act of adding context to a request |
| Condition | Yes (metadata) | Declared experimental/environmental conditions |
| Observation boundary | Yes (metadata) | What the capture surface could and could not observe |
| Completeness record | Derived | Status counts, seq gaps, duplicates, boundary statement |
| Measurement record | Derived | Deterministic derivation (tokens, latency, cost) |
| Interpretation record | Derived | Labeled, optional, reviewable judgment |
| Run | Projection | Session-level grouping of interactions |

## Identity and ordering

- The trace view carries both `interactionId` and `traceId` at the top
  level with equal values; the equality is an invariant. Spans and events
  carry `traceId` only. One interaction, one trace, one identity.
- Every event carries `seq`: a non-negative integer, strictly increasing and
  **contiguous** within the trace (first event `seq` 0; each subsequent event
  exactly one greater). `seq` is assigned by the capture surface at observation
  time and is **the only deterministic ordering key.**
- Timestamps (`capturedAt`, ISO 8601 UTC) may tie and are never used for
  ordering. `durationMs` comes from a monotonic clock.
- Spans declare `startSeq`/`endSeq`; nested spans reference `parentSpanId`
  (hierarchy only). Spans with overlapping `seq` ranges are concurrent.
- Exact replays have the same `eventId`, `seq`, and semantically equal
  canonical event projection (all canonical event fields, excluding raw-only
  provenance such as `observationId` and `rawCapturedAt`). They collapse to
  one event in the trace view
  without a gap while every raw observation remains preserved. Same-ID,
  same-sequence observations with conflicting projected content are rejected,
  as are different event IDs that claim the same retained canonical sequence
  position. For the same event ID at different sequence positions, the
  lowest-`seq` position is retained and every discarded position is a gap
  unless another valid retained event independently occupies it. Retained
  events are never renumbered; arrival order, raw array order, timestamps,
  opaque identifiers, and digests never select a winner.
- A `seq` gap proves that an assigned sequence position is absent from the
  retained evidence (an event that reached the sequencing surface was dropped
  before persistence or removed from retention). A gap cannot detect an event
  that failed before a sequence number was assigned, so an uninterrupted `seq`
  range does not prove complete capture. Uncaptured events are disclosed
  through the completeness record and boundary statements — for example, an
  explicit `missing` record — never inferred from sequence position.
  SignalGlass never invents missing events.

## Evidence status

Every payload carries exactly one `evidenceStatus`:

| Status | Meaning |
|---|---|
| `captured` | Content present at its declared fidelity (`structurally_faithful` or `byte_faithful`). |
| `redacted` | Content existed; removed/masked per a recorded policy. A hash may remain only over the retained redacted representation; it never implies possession of the original. |
| `truncated` | Content existed; only a declared prefix/excerpt stored. |
| `missing` | Capture failed or didn't happen; no claim about content. |
| `unknown` | Cannot determine whether the content existed (e.g., provider internals). |
| `not_applicable` | No such content applies (e.g., a control event with no request body). |

`inferred` is **not** an evidence status: it appears only on derived records
(measurements, interpretations) and must be labeled there.

Evidence states are never collapsed into `null` or omitted fields: `unknown`,
`missing`, `not_applicable`, and a captured numeric zero (for example,
`output_tokens: 0`) are distinct and are represented by a status plus an
explicit value where one exists. `null` appears only for structural absence (a
root span's `parentSpanId`, an event attached to the trace root via `spanId`).

## Observation boundaries

Each payload records the role under which it was observed:

- `application_constructed` — built by the application/agent before capture
- `client_sent` — observed crossing the wire to the provider (ingress capture)
- `provider_reported` — reported by the provider (usage, finish reason)
- `returned` — delivered back to the caller
- `unobservable` — could not be observed; represented as `unknown`, never guessed

A claim is scoped to the boundary where it was observed. A `client_sent` payload
proves what the client sent, not what the provider did internally.

## Context provenance

- A **context artifact** is a referenceable unit of content: `artifactId`,
  `kind` (message, file, document, fragment, tool result, MCP response,
  retrieval result, context-provider result, repository content, manual),
  `payloadRef` (payload-reference fields only — never `evidenceStatus` or
  `contentHash`), a top-level `evidenceStatus`, a top-level `contentHash`
  (never nested inside `payloadRef`), `contentFidelity` and `contentType`
  (the artifact-local description of the retained representation that
  selects the hashing path), `contentCanonicalizer` (`{ name, version }`),
  `contentHashUnavailableReason` (when retained content exists but no
  supported deterministic canonicalizer is available), and `provenance`
  (source path/URI/query/range). The hashing path is decided from the
  artifact's own serialized fields, so a standalone artifact is
  self-describing: `byte_faithful` retained bytes are hashed directly as
  bytes (never treated as UTF-8 text); `structurally_faithful` JSON is
  canonicalized with RFC 8785 (JCS) (the schema-fixed default) and hashed as
  UTF-8; other structured formats hash only with their declared versioned
  canonicalizer and its specified output encoding; if no deterministic
  canonicalizer exists, no hash is emitted and
  `contentHashUnavailableReason: "unsupported_canonicalizer"` is recorded.
  `contentHash` presence depends on evidence status: required for `captured`
  content with a reproducible hashing path, hashing only the retained prefix
  when `truncated`, permitted over the retained redacted representation when
  `redacted`, and forbidden for `missing`/`unknown`/`not_applicable` (§6.1 of
  Spec 013). `contentHash` always hashes the retained representation and
  never implies possession of discarded original content. A **standalone
  artifact** (not provably enclosed by its trace) MUST serialize `traceId`
  and `evidenceSchemaVersion` explicitly, and its `traceId` MUST resolve to
  a known trace.
- A **context contribution** records that an artifact entered a model request:
  artifact reference, deterministic locator (`whole` | `range` | `fragment` |
  `hash`), position in the assembled context, and provenance state
  (`recorded` at capture or `inferred_after` — the latter always labeled).
- Provenance accompanies payloads and never alters them.

## Measurements and interpretations

**Measurement records** are deterministic derivations over evidence. They always
carry: `type`, `value` + `unit`, `algorithm` (name + version), `inputs`
(evidence references), `configuration` (tokenizer/pricing/threshold versions),
`calculatedAt`, and a `kind`:

| Kind | Meaning |
|---|---|
| `provider_reported` | Provider reported the value. |
| `locally_calculated` | Computed deterministically from captured evidence. |
| `reconciled` | Provider + local values combined by a recorded rule. |
| `estimated` | Derived from a stated approximation model; labeled as an estimate. |

Cost is a **derivation**, never evidence: a cost measurement references the
token-count measurements it multiplies and the pricing table version used.

**Interpretation records** are labeled, optional, versioned judgments: `title`,
`kind` (smell, recommendation, finding, explanation), `inputs` (the evidence and
measurements they cite), a stable versioned `label`, a `claim` with a checkable
evidence basis, and a `confidence` of `high`/`medium`/`low`/`not_rated`.
Interpretation confidence is explicitly subjective and is never presented as a
measurement. Interpretations never modify evidence.

## Provider-native fidelity

Provider-native payloads are preserved at a declared `providerNativeFidelity`:

- `structurally_faithful` (default) — the parsed structure that was captured
  (for example, a JSON object), with values equivalent to what was observed.
  Field order, raw bytes, original whitespace, lexical formatting, and
  transport encoding are not preserved. Byte-for-byte equivalence is not
  claimed.
- `byte_faithful` — the exact native byte sequence observed by the capture
  surface (before any decoding, normalization, envelope construction, or
  serialization), with `nativeEncoding` and `nativeContentType` recorded.
  `nativeContentHash` (`sha256:` + 64 lowercase hex, over exactly those
  observed bytes) is **required** when the payload is `captured`, and
  forbidden when the exact byte sequence was not observed or not retained
  (`missing`/`unknown`/`not_applicable`, and `redacted`/`truncated` native
  payloads — those are byte-faithful only to their retained representation,
  never to discarded originals). `byte_faithful` itself requires
  `evidenceStatus: "captured"`. It is also optional on `structurally_faithful`
  envelopes when a transparent capture surface observed and retained the
  exact bytes — it verifies the observed stream without claiming the
  canonical record is byte-exact. It differs from artifact-level
  `contentHash`, which hashes the retained representation per fidelity and
  canonicalization rules (Spec 013 §3.2); the two digests are equal only when
  the retained representation is the exact observed byte sequence with no
  transformation.

An envelope never implies byte fidelity unless `byte_faithful` is recorded.

## Projections

- **Run** — a derived, session-level grouping of interactions. The legacy
  `AgentRun` is a projection over evidence, not a canonical container.
- **Legacy trace view** — the v0.x `Trace`/`TraceEvent` shape is a legacy
  record; the accepted contract requires it to be expressed as a
  compatibility projection over evidence. Spec 013 (accepted) supersedes the
  legacy trace spec (see Spec 013 §11).
- **Redacted exports** — projections under an export policy; they never
  overwrite authoritative evidence.

## Serialized examples

The following examples are normative illustrations of Spec 013. **Each numbered
example is an independent trace**: its own identifiers and its own `seq`
sequence starting at 0; no sequence continues from one example to the next.
Every complete trace includes `interaction_start` and `interaction_end`, and no
event appears after the terminal `interaction_end`. `null` appears only for
structural absence — a root span's `parentSpanId`, or an event attached to the
trace root via `spanId`; evidence status and measured values are never `null`.

### 1. Minimal single-span interaction

A complete trace with one model span and lifecycle events:

```json
{
  "interactionId": "01J5TZXQ8K7M2N4P6R8T0VXWY1",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY1",
  "evidenceSchemaVersion": "1.0.0",
  "captureProfile": { "name": "dev-basic", "version": "1.2.0" },
  "captureSurface": "client_side",
  "observationBoundary": "application_constructed",
  "startedAt": "2025-06-01T14:00:00.123Z",
  "finishedAt": "2025-06-01T14:00:05.411Z",
  "status": "completed",
  "conditions": [
    { "label": "prompt_variant", "value": "baseline", "version": "1.0.0" }
  ],
  "spans": [
    {
      "spanId": "span-1-0001",
      "kind": "model",
      "name": "model:claude-sonnet-4",
      "parentSpanId": null,
      "startSeq": 1,
      "endSeq": 2,
      "startedAt": "2025-06-01T14:00:00.200Z",
      "finishedAt": "2025-06-01T14:00:05.300Z",
      "durationMs": 5100,
      "status": "completed"
    }
  ],
  "events": [
    { "eventId": "evt-1-0001", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY1", "spanId": null, "seq": 0, "kind": "interaction_start", "capturedAt": "2025-06-01T14:00:00.123Z", "evidenceStatus": "captured" },
    { "eventId": "evt-1-0002", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY1", "spanId": "span-1-0001", "seq": 1, "kind": "span_start", "capturedAt": "2025-06-01T14:00:00.200Z", "evidenceStatus": "captured" },
    { "eventId": "evt-1-0003", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY1", "spanId": "span-1-0001", "seq": 2, "kind": "span_end", "capturedAt": "2025-06-01T14:00:05.300Z", "evidenceStatus": "captured" },
    { "eventId": "evt-1-0004", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY1", "spanId": null, "seq": 3, "kind": "interaction_end", "capturedAt": "2025-06-01T14:00:05.411Z", "evidenceStatus": "captured" }
  ]
}
```

These numbered JSON objects are canonical trace-view fixtures, not standalone
authoritative evidence records. An authoritative `EvidenceRecord` preserves
the raw observations from which one such trace is derived and serializes
completeness once at `EvidenceRecord.completeness`.

### 2. Model request and response with envelopes

The request envelope keeps normalized fields plus the provider-native payload
at the declared fidelity. The response envelope preserves provider-reported
usage:

```json
{
  "interactionId": "01J5TZXQ8K7M2N4P6R8T0VXWY2",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY2",
  "evidenceSchemaVersion": "1.0.0",
  "captureProfile": { "name": "dev-basic", "version": "1.2.0" },
  "captureSurface": "client_side",
  "observationBoundary": "application_constructed",
  "startedAt": "2025-06-01T14:00:00.123Z",
  "finishedAt": "2025-06-01T14:00:05.411Z",
  "status": "completed",
  "spans": [
    {
      "spanId": "span-2-0001",
      "kind": "model",
      "name": "model:claude-sonnet-4",
      "parentSpanId": null,
      "startSeq": 1,
      "endSeq": 4,
      "startedAt": "2025-06-01T14:00:00.200Z",
      "finishedAt": "2025-06-01T14:00:05.300Z",
      "durationMs": 5100,
      "status": "completed"
    }
  ],
  "events": [
    { "eventId": "evt-2-0001", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY2", "spanId": null, "seq": 0, "kind": "interaction_start", "capturedAt": "2025-06-01T14:00:00.123Z", "evidenceStatus": "captured" },
    { "eventId": "evt-2-0002", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY2", "spanId": "span-2-0001", "seq": 1, "kind": "span_start", "capturedAt": "2025-06-01T14:00:00.200Z", "evidenceStatus": "captured" },
    {
      "eventId": "evt-2-0003",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY2",
      "spanId": "span-2-0001",
      "seq": 2,
      "kind": "model_request",
      "capturedAt": "2025-06-01T14:00:00.200Z",
      "evidenceStatus": "captured",
      "observationRole": "client_sent",
      "requestEnvelope": {
        "model": "claude-sonnet-4",
        "provider": "anthropic",
        "providerNativeFidelity": "structurally_faithful",
        "messages": [
          { "role": "system", "content": "You are a helpful software engineering assistant." },
          { "role": "user", "content": "Fix the failing TypeScript build in this repo." }
        ],
        "providerNative": { "stream": false, "temperature": 0.2, "max_tokens": 4096 }
      },
      "contextContributions": [
        {
          "artifactId": "art-2-0001",
          "locator": { "type": "whole" },
          "position": 0,
          "provenanceState": "recorded"
        }
      ]
    },
    {
      "eventId": "evt-2-0004",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY2",
      "spanId": "span-2-0001",
      "seq": 3,
      "kind": "model_response",
      "capturedAt": "2025-06-01T14:00:05.300Z",
      "evidenceStatus": "captured",
      "observationRole": "provider_reported",
      "responseEnvelope": {
        "finishReason": "end_turn",
        "providerNativeFidelity": "structurally_faithful",
        "providerNative": {
          "id": "msg_01J5TZXQ8K7M2N4P6R8T0VXWY2",
          "content": [ { "type": "text", "text": "I fixed the build. Run pnpm typecheck to verify." } ],
          "usage": {
            "input_tokens": 1842,
            "output_tokens": 57
          }
        }
      }
    },
    { "eventId": "evt-2-0005", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY2", "spanId": "span-2-0001", "seq": 4, "kind": "span_end", "capturedAt": "2025-06-01T14:00:05.300Z", "evidenceStatus": "captured" },
    { "eventId": "evt-2-0006", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY2", "spanId": null, "seq": 5, "kind": "interaction_end", "capturedAt": "2025-06-01T14:00:05.411Z", "evidenceStatus": "captured" }
  ]
}
```

The artifact contributed into the request (`contextContributions` on
`evt-2-0003`) is recorded beside the trace. Its retained content is the file's
raw bytes (`byte_faithful`), so the bytes are hashed directly with no
canonicalizer:

```json
{
  "artifactId": "art-2-0001",
  "kind": "file",
  "evidenceStatus": "captured",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY2",
  "evidenceSchemaVersion": "1.0.0",
  "contentFidelity": "byte_faithful",
  "contentType": "text/markdown",
  "contentHash": "sha256:2c4a1d3e5b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e",
  "payloadRef": {
    "excerpt": "project-instruction: fix the failing TypeScript build"
  },
  "provenance": { "source": "repository", "path": ".signalglass/project-instruction.md" }
}
```

The token counts in the response envelope (`input_tokens: 1842`,
`output_tokens: 57`) are provider-reported; the derived measurement and
interpretation records shown after example 9 reference this event.

### 3. Streaming responses

Each delivered chunk is a `model_response_chunk` event with a chunk index and
the provider-native delta preserved at the declared fidelity; final usage
arrives as a `model_usage` event:

```json
{
  "interactionId": "01J5TZXQ8K7M2N4P6R8T0VXWY3",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY3",
  "evidenceSchemaVersion": "1.0.0",
  "captureProfile": { "name": "dev-basic", "version": "1.2.0" },
  "captureSurface": "client_side",
  "observationBoundary": "application_constructed",
  "startedAt": "2025-06-01T14:00:00.123Z",
  "finishedAt": "2025-06-01T14:00:04.400Z",
  "status": "completed",
  "spans": [
    {
      "spanId": "span-3-0001",
      "kind": "model",
      "name": "model:claude-sonnet-4",
      "parentSpanId": null,
      "startSeq": 1,
      "endSeq": 7,
      "startedAt": "2025-06-01T14:00:00.200Z",
      "finishedAt": "2025-06-01T14:00:04.300Z",
      "durationMs": 4100,
      "status": "completed"
    }
  ],
  "events": [
    { "eventId": "evt-3-0001", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY3", "spanId": null, "seq": 0, "kind": "interaction_start", "capturedAt": "2025-06-01T14:00:00.123Z", "evidenceStatus": "captured" },
    { "eventId": "evt-3-0002", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY3", "spanId": "span-3-0001", "seq": 1, "kind": "span_start", "capturedAt": "2025-06-01T14:00:00.200Z", "evidenceStatus": "captured" },
    {
      "eventId": "evt-3-0003",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY3",
      "spanId": "span-3-0001",
      "seq": 2,
      "kind": "model_request",
      "capturedAt": "2025-06-01T14:00:00.200Z",
      "evidenceStatus": "captured",
      "observationRole": "client_sent",
      "requestEnvelope": {
        "model": "claude-sonnet-4",
        "provider": "anthropic",
        "providerNativeFidelity": "structurally_faithful",
        "messages": [ { "role": "user", "content": "Summarize the last 20 commits." } ],
        "providerNative": { "stream": true, "temperature": 0.2 }
      }
    },
    {
      "eventId": "evt-3-0004",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY3",
      "spanId": "span-3-0001",
      "seq": 3,
      "kind": "model_response_chunk",
      "capturedAt": "2025-06-01T14:00:04.010Z",
      "evidenceStatus": "captured",
      "observationRole": "returned",
      "responseEnvelope": {
        "chunkIndex": 0,
        "providerNativeFidelity": "structurally_faithful",
        "providerNative": {
          "type": "content_block_delta",
          "delta": { "type": "text_delta", "text": "The last 20 commits cover " }
        }
      }
    },
    {
      "eventId": "evt-3-0005",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY3",
      "spanId": "span-3-0001",
      "seq": 4,
      "kind": "model_response_chunk",
      "capturedAt": "2025-06-01T14:00:04.020Z",
      "evidenceStatus": "captured",
      "observationRole": "returned",
      "responseEnvelope": {
        "chunkIndex": 1,
        "providerNativeFidelity": "structurally_faithful",
        "providerNative": {
          "type": "content_block_delta",
          "delta": { "type": "text_delta", "text": "dependency bumps, the ingress rewrite, and " }
        }
      }
    },
    {
      "eventId": "evt-3-0006",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY3",
      "spanId": "span-3-0001",
      "seq": 5,
      "kind": "model_response_chunk",
      "capturedAt": "2025-06-01T14:00:04.030Z",
      "evidenceStatus": "captured",
      "observationRole": "returned",
      "responseEnvelope": {
        "chunkIndex": 2,
        "providerNativeFidelity": "structurally_faithful",
        "providerNative": {
          "type": "content_block_delta",
          "delta": { "type": "text_delta", "text": " doc updates." }
        }
      }
    },
    {
      "eventId": "evt-3-0007",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY3",
      "spanId": "span-3-0001",
      "seq": 6,
      "kind": "model_usage",
      "capturedAt": "2025-06-01T14:00:04.300Z",
      "evidenceStatus": "captured",
      "observationRole": "provider_reported",
      "usage": { "input_tokens": 1410, "output_tokens": 42 }
    },
    { "eventId": "evt-3-0008", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY3", "spanId": "span-3-0001", "seq": 7, "kind": "span_end", "capturedAt": "2025-06-01T14:00:04.300Z", "evidenceStatus": "captured" },
    { "eventId": "evt-3-0009", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY3", "spanId": null, "seq": 8, "kind": "interaction_end", "capturedAt": "2025-06-01T14:00:04.400Z", "evidenceStatus": "captured" }
  ]
}
```

### 4. Tool calls and results

Tool activity is a span; its request and result are events on that span:

```json
{
  "interactionId": "01J5TZXQ8K7M2N4P6R8T0VXWY4",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY4",
  "evidenceSchemaVersion": "1.0.0",
  "captureProfile": { "name": "dev-basic", "version": "1.2.0" },
  "captureSurface": "client_side",
  "observationBoundary": "application_constructed",
  "startedAt": "2025-06-01T14:00:00.123Z",
  "finishedAt": "2025-06-01T14:00:02.000Z",
  "status": "completed",
  "spans": [
    {
      "spanId": "span-4-0001",
      "kind": "tool",
      "name": "tool:bash",
      "parentSpanId": null,
      "startSeq": 1,
      "endSeq": 4,
      "startedAt": "2025-06-01T14:00:01.400Z",
      "finishedAt": "2025-06-01T14:00:01.900Z",
      "durationMs": 500,
      "status": "completed"
    }
  ],
  "events": [
    { "eventId": "evt-4-0001", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY4", "spanId": null, "seq": 0, "kind": "interaction_start", "capturedAt": "2025-06-01T14:00:00.123Z", "evidenceStatus": "captured" },
    { "eventId": "evt-4-0002", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY4", "spanId": "span-4-0001", "seq": 1, "kind": "span_start", "capturedAt": "2025-06-01T14:00:01.400Z", "evidenceStatus": "captured" },
    {
      "eventId": "evt-4-0003",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY4",
      "spanId": "span-4-0001",
      "seq": 2,
      "kind": "tool_call",
      "capturedAt": "2025-06-01T14:00:01.400Z",
      "evidenceStatus": "captured",
      "observationRole": "client_sent",
      "tool": {
        "name": "bash",
        "arguments": { "command": "pnpm typecheck" }
      }
    },
    {
      "eventId": "evt-4-0004",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY4",
      "spanId": "span-4-0001",
      "seq": 3,
      "kind": "tool_result",
      "capturedAt": "2025-06-01T14:00:01.900Z",
      "evidenceStatus": "captured",
      "observationRole": "returned",
      "toolResult": {
        "exitCode": 0,
        "stdout": "No type errors found.",
        "stderr": ""
      }
    },
    { "eventId": "evt-4-0005", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY4", "spanId": "span-4-0001", "seq": 4, "kind": "span_end", "capturedAt": "2025-06-01T14:00:01.900Z", "evidenceStatus": "captured" },
    { "eventId": "evt-4-0006", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY4", "spanId": null, "seq": 5, "kind": "interaction_end", "capturedAt": "2025-06-01T14:00:02.000Z", "evidenceStatus": "captured" }
  ]
}
```

### 5. MCP calls and results

MCP activity is a span, with the server and tool named:

```json
{
  "interactionId": "01J5TZXQ8K7M2N4P6R8T0VXWY5",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY5",
  "evidenceSchemaVersion": "1.0.0",
  "captureProfile": { "name": "dev-basic", "version": "1.2.0" },
  "captureSurface": "client_side",
  "observationBoundary": "application_constructed",
  "startedAt": "2025-06-01T14:00:00.123Z",
  "finishedAt": "2025-06-01T14:00:02.500Z",
  "status": "completed",
  "spans": [
    {
      "spanId": "span-5-0001",
      "kind": "mcp",
      "name": "mcp:site-intelligence:get_site_overview",
      "parentSpanId": null,
      "startSeq": 1,
      "endSeq": 4,
      "startedAt": "2025-06-01T14:00:02.100Z",
      "finishedAt": "2025-06-01T14:00:02.400Z",
      "durationMs": 300,
      "status": "completed"
    }
  ],
  "events": [
    { "eventId": "evt-5-0001", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY5", "spanId": null, "seq": 0, "kind": "interaction_start", "capturedAt": "2025-06-01T14:00:00.123Z", "evidenceStatus": "captured" },
    { "eventId": "evt-5-0002", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY5", "spanId": "span-5-0001", "seq": 1, "kind": "span_start", "capturedAt": "2025-06-01T14:00:02.100Z", "evidenceStatus": "captured" },
    {
      "eventId": "evt-5-0003",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY5",
      "spanId": "span-5-0001",
      "seq": 2,
      "kind": "mcp_request",
      "capturedAt": "2025-06-01T14:00:02.100Z",
      "evidenceStatus": "captured",
      "observationRole": "client_sent",
      "mcp": {
        "server": "site-intelligence",
        "tool": "get_site_overview",
        "arguments": {}
      }
    },
    {
      "eventId": "evt-5-0004",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY5",
      "spanId": "span-5-0001",
      "seq": 3,
      "kind": "mcp_result",
      "capturedAt": "2025-06-01T14:00:02.400Z",
      "evidenceStatus": "captured",
      "observationRole": "returned",
      "mcpResult": {
        "content": [ { "type": "text", "text": "386 indexed pages; 0 warnings." } ]
      }
    },
    { "eventId": "evt-5-0005", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY5", "spanId": "span-5-0001", "seq": 4, "kind": "span_end", "capturedAt": "2025-06-01T14:00:02.400Z", "evidenceStatus": "captured" },
    { "eventId": "evt-5-0006", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY5", "spanId": null, "seq": 5, "kind": "interaction_end", "capturedAt": "2025-06-01T14:00:02.500Z", "evidenceStatus": "captured" }
  ]
}
```

### 6. Retrieval with context artifacts and contributions

Retrieval activity is a span; the result event names the query, the artifacts
it produced carry provenance, and a `context_assembled` event records that a
retrieved fragment entered the model request's assembled context:

```json
{
  "interactionId": "01J5TZXQ8K7M2N4P6R8T0VXWY6",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY6",
  "evidenceSchemaVersion": "1.0.0",
  "captureProfile": { "name": "dev-basic", "version": "1.2.0" },
  "captureSurface": "client_side",
  "observationBoundary": "application_constructed",
  "startedAt": "2025-06-01T14:00:00.123Z",
  "finishedAt": "2025-06-01T14:00:03.300Z",
  "status": "completed",
  "spans": [
    {
      "spanId": "span-6-0001",
      "kind": "retrieval",
      "name": "retrieval:context-window-best-practices",
      "parentSpanId": null,
      "startSeq": 1,
      "endSeq": 4,
      "startedAt": "2025-06-01T14:00:03.000Z",
      "finishedAt": "2025-06-01T14:00:03.100Z",
      "durationMs": 100,
      "status": "completed"
    }
  ],
  "events": [
    { "eventId": "evt-6-0001", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY6", "spanId": null, "seq": 0, "kind": "interaction_start", "capturedAt": "2025-06-01T14:00:00.123Z", "evidenceStatus": "captured" },
    { "eventId": "evt-6-0002", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY6", "spanId": "span-6-0001", "seq": 1, "kind": "span_start", "capturedAt": "2025-06-01T14:00:03.000Z", "evidenceStatus": "captured" },
    {
      "eventId": "evt-6-0003",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY6",
      "spanId": "span-6-0001",
      "seq": 2,
      "kind": "retrieval_request",
      "capturedAt": "2025-06-01T14:00:03.000Z",
      "evidenceStatus": "captured",
      "observationRole": "client_sent",
      "retrieval": { "query": "context window best practices", "topK": 3 }
    },
    {
      "eventId": "evt-6-0004",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY6",
      "spanId": "span-6-0001",
      "seq": 3,
      "kind": "retrieval_result",
      "capturedAt": "2025-06-01T14:00:03.100Z",
      "evidenceStatus": "captured",
      "observationRole": "returned",
      "retrieval": { "query": "context window best practices", "resultCount": 3 }
    },
    { "eventId": "evt-6-0005", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY6", "spanId": "span-6-0001", "seq": 4, "kind": "span_end", "capturedAt": "2025-06-01T14:00:03.100Z", "evidenceStatus": "captured" },
    {
      "eventId": "evt-6-0006",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY6",
      "spanId": null,
      "seq": 5,
      "kind": "context_assembled",
      "capturedAt": "2025-06-01T14:00:03.200Z",
      "evidenceStatus": "captured",
      "observationRole": "application_constructed",
      "contextContributions": [
        {
          "artifactId": "art-6-0001",
          "locator": { "type": "fragment" },
          "position": 0,
          "provenanceState": "recorded"
        }
      ]
    },
    { "eventId": "evt-6-0007", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY6", "spanId": null, "seq": 6, "kind": "interaction_end", "capturedAt": "2025-06-01T14:00:03.300Z", "evidenceStatus": "captured" }
  ]
}
```

The retrieved fragment is a context artifact with provenance. Its retained
content is structurally faithful JSON, so the hash is computed by RFC 8785
(JCS) canonicalization followed by UTF-8 encoding; the canonicalizer is pinned
to a registry version:

```json
{
  "artifactId": "art-6-0001",
  "kind": "fragment",
  "evidenceStatus": "captured",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY6",
  "evidenceSchemaVersion": "1.0.0",
  "contentFidelity": "structurally_faithful",
  "contentType": "application/json",
  "contentCanonicalizer": { "name": "rfc8785-jcs", "version": "1.0.0" },
  "contentHash": "sha256:9f2c4a1d3e5b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
  "payloadRef": {
    "excerpt": "{\"guideline\": \"Keep the context window small\", \"source\": \"context-window-best-practices\"}"
  },
  "provenance": {
    "source": "retrieval",
    "query": "context window best practices",
    "uri": "https://example.com/docs/context-window"
  }
}
```

### Artifact hash selection

The hashing path is always selected from the artifact's own serialized fields
— `contentFidelity`, `contentType`, and `contentCanonicalizer` — never from an
enclosing event or envelope. Two more cases complete the matrix. A
structurally faithful non-JSON structured payload (here canonical XML) hashes
only with a declared versioned canonicalizer:

```json
{
  "artifactId": "art-6-0002",
  "kind": "tool_result",
  "evidenceStatus": "captured",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY6",
  "evidenceSchemaVersion": "1.0.0",
  "contentFidelity": "structurally_faithful",
  "contentType": "application/xml",
  "contentCanonicalizer": { "name": "xml-c14n-1.1", "version": "1.0.0" },
  "contentHash": "sha256:3d8e0f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e",
  "payloadRef": {
    "excerpt": "<rule id=\"r-1\">Keep the context window small</rule>"
  },
  "provenance": { "source": "tool", "name": "rules-loader" }
}
```

Captured retained content for which no supported deterministic canonicalizer
exists is declared explicitly — no `contentHash`, and an unavailable-hash
reason instead (the hash is never fabricated):

```json
{
  "artifactId": "art-2-0002",
  "kind": "document",
  "evidenceStatus": "captured",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY2",
  "evidenceSchemaVersion": "1.0.0",
  "contentFidelity": "structurally_faithful",
  "contentType": "text/html",
  "contentHashUnavailableReason": "unsupported_canonicalizer",
  "payloadRef": {
    "excerpt": "<html><body><h1>Release notes</h1></body></html>"
  },
  "provenance": { "source": "web", "uri": "https://example.com/release-notes" }
}
```

### 7. Context-provider (Graphify) activity

Context-provider results may be large; here the payload was truncated at capture
per the collection policy, with the truncation boundary recorded:

```json
{
  "interactionId": "01J5TZXQ8K7M2N4P6R8T0VXWY7",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY7",
  "evidenceSchemaVersion": "1.0.0",
  "captureProfile": { "name": "dev-basic", "version": "1.2.0" },
  "captureSurface": "client_side",
  "observationBoundary": "application_constructed",
  "startedAt": "2025-06-01T14:00:00.123Z",
  "finishedAt": "2025-06-01T14:00:03.600Z",
  "status": "completed",
  "spans": [
    {
      "spanId": "span-7-0001",
      "kind": "context_provider",
      "name": "context_provider:graphify",
      "parentSpanId": null,
      "startSeq": 1,
      "endSeq": 4,
      "startedAt": "2025-06-01T14:00:03.400Z",
      "finishedAt": "2025-06-01T14:00:03.500Z",
      "durationMs": 100,
      "status": "completed"
    }
  ],
  "events": [
    { "eventId": "evt-7-0001", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY7", "spanId": null, "seq": 0, "kind": "interaction_start", "capturedAt": "2025-06-01T14:00:00.123Z", "evidenceStatus": "captured" },
    { "eventId": "evt-7-0002", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY7", "spanId": "span-7-0001", "seq": 1, "kind": "span_start", "capturedAt": "2025-06-01T14:00:03.400Z", "evidenceStatus": "captured" },
    {
      "eventId": "evt-7-0003",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY7",
      "spanId": "span-7-0001",
      "seq": 2,
      "kind": "context_provider_request",
      "capturedAt": "2025-06-01T14:00:03.400Z",
      "evidenceStatus": "captured",
      "observationRole": "client_sent",
      "contextProvider": { "name": "graphify", "kind": "codebase_graph" }
    },
    {
      "eventId": "evt-7-0004",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY7",
      "spanId": "span-7-0001",
      "seq": 3,
      "kind": "context_provider_result",
      "capturedAt": "2025-06-01T14:00:03.500Z",
      "evidenceStatus": "truncated",
      "observationRole": "returned",
      "truncation": { "maxLength": 8000, "originalLength": 12403 },
      "contextProvider": {
        "name": "graphify",
        "kind": "codebase_graph"
      }
    },
    { "eventId": "evt-7-0005", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY7", "spanId": "span-7-0001", "seq": 4, "kind": "span_end", "capturedAt": "2025-06-01T14:00:03.500Z", "evidenceStatus": "captured" },
    { "eventId": "evt-7-0006", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY7", "spanId": null, "seq": 5, "kind": "interaction_end", "capturedAt": "2025-06-01T14:00:03.600Z", "evidenceStatus": "captured" }
  ]
}
```

### 8. Errors, cancellation, and retries

An error is scoped to the role under which it was observed; the error event
carries a top-level `observationRole` (the failure was observed on the return
path to the caller). The retry references the **original request event**
(`originalRequestEventId`); the associated error is referenced separately
(`errorEventId`):

```json
{
  "interactionId": "01J5TZXQ8K7M2N4P6R8T0VXWY8",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY8",
  "evidenceSchemaVersion": "1.0.0",
  "captureProfile": { "name": "dev-basic", "version": "1.2.0" },
  "captureSurface": "client_side",
  "observationBoundary": "application_constructed",
  "startedAt": "2025-06-01T14:00:00.123Z",
  "finishedAt": "2025-06-01T14:00:05.600Z",
  "status": "completed",
  "spans": [
    {
      "spanId": "span-8-0001",
      "kind": "model",
      "name": "model:claude-sonnet-4",
      "parentSpanId": null,
      "startSeq": 1,
      "endSeq": 6,
      "startedAt": "2025-06-01T14:00:00.200Z",
      "finishedAt": "2025-06-01T14:00:05.500Z",
      "durationMs": 5300,
      "status": "completed"
    }
  ],
  "events": [
    { "eventId": "evt-8-0001", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY8", "spanId": null, "seq": 0, "kind": "interaction_start", "capturedAt": "2025-06-01T14:00:00.123Z", "evidenceStatus": "captured" },
    { "eventId": "evt-8-0002", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY8", "spanId": "span-8-0001", "seq": 1, "kind": "span_start", "capturedAt": "2025-06-01T14:00:00.200Z", "evidenceStatus": "captured" },
    {
      "eventId": "evt-8-0003",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY8",
      "spanId": "span-8-0001",
      "seq": 2,
      "kind": "model_request",
      "capturedAt": "2025-06-01T14:00:00.200Z",
      "evidenceStatus": "captured",
      "observationRole": "application_constructed",
      "requestEnvelope": {
        "model": "claude-sonnet-4",
        "provider": "anthropic",
        "providerNativeFidelity": "structurally_faithful",
        "messages": [ { "role": "user", "content": "Fix the failing TypeScript build in this repo." } ],
        "providerNative": { "stream": false }
      }
    },
    {
      "eventId": "evt-8-0004",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY8",
      "spanId": "span-8-0001",
      "seq": 3,
      "kind": "error",
      "capturedAt": "2025-06-01T14:00:04.500Z",
      "evidenceStatus": "captured",
      "observationRole": "returned",
      "actor": "model",
      "lifecycleTarget": "none",
      "lifecycleEffect": "none",
      "error": {
        "type": "timeout",
        "message": "No upstream response was received within 30000ms; the failure was observed at the client boundary when the response did not arrive."
      }
    },
    {
      "eventId": "evt-8-0005",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY8",
      "spanId": "span-8-0001",
      "seq": 4,
      "kind": "retry",
      "capturedAt": "2025-06-01T14:00:05.100Z",
      "evidenceStatus": "captured",
      "observationRole": "application_constructed",
      "retry": {
        "originalRequestEventId": "evt-8-0003",
        "errorEventId": "evt-8-0004",
        "attempt": 2,
        "observedDelayMs": 500
      }
    },
    {
      "eventId": "evt-8-0006",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY8",
      "spanId": "span-8-0001",
      "seq": 5,
      "kind": "cancelled",
      "capturedAt": "2025-06-01T14:00:05.400Z",
      "evidenceStatus": "captured",
      "observationRole": "application_constructed",
      "lifecycleTarget": "none",
      "lifecycleEffect": "cancel",
      "cancellation": {
        "requestedBy": "user"
      }
    },
    { "eventId": "evt-8-0007", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY8", "spanId": "span-8-0001", "seq": 6, "kind": "span_end", "capturedAt": "2025-06-01T14:00:05.500Z", "evidenceStatus": "captured" },
    { "eventId": "evt-8-0008", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY8", "spanId": null, "seq": 7, "kind": "interaction_end", "capturedAt": "2025-06-01T14:00:05.600Z", "evidenceStatus": "captured" }
  ]
}
```

The timeout is recoverable (`lifecycleTarget: "none"`, `lifecycleEffect:
"none"`) and therefore does not fail the span or trace. The later cancellation
event records the user's request with `lifecycleTarget: "none"` and
`lifecycleEffect: "cancel"`; it terminates no lifecycle. The subsequent
`span_end` and `interaction_end` therefore remain coherent with the completed
span and trace.

### 9. Mixed evidence statuses with an explicit `missing` record

One payload is redacted (secrets policy), one is explicitly missing (capture
failure at the observation boundary), and one is unknown (provider internals:
usage was not reported by the provider, so the usage event is recorded with
`evidenceStatus: "unknown"` and `observationRole: "unobservable"` — the
capture surface could not observe provider-internal usage, and it would be
wrong to claim the provider reported it). The completeness record reflects all
three without inventing anything:

```json
{
  "interactionId": "01J5TZXQ8K7M2N4P6R8T0VXWY9",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY9",
  "evidenceSchemaVersion": "1.0.0",
  "captureProfile": { "name": "dev-standard", "version": "2.0.0" },
  "captureSurface": "ingress_proxy",
  "observationBoundary": "client_sent",
  "startedAt": "2025-06-02T09:30:00.000Z",
  "finishedAt": "2025-06-02T09:30:12.800Z",
  "status": "completed",
  "events": [
    { "eventId": "evt-9-0001", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY9", "spanId": null, "seq": 0, "kind": "interaction_start", "capturedAt": "2025-06-02T09:30:00.000Z", "evidenceStatus": "captured" },
    {
      "eventId": "evt-9-0002",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY9",
      "spanId": null,
      "seq": 1,
      "kind": "model_request",
      "capturedAt": "2025-06-02T09:30:00.100Z",
      "evidenceStatus": "redacted",
      "observationRole": "client_sent",
      "redaction": {
        "policy": "secrets-v1",
        "reasons": ["authorization-header"]
      }
    },
    {
      "eventId": "evt-9-0003",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY9",
      "spanId": null,
      "seq": 2,
      "kind": "model_response",
      "capturedAt": "2025-06-02T09:30:12.400Z",
      "evidenceStatus": "missing",
      "observationRole": "returned",
      "missing": {
        "reason": "capture_failed",
        "note": "Connection reset before the response body was read.",
        "reportedBy": { "captureSurface": "ingress_proxy", "observationBoundary": "returned" }
      }
    },
    {
      "eventId": "evt-9-0004",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY9",
      "spanId": null,
      "seq": 3,
      "kind": "model_usage",
      "capturedAt": "2025-06-02T09:30:12.600Z",
      "evidenceStatus": "unknown",
      "observationRole": "unobservable",
      "usage": {
        "evidenceStatus": "unknown",
        "reason": "not_reported_by_provider",
        "inputTokens": { "evidenceStatus": "unknown" },
        "outputTokens": { "evidenceStatus": "unknown" }
      }
    },
    { "eventId": "evt-9-0005", "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY9", "spanId": null, "seq": 4, "kind": "interaction_end", "capturedAt": "2025-06-02T09:30:12.800Z", "evidenceStatus": "captured" }
  ]
}
```

**What this example demonstrates about missing evidence.** What is known to be
missing: the model response body. How SignalGlass knows: the capture surface
recorded an explicit `missing` record at the moment the response could not be
read. Which observation boundary reported that state: the `ingress_proxy`
surface, on the `returned` (provider-to-client) side. What remains unavailable:
any claim about the response content — no response-based measurement can be
derived from this trace, and the content cannot be reconstructed. Note that the
`seq` values are contiguous: the missing response was disclosed explicitly,
never inferred from a sequence position (no later sequence number exists, so
there is no observable gap).

For an authoritative record containing this trace view, the deterministic
`EvidenceRecord.completeness` reports the status counts, explicit missing
observation, and boundary statement. A parser rejects any serialized
completeness value that disagrees with recomputation.

This example also distinguishes the ways a value can be absent, which `null`
must never collapse:

- `unknown` — cannot be determined whether the content existed (the provider
  did not report usage; `inputTokens`/`outputTokens` carry status `unknown`
  and no value);
- `missing` — known to exist but not captured (the response body);
- `not_applicable` — no such content applies (for example, a control event has
  no request body);
- a captured numeric zero — a real value (for example `output_tokens: 0` with
  `evidenceStatus: "captured"`), not an absence.

The derived records below are computed from the evidence in **example 2** (the
model request/response trace), which carries provider-reported usage.
Example 9's own usage is `unknown`, so it produces no usage-based measurements;
the derivations show how records cite their inputs and versions:

```json
{
  "measurementId": "msr-2-0001",
  "type": "token_count",
  "value": 1842,
  "unit": "tokens",
  "kind": "provider_reported",
  "algorithm": { "name": "provider-reported-usage", "version": "1.0.0" },
  "inputs": [{ "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY2", "eventId": "evt-2-0004" }],
  "configuration": { "tokenizerRegistry": "anthropic-2025-05" },
  "calculatedAt": "2025-06-01T14:00:05.400Z"
}
```

```json
{
  "measurementId": "msr-2-0002",
  "type": "cost",
  "value": 0.000926,
  "unit": "usd",
  "kind": "locally_calculated",
  "algorithm": { "name": "price-usage", "version": "1.3.0" },
  "inputs": [
    { "measurementId": "msr-2-0001" },
    { "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY2" }
  ],
  "configuration": { "pricingTable": "anthropic-2025-06", "tokenizerRegistry": "anthropic-2025-05" },
  "calculatedAt": "2025-06-01T14:00:05.500Z"
}
```

An interpretation cites the measurements and evidence it is based on, and its
confidence is explicitly a judgment:

```json
{
  "interpretationId": "int-2-0001",
  "title": "Repeated context block detected",
  "kind": "smell",
  "label": "repeated-context",
  "labelVersion": "1.0.0",
  "inputs": [
    { "measurementId": "msr-2-0001" },
    { "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY2", "eventId": "evt-2-0003" },
    { "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWY2", "artifactId": "art-2-0001" }
  ],
  "claim": "The project-instruction artifact (art-2-0001) was contributed into the model request context (evt-2-0003) in this interaction; the cited event, artifact, measurement, and trace support this judgment.",
  "confidence": "medium"
}
```
## Related documentation

- [Spec 013 — Evidence model (normative contract)](../specs/013-evidence-model.md)
- [Capture profiles and policy separation](capture-profiles.md)
- [Model versioning](model-versioning.md)
- [Architectural foundation](../docs/architectural-foundation.md) (v0.1)
- [Glossary](../docs/glossary.md)
