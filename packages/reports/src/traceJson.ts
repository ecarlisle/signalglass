import type { RedactSensitiveTextOptions, Trace } from '@signalglass/core';
import {
  computeTokenMetrics,
  groupEventsByType,
  groupEventsByContentPhase,
  collectRoutingDecisions,
  collectTransformationSummaries,
  collectRedactedExcerpts,
} from './traceMetrics.js';
import { sanitizeReportString } from './sanitize.js';

export function renderTraceJson(trace: Trace): string {
  const report = buildTraceReport(trace);
  return JSON.stringify(report, null, 2);
}

function buildTraceReport(trace: Trace) {
  const events = trace.events ?? [];
  const redactOptions = redactionOptions(trace);

  const tokenMetrics = computeTokenMetrics(events);
  const eventTypeBreakdown = groupEventsByType(events);
  const contentPhaseBreakdown = groupEventsByContentPhase(events);
  const routingDecisions = collectRoutingDecisions(events, redactOptions);
  const transformations = collectTransformationSummaries(events, redactOptions);
  const excerpts = collectRedactedExcerpts(events, redactOptions);

  return {
    reportType: 'trace',
    generatedAt: new Date().toISOString(),
    trace: {
      id: safe(trace.id, redactOptions),
      status: safe(trace.status, redactOptions),
      provider: trace.provider ? safe(trace.provider, redactOptions) : null,
      model: trace.model ? safe(trace.model, redactOptions) : null,
      agent: trace.agent ? safe(trace.agent, redactOptions) : null,
      task: trace.task ? safe(trace.task, redactOptions) : null,
      mode: safe(trace.mode, redactOptions),
      startedAt: safe(trace.startedAt, redactOptions),
      endedAt: trace.endedAt ? safe(trace.endedAt, redactOptions) : null,
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

function safe(text: string, options?: RedactSensitiveTextOptions): string {
  return sanitizeReportString(text, options);
}

function redactionOptions(trace: Trace): RedactSensitiveTextOptions | undefined {
  return trace.capturePolicy?.redaction?.secretPatterns
    ? { secretPatterns: trace.capturePolicy.redaction.secretPatterns }
    : undefined;
}
