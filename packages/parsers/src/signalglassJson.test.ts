import { describe, it, expect } from 'vitest';
import { parseSignalglassJson } from './signalglassJson.js';

const minimalRun = {
  id: 'run-1',
  name: 'minimal',
  model: 'test',
  provider: 'test',
  turns: [
    {
      id: 't1',
      turnNumber: 1,
      messages: [{ role: 'user', content: 'hello' }],
      contextBlocks: [
        { id: 'b1', sourceType: 'file_tree', content: 'tree', name: 'file-tree' },
      ],
    },
  ],
};

describe('parseSignalglassJson', () => {
  it('parses a minimal run', () => {
    const run = parseSignalglassJson(minimalRun);
    expect(run.id).toBe('run-1');
    expect(run.turns).toHaveLength(1);
  });

  it('converts messages to context blocks', () => {
    const run = parseSignalglassJson(minimalRun);
    const userBlocks = run.turns[0].contextBlocks.filter(
      (b) => b.sourceType === 'user_message',
    );
    expect(userBlocks).toHaveLength(1);
    expect(userBlocks[0].content).toBe('hello');
  });

  it('rejects non-objects', () => {
    expect(() => parseSignalglassJson(null)).toThrow('Expected a JSON object');
  });

  it('rejects a missing id', () => {
    expect(() => parseSignalglassJson({ name: 'x', turns: [] })).toThrow(
      'Run must have string id and name',
    );
  });
});
