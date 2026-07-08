import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validatePort } from './cli.js';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TraceStorage } from '@signalglass/storage';
import type { Trace } from '@signalglass/core';

describe('validatePort', () => {
  it('accepts a valid port', () => {
    expect(validatePort('8080')).toBe(8080);
    expect(validatePort('1')).toBe(1);
    expect(validatePort('65535')).toBe(65535);
  });

  it('rejects non-numeric ports', () => {
    expect(() => validatePort('123abc')).toThrow('Invalid port');
    expect(() => validatePort('abc')).toThrow('Invalid port');
    expect(() => validatePort('')).toThrow('Invalid port');
  });

  it('rejects out-of-range ports', () => {
    expect(() => validatePort('0')).toThrow('Port must be an integer between 1 and 65535');
    expect(() => validatePort('65536')).toThrow('Port must be an integer between 1 and 65535');
  });

  it('rejects partial numeric ports', () => {
    expect(() => validatePort('12.34')).toThrow('Invalid port');
    expect(() => validatePort(' 123 ')).toThrow('Invalid port');
  });
});

describe('trace command integration', () => {
  const dbDir = join(tmpdir(), `signalglass-test-${Date.now()}`);
  const dbPath = join(dbDir, 'test.db');

  function createSeededStorage(): TraceStorage {
    const storage = new TraceStorage({ databasePath: dbPath });
    const trace: Trace = {
      id: 'trace-seeded-1',
      startedAt: '2025-01-01T00:00:00.000Z',
      endedAt: '2025-01-01T00:01:00.000Z',
      provider: 'openai',
      model: 'gpt-4',
      agent: 'test-agent',
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
          id: 'e1',
          traceId: 'trace-seeded-1',
          timestamp: '2025-01-01T00:00:00.000Z',
          type: 'message',
          contentPhase: 'said',
          tokens: 10,
        },
      ],
    };
    storage.saveTrace(trace);
    return storage;
  }

  beforeEach(() => {
    if (existsSync(dbDir)) {
      rmSync(dbDir, { recursive: true, force: true });
    }
    mkdirSync(dbDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(dbDir)) {
      rmSync(dbDir, { recursive: true, force: true });
    }
  });

  it('lists traces from an empty storage', () => {
    const storage = new TraceStorage({ databasePath: dbPath });
    const traces = storage.listTraces();
    expect(Array.isArray(traces)).toBe(true);
    expect(traces.length).toBe(0);
    storage.close();
  });

  it('shows a trace by id from seeded storage', () => {
    const storage = createSeededStorage();
    const trace = storage.getTrace('trace-seeded-1');
    expect(trace).not.toBeNull();
    expect(trace!.id).toBe('trace-seeded-1');
    expect(trace!.provider).toBe('openai');
    expect(trace!.model).toBe('gpt-4');
    expect(trace!.status).toBe('success');
    expect(trace!.events.length).toBe(1);
    storage.close();
  });

  it('returns null for a non-existent trace id', () => {
    const storage = createSeededStorage();
    const trace = storage.getTrace('nonexistent-trace');
    expect(trace).toBeNull();
    storage.close();
  });

  it('TraceStorage creates parent directories for new paths', () => {
    const nestedPath = join(dbDir, 'nested', 'deep', 'test.db');
    expect(existsSync(nestedPath)).toBe(false);
    // TraceStorage creates the directory tree, not the file itself
    expect(() => new TraceStorage({ databasePath: nestedPath })).not.toThrow();
    // Cleanup
    if (existsSync(dbDir)) {
      rmSync(dbDir, { recursive: true, force: true });
    }
  });

  it('list and show from seeded storage return consistent results', () => {
    const storage = createSeededStorage();
    const traces = storage.listTraces();
    expect(traces.length).toBe(1);
    expect(traces[0].id).toBe('trace-seeded-1');
    const trace = storage.getTrace('trace-seeded-1');
    expect(trace).not.toBeNull();
    expect(trace!.events.length).toBe(1);
    storage.close();
  });
});
