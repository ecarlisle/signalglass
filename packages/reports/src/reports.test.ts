import { describe, it, expect } from 'vitest';
import { analyzeRun } from '@signalglass/core';
import {
  renderTerminal,
  renderJson,
  renderHtml,
  renderTraceTerminal,
  renderTraceJson,
  renderTraceHtml,
  renderTraceListSummary,
  renderTraceListJson,
} from './index.js';
import type { AgentRun, Trace, PayloadReference } from '@signalglass/core';

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

const sampleTrace: Trace = {
  id: 'trace-abc-123',
  startedAt: '2025-01-01T00:00:00.000Z',
  endedAt: '2025-01-01T00:01:00.000Z',
  provider: 'openai',
  model: 'gpt-4',
  agent: 'my-agent',
  task: 'test task',
  mode: 'standard',
  capturePolicy: {
    mode: 'standard',
    storeTraceMetadata: true,
    storeTimelineEventMetadata: true,
    storeTokenMetrics: true,
    storeRoutingDecisions: true,
    storeTransformationSummaries: true,
    storeShortRedactedExcerpts: true,
    storeFullRawPayloads: false,
    storeSecrets: false,
    storeApiKeys: false,
    storeFullToolResults: false,
    redaction: { maxExcerptLength: 240, secretPatterns: [], stripHeaders: ['authorization', 'x-api-key'] },
  },
  status: 'success',
  events: [
    {
      id: 'evt-1',
      traceId: 'trace-abc-123',
      timestamp: '2025-01-01T00:00:00.000Z',
      type: 'message',
      contentPhase: 'said',
      sourceType: 'user_message',
      tokens: 10,
    },
    {
      id: 'evt-2',
      traceId: 'trace-abc-123',
      timestamp: '2025-01-01T00:00:01.000Z',
      type: 'provider_request',
      contentPhase: 'sent',
      routingDecision: 'openai:gpt-4',
      tokens: 10,
    },
    {
      id: 'evt-3',
      traceId: 'trace-abc-123',
      timestamp: '2025-01-01T00:00:02.000Z',
      type: 'inference',
      tokens: 50,
    },
    {
      id: 'evt-4',
      traceId: 'trace-abc-123',
      timestamp: '2025-01-01T00:00:03.000Z',
      type: 'message',
      contentPhase: 'generated',
      sourceType: 'assistant_message',
      tokens: 25,
    },
    {
      id: 'evt-5',
      traceId: 'trace-abc-123',
      timestamp: '2025-01-01T00:00:04.000Z',
      type: 'egress_response',
      contentPhase: 'returned',
      transformationSummary: 'response trimmed to 2000 chars',
    },
  ],
};

function makePayloadRef(overrides: Partial<PayloadReference> = {}): PayloadReference {
  return {
    id: 'payload-1',
    storageKey: 'secret-storage-location',
    redacted: true,
    excerpt: 'Hello, this is a redacted excerpt of content that was stored.',
    ...overrides,
  };
}

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

