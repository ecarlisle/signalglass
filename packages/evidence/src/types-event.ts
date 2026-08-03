/**
 * Canonical event record (Spec 014 §2.2.3; Spec 013 §3.1). Discriminated on
 * `kind` with a closed vocabulary. Lifecycle control events carry no payload
 * and no `observationRole`; payload-bearing events carry their kind-specific
 * payload fields plus `observationRole`.
 */
import type {
  ErrorActor,
  EvidenceStatus,
  EventKind,
  LifecycleEffect,
  LifecycleTarget,
  ObservationRole,
} from './vocabulary.js';
import type { ContextContribution } from './types-base.js';
import type { RequestEnvelope, ResponseEnvelope } from './types-envelope.js';
import type { EventId, SpanId, TraceId } from './types-base.js';
import type { UsageRecord } from './types-base.js';

export type ToolCall = { name: string; arguments: unknown };
export type ToolResult = {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  [k: string]: unknown;
};
export type McpRequest = { server: string; tool: string; arguments?: unknown };
export type McpResult = { content?: unknown; [k: string]: unknown };
export type RetrievalRequest = { query: string; topK?: number; [k: string]: unknown };
export type RetrievalResult = {
  query?: string;
  resultCount?: number;
  [k: string]: unknown;
};
export type ContextProvider = { name: string; kind: string };

/** Retry payload: references the original request event (Spec 013 §3.3). */
export type RetryRecord = {
  originalRequestEventId: EventId;
  errorEventId?: EventId;
  attempt: number;
  observedDelayMs?: number;
};

/** Error payload: actor, lifecycle targeting, and observed error. */
export type ErrorPayload = {
  type: string;
  message?: string;
  [k: string]: unknown;
};

/** Common fields on every canonical event. */
export type EventCommon = {
  eventId: EventId;
  traceId: TraceId;
  spanId: SpanId | null;
  seq: number;
  kind: EventKind;
  capturedAt: string;
  evidenceStatus: EvidenceStatus;
  /** Present on payload-bearing events; absent on lifecycle control events. */
  observationRole?: ObservationRole;
};

export type EventRecord = EventCommon &
  (
    | { kind: 'interaction_start' }
    | { kind: 'interaction_end' }
    | { kind: 'span_start' }
    | { kind: 'span_end' }
    | {
        kind: 'model_request';
        requestEnvelope: RequestEnvelope;
        contextContributions?: readonly ContextContribution[];
      }
    | { kind: 'model_response'; responseEnvelope: ResponseEnvelope }
    | { kind: 'model_response_chunk'; responseEnvelope: ResponseEnvelope }
    | { kind: 'model_usage'; usage: UsageRecord }
    | { kind: 'tool_call'; tool: ToolCall }
    | { kind: 'tool_result'; toolResult: ToolResult }
    | { kind: 'mcp_request'; mcp: McpRequest }
    | { kind: 'mcp_result'; mcpResult: McpResult }
    | { kind: 'retrieval_request'; retrieval: RetrievalRequest }
    | { kind: 'retrieval_result'; retrievalResult: RetrievalResult }
    | { kind: 'context_provider_request'; contextProvider: ContextProvider }
    | { kind: 'context_provider_result'; contextProvider: ContextProvider }
    | { kind: 'context_assembled'; contextContributions: readonly ContextContribution[] }
    | {
        kind: 'error';
        actor: ErrorActor;
        lifecycleTarget: LifecycleTarget;
        lifecycleEffect: LifecycleEffect;
        error: ErrorPayload;
      }
    | {
        kind: 'cancelled';
        lifecycleTarget: LifecycleTarget;
        lifecycleEffect: 'cancel';
        cancellation: { requestedBy: string };
      }
    | { kind: 'retry'; retry: RetryRecord }
  );
