import type { Trace, TraceEvent } from '@signalglass/core';

export function renderTraceHtml(trace: Trace): string {
  const events = trace.events ?? [];
  const tokenMetrics = buildTokenMetrics(events);
  const typeBreakdown = buildEventTypeBreakdown(events);
  const phaseBreakdown = buildContentPhaseBreakdown(events);
  const routingDecisions = collectStrings(events, 'routingDecision');
  const transformations = collectStrings(events, 'transformationSummary');
  const excerpts = collectExcerptEntries(events);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Signalglass trace report – ${escapeHtml(trace.id)}</title>
  <style>
    :root { --bg: #fafafa; --card: #fff; --text: #222; --muted: #666; --border: #e0e0e0; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 2rem; background: var(--bg); color: var(--text); }
    .container { max-width: 960px; margin: 0 auto; }
    h1, h2 { font-weight: 600; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .card { background: var(--card); padding: 1rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .card .value { font-size: 1.75rem; font-weight: 700; }
    .card .label { color: var(--muted); font-size: 0.9rem; }
    table { width: 100%; border-collapse: collapse; background: var(--card); border-radius: 8px; overflow: hidden; margin: 1rem 0; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    th, td { text-align: left; padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border); }
    th { background: #f0f0f0; font-weight: 600; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 0.5rem; margin: 1rem 0; }
    .meta-item { padding: 0.25rem 0; }
    .meta-item .key { color: var(--muted); font-size: 0.85rem; }
    .meta-item .val { font-weight: 500; }
    .excerpt { background: var(--card); border-left: 4px solid #1976d2; padding: 0.75rem 1rem; margin: 0.5rem 0; border-radius: 4px; font-family: monospace; font-size: 0.9rem; white-space: pre-wrap; word-break: break-word; }
    .excerpt .tag { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 0.25rem; }
    footer { margin-top: 2rem; color: var(--muted); font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Signalglass trace report</h1>

    <div class="meta-grid">
      <div class="meta-item"><span class="key">Trace ID</span><br/><span class="val">${escapeHtml(trace.id)}</span></div>
      <div class="meta-item"><span class="key">Status</span><br/><span class="val">${escapeHtml(trace.status)}</span></div>
      <div class="meta-item"><span class="key">Provider</span><br/><span class="val">${escapeHtml(trace.provider ?? 'unknown')}</span></div>
      <div class="meta-item"><span class="key">Model</span><br/><span class="val">${escapeHtml(trace.model ?? 'unknown')}</span></div>
      <div class="meta-item"><span class="key">Mode</span><br/><span class="val">${escapeHtml(trace.mode)}</span></div>
      <div class="meta-item"><span class="key">Events</span><br/><span class="val">${events.length}</span></div>
      <div class="meta-item"><span class="key">Started</span><br/><span class="val">${escapeHtml(trace.startedAt)}</span></div>
      ${trace.endedAt ? `<div class="meta-item"><span class="key">Ended</span><br/><span class="val">${escapeHtml(trace.endedAt)}</span></div>` : ''}
      ${trace.agent ? `<div class="meta-item"><span class="key">Agent</span><br/><span class="val">${escapeHtml(trace.agent)}</span></div>` : ''}
      ${trace.task ? `<div class="meta-item"><span class="key">Task</span><br/><span class="val">${escapeHtml(trace.task)}</span></div>` : ''}
    </div>

    <h2>Token metrics</h2>
    <div class="cards">
      <div class="card"><div class="value">${tokenMetrics.totalInputTokens ?? '—'}</div><div class="label">Estimated input tokens</div></div>
      <div class="card"><div class="value">${tokenMetrics.totalOutputTokens ?? '—'}</div><div class="label">Estimated output tokens</div></div>
      <div class="card"><div class="value">${tokenMetrics.inferenceTokens ?? '—'}</div><div class="label">Inference tokens</div></div>
    </div>

    <h2>Events by type</h2>
    <table>
      <thead><tr><th>Type</th><th>Count</th></tr></thead>
      <tbody>
        ${typeBreakdown.length === 0 ? '<tr><td colspan="2">No events</td></tr>' : typeBreakdown.map((g) => `<tr><td>${escapeHtml(g.type)}</td><td>${g.count}</td></tr>`).join('')}
      </tbody>
    </table>

    ${phaseBreakdown.length > 0 ? `
    <h2>Events by content phase</h2>
    <table>
      <thead><tr><th>Phase</th><th>Count</th></tr></thead>
      <tbody>
        ${phaseBreakdown.map((g) => `<tr><td>${escapeHtml(g.phase)}</td><td>${g.count}</td></tr>`).join('')}
      </tbody>
    </table>
    ` : ''}

    ${routingDecisions.length > 0 ? `
    <h2>Routing decisions</h2>
    <ul>
      ${routingDecisions.map((rd) => `<li>${escapeHtml(rd)}</li>`).join('')}
    </ul>
    ` : ''}

    ${transformations.length > 0 ? `
    <h2>Transformation summaries</h2>
    <ul>
      ${transformations.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
    </ul>
    ` : ''}

    ${excerpts.length > 0 ? `
    <h2>Content excerpts (redacted)</h2>
    ${excerpts.map((ex) => `
      <div class="excerpt">
        <div class="tag">${escapeHtml(ex.eventType)}</div>
        ${escapeHtml(ex.text)}
      </div>
    `).join('')}
    ` : ''}

    <footer>
      <p>Generated at ${new Date().toISOString()}.</p>
      <p>Token counts are approximate estimates.</p>
      <p>Full raw payloads are not included in this report.</p>
      <p>API keys, secrets, and authorization headers are never stored or reported.</p>
    </footer>
  </div>
</body>
</html>`;
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
