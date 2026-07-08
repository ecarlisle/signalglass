import type { TraceEvent } from '@signalglass/core';
import { sanitizeReportString } from './sanitize.js';

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
  const promptTokens = sumInferenceMetadata(inferenceEvents, 'promptTokens');
  const completionTokens = sumInferenceMetadata(inferenceEvents, 'completionTokens');
  const totalTokens = sumInferenceMetadata(inferenceEvents, 'totalTokens');

  const inputEvents = events.filter((e) => {
    return (
      e.type !== 'inference' &&
      e.tokens != null &&
      e.contentPhase != null &&
      ['said', 'sent', 'requested', 'observed'].includes(e.contentPhase)
    );
  });
  const outputEvents = events.filter((e) => {
    return (
      e.type !== 'inference' &&
      e.tokens != null &&
      e.contentPhase != null &&
      ['generated', 'returned'].includes(e.contentPhase)
    );
  });

  const phaseInput = inputEvents.reduce((sum, e) => sum + (e.tokens ?? 0), 0);
  const phaseOutput = outputEvents.reduce((sum, e) => sum + (e.tokens ?? 0), 0);
  const inferenceTokens =
    totalTokens ??
    (inferenceEvents.length > 0
      ? inferenceEvents.reduce((sum, e) => sum + (e.tokens ?? 0), 0)
      : undefined);

  return {
    totalInputTokens:
      promptTokens ?? (inputEvents.length > 0 ? phaseInput : null),
    totalOutputTokens:
      completionTokens ?? (outputEvents.length > 0 ? phaseOutput : null),
    inferenceTokens: inferenceTokens ?? null,
    approximate: true,
  };
}

function sumInferenceMetadata(events: TraceEvent[], key: string): number | undefined {
  let total = 0;
  let found = false;

  for (const event of events) {
    const value = event.metadata?.[key];
    if (typeof value !== 'number') continue;
    total += value;
    found = true;
  }

  return found ? total : undefined;
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
      decisions.push(sanitizeReportString(e.routingDecision));
    }
  }
  return decisions;
}

export function collectTransformationSummaries(events: TraceEvent[]): string[] {
  const summaries: string[] = [];
  for (const e of events) {
    if (e.transformationSummary) {
      summaries.push(sanitizeReportString(e.transformationSummary));
    }
  }
  return summaries;
}

export function collectRedactedExcerpts(events: TraceEvent[]): ExcerptEntry[] {
  const excerpts: ExcerptEntry[] = [];
  for (const e of events) {
    if (e.payloadRef?.excerpt && e.payloadRef.redacted) {
      excerpts.push({
        eventType: sanitizeReportString(e.type),
        text: sanitizeReportString(e.payloadRef.excerpt),
      });
    }
  }
  return excerpts;
}
