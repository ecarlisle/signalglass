import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validatePort, tracesCommand } from './cli.js';
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

  let storage: TraceStorage;

  function createSeededStorage(): TraceStorage {
    const s = new TraceStorage({ databasePath: dbPath });
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
    s.saveTrace(trace);
    return s;
  }

  beforeEach(() => {
    if (existsSync(dbDir)) {
      rmSync(dbDir, { recursive: true, force: true });
    }
    mkdirSync(dbDir, { recursive: true });
  });

  afterEach(() => {
    if (storage) {
      storage.close();
    }
    if (existsSync(dbDir)) {
      rmSync(dbDir, { recursive: true, force: true });
    }
  });

  it('lists traces from an empty storage', () => {
    const s = new TraceStorage({ databasePath: dbPath });
    const traces = s.listTraces();
    expect(Array.isArray(traces)).toBe(true);
    expect(traces.length).toBe(0);
    s.close();
  });

  it('shows a trace by id from seeded storage', () => {
    const s = createSeededStorage();
    const trace = s.getTrace('trace-seeded-1');
    expect(trace).not.toBeNull();
    expect(trace!.id).toBe('trace-seeded-1');
    expect(trace!.provider).toBe('openai');
    expect(trace!.model).toBe('gpt-4');
    expect(trace!.status).toBe('success');
    expect(trace!.events.length).toBe(1);
    s.close();
  });

  it('returns null for a non-existent trace id', () => {
    const s = createSeededStorage();
    const trace = s.getTrace('nonexistent-trace');
    expect(trace).toBeNull();
    s.close();
  });

  it('TraceStorage creates parent directories for new paths', () => {
    const nestedPath = join(dbDir, 'nested', 'deep', 'test.db');
    expect(existsSync(nestedPath)).toBe(false);
    let nestedStorage: TraceStorage | undefined;
    expect(() => {
      nestedStorage = new TraceStorage({ databasePath: nestedPath });
    }).not.toThrow();
    nestedStorage?.close();
  });

  it('list and show from seeded storage return consistent results', () => {
    const s = createSeededStorage();
    const traces = s.listTraces();
    expect(traces.length).toBe(1);
    expect(traces[0].id).toBe('trace-seeded-1');
    const trace = s.getTrace('trace-seeded-1');
    expect(trace).not.toBeNull();
    expect(trace!.events.length).toBe(1);
    s.close();
  });

  it('tracesCommand list returns terminal output containing trace id', () => {
    storage = createSeededStorage();
    storage.close();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    tracesCommand(['--storage', dbPath, 'list']);
    expect(logSpy.mock.calls.join('\n')).toContain('trace-seeded-1');
    logSpy.mockRestore();
  });

  it('tracesCommand list --report json returns JSON output', () => {
    storage = createSeededStorage();
    storage.close();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    tracesCommand(['--storage', dbPath, 'list', '--report', 'json']);
    expect(logSpy.mock.calls.join('\n')).toContain('trace-seeded-1');
    expect(logSpy.mock.calls.join('\n')).toContain('"approximate"');
    logSpy.mockRestore();
  });

  it('tracesCommand show returns terminal output containing trace id', () => {
    storage = createSeededStorage();
    storage.close();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    tracesCommand(['--storage', dbPath, 'show', 'trace-seeded-1']);
    expect(logSpy.mock.calls.join('\n')).toContain('trace-seeded-1');
    expect(logSpy.mock.calls.join('\n')).toContain('SignalGlass trace report');
    logSpy.mockRestore();
  });

  it('tracesCommand show --report json returns JSON output', () => {
    storage = createSeededStorage();
    storage.close();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    tracesCommand(['--storage', dbPath, 'show', 'trace-seeded-1', '--report', 'json']);
    expect(logSpy.mock.calls.join('\n')).toContain('trace-seeded-1');
    expect(logSpy.mock.calls.join('\n')).toContain('"reportType": "trace"');
    logSpy.mockRestore();
  });

  it('tracesCommand show --report html returns HTML output', () => {
    storage = createSeededStorage();
    storage.close();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    tracesCommand(['--storage', dbPath, 'show', 'trace-seeded-1', '--report', 'html']);
    expect(logSpy.mock.calls.join('\n')).toContain('trace-seeded-1');
    expect(logSpy.mock.calls.join('\n')).toContain('<!DOCTYPE html>');
    logSpy.mockRestore();
  });

  describe('tracesCommand error paths', () => {
    let exitSpy: any;
    let errorSpy: any;

    beforeEach(() => {
      exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('tracesCommand show with missing trace id prints error and exits', () => {
      const s = createSeededStorage();
      s.close();
      tracesCommand(['--storage', dbPath, 'show']);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith('Error: missing trace-id argument');
    });

    it('tracesCommand list from non-existent storage prints error and exits', () => {
      const fakePath = join(dbDir, 'nope', 'no.db');
      tracesCommand(['--storage', fakePath, 'list']);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('storage database not found'));
    });

    it('tracesCommand with unknown subcommand prints usage and exits', () => {
      const s = createSeededStorage();
      s.close();
      tracesCommand(['--storage', dbPath, 'blah']);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith('Unknown trace subcommand: blah');
    });

    it('tracesCommand show with unknown --report prints error and exits', () => {
      const s = createSeededStorage();
      s.close();
      tracesCommand(['--storage', dbPath, 'show', 'trace-seeded-1', '--report', 'pdf']);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith('Unknown report type: pdf');
    });

    it('tracesCommand list with unknown --report prints error and exits', () => {
      const s = createSeededStorage();
      s.close();
      tracesCommand(['--storage', dbPath, 'list', '--report', 'xml']);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith('Unknown report type: xml');
    });

    it('tracesCommand with missing --storage prints error and exits', () => {
      tracesCommand(['list']);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith('Error: --storage <path> is required for trace commands');
    });

    it('tracesCommand without subcommand prints error and exits', () => {
      const s = new TraceStorage({ databasePath: dbPath });
      s.close();
      tracesCommand(['--storage', dbPath]);
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith('Error: missing trace subcommand (list|show)');
    });
  });

  it('tracesCommand show with --output to file', () => {
    storage = createSeededStorage();
    storage.close();
    const outFile = join(dbDir, 'out.txt');
    expect(() => {
      tracesCommand(['--storage', dbPath, 'show', 'trace-seeded-1', '--output', outFile]);
    }).not.toThrow();
    expect(existsSync(outFile)).toBe(true);
  });

  it('tracesCommand list with --output to file', () => {
    storage = createSeededStorage();
    storage.close();
    const outFile = join(dbDir, 'out-list.txt');
    expect(() => {
      tracesCommand(['--storage', dbPath, 'list', '--output', outFile]);
    }).not.toThrow();
    expect(existsSync(outFile)).toBe(true);
  });
});
