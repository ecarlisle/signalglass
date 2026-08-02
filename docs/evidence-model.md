# SignalGlass evidence model

The evidence model is the canonical, provider-neutral contract for recording AI
interactions as **evidence**, deriving deterministic **measurements** from that
evidence, and keeping **interpretations** clearly separate. The normative
contract is [Spec 013](../specs/013-evidence-model.md); this document is the
human-facing reference with serialized examples.

Design in one paragraph: an **interaction** is the logical AI exchange being
observed, and its authoritative serialized record is a **trace** (one
interaction, one trace). Traces contain **spans** (structure: hierarchy, timing,
status) and **events** (content: payloads, transitions, sequence position).
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
| Interaction / Trace | Yes | Top-level container; identity, lifecycle, conditions, completeness |
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

- `interactionId` is the trace id. Spans and events carry `traceId` with the
  same value. One interaction, one trace, one identity.
- Every event carries `seq`: a non-negative integer, strictly increasing and
  **contiguous** within the trace (first event `seq` 0; each subsequent event
  exactly one greater). `seq` is assigned by the capture surface at observation
  time and is **the only deterministic ordering key.**
- Timestamps (`capturedAt`, ISO 8601 UTC) may tie and are never used for
  ordering. `durationMs` comes from a monotonic clock.
- Spans declare `startSeq`/`endSeq`; nested spans reference `parentSpanId`
  (hierarchy only). Spans with overlapping `seq` ranges are concurrent.
- Duplicates are detected by `eventId`; because `seq` is contiguous, any `seq`
  gap is proof of a dropped event and is reported in the completeness record.
  SignalGlass never invents missing events.

## Evidence status

Every payload carries exactly one `evidenceStatus`:

| Status | Meaning |
|---|---|
| `captured` | Exact content present. |
| `redacted` | Content existed; removed/masked per a recorded policy. Original hash may remain. |
| `truncated` | Content existed; only a declared prefix/excerpt stored. |
| `missing` | Capture failed or didn't happen; no claim about content. |
| `unknown` | Cannot determine whether the content existed (e.g., provider internals). |
| `not_applicable` | No such content applies (e.g., a control event with no request body). |

`inferred` is **not** an evidence status: it appears only on derived records
(measurements, interpretations) and must be labeled there.

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

- A **context artifact** is a referenceable unit of context: `artifactId`,
  `kind` (message, file, document, fragment, tool result, MCP response,
  retrieval result, context-provider result, repository content, manual),
  `payloadRef`, `contentHash`, and `provenance` (source path/URI/query/range).
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
  (for example, a JSON object), with field order and values equivalent to what
  was observed. Byte-for-byte equivalence is not claimed.
- `byte_faithful` — the raw bytes or text, with `nativeEncoding` and
  `nativeContentType` recorded (and `nativeContentHash` recommended).

An envelope never implies byte fidelity unless `byte_faithful` is recorded.

## Projections

- **Run** — a derived, session-level grouping of interactions. The legacy
  `AgentRun` is a projection over evidence, not a canonical container.
- **Legacy trace view** — the v0.x `Trace`/`TraceEvent` shape becomes a
  compatibility projection over evidence (see Spec 013 §11).
- **Redacted exports** — projections under an export policy; they never
  overwrite authoritative evidence.

## Serialized examples

The following examples are normative illustrations of Spec 013. All examples
refer to the same interaction: *"Fix the failing TypeScript build in this repo."*

### 1. Minimal single-span interaction

A complete trace with one model span and lifecycle events:

