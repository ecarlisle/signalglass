/**
 * Tests: legacy `Trace`/`TraceEvent` → legacy `AgentRun` projection
 * (Spec 014 §6.1 direction 2; the documented legacy conversion of Spec 013
 * §11.2). Uses fixed, in-memory legacy traces; never requires live capture.
 */
import { describe, expect, it } from 'vitest';
import { legacyTraceToAgentRun } from './legacyTraceToAgentRun.js';
import { createDefaultCapturePolicy, createTraceEvent } from '../traces.js';
import type { Trace } from '../traces.js';
import {
  LEGACY_TRACE_SCHEMA_VERSION,
  LEGACY_TRACE_TO_AGENT_RUN_PROJECTION_VERSION,
  PROJECTION_ISSUE_CODES,
} from './types.js';

function makeTrace(
  events: Trace['events'],
  overrides: Partial<Trace> = {},
): Trace {
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
    ...overrides,
  };
}

function messageEvent(id: string, contentPhase: 'said' | 'generated', sourceType: string, content: string, tokens?: number) {
  return createTraceEvent({
    id,
    traceId: 'trace-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'message',
    contentPhase,
    sourceType: sourceType as Trace['events'][number]['sourceType'],
    actor: { role: contentPhase === 'said' ? 'user' : 'model' },
    tokens,
    payloadRef: { id: `payload-${id}`, redacted: false, excerpt: content, size: content.length },
  });
}

describe('legacyTraceToAgentRun — wraps the legacy conversion', () => {
  it('produces an AgentRun view preserving the legacy conversion behavior', () => {
    const trace = makeTrace([
      messageEvent('e1', 'said', 'user_message', 'Hello'),
      createTraceEvent({
        id: 'e2', traceId: 'trace-1', type: 'provider_request', contentPhase: 'requested',
        actor: { role: 'ingress' }, routingDecision: 'routed to openai',
      }),
      messageEvent('e3', 'generated', 'assistant_message', 'Hi there'),
    ]);
    const result = legacyTraceToAgentRun(trace);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const run = result.view;
    expect(run.id).toBe('trace-1');
    expect(run.name).toBe('test-agent');
    expect(run.model).toBe('gpt-4o');
    expect(run.provider).toBe('openai');
    expect(run.agent).toBe('test-agent');
    expect(run.task).toBe('test-task');
    expect(run.turns).toHaveLength(1);
    expect(run.turns[0]!.contextBlocks.map((b) => b.sourceType)).toEqual([
      'user_message',
      'unknown',
      'assistant_message',
    ]);
    expect(run.turns[0]!.contextBlocks[0]!.content).toBe('Hello');
  });

  it('preserves the turn-boundary convention (egress_response splits turns)', () => {
    const trace = makeTrace([
      messageEvent('e1', 'said', 'user_message', 'Hello'),
      createTraceEvent({ id: 'e2', traceId: 'trace-1', type: 'egress_response', contentPhase: 'returned', actor: { role: 'ingress' } }),
      messageEvent('e3', 'said', 'user_message', 'Again'),
    ]);
    const result = legacyTraceToAgentRun(trace);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.turns).toHaveLength(2);
  });

  it('returns an empty valid AgentRun view for an empty events array', () => {
    const result = legacyTraceToAgentRun(makeTrace([]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.turns).toEqual([]);
    expect(result.view.outputTokens).toBeUndefined();
  });

  it('retains safe-excerpt and metadata-filtering rules (no secrets)', () => {
    const trace = makeTrace(
      [messageEvent('e1', 'said', 'user_message', 'Hello')],
      {
        metadata: {
          safeKey: 'safe-value',
          Authorization: 'Bearer secret-token',
          apiKey: 'sk-secret',
          rawRequest: '{"model":"gpt-4o"}',
        },
      },
    );
    const result = legacyTraceToAgentRun(trace);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const run = result.view;
    expect(run.metadata!.traceMetadata).toEqual({ safeKey: 'safe-value' });
    expect(JSON.stringify(run)).not.toContain('Bearer secret-token');
    expect(JSON.stringify(run)).not.toContain('sk-secret');
  });

  it('does not invent token counts when the legacy trace carries none', () => {
    const trace = makeTrace([
      messageEvent('e1', 'said', 'user_message', 'Hello'),
      messageEvent('e2', 'generated', 'assistant_message', 'Hi'),
    ]);
    const result = legacyTraceToAgentRun(trace);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const run = result.view;
    // No inference metadata or token fields exist; the legacy conversion
    // derives no outputTokens and the projection adds none.
    expect(run.outputTokens).toBeUndefined();
    expect(run.turns[0]!.outputTokens).toBeUndefined();
    for (const block of run.turns[0]!.contextBlocks) {
      expect(block.estimatedTokens).toBeUndefined();
    }
  });

  it('preserves legacy inference token accounting when present', () => {
    const trace = makeTrace([
      createTraceEvent({
        id: 'e1', traceId: 'trace-1', type: 'inference', contentPhase: 'observed',
        actor: { role: 'provider' }, tokens: 148,
        metadata: { promptTokens: 120, completionTokens: 28, totalTokens: 148 },
      }),
    ]);
    const result = legacyTraceToAgentRun(trace);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.outputTokens).toBe(28);
    expect(result.view.turns[0]!.metadata).toMatchObject({
      promptTokens: 120,
      completionTokens: 28,
      totalTokens: 148,
    });
  });
});

