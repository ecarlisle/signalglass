import type { Trace } from '@signalglass/core';

/**
 * Render a compact summary of multiple traces suitable for terminal output.
 *
 * The summary shows basic trace metadata without event payloads to keep
 * the output concise and privacy-safe.
 */
export function renderTraceListSummary(traces: Trace[]): string {
  if (traces.length === 0) {
    return 'No traces found.';
  }

  const lines: string[] = [];

  lines.push(`Signalglass traces (${traces.length})`);
  lines.push('');

  // Header
  lines.push(formatRow(['ID', 'Status', 'Provider', 'Model', 'Events', 'Started']));
  lines.push(formatRow(['', '', '', '', '', ''].map((_, i) => i === 0 ? '──' : '──')));

  for (const trace of traces) {
    const id = truncate(trace.id, 20);
    const status = trace.status;
    const provider = truncate(trace.provider ?? '—', 16);
    const model = truncate(trace.model ?? '—', 20);
    const events = String(trace.events?.length ?? 0);
    const started = truncate(trace.startedAt, 24);

    lines.push(formatRow([id, status, provider, model, events, started]));
  }

  lines.push('');
  lines.push('Use `signalglass traces --storage <path> show <trace-id>` for full details.');

  return lines.join('\n');
}

/**
 * Render a JSON array of trace summaries.
 *
 * Each entry contains basic trace metadata without event payloads.
 * Sensitive fields such as secrets, API keys, and Authorization headers
 * are never included.
 */
export function renderTraceListJson(traces: Trace[]): string {
  const summaries = traces.map((trace) => {
    const events = trace.events ?? [];
    const totalInput = events
      .filter((e) => e.tokens != null && e.contentPhase != null && ['sent', 'requested', 'observed'].includes(e.contentPhase))
      .reduce((sum, e) => sum + (e.tokens ?? 0), 0);
    const totalOutput = events
      .filter((e) => e.tokens != null && e.contentPhase != null && ['generated', 'returned'].includes(e.contentPhase))
      .reduce((sum, e) => sum + (e.tokens ?? 0), 0);

    return {
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
      tokenMetrics: {
        totalInputTokens: totalInput > 0 ? totalInput : null,
        totalOutputTokens: totalOutput > 0 ? totalOutput : null,
        approximate: true,
      },
    };
  });

  return JSON.stringify(summaries, null, 2);
}

function formatRow(columns: string[]): string {
  return columns.map((c) => `  ${c}`).join(' ');
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}
