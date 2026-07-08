import { describe, it, expect } from 'vitest';
import { traceToAgentRun } from './traceToAgentRun.js';
import { createTraceEvent, createDefaultCapturePolicy } from './traces.js';
import type { Trace } from './traces.js';
import { analyzeRun } from './analyzer.js';

function makeTrace(events: Trace['events']): Trace {
  return {
    id: 'trace-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    mode: 'standard',
    capturePolicy: createDefaultCapturePolicy('standard'),
    status: 'success',
    agent: 'test-agent',
    task: 'test-task',
    model: 'gpt-4o',
    provider: 'openai',
    events,
  };
}

describe('traceToAgentRun', () => {
  it('converts user and assistant message events into ContextBlocks', () => {
    const trace = makeTrace([
      createTraceEvent({
        traceId: 'trace-1',
        type: 'message',
        contentPhase: 'said',
        sourceType: 'user_message',
        actor: { role: 'user' },
        tokens: 10,
        payloadRef: {
          id: 'payload-1',
          redacted: false,
          excerpt: 'Hello',
          size: 5,
        },
      }),
      createTraceEvent({
        traceId: 'trace-1',
        type: 'provider_request',
        contentPhase: 'requested',
        actor: { role: 'ingress' },
        routingDecision: 'routed to openai (openai-compatible)',
      }),
      createTraceEvent({
        traceId: 'trace-1',
        type: 'message',
        contentPhase: 'generated',
        sourceType: 'assistant_message',
        actor: { role: 'model' },
        tokens: 5,
        payloadRef: {
          id: 'payload-2',
          redacted: false,
          excerpt: 'Hi there',
          size: 8,
        },
      }),
    ]);

    const run = traceToAgentRun(trace);

    expect(run.id).toBe('trace-1');
    expect(run.name).toBe('test-agent');
    expect(run.model).toBe('gpt-4o');
    expect(run.provider).toBe('openai');
    expect(run.turns).toHaveLength(2);

    const turn1 = run.turns[0];
    expect(turn1.turnNumber).toBe(1);
    expect(turn1.contextBlocks).toHaveLength(1);
    expect(turn1.contextBlocks[0]!.sourceType).toBe('user_message');
    expect(turn1.contextBlocks[0]!.content).toBe('Hello');

    const turn2 = run.turns[1];
    expect(turn2.turnNumber).toBe(2);
    expect(turn2.contextBlocks).toHaveLength(2);
    expect(turn2.contextBlocks[0]!.sourceType).toBe('unknown');
    expect(turn2.contextBlocks[0]!.metadata!.traceEventType).toBe('provider_request');
    expect(turn2.contextBlocks[1]!.sourceType).toBe('assistant_message');
    expect(turn2.contextBlocks[1]!.content).toBe('Hi there');
  });

  it('converts instruction events into instruction ContextBlocks', () => {
    const trace = makeTrace([
      createTraceEvent({
        traceId: 'trace-1',
        type: 'instruction',
        contentPhase: 'sent',
        actor: { role: 'system' },
        tokens: 20,
        payloadRef: {
          id: 'payload-3',
          redacted: false,
          excerpt: 'You are helpful.',
          size: 16,
        },
      }),
      createTraceEvent({
        traceId: 'trace-1',
        type: 'instruction',
        contentPhase: 'sent',
        actor: { role: 'agent' },
        tokens: 15,
        payloadRef: {
          id: 'payload-4',
          redacted: false,
          excerpt: 'Use the provided tools.',
          size: 21,
        },
      }),
    ]);

    const run = traceToAgentRun(trace);

    expect(run.turns).toHaveLength(1);
    const blocks = run.turns[0].contextBlocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].sourceType).toBe('system_instruction');
    expect(blocks[0].content).toBe('You are helpful.');
    expect(blocks[1].sourceType).toBe('project_instruction');
    expect(blocks[1].content).toBe('Use the provided tools.');
  });

  it('converts tool call and tool result events', () => {
    const trace = makeTrace([
      createTraceEvent({
        traceId: 'trace-1',
        type: 'tool_call',
        contentPhase: 'requested',
        sourceType: 'tool_call',
        actor: { role: 'agent' },
        tokens: 30,
        payloadRef: {
          id: 'payload-5',
          redacted: false,
          excerpt: '{"name":"read_file"}',
          size: 20,
        },
      }),
      createTraceEvent({
        traceId: 'trace-1',
        type: 'tool_result',
        contentPhase: 'observed',
        sourceType: 'tool_output',
        actor: { role: 'tool' },
        tokens: 100,
        payloadRef: {
          id: 'payload-6',
          redacted: false,
          excerpt: 'file contents',
          size: 13,
        },
      }),
    ]);

    const run = traceToAgentRun(trace);

    const blocks = run.turns[0].contextBlocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].sourceType).toBe('tool_call');
    expect(blocks[0].content).toBe('{"name":"read_file"}');
    expect(blocks[1].sourceType).toBe('tool_output');
    expect(blocks[1].content).toBe('file contents');
  });

  it('does not include full raw payloads from provider events by default', () => {
    const trace = makeTrace([
      createTraceEvent({
        traceId: 'trace-1',
        type: 'provider_request',
        contentPhase: 'requested',
        actor: { role: 'ingress' },
        routingDecision: 'routed to openai',
        metadata: {
          baseUrl: 'https://api.openai.com/v1',
          messageCount: 2,
        },
      }),
      createTraceEvent({
        traceId: 'trace-1',
        type: 'provider_response',
        contentPhase: 'observed',
        actor: { role: 'provider' },
        metadata: { responseId: 'res-1' },
      }),
      createTraceEvent({
        traceId: 'trace-1',
        type: 'egress_response',
        contentPhase: 'returned',
        actor: { role: 'ingress' },
        metadata: { choiceCount: 1 },
      }),
    ]);

    const run = traceToAgentRun(trace);

    const blocks = run.turns[0].contextBlocks;
    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      expect(block.sourceType).toBe('unknown');
      expect(block.content).toBe('');
      expect(block.metadata!.traceEventType).toMatch(/provider_request|provider_response|egress_response/);
    }
  });

  it('preserves redaction flags on converted ContextBlocks', () => {
    const trace = makeTrace([
      createTraceEvent({
        traceId: 'trace-1',
        type: 'message',
        contentPhase: 'said',
        sourceType: 'user_message',
        actor: { role: 'user' },
        tokens: 100,
        payloadRef: {
          id: 'payload-7',
          redacted: true,
          excerpt: 'a'.repeat(240) + '…',
          size: 500,
        },
      }),
    ]);

    const run = traceToAgentRun(trace);

    const block = run.turns[0].contextBlocks[0];
    expect(block.content).toBe('a'.repeat(240) + '…');
    expect(block.metadata!.payloadRef).toMatchObject({
      id: 'payload-7',
      redacted: true,
      excerpt: 'a'.repeat(240) + '…',
      size: 500,
    });
  });

  it('links converted ContextBlocks back to trace event ids', () => {
    const trace = makeTrace([
      createTraceEvent({
        traceId: 'trace-1',
        type: 'message',
        contentPhase: 'said',
        sourceType: 'user_message',
        actor: { role: 'user' },
        payloadRef: {
          id: 'payload-8',
          redacted: false,
          excerpt: 'Hello',
          size: 5,
        },
      }),
    ]);

    const eventId = trace.events[0].id;
    const run = traceToAgentRun(trace);

    expect(run.turns[0].contextBlocks[0]!.metadata!.traceEventId).toBe(eventId);
    expect(run.turns[0].metadata!.traceEventIds).toContain(eventId);
  });

  it('produces an AgentRun that analyzeRun can process', () => {
    const trace = makeTrace([
      createTraceEvent({
        traceId: 'trace-1',
        type: 'message',
        contentPhase: 'said',
        sourceType: 'user_message',
        actor: { role: 'user' },
        tokens: 10,
        payloadRef: {
          id: 'payload-9',
          redacted: false,
          excerpt: 'Hello',
          size: 5,
        },
      }),
      createTraceEvent({
        traceId: 'trace-1',
        type: 'provider_request',
        contentPhase: 'requested',
        actor: { role: 'ingress' },
      }),
      createTraceEvent({
        traceId: 'trace-1',
        type: 'message',
        contentPhase: 'generated',
        sourceType: 'assistant_message',
        actor: { role: 'model' },
        tokens: 5,
        payloadRef: {
          id: 'payload-10',
          redacted: false,
          excerpt: 'Hi there',
          size: 8,
        },
      }),
      createTraceEvent({
        traceId: 'trace-1',
        type: 'inference',
        contentPhase: 'observed',
        actor: { role: 'provider' },
        tokens: 15,
      }),
    ]);

    const run = traceToAgentRun(trace);
    const result = analyzeRun(run);

    expect(result.runId).toBe('trace-1');
    expect(result.totalInputTokens).toBeGreaterThan(0);
    expect(result.turnCount).toBe(2);
    expect(result.smells.length).toBeGreaterThanOrEqual(0);
  });

  it('uses the task as the run name when agent is missing', () => {
    const trace = makeTrace([]);
    trace.agent = undefined;

    const run = traceToAgentRun(trace);
    expect(run.name).toBe('test-task');
  });

  it('falls back to a stable generated name when agent and task are missing', () => {
    const trace = makeTrace([]);
    trace.agent = undefined;
    trace.task = undefined;

    const run = traceToAgentRun(trace);
    expect(run.name).toBe('trace-trace-1');
  });
});
