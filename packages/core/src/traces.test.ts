import { describe, it, expect } from 'vitest';
import {
  createDefaultCapturePolicy,
  createTraceEvent,
  isRawPayloadCaptureEnabled,
  type TraceEvent,
} from './traces.js';
import type { ContextSmell, Recommendation } from './index.js';

describe('trace model', () => {
  it('creates a trace event with a content phase', () => {
    const event = createTraceEvent({
      traceId: 'trace-1',
      type: 'message',
      contentPhase: 'sent',
      actor: { role: 'agent', name: 'pi' },
      tokens: 42,
    });

    expect(event.traceId).toBe('trace-1');
    expect(event.type).toBe('message');
    expect(event.contentPhase).toBe('sent');
    expect(event.actor?.role).toBe('agent');
    expect(event.tokens).toBe(42);
    expect(event.id).toBeTruthy();
    expect(event.timestamp).toBeTruthy();
  });

  it('generates an id and timestamp when omitted', () => {
    const event = createTraceEvent({
      traceId: 'trace-1',
      type: 'provider_request',
    });

    expect(event.id).toBeTruthy();
    expect(event.timestamp).toBeTruthy();
    expect(Date.parse(event.timestamp)).not.toBeNaN();
  });

  it('preserves a provided id and timestamp', () => {
    const event = createTraceEvent({
      id: 'ev-123',
      traceId: 'trace-1',
      type: 'context',
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    expect(event.id).toBe('ev-123');
    expect(event.timestamp).toBe('2026-01-01T00:00:00.000Z');
  });

  it('default capture policy does not allow full raw payload storage', () => {
    const policy = createDefaultCapturePolicy();

    expect(policy.mode).toBe('standard');
    expect(policy.storeFullRawPayloads).toBe(false);
    expect(policy.storeSecrets).toBe(false);
    expect(policy.storeApiKeys).toBe(false);
    expect(policy.storeFullToolResults).toBe(false);
    expect(isRawPayloadCaptureEnabled(policy)).toBe(false);
  });

  it('standard mode stores metadata, metrics, routing, transformations, and excerpts', () => {
    const policy = createDefaultCapturePolicy('standard');

    expect(policy.storeTraceMetadata).toBe(true);
    expect(policy.storeTimelineEventMetadata).toBe(true);
    expect(policy.storeTokenMetrics).toBe(true);
    expect(policy.storeRoutingDecisions).toBe(true);
    expect(policy.storeTransformationSummaries).toBe(true);
    expect(policy.storeShortRedactedExcerpts).toBe(true);
  });

  it('debug capture policy can allow full raw payload storage', () => {
    const policy = createDefaultCapturePolicy('debug');

    expect(policy.mode).toBe('debug');
    expect(policy.storeFullRawPayloads).toBe(true);
    expect(policy.storeFullToolResults).toBe(true);
    expect(isRawPayloadCaptureEnabled(policy)).toBe(true);
  });

  it('minimal mode stores less than standard mode', () => {
    const policy = createDefaultCapturePolicy('minimal');

    expect(policy.storeTraceMetadata).toBe(true);
    expect(policy.storeTimelineEventMetadata).toBe(true);
    expect(policy.storeTokenMetrics).toBe(true);
    expect(policy.storeRoutingDecisions).toBe(false);
    expect(policy.storeShortRedactedExcerpts).toBe(false);
    expect(policy.storeFullRawPayloads).toBe(false);
  });

  it('serializes trace events', () => {
    const event = createTraceEvent({
      traceId: 'trace-1',
      type: 'transformation',
      contentPhase: 'transformed',
      transformationSummary: 'collapsed repeated logs',
    });

    const json = JSON.stringify(event);
    const parsed = JSON.parse(json) as TraceEvent;

    expect(parsed.type).toBe('transformation');
    expect(parsed.contentPhase).toBe('transformed');
    expect(parsed.transformationSummary).toBe('collapsed repeated logs');
  });
});

describe('smell and recommendation optional fields', () => {
  it('serializes a ContextSmell with optional live-mode fields', () => {
    const smell: ContextSmell = {
      id: 'test-smell',
      title: 'Test smell',
      severity: 'info',
      whatHappened: 'something happened',
      whyItMatters: 'it matters',
      evidenceSummary: 'evidence',
      recommendation: 'do something',
      suggestedNextSteps: ['inspect'],
      estimatedTokensInvolved: 10,
      relatedTurnIds: ['t1'],
      relatedBlockIds: ['b1'],
      isHeuristic: true,
      contentPhase: 'sent',
      traceEventIds: ['ev-1'],
      savingsOpportunity: {
        estimatedTokensSaveable: 100,
        confidence: 'medium',
        description: 'could save tokens',
      },
    };

    const json = JSON.stringify(smell);
    const parsed = JSON.parse(json) as ContextSmell;

    expect(parsed.contentPhase).toBe('sent');
    expect(parsed.traceEventIds).toEqual(['ev-1']);
    expect(parsed.savingsOpportunity?.estimatedTokensSaveable).toBe(100);
  });

  it('serializes a Recommendation with optional live-mode fields', () => {
    const rec: Recommendation = {
      id: 'test-rec',
      title: 'Test rec',
      description: 'description',
      whyItMatters: 'why',
      inspectSuggestion: 'inspect',
      trySuggestion: 'try',
      smellIds: ['test-smell'],
      potentialSavings: 50,
      automationStatus: 'preview',
      traceEventIds: ['ev-2'],
    };

    const json = JSON.stringify(rec);
    const parsed = JSON.parse(json) as Recommendation;

    expect(parsed.potentialSavings).toBe(50);
    expect(parsed.automationStatus).toBe('preview');
    expect(parsed.traceEventIds).toEqual(['ev-2']);
  });
});
