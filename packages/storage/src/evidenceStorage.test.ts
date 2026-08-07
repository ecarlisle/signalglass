/**
 * Spec 015 implementation tests for EvidenceStorage.
 *
 * Tests the append-only save/retrieve contract, mandatory safety gate,
 * metadata-safe reference policy, persistence-policy validation, read
 * integrity, WAL connection, and coexistence with legacy TraceStorage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  EvidenceStorage,
  createMetadataSafePolicy,
  isMetadataSafePolicy,
  StorageConfigError,
  StorageFormatError,
  type PersistencePolicy,
  type PersistencePolicyDecision,
  type SaveOutcome,
  type EvidenceStorageConfig,
} from './evidenceStorage.js';
import { TraceStorage } from './storage.js';
import {
  serializeEvidenceRecord,
  parseEvidenceRecord,
  normalizeEvidenceRecord,
  sha256Hex,
  utf8Encode,
  type EvidenceRecord,
  type EvidenceObservation,
  type CaptureBoundary,
  CONTROL_EVENT_KINDS,
} from '@signalglass/evidence';

const METADATA_SAFE = createMetadataSafePolicy();

const ALWAYS_ACCEPT: PersistencePolicy = {
  name: 'test.always-accept',
  version: '1.0.0',
  decide: () => ({ accept: true } as PersistencePolicyDecision),
};

const ALWAYS_REJECT: PersistencePolicy = {
  name: 'test.always-reject',
  version: '1.0.0',
  decide: () => ({ accept: false, code: 'rejected' } as PersistencePolicyDecision),
};

const captureBoundary: CaptureBoundary = {
  captureSurface: 'client_side',
  observationBoundary: 'application_constructed',
  declaredEventKinds: [
    'interaction_start',
    'interaction_end',
    'span_start',
    'span_end',
    'model_request',
    'model_response',
  ],
  declaredSurfaces: ['client_side'],
  missingRecord: null,
};

function makeObservation(obs: Partial<EvidenceObservation> & { kind: EvidenceObservation['kind']; seq: number }): EvidenceObservation {
  const idBase = `${obs.kind}-${obs.seq ?? 0}`;
  const isControl = CONTROL_EVENT_KINDS.includes(obs.kind as (typeof CONTROL_EVENT_KINDS)[number]);
  return {
    observationId: `obs-${idBase}`,
    eventId: `evt-${idBase}`,
    traceId: 'trace-abc',
    spanId: null,
    capturedAt: '2026-08-12T12:00:00.000Z',
    evidenceStatus: 'captured',
    observationRole: isControl ? null : 'application_constructed',
    payload: null,
    rawCapturedAt: '2026-08-12T12:00:00.000Z',
    ...obs,
  } as EvidenceObservation;
}

function makeProofRecord(opts?: { traceId?: string; extra?: Partial<EvidenceRecord> }): EvidenceRecord {
  const traceId = opts?.traceId ?? 'trace-abc';
  const observations: EvidenceObservation[] = [
    makeObservation({ kind: 'interaction_start', seq: 0, traceId, payload: null }),
    makeObservation({
      kind: 'span_start',
      seq: 1,
      traceId,
      spanId: 'span-1',
      payload: { span: { kind: 'model', name: 'model:claude-sonnet-4', parentSpanId: null } },
    }),
    makeObservation({
      kind: 'model_request',
      seq: 2,
      traceId,
      spanId: 'span-1',
      observationRole: 'client_sent',
      evidenceStatus: 'redacted',
      payload: {
        requestEnvelope: {
          model: 'claude-sonnet-4',
          provider: 'anthropic',
          providerNativeFidelity: 'structurally_faithful',
        },
        contextContributions: [],
      },
    }),
    makeObservation({
      kind: 'model_response',
      seq: 3,
      traceId,
      spanId: 'span-1',
      observationRole: 'provider_reported',
      evidenceStatus: 'truncated',
      payload: {
        responseEnvelope: {
          providerNativeFidelity: 'structurally_faithful',
          finishReason: 'end_turn',
          usage: { inputTokens: 3, outputTokens: 1 },
        },
      },
    }),
    makeObservation({ kind: 'span_end', seq: 4, traceId, spanId: 'span-1', payload: { durationMs: 3000 } }),
    makeObservation({ kind: 'interaction_end', seq: 5, traceId, payload: null }),
  ];
  const parsed = normalizeEvidenceRecord(
    observations,
    captureBoundary,
    '1.0.0',
    { captureProfile: { name: 'dev-basic', version: '1.2.0' } },
  );
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => i.message).join('; '));
  return { ...parsed.record, ...opts?.extra };
}

function rebuildRecord(record: EvidenceRecord): EvidenceRecord {
  const parsed = normalizeEvidenceRecord(
    record.rawObservations,
    record.captureBoundary,
    record.evidenceSchemaVersion,
    { captureProfile: record.trace.captureProfile },
  );
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => i.message).join('; '));
  return parsed.record;
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'signalglass-storage-test-'));
}

function makeConfig(dir: string, overrides?: Partial<EvidenceStorageConfig>): EvidenceStorageConfig {
  return {
    databasePath: join(dir, 'test.db'),
    persistencePolicy: METADATA_SAFE,
    ...overrides,
  };
}

describe('EvidenceStorage construction', () => {
  it('requires a persistence policy', () => {
    expect(() => new EvidenceStorage({ databasePath: ':memory:' } as unknown as EvidenceStorageConfig)).toThrow(
      StorageConfigError,
    );
  });

  it('rejects an invalid policy name', () => {
    expect(
      () =>
        new EvidenceStorage({
          databasePath: ':memory:',
          persistencePolicy: { name: 'Bad Name', version: '1.0.0', decide: () => ({ accept: true }) },
        }),
    ).toThrow(StorageConfigError);
  });

  it('rejects a credential-like policy name', () => {
    expect(
      () =>
        new EvidenceStorage({
          databasePath: ':memory:',
          persistencePolicy: { name: 'sk-abc12345', version: '1.0.0', decide: () => ({ accept: true }) },
        }),
    ).toThrow(StorageConfigError);
  });

  it('rejects an invalid policy version', () => {
    expect(
      () =>
        new EvidenceStorage({
          databasePath: ':memory:',
          persistencePolicy: { name: 'test.policy', version: '1.0.0-beta', decide: () => ({ accept: true }) },
        }),
    ).toThrow(StorageConfigError);
  });

  it('rejects a plain object spoofing the reference policy name', () => {
    expect(
      () =>
        new EvidenceStorage({
          databasePath: ':memory:',
          persistencePolicy: {
            name: 'signalglass.persistence.metadata-safe',
            version: '1.0.0',
            decide: () => ({ accept: true }),
          },
        }),
    ).toThrow(StorageConfigError);
  });

  it('accepts the storage-shipped reference policy by identity', () => {
    const dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    expect(isMetadataSafePolicy(storage as unknown as PersistencePolicy)).toBe(false);
    expect(isMetadataSafePolicy(METADATA_SAFE)).toBe(true);
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('EvidenceStorage schema initialization', () => {
  it('creates canonical tables on a fresh database', () => {
    const dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const db = new Database(join(dir, 'test.db'));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'evidence_%'").all() as { name: string }[];
    expect(tables.map((t) => t.name).sort()).toEqual(['evidence_records', 'evidence_storage_meta']);
    const ledger = db.prepare('SELECT value FROM evidence_storage_meta WHERE key = ?').get('evidence_storage_format_version') as { value: string };
    expect(ledger.value).toBe('1.0.0');
    db.close();
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reopens a compatible database without mutation', () => {
    const dir = tempDir();
    const config = makeConfig(dir);
    const s1 = new EvidenceStorage(config);
    const record = makeProofRecord();
    s1.saveEvidenceRecord(record);
    s1.close();
    const s2 = new EvidenceStorage(config);
    const read = s2.getEvidenceRecord(record.trace.traceId);
    expect(read.ok).toBe(true);
    s2.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to open when canonical tables exist without a ledger', () => {
    const dir = tempDir();
    const db = new Database(join(dir, 'test.db'));
    db.exec('CREATE TABLE evidence_records (id TEXT PRIMARY KEY)');
    db.close();
    expect(() => new EvidenceStorage(makeConfig(dir))).toThrow(StorageFormatError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to open when the ledger names a higher format version', () => {
    const dir = tempDir();
    const db = new Database(join(dir, 'test.db'));
    db.exec('CREATE TABLE evidence_storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO evidence_storage_meta VALUES (?, ?)').run('evidence_storage_format_version', '9.0.0');
    db.close();
    expect(() => new EvidenceStorage(makeConfig(dir))).toThrow(StorageFormatError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to open when the ledger names a lower format version', () => {
    const dir = tempDir();
    const db = new Database(join(dir, 'test.db'));
    db.exec('CREATE TABLE evidence_storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO evidence_storage_meta VALUES (?, ?)').run('evidence_storage_format_version', '0.1.0');
    db.close();
    expect(() => new EvidenceStorage(makeConfig(dir))).toThrow(StorageFormatError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('leaves legacy tables untouched and coexists with TraceStorage', () => {
    const dir = tempDir();
    const traceStorage = new TraceStorage({ databasePath: join(dir, 'test.db') });
    traceStorage.saveTrace({
      id: 'legacy-1',
      startedAt: '2026-08-12T12:00:00.000Z',
      mode: 'standard',
      status: 'success',
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
        redaction: { maxExcerptLength: 240, secretPatterns: [], stripHeaders: [] },
      },
      events: [],
    });
    traceStorage.close();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);
    storage.close();
    const db = new Database(join(dir, 'test.db'));
    const legacy = db.prepare('SELECT id FROM traces').all() as { id: string }[];
    expect(legacy.map((r) => r.id)).toContain('legacy-1');
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('EvidenceStorage save and retrieve', () => {
  let dir: string;
  let storage: EvidenceStorage;

  beforeEach(() => {
    dir = tempDir();
    storage = new EvidenceStorage(makeConfig(dir));
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores a valid record and retrieves the serializer snapshot', () => {
    const record = makeProofRecord();
    const save = storage.saveEvidenceRecord(record);
    expect(save.status).toBe('stored');
    const parsedSnapshot = parseEvidenceRecord(JSON.parse(serializeEvidenceRecord(record)));
    expect(parsedSnapshot.ok).toBe(true);
    if (!parsedSnapshot.ok) return;
    const snapshot = parsedSnapshot.record;
    const read = storage.getEvidenceRecord(record.trace.traceId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.record).toEqual(snapshot);
  });

  it('preserves the exact serialized-record text', () => {
    const record = makeProofRecord();
    const expected = serializeEvidenceRecord(record);
    storage.saveEvidenceRecord(record);
    const db = new Database(join(dir, 'test.db'));
    const row = db.prepare('SELECT serialized_record FROM evidence_records WHERE evidence_identity = ?').get(record.trace.traceId) as { serialized_record: string };
    db.close();
    expect(row.serialized_record).toBe(expected);
  });

  it('returns already-present for a byte-identical repeat', () => {
    const record = makeProofRecord();
    const first = storage.saveEvidenceRecord(record);
    expect(first.status).toBe('stored');
    const second = storage.saveEvidenceRecord(record);
    expect(second.status).toBe('already-present');
    const db = new Database(join(dir, 'test.db'));
    const count = (db.prepare('SELECT COUNT(*) AS c FROM evidence_records').get() as { c: number }).c;
    db.close();
    expect(count).toBe(1);
  });

  it('returns conflict for same identity with different text', () => {
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);
    const modified = makeProofRecord({
      extra: {
        trace: {
          ...record.trace,
          captureProfile: { name: 'modified-profile', version: '1.0.0' },
        },
      },
    });
    const outcome = storage.saveEvidenceRecord(modified);
    expect(outcome.status).toBe('conflict');
    const read = storage.getEvidenceRecord(record.trace.traceId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.record.trace.captureProfile.name).toBe('dev-basic');
  });

  it('computes the digest over the exact UTF-8 bytes of the serializer output', () => {
    const record = makeProofRecord();
    const doc = serializeEvidenceRecord(record);
    const expected = sha256Hex(utf8Encode(doc));
    const save = storage.saveEvidenceRecord(record) as Extract<SaveOutcome, { status: 'stored' }>;
    expect(save.status).toBe('stored');
    expect(save.digest).toBe(expected);
  });

  it('returns not-found for an unknown identity', () => {
    const result = storage.getEvidenceRecord('nonexistent');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-found');
  });

  it('returns stored evidence with a manifest', () => {
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);
    const result = storage.getStoredEvidence(record.trace.traceId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.storageFormatVersion).toBe('1.0.0');
    expect(result.manifest.evidenceSchemaVersion).toBe('1.0.0');
    expect(result.manifest.persistencePolicy).toEqual({ name: METADATA_SAFE.name, version: METADATA_SAFE.version });
    expect(result.manifest.storedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('survives close and reopen', () => {
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);
    storage.close();
    storage = new EvidenceStorage(makeConfig(dir));
    const read = storage.getEvidenceRecord(record.trace.traceId);
    expect(read.ok).toBe(true);
  });

  it('rolls back a failed save without partial state', () => {
    // Force a conflict on an otherwise valid save by pre-seeding with a different document for the same identity.
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);
    const modified = makeProofRecord({
      extra: {
        trace: {
          ...record.trace,
          captureProfile: { name: 'modified-profile', version: '1.0.0' },
        },
      },
    });
    const outcome = storage.saveEvidenceRecord(modified);
    expect(outcome.status).toBe('conflict');
    const db = new Database(join(dir, 'test.db'));
    const count = (db.prepare('SELECT COUNT(*) AS c FROM evidence_records').get() as { c: number }).c;
    db.close();
    expect(count).toBe(1);
  });
});

describe('EvidenceStorage save pipeline outcomes', () => {
  let dir: string;
  let storage: EvidenceStorage;

  beforeEach(() => {
    dir = tempDir();
    storage = new EvidenceStorage(makeConfig(dir));
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns invalid for non-object input', () => {
    const outcome = storage.saveEvidenceRecord('not an object');
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(outcome.issues).toEqual([{ code: 'record_not_object', path: '$' }]);
    expect(outcome.identity).toBeNull();
  });

  it('returns invalid for null input', () => {
    const outcome = storage.saveEvidenceRecord(null);
    expect(outcome.status).toBe('invalid');
  });

  it('returns invalid for malformed version syntax', () => {
    const outcome = storage.saveEvidenceRecord({ evidenceSchemaVersion: 'not-a-version' });
    expect(outcome.status).toBe('invalid');
  });

  it('returns unsupported-version for unsupported major', () => {
    const outcome = storage.saveEvidenceRecord({ evidenceSchemaVersion: '99.0.0' });
    expect(outcome.status).toBe('unsupported-version');
    if (outcome.status !== 'unsupported-version') return;
    expect(outcome.version).toBe('99.0.0');
  });

  it('does not write for invalid or unsupported-version outcomes', () => {
    storage.saveEvidenceRecord('bad');
    storage.saveEvidenceRecord({ evidenceSchemaVersion: '99.0.0' });
    const db = new Database(join(dir, 'test.db'));
    const count = (db.prepare('SELECT COUNT(*) AS c FROM evidence_records').get() as { c: number }).c;
    db.close();
    expect(count).toBe(0);
  });

  it('returns clock-failed for a throwing clock on new insertion', () => {
    const record = makeProofRecord();
    const throwingStorage = new EvidenceStorage({
      databasePath: join(dir, 'throw.db'),
      persistencePolicy: ALWAYS_ACCEPT,
      now: () => {
        throw new Error('clock failed');
      },
    });
    const outcome = throwingStorage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('clock-failed');
    throwingStorage.close();
    const db = new Database(join(dir, 'throw.db'));
    const count = (db.prepare('SELECT COUNT(*) AS c FROM evidence_records').get() as { c: number }).c;
    db.close();
    expect(count).toBe(0);
  });

  it('does not consult the clock for an existing row', () => {
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);
    let called = false;
    const throwingStorage = new EvidenceStorage({
      databasePath: join(dir, 'test.db'),
      persistencePolicy: METADATA_SAFE,
      now: () => {
        called = true;
        throw new Error('clock failed');
      },
    });
    const outcome = throwingStorage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('already-present');
    expect(called).toBe(false);
    throwingStorage.close();
  });

  it('returns policy-rejected for a rejecting policy', () => {
    const record = makeProofRecord();
    const rejectingStorage = new EvidenceStorage({
      databasePath: join(dir, 'reject.db'),
      persistencePolicy: ALWAYS_REJECT,
    });
    const outcome = rejectingStorage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-rejected');
    if (outcome.status !== 'policy-rejected') return;
    expect(outcome.code).toBe('rejected');
    expect(outcome.policy).toEqual({ name: 'test.always-reject', version: '1.0.0' });
    rejectingStorage.close();
  });

  it('does not write for policy-rejected outcomes', () => {
    const record = makeProofRecord();
    const rejectingStorage = new EvidenceStorage({
      databasePath: join(dir, 'reject.db'),
      persistencePolicy: ALWAYS_REJECT,
    });
    rejectingStorage.saveEvidenceRecord(record);
    rejectingStorage.close();
    const db = new Database(join(dir, 'reject.db'));
    const count = (db.prepare('SELECT COUNT(*) AS c FROM evidence_records').get() as { c: number }).c;
    db.close();
    expect(count).toBe(0);
  });
});

describe('Storage safety gate', () => {
  let dir: string;
  let storage: EvidenceStorage;

  beforeEach(() => {
    dir = tempDir();
    storage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: ALWAYS_ACCEPT }));
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function dangerousPayload(extra: Record<string, unknown>) {
    return {
      requestEnvelope: {
        model: 'claude-sonnet-4',
        provider: 'anthropic',
        providerNativeFidelity: 'structurally_faithful',
        providerNative: extra,
      },
    };
  }

  it('rejects credential-like value with S1', () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({ someBody: 'Bearer abc123' });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S1']);
  });

  it('rejects sensitive header key with S2 regardless of value', () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({ authorization: 'anything' });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S2']);
  });

  it('rejects sensitive key name with S3 when value is not credential-like', () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({ password: 'not-a-secret' });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S3']);
  });

  it('rejects storageKey with S3', () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({ storageKey: 's3://bucket/key' });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S3']);
  });

  it('gives S2 precedence over S1 for sensitive-header keys', () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({ authorization: 'Bearer abc123' });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S2']);
  });

  it('gives S1 precedence over S3 for sensitive-key with credential-like value', () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({ password: 'Bearer abc123' });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S1']);
  });

  it('rejects byte_faithful captured envelope with S5', () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].evidenceStatus = 'captured';
    (record.rawObservations as EvidenceObservation[])[2].payload = {
      requestEnvelope: {
        model: 'claude-sonnet-4',
        provider: 'anthropic',
        providerNativeFidelity: 'byte_faithful',
        nativeEncoding: 'json',
        nativeContentType: 'application/json',
        nativeContentHash: 'sha256:' + 'a'.repeat(64),
      },
    };
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S5']);
  });

  it('rejects captured structurally_faithful envelope carrying providerNative with S5', () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].evidenceStatus = 'captured';
    (record.rawObservations as EvidenceObservation[])[2].payload = {
      requestEnvelope: {
        model: 'claude-sonnet-4',
        provider: 'anthropic',
        providerNativeFidelity: 'structurally_faithful',
        providerNative: { temperature: 0.2 },
      },
    };
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S5']);
  });

  it('does not reject declared redacted payload with providerNativeFidelity', () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].evidenceStatus = 'redacted';
    (record.rawObservations as EvidenceObservation[])[2].payload = {
      requestEnvelope: {
        model: 'claude-sonnet-4',
        provider: 'anthropic',
        providerNativeFidelity: 'structurally_faithful',
        providerNative: { temperature: 0.2 },
      },
    };
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('stored');
  });

  it('short-circuits on retained bytes with exactly S6', () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({ secretBytes: new Uint8Array([1, 2, 3]) });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S6']);
  });

  it('rejects Uint8Array in declared redacted content', () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].evidenceStatus = 'redacted';
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({ raw: new Uint8Array([1, 2, 3]) });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S6']);
  });

  it('deduplicates and orders safety codes canonically', () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({
      password: 'not-a-secret',
      apiKey: 'sk-abcdefgh123',
      authorization: 'Bearer xyz',
    });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S1', 'S2', 'S3']);
  });
});

describe('metadata-safe reference policy', () => {
  let dir: string;
  let storage: EvidenceStorage;

  beforeEach(() => {
    dir = tempDir();
    storage = new EvidenceStorage(makeConfig(dir));
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('admits the proof record', () => {
    const record = makeProofRecord();
    const outcome = storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('stored');
  });

  it('rejects captured user/provider content', () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].evidenceStatus = 'captured';
    (record.rawObservations as EvidenceObservation[])[2].payload = {
      requestEnvelope: {
        model: 'claude-sonnet-4',
        provider: 'anthropic',
        providerNativeFidelity: 'structurally_faithful',
        messages: [{ role: 'user', content: 'hello' }],
      },
      contextContributions: [],
    };
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('policy-rejected');
    if (outcome.status !== 'policy-rejected') return;
    expect(outcome.code).toBe('captured-content');
  });

  it('rejects unbounded label', () => {
    const record = makeProofRecord();
    const obs = record.rawObservations[1];
    if (!obs || obs.kind !== 'span_start' || !obs.payload || typeof obs.payload !== 'object') {
      throw new Error('expected span_start observation');
    }
    (obs.payload as Record<string, unknown>).span = { kind: 'model', name: 'x'.repeat(200), parentSpanId: null };
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('policy-rejected');
    if (outcome.status !== 'policy-rejected') return;
    expect(outcome.code).toBe('unbounded-label');
  });

  it('rejects condition value that is not null', () => {
    let record = makeProofRecord();
    record = rebuildRecord(record);
    record.trace.conditions = [{ label: 'env', value: 'production', version: '1.0.0' }];
    const outcome = storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-rejected');
    if (outcome.status !== 'policy-rejected') return;
    expect(outcome.code).toBe('captured-content');
  });

  it('rejects unknown additive field at undeclared path', () => {
    let record = makeProofRecord();
    record = rebuildRecord(record);
    (record as unknown as Record<string, unknown>)['extraTopLevel'] = 'value';
    const outcome = storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-rejected');
    if (outcome.status !== 'policy-rejected') return;
    expect(outcome.code).toBe('unknown-additive-field');
  });

  it('rejects responseEnvelope.usage outside the numeric allowlist', () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[3].payload = {
      responseEnvelope: {
        providerNativeFidelity: 'structurally_faithful',
        finishReason: 'end_turn',
        usage: { inputTokens: 3, outputTokens: 1, extra: 'value' },
      },
    };
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('policy-rejected');
    if (outcome.status !== 'policy-rejected') return;
    expect(outcome.code).toBe('captured-content');
  });

  it('rejects model_usage.usage token as plain number', () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[5] = makeObservation({
      kind: 'model_usage',
      seq: 5,
      payload: {
        usage: {
          evidenceStatus: 'captured',
          inputTokens: 3,
        },
      },
    });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('policy-rejected');
    if (outcome.status !== 'policy-rejected') return;
    expect(outcome.code).toBe('captured-content');
  });
});

describe('Policy decision runtime validation', () => {
  it('rejects a policy returning a secret as its code', () => {
    const dir = tempDir();
    const evilPolicy: PersistencePolicy = {
      name: 'test.evil',
      version: '1.0.0',
      decide: () => ({ accept: false, code: 'sk-abc1234567890' as unknown as 'rejected' }),
    };
    const storage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: evilPolicy }));
    const record = makeProofRecord();
    const outcome = storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-failed');
    if (outcome.status !== 'policy-failed') return;
    expect(outcome.reason).toBe('malformed-decision');
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a thenable policy decision', () => {
    const dir = tempDir();
    const thenablePolicy: PersistencePolicy = {
      name: 'test.thenable',
      version: '1.0.0',
      decide: () => ({ then: () => undefined }) as unknown as PersistencePolicyDecision,
    };
    const storage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: thenablePolicy }));
    const record = makeProofRecord();
    const outcome = storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-failed');
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a policy decision with a symbol own key', () => {
    const dir = tempDir();
    const symbolPolicy: PersistencePolicy = {
      name: 'test.symbol',
      version: '1.0.0',
      decide: () => {
        const decision = { accept: true } as PersistencePolicyDecision;
        (decision as unknown as Record<symbol, unknown>)[Symbol('extra')] = 'x';
        return decision;
      },
    };
    const storage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: symbolPolicy }));
    const record = makeProofRecord();
    const outcome = storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-failed');
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a policy decision with an accessor descriptor', () => {
    const dir = tempDir();
    const accessorPolicy: PersistencePolicy = {
      name: 'test.accessor',
      version: '1.0.0',
      decide: () => {
        const decision = {};
        Object.defineProperty(decision, 'accept', {
          get: () => true,
          enumerable: true,
          configurable: true,
        });
        return decision as { accept: true };
      },
    };
    const storage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: accessorPolicy }));
    const record = makeProofRecord();
    const outcome = storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-failed');
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a non-boolean accept value', () => {
    const dir = tempDir();
    const badPolicy: PersistencePolicy = {
      name: 'test.bad',
      version: '1.0.0',
      decide: () => ({ accept: 'yes' } as unknown as { accept: true }),
    };
    const storage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: badPolicy }));
    const record = makeProofRecord();
    const outcome = storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-failed');
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a missing code on rejection', () => {
    const dir = tempDir();
    const missingCodePolicy: PersistencePolicy = {
      name: 'test.missing',
      version: '1.0.0',
      decide: () => ({ accept: false } as unknown as { accept: false; code: 'rejected' }),
    };
    const storage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: missingCodePolicy }));
    const record = makeProofRecord();
    const outcome = storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-failed');
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a throwing policy without leaking the exception', () => {
    const dir = tempDir();
    const throwingPolicy: PersistencePolicy = {
      name: 'test.throwing',
      version: '1.0.0',
      decide: () => {
        throw new Error('secret sk-abc123');
      },
    };
    const storage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: throwingPolicy }));
    const record = makeProofRecord();
    const outcome = storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-failed');
    if (outcome.status !== 'policy-failed') return;
    expect(outcome.reason).toBe('exception');
    // Exception text is never surfaced.
    expect(JSON.stringify(outcome)).not.toContain('sk-abc123');
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('isolates a mutating policy from the stored document', () => {
    const dir = tempDir();
    const record = makeProofRecord();
    const originalTraceId = record.trace.traceId;
    const mutatingPolicy: PersistencePolicy = {
      name: 'test.mutating',
      version: '1.0.0',
      decide: (snapshot) => {
        (snapshot as unknown as Record<string, unknown>).trace = { traceId: 'mutated' } as unknown as EvidenceRecord['trace'];
        return { accept: true } as PersistencePolicyDecision;
      },
    };
    const storage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: mutatingPolicy }));
    const outcome = storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-failed');
    if (outcome.status !== 'policy-failed') return;
    expect(outcome.reason).toBe('exception');
    const read = storage.getEvidenceRecord(originalTraceId);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toBe('not-found');
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('Read integrity', () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns corrupt for malformed JSON', () => {
    dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);
    storage.close();
    const db = new Database(join(dir, 'test.db'));
    db.prepare('UPDATE evidence_records SET serialized_record = ?').run('not-json');
    db.close();
    const fresh = new EvidenceStorage(makeConfig(dir));
    const result = fresh.getEvidenceRecord(record.trace.traceId);
    fresh.close();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('corrupt');
    if (result.reason !== 'corrupt') return;
    expect(result.code).toBe('json_parse_failed');
  });

  it('returns corrupt for a digest mismatch', () => {
    dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);
    storage.close();
    const db = new Database(join(dir, 'test.db'));
    db.prepare('UPDATE evidence_records SET storage_digest = ?').run('0'.repeat(64));
    db.close();
    const fresh = new EvidenceStorage(makeConfig(dir));
    const result = fresh.getEvidenceRecord(record.trace.traceId);
    fresh.close();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('corrupt');
    if (result.reason !== 'corrupt') return;
    expect(result.code).toBe('digest_mismatch');
  });

  it('returns corrupt for tampered policy metadata', () => {
    dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);
    storage.close();
    const db = new Database(join(dir, 'test.db'));
    db.prepare('UPDATE evidence_records SET persistence_policy_version = ?').run('1.0.0-beta');
    db.close();
    const fresh = new EvidenceStorage(makeConfig(dir));
    const result = fresh.getEvidenceRecord(record.trace.traceId);
    fresh.close();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('corrupt');
    if (result.reason !== 'corrupt') return;
    expect(result.code).toBe('policy_metadata_malformed');
  });

  it('returns corrupt for mismatched row identity', () => {
    dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);
    storage.close();
    const db = new Database(join(dir, 'test.db'));
    db.prepare('UPDATE evidence_records SET evidence_identity = ?').run('tampered');
    db.close();
    const fresh = new EvidenceStorage(makeConfig(dir));
    const result = fresh.getEvidenceRecord('tampered');
    fresh.close();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('corrupt');
    if (result.reason !== 'corrupt') return;
    expect(result.code).toBe('identity_mismatch');
  });

  it('returns unsupported-version for a byte-intact unsupported-major document', () => {
    dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);
    storage.close();
    const unsupportedDoc = { ...record, evidenceSchemaVersion: '99.0.0' };
    const docText = JSON.stringify(unsupportedDoc);
    const digest = sha256Hex(utf8Encode(docText));
    const db = new Database(join(dir, 'test.db'));
    db.prepare('UPDATE evidence_records SET serialized_record = ?, storage_digest = ?, evidence_schema_version = ?').run(docText, digest, '99.0.0');
    db.close();
    const fresh = new EvidenceStorage(makeConfig(dir));
    const result = fresh.getEvidenceRecord(record.trace.traceId);
    fresh.close();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-version');
    if (result.reason !== 'unsupported-version') return;
    expect(result.version).toBe('99.0.0');
  });

  it('returns corrupt when unsupported-major document has mismatched schema-version column', () => {
    dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);
    storage.close();
    const unsupportedDoc = { ...record, evidenceSchemaVersion: '99.0.0' };
    const docText = JSON.stringify(unsupportedDoc);
    const digest = sha256Hex(utf8Encode(docText));
    const db = new Database(join(dir, 'test.db'));
    db.prepare('UPDATE evidence_records SET serialized_record = ?, storage_digest = ?, evidence_schema_version = ?').run(docText, digest, '1.0.0');
    db.close();
    const fresh = new EvidenceStorage(makeConfig(dir));
    const result = fresh.getEvidenceRecord(record.trace.traceId);
    fresh.close();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('corrupt');
    if (result.reason !== 'corrupt') return;
    expect(result.code).toBe('schema_version_mismatch');
  });
});

describe('WAL and contention', () => {
  it('enables WAL journaling', () => {
    const dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const db = new Database(join(dir, 'test.db'));
    const mode = db.pragma('journal_mode', { simple: true });
    db.close();
    storage.close();
    expect(mode).toBe('wal');
    rmSync(dir, { recursive: true, force: true });
  });

  it('allows concurrent saves on different identities', () => {
    const dir = tempDir();
    const storage1 = new EvidenceStorage(makeConfig(dir));
    const storage2 = new EvidenceStorage({
      databasePath: join(dir, 'test.db'),
      persistencePolicy: ALWAYS_ACCEPT,
    });
    const r1 = makeProofRecord();
    const r2 = makeProofRecord({ traceId: 'trace-xyz' });
    const out1 = storage1.saveEvidenceRecord(r1);
    const out2 = storage2.saveEvidenceRecord(r2);
    expect(out1.status).toBe('stored');
    expect(out2.status).toBe('stored');
    storage1.close();
    storage2.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('Serialization boundary', () => {
  it('demonstrates Uint8Array to Base64 conversion at the serializer boundary', () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = {
      requestEnvelope: {
        model: 'claude-sonnet-4',
        provider: 'anthropic',
        providerNativeFidelity: 'structurally_faithful',
      },
      bytes: new Uint8Array([1, 2, 3]),
    };
    const parsed = { ok: true, record: rebuildRecord(record) };
    const doc = serializeEvidenceRecord(parsed.record);
    expect(doc).toContain('AQID'); // Base64 of [1,2,3]
  });
});
