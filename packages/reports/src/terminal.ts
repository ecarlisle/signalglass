import type { AnalysisResult } from '@signalglass/core';

export function renderTerminal(analysis: AnalysisResult): string {
  const lines: string[] = [];

  lines.push(`Signalglass analysis: ${analysis.runName}`);
  lines.push(`  Run id:        ${analysis.runId}`);
  lines.push(`  Model:         ${analysis.model ?? 'unknown'}`);
  lines.push(`  Provider:      ${analysis.provider ?? 'unknown'}`);
  lines.push(`  Turns:         ${analysis.turnCount}`);
  lines.push(`  Blocks:        ${analysis.blockCount}`);
  lines.push(`  Input tokens:  ${analysis.totalInputTokens} (approximate)`);
  if (analysis.totalOutputTokens > 0) {
    lines.push(`  Output tokens: ${analysis.totalOutputTokens}`);
  }
  lines.push(
    `  Repeated:      ${Math.round(analysis.duplicateRatio * 100)}% (${analysis.duplicateTokenCount} tokens)`,
  );

  lines.push('');
  lines.push('Tokens by source type (approximate)');
  lines.push(`  ${pad('source type', 24)} ${pad('tokens', 8)} share`);
  for (const breakdown of analysis.tokensBySourceType) {
    lines.push(
      `  ${pad(breakdown.sourceType, 24)} ${pad(String(breakdown.tokens), 8)} ${Math.round(breakdown.percentage * 100)}%`,
    );
  }

  lines.push('');
  lines.push('Largest context blocks');
  for (const block of analysis.largestBlocks.slice(0, 5)) {
    const label = block.name ? `${block.sourceType}:${block.name}` : block.sourceType;
    lines.push(
      `  turn ${String(block.turnNumber).padStart(2)}  ${pad(label, 48)} ~${block.tokens} tokens`,
    );
  }

  lines.push('');
  lines.push(`Context smells (${analysis.smells.length})`);
  for (const smell of analysis.smells) {
    const heuristicTag = smell.isHeuristic ? ' [heuristic]' : '';
    lines.push(`  [${smell.severity.toUpperCase()}]${heuristicTag} ${smell.title}`);
    lines.push(`    What happened: ${smell.whatHappened}`);
    lines.push(`    Why it matters: ${smell.whyItMatters}`);
    lines.push(`    Evidence:       ${smell.evidenceSummary}`);
    lines.push(`    Recommendation: ${smell.recommendation}`);
    if (smell.suggestedNextSteps.length > 0) {
      lines.push(`    Try next:`);
      for (const step of smell.suggestedNextSteps) {
        lines.push(`      • ${step}`);
      }
    }
  }

  lines.push('');
  lines.push('Recommendations');
  if (analysis.recommendations.length === 0) {
    lines.push('  No specific recommendations.');
  } else {
    for (const rec of analysis.recommendations) {
      lines.push(`  • ${rec.title}`);
      lines.push(`    ${rec.description}`);
      lines.push(`    Why it matters: ${rec.whyItMatters}`);
      lines.push(`    Inspect:        ${rec.inspectSuggestion}`);
      lines.push(`    Try:            ${rec.trySuggestion}`);
    }
  }

  lines.push('');
  lines.push('Token counts are approximate (roughly 1 token per 4 characters).');
  lines.push('Heuristic detections are labeled and should be verified against the raw run data.');

  return lines.join('\n');
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}
