import type { ContextBlock } from './types.js';
import type { SourceType } from './sourceTypes.js';

export interface RepeatedBlockGroup {
  hash: string;
  sourceType: SourceType;
  occurrences: number;
  tokensPerOccurrence: number;
  totalTokens: number;
  blockIds: string[];
  turnIds: string[];
}

/**
 * Detect exact repeated content across context blocks.
 */
export function detectRepeatedBlockGroups(
  blocks: Array<ContextBlock & { turnNumber: number; estimatedTokens?: number }>,
): RepeatedBlockGroup[] {
  const groups = new Map<string, RepeatedBlockGroup>();

  for (const block of blocks) {
    const key = `${block.sourceType}::${block.content}`;
    const tokens = block.estimatedTokens ?? Math.ceil(block.content.length / 4);
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        hash: simpleHash(key),
        sourceType: block.sourceType,
        occurrences: 1,
        tokensPerOccurrence: tokens,
        totalTokens: tokens,
        blockIds: [block.id],
        turnIds: [block.turnId],
      });
    } else {
      existing.occurrences += 1;
      existing.blockIds.push(block.id);
      existing.turnIds.push(block.turnId);
      existing.totalTokens = existing.tokensPerOccurrence * existing.occurrences;
    }
  }

  return Array.from(groups.values())
    .filter((g) => g.occurrences > 1)
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}
