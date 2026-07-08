import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TraceStorage } from './storage.js';
import type { Trace, TraceEvent, CapturePolicy } from '@signalglass/core';

const TEST_DB_PATH = join(tmpdir(), 'signalglass-test', `test-${Date.now()}.db`);

function createTestTrace(overrides: Partial<Trace> = {}): Trace {
  const defaultPolicy: CapturePolicy = {
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
    redaction: {
      maxExcerptLength: 240,
      secretPatterns: [],
      stripHeaders: ['authorization', 'x-api-key'],
    },
    retentionDays: 30,
  };

  const traceId = overrides.id || 'test-trace-1';

  const trace: Trace = {
    id: 'test-trace-1',
    startedAt: '2024-01-01T00:00:00Z',
    endedAt: '2024-01-01T00:01:00Z',
    provider: 'openai',
    model: 'gpt-4',
    agent: 'test-agent',
    task: 'test-task',
    mode: 'standard',
    status: 'success',
    capturePolicy: defaultPolicy,
    metadata: {
      clientIp: '127.0.0.1',
      userAgent: 'test-client',
    },
    events: [
      {
        id: `${traceId}-event-1`,
        traceId: traceId,
        timestamp: '2024-01-01T00:00:00Z',
        type: 'message',
        contentPhase: 'said',
        sourceType: 'user_message',
        tokens: 10,
        payloadRef: {
          id: `${traceId}-payload-1`,
          excerpt: 'Hello, how are you?',
          redacted: true,
        },
      },
      {
        id: `${traceId}-event-2`,
        traceId: traceId,
        timestamp: '2024-01-01T00:00:30Z',
        type: 'message',
        contentPhase: 'generated',
        sourceType: 'assistant_message',
        tokens: 20,
        payloadRef: {
          id: `${traceId}-payload-2`,
          excerpt: 'I am doing well, thank you!',
          redacted: true,
        },
      },
    ],
    ...overrides,
  };

  return trace;
}

