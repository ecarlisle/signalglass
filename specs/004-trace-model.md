# Spec 004: Trace and timeline model

## Status

Implemented

## Purpose

Define provider-agnostic live-mode domain types that capture the full lifecycle of a provider exchange and can be converted into an `AgentRun`.

## Scope

- `Trace`, `TraceEvent`, and related types.
- Content phases.
- Storage modes and capture policies.
- Helper functions for creating events and policies.

## Non-goals

- Ingress server implementation (see Spec 006).
- SQLite storage implementation (see Spec 007).
- Provider-specific protocol parsing (see Spec 005).

## Required files or modules

- `packages/core/src/traces.ts`
- `packages/core/src/traces.test.ts`
- `packages/core/src/traceToAgentRun.ts`
- `packages/core/src/traceToAgentRun.test.ts`

## Required types or contracts

```ts
type ContentPhase =
  | "said"
  | "sent"
  | "transformed"
  | "requested"
  | "observed"
  | "generated"
  | "returned";

type TraceEventType =
  | "message"
  | "instruction"
  | "context"
  | "transformation"
  | "inference"
  | "tool_call"
  | "tool_result"
  | "provider_request"
  | "provider_response"
  | "provider_error"
  | "egress_response";

type StorageMode = "minimal" | "standard" | "debug";

interface TraceActor { ... }
interface PayloadReference { ... }
interface RedactionPolicy { ... }
interface CapturePolicy { ... }
interface SavingsOpportunity { ... }
interface TraceEvent { ... }
interface Trace { ... }
```

## Required behavior

- `createTraceEvent(partial)` generates `id` and `timestamp` when omitted.
- `createDefaultCapturePolicy('standard')` enables metadata, metrics, timeline events, routing decisions, transformation summaries, and short redacted excerpts.
- `createDefaultCapturePolicy('standard')` disables full raw payloads, secrets, API keys, and full tool results.
- `createDefaultCapturePolicy('debug')` may enable full raw payloads and full tool results.
- `isRawPayloadCaptureEnabled(policy)` returns true only in debug mode with full payloads enabled.
- A `Trace` can be converted into an `AgentRun` by grouping events into turns and mapping them to `ContextBlock` objects.
- `traceToAgentRun(trace)` preserves trace id, model, provider, agent, and task in the resulting `AgentRun`.
- `traceToAgentRun(trace)` maps trace events to `ContextBlock` source types without introducing provider-specific shapes.
- `traceToAgentRun(trace)` skips content-bearing events that have no safe excerpt (no `payloadRef.excerpt`); provider/control events may remain metadata-only.
- `traceToAgentRun(trace)` does not flatten arbitrary `trace.metadata` into `AgentRun.metadata`; trace metadata is nested under `traceMetadata` with sensitive-looking keys removed.
- `traceToAgentRun(trace)` never includes API keys, authorization headers, secrets, or full raw payloads in the `AgentRun`.

### Turn boundary convention

The converter groups one logical inference cycle into a single `AgentRun` turn:
input context/user messages, provider request/response, generated assistant output,
and egress response. A new turn starts after an `egress_response` event. Traces
without `egress_response` events are treated as a single turn. Multi-turn traces
and streaming responses may require boundary refinement in the future.

## Acceptance criteria

- [x] All trace types are exported from `@signalglass/core`.
- [x] Standard policy denies full raw payload storage.
- [x] Debug policy allows full raw payload storage.
- [x] Trace events serialize to JSON without loss.
- [x] A `Trace` can be converted into an `AgentRun`.

## Tests

- `packages/core/src/traces.test.ts`
- `packages/core/src/traceToAgentRun.test.ts`

## References

- `docs/trace-model.md`
- `docs/privacy.md`
- `docs/decisions/0002-two-modes.md`
