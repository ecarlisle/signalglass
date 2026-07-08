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

export function renderTraceTerminal(trace: Trace): string {
  const redactOptions = redactionOptions(trace);
  const lines: string[] = [];
  const events = trace.events ?? [];
  const tokenMetrics = computeTokenMetrics(events);

  lines.push('SignalGlass trace report');
  lines.push('');
  lines.push(`  Trace ID:    ${safe(trace.id, redactOptions)}`);
  lines.push(`  Status:      ${safe(trace.status, redactOptions)}`);
  lines.push(`  Provider:    ${safe(trace.provider ?? 'unknown', redactOptions)}`);
  lines.push(`  Model:       ${safe(trace.model ?? 'unknown', redactOptions)}`);
  lines.push(`  Mode:        ${safe(trace.mode, redactOptions)}`);
  lines.push(`  Started:     ${safe(trace.startedAt, redactOptions)}`);
  if (trace.endedAt) {
    lines.push(`  Ended:       ${safe(trace.endedAt, redactOptions)}`);
  }
  if (trace.agent) {
    lines.push(`  Agent:       ${safe(trace.agent, redactOptions)}`);
  }
  if (trace.task) {
    lines.push(`  Task:        ${safe(trace.task, redactOptions)}`);
  }

  lines.push(`  Events:      ${events.length}`);

  if (tokenMetrics.totalInputTokens != null) {
    lines.push(`  Input tokens:  ${tokenMetrics.totalInputTokens} (approximate)`);
  }
  if (tokenMetrics.totalOutputTokens != null) {
    lines.push(`  Output tokens: ${tokenMetrics.totalOutputTokens} (approximate)`);
  }
  if (tokenMetrics.inferenceTokens != null) {
    lines.push(`  Inference tokens: ${tokenMetrics.inferenceTokens} (approximate)`);
  }

  // Event type breakdown
  const typeGroups = groupEventsByType(events);
  if (typeGroups.length > 0) {
    lines.push('');
    lines.push('Events by type');
    for (const g of typeGroups) {
      lines.push(`  ${pad(g.type, 24)} ${g.count}`);
    }
  }

  // Content phase breakdown
  const phaseGroups = groupEventsByContentPhase(events);
  if (phaseGroups.length > 0) {
    lines.push('');
    lines.push('Events by content phase');
    for (const g of phaseGroups) {
      lines.push(`  ${pad(g.phase, 24)} ${g.count}`);
    }
  }

  // Routing decisions
  const routingDecisions = collectRoutingDecisions(events, redactOptions);
  if (routingDecisions.length > 0) {
    lines.push('');
    lines.push('Routing decisions');
    for (const rd of routingDecisions) {
      lines.push(`  ${rd}`);
    }
  }

  // Transformation summaries
  const transformations = collectTransformationSummaries(events, redactOptions);
  if (transformations.length > 0) {
    lines.push('');
    lines.push('Transformation summaries');
    for (const t of transformations) {
      lines.push(`  ${t}`);
    }
  }

  // Redacted excerpts (only when present)
  const excerpts = collectRedactedExcerpts(events, redactOptions);
  if (excerpts.length > 0) {
    lines.push('');
    lines.push('Content excerpts (redacted)');
    for (const excerpt of excerpts) {
      lines.push(`  [${excerpt.eventType}] ${excerpt.text}`);
    }
  }

  lines.push('');
  lines.push('Token counts are approximate estimates.');
  lines.push('Full raw payloads are not included in this report.');
  lines.push('API keys, secrets, and authorization headers are never stored or reported.');

  return lines.join('\n');
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function safe(text: string, options?: RedactSensitiveTextOptions): string {
  return sanitizeReportString(text, options);
}

function redactionOptions(trace: Trace): RedactSensitiveTextOptions | undefined {
  return trace.capturePolicy?.redaction?.secretPatterns
    ? { secretPatterns: trace.capturePolicy.redaction.secretPatterns }
    : undefined;
}
