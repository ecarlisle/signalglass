import type { Trace, TraceEvent } from '@signalglass/core';

/**
 * Build a structured JSON report for a stored trace.
 *
 * The report preserves trace metadata and event summaries without
 * exposing sensitive data such as full raw payloads, API keys,
 * Authorization headers, secrets, or storageKey values.
 */
export function renderTraceJson(trace: Trace): string {
  const report = buildTraceReport(trace);
  return JSON.stringify(report, null, 2);
}

function buildTraceReport(trace: Trace) {
  const events = trace.events ?? [];

  const eventTypeBreakdown = buildEventTypeBreakdown(events);
  const contentPhaseBreakdown = buildContentPhaseBreakdown(events);
  const routingDecisions = collectStrings(events, 'routingDecision');
  const transformations = collectStrings(events, 'transformationSummary');
  const excerpts = collectExcerptEntries(events);
  const tokenMetrics = buildTokenMetrics(events);

  return {
    reportType: 'trace',
    generatedAt: new Date().toISOString(),
    trace: {
      id: trace.id,
      status: trace.status,
      provider: trace.provider ?? null,
      model: trace.model ?? null,
      agent: trace.agent ?? null,
      task: trace.task ?? null,
      mode: trace.mode,
      startedAt: trace.startedAt,
      endedAt: trace.endedAt ?? null,
      eventCount: events.length,
    },
    tokenMetrics,
    eventTypeBreakdown,
    contentPhaseBreakdown,
    routingDecisions: routingDecisions.length > 0 ? routingDecisions : undefined,
    transformations: transformations.length > 0 ? transformations : undefined,
    excerpts: excerpts.length > 0 ? excerpts : undefined,
    disclaimers: [
      'Token counts are approximate estimates.',
      'Full raw payloads are not included in this report.',
      'API keys, secrets, and authorization headers are never stored or reported.',
    ],
  };
}

function buildTokenMetrics(events: TraceEvent[]) {
  const totalInput = events
    .filter((e) => e.tokens != null && e.contentPhase != null && ['sent', 'requested', 'observed'].includes(e.contentPhase))
    .reduce((sum, e) => sum + (e.tokens ?? 0), 0);

  const totalOutput = events
    .filter((e) => e.tokens != null && e.contentPhase != null && ['generated', 'returned'].includes(e.contentPhase))
    .reduce((sum, e) => sum + (e.tokens ?? 0), 0);

  const inferenceTokens = events
    .filter((e) => e.type === 'inference')
    .reduce((sum, e) => sum + (e.tokens ?? 0), 0);

  return {
    totalInputTokens: totalInput > 0 ? totalInput : null,
    totalOutputTokens: totalOutput > 0 ? totalOutput : null,
    inferenceTokens: inferenceTokens > 0 ? inferenceTokens : null,
    approximate: true,
  };
}

function buildEventTypeBreakdown(events: TraceEvent[]) {
  const map = new Map<string, number>();
  for (const e of events) {
    map.set(e.type, (map.get(e.type) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

function buildContentPhaseBreakdown(events: TraceEvent[]) {
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

function collectStrings(events: TraceEvent[], field: 'routingDecision' | 'transformationSummary'): string[] {
  const result: string[] = [];
  for (const e of events) {
    const value = e[field];
    if (value) {
      result.push(value);
    }
  }
  return result;
}

interface ExcerptEntry {
  eventType: string;
  text: string;
}

function collectExcerptEntries(events: TraceEvent[]): ExcerptEntry[] {
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
