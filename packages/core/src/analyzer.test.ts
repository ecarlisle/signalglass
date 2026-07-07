import { describe, it, expect } from 'vitest';
import { analyzeRun } from './analyzer.js';
import type { AgentRun } from './types.js';

const sampleRun: AgentRun = {
  id: 'run-1',
  name: 'sample',
  model: 'test-model',
  provider: 'test-provider',
  turns: [
    {
      id: 't1',
      turnNumber: 1,
      contextBlocks: [
        {
          id: 'b1',
          turnId: 't1',
          sourceType: 'project_instruction',
          content: 'project instruction text',
        },
        {
          id: 'b2',
          turnId: 't1',
          sourceType: 'file_tree',
          content: 'tree contents',
        },
      ],
    },
    {
      id: 't2',
      turnNumber: 2,
      contextBlocks: [
        {
          id: 'b3',
          turnId: 't2',
          sourceType: 'project_instruction',
          content: 'project instruction text',
        },
        {
          id: 'b4',
          turnId: 't2',
          sourceType: 'file_tree',
          content: 'tree contents',
        },
        {
          id: 'b5',
          turnId: 't2',
          sourceType: 'tool_output',
          content: 'a'.repeat(4000),
        },
      ],
    },
  ],
};

describe('analyzeRun', () => {
  it('computes total input tokens', () => {
    const result = analyzeRun(sampleRun);
    expect(result.totalInputTokens).toBeGreaterThan(0);
  });

  it('aggregates tokens by source type', () => {
    const result = analyzeRun(sampleRun);
    const project = result.tokensBySourceType.find(
      (b) => b.sourceType === 'project_instruction',
    );
    expect(project).toBeDefined();
    expect(project!.blockCount).toBe(2);
  });

  it('detects repeated blocks', () => {
    const result = analyzeRun(sampleRun);
    expect(result.repeatedBlockGroups.length).toBeGreaterThan(0);
    expect(result.duplicateTokenCount).toBeGreaterThan(0);
  });

  it('lists largest blocks in descending order', () => {
    const result = analyzeRun(sampleRun);
    expect(result.largestBlocks[0].tokens).toBeGreaterThanOrEqual(
      result.largestBlocks[1]?.tokens ?? 0,
    );
  });

  it('reports per-turn input tokens', () => {
    const result = analyzeRun(sampleRun);
    expect(result.tokensByTurn).toHaveLength(2);
    expect(result.tokensByTurn[0].inputTokens).toBeGreaterThan(0);
  });
});