describe('trace report formatters', () => {
  it('renders a terminal trace report with key metadata', () => {
    const output = renderTraceTerminal(sampleTrace);
    expect(output).toContain(sampleTrace.id);
    expect(output).toContain(sampleTrace.status);
    expect(output).toContain(sampleTrace.provider!);
    expect(output).toContain(sampleTrace.model!);
    expect(output).toContain(sampleTrace.startedAt);
    expect(output).toContain(sampleTrace.endedAt!);
    expect(output).toContain(String(sampleTrace.events.length));
    expect(output).toContain('Events by type');
    expect(output).toContain('Events by content phase');
    expect(output).toContain('Token counts are approximate estimates');
    expect(output).toContain('Full raw payloads are not included in this report');
  });

  it('renders a terminal trace report with routing decisions and transformations', () => {
    const output = renderTraceTerminal(sampleTrace);
    expect(output).toContain('Routing decisions');
    expect(output).toContain('Transformation summaries');
    expect(output).toContain('openai:gpt-4');
    expect(output).toContain('response trimmed to 2000 chars');
  });

  it('renders a JSON trace report with expected structured fields', () => {
    const output = renderTraceJson(sampleTrace);
    const parsed = JSON.parse(output);
    expect(parsed.reportType).toBe('trace');
    expect(parsed.trace.id).toBe(sampleTrace.id);
    expect(parsed.trace.status).toBe(sampleTrace.status);
    expect(parsed.trace.provider).toBe(sampleTrace.provider);
    expect(parsed.trace.model).toBe(sampleTrace.model);
    expect(parsed.trace.eventCount).toBe(sampleTrace.events.length);
    expect(Array.isArray(parsed.eventTypeBreakdown)).toBe(true);
    expect(Array.isArray(parsed.contentPhaseBreakdown)).toBe(true);
  });

  it('renders JSON trace report with token metrics', () => {
    const output = renderTraceJson(sampleTrace);
    const parsed = JSON.parse(output);
    expect(parsed.tokenMetrics.approximate).toBe(true);
    expect(typeof parsed.tokenMetrics.totalInputTokens).toBe('number');
    expect(typeof parsed.tokenMetrics.inferenceTokens).toBe('number');
  });

  it('renders an HTML trace report', () => {
    const output = renderTraceHtml(sampleTrace);
    expect(output).toContain('<html');
    expect(output).toContain(sampleTrace.id);
    expect(output).toContain(sampleTrace.status);
    expect(output).toContain('Token counts are approximate estimates');
  });

  it('does not include full raw payloads in any report format', () => {
    const terminal = renderTraceTerminal(sampleTrace);
    // The report should state that raw payloads are not included
    expect(terminal).toContain('not included in this report');

    const json = renderTraceJson(sampleTrace);
    const parsed = JSON.parse(json);
    expect(parsed.trace).not.toHaveProperty('fullRawPayloads');

    const html = renderTraceHtml(sampleTrace);
    expect(html).not.toContain('storeFullRawPayloads');
  });

  it('does not include API keys or Authorization headers in reports', () => {
    const traceWithSensitiveMeta: Trace = {
      ...sampleTrace,
      metadata: {
        'Authorization': 'Bearer sk-test123',
        'x-api-key': 'test-api-key-456',
        safeKey: 'safe-value',
      },
    };
    const terminal = renderTraceTerminal(traceWithSensitiveMeta);
    expect(terminal).not.toContain('sk-test123');
    expect(terminal).not.toContain('test-api-key-456');
    // But safe metadata might still be visible
    expect(terminal).not.toContain('safe-value'); // safe not shown in terminal

    const json = renderTraceJson(traceWithSensitiveMeta);
    const parsed = JSON.parse(json);
    // trace.metadata is not included in the JSON report output (we only surface safe trace fields)
    expect(parsed.trace).not.toHaveProperty('Authorization');
    expect(parsed.trace).not.toHaveProperty('x-api-key');
  });

  it('does not expose storageKey in standard mode reports', () => {
    const traceWithPayload: Trace = {
      ...sampleTrace,
      events: [
        ...sampleTrace.events,
        {
          id: 'evt-6',
          traceId: 'trace-abc-123',
          timestamp: '2025-01-01T00:00:05.000Z',
          type: 'message',
          contentPhase: 'observed',
          sourceType: 'tool_output',
          payloadRef: makePayloadRef({ redacted: true, storageKey: 'secret-storage-location' }),
        },
      ],
    };

    const terminal = renderTraceTerminal(traceWithPayload);
    expect(terminal).not.toContain('secret-storage-location');

    const json = renderTraceJson(traceWithPayload);
    const parsed = JSON.parse(json);
    expect(JSON.stringify(parsed)).not.toContain('secret-storage-location');
    expect(JSON.stringify(parsed)).not.toContain('storageKey');
  });

  it('includes redacted excerpts only when present in trace data', () => {
    const traceWithoutExcerpts: Trace = {
      ...sampleTrace,
      events: sampleTrace.events.filter((e) => e.id !== 'evt-5'),
    };
    const terminalWithout = renderTraceTerminal(traceWithoutExcerpts);
    expect(terminalWithout).not.toContain('Content excerpts');

    const traceWithExcerpts: Trace = {
      ...sampleTrace,
      events: [
        ...sampleTrace.events,
        {
          id: 'evt-6',
          traceId: 'trace-abc-123',
          timestamp: '2025-01-01T00:00:05.000Z',
          type: 'message',
          contentPhase: 'observed',
          sourceType: 'tool_output',
          payloadRef: makePayloadRef({ redacted: true }),
        },
      ],
    };

    const terminalWith = renderTraceTerminal(traceWithExcerpts);
    expect(terminalWith).toContain('Content excerpts');
    expect(terminalWith).toContain('Hello, this is a redacted excerpt');

    const jsonWith = renderTraceJson(traceWithExcerpts);
    const parsed = JSON.parse(jsonWith);
    expect(parsed.excerpts).toBeDefined();
    expect(parsed.excerpts.length).toBeGreaterThan(0);
    expect(parsed.excerpts[0].text).toContain('redacted excerpt');
  });

  it('omits excerpts when payloadRef is not redacted or absent', () => {
    const traceWithNonRedacted: Trace = {
      ...sampleTrace,
      events: [
        ...sampleTrace.events,
        {
          id: 'evt-7',
          traceId: 'trace-abc-123',
          timestamp: '2025-01-01T00:00:05.000Z',
          type: 'message',
          contentPhase: 'observed',
          sourceType: 'tool_output',
          payloadRef: makePayloadRef({ redacted: false }),
        },
      ],
    };

    const terminal = renderTraceTerminal(traceWithNonRedacted);
    expect(terminal).not.toContain('Content excerpts');

    const json = renderTraceJson(traceWithNonRedacted);
    const parsed = JSON.parse(json);
    expect(parsed.excerpts).toBeUndefined();
  });
});

