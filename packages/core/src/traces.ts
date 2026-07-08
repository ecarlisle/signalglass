import type { SourceType } from './sourceTypes.js';

/**
 * Describes the role of content at a specific point in an agent/model exchange.
 */
export type ContentPhase =
  | 'said'
  | 'sent'
  | 'transformed'
  | 'requested'
  | 'observed'
  | 'generated'
  | 'returned';

/**
 * Classifies a trace event by what kind of thing happened.
 */
export type TraceEventType =
  | 'message'
  | 'instruction'
  | 'context'
  | 'transformation'
  | 'inference'
  | 'tool_call'
  | 'tool_result'
  | 'provider_request'
  | 'provider_response'
  | 'provider_error'
  | 'egress_response';

/**
 * Storage mode controls the default capture policy.
 *
 * - `minimal` — metadata and metrics only.
 * - `standard` — metadata, metrics, timeline, routing, transformation summaries, and short redacted excerpts.
 * - `debug` — everything in standard plus optional full raw payloads.
 */
export type StorageMode = 'minimal' | 'standard' | 'debug';

/**
 * Identifies who or what produced a trace event.
 */
export interface TraceActor {
  id?: string;
  role: 'agent' | 'model' | 'tool' | 'system' | 'user' | 'provider' | 'ingress';
  name?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Reference to a stored payload, which may be full or redacted.
 */
export interface PayloadReference {
  id: string;
  storageKey?: string;
  contentType?: string;
  size?: number;
  /**
   * True when only a redacted excerpt is stored.
   */
  redacted: boolean;
  /**
   * Short excerpt available even when the full payload is not stored.
   */
  excerpt?: string;
}

/**
 * Rules for redacting sensitive content before storage.
 */
export interface RedactionPolicy {
  maxExcerptLength: number;
  /**
   * Regex strings matching secrets to redact.
   */
  secretPatterns?: string[];
  /**
   * Header names to strip before storage.
   */
  stripHeaders?: string[];
}

/**
 * Policy controlling what a live ingress capture stores.
 *
 * Defaults follow Standard Mode:
 * - Store trace metadata.
 * - Store timeline event metadata.
 * - Store token metrics.
 * - Store routing decisions.
 * - Store transformation summaries.
 * - Store short redacted excerpts.
 * - Do not store full raw payloads.
 * - Do not store secrets.
 * - Do not store API keys.
 * - Do not store full tool results by default.
 */
export interface CapturePolicy {
  mode: StorageMode;
  storeTraceMetadata: boolean;
  storeTimelineEventMetadata: boolean;
  storeTokenMetrics: boolean;
  storeRoutingDecisions: boolean;
  storeTransformationSummaries: boolean;
  storeShortRedactedExcerpts: boolean;
  storeFullRawPayloads: boolean;
  storeSecrets: boolean;
  storeApiKeys: boolean;
  storeFullToolResults: boolean;
  redaction: RedactionPolicy;
  /**
   * Number of days to retain captured data. Undefined means no automatic expiry.
   */
  retentionDays?: number;
}

/**
 * A potentially correctable pattern with an estimated token savings.
 */
export interface SavingsOpportunity {
  estimatedTokensSaveable: number;
  confidence: 'low' | 'medium' | 'high';
  description: string;
  /**
   * Tokens already saved, if any.
   */
  realizedTokensSaved?: number;
}

/**
 * A single event within a trace.
 */
export interface TraceEvent {
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

/**
 * A live-captured provider exchange.
 *
 * A trace can be converted into an `AgentRun` so the existing offline analyzer
 * can be reused.
 */
export interface Trace {
  id: string;
  /**
   * Optional link to the `AgentRun` produced from this trace.
   */
  runId?: string;
  startedAt: string;
  endedAt?: string;
  provider?: string;
  model?: string;
  agent?: string;
  task?: string;
  mode: StorageMode;
  capturePolicy: CapturePolicy;
  status: 'started' | 'success' | 'error';
  events: TraceEvent[];
  metadata?: Record<string, unknown>;
}

/**
 * Create a default capture policy for the given storage mode.
 */
export function createDefaultCapturePolicy(mode: StorageMode = 'standard'): CapturePolicy {
  const redaction: RedactionPolicy = {
    maxExcerptLength: 240,
    secretPatterns: [],
    stripHeaders: ['authorization', 'x-api-key'],
  };

  switch (mode) {
    case 'minimal':
      return {
        mode,
        storeTraceMetadata: true,
        storeTimelineEventMetadata: true,
        storeTokenMetrics: true,
        storeRoutingDecisions: false,
        storeTransformationSummaries: false,
        storeShortRedactedExcerpts: false,
        storeFullRawPayloads: false,
        storeSecrets: false,
        storeApiKeys: false,
        storeFullToolResults: false,
        redaction,
      };
    case 'debug':
      return {
        mode,
        storeTraceMetadata: true,
        storeTimelineEventMetadata: true,
        storeTokenMetrics: true,
        storeRoutingDecisions: true,
        storeTransformationSummaries: true,
        storeShortRedactedExcerpts: true,
        storeFullRawPayloads: true,
        storeSecrets: false,
        storeApiKeys: false,
        storeFullToolResults: true,
        redaction,
      };
    case 'standard':
    default:
      return {
        mode,
        storeTraceMetadata: true,
        storeTimelineEventMetadata: true,
        storeTokenMetrics: true,
        storeRoutingDecisions: true,
        storeTransformationSummaries: true,
        storeShortRedactedExcerpts: true,
        storeFullRawPayloads: false,
        storeSecrets: false,
        storeApiKeys: false,
        storeFullToolResults: false,
        redaction,
      };
  }
}

/**
 * Whether full raw payload capture is enabled for a policy.
 *
 * Full raw payloads are only allowed in debug mode and only when explicitly
 * enabled in the policy.
 */
export function isRawPayloadCaptureEnabled(policy: CapturePolicy): boolean {
  return policy.mode === 'debug' && policy.storeFullRawPayloads === true;
}

/**
 * Create a trace event, generating an id and timestamp if not provided.
 */
export function createTraceEvent(
  partial: Omit<TraceEvent, 'id' | 'timestamp'> & {
    id?: string;
    timestamp?: string;
  },
): TraceEvent {
  return {
    id: partial.id ?? generateId(),
    timestamp: partial.timestamp ?? new Date().toISOString(),
    ...partial,
  };
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
