import type { RedactSensitiveTextOptions, Trace } from '@signalglass/core';
import {
  computeTokenMetrics,
  collectRoutingDecisions,
  collectRedactedExcerpts,
} from './traceMetrics.js';
import { sanitizeReportString } from './sanitize.js';

export interface ListSummaryRow {
  id: string;
  status: string;
  provider: string;
  model: string;
  events: number;
  routingDecisions: string[];
  excerptCount: number;
  inputTokens: string;
  outputTokens: string;
}

export function buildListSummary(trace: Trace): ListSummaryRow {
  const redactOptions = redactionOptions(trace);
  const events = trace.events ?? [];
  const tokenMetrics = computeTokenMetrics(events);
  const excerpts = collectRedactedExcerpts(events, redactOptions);

  const routingDecisions = collectRoutingDecisions(events, redactOptions);

  return {
    id: safe(trace.id, redactOptions),
    status: safe(trace.status, redactOptions),
    provider: safe(trace.provider ?? 'unknown', redactOptions),
    model: safe(trace.model ?? 'unknown', redactOptions),
    events: events.length,
    routingDecisions,
    excerptCount: excerpts.length,
    inputTokens: tokenMetrics.totalInputTokens != null ? String(tokenMetrics.totalInputTokens) : '—',
    outputTokens: tokenMetrics.totalOutputTokens != null ? String(tokenMetrics.totalOutputTokens) : '—',
  };
}

export function renderTraceListSummary(traces: Trace[]): string {
  if (traces.length === 0) {
    return 'No traces found.';
  }

  const lines: string[] = [];
  const widths = [20, 8, 16, 20, 6, 24];

  lines.push(`SignalGlass traces (${traces.length})`);
  lines.push('');
  lines.push(formatRow(['ID', 'Status', 'Provider', 'Model', 'Events', 'Started'], widths));
  lines.push(formatRow(widths.map((w) => '─'.repeat(w)), widths));

  for (const trace of traces) {
    const redactOptions = redactionOptions(trace);
    const id = truncate(safe(trace.id, redactOptions), widths[0]);
    const status = safe(trace.status, redactOptions);
    const provider = truncate(safe(trace.provider ?? '—', redactOptions), widths[2]);
    const model = truncate(safe(trace.model ?? '—', redactOptions), widths[3]);
    const events = String(trace.events?.length ?? 0);
    const started = truncate(safe(trace.startedAt, redactOptions), widths[5]);

    lines.push(formatRow([id, status, provider, model, events, started], widths));
  }

  lines.push('');
  lines.push('Use `signalglass traces --storage <path> show <trace-id>` for full details.');

  return lines.join('\n');
}

export function renderTraceListJson(traces: Trace[]): string {
  const summaries = traces.map((trace) => {
    const redactOptions = redactionOptions(trace);
    const events = trace.events ?? [];
    const tokenMetrics = computeTokenMetrics(events);

    return {
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
      tokenMetrics,
    };
  });

  return JSON.stringify(summaries, null, 2);
}

function formatRow(columns: string[], widths: number[]): string {
  return columns.map((c, i) => `  ${c.padEnd(widths[i] ?? 0)}`).join(' ');
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '\u2026';
}

function safe(text: string, options?: RedactSensitiveTextOptions): string {
  return sanitizeReportString(text, options);
}

function redactionOptions(trace: Trace): RedactSensitiveTextOptions | undefined {
  return trace.capturePolicy?.redaction?.secretPatterns
    ? { secretPatterns: trace.capturePolicy.redaction.secretPatterns }
    : undefined;
}
