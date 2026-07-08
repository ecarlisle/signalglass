# Spec 004: Trace and timeline model

## Status

Implemented (types), Accepted (behavior)

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

## Acceptance criteria

- [ ] All trace types are exported from `@signalglass/core`.
- [ ] Standard policy denies full raw payload storage.
- [ ] Debug policy allows full raw payload storage.
- [ ] Trace events serialize to JSON without loss.

## Tests

- `packages/core/src/traces.test.ts`

## References

- `docs/trace-model.md`
- `docs/privacy.md`
- `docs/decisions/0002-two-modes.md`
