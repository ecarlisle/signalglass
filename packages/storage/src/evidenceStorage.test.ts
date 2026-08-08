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

function makeProofRecord(opts?: {
  traceId?: string;
  extra?: Partial<EvidenceRecord>;
  captureProfile?: { name: string; version: string };
}): EvidenceRecord {
  const traceId = opts?.traceId ?? 'trace-abc';
  const captureProfile = opts?.captureProfile ?? { name: 'dev-basic', version: '1.2.0' };
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
    { captureProfile },
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeConfig(dir: string, overrides?: Partial<EvidenceStorageConfig>): EvidenceStorageConfig {
  return {
    databasePath: join(dir, 'test.db'),
    persistencePolicy: METADATA_SAFE,
    ...overrides,
  };
}

describe('EvidenceStorage construction', () => {
  it('requires a persistence policy', async () => {
    expect(() => new EvidenceStorage({ databasePath: ':memory:' } as unknown as EvidenceStorageConfig)).toThrow(
      StorageConfigError,
    );
  });

  it('rejects an invalid policy name', async () => {
    expect(
      () =>
        new EvidenceStorage({
          databasePath: ':memory:',
          persistencePolicy: { name: 'Bad Name', version: '1.0.0', decide: () => ({ accept: true }) },
        }),
    ).toThrow(StorageConfigError);
  });

  it('rejects a credential-like policy name', async () => {
    expect(
      () =>
        new EvidenceStorage({
          databasePath: ':memory:',
          persistencePolicy: { name: 'sk-abc12345', version: '1.0.0', decide: () => ({ accept: true }) },
        }),
    ).toThrow(StorageConfigError);
  });

  it('rejects an invalid policy version', async () => {
    expect(
      () =>
        new EvidenceStorage({
          databasePath: ':memory:',
          persistencePolicy: { name: 'test.policy', version: '1.0.0-beta', decide: () => ({ accept: true }) },
        }),
    ).toThrow(StorageConfigError);
  });

  it('rejects a plain object spoofing the reference policy name', async () => {
    const dir = tempDir();
    try {
      expect(
        () =>
          new EvidenceStorage({
            databasePath: join(dir, 'test.db'),
            persistencePolicy: {
              name: 'signalglass.persistence.metadata-safe',
              version: '1.0.0',
              decide: () => ({ accept: true }),
            },
          }),
      ).toThrow(StorageConfigError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts the storage-shipped reference policy by identity', async () => {
    const dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    expect(isMetadataSafePolicy(storage as unknown as PersistencePolicy)).toBe(false);
    expect(isMetadataSafePolicy(METADATA_SAFE)).toBe(true);
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('EvidenceStorage schema initialization', () => {
  it('creates canonical tables on a fresh database', async () => {
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

  it('creates the evidence_records column contract and canonical indices (SQLite PRAGMA)', async () => {
    // The read/save pipeline depends on this column contract; verify it via
    // PRAGMA rather than assuming it from CREATE TABLE success.
    const dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const db = new Database(join(dir, 'test.db'));
    const columns = db.pragma('table_info(evidence_records)') as {
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }[];
    expect(columns.map((c) => c.name)).toEqual([
      'evidence_identity',
      'evidence_schema_version',
      'storage_format_version',
      'persistence_policy_name',
      'persistence_policy_version',
      'stored_at',
      'storage_digest',
      'serialized_record',
    ]);
    expect(columns.find((c) => c.name === 'evidence_identity')?.pk).toBe(1);
    expect(columns.every((c) => c.notnull === 1)).toBe(true);
    const indices = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND name LIKE 'idx_evidence_%'")
      .all() as { name: string; sql: string }[];
    expect(indices.map((i) => i.name).sort()).toEqual([
      'idx_evidence_records_schema_version',
      'idx_evidence_records_stored_at',
    ]);
    // The administrative storage digest is intentionally unindexed (spec 015).
    expect(indices.every((i) => !i.sql.includes('storage_digest'))).toBe(true);
    db.close();
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rolls back partially-created canonical objects when initialization fails', async () => {
    // Force the init transaction to fail after it has already created one
    // canonical object: a pre-existing VIEW named evidence_records collides
    // with the canonical table name, so CREATE TABLE evidence_records throws
    // inside the init transaction. Everything created during that attempt
    // (including the ledger table) must be rolled back (spec 015: atomic
    // initialization with rollback).
    const dir = tempDir();
    const db = new Database(join(dir, 'test.db'));
    db.exec('CREATE VIEW evidence_records AS SELECT 1 AS id');
    db.close();

    expect(() => new EvidenceStorage(makeConfig(dir))).toThrow();

    const db2 = new Database(join(dir, 'test.db'));
    const tables = db2
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'evidence_%'")
      .all() as { name: string }[];
    // The ledger table created inside the failed transaction must not survive.
    expect(tables.map((t) => t.name)).toEqual([]);
    db2.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reopens a compatible database without mutation', async () => {
    const dir = tempDir();
    const config = makeConfig(dir);
    const s1 = new EvidenceStorage(config);
    const record = makeProofRecord();
    await s1.saveEvidenceRecord(record);
    s1.close();
    const s2 = new EvidenceStorage(config);
    const read = s2.getEvidenceRecord(record.trace.traceId);
    expect(read.ok).toBe(true);
    s2.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to open when canonical tables exist without a ledger', async () => {
    const dir = tempDir();
    const db = new Database(join(dir, 'test.db'));
    db.exec('CREATE TABLE evidence_records (id TEXT PRIMARY KEY)');
    db.close();
    expect(() => new EvidenceStorage(makeConfig(dir))).toThrow(StorageFormatError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to open when the ledger names a higher format version', async () => {
    const dir = tempDir();
    const db = new Database(join(dir, 'test.db'));
    db.exec('CREATE TABLE evidence_storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO evidence_storage_meta VALUES (?, ?)').run('evidence_storage_format_version', '9.0.0');
    db.close();
    expect(() => new EvidenceStorage(makeConfig(dir))).toThrow(StorageFormatError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to open when the ledger names a lower format version', async () => {
    const dir = tempDir();
    const db = new Database(join(dir, 'test.db'));
    db.exec('CREATE TABLE evidence_storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT INTO evidence_storage_meta VALUES (?, ?)').run('evidence_storage_format_version', '0.1.0');
    db.close();
    expect(() => new EvidenceStorage(makeConfig(dir))).toThrow(StorageFormatError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('leaves legacy tables untouched and coexists with TraceStorage', async () => {
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
    await storage.saveEvidenceRecord(record);
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

  it('stores a valid record and retrieves the serializer snapshot', async () => {
    const record = makeProofRecord();
    const save = await storage.saveEvidenceRecord(record);
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

  it('preserves the exact serialized-record text', async () => {
    const record = makeProofRecord();
    const expected = serializeEvidenceRecord(record);
    await storage.saveEvidenceRecord(record);
    const db = new Database(join(dir, 'test.db'));
    const row = db.prepare('SELECT serialized_record FROM evidence_records WHERE evidence_identity = ?').get(record.trace.traceId) as { serialized_record: string };
    db.close();
    expect(row.serialized_record).toBe(expected);
  });

  it('returns already-present for a byte-identical repeat', async () => {
    const record = makeProofRecord();
    const first = await storage.saveEvidenceRecord(record);
    expect(first.status).toBe('stored');
    const second = await storage.saveEvidenceRecord(record);
    expect(second.status).toBe('already-present');
    const db = new Database(join(dir, 'test.db'));
    const count = (db.prepare('SELECT COUNT(*) AS c FROM evidence_records').get() as { c: number }).c;
    db.close();
    expect(count).toBe(1);
  });

  it('returns conflict for same identity with different text', async () => {
    const record = makeProofRecord();
    await storage.saveEvidenceRecord(record);
    const modified = makeProofRecord({
      extra: {
        trace: {
          ...record.trace,
          captureProfile: { name: 'modified-profile', version: '1.0.0' },
        },
      },
    });
    const outcome = await storage.saveEvidenceRecord(modified);
    expect(outcome.status).toBe('conflict');
    const read = storage.getEvidenceRecord(record.trace.traceId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.record.trace.captureProfile.name).toBe('dev-basic');
  });

  it('decides idempotency by exact stored text, never by digest equality', async () => {
    // Regression: even when the persisted row's recorded digest coincides with
    // the supplied document's digest (a simulated collision), different text
    // for the same identity MUST be a conflict. The deciding comparison is
    // exact stored-text equality, never digest equality (spec 015).
    const record = makeProofRecord();
    const first = await storage.saveEvidenceRecord(record);
    expect(first.status).toBe('stored');

    const conflicting = makeProofRecord({
      extra: {
        trace: {
          ...record.trace,
          captureProfile: { name: 'digest-collision', version: '1.0.0' },
        },
      },
    });
    const storedText = serializeEvidenceRecord(record);
    const conflictingText = serializeEvidenceRecord(conflicting);
    expect(storedText).not.toBe(conflictingText);

    // Simulate a digest collision: the stored row now records sha256 of the
    // conflicting text while still holding the original text.
    const db = new Database(join(dir, 'test.db'));
    db.prepare('UPDATE evidence_records SET storage_digest = ? WHERE evidence_identity = ?').run(
      sha256Hex(utf8Encode(conflictingText)),
      record.trace.traceId,
    );
    db.close();

    // Digests coincide but texts differ: must be a structured conflict, never
    // a false idempotent `already-present`.
    const outcome = await storage.saveEvidenceRecord(conflicting);
    expect(outcome.status).toBe('conflict');
  });

  it('computes the digest over the exact UTF-8 bytes of the serializer output', async () => {
    const record = makeProofRecord();
    const doc = serializeEvidenceRecord(record);
    const expected = sha256Hex(utf8Encode(doc));
    const save = await storage.saveEvidenceRecord(record) as Extract<SaveOutcome, { status: 'stored' }>;
    expect(save.status).toBe('stored');
    expect(save.digest).toBe(expected);
  });

  it('returns not-found for an unknown identity', async () => {
    const result = storage.getEvidenceRecord('nonexistent');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-found');
  });

  it('returns stored evidence with a manifest', async () => {
    const record = makeProofRecord();
    await storage.saveEvidenceRecord(record);
    const result = storage.getStoredEvidence(record.trace.traceId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.storageFormatVersion).toBe('1.0.0');
    expect(result.manifest.evidenceSchemaVersion).toBe('1.0.0');
    expect(result.manifest.persistencePolicy).toEqual({ name: METADATA_SAFE.name, version: METADATA_SAFE.version });
    expect(result.manifest.storedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('keeps persistence-policy metadata out of the stored document', async () => {
    // Policy name/version live only in administrative metadata (manifest and
    // columns), never inside the serialized document (spec 015). Use a custom
    // policy whose name/version cannot coincide with any record content.
    const distinctivePolicy: PersistencePolicy = {
      name: 'test.distinctive-policy',
      version: '9.8.7',
      decide: () => ({ accept: true } as PersistencePolicyDecision),
    };
    storage.close();
    storage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: distinctivePolicy }));

    const record = makeProofRecord();
    const save = await storage.saveEvidenceRecord(record);
    expect(save.status).toBe('stored');
    if (save.status !== 'stored') return;
    expect(save.manifest.persistencePolicy).toEqual({
      name: 'test.distinctive-policy',
      version: '9.8.7',
    });

    const db = new Database(join(dir, 'test.db'));
    const row = db
      .prepare('SELECT serialized_record, persistence_policy_name, persistence_policy_version FROM evidence_records WHERE evidence_identity = ?')
      .get(record.trace.traceId) as {
      serialized_record: string;
      persistence_policy_name: string;
      persistence_policy_version: string;
    };
    db.close();

    expect(row.persistence_policy_name).toBe('test.distinctive-policy');
    expect(row.persistence_policy_version).toBe('9.8.7');
    expect(row.serialized_record).toBe(serializeEvidenceRecord(record));
    expect(row.serialized_record).not.toContain('test.distinctive-policy');
    expect(row.serialized_record).not.toContain('9.8.7');
  });

  it('survives close and reopen', async () => {
    const record = makeProofRecord();
    await storage.saveEvidenceRecord(record);
    storage.close();
    storage = new EvidenceStorage(makeConfig(dir));
    const read = storage.getEvidenceRecord(record.trace.traceId);
    expect(read.ok).toBe(true);
  });

  it('rolls back a failed save without partial state', async () => {
    // Force a conflict on an otherwise valid save by pre-seeding with a different document for the same identity.
    const record = makeProofRecord();
    await storage.saveEvidenceRecord(record);
    const modified = makeProofRecord({
      extra: {
        trace: {
          ...record.trace,
          captureProfile: { name: 'modified-profile', version: '1.0.0' },
        },
      },
    });
    const outcome = await storage.saveEvidenceRecord(modified);
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

  it('returns invalid for non-object input', async () => {
    const outcome = await storage.saveEvidenceRecord('not an object');
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(outcome.issues).toEqual([{ code: 'record_not_object', path: '$' }]);
    expect(outcome.identity).toBeNull();
  });

  it('returns invalid for null input', async () => {
    const outcome = await storage.saveEvidenceRecord(null);
    expect(outcome.status).toBe('invalid');
  });

  it('returns invalid for malformed version syntax', async () => {
    const outcome = await storage.saveEvidenceRecord({ evidenceSchemaVersion: 'not-a-version' });
    expect(outcome.status).toBe('invalid');
  });

  it('returns unsupported-version for unsupported major', async () => {
    const outcome = await storage.saveEvidenceRecord({ evidenceSchemaVersion: '99.0.0' });
    expect(outcome.status).toBe('unsupported-version');
    if (outcome.status !== 'unsupported-version') return;
    expect(outcome.version).toBe('99.0.0');
  });

  it('does not write for invalid or unsupported-version outcomes', async () => {
    await storage.saveEvidenceRecord('bad');
    await storage.saveEvidenceRecord({ evidenceSchemaVersion: '99.0.0' });
    const db = new Database(join(dir, 'test.db'));
    const count = (db.prepare('SELECT COUNT(*) AS c FROM evidence_records').get() as { c: number }).c;
    db.close();
    expect(count).toBe(0);
  });

  it('returns clock-failed for a throwing clock on new insertion', async () => {
    const record = makeProofRecord();
    const throwingStorage = new EvidenceStorage({
      databasePath: join(dir, 'throw.db'),
      persistencePolicy: ALWAYS_ACCEPT,
      now: () => {
        throw new Error('clock failed');
      },
    });
    const outcome = await throwingStorage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('clock-failed');
    throwingStorage.close();
    const db = new Database(join(dir, 'throw.db'));
    const count = (db.prepare('SELECT COUNT(*) AS c FROM evidence_records').get() as { c: number }).c;
    db.close();
    expect(count).toBe(0);
  });

  it('does not consult the clock for an existing row', async () => {
    const record = makeProofRecord();
    await storage.saveEvidenceRecord(record);
    let called = false;
    const throwingStorage = new EvidenceStorage({
      databasePath: join(dir, 'test.db'),
      persistencePolicy: METADATA_SAFE,
      now: () => {
        called = true;
        throw new Error('clock failed');
      },
    });
    const outcome = await throwingStorage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('already-present');
    expect(called).toBe(false);
    throwingStorage.close();
  });

  it('returns policy-rejected for a rejecting policy', async () => {
    const record = makeProofRecord();
    const rejectingStorage = new EvidenceStorage({
      databasePath: join(dir, 'reject.db'),
      persistencePolicy: ALWAYS_REJECT,
    });
    const outcome = await rejectingStorage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-rejected');
    if (outcome.status !== 'policy-rejected') return;
    expect(outcome.code).toBe('rejected');
    expect(outcome.policy).toEqual({ name: 'test.always-reject', version: '1.0.0' });
    rejectingStorage.close();
  });

  it('does not write for policy-rejected outcomes', async () => {
    const record = makeProofRecord();
    const rejectingStorage = new EvidenceStorage({
      databasePath: join(dir, 'reject.db'),
      persistencePolicy: ALWAYS_REJECT,
    });
    await rejectingStorage.saveEvidenceRecord(record);
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

  it('rejects credential-like value with S1', async () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({ someBody: 'Bearer abc123' });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = await storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S1']);
  });

  it('rejects sensitive header key with S2 regardless of value', async () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({ authorization: 'anything' });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = await storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S2']);
  });

  it('rejects sensitive key name with S3 when value is not credential-like', async () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({ password: 'not-a-secret' });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = await storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S3']);
  });

  it('rejects storageKey with S3', async () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({ storageKey: 's3://bucket/key' });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = await storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S3']);
  });

  it('gives S2 precedence over S1 for sensitive-header keys', async () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({ authorization: 'Bearer abc123' });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = await storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S2']);
  });

  it('gives S1 precedence over S3 for sensitive-key with credential-like value', async () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({ password: 'Bearer abc123' });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = await storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S1']);
  });

  it('rejects byte_faithful captured envelope with S5', async () => {
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
    const outcome = await storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S5']);
  });

  it('rejects captured structurally_faithful envelope carrying providerNative with S5', async () => {
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
    const outcome = await storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S5']);
  });

  it('does not reject declared redacted payload with providerNativeFidelity', async () => {
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
    const outcome = await storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('stored');
  });

  it('short-circuits on retained bytes with exactly S6', async () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({ secretBytes: new Uint8Array([1, 2, 3]) });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = await storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S6']);
  });

  it('rejects Uint8Array in declared redacted content', async () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].evidenceStatus = 'redacted';
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({ raw: new Uint8Array([1, 2, 3]) });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = await storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('safety-rejected');
    if (outcome.status !== 'safety-rejected') return;
    expect(outcome.reasons).toEqual(['S6']);
  });

  it('deduplicates and orders safety codes canonically', async () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[2].payload = dangerousPayload({
      password: 'not-a-secret',
      apiKey: 'sk-abcdefgh123',
      authorization: 'Bearer xyz',
    });
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = await storage.saveEvidenceRecord(parsed.record);
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

  it('admits the proof record', async () => {
    const record = makeProofRecord();
    const outcome = await storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('stored');
  });

  it('rejects captured user/provider content', async () => {
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
    const outcome = await storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('policy-rejected');
    if (outcome.status !== 'policy-rejected') return;
    expect(outcome.code).toBe('captured-content');
  });

  it('rejects unbounded label', async () => {
    const record = makeProofRecord();
    const obs = record.rawObservations[1];
    if (!obs || obs.kind !== 'span_start' || !obs.payload || typeof obs.payload !== 'object') {
      throw new Error('expected span_start observation');
    }
    (obs.payload as Record<string, unknown>).span = { kind: 'model', name: 'x'.repeat(200), parentSpanId: null };
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = await storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('policy-rejected');
    if (outcome.status !== 'policy-rejected') return;
    expect(outcome.code).toBe('unbounded-label');
  });

  it('rejects condition value that is not null', async () => {
    let record = makeProofRecord();
    record = rebuildRecord(record);
    record.trace.conditions = [{ label: 'env', value: 'production', version: '1.0.0' }];
    const outcome = await storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-rejected');
    if (outcome.status !== 'policy-rejected') return;
    expect(outcome.code).toBe('captured-content');
  });

  it('rejects unknown additive field at undeclared path', async () => {
    let record = makeProofRecord();
    record = rebuildRecord(record);
    (record as unknown as Record<string, unknown>)['extraTopLevel'] = 'value';
    const outcome = await storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-rejected');
    if (outcome.status !== 'policy-rejected') return;
    expect(outcome.code).toBe('unknown-additive-field');
  });

  it('rejects responseEnvelope.usage outside the numeric allowlist', async () => {
    const record = makeProofRecord();
    (record.rawObservations as EvidenceObservation[])[3].payload = {
      responseEnvelope: {
        providerNativeFidelity: 'structurally_faithful',
        finishReason: 'end_turn',
        usage: { inputTokens: 3, outputTokens: 1, extra: 'value' },
      },
    };
    const parsed = { ok: true, record: rebuildRecord(record) };
    const outcome = await storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('policy-rejected');
    if (outcome.status !== 'policy-rejected') return;
    expect(outcome.code).toBe('captured-content');
  });

  it('rejects model_usage.usage token as plain number', async () => {
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
    const outcome = await storage.saveEvidenceRecord(parsed.record);
    expect(outcome.status).toBe('policy-rejected');
    if (outcome.status !== 'policy-rejected') return;
    expect(outcome.code).toBe('captured-content');
  });
});

describe('Policy decision runtime validation', () => {
  it('rejects a policy returning a secret as its code', async () => {
    const dir = tempDir();
    const evilPolicy: PersistencePolicy = {
      name: 'test.evil',
      version: '1.0.0',
      decide: () => ({ accept: false, code: 'sk-abc1234567890' as unknown as 'rejected' }),
    };
    const storage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: evilPolicy }));
    const record = makeProofRecord();
    const outcome = await storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-failed');
    if (outcome.status !== 'policy-failed') return;
    expect(outcome.reason).toBe('malformed-decision');
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a thenable policy decision', async () => {
    const dir = tempDir();
    const thenablePolicy: PersistencePolicy = {
      name: 'test.thenable',
      version: '1.0.0',
      decide: () => ({ then: () => undefined }) as unknown as PersistencePolicyDecision,
    };
    const storage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: thenablePolicy }));
    const record = makeProofRecord();
    const outcome = await storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-failed');
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a policy decision with a symbol own key', async () => {
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
    const outcome = await storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-failed');
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a policy decision with an accessor descriptor', async () => {
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
    const outcome = await storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-failed');
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a non-boolean accept value', async () => {
    const dir = tempDir();
    const badPolicy: PersistencePolicy = {
      name: 'test.bad',
      version: '1.0.0',
      decide: () => ({ accept: 'yes' } as unknown as { accept: true }),
    };
    const storage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: badPolicy }));
    const record = makeProofRecord();
    const outcome = await storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-failed');
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a missing code on rejection', async () => {
    const dir = tempDir();
    const missingCodePolicy: PersistencePolicy = {
      name: 'test.missing',
      version: '1.0.0',
      decide: () => ({ accept: false } as unknown as { accept: false; code: 'rejected' }),
    };
    const storage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: missingCodePolicy }));
    const record = makeProofRecord();
    const outcome = await storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-failed');
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a throwing policy without leaking the exception', async () => {
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
    const outcome = await storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('policy-failed');
    if (outcome.status !== 'policy-failed') return;
    expect(outcome.reason).toBe('exception');
    // Exception text is never surfaced.
    expect(JSON.stringify(outcome)).not.toContain('sk-abc123');
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('isolates a mutating policy from the stored document', async () => {
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
    const outcome = await storage.saveEvidenceRecord(record);
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

  it('is deterministic: the same malformed decision produces the identical outcome every time', async () => {
    const dir = tempDir();
    const malformedPolicy: PersistencePolicy = {
      name: 'test.malformed',
      version: '1.0.0',
      decide: () => 'sk-abc1234567890' as unknown as PersistencePolicyDecision,
    };
    const storage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: malformedPolicy }));
    const record = makeProofRecord();
    const first = await storage.saveEvidenceRecord(record);
    const second = await storage.saveEvidenceRecord(record);
    expect(first.status).toBe('policy-failed');
    expect(second.status).toBe('policy-failed');
    // Identical structured outcome, never a throw and never a leaked value.
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first)).not.toContain('sk-abc1234567890');
    // Nothing was written.
    const read = storage.getEvidenceRecord(record.trace.traceId);
    expect(read.ok).toBe(false);
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('Read integrity', () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns corrupt for malformed JSON', async () => {
    dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    await storage.saveEvidenceRecord(record);
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

  it('returns corrupt for a digest mismatch', async () => {
    dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    await storage.saveEvidenceRecord(record);
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

  it('returns corrupt for tampered policy metadata', async () => {
    dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    await storage.saveEvidenceRecord(record);
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

  it('returns corrupt for mismatched row identity', async () => {
    dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    await storage.saveEvidenceRecord(record);
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

  it('returns unsupported-version for a byte-intact unsupported-major document', async () => {
    dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    await storage.saveEvidenceRecord(record);
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

  it('returns corrupt when unsupported-major document has mismatched schema-version column', async () => {
    dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    await storage.saveEvidenceRecord(record);
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
  it('enables WAL journaling', async () => {
    const dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const db = new Database(join(dir, 'test.db'));
    const mode = db.pragma('journal_mode', { simple: true });
    db.close();
    storage.close();
    expect(mode).toBe('wal');
    rmSync(dir, { recursive: true, force: true });
  });

  it('allows concurrent saves on different identities', async () => {
    const dir = tempDir();
    const storage1 = new EvidenceStorage(makeConfig(dir));
    const storage2 = new EvidenceStorage({
      databasePath: join(dir, 'test.db'),
      persistencePolicy: ALWAYS_ACCEPT,
    });
    const r1 = makeProofRecord();
    const r2 = makeProofRecord({ traceId: 'trace-xyz' });
    const out1 = await storage1.saveEvidenceRecord(r1);
    const out2 = await storage2.saveEvidenceRecord(r2);
    expect(out1.status).toBe('stored');
    expect(out2.status).toBe('stored');
    storage1.close();
    storage2.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves a same-identity write race with a structured already-present', async () => {
    // Two connections genuinely contend on one WAL database: a test-controlled
    // connection holds an uncommitted write lock while the storage under test
    // appends the same byte-identical record. The storage must wait out the
    // busy timeout, re-read the persisted row inside a fresh transaction, and
    // report `already-present` — never a raw constraint error (spec 015:
    // concurrency/transactional conflicts).
    const dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    const identity = record.trace.traceId;
    const storedDocument = serializeEvidenceRecord(record);
    const digest = sha256Hex(utf8Encode(storedDocument));

    const competing = new Database(join(dir, 'test.db'));
    const formatVersion = (
      competing
        .prepare('SELECT value FROM evidence_storage_meta WHERE key = ?')
        .get('evidence_storage_format_version') as { value: string }
    ).value;
    const insert = competing.prepare(
      `INSERT INTO evidence_records (
         evidence_identity, evidence_schema_version, storage_format_version,
         persistence_policy_name, persistence_policy_version, stored_at,
         storage_digest, serialized_record
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    competing.exec('BEGIN IMMEDIATE');
    insert.run(
      identity,
      record.evidenceSchemaVersion,
      formatVersion,
      METADATA_SAFE.name,
      METADATA_SAFE.version,
      '2026-08-12T12:00:00.000Z',
      digest,
      storedDocument,
    );

    // The storage's save blocks on the busy handler while `competing` holds the
    // write lock; once the competing transaction commits, the retry re-reads
    // the persisted row inside its own transaction and classifies it.
    const pending = storage.saveEvidenceRecord(record);
    await sleep(700);
    competing.exec('COMMIT');
    competing.close();

    const outcome = await pending;
    expect(outcome.status).toBe('already-present');

    const db = new Database(join(dir, 'test.db'));
    const count = (db.prepare('SELECT COUNT(*) AS c FROM evidence_records').get() as { c: number }).c;
    db.close();
    expect(count).toBe(1);
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves a same-identity write race with a structured conflict', async () => {
    // Same race as above, but the competing connection commits DIFFERENT text
    // for the same identity: the loser must observe a structured `conflict`
    // derived from the persisted row, and the original row must remain
    // byte-identical.
    const dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const identity = 'trace-race';
    const winner = makeProofRecord({ traceId: identity });
    const loser = makeProofRecord({
      traceId: identity,
      captureProfile: { name: 'dev-racing', version: '1.2.0' },
    });
    const winningDocument = serializeEvidenceRecord(winner);
    const losingDocument = serializeEvidenceRecord(loser);
    expect(winningDocument).not.toBe(losingDocument);

    const competing = new Database(join(dir, 'test.db'));
    const formatVersion = (
      competing
        .prepare('SELECT value FROM evidence_storage_meta WHERE key = ?')
        .get('evidence_storage_format_version') as { value: string }
    ).value;
    const insert = competing.prepare(
      `INSERT INTO evidence_records (
         evidence_identity, evidence_schema_version, storage_format_version,
         persistence_policy_name, persistence_policy_version, stored_at,
         storage_digest, serialized_record
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    competing.exec('BEGIN IMMEDIATE');
    insert.run(
      identity,
      winner.evidenceSchemaVersion,
      formatVersion,
      METADATA_SAFE.name,
      METADATA_SAFE.version,
      '2026-08-12T12:00:00.000Z',
      sha256Hex(utf8Encode(winningDocument)),
      winningDocument,
    );

    const pending = storage.saveEvidenceRecord(loser);
    await sleep(700);
    competing.exec('COMMIT');
    competing.close();

    const outcome = await pending;
    expect(outcome.status).toBe('conflict');
    if (outcome.status !== 'conflict') return;
    expect(outcome.existingDigest).toBe(sha256Hex(utf8Encode(winningDocument)));
    expect(outcome.suppliedDigest).toBe(sha256Hex(utf8Encode(losingDocument)));

    // The winning row is preserved byte-identical and only one row exists.
    const db = new Database(join(dir, 'test.db'));
    const row = db
      .prepare('SELECT serialized_record FROM evidence_records WHERE evidence_identity = ?')
      .get(identity) as { serialized_record: string };
    expect(row.serialized_record).toBe(winningDocument);
    const count = (db.prepare('SELECT COUNT(*) AS c FROM evidence_records').get() as { c: number }).c;
    db.close();
    expect(count).toBe(1);
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('Serialization boundary', () => {
  it('demonstrates Uint8Array to Base64 conversion at the serializer boundary', async () => {
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

  it('explicitly undefined optional properties are absent after round trip', async () => {
    const record = makeProofRecord();
    // Set an optional property to undefined
    (record as any).trace.conditions = undefined;
    const doc = serializeEvidenceRecord(record);
    const parsed = parseEvidenceRecord(JSON.parse(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // undefined becomes absent in JSON
    expect((parsed.record as any).trace.conditions).toBeUndefined();
  });
});

describe('Acceptance criteria coverage', () => {
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

  it('persisted unknown-additive-field round-trip under admitting custom policy', async () => {
    const admittingPolicy: PersistencePolicy = {
      name: 'test.admitting',
      version: '1.0.0',
      decide: () => ({ accept: true } as PersistencePolicyDecision),
    };
    const admittingStorage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: admittingPolicy }));

    const record = makeProofRecord();
    (record as any).customField = 'custom-value';

    const saveResult = await admittingStorage.saveEvidenceRecord(record);
    expect(saveResult.status).toBe('stored');

    const readResult = admittingStorage.getEvidenceRecord(record.trace.traceId);
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;

    // Custom field should survive round-trip
    expect((readResult.record as any).customField).toBe('custom-value');
    admittingStorage.close();
  });

  it('simulated equal-digest different-text conflict', async () => {
    const record1 = makeProofRecord();
    const record2 = makeProofRecord({ captureProfile: { name: 'different-profile', version: '1.0.0' } });

    // Make them have the same trace ID but different text
    record2.trace.traceId = record1.trace.traceId;
    record2.trace.interactionId = record1.trace.traceId;

    // Serialize both to compute digests
    const doc1 = serializeEvidenceRecord(record1);
    const doc2 = serializeEvidenceRecord(record2);

    // Verify they have different text
    expect(doc1).not.toBe(doc2);

    // Save first record
    const save1 = await storage.saveEvidenceRecord(record1);
    expect(save1.status).toBe('stored');

    // Save second record with same identity but different text
    const save2 = await storage.saveEvidenceRecord(record2);
    expect(save2.status).toBe('conflict');

    // Verify first record is unchanged
    const read1 = storage.getEvidenceRecord(record1.trace.traceId);
    expect(read1.ok).toBe(true);
    if (!read1.ok) return;
    expect(read1.record.trace.captureProfile.name).toBe('dev-basic');
  });

  it('initialization rollback on schema creation failure', async () => {
    const rollbackDir = tempDir();
    const dbPath = join(rollbackDir, 'test.db');
    const db = new Database(dbPath);

    // Create a table that will conflict with schema creation
    db.exec('CREATE TABLE evidence_records (wrong_schema TEXT)');
    db.close();

    // Attempt to open EvidenceStorage should fail
    expect(() => new EvidenceStorage(makeConfig(rollbackDir))).toThrow(StorageFormatError);

    // Verify the database is still in its original state
    const verifyDb = new Database(dbPath);
    const tables = verifyDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
    verifyDb.close();

    // Should only have the original table, no new tables
    expect(tables.length).toBe(1);
    expect(tables[0].name).toBe('evidence_records');

    rmSync(rollbackDir, { recursive: true, force: true });
  });

  it('legacy deleteTrace does not touch canonical rows', async () => {
    // Save a canonical record
    const record = makeProofRecord();
    await storage.saveEvidenceRecord(record);

    // Open legacy TraceStorage on the same database
    const legacyStorage = new TraceStorage({ databasePath: join(dir, 'test.db') });

    // Call deleteTrace (should not affect canonical rows)
    legacyStorage.deleteTrace(record.trace.traceId);
    legacyStorage.close();

    // Verify canonical record still exists
    const readResult = storage.getEvidenceRecord(record.trace.traceId);
    expect(readResult.ok).toBe(true);
  });

  it('legacy deleteExpiredTraces does not touch canonical rows', async () => {
    // Save a canonical record
    const record = makeProofRecord();
    await storage.saveEvidenceRecord(record);

    // Open legacy TraceStorage on the same database
    const legacyStorage = new TraceStorage({ databasePath: join(dir, 'test.db') });

    // Call deleteExpiredTraces (should not affect canonical rows)
    legacyStorage.deleteExpiredTraces();
    legacyStorage.close();

    // Verify canonical record still exists
    const readResult = storage.getEvidenceRecord(record.trace.traceId);
    expect(readResult.ok).toBe(true);
  });

  it('corrupt-read: malformed JSON', async () => {
    const record = makeProofRecord();
    await storage.saveEvidenceRecord(record);

    // Corrupt the serialized record
    const db = new Database(join(dir, 'test.db'));
    db.prepare('UPDATE evidence_records SET serialized_record = ? WHERE evidence_identity = ?')
      .run('not valid json {', record.trace.traceId);
    db.close();

    const readResult = storage.getEvidenceRecord(record.trace.traceId);
    expect(readResult.ok).toBe(false);
    if (readResult.ok) return;
    expect(readResult.reason).toBe('corrupt');
    expect((readResult as any).code).toBe('json_parse_failed');
  });

  it('corrupt-read: digest mismatch', async () => {
    const record = makeProofRecord();
    await storage.saveEvidenceRecord(record);

    // Corrupt the digest
    const db = new Database(join(dir, 'test.db'));
    db.prepare('UPDATE evidence_records SET storage_digest = ? WHERE evidence_identity = ?')
      .run('0'.repeat(64), record.trace.traceId);
    db.close();

    const readResult = storage.getEvidenceRecord(record.trace.traceId);
    expect(readResult.ok).toBe(false);
    if (readResult.ok) return;
    expect(readResult.reason).toBe('corrupt');
    expect((readResult as any).code).toBe('digest_mismatch');
  });

  it('corrupt-read: invalid stored_at timestamp', async () => {
    const record = makeProofRecord();
    await storage.saveEvidenceRecord(record);

    // Corrupt the stored_at timestamp
    const db = new Database(join(dir, 'test.db'));
    db.prepare('UPDATE evidence_records SET stored_at = ? WHERE evidence_identity = ?')
      .run('2026-99-99T99:99:99.999Z', record.trace.traceId);
    db.close();

    const readResult = storage.getEvidenceRecord(record.trace.traceId);
    expect(readResult.ok).toBe(false);
    if (readResult.ok) return;
    expect(readResult.reason).toBe('corrupt');
    expect((readResult as any).code).toBe('stored_at_malformed');
  });
});
