import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validatePort } from './cli.js';
import { unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

describe('trace list command integration', () => {
  const dbDir = join(tmpdir(), `signalglass-test-${Date.now()}`);
  const dbPath = join(dbDir, 'test.db');

  beforeEach(() => {
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    // Clean up any previous test database
    if (existsSync(dbPath)) {
      try { unlinkSync(dbPath); } catch { /* ignore */ }
    }
  });

  afterEach(() => {
    // Clean up test database
    if (existsSync(dbPath)) {
      try { unlinkSync(dbPath); } catch { /* ignore */ }
    }
    if (existsSync(dbDir)) {
      try { unlinkSync(dbDir); } catch { /* ignore */ }
    }
  });

  it('creates a storage instance without error', () => {
    // Just verify we can construct without error
    const { TraceStorage } = require('@signalglass/storage');
    const storage = new TraceStorage({ databasePath: dbPath });
    expect(storage).toBeDefined();
    storage.close();
  });

  it('lists traces from an empty storage', () => {
    // Verify list works on empty storage
    const { TraceStorage } = require('@signalglass/storage');
    const storage = new TraceStorage({ databasePath: dbPath });
    const traces = storage.listTraces();
    expect(Array.isArray(traces)).toBe(true);
    expect(traces.length).toBe(0);
    storage.close();
  });
});
