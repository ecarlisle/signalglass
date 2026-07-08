import type { Trace } from '@signalglass/core';
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
  const events = trace.events ?? [];
  const tokenMetrics = computeTokenMetrics(events);
  const excerpts = collectRedactedExcerpts(events);

  const routingDecisions = collectRoutingDecisions(events);

  return {
    id: safe(trace.id),
    status: safe(trace.status),
    provider: safe(trace.provider ?? 'unknown'),
    model: safe(trace.model ?? 'unknown'),
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

  lines.push(`Signalglass traces (${traces.length})`);
  lines.push('');
  lines.push(formatRow(['ID', 'Status', 'Provider', 'Model', 'Events', 'Started'], widths));
  lines.push(formatRow(widths.map((w) => '─'.repeat(w)), widths));

  for (const trace of traces) {
    const id = truncate(safe(trace.id), widths[0]);
    const status = safe(trace.status);
    const provider = truncate(safe(trace.provider ?? '—'), widths[2]);
    const model = truncate(safe(trace.model ?? '—'), widths[3]);
    const events = String(trace.events?.length ?? 0);
    const started = truncate(safe(trace.startedAt), widths[5]);

    lines.push(formatRow([id, status, provider, model, events, started], widths));
  }

  lines.push('');
  lines.push('Use `signalglass traces --storage <path> show <trace-id>` for full details.');

  return lines.join('\n');
}

export function renderTraceListJson(traces: Trace[]): string {
  const summaries = traces.map((trace) => {
    const events = trace.events ?? [];
    const tokenMetrics = computeTokenMetrics(events);

    return {
      id: safe(trace.id),
      status: safe(trace.status),
      provider: trace.provider ? safe(trace.provider) : null,
      model: trace.model ? safe(trace.model) : null,
      agent: trace.agent ? safe(trace.agent) : null,
      task: trace.task ? safe(trace.task) : null,
      mode: safe(trace.mode),
      startedAt: safe(trace.startedAt),
      endedAt: trace.endedAt ? safe(trace.endedAt) : null,
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

function safe(text: string): string {
  return sanitizeReportString(text);
}
