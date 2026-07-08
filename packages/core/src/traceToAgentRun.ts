import type { AgentRun, ContextBlock, Turn } from './types.js';
import type { Trace, TraceEvent } from './traces.js';
import type { SourceType } from './sourceTypes.js';
import { isKnownSourceType } from './sourceTypes.js';

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function generateRunName(trace: Trace): string {
  return trace.agent ?? trace.task ?? `trace-${trace.id}`;
}

function deriveSourceType(event: TraceEvent): SourceType | null {
  const { type, contentPhase, sourceType, actor } = event;

  if (type === 'message') {
    if (contentPhase === 'said') return 'user_message';
    if (contentPhase === 'generated') return 'assistant_message';
    if (contentPhase === 'sent' && actor?.role === 'model') return 'assistant_message';
    return null;
  }

  if (type === 'instruction') {
    if (actor?.role === 'system') return 'system_instruction';
    return 'project_instruction';
  }

  if (type === 'tool_call' && contentPhase === 'requested') {
    return 'tool_call';
  }

  if (type === 'tool_result' && contentPhase === 'observed') {
    return 'tool_output';
  }

  if (type === 'context' && contentPhase === 'sent') {
    if (sourceType && isKnownSourceType(sourceType)) return sourceType;
    return 'unknown';
  }

  if (type === 'provider_request' || type === 'provider_response' || type === 'egress_response') {
    return 'unknown';
  }

  return null;
}

function deriveContent(event: TraceEvent): string {
  if (event.payloadRef?.excerpt != null) {
    return event.payloadRef.excerpt;
  }
  return '';
}

function eventToContextBlock(event: TraceEvent, turnId: string): ContextBlock | null {
  const sourceType = deriveSourceType(event);
  if (sourceType === null) return null;

  const content = deriveContent(event);

  const metadata: Record<string, unknown> = {
    traceEventId: event.id,
    traceEventType: event.type,
  };

  if (event.contentPhase != null) {
    metadata.contentPhase = event.contentPhase;
  }

  if (event.actor != null) {
    metadata.actor = event.actor;
  }

  if (event.routingDecision != null) {
    metadata.routingDecision = event.routingDecision;
  }

  if (event.transformationSummary != null) {
    metadata.transformationSummary = event.transformationSummary;
  }

  if (event.payloadRef != null) {
    metadata.payloadRef = {
      id: event.payloadRef.id,
      redacted: event.payloadRef.redacted,
      excerpt: event.payloadRef.excerpt,
      size: event.payloadRef.size,
    };
  }

  return {
    id: generateId(),
    turnId,
    sourceType,
    content,
    name: event.actor?.name,
    estimatedTokens: event.tokens,
    metadata,
  };
}

function groupEventsIntoTurns(events: TraceEvent[]): TraceEvent[][] {
  const turns: TraceEvent[][] = [];
  let currentTurn: TraceEvent[] = [];

  for (const event of events) {
    if (event.type === 'provider_request') {
      if (currentTurn.length > 0) {
        turns.push(currentTurn);
      }
      currentTurn = [event];
    } else {
      currentTurn.push(event);
    }
  }

  if (currentTurn.length > 0) {
    turns.push(currentTurn);
  }

  return turns;
}

function deriveTurnOutputTokens(events: TraceEvent[]): number | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'inference' && typeof event.tokens === 'number') {
      return event.tokens;
    }
  }

  const generatedTokens = events
    .filter(
      (e) =>
        e.type === 'message' &&
        e.contentPhase === 'generated' &&
        typeof e.tokens === 'number',
    )
    .reduce((sum, e) => sum + (e.tokens ?? 0), 0);

  return generatedTokens > 0 ? generatedTokens : undefined;
}

/**
 * Convert a live-captured Trace into an AgentRun for offline-style analysis.
 *
 * The converter groups trace events into turns, maps events to ContextBlocks,
 * and preserves trace metadata. It never includes full raw payloads, API keys,
 * authorization headers, or secrets. Redacted excerpts and metadata are preserved.
 */
export function traceToAgentRun(trace: Trace): AgentRun {
  const turnGroups = groupEventsIntoTurns(trace.events);

  const turns: Turn[] = turnGroups.map((events, index) => {
    const turnId = generateId();
    const contextBlocks = events
      .map((event) => eventToContextBlock(event, turnId))
      .filter((block): block is ContextBlock => block !== null);

    return {
      id: turnId,
      turnNumber: index + 1,
      contextBlocks,
      outputTokens: deriveTurnOutputTokens(events),
      metadata: {
        traceEventIds: events.map((e) => e.id),
      },
    };
  });

  const totalOutputTokens = turns.reduce(
    (sum, turn) => sum + (turn.outputTokens ?? 0),
    0,
  );

  return {
    id: trace.id,
    name: generateRunName(trace),
    model: trace.model,
    provider: trace.provider,
    agent: trace.agent,
    task: trace.task,
    turns,
    outputTokens: totalOutputTokens > 0 ? totalOutputTokens : undefined,
    metadata: {
      traceId: trace.id,
      startedAt: trace.startedAt,
      endedAt: trace.endedAt,
      capturePolicy: trace.capturePolicy,
      mode: trace.mode,
      ...(trace.metadata ?? {}),
    },
  };
}