```json
{
  "interactionId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
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
      "spanId": "span-01J5TZXQ8K7M2N4P6R8T0VWXY1",
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
    {
      "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ1",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
      "spanId": null,
      "seq": 0,
      "kind": "interaction_start",
      "capturedAt": "2025-06-01T14:00:00.123Z",
      "evidenceStatus": "captured"
    },
    {
      "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ2",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
      "spanId": "span-01J5TZXQ8K7M2N4P6R8T0VWXY1",
      "seq": 1,
      "kind": "span_start",
      "capturedAt": "2025-06-01T14:00:00.200Z",
      "evidenceStatus": "captured"
    },
    {
      "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ3",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
      "spanId": "span-01J5TZXQ8K7M2N4P6R8T0VWXY1",
      "seq": 2,
      "kind": "span_end",
      "capturedAt": "2025-06-01T14:00:05.300Z",
      "evidenceStatus": "captured"
    },
    {
      "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ4",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
      "spanId": null,
      "seq": 3,
      "kind": "interaction_end",
      "capturedAt": "2025-06-01T14:00:05.411Z",
      "evidenceStatus": "captured"
    }
  ],
  "completeness": {
    "eventsByStatus": { "captured": 4 },
    "seqGaps": [],
    "duplicatesDetected": [],
    "boundaryStatement": "Client-side capture; provider internals not observable."
  }
}
```

### 2. Model request and response with envelopes

The request envelope keeps normalized fields plus the provider-native payload
at the declared fidelity. The response envelope preserves provider-reported
usage:

```json
{
  "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ5",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
  "spanId": "span-01J5TZXQ8K7M2N4P6R8T0VWXY1",
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
      "artifactId": "art-01J5TZXQ8K7M2N4P6R8T0VWXY2",
      "locator": { "type": "whole" },
      "position": 0,
      "provenanceState": "recorded"
    }
  ]
}
```

```json
{
  "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ6",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
  "spanId": "span-01J5TZXQ8K7M2N4P6R8T0VWXY1",
  "seq": 3,
  "kind": "model_response",
  "capturedAt": "2025-06-01T14:00:05.300Z",
  "evidenceStatus": "captured",
  "observationRole": "provider_reported",
  "responseEnvelope": {
    "finishReason": "end_turn",
    "providerNativeFidelity": "structurally_faithful",
    "providerNative": {
      "id": "msg_01J5TZXQ8K7M2N4P6R8T0VXWY",
      "content": [ { "type": "text", "text": "I fixed the build. Run pnpm typecheck to verify." } ],
      "usage": {
        "input_tokens": 1842,
        "output_tokens": 57
      }
    }
  }
}
```

### 3. Streaming responses

Each delivered chunk is a `model_response_chunk` event with a chunk index and
the provider-native delta preserved at the declared fidelity:

```json
{
  "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ7",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
  "spanId": "span-01J5TZXQ8K7M2N4P6R8T0VWXY1",
  "seq": 4,
  "kind": "model_response_chunk",
  "capturedAt": "2025-06-01T14:00:04.010Z",
  "evidenceStatus": "captured",
  "observationRole": "returned",
  "responseEnvelope": {
    "chunkIndex": 0,
    "providerNative": {
      "type": "content_block_delta",
      "delta": { "type": "text_delta", "text": "I fixed " }
    }
  }
}
```

### 4. Tool calls and results

Tool activity is a span; its request and result are events on that span:

```json
{
  "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ8",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
  "spanId": "span-01J5TZXQ8K7M2N4P6R8T0VWXY2",
  "seq": 5,
  "kind": "tool_call",
  "capturedAt": "2025-06-01T14:00:01.400Z",
  "evidenceStatus": "captured",
  "observationRole": "client_sent",
  "tool": {
    "name": "bash",
    "arguments": { "command": "pnpm typecheck" }
  }
}
```

```json
{
  "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ9",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
  "spanId": "span-01J5TZXQ8K7M2N4P6R8T0VWXY2",
  "seq": 6,
  "kind": "tool_result",
  "capturedAt": "2025-06-01T14:00:01.900Z",
  "evidenceStatus": "captured",
  "observationRole": "returned",
  "toolResult": {
    "exitCode": 0,
    "stdout": "No type errors found.",
    "stderr": ""
  }
}
```

### 5. MCP calls and results

MCP activity is a span, with the server and tool named:

```json
{
  "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ10",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
  "spanId": "span-01J5TZXQ8K7M2N4P6R8T0VWXY3",
  "seq": 7,
  "kind": "mcp_request",
  "capturedAt": "2025-06-01T14:00:02.100Z",
  "evidenceStatus": "captured",
  "observationRole": "client_sent",
  "mcp": {
    "server": "site-intelligence",
    "tool": "get_site_overview",
    "arguments": {}
  }
}
```

