import type { AnalysisResult } from '@signalglass/core';

export function renderHtml(analysis: AnalysisResult): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Signalglass – ${escapeHtml(analysis.runName)}</title>
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
    .smell { background: var(--card); border-left: 4px solid #999; padding: 1rem; margin: 0.5rem 0; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .smell.high { border-left-color: #d32f2f; }
    .smell.warning { border-left-color: #f57c00; }
    .smell.info { border-left-color: #1976d2; }
    .smell .heuristic { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); border: 1px solid var(--border); padding: 0.1rem 0.35rem; border-radius: 4px; margin-left: 0.5rem; }
    .smell dt { font-weight: 600; margin-top: 0.5rem; }
    .smell dd { margin-left: 0; margin-top: 0.25rem; color: var(--muted); }
    .smell ul { margin: 0.25rem 0 0 0; padding-left: 1.25rem; }
    footer { margin-top: 2rem; color: var(--muted); font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Signalglass report</h1>
    <p>
      ${escapeHtml(analysis.runName)} ·
      ${escapeHtml(analysis.model ?? 'unknown model')} ·
      ${escapeHtml(analysis.provider ?? 'unknown provider')}
    </p>

    <div class="cards">
      <div class="card"><div class="value">${analysis.totalInputTokens}</div><div class="label">Estimated input tokens</div></div>
      <div class="card"><div class="value">${analysis.turnCount}</div><div class="label">Turns</div></div>
      <div class="card"><div class="value">${analysis.blockCount}</div><div class="label">Blocks</div></div>
      <div class="card"><div class="value">${Math.round(analysis.duplicateRatio * 100)}%</div><div class="label">Repeated context</div></div>
    </div>

    <h2>Tokens by source type</h2>
    <table>
      <thead>
        <tr><th>Source type</th><th>Tokens</th><th>Blocks</th><th>Share</th></tr>
      </thead>
      <tbody>
        ${analysis.tokensBySourceType.map((b) => `<tr><td>${escapeHtml(b.sourceType)}</td><td>${b.tokens}</td><td>${b.blockCount}</td><td>${Math.round(b.percentage * 100)}%</td></tr>`).join('')}
      </tbody>
    </table>

    <h2>Turns</h2>
    <table>
      <thead>
        <tr><th>#</th><th>Input tokens</th><th>Output tokens</th></tr>
      </thead>
      <tbody>
        ${analysis.tokensByTurn.map((t) => `<tr><td>${t.turnNumber}</td><td>${t.inputTokens}</td><td>${t.outputTokens ?? '—'}</td></tr>`).join('')}
      </tbody>
    </table>

    <h2>Largest blocks</h2>
    <table>
      <thead>
        <tr><th>Turn</th><th>Type</th><th>Name</th><th>Tokens</th></tr>
      </thead>
      <tbody>
        ${analysis.largestBlocks.slice(0, 10).map((b) => `<tr><td>${b.turnNumber}</td><td>${escapeHtml(b.sourceType)}</td><td>${escapeHtml(b.name ?? '')}</td><td>${b.tokens}</td></tr>`).join('')}
      </tbody>
    </table>

    <h2>Context smells</h2>
    ${analysis.smells.length === 0 ? '<p>None detected.</p>' : analysis.smells.map((s) => `
      <div class="smell ${s.severity}">
        <strong>[${s.severity.toUpperCase()}] ${escapeHtml(s.title)}</strong>
        ${s.isHeuristic ? '<span class="heuristic">heuristic</span>' : ''}
        <dl>
          <dt>What happened</dt>
          <dd>${escapeHtml(s.whatHappened)}</dd>
          <dt>Why it matters</dt>
          <dd>${escapeHtml(s.whyItMatters)}</dd>
          <dt>Evidence</dt>
          <dd>${escapeHtml(s.evidenceSummary)}</dd>
          <dt>Recommendation</dt>
          <dd>${escapeHtml(s.recommendation)}</dd>
          ${s.suggestedNextSteps.length > 0 ? `
            <dt>Try next</dt>
            <dd><ul>${s.suggestedNextSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ul></dd>
          ` : ''}
        </dl>
      </div>
    `).join('')}

    <h2>Recommendations</h2>
    ${analysis.recommendations.length === 0 ? '<p>None.</p>' : analysis.recommendations.map((r) => `
      <div class="smell info">
        <strong>${escapeHtml(r.title)}</strong>
        <p>${escapeHtml(r.description)}</p>
        <dl>
          <dt>Why it matters</dt>
          <dd>${escapeHtml(r.whyItMatters)}</dd>
          <dt>Inspect</dt>
          <dd>${escapeHtml(r.inspectSuggestion)}</dd>
          <dt>Try</dt>
          <dd>${escapeHtml(r.trySuggestion)}</dd>
        </dl>
      </div>
    `).join('')}

    <footer>
      Generated at ${escapeHtml(analysis.generatedAt)}.
      Token counts are approximate estimates.
      Heuristic detections are labeled and should be verified against the raw run data.
    </footer>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