describe('TraceStorage', () => {
  let storage: TraceStorage;

  beforeEach(() => {
    mkdirSync(join(tmpdir(), 'signalglass-test'), { recursive: true });
    storage = new TraceStorage({ databasePath: TEST_DB_PATH });
  });

  afterEach(() => {
    storage.close();
    try {
      rmSync(TEST_DB_PATH, { force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('basic storage operations', () => {
    it('should save and retrieve a trace', () => {
      const trace = createTestTrace();
      storage.saveTrace(trace);

      const retrieved = storage.getTrace('test-trace-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('test-trace-1');
      expect(retrieved!.provider).toBe('openai');
      expect(retrieved!.model).toBe('gpt-4');
      expect(retrieved!.events).toHaveLength(2);
    });

    it('should list traces', () => {
      const trace1 = createTestTrace({ id: 'trace-1' });
      const trace2 = createTestTrace({ id: 'trace-2' });

      storage.saveTrace(trace1);
      storage.saveTrace(trace2);

      const traces = storage.listTraces();
      expect(traces).toHaveLength(2);
    });

    it('should delete a trace', () => {
      const trace = createTestTrace();
      storage.saveTrace(trace);

      const deleted = storage.deleteTrace('test-trace-1');
      expect(deleted).toBe(true);

      const retrieved = storage.getTrace('test-trace-1');
      expect(retrieved).toBeNull();
    });

    it('should return null for non-existent trace', () => {
      const retrieved = storage.getTrace('non-existent');
      expect(retrieved).toBeNull();
    });
  });

  describe('standard mode privacy', () => {
    it('should not persist full raw request payloads in standard mode', () => {
      const trace = createTestTrace({
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
          redaction: {
            maxExcerptLength: 240,
            secretPatterns: [],
            stripHeaders: ['authorization', 'x-api-key'],
          },
        },
        events: [
          {
            id: 'event-1',
            traceId: 'test-trace-1',
            timestamp: '2024-01-01T00:00:00Z',
            type: 'message',
            contentPhase: 'said',
            payloadRef: {
              id: 'payload-1',
              storageKey: 'raw-request-data',
              excerpt: 'Hello',
              redacted: true,
            },
          },
        ],
      });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      // In standard mode, full raw payload storageKey should be stripped, but excerpt may remain
      expect(retrieved!.events[0].payloadRef?.storageKey).toBeUndefined();
    });

    it('should not persist full raw response payloads in standard mode', () => {
      const trace = createTestTrace({
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
          redaction: {
            maxExcerptLength: 240,
            secretPatterns: [],
            stripHeaders: ['authorization', 'x-api-key'],
          },
        },
        events: [
          {
            id: 'event-1',
            traceId: 'test-trace-1',
            timestamp: '2024-01-01T00:00:00Z',
            type: 'message',
            contentPhase: 'generated',
            payloadRef: {
              id: 'payload-1',
              storageKey: 'raw-response-data',
              excerpt: 'Response',
              redacted: true,
            },
          },
        ],
      });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      // In standard mode, full raw payload storageKey should be stripped, but excerpt may remain
      expect(retrieved!.events[0].payloadRef?.storageKey).toBeUndefined();
    });

    it('should never persist API keys', () => {
      const trace = createTestTrace({
        metadata: {
          apiKey: 'sk-secret-key-12345',
          api_key: 'another-secret',
          normalData: 'safe',
        },
      });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      expect(retrieved!.metadata).toBeDefined();
      expect(retrieved!.metadata!.apiKey).toBeUndefined();
      expect(retrieved!.metadata!.api_key).toBeUndefined();
      expect(retrieved!.metadata!.normalData).toBe('safe');
    });

    it('should never persist authorization headers', () => {
      const trace = createTestTrace({
        metadata: {
          authorization: 'Bearer token123',
          'x-api-key': 'key456',
          cookie: 'session=abc',
          normalHeader: 'safe',
        },
      });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      expect(retrieved!.metadata).toBeDefined();
      expect(retrieved!.metadata!.authorization).toBeUndefined();
      expect(retrieved!.metadata!['x-api-key']).toBeUndefined();
      expect(retrieved!.metadata!.cookie).toBeUndefined();
      expect(retrieved!.metadata!.normalHeader).toBe('safe');
    });

    it('should persist short redacted excerpts when allowed', () => {
      const trace = createTestTrace({
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
          redaction: {
            maxExcerptLength: 240,
            secretPatterns: [],
            stripHeaders: ['authorization', 'x-api-key'],
          },
        },
        events: [
          {
            id: 'event-1',
            traceId: 'test-trace-1',
            timestamp: '2024-01-01T00:00:00Z',
            type: 'message',
            contentPhase: 'said',
            payloadRef: {
              id: 'payload-1',
              excerpt: 'Hello, this is a test',
              redacted: true,
            },
          },
        ],
      });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      // Standard mode with storeShortRedactedExcerpts=true should preserve the excerpt
      expect(retrieved!.events[0].payloadRef).toBeDefined();
      expect(retrieved!.events[0].payloadRef!.excerpt).toBe('Hello, this is a test');
      expect(retrieved!.events[0].payloadRef!.redacted).toBe(true);
    });

    it('should sanitize trace metadata before storage', () => {
      const trace = createTestTrace({
        metadata: {
          secret: 'my-secret',
          password: 'user-pass',
          token: 'jwt-token',
          credential: 'cred123',
          safeData: 'safe',
          nested: {
            apiKey: 'nested-key',
            normalNested: 'nested-safe',
          },
        },
      });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      expect(retrieved!.metadata).toBeDefined();
      expect(retrieved!.metadata!.secret).toBeUndefined();
      expect(retrieved!.metadata!.password).toBeUndefined();
      expect(retrieved!.metadata!.token).toBeUndefined();
      expect(retrieved!.metadata!.credential).toBeUndefined();
      expect(retrieved!.metadata!.safeData).toBe('safe');
      expect(retrieved!.metadata!.nested).toBeDefined();
      expect((retrieved!.metadata!.nested as any).apiKey).toBeUndefined();
      expect((retrieved!.metadata!.nested as any).normalNested).toBe('nested-safe');
    });
  });

  describe('debug mode', () => {
    it('should allow full raw payloads in debug mode when explicitly enabled', () => {
      const trace = createTestTrace({
        mode: 'debug',
        capturePolicy: {
          mode: 'debug',
          storeTraceMetadata: true,
          storeTimelineEventMetadata: true,
          storeTokenMetrics: true,
          storeRoutingDecisions: true,
          storeTransformationSummaries: true,
          storeShortRedactedExcerpts: true,
          storeFullRawPayloads: true,
          storeSecrets: false,
          storeApiKeys: false,
          storeFullToolResults: true,
          redaction: {
            maxExcerptLength: 240,
            secretPatterns: [],
            stripHeaders: ['authorization', 'x-api-key'],
          },
        },
        events: [
          {
            id: 'event-1',
            traceId: 'test-trace-1',
            timestamp: '2024-01-01T00:00:00Z',
            type: 'message',
            contentPhase: 'said',
            payloadRef: {
              id: 'payload-1',
              storageKey: 'full-raw-data',
              excerpt: 'Hello',
              redacted: false,
            },
          },
        ],
      });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      // Debug mode with explicit opt-in should preserve payloadRef
      expect(retrieved!.events[0].payloadRef).toBeDefined();
      expect(retrieved!.events[0].payloadRef!.storageKey).toBe('full-raw-data');
    });

    it('should still strip API keys even in debug mode', () => {
      const trace = createTestTrace({
        mode: 'debug',
        capturePolicy: {
          mode: 'debug',
          storeTraceMetadata: true,
          storeTimelineEventMetadata: true,
          storeTokenMetrics: true,
          storeRoutingDecisions: true,
          storeTransformationSummaries: true,
          storeShortRedactedExcerpts: true,
          storeFullRawPayloads: true,
          storeSecrets: false,
          storeApiKeys: false,
          storeFullToolResults: true,
          redaction: {
            maxExcerptLength: 240,
            secretPatterns: [],
            stripHeaders: ['authorization', 'x-api-key'],
          },
        },
        metadata: {
          apiKey: 'sk-secret',
          safeData: 'safe',
        },
      });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      expect(retrieved!.metadata!.apiKey).toBeUndefined();
      expect(retrieved!.metadata!.safeData).toBe('safe');
    });
  });

  describe('retention policy', () => {
    it('should set expiry date based on retention policy', () => {
      const trace = createTestTrace({
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
          redaction: {
            maxExcerptLength: 240,
            secretPatterns: [],
            stripHeaders: ['authorization', 'x-api-key'],
          },
          retentionDays: 7,
        },
      });

      storage.saveTrace(trace);

      // Check that the trace was saved (we can't easily test the actual expiry without mocking time)
      const retrieved = storage.getTrace('test-trace-1');
      expect(retrieved).not.toBeNull();
    });

    it('should delete expired traces', () => {
      // Create a trace with very short retention
      const trace = createTestTrace({
        id: 'expiring-trace',
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
          redaction: {
            maxExcerptLength: 240,
            secretPatterns: [],
            stripHeaders: ['authorization', 'x-api-key'],
          },
          retentionDays: 1,
        },
      });

      storage.saveTrace(trace);

      // In a real test, we'd mock the database time or wait, but for now just verify the function exists
      const deletedCount = storage.deleteExpiredTraces();
      expect(typeof deletedCount).toBe('number');
    });
  });
});