```json
{
  "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ11",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
  "spanId": "span-01J5TZXQ8K7M2N4P6R8T0VWXY3",
  "seq": 8,
  "kind": "mcp_result",
  "capturedAt": "2025-06-01T14:00:02.400Z",
  "evidenceStatus": "captured",
  "observationRole": "returned",
  "mcpResult": {
    "content": [ { "type": "text", "text": "386 indexed pages; 0 warnings." } ]
  }
}
```

### 6. Retrieval with context artifacts and contributions

Retrieval activity is a span; the result event names the query, and the
artifacts it produced carry provenance:

```json
{
  "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ12",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
  "spanId": "span-01J5TZXQ8K7M2N4P6R8T0VWXY4",
  "seq": 9,
  "kind": "retrieval_result",
  "capturedAt": "2025-06-01T14:00:03.000Z",
  "evidenceStatus": "captured",
  "observationRole": "returned",
  "retrieval": { "query": "context window best practices", "resultCount": 3 }
}
```

```json
{
  "artifactId": "art-01J5TZXQ8K7M2N4P6R8T0VWXY2",
  "kind": "fragment",
  "evidenceStatus": "captured",
  "payloadRef": {
    "excerpt": "Keep the context window small...",
    "contentHash": "sha256:9f2c4a1d3e5b7c8d9e0f1a2b3c4d5e6f"
  },
  "provenance": {
    "source": "retrieval",
    "query": "context window best practices",
    "uri": "https://example.com/docs/context-window"
  }
}
```

The contribution that added this artifact into the model request appeared in
example 2 (`contextContributions`): it references the artifact by id, uses a
`whole` locator, records its position, and states `recorded` provenance.

### 7. Context-provider (Graphify) activity

Context-provider results may be large; here the payload was truncated at capture
per the collection policy, with the truncation boundary recorded:

```json
{
  "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ13",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
  "spanId": "span-01J5TZXQ8K7M2N4P6R8T0VWXY5",
  "seq": 10,
  "kind": "context_provider_result",
  "capturedAt": "2025-06-01T14:00:03.500Z",
  "evidenceStatus": "truncated",
  "observationRole": "returned",
  "truncation": { "maxLength": 8000, "originalLength": 12403 },
  "contextProvider": {
    "name": "graphify",
    "kind": "codebase_graph",
    "artifactIds": ["art-01J5TZXQ8K7M2N4P6R8T0VWXY3"]
  }
}
```

### 8. Errors, cancellation, and retries

An error is scoped to the boundary where it was observed; a retry references the
original request:

```json
{
  "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ14",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
  "spanId": "span-01J5TZXQ8K7M2N4P6R8T0VWXY6",
  "seq": 11,
  "kind": "error",
  "capturedAt": "2025-06-01T14:00:04.500Z",
  "evidenceStatus": "captured",
  "actor": "mcp",
  "error": {
    "type": "timeout",
    "message": "mcp server timed out after 30000ms",
    "observedAt": "client_side"
  }
}
```

```json
{
  "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ15",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
  "spanId": null,
  "seq": 12,
  "kind": "cancelled",
  "capturedAt": "2025-06-01T14:00:04.900Z",
  "evidenceStatus": "captured",
  "cancellation": {
    "requestedBy": "user",
    "observedAt": "client_side"
  }
}
```

```json
{
  "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ16",
  "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ",
  "spanId": "span-01J5TZXQ8K7M2N4P6R8T0VWXY1",
  "seq": 13,
  "kind": "retry",
  "capturedAt": "2025-06-01T14:00:05.100Z",
  "evidenceStatus": "captured",
  "retry": {
    "originalRequestEventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ14",
    "attempt": 2
  }
}
```

### 9. Mixed evidence status, measurements, and an interpretation

A fragment where one payload is redacted (secrets policy), one is missing
(capture failure), and one is unknown (provider internals). The completeness
record reflects this without inventing anything:

```json
{
  "interactionId": "01J5TZXQ8K7M2N4P6R8T0VXWZZ",
  "evidenceSchemaVersion": "1.0.0",
  "captureProfile": { "name": "dev-standard", "version": "2.0.0" },
  "captureSurface": "ingress_proxy",
  "observationBoundary": "client_sent",
  "startedAt": "2025-06-02T09:30:00.000Z",
  "finishedAt": "2025-06-02T09:30:12.800Z",
  "status": "completed",
  "events": [
    {
      "eventId": "evt-9-0001",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWZZ",
      "spanId": null,
      "seq": 0,
      "kind": "interaction_start",
      "capturedAt": "2025-06-02T09:30:00.000Z",
      "evidenceStatus": "captured"
    },
    {
      "eventId": "evt-9-0002",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWZZ",
      "spanId": "span-9-0001",
      "seq": 1,
      "kind": "model_request",
      "capturedAt": "2025-06-02T09:30:00.100Z",
      "evidenceStatus": "redacted",
      "redaction": { "policy": "secrets-v1", "reasons": ["authorization-header"], "originalHash": "sha256:ab12cd34ef56ab12cd34ef56ab12cd34" },
      "observationRole": "client_sent"
    },
    {
      "eventId": "evt-9-0003",
      "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWZZ",
      "spanId": "span-9-0001",
      "seq": 2,
      "kind": "model_usage",
      "capturedAt": "2025-06-02T09:30:12.600Z",
      "evidenceStatus": "unknown",
      "observationRole": "provider_reported",
      "usage": { "input_tokens": null, "output_tokens": null, "reason": "not_reported_by_provider" }
    }
  ],
  "completeness": {
    "eventsByStatus": { "captured": 1, "redacted": 1, "unknown": 1 },
    "seqGaps": [ { "afterSeq": 2, "expectedSeq": 3, "note": "capture surface failed before interaction_end" } ],
    "duplicatesDetected": [],
    "boundaryStatement": "Ingress proxy capture; provider internals and redacted payloads not observable."
  }
}
```

Measurements derive deterministically from the evidence above and cite their
inputs and versions:

```json
{
  "measurementId": "msr-01J5TZXQ8K7M2N4P6R8T0VXWZ1",
  "type": "token_count",
  "value": 1842,
  "unit": "tokens",
  "kind": "provider_reported",
  "algorithm": { "name": "provider-reported-usage", "version": "1.0.0" },
  "inputs": [{ "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ", "eventId": "evt-01J5TZXQ8K7M2N4P6R8T0VXWZ6" }],
  "configuration": { "tokenizerRegistry": "anthropic-2025-05" },
  "calculatedAt": "2025-06-01T14:00:05.400Z"
}
```

```json
{
  "measurementId": "msr-01J5TZXQ8K7M2N4P6R8T0VXWZ2",
  "type": "cost",
  "value": 0.000926,
  "unit": "usd",
  "kind": "locally_calculated",
  "algorithm": { "name": "price-usage", "version": "1.3.0" },
  "inputs": [
    { "measurementId": "msr-01J5TZXQ8K7M2N4P6R8T0VXWZ1" },
    { "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ" }
  ],
  "configuration": { "pricingTable": "anthropic-2025-06", "tokenizerRegistry": "anthropic-2025-05" },
  "calculatedAt": "2025-06-01T14:00:05.500Z"
}
```

An interpretation cites the measurements and evidence it is based on, and its
confidence is explicitly a judgment:

```json
{
  "interpretationId": "int-01J5TZXQ8K7M2N4P6R8T0VXWZ1",
  "title": "Repeated context block detected",
  "kind": "smell",
  "label": "repeated-context",
  "labelVersion": "1.0.0",
  "inputs": [
    { "measurementId": "msr-01J5TZXQ8K7M2N4P6R8T0VXWZ1" },
    { "traceId": "01J5TZXQ8K7M2N4P6R8T0VXWYZ" }
  ],
  "claim": "The same project-instruction artifact appeared in 6 of 9 model requests in this interaction.",
  "confidence": "medium"
}
```

## Related documentation

- [Spec 013 — Evidence model (normative contract)](../specs/013-evidence-model.md)
- [Capture profiles and policy separation](capture-profiles.md)
- [Model versioning](model-versioning.md)
- [Architectural foundation](../docs/architectural-foundation.md) (v0.1)
- [Glossary](../docs/glossary.md)
