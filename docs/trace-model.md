# Signalglass trace model

Signalglass uses two related but distinct representations:

- **`AgentRun`** — the offline analysis model. A run is a sequence of turns, each containing context blocks.
- **`Trace`** — the live ingress model. A trace is a sequence of events that reconstructs everything that happened during a provider request/response cycle.

A trace can be converted into an `AgentRun` so the existing analyzer, smells, recommendations, and reports can be reused.

## Why two representations?

`AgentRun` is optimized for analysis: it answers "what context was sent and how was it spent?"

`Trace` is optimized for observability: it answers "what happened at each step of the exchange?"

Keeping both lets the offline analyzer stay simple while the live ingress captures rich timeline detail.

## Conceptual live-mode pipeline

```
Client / Agent Tool
  ↓
OpenAI-Compatible Ingress
  ↓
Ingress Adapter
  ↓
SignalGlass Trace / Timeline Events
  ↓
Provider Adapter
  ↓
Upstream Provider
  ↓
Response Normalizer
  ↓
Client-Compatible Response
```

The ingress receives a client request, converts it to internal trace events, forwards it to the upstream provider through the appropriate adapter, normalizes the response, and returns a client-compatible response. All along the way it emits timeline events.

## Trace

A `Trace` is the top-level container for a live session.

```ts
interface Trace {
  id: string;
  startedAt: string;
  providerId: string;
  model?: string;
  agent?: string;
  task?: string;
  status: "started" | "success" | "error";
  metadata: Record<string, unknown>;
  events: TraceEvent[];
}
```

## TraceEvent

A `TraceEvent` records one thing that happened during a trace.

```ts
interface TraceEvent {
  id: string;
  traceId: string;
  timestamp: string;
  kind: TraceEventKind;
  contentPhase?: ContentPhase;
  sourceType?: SourceType;
  tokens?: number;
  excerpt?: string;        // short redacted excerpt
  payloadRef?: string;     // reference to stored payload, if capture policy allows
  metadata: Record<string, unknown>;
}
```

## Event kinds

Examples of `TraceEventKind`:

- `request_received` — client request arrived at ingress.
- `request_normalized` — request translated to internal shape.
- `provider_selected` — provider config chosen.
- `provider_request_sent` — request sent upstream.
- `provider_response_chunk` — streaming chunk received.
- `provider_response_complete` — final response assembled.
- `response_normalized` — response translated back to client shape.
- `response_sent` — response returned to client.
- `transformation_applied` — a transformation was applied.
- `tool_call_observed` — a tool call was observed.
- `tool_result_observed` — a tool result was observed.
- `error` — an error occurred.

## Content phases

Signalglass preserves the distinction between what was said, sent, transformed, requested, observed, generated, and returned.

| Phase | Meaning |
|---|---|
| `said` | What a human or agent intended to communicate. |
| `sent` | What was actually placed on the wire. |
| `transformed` | What was modified by middleware, adapters, or optimization steps. |
| `requested` | What the agent explicitly asked the model for. |
| `observed` | What Signalglass saw pass through the ingress. |
| `generated` | What the model produced. |
| `returned` | What was ultimately delivered back to the agent. |

These phases are recorded on trace events and can also be attached to future `ContextBlock` fields.

## Converting a Trace to an AgentRun

The conversion process collapses a trace into the offline model:

1. Group events into turns by request/response cycles or explicit turn boundaries.
2. Map events to `ContextBlock` using `sourceType` and `contentPhase`.
3. Apply the existing token estimator.
4. Run the existing analyzer.

This means all existing smell detectors, recommendations, and reports work unchanged on live data.

## Future additions to ContextBlock

To better support live-mode phases, future versions may add optional fields to `ContextBlock`:

```ts
interface ContextBlock {
  // ... existing fields
  contentPhase?: ContentPhase;
  traceEventIds?: string[];
}
```

These are additive and do not break the offline analyzer.
