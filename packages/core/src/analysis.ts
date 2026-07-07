import type { SourceType } from './sourceTypes.js';
import type { RepeatedBlockGroup } from './repeated.js';
import type { ContextSmell } from './smells.js';
import type { Recommendation } from './recommendations.js';

export interface TokenBreakdown {
  sourceType: SourceType;
  tokens: number;
  blockCount: number;
  percentage: number;
}

export interface TurnSummary {
  turnId: string;
  turnNumber: number;
  inputTokens: number;
  outputTokens?: number;
}

export interface LargestBlock {
  blockId: string;
  name?: string;
  sourceType: SourceType;
  turnNumber: number;
  tokens: number;
}

export interface AnalysisResult {
  runId: string;
  runName: string;
  model?: string;
  provider?: string;
  agent?: string;
  task?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  turnCount: number;
  blockCount: number;
  tokensByTurn: TurnSummary[];
  tokensBySourceType: TokenBreakdown[];
  largestBlocks: LargestBlock[];
  repeatedBlockGroups: RepeatedBlockGroup[];
  duplicateTokenCount: number;
  duplicateRatio: number;
  smells: ContextSmell[];
  recommendations: Recommendation[];
  generatedAt: string;
}
