import type { Trace } from '@signalglass/core';
import {
  computeTokenMetrics,
  groupEventsByType,
  groupEventsByContentPhase,
  collectRoutingDecisions,
  collectTransformationSummaries,
  collectRedactedExcerpts,
} from './traceMetrics.js';

export function renderTraceJson(trace: Trace): string {
  const report = buildTraceReport(trace);
  return JSON.stringify(report, null, 2);
}

function buildTraceReport(trace: Trace) {
  const events = trace.events ?? [];

  const tokenMetrics = computeTokenMetrics(events);
  const eventTypeBreakdown = groupEventsByType(events);
  const contentPhaseBreakdown = groupEventsByContentPhase(events);
  const routingDecisions = collectRoutingDecisions(events);
  const transformations = collectTransformationSummaries(events);
  const excerpts = collectRedactedExcerpts(events);

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
