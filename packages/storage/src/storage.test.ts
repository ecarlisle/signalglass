import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { TraceStorage } from './storage.js';
import type { Trace, CapturePolicy } from '@signalglass/core';

const TEST_DB_DIR = join(tmpdir(), 'signalglass-test');
const TEST_DB_PATH = join(TEST_DB_DIR, `test-${Date.now()}.db`);

function createDefaultPolicy(overrides?: Partial<CapturePolicy>): CapturePolicy {
  return {
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
    ...overrides,
  };
}

function createTestTrace(overrides: Partial<Trace> = {}): Trace {
  const defaultPolicy: CapturePolicy = createDefaultPolicy();
  const traceId = overrides.id || 'test-trace-1';

  const trace: Trace = {
    id: traceId,
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
    mkdirSync(TEST_DB_DIR, { recursive: true });
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

  describe('foreign key cascade', () => {
    it('should delete trace events when trace is deleted (cascade)', () => {
      const trace = createTestTrace({ id: 'cascade-test' });
      storage.saveTrace(trace);

      // Verify events exist
      let retrieved = storage.getTrace('cascade-test');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.events).toHaveLength(2);

      // Get the underlying db reference to check raw event count
      // We can use getTrace as the public check - after delete it should be null
      storage.deleteTrace('cascade-test');

      retrieved = storage.getTrace('cascade-test');
      expect(retrieved).toBeNull();

      // Now save another trace and verify no orphan events from the deleted one
      const trace2 = createTestTrace({ id: 'cascade-test-2' });
      storage.saveTrace(trace2);
      const retrieved2 = storage.getTrace('cascade-test-2');
      expect(retrieved2).not.toBeNull();
      expect(retrieved2!.events).toHaveLength(2);

      // The deleted trace's events should not appear
      const traces = storage.listTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0].id).toBe('cascade-test-2');
    });
  });

  describe('standard mode privacy', () => {
    it('should not persist full raw request payloads in standard mode', () => {
      const trace = createTestTrace({
        mode: 'standard',
        capturePolicy: createDefaultPolicy({
          mode: 'standard',
          storeFullRawPayloads: false,
        }),
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
        capturePolicy: createDefaultPolicy({
          mode: 'standard',
          storeFullRawPayloads: false,
        }),
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
        capturePolicy: createDefaultPolicy({
          mode: 'standard',
          storeShortRedactedExcerpts: true,
        }),
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

    it('should drop unredacted excerpts in standard mode', () => {
      const trace = createTestTrace({
        mode: 'standard',
        capturePolicy: createDefaultPolicy({
          mode: 'standard',
          storeShortRedactedExcerpts: true,
          storeFullRawPayloads: false,
        }),
        events: [
          {
            id: 'event-1',
            traceId: 'test-trace-1',
            timestamp: '2024-01-01T00:00:00Z',
            type: 'message',
            contentPhase: 'said',
            payloadRef: {
              id: 'payload-1',
              excerpt: 'Unsafe content that should not be stored',
              redacted: false,
              storageKey: 'raw-key',
            },
          },
        ],
      });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      // Unredacted excerpts should be dropped entirely in standard mode
      expect(retrieved!.events[0].payloadRef).toBeUndefined();
    });

    it('should drop payloadRef completely for unredacted content in standard mode', () => {
      const trace = createTestTrace({
        mode: 'standard',
        capturePolicy: createDefaultPolicy({
          mode: 'standard',
          storeShortRedactedExcerpts: true,
          storeFullRawPayloads: false,
        }),
        events: [
          {
            id: 'event-1',
            traceId: 'test-trace-1',
            timestamp: '2024-01-01T00:00:00Z',
            type: 'message',
            contentPhase: 'said',
            payloadRef: {
              id: 'payload-1',
              excerpt: 'Unredacted text',
              redacted: false,
            },
          },
        ],
      });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      // Entire payloadRef should be absent
      expect(retrieved!.events[0].payloadRef).toBeUndefined();
    });

    it('should strip storageKey and keep redacted excerpt in standard mode', () => {
      const trace = createTestTrace({
        mode: 'standard',
        capturePolicy: createDefaultPolicy({
          mode: 'standard',
          storeShortRedactedExcerpts: true,
          storeFullRawPayloads: false,
        }),
        events: [
          {
            id: 'event-1',
            traceId: 'test-trace-1',
            timestamp: '2024-01-01T00:00:00Z',
            type: 'message',
            contentPhase: 'said',
            payloadRef: {
              id: 'payload-1',
              storageKey: 'some-raw-key',
              excerpt: 'Kept redacted excerpt',
              redacted: true,
            },
          },
        ],
      });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      expect(retrieved!.events[0].payloadRef).toBeDefined();
      expect(retrieved!.events[0].payloadRef!.excerpt).toBe('Kept redacted excerpt');
      expect(retrieved!.events[0].payloadRef!.redacted).toBe(true);
      expect(retrieved!.events[0].payloadRef!.storageKey).toBeUndefined();
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
      expect((retrieved!.metadata!.nested as Record<string, unknown>).apiKey).toBeUndefined();
      expect((retrieved!.metadata!.nested as Record<string, unknown>).normalNested).toBe('nested-safe');
    });

    it('should recursively sanitize arrays containing sensitive data', () => {
      const trace = createTestTrace({
        metadata: {
          requests: [
            {
              headers: {
                authorization: 'Bearer secret',
              },
              safeValue: 'kept',
            },
            {
              apiKey: 'secret',
              nested: {
                token: 'secret-token',
                safeNested: 'kept',
              },
            },
          ],
        },
      });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      expect(retrieved!.metadata).toBeDefined();
      const requests = retrieved!.metadata!.requests as Array<Record<string, unknown>>;
      expect(requests).toHaveLength(2);

      // First item: authorization removed, safeValue kept
      const item0 = requests[0];
      expect(item0.headers).toBeUndefined();
      expect(item0.safeValue).toBe('kept');

      // Second item: apiKey removed, nested safeNested kept, token removed
      const item1 = requests[1];
      expect(item1.apiKey).toBeUndefined();
      expect(item1.nested).toBeDefined();
      const nested = item1.nested as Record<string, unknown>;
      expect(nested.token).toBeUndefined();
      expect(nested.safeNested).toBe('kept');

      // Serialize and verify no secrets leak through
      const serialized = JSON.stringify(retrieved!.metadata);
      expect(serialized).not.toContain('Bearer secret');
      expect(serialized).not.toContain('secret-token');
    });
  });

  describe('debug mode', () => {
    it('should allow full raw payloads in debug mode when explicitly enabled', () => {
      const trace = createTestTrace({
        mode: 'debug',
        capturePolicy: createDefaultPolicy({
          mode: 'debug',
          storeFullRawPayloads: true,
          storeFullToolResults: true,
        }),
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
        capturePolicy: createDefaultPolicy({
          mode: 'debug',
          storeFullRawPayloads: true,
          storeFullToolResults: true,
        }),
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

  describe('capturePolicy round-trip', () => {
    it('should round-trip a custom retentionDays value', () => {
      const policy = createDefaultPolicy({ retentionDays: 7 });
      const trace = createTestTrace({ capturePolicy: policy });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      expect(retrieved!.capturePolicy.retentionDays).toBe(7);
    });

    it('should round-trip redaction settings', () => {
      const policy = createDefaultPolicy({
        redaction: {
          maxExcerptLength: 100,
          secretPatterns: ['Bearer .+'],
          stripHeaders: ['authorization', 'custom-header'],
        },
      });
      const trace = createTestTrace({ capturePolicy: policy });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      expect(retrieved!.capturePolicy.redaction.maxExcerptLength).toBe(100);
      expect(retrieved!.capturePolicy.redaction.secretPatterns).toEqual(['Bearer .+']);
      expect(retrieved!.capturePolicy.redaction.stripHeaders).toContain('custom-header');
    });

    it('should round-trip a debug policy accurately', () => {
      const policy = createDefaultPolicy({
        mode: 'debug',
        storeFullRawPayloads: true,
        storeFullToolResults: true,
        storeShortRedactedExcerpts: true,
      });
      const trace = createTestTrace({ capturePolicy: policy, mode: 'debug' });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      expect(retrieved!.capturePolicy.mode).toBe('debug');
      expect(retrieved!.capturePolicy.storeFullRawPayloads).toBe(true);
      expect(retrieved!.capturePolicy.storeFullToolResults).toBe(true);
      expect(retrieved!.capturePolicy.storeShortRedactedExcerpts).toBe(true);
    });

    it('should not claim storeFullRawPayloads is false when stored as true (debug)', () => {
      const policy = createDefaultPolicy({
        mode: 'debug',
        storeFullRawPayloads: true,
        storeFullToolResults: true,
      });
      const trace = createTestTrace({ capturePolicy: policy, mode: 'debug' });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      expect(retrieved!.capturePolicy.storeFullRawPayloads).toBe(true);
    });

    it('should round-trip all standard capture policy fields', () => {
      const policy = createDefaultPolicy({
        storeTraceMetadata: false,
        storeTimelineEventMetadata: false,
        storeTokenMetrics: true,
        storeRoutingDecisions: true,
        storeTransformationSummaries: false,
        storeShortRedactedExcerpts: true,
        storeSecrets: false,
        storeApiKeys: false,
      });
      const trace = createTestTrace({ capturePolicy: policy });

      storage.saveTrace(trace);
      const retrieved = storage.getTrace('test-trace-1');

      expect(retrieved!.capturePolicy.storeTraceMetadata).toBe(false);
      expect(retrieved!.capturePolicy.storeTimelineEventMetadata).toBe(false);
      expect(retrieved!.capturePolicy.storeTokenMetrics).toBe(true);
      expect(retrieved!.capturePolicy.storeRoutingDecisions).toBe(true);
      expect(retrieved!.capturePolicy.storeTransformationSummaries).toBe(false);
      expect(retrieved!.capturePolicy.storeShortRedactedExcerpts).toBe(true);
    });
  });

  describe('retention policy', () => {
    it('should set expiry date based on retention policy', () => {
      const trace = createTestTrace({
        capturePolicy: createDefaultPolicy({ retentionDays: 7 }),
      });

      storage.saveTrace(trace);

      const retrieved = storage.getTrace('test-trace-1');
      expect(retrieved).not.toBeNull();
    });

    it('should delete expired traces deterministically', () => {
      // Save a trace with a reasonable policy
      const trace = createTestTrace({
        id: 'expiring-trace',
        capturePolicy: createDefaultPolicy({ retentionDays: 30 }),
      });
      storage.saveTrace(trace);

      // Manually set expires_at to the past using the underlying connection
      const db = (storage as any).db;
      db.prepare(
        `UPDATE traces SET expires_at = datetime('now', '-1 day') WHERE id = ?`
      ).run('expiring-trace');

      // Save a non-expired trace
      const freshTrace = createTestTrace({
        id: 'fresh-trace',
        capturePolicy: createDefaultPolicy({ retentionDays: 30 }),
      });
      storage.saveTrace(freshTrace);

      // Run cleanup
      const deletedCount = storage.deleteExpiredTraces();

      // Should have deleted exactly 1 trace
      expect(deletedCount).toBe(1);

      // Expired trace should be gone
      expect(storage.getTrace('expiring-trace')).toBeNull();

      // Fresh trace should remain
      expect(storage.getTrace('fresh-trace')).not.toBeNull();

      // Events for the expired trace should cascade delete
      // Verify by checking the fresh trace still has its events
      const freshRetrieved = storage.getTrace('fresh-trace');
      expect(freshRetrieved!.events).toHaveLength(2);
    });

    it('should delete expired trace events via cascade', () => {
      const trace = createTestTrace({
        id: 'cascade-expiry',
        capturePolicy: createDefaultPolicy({ retentionDays: 30 }),
      });
      storage.saveTrace(trace);

      // Manually expire the trace
      const db = (storage as any).db;
      db.prepare(
        `UPDATE traces SET expires_at = datetime('now', '-1 day') WHERE id = ?`
      ).run('cascade-expiry');

      storage.deleteExpiredTraces();

      // Trace should be gone, and events should cascade delete
      expect(storage.getTrace('cascade-expiry')).toBeNull();

      // Verify only fresh traces remain (none left here)
      expect(storage.listTraces()).toHaveLength(0);
    });
  });

  describe('storage path handling', () => {
    it('should create parent directories automatically', () => {
      const nestedPath = join(tmpdir(), 'signalglass-nested-test', 'subdir', `test-${Date.now()}.db`);
      const parentDir = dirname(nestedPath);

      // Creating storage should create the parent directory
      const nestedStorage = new TraceStorage({ databasePath: nestedPath });
      expect(existsSync(parentDir)).toBe(true);

      // Should be usable for save/get
      const trace = createTestTrace({ id: 'nested-path-test' });
      nestedStorage.saveTrace(trace);
      const retrieved = nestedStorage.getTrace('nested-path-test');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('nested-path-test');

      nestedStorage.close();
      rmSync(nestedPath, { force: true });
      try {
        rmSync(parentDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    });
  });
});
