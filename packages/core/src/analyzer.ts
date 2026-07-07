import type { AgentRun, ContextBlock, Turn } from './types.js';
import type {
  AnalysisResult,
  LargestBlock,
  TokenBreakdown,
  TurnSummary,
} from './analysis.js';
import { estimateTokens } from './tokenEstimator.js';
import type { SourceType } from './sourceTypes.js';
import { detectRepeatedBlockGroups, type RepeatedBlockGroup } from './repeated.js';
import { detectSmells } from './smells.js';
import { generateRecommendations } from './recommendations.js';

export { type AnalysisResult } from './analysis.js';

function flattenBlocks(
  run: AgentRun,
): Array<ContextBlock & { turnNumber: number; turnId: string }> {
  const result: Array<ContextBlock & { turnNumber: number; turnId: string }> = [];
  for (const turn of run.turns) {
    for (const block of turn.contextBlocks ?? []) {
      result.push({ ...block, turnNumber: turn.turnNumber, turnId: turn.id });
    }
  }
  return result;
}

export function analyzeRun(run: AgentRun): AnalysisResult {
  const flat = flattenBlocks(run).map((b) => ({
    ...b,
    estimatedTokens: estimateTokens(b.content),
  }));

  const totalInputTokens = flat.reduce((sum, b) => sum + (b.estimatedTokens ?? 0), 0);
  const totalOutputTokens =
    run.outputTokens ?? run.turns.reduce((sum, t) => sum + (t.outputTokens ?? 0), 0);

  const tokensByTurn: TurnSummary[] = run.turns.map((turn) => {
    const blocks = turn.contextBlocks ?? [];
    const inputTokens = blocks.reduce((sum, b) => sum + estimateTokens(b.content), 0);
    return {
      turnId: turn.id,
      turnNumber: turn.turnNumber,
      inputTokens,
      outputTokens: turn.outputTokens,
    };
  });

  const bySource = new Map<string, { tokens: number; blockCount: number }>();
  for (const block of flat) {
    const cur = bySource.get(block.sourceType) ?? { tokens: 0, blockCount: 0 };
    cur.tokens += block.estimatedTokens ?? 0;
    cur.blockCount += 1;
    bySource.set(block.sourceType, cur);
  }
  const tokensBySourceType: TokenBreakdown[] = Array.from(bySource.entries())
    .map(([sourceType, { tokens, blockCount }]) => ({
      sourceType: sourceType as SourceType,
      tokens,
      blockCount,
      percentage: totalInputTokens > 0 ? tokens / totalInputTokens : 0,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  const largestBlocks: LargestBlock[] = flat
    .map((b) => ({
      blockId: b.id,
      name: b.name,
      sourceType: b.sourceType,
      turnNumber: b.turnNumber,
      tokens: b.estimatedTokens ?? 0,
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10);

  const repeatedGroups = detectRepeatedBlockGroups(flat);
  const duplicateTokenCount = repeatedGroups.reduce((sum, g) => sum + g.totalTokens, 0);
  const duplicateRatio = totalInputTokens > 0 ? duplicateTokenCount / totalInputTokens : 0;

  const partial: Omit<AnalysisResult, 'smells' | 'recommendations' | 'generatedAt'> = {
    runId: run.id,
    runName: run.name,
    model: run.model,
    provider: run.provider,
    agent: run.agent,
    task: run.task,
    totalInputTokens,
    totalOutputTokens,
    turnCount: run.turns.length,
    blockCount: flat.length,
    tokensByTurn,
    tokensBySourceType,
    largestBlocks,
    repeatedBlockGroups: repeatedGroups,
    duplicateTokenCount,
    duplicateRatio,
  };

  const smells = detectSmells({ run, analysis: partial });
  const recommendations = generateRecommendations(smells);

  return {
    ...partial,
    smells,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}
