import type { Trace } from '@signalglass/core';
import {
  computeTokenMetrics,
  groupEventsByType,
  groupEventsByContentPhase,
  collectRoutingDecisions,
  collectTransformationSummaries,
  collectRedactedExcerpts,
} from './traceMetrics.js';
import { sanitizeReportString } from './sanitize.js';

export function renderTraceHtml(trace: Trace): string {
  const events = trace.events ?? [];
  const tokenMetrics = computeTokenMetrics(events);
  const typeGroups = groupEventsByType(events);
  const phaseGroups = groupEventsByContentPhase(events);
  const routingDecisions = collectRoutingDecisions(events);
  const transformations = collectTransformationSummaries(events);
  const excerpts = collectRedactedExcerpts(events);

  const rows = [
    renderRow('Trace ID', safe(trace.id)),
    renderRow('Status', safe(trace.status)),
    renderRow('Provider', safe(trace.provider ?? 'unknown')),
    renderRow('Model', safe(trace.model ?? 'unknown')),
    renderRow('Mode', safe(trace.mode)),
    renderRow('Started', safe(trace.startedAt)),
    renderRow('Ended', trace.endedAt ? safe(trace.endedAt) : '—'),
    renderRow('Agent', trace.agent ? safe(trace.agent) : '—'),
    renderRow('Task', trace.task ? safe(trace.task) : '—'),
    renderRow('Events', String(events.length)),
  ];

  if (tokenMetrics.totalInputTokens != null) {
    rows.push(renderRow('Input tokens', `${tokenMetrics.totalInputTokens} (approx)`));
  }
  if (tokenMetrics.totalOutputTokens != null) {
    rows.push(renderRow('Output tokens', `${tokenMetrics.totalOutputTokens} (approx)`));
  }
  if (tokenMetrics.inferenceTokens != null) {
    rows.push(renderRow('Inference tokens', `${tokenMetrics.inferenceTokens} (approx)`));
  }

  const typeRows = typeGroups
    .map((g) => `<tr><td>${escapeHtml(g.type)}</td><td>${g.count}</td></tr>`)
    .join('\n      ');

  const phaseRows = phaseGroups
    .map((g) => `<tr><td>${escapeHtml(g.phase)}</td><td>${g.count}</td></tr>`)
    .join('\n      ');

  const decisionItems = routingDecisions
    .map((d) => `      <li>${escapeHtml(d)}</li>`)
    .join('\n');

  const transformationItems = transformations
    .map((t) => `      <li>${escapeHtml(t)}</li>`)
    .join('\n');

  const excerptItems = excerpts
    .map((e) => `      <li><strong>[${escapeHtml(e.eventType)}]</strong> ${escapeHtml(e.text)}</li>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Signalglass Trace Report — ${escapeHtml(safe(trace.id))}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
  h1 { border-bottom: 2px solid #ddd; padding-bottom: 0.5rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; }
  th { border-bottom: 1px solid #ddd; }
  .section { margin-top: 1.5rem; }
  .section h2 { font-size: 1.1rem; margin-bottom: 0.5rem; }
  .disclaimers { margin-top: 2rem; font-size: 0.85rem; color: #666; }
</style>
</head>
<body>
<h1>Signalglass Trace Report</h1>
<table>
  ${rows.join('\n      ')}
</table>

<div class="section">
  <h2>Events by type</h2>
  <table>
    <tr><th>Type</th><th>Count</th></tr>
    ${typeRows}
  </table>
</div>

<div class="section">
  <h2>Events by content phase</h2>
  <table>
    <tr><th>Phase</th><th>Count</th></tr>
    ${phaseRows}
  </table>
</div>

${routingDecisions.length > 0 ? `<div class="section">
  <h2>Routing decisions</h2>
  <ul>
    ${decisionItems}
  </ul>
</div>` : ''}

${transformations.length > 0 ? `<div class="section">
  <h2>Transformation summaries</h2>
  <ul>
    ${transformationItems}
  </ul>
</div>` : ''}

${excerpts.length > 0 ? `<div class="section">
  <h2>Content excerpts (redacted)</h2>
  <ul>
    ${excerptItems}
  </ul>
</div>` : ''}

<div class="disclaimers">
  <p>Token counts are approximate estimates.</p>
  <p>Full raw payloads are not included in this report.</p>
  <p>API keys, secrets, and authorization headers are never stored or reported.</p>
</div>
</body>
</html>`;
}

function renderRow(label: string, value: string): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
}

function safe(text: string): string {
  return sanitizeReportString(text);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
