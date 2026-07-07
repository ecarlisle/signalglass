import { describe, it, expect } from 'vitest';
import { analyzeRun } from './analyzer.js';
import { detectSmells } from './smells.js';
import type { AgentRun, AnalysisResult } from './index.js';

const sampleRun: AgentRun = {
  id: 'run-1',
  name: 'sample',
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
    {
      id: 't3',
      turnNumber: 3,
      contextBlocks: [
        {
          id: 'b6',
          turnId: 't3',
          sourceType: 'file_content',
          name: 'src/app.ts',
          content: 'export function app() {}',
        },
      ],
    },
  ],
};

describe('smell detection', () => {
  it('detects repeated project instruction', () => {
    const analysis = analyzeRun(sampleRun);
    const smells = detectSmells({ run: sampleRun, analysis });
    expect(smells.some((s) => s.id === 'repeated_project_instruction')).toBe(true);
  });

  it('detects repeated file tree', () => {
    const analysis = analyzeRun(sampleRun);
    const smells = detectSmells({ run: sampleRun, analysis });
    expect(smells.some((s) => s.id === 'repeated_file_tree')).toBe(true);
  });

  it('detects oversized tool output', () => {
    const analysis = analyzeRun(sampleRun);
    const smells = detectSmells({ run: sampleRun, analysis });
    expect(smells.some((s) => s.id === 'oversized_tool_output')).toBe(true);
  });

  it('flags late relevant file as heuristic', () => {
    const analysis = analyzeRun(sampleRun);
    const smells = detectSmells({ run: sampleRun, analysis });
    expect(smells.some((s) => s.id === 'late_relevant_file_heuristic')).toBe(true);
  });

  it('includes educational fields on every smell', () => {
    const analysis = analyzeRun(sampleRun);
    const smells = detectSmells({ run: sampleRun, analysis });
    for (const smell of smells) {
      expect(smell.whatHappened).toBeTruthy();
      expect(smell.whyItMatters).toBeTruthy();
      expect(smell.evidenceSummary).toBeTruthy();
      expect(smell.recommendation).toBeTruthy();
      expect(Array.isArray(smell.suggestedNextSteps)).toBe(true);
    }
  });

  it('labels heuristic smells', () => {
    const analysis = analyzeRun(sampleRun);
    const smells = detectSmells({ run: sampleRun, analysis });
    const late = smells.find((s) => s.id === 'late_relevant_file_heuristic');
    expect(late?.isHeuristic).toBe(true);
  });
});
