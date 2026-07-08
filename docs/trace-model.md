# SignalGlass trace model

SignalGlass uses two related but distinct representations:

- **`AgentRun`** — the offline analysis model. A run is a sequence of turns, each containing context blocks.
- **`Trace`** — the live ingress model. A trace is a sequence of events that reconstructs what happened during a provider request/response cycle.

A trace can be converted into an `AgentRun` so the existing analyzer, smells, recommendations, and reports can be reused.

## Why two representations?

`AgentRun` is optimized for analysis: it answers “what context was sent and how were tokens spent?”

`Trace` is optimized for observability: it answers “what happened at each step of the exchange?”

Keeping both lets the offline analyzer stay simple while live ingress captures timeline detail.

## Conceptual live-mode pipeline

```text
Client / Agent Tool
  ↓
OpenAI-Compatible Ingress
  ↓
Provider adapter normalization
  ↓
SignalGlass Trace / TraceEvent objects
  ↓
Upstream provider
  ↓
Response normalization
  ↓
Client-compatible response
```

## Trace

A `Trace` is the top-level container for a live provider exchange.

```ts
interface Trace {
  id: string;
  runId?: string;
  startedAt: string;
  endedAt?: string;
  provider?: string;
  model?: string;
  agent?: string;
  task?: string;
  mode: "minimal" | "standard" | "debug";
  capturePolicy: CapturePolicy;
  status: "started" | "success" | "error";
  events: TraceEvent[];
  metadata?: Record<string, unknown>;
}
```

The current ingress emits one trace per `/v1/chat/completions` request when the request reaches provider forwarding. Storage is opt-in through the CLI `--storage <path>` flag.

## TraceEvent

A `TraceEvent` records one thing observed during a trace.

```ts
interface TraceEvent {
  id: string;
  traceId: string;
  parentEventId?: string;
  timestamp: string;
  type: TraceEventType;
  contentPhase?: ContentPhase;
  sourceType?: SourceType;
  actor?: TraceActor;
  tokens?: number;
  model?: string;
  provider?: string;
  routingDecision?: string;
  transformationSummary?: string;
  payloadRef?: PayloadReference;
  metadata?: Record<string, unknown>;
}
```

`TraceEvent.type` is the implemented event classifier. Older docs may refer to `kind`; use `type` in code and specs.

## Event types

Implemented event types are:

- `message`
- `instruction`
- `context`
- `transformation`
- `inference`
- `tool_call`
- `tool_result`
- `provider_request`
- `provider_response`
- `provider_error`
- `egress_response`

The OpenAI-compatible adapter currently emits request messages/instructions/context, provider request/response events, generated assistant messages, inference usage, egress responses, and provider error events for upstream failures.

## Content phases

SignalGlass preserves the distinction between what was said, sent, transformed, requested, observed, generated, and returned.

| Phase | Meaning |
|---|---|
| `said` | What a human or agent intended to communicate. |
| `sent` | What was actually placed on the wire. |
| `transformed` | What was modified by middleware, adapters, or optimization steps. |
| `requested` | What the agent explicitly asked the model/provider for. |
| `observed` | What SignalGlass saw pass through the ingress or provider boundary. |
| `generated` | What the model produced. |
| `returned` | What was ultimately delivered back to the agent. |

## Payload references

Payloads are represented with structured references:

```ts
interface PayloadReference {
  id: string;
  storageKey?: string;
  contentType?: string;
  size?: number;
  redacted: boolean;
  excerpt?: string;
}
```

Standard mode stores only sanitized, redacted, bounded excerpts. Full raw payload capture is debug-only and opt-in, and storage still strips/redacts credential-like fields before persistence.

## Token usage

Trace events may carry approximate `tokens`. Provider-reported OpenAI usage is stored on `inference` event metadata as:

- `promptTokens`
- `completionTokens`
- `totalTokens`

Reports and `traceToAgentRun` treat prompt/input and completion/output separately. `totalTokens` may be reported as inference usage but is not treated as output tokens.

## Converting a Trace to an AgentRun

The conversion process collapses a trace into the offline model:

1. Group events into request/response turns. The current convention starts a new turn after `egress_response`.
2. Map events to `ContextBlock` using `type`, `sourceType`, and `contentPhase`.
3. Include only safe excerpts for content-bearing events.
4. Preserve trace metadata under `AgentRun.metadata.traceMetadata` after removing sensitive-looking keys.
5. Run the existing offline analyzer.

This means existing smell detectors, recommendations, and reports can operate on live data without making OpenAI-compatible shapes the internal model.

## Future work

- Streaming response event refinement.
- Richer provider adapters beyond OpenAI-compatible endpoints.
- Dashboard Trace View, Payload View, and Story View.
- More precise tokenizers.