describe('legacyTraceToAgentRun — determinism', () => {
  it('produces deeply equal views and reports across repeated calls', () => {
    const trace = makeTrace([
      messageEvent('e1', 'said', 'user_message', 'Hello'),
      messageEvent('e2', 'generated', 'assistant_message', 'Hi'),
    ]);
    const first = legacyTraceToAgentRun(trace);
    const second = legacyTraceToAgentRun(trace);
    expect(first).toEqual(second);
    if (first.ok && second.ok) {
      // Synthesized ids are deterministic (pt-0, pt-1, …) across calls.
      expect(first.view.turns[0]!.id).toBe(second.view.turns[0]!.id);
      expect(first.view.turns[0]!.contextBlocks[0]!.id).toBe(second.view.turns[0]!.contextBlocks[0]!.id);
    }
  });

  it('reports synthesized identifiers as inferred', () => {
    const result = legacyTraceToAgentRun(makeTrace([messageEvent('e1', 'said', 'user_message', 'Hello')]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const inferred = result.report.mappings.filter((m) => m.outcome === 'inferred');
    expect(inferred.some((m) => m.path === 'turns[0].id')).toBe(true);
    expect(inferred.some((m) => m.path === 'turns[0].contextBlocks[0].id')).toBe(true);
    for (const m of inferred) {
      expect(m.reason).toContain('synthesized');
    }
  });
});

describe('legacyTraceToAgentRun — structured failure and metadata', () => {
  it('returns ok:false for an absent events collection', () => {
    const result = legacyTraceToAgentRun({} as Trace);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.code).toBe(PROJECTION_ISSUE_CODES.invalidEventCollection);
    expect(result.issues[0]!.stage).toBe('legacy_trace_to_agent_run');
    expect(result.issues[0]!.path).toBe('events');
  });

  it('returns ok:false for a non-array events collection', () => {
    const result = legacyTraceToAgentRun({ events: 'not-an-array' } as unknown as Trace);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]!.code).toBe(PROJECTION_ISSUE_CODES.invalidEventCollection);
  });

  it('returns ok:false for a null trace without throwing', () => {
    const result = legacyTraceToAgentRun(null as unknown as Trace);
    expect(result.ok).toBe(false);
  });

  it('carries the projection version and legacy source schema version', () => {
    const result = legacyTraceToAgentRun(makeTrace([]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.projectionVersion).toBe(LEGACY_TRACE_TO_AGENT_RUN_PROJECTION_VERSION);
    expect(result.report.sourceSchemaVersion).toBe(LEGACY_TRACE_SCHEMA_VERSION);
  });
});
