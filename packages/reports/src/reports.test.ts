import { describe, it, expect } from 'vitest';
import { analyzeRun } from '@signalglass/core';
import { renderTerminal, renderJson, renderHtml } from './index.js';
import type { AgentRun } from '@signalglass/core';

const sampleRun: AgentRun = {
  id: 'run-1',
  name: 'report test',
  model: 'gpt-4',
  provider: 'openai',
  turns: [
    {
      id: 't1',
      turnNumber: 1,
      contextBlocks: [
        {
          id: 'b1',
          turnId: 't1',
          sourceType: 'user_message',
          content: 'hello world',
        },
      ],
    },
  ],
};

describe('report formatters', () => {
  const analysis = analyzeRun(sampleRun);

  it('renders a terminal report containing the run name', () => {
    const output = renderTerminal(analysis);
    expect(output).toContain('report test');
    expect(output).toContain('Input tokens');
  });

  it('renders a JSON report that round-trips', () => {
    const output = renderJson(analysis);
    const parsed = JSON.parse(output);
    expect(parsed.runName).toBe('report test');
    expect(parsed.totalInputTokens).toBe(analysis.totalInputTokens);
  });

  it('renders a static HTML report', () => {
    const output = renderHtml(analysis);
    expect(output).toContain('<html');
    expect(output).toContain('report test');
    expect(output).toContain('Input tokens');
  });
});
