import type { TraceEvent, PayloadReference } from '@signalglass/core';

export interface TokenMetrics {
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  inferenceTokens: number | null;
  approximate: boolean;
}

export interface EventTypeGroup {
  type: string;
  count: number;
}

export interface ContentPhaseGroup {
  phase: string;
  count: number;
}

export interface ExcerptEntry {
  eventType: string;
  text: string;
}

export interface EventFieldCollector {
  routingDecisions: string[];
  transformations: string[];
}

export function computeTokenMetrics(events: TraceEvent[]): TokenMetrics {
  const inferenceEvents = events.filter((e) => e.type === 'inference');
  const inputEvents = events.filter(
    (e) => e.type !== 'inference' && e.tokens != null && e.contentPhase != null && ['sent', 'requested', 'observed'].includes(e.contentPhase),
  );
  const outputEvents = events.filter(
    (e) => e.type !== 'inference' && e.tokens != null && e.contentPhase != null && ['generated', 'returned'].includes(e.contentPhase),
  );

  const totalInput = inputEvents.reduce((sum, e) => sum + (e.tokens ?? 0), 0);
  const totalOutput = outputEvents.reduce((sum, e) => sum + (e.tokens ?? 0), 0);
  const inferenceTokens = inferenceEvents.reduce((sum, e) => sum + (e.tokens ?? 0), 0);

  return {
    totalInputTokens: inputEvents.length > 0 ? totalInput : null,
    totalOutputTokens: outputEvents.length > 0 ? totalOutput : null,
    inferenceTokens: inferenceEvents.length > 0 ? inferenceTokens : null,
    approximate: true,
  };
}

export function groupEventsByType(events: TraceEvent[]): EventTypeGroup[] {
  const map = new Map<string, number>();
  for (const e of events) {
    map.set(e.type, (map.get(e.type) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

export function groupEventsByContentPhase(events: TraceEvent[]): ContentPhaseGroup[] {
  const map = new Map<string, number>();
  for (const e of events) {
    if (e.contentPhase) {
      map.set(e.contentPhase, (map.get(e.contentPhase) ?? 0) + 1);
    }
  }
  return Array.from(map.entries())
    .map(([phase, count]) => ({ phase, count }))
    .sort((a, b) => b.count - a.count);
}

export function collectRoutingDecisions(events: TraceEvent[]): string[] {
  const decisions: string[] = [];
  for (const e of events) {
    if (e.routingDecision) {
      decisions.push(e.routingDecision);
    }
  }
  return decisions;
}

export function collectTransformationSummaries(events: TraceEvent[]): string[] {
  const summaries: string[] = [];
  for (const e of events) {
    if (e.transformationSummary) {
      summaries.push(e.transformationSummary);
    }
  }
  return summaries;
}

export function collectRedactedExcerpts(events: TraceEvent[]): ExcerptEntry[] {
  const excerpts: ExcerptEntry[] = [];
  for (const e of events) {
    if (e.payloadRef?.excerpt && e.payloadRef.redacted) {
      excerpts.push({
        eventType: e.type,
        text: e.payloadRef.excerpt,
      });
    }
  }
  return excerpts;
}