describe('trace list summary', () => {
  it('renders a summary of multiple traces without dumping event payloads', () => {
    const traces: Trace[] = [
      sampleTrace,
      {
        ...sampleTrace,
        id: 'trace-xyz-789',
        model: 'gpt-3.5-turbo',
        status: 'error',
        events: [{ id: 'e1', traceId: 'trace-xyz-789', timestamp: '2025-01-02T00:00:00.000Z', type: 'message' }],
      },
    ];

    const terminal = renderTraceListSummary(traces);
    expect(terminal).toContain('trace-abc-123');
    expect(terminal).toContain('trace-xyz-789');
    expect(terminal).toContain('gpt-3.5-turbo');
    expect(terminal).toContain('2'); // number of traces
    expect(terminal).not.toContain('Hello, this is a redacted excerpt'); // no payloads in list view

    const json = renderTraceListJson(traces);
    const parsed = JSON.parse(json);
    expect(parsed.length).toBe(2);
    expect(parsed[0].id).toBe('trace-abc-123');
    expect(parsed[1].id).toBe('trace-xyz-789');
    expect(parsed[0]).not.toHaveProperty('events');
    expect(parsed[1]).not.toHaveProperty('events');
  });

  it('returns an empty message for zero traces', () => {
    const output = renderTraceListSummary([]);
    expect(output).toContain('No traces found');
  });
});

describe('existing analyze reports still pass', () => {
  it('terminal report works unchanged', () => {
    const analysis = analyzeRun(sampleRun);
    const output = renderTerminal(analysis);
    expect(output).toContain('report test');
  });

  it('JSON report round-trips unchanged', () => {
    const analysis = analyzeRun(sampleRun);
    const output = renderJson(analysis);
    const parsed = JSON.parse(output);
    expect(parsed.runName).toBe('report test');
  });

  it('HTML report works unchanged', () => {
    const analysis = analyzeRun(sampleRun);
    const output = renderHtml(analysis);
    expect(output).toContain('<html');
  });
});
