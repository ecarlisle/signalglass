/**
 * Spec 015 implementation tests for EvidenceStorage.
 *
 * Tests the append-only save/retrieve contract, mandatory safety gate,
 * metadata-safe reference policy, persistence-policy validation, read
 * integrity, WAL connection, and coexistence with legacy TraceStorage.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import {
  EvidenceStorage,
  createMetadataSafePolicy,
  isMetadataSafePolicy,
  StorageConfigError,
  StorageFormatError,
  EvidenceContentionError,
  EVIDENCE_CONTENTION_EXHAUSTED,
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
  type EventKind,
  CONTROL_EVENT_KINDS,
  EVENT_KINDS,
} from '@signalglass/evidence';
import { evidenceToLegacyTrace, evidenceToAgentRun } from '@signalglass/core';

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

/** URL of the committed contention-worker fixture (plain JS, no dist dependency). */
const CONTENTION_WORKER_URL = new URL('./fixtures/contention-worker.mjs', import.meta.url);

/** Row shape the contention worker inserts on its own connection (raw SQL). */
interface ContentionRow {
  evidence_identity: string;
  evidence_schema_version: string;
  storage_format_version: string;
  persistence_policy_name: string;
  persistence_policy_version: string;
  stored_at: string;
  storage_digest: string;
  serialized_record: string;
}

/**
 * Spawns the contention fixture and resolves phases in arrival order. Phases
 * are barrier messages from the worker's own event loop, so ordering between
 * 'locked' and 'committed'/'released' is guaranteed FIFO — overlap is proven
 * by the lock + message sequence, never by wall-clock timing.
 *
 * Every spawned worker is registered so the enclosing describe can assert in
 * afterAll that each one exited: a leaked worker thread (whose open message
 * port would otherwise keep the Vitest tinypool thread alive and hang the
 * root suite) must fail loudly instead of hanging silently.
 */
interface SpawnedContentionWorker {
  worker: Worker;
  phases: string[];
  waitFor: (phase: string) => Promise<void>;
  exited: () => boolean;
}

const spawnedWorkers: SpawnedContentionWorker[] = [];

function spawnContentionWorker(workerData: {
  databasePath: string;
  operation: 'hold-then-commit' | 'hold-indefinitely';
  commitDelayMs?: number;
  row: ContentionRow;
}): SpawnedContentionWorker {
  const phases: string[] = [];
  const waiters = new Map<string, Array<() => void>>();
  const worker = new Worker(CONTENTION_WORKER_URL, { workerData });
  let didExit = false;
  worker.on('exit', () => {
    didExit = true;
  });
  const releaseWaiter = (phase: string): void => {
    const pending = waiters.get(phase);
    if (pending) {
      waiters.delete(phase);
      for (const resolve of pending) resolve();
    }
  };
  // A worker-thread crash surfaces as an 'error' event on the parent's Worker;
  // route it through the phase system so tests observe the failure instead of
  // the child process crashing on an unhandled 'error' event. A test that
  // awaited a phase that never arrives fails loudly on the 10s waitFor
  // timeout.
  worker.on('error', () => {
    phases.push('error');
    releaseWaiter('error');
  });
  worker.on('message', (m: { phase: string; message?: string }) => {
    phases.push(m.phase);
    releaseWaiter(m.phase);
    if (m.phase === 'error') {
      releaseWaiter('error');
    }
  });
  const waitFor = (phase: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (phases.includes(phase)) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        // Drop the stale waiter so a late phase cannot resolve an already
        // rejected promise, and the waiter closures cannot be retained.
        waiters.delete(phase);
        reject(new Error(`Timed out waiting for worker phase '${phase}'`));
      }, 10000);
      const pending = waiters.get(phase) ?? [];
      pending.push(() => {
        clearTimeout(timer);
        resolve();
      });
      waiters.set(phase, pending);
    });
  const tracked: SpawnedContentionWorker = { worker, phases, waitFor, exited: () => didExit };
  spawnedWorkers.push(tracked);
  return tracked;
}

/** Builds the exact row the storage would store for a serialized document. */
function contentionRowFor(
  identity: string,
  document: string,
  schemaVersion: string,
): ContentionRow {
  return {
    evidence_identity: identity,
    evidence_schema_version: schemaVersion,
    storage_format_version: '1.0.0',
    persistence_policy_name: METADATA_SAFE.name,
    persistence_policy_version: METADATA_SAFE.version,
    stored_at: '2026-08-12T12:00:00.000Z',
    storage_digest: sha256Hex(utf8Encode(document)),
    serialized_record: document,
  };
}

/** Creates a database with the exact canonical schema, for adversarial open tests. */
function createCanonicalBase(dir: string): string {
  const dbPath = join(dir, 'adversarial.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE evidence_storage_meta (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE evidence_records (
      evidence_identity TEXT NOT NULL PRIMARY KEY,
      evidence_schema_version TEXT NOT NULL,
      storage_format_version TEXT NOT NULL,
      persistence_policy_name TEXT NOT NULL,
      persistence_policy_version TEXT NOT NULL,
      stored_at TEXT NOT NULL,
      storage_digest TEXT NOT NULL,
      serialized_record TEXT NOT NULL
    );
    CREATE INDEX idx_evidence_records_schema_version ON evidence_records (evidence_schema_version);
    CREATE INDEX idx_evidence_records_stored_at ON evidence_records (stored_at);
    INSERT INTO evidence_storage_meta (key, value) VALUES ('evidence_storage_format_version', '1.0.0');
  `);
  db.close();
  return dbPath;
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

  it('creates the evidence_records column contract and canonical indices (SQLite PRAGMA)', () => {
    // The read/save pipeline depends on this column contract; verify it via
    // PRAGMA rather than assuming it from CREATE TABLE success.
    const dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const db = new Database(join(dir, 'test.db'));

    // evidence_records: exact column names, order, types, NOT NULL, PK.
    const columns = db.pragma('table_info(evidence_records)') as {
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
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
    expect(columns.every((c) => c.type === 'TEXT')).toBe(true);
    expect(columns.every((c) => c.notnull === 1)).toBe(true);
    expect(columns.find((c) => c.name === 'evidence_identity')?.pk).toBe(1);
    expect(columns.filter((c) => c.pk === 1)).toHaveLength(1);

    // evidence_storage_meta: exact ledger column contract.
    const metaColumns = db.pragma('table_info(evidence_storage_meta)') as {
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }[];
    expect(metaColumns.map((c) => c.name)).toEqual(['key', 'value']);
    expect(metaColumns.map((c) => c.type)).toEqual(['TEXT', 'TEXT']);
    expect(metaColumns.map((c) => c.notnull)).toEqual([1, 1]);
    expect(metaColumns.map((c) => c.pk)).toEqual([1, 0]);

    // Canonical index set is exact, with exact columns and non-unique origin.
    const indexList = db.pragma('index_list(evidence_records)') as {
      seq: number;
      name: string;
      unique: number;
      origin: string;
      partial: number;
    }[];
    const canonical = indexList.filter((i) => i.name.startsWith('idx_evidence_'));
    expect(canonical.map((i) => i.name).sort()).toEqual([
      'idx_evidence_records_schema_version',
      'idx_evidence_records_stored_at',
    ]);
    expect(canonical.every((i) => i.origin === 'c' && i.unique === 0 && i.partial === 0)).toBe(true);
    const schemaIndex = db.pragma('index_info(idx_evidence_records_schema_version)') as {
      seqno: number;
      cid: number;
      name: string;
    }[];
    expect(schemaIndex.map((c) => c.name)).toEqual(['evidence_schema_version']);
    const storedAtIndex = db.pragma('index_info(idx_evidence_records_stored_at)') as {
      seqno: number;
      cid: number;
      name: string;
    }[];
    expect(storedAtIndex.map((c) => c.name)).toEqual(['stored_at']);
    // The administrative storage digest is intentionally unindexed (spec 015).
    const allIndexInfo = db.pragma('index_list(evidence_records)') as { name: string }[];
    for (const idx of allIndexInfo) {
      const info = db.pragma(`index_info(${JSON.stringify(idx.name)})`) as { name: string }[];
      expect(info.map((c) => c.name)).not.toContain('storage_digest');
    }

    // Ledger cardinality: exactly one format-version row.
    const ledgerCount = db
      .prepare('SELECT COUNT(*) AS n FROM evidence_storage_meta')
      .get() as { n: number };
    expect(ledgerCount.n).toBe(1);
    db.close();
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a composite index that only begins with the expected column', () => {
    const dir = tempDir();
    createCanonicalBase(dir);
    const db = new Database(join(dir, 'adversarial.db'));
    db.exec('DROP INDEX idx_evidence_records_schema_version');
    db.exec('CREATE INDEX idx_evidence_records_schema_version ON evidence_records (evidence_schema_version, stored_at)');
    db.close();
    expect(() => new EvidenceStorage(makeConfig(dir, { databasePath: join(dir, 'adversarial.db') }))).toThrow(
      StorageFormatError,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a unique index where a plain index is required', () => {
    const dir = tempDir();
    createCanonicalBase(dir);
    const db = new Database(join(dir, 'adversarial.db'));
    db.exec('DROP INDEX idx_evidence_records_schema_version');
    db.exec('CREATE UNIQUE INDEX idx_evidence_records_schema_version ON evidence_records (evidence_schema_version)');
    db.close();
    expect(() => new EvidenceStorage(makeConfig(dir, { databasePath: join(dir, 'adversarial.db') }))).toThrow(
      StorageFormatError,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses an index with the wrong column', () => {
    const dir = tempDir();
    createCanonicalBase(dir);
    const db = new Database(join(dir, 'adversarial.db'));
    db.exec('DROP INDEX idx_evidence_records_schema_version');
    db.exec('CREATE INDEX idx_evidence_records_schema_version ON evidence_records (stored_at)');
    db.close();
    expect(() => new EvidenceStorage(makeConfig(dir, { databasePath: join(dir, 'adversarial.db') }))).toThrow(
      StorageFormatError,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses an unexpected canonical index', () => {
    const dir = tempDir();
    createCanonicalBase(dir);
    const db = new Database(join(dir, 'adversarial.db'));
    db.exec('CREATE INDEX idx_evidence_records_extra ON evidence_records (evidence_schema_version)');
    db.close();
    expect(() => new EvidenceStorage(makeConfig(dir, { databasePath: join(dir, 'adversarial.db') }))).toThrow(
      StorageFormatError,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a malformed ledger table (missing value column)', () => {
    const dir = tempDir();
    createCanonicalBase(dir);
    const db = new Database(join(dir, 'adversarial.db'));
    db.exec('DROP TABLE evidence_storage_meta');
    db.exec('CREATE TABLE evidence_storage_meta (key TEXT NOT NULL PRIMARY KEY)');
    db.prepare('INSERT INTO evidence_storage_meta (key) VALUES (?)').run('evidence_storage_format_version');
    db.close();
    expect(() => new EvidenceStorage(makeConfig(dir, { databasePath: join(dir, 'adversarial.db') }))).toThrow(
      StorageFormatError,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses duplicate ledger entries', () => {
    // A ledger whose key column is not a PRIMARY KEY can hold duplicate
    // format-version rows; the constructor must refuse the duplicate.
    const dir = tempDir();
    createCanonicalBase(dir);
    const db = new Database(join(dir, 'adversarial.db'));
    db.exec('DROP TABLE evidence_storage_meta');
    db.exec('CREATE TABLE evidence_storage_meta (key TEXT, value TEXT NOT NULL)');
    db.prepare('INSERT INTO evidence_storage_meta (key, value) VALUES (?, ?)').run(
      'evidence_storage_format_version',
      '1.0.0',
    );
    db.prepare('INSERT INTO evidence_storage_meta (key, value) VALUES (?, ?)').run(
      'evidence_storage_format_version',
      '1.0.0',
    );
    db.close();
    expect(() => new EvidenceStorage(makeConfig(dir, { databasePath: join(dir, 'adversarial.db') }))).toThrow(
      StorageFormatError,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses an unexpected canonical table', () => {
    const dir = tempDir();
    createCanonicalBase(dir);
    const db = new Database(join(dir, 'adversarial.db'));
    db.exec('CREATE TABLE evidence_extra (id TEXT PRIMARY KEY)');
    db.close();
    expect(() => new EvidenceStorage(makeConfig(dir, { databasePath: join(dir, 'adversarial.db') }))).toThrow(
      StorageFormatError,
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses without mutating schema, ledger, or journal mode', () => {
    // Compatibility refusal must be side-effect free: a refused open leaves
    // the schema, the ledger row, and the journal mode exactly as they were.
    const dir = tempDir();
    createCanonicalBase(dir);
    const dbPath = join(dir, 'adversarial.db');
    const db = new Database(dbPath);
    db.prepare('UPDATE evidence_storage_meta SET value = ? WHERE key = ?').run(
      '9.0.0',
      'evidence_storage_format_version',
    );
    const beforeJournal = db.pragma('journal_mode', { simple: true });
    const beforeSchema = JSON.stringify(db.prepare("SELECT name, type FROM sqlite_master ORDER BY name").all());
    const beforeLedger = JSON.stringify(db.prepare('SELECT * FROM evidence_storage_meta').all());
    db.close();

    expect(() => new EvidenceStorage(makeConfig(dir, { databasePath: dbPath }))).toThrow(StorageFormatError);

    const db2 = new Database(dbPath);
    const afterJournal = db2.pragma('journal_mode', { simple: true });
    const afterSchema = JSON.stringify(db2.prepare("SELECT name, type FROM sqlite_master ORDER BY name").all());
    const afterLedger = JSON.stringify(db2.prepare('SELECT * FROM evidence_storage_meta').all());
    db2.close();
    expect(afterJournal).toBe(beforeJournal);
    expect(afterJournal).not.toBe('wal');
    expect(afterSchema).toBe(beforeSchema);
    expect(afterLedger).toBe(beforeLedger);
    rmSync(dir, { recursive: true, force: true });
  });

  describe('refusing non-clean canonical object sets without mutation', () => {
    interface DbStateSnapshot {
      journalMode: string;
      master: string;
      ledger: string;
      fileDigest: string;
      sideWalExists: boolean;
      sideShmExists: boolean;
    }

    function captureDbState(dbPath: string): DbStateSnapshot {
      const db = new Database(dbPath);
      const state: DbStateSnapshot = {
        journalMode: db.pragma('journal_mode', { simple: true }) as string,
        master: JSON.stringify(
          db
            .prepare('SELECT type, name, tbl_name FROM sqlite_master ORDER BY type, name, tbl_name')
            .all(),
        ),
        ledger: (() => {
          const hasLedger = db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'evidence_storage_meta'")
            .get();
          if (!hasLedger) {
            return 'NO_LEDGER_TABLE';
          }
          return JSON.stringify(db.prepare('SELECT * FROM evidence_storage_meta').all());
        })(),
        fileDigest: '',
        sideWalExists: false,
        sideShmExists: false,
      };
      db.close();
      state.fileDigest = sha256Hex(new Uint8Array(readFileSync(dbPath)));
      state.sideWalExists = existsSync(`${dbPath}-wal`);
      state.sideShmExists = existsSync(`${dbPath}-shm`);
      return state;
    }

    function expectRefusalWithoutMutation(
      dir: string,
      dbPath: string,
      setup: (db: Database.Database) => void,
    ): void {
      const db = new Database(dbPath);
      setup(db);
      db.close();
      const before = captureDbState(dbPath);

      expect(() => new EvidenceStorage(makeConfig(dir, { databasePath: dbPath }))).toThrow(
        StorageFormatError,
      );

      const after = captureDbState(dbPath);
      // A refusal must leave the schema, ledger rows, journal mode, the file
      // bytes, and the absence of WAL side files exactly as they were.
      expect(after).toEqual(before);
      expect(after.journalMode).toBe('delete');
    }

    it('refuses a database containing only an unexpected evidence_% table', () => {
      // Clean initialization is allowed only for an empty canonical object
      // set. A DB whose sole object is an unexpected canonical-named table
      // matches none of the four expected names and must be refused without
      // mutation — never silently initialized and migrated to WAL.
      const dir = tempDir();
      const dbPath = join(dir, 'refusal.db');
      expectRefusalWithoutMutation(dir, dbPath, (db) => {
        db.exec('CREATE TABLE evidence_extra (id TEXT PRIMARY KEY)');
      });
      rmSync(dir, { recursive: true, force: true });
    });

    it('refuses a database containing only an unexpected idx_evidence_% index on a legacy table', () => {
      const dir = tempDir();
      const dbPath = join(dir, 'refusal.db');
      expectRefusalWithoutMutation(dir, dbPath, (db) => {
        db.exec('CREATE TABLE legacy_notes (id TEXT PRIMARY KEY)');
        db.exec('CREATE INDEX idx_evidence_extra ON legacy_notes (id)');
      });
      rmSync(dir, { recursive: true, force: true });
    });

    it('refuses a database containing only an expected index name without the canonical tables', () => {
      const dir = tempDir();
      const dbPath = join(dir, 'refusal.db');
      expectRefusalWithoutMutation(dir, dbPath, (db) => {
        db.exec('CREATE TABLE legacy_notes (evidence_schema_version TEXT)');
        db.exec('CREATE INDEX idx_evidence_records_schema_version ON legacy_notes (evidence_schema_version)');
      });
      rmSync(dir, { recursive: true, force: true });
    });

    it('refuses an unexpected canonical object alongside an otherwise partial layout', () => {
      const dir = tempDir();
      const dbPath = join(dir, 'refusal.db');
      expectRefusalWithoutMutation(dir, dbPath, (db) => {
        db.exec('CREATE TABLE evidence_storage_meta (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL)');
        db
          .prepare('INSERT INTO evidence_storage_meta (key, value) VALUES (?, ?)')
          .run('evidence_storage_format_version', '1.0.0');
        db.exec('CREATE TABLE evidence_extra (id TEXT PRIMARY KEY)');
      });
      rmSync(dir, { recursive: true, force: true });
    });

    it('refuses a stray canonical index on a noncanonical table even when the canonical layout is complete', () => {
      // Ownership-evasion regression: an unexpected idx_evidence_% index on a
      // NONCANONICAL table never appears in PRAGMA index_list(evidence_records),
      // so the unexpected-index check must scan sqlite_master globally.
      const dir = tempDir();
      createCanonicalBase(dir);
      const dbPath = join(dir, 'adversarial.db');
      expectRefusalWithoutMutation(dir, dbPath, (db) => {
        db.exec('CREATE TABLE legacy_notes (id TEXT PRIMARY KEY)');
        db.exec('CREATE INDEX idx_evidence_extra ON legacy_notes (id)');
      });
      rmSync(dir, { recursive: true, force: true });
    });

    it('refuses a required index name attached to the wrong table even when the rest is complete', () => {
      const dir = tempDir();
      createCanonicalBase(dir);
      const dbPath = join(dir, 'adversarial.db');
      expectRefusalWithoutMutation(dir, dbPath, (db) => {
        db.exec('DROP INDEX idx_evidence_records_stored_at');
        db.exec('CREATE TABLE legacy_notes (stored_at TEXT)');
        db.exec('CREATE INDEX idx_evidence_records_stored_at ON legacy_notes (stored_at)');
      });
      rmSync(dir, { recursive: true, force: true });
    });
  });

  it('rolls back partially-created canonical objects when initialization fails', () => {
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

  it('decides idempotency by exact stored text, never by digest equality', () => {
    // Regression: even when the persisted row's recorded digest coincides with
    // the supplied document's digest (a simulated collision), different text
    // for the same identity MUST be a conflict. The deciding comparison is
    // exact stored-text equality, never digest equality (spec 015).
    const record = makeProofRecord();
    const first = storage.saveEvidenceRecord(record);
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
    const outcome = storage.saveEvidenceRecord(conflicting);
    expect(outcome.status).toBe('conflict');
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

  it('keeps persistence-policy metadata out of the stored document', () => {
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
    const save = storage.saveEvidenceRecord(record);
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

// ---------------------------------------------------------------------------
// Metadata-safe policy matrix (spec 015 §5): every event kind, in both raw
// (observation payload) and projected (derived event) representations, with
// the normative cells: null control payloads, optional exitCode/topK/
// resultCount, nested usage allowlist, analysis/completeness, and unknown
// nested fields failing closed.
// ---------------------------------------------------------------------------
type MatrixRow = {
  kind: EventKind;
  /** Conforming payload (null for lifecycle control kinds). */
  payload: Record<string, unknown> | null;
  /** Removes the schema-optional field for the optionality cell. */
  withoutOptional?: (payload: Record<string, unknown>) => void;
  /** Injects an unknown nested field for the fail-closed cell. */
  injectUnknown?: (payload: Record<string, unknown>) => void;
};

const POLICY_MATRIX: MatrixRow[] = [
  { kind: 'interaction_start', payload: null },
  { kind: 'interaction_end', payload: null },
  { kind: 'span_start', payload: { span: { kind: 'model', name: 'model:claude-sonnet-4', parentSpanId: null } } },
  { kind: 'span_end', payload: { durationMs: 3000 } },
  {
    kind: 'model_request',
    payload: {
      requestEnvelope: { model: 'claude-sonnet-4', provider: 'anthropic', providerNativeFidelity: 'structurally_faithful' },
      contextContributions: [],
    },
    injectUnknown: (p) => {
      (p['contextContributions'] as unknown[]).push({ artifactId: 'a-1', locator: { type: 'whole' }, position: 0, provenanceState: 'recorded', extra: 'x' });
    },
  },
  {
    kind: 'model_response',
    payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', finishReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 2 } } },
    injectUnknown: (p) => {
      (p['responseEnvelope'] as Record<string, unknown>)['usage'] = { inputTokens: 1, extra: 'x' };
    },
  },
  {
    kind: 'model_response_chunk',
    payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', chunkIndex: 0 } },
  },
  {
    kind: 'model_usage',
    payload: { usage: { evidenceStatus: 'captured', inputTokens: { value: 3 }, outputTokens: { value: 1 } } },
    injectUnknown: (p) => {
      (p['usage'] as Record<string, unknown>)['totalTokens'] = 7; // plain number, not UsageValue
    },
  },
  {
    kind: 'tool_call',
    payload: { tool: { name: 'tool-x', arguments: null } },
    injectUnknown: (p) => {
      (p['tool'] as Record<string, unknown>)['extra'] = 'x';
    },
  },
  {
    kind: 'tool_result',
    payload: { toolResult: { exitCode: 0, stdout: null, stderr: null } },
    withoutOptional: (p) => {
      delete (p['toolResult'] as Record<string, unknown>)['exitCode'];
    },
    injectUnknown: (p) => {
      (p['toolResult'] as Record<string, unknown>)['extra'] = 'x';
    },
  },
  {
    kind: 'mcp_request',
    payload: { mcp: { server: 'srv', tool: 'tool-x', arguments: null } },
    injectUnknown: (p) => {
      (p['mcp'] as Record<string, unknown>)['extra'] = 'x';
    },
  },
  {
    kind: 'mcp_result',
    payload: { mcpResult: { content: null } },
    injectUnknown: (p) => {
      (p['mcpResult'] as Record<string, unknown>)['extra'] = 'x';
    },
  },
  {
    kind: 'retrieval_request',
    payload: { retrieval: { query: 'find x', topK: 5 } },
    withoutOptional: (p) => {
      delete (p['retrieval'] as Record<string, unknown>)['topK'];
    },
    injectUnknown: (p) => {
      p['extraTop'] = 'x';
    },
  },
  {
    kind: 'retrieval_result',
    payload: { retrievalResult: { query: 'find x', resultCount: 3 } },
    withoutOptional: (p) => {
      delete (p['retrievalResult'] as Record<string, unknown>)['resultCount'];
    },
    injectUnknown: (p) => {
      p['extraTop'] = 'x';
    },
  },
  {
    kind: 'context_provider_request',
    payload: { contextProvider: { name: 'provider-x', kind: 'file' } },
    injectUnknown: (p) => {
      (p['contextProvider'] as Record<string, unknown>)['extra'] = 'x';
    },
  },
  {
    kind: 'context_provider_result',
    payload: { contextProvider: { name: 'provider-x', kind: 'file' } },
    injectUnknown: (p) => {
      (p['contextProvider'] as Record<string, unknown>)['extra'] = 'x';
    },
  },
  {
    kind: 'context_assembled',
    payload: { contextContributions: [] },
    injectUnknown: (p) => {
      (p['contextContributions'] as unknown[]).push({ artifactId: 'a-1', locator: { type: 'whole' }, position: 0, provenanceState: 'recorded', extra: 'x' });
    },
  },
  {
    kind: 'error',
    payload: { actor: 'tool', lifecycleTarget: 'trace', lifecycleEffect: 'fail', error: { type: 'timeout' } },
    injectUnknown: (p) => {
      (p['error'] as Record<string, unknown>)['extra'] = 'x';
    },
  },
  {
    kind: 'cancelled',
    payload: { lifecycleTarget: 'trace', lifecycleEffect: 'cancel', cancellation: { requestedBy: 'user' } },
    injectUnknown: (p) => {
      (p['cancellation'] as Record<string, unknown>)['extra'] = 'x';
    },
  },
  {
    kind: 'retry',
    payload: { retry: { originalRequestEventId: 'evt-model_request-2', attempt: 2 } },
    injectUnknown: (p) => {
      (p['retry'] as Record<string, unknown>)['extra'] = 'x';
    },
  },
];

// fallow-ignore-next-line complexity
function recordWithKind(kind: EventKind, payload: Record<string, unknown> | null): EvidenceRecord {
  const record = makeProofRecord();
  if (kind === 'interaction_start' || kind === 'interaction_end' || kind === 'span_start' || kind === 'span_end') {
    const obs = record.rawObservations.find((o) => o.kind === kind);
    if (!obs) throw new Error(`base record missing ${kind} observation`);
    if (payload !== null) {
      obs.payload = payload as EvidenceObservation['payload'];
    }
    return rebuildRecord(record);
  }
  if (kind === 'error' || kind === 'cancelled') {
    // Terminal lifecycle events must be the final applicable event: build a
    // minimal interaction that ends with the error/cancellation targeting the
    // trace (mirrors the evidence lifecycle fixtures; spec 014 §4.7).
    const observations: EvidenceObservation[] = [
      makeObservation({ kind: 'interaction_start', seq: 0, traceId: record.trace.traceId, payload: null }),
      makeObservation({
        kind: 'span_start',
        seq: 1,
        traceId: record.trace.traceId,
        spanId: 'sp-1',
        payload: { span: { kind: 'model', name: 'model:claude-sonnet-4', parentSpanId: null } },
      }),
      makeObservation({ kind, seq: 2, traceId: record.trace.traceId, spanId: null, payload }),
    ];
    return rebuildRecord({ ...record, rawObservations: observations });
  }
  const observations = [...record.rawObservations];
  if (kind === 'retry') {
    // A retry must reference an existing request event; keep the base record's
    // model_request (evt-model_request-2) and place the retry after it.
    observations[3] = makeObservation({
      kind,
      seq: 3,
      traceId: record.trace.traceId,
      spanId: 'span-1',
      observationRole: 'application_constructed',
      evidenceStatus: 'captured',
      payload,
    });
  } else if (kind === 'retrieval_request' || kind === 'retrieval_result') {
    // These payloads carry required content (query); mark the observation
    // declared so the reference policy admits it.
    observations[2] = makeObservation({
      kind,
      seq: 2,
      traceId: record.trace.traceId,
      spanId: 'span-1',
      observationRole: 'application_constructed',
      evidenceStatus: 'redacted',
      payload,
    });
  } else {
    observations[2] = makeObservation({
      kind,
      seq: 2,
      traceId: record.trace.traceId,
      spanId: 'span-1',
      observationRole: 'application_constructed',
      evidenceStatus: 'captured',
      payload,
    });
  }
  return rebuildRecord({ ...record, rawObservations: observations });
}

describe('metadata-safe policy matrix', () => {
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

  it.each(POLICY_MATRIX)('admits every event kind with a conforming payload: $kind', ({ kind, payload }) => {
    // The same save exercises both the raw observation path and the derived
    // projected event path; both must admit the conforming payload.
    const record = recordWithKind(kind, payload);
    const outcome = storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('stored');
  });

  it.each(POLICY_MATRIX.filter((row) => row.withoutOptional))(
    'admits $kind with its schema-optional field absent',
    ({ kind, payload, withoutOptional }) => {
      const cloned = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
      withoutOptional?.(cloned);
      const record = recordWithKind(kind, cloned);
      const outcome = storage.saveEvidenceRecord(record);
      expect(outcome.status).toBe('stored');
    },
  );

  it.each(POLICY_MATRIX.filter((row) => row.injectUnknown))(
    'fails closed on an unknown nested field: $kind',
    ({ kind, payload, injectUnknown }) => {
      const cloned = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
      injectUnknown?.(cloned);
      const record = recordWithKind(kind, cloned);
      const outcome = storage.saveEvidenceRecord(record);
      expect(outcome.status).toBe('policy-rejected');
    },
  );

  it('admits nested response usage only from the numeric allowlist', () => {
    const ok = recordWithKind('model_response', {
      responseEnvelope: {
        providerNativeFidelity: 'structurally_faithful',
        finishReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      },
    });
    expect(storage.saveEvidenceRecord(ok).status).toBe('stored');

    const extra = recordWithKind('model_response', {
      responseEnvelope: {
        providerNativeFidelity: 'structurally_faithful',
        finishReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, extra: 'x' },
      },
    });
    const rejected = storage.saveEvidenceRecord(extra);
    expect(rejected.status).toBe('policy-rejected');
    if (rejected.status !== 'policy-rejected') return;
    expect(rejected.code).toBe('captured-content');
  });

  it('classifies analysis and completeness records under the reference policy', () => {
    const record = makeProofRecord();
    const outcome = storage.saveEvidenceRecord(record);
    expect(outcome.status).toBe('stored');
    if (outcome.status !== 'stored') return;

    // Unknown additive field on the analysis object fails closed.
    const badAnalysis = rebuildRecord(makeProofRecord());
    (badAnalysis.analysis as unknown as Record<string, unknown>)['extraField'] = 'x';
    const rejectedAnalysis = storage.saveEvidenceRecord(badAnalysis);
    expect(rejectedAnalysis.status).toBe('policy-rejected');
    if (rejectedAnalysis.status !== 'policy-rejected') return;
    expect(rejectedAnalysis.code).toBe('unknown-additive-field');

    // Unknown additive field on the completeness object fails closed.
    const badCompleteness = rebuildRecord(makeProofRecord());
    (badCompleteness.completeness as unknown as Record<string, unknown>)['extraField'] = 'x';
    const rejectedCompleteness = storage.saveEvidenceRecord(badCompleteness);
    expect(rejectedCompleteness.status).toBe('policy-rejected');
    if (rejectedCompleteness.status !== 'policy-rejected') return;
    expect(rejectedCompleteness.code).toBe('unknown-additive-field');
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

  it('is deterministic: the same malformed decision produces the identical outcome every time', () => {
    const dir = tempDir();
    const malformedPolicy: PersistencePolicy = {
      name: 'test.malformed',
      version: '1.0.0',
      decide: () => 'sk-abc1234567890' as unknown as PersistencePolicyDecision,
    };
    const storage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: malformedPolicy }));
    const record = makeProofRecord();
    const first = storage.saveEvidenceRecord(record);
    const second = storage.saveEvidenceRecord(record);
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

  it('handles a concurrent write on a different identity without interference', async () => {
    // Genuine two-connection contention on one WAL database: the worker's own
    // connection holds a write lock (barrier: 'locked' received before the
    // save starts) while the storage saves a different identity. The worker
    // commits on its own event loop ('committed' is received only after the
    // save returns, FIFO from the same worker), so the two writers provably
    // overlapped; both rows must exist and both saves must succeed.
    const dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const worker = spawnContentionWorker({
      databasePath: join(dir, 'test.db'),
      operation: 'hold-then-commit',
      commitDelayMs: 150,
      row: contentionRowFor('trace-xyz', serializeEvidenceRecord(makeProofRecord({ traceId: 'trace-xyz' })), '1.0.0'),
    });
    try {
      await worker.waitFor('locked');
      const record = makeProofRecord();
      const outcome = storage.saveEvidenceRecord(record);
      await worker.waitFor('committed');
      expect(outcome.status).toBe('stored');
      if (outcome.status !== 'stored') return;
      const a = storage.getEvidenceRecord('trace-abc');
      const b = storage.getEvidenceRecord('trace-xyz');
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      expect(worker.phases[0]).toBe('locked');
      expect(worker.phases[worker.phases.length - 1]).toBe('committed');
    } finally {
      await worker.worker.terminate();
      storage.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves a same-identity write race with a structured already-present', async () => {
    // The worker holds a write lock with the EXACT row the save would store
    // (byte-identical serialized text, same digest). The save blocks on its
    // BEGIN IMMEDIATE until the worker commits, then re-reads the persisted
    // row inside its own transaction and classifies `already-present` — never
    // a raw constraint error (spec 015: concurrency/transactional conflicts).
    const dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    const identity = record.trace.traceId;
    const storedDocument = serializeEvidenceRecord(record);
    const worker = spawnContentionWorker({
      databasePath: join(dir, 'test.db'),
      operation: 'hold-then-commit',
      commitDelayMs: 150,
      row: contentionRowFor(identity, storedDocument, record.evidenceSchemaVersion),
    });
    try {
      await worker.waitFor('locked');
      const outcome = storage.saveEvidenceRecord(record);
      await worker.waitFor('committed');
      expect(outcome.status).toBe('already-present');
      if (outcome.status !== 'already-present') return;
      expect(outcome.digest).toBe(sha256Hex(utf8Encode(storedDocument)));
    } finally {
      await worker.worker.terminate();
      storage.close();
    }
    const db = new Database(join(dir, 'test.db'));
    const count = (db.prepare('SELECT COUNT(*) AS c FROM evidence_records').get() as { c: number }).c;
    db.close();
    expect(count).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves a same-identity write race with a structured conflict', async () => {
    // Same race as above, but the worker commits DIFFERENT text for the same
    // identity: the loser must observe a structured `conflict` derived from
    // the persisted row, and the winning row must remain byte-identical.
    const dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const identity = 'trace-race';
    const winner = makeProofRecord({ traceId: identity, captureProfile: { name: 'dev-racing', version: '1.2.0' } });
    const loser = makeProofRecord({ traceId: identity });
    const winningDocument = serializeEvidenceRecord(winner);
    const losingDocument = serializeEvidenceRecord(loser);
    expect(winningDocument).not.toBe(losingDocument);

    const worker = spawnContentionWorker({
      databasePath: join(dir, 'test.db'),
      operation: 'hold-then-commit',
      commitDelayMs: 150,
      row: contentionRowFor(identity, winningDocument, winner.evidenceSchemaVersion),
    });
    try {
      await worker.waitFor('locked');
      const outcome = storage.saveEvidenceRecord(loser);
      await worker.waitFor('committed');
      expect(outcome.status).toBe('conflict');
      if (outcome.status !== 'conflict') return;
      expect(outcome.existingDigest).toBe(sha256Hex(utf8Encode(winningDocument)));
      expect(outcome.suppliedDigest).toBe(sha256Hex(utf8Encode(losingDocument)));
      expect(outcome.storedAt).toBe('2026-08-12T12:00:00.000Z');
    } finally {
      await worker.worker.terminate();
      storage.close();
    }
    // The winning row is preserved byte-identical and only one row exists.
    const db = new Database(join(dir, 'test.db'));
    const row = db
      .prepare('SELECT serialized_record FROM evidence_records WHERE evidence_identity = ?')
      .get(identity) as { serialized_record: string };
    expect(row.serialized_record).toBe(winningDocument);
    const count = (db.prepare('SELECT COUNT(*) AS c FROM evidence_records').get() as { c: number }).c;
    db.close();
    expect(count).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('exhausts the bounded retry policy with a typed environmental error', async () => {
    // The worker holds the write lock indefinitely. The save must retry a
    // bounded number of times (each attempt busy-waits up to the internal
    // busy timeout) and then raise EvidenceContentionError — an environmental
    // error, NOT a structured outcome, and never a raw unique-constraint
    // escape. The error carries no record content, identity, digest, or
    // timestamp, and nothing is persisted.
    const dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    const identity = record.trace.traceId;
    const storedDocument = serializeEvidenceRecord(record);
    const worker = spawnContentionWorker({
      databasePath: join(dir, 'test.db'),
      operation: 'hold-indefinitely',
      row: contentionRowFor(identity, storedDocument, record.evidenceSchemaVersion),
    });
    try {
      await worker.waitFor('locked');
      const startedAt = Date.now();
      let outcome: SaveOutcome | undefined;
      let error: unknown;
      try {
        outcome = storage.saveEvidenceRecord(record);
      } catch (err) {
        error = err;
      }
      const elapsedMs = Date.now() - startedAt;
      worker.worker.postMessage({ command: 'release' });
      await worker.waitFor('released');

      // No structured outcome may be fabricated under contention exhaustion.
      expect(outcome).toBeUndefined();
      expect(error).toBeInstanceOf(EvidenceContentionError);
      if (!(error instanceof EvidenceContentionError)) return;
      expect(error.code).toBe(EVIDENCE_CONTENTION_EXHAUSTED);
      // Bounded: the loop exhausted its retries instead of spinning forever.
      expect(elapsedMs).toBeGreaterThan(2000);

      // The fixed message leaks no record content, identity, digest, or timestamp.
      const message = error.message;
      expect(message).not.toContain(identity);
      expect(message).not.toContain(storedDocument);
      expect(message).not.toContain(sha256Hex(utf8Encode(storedDocument)));
      expect(message).not.toContain('2026-');

      // Nothing was committed by the failed save (worker rolled back).
      const read = storage.getEvidenceRecord(identity);
      expect(read.ok).toBe(false);
    } finally {
      try {
        worker.worker.postMessage({ command: 'release' });
      } catch {
        // Worker already released and exited.
      }
      await worker.worker.terminate();
      storage.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  it('recovers normally once contention clears', async () => {
    // After exhaustion the storage connection must remain usable: releasing
    // the worker's lock lets a subsequent save of the same identity succeed.
    const dir = tempDir();
    const storage = new EvidenceStorage(makeConfig(dir));
    const record = makeProofRecord();
    const storedDocument = serializeEvidenceRecord(record);
    const worker = spawnContentionWorker({
      databasePath: join(dir, 'test.db'),
      operation: 'hold-indefinitely',
      row: contentionRowFor(record.trace.traceId, storedDocument, record.evidenceSchemaVersion),
    });
    try {
      await worker.waitFor('locked');
      let exhausted: unknown;
      try {
        storage.saveEvidenceRecord(record);
      } catch (err) {
        exhausted = err;
      }
      expect(exhausted).toBeInstanceOf(EvidenceContentionError);
      worker.worker.postMessage({ command: 'release' });
      await worker.waitFor('released');

      // The worker rolled back its row; a fresh save now succeeds.
      const retry = storage.saveEvidenceRecord(record);
      expect(retry.status).toBe('stored');
    } finally {
      try {
        worker.worker.postMessage({ command: 'release' });
      } catch {
        // Worker already released and exited.
      }
      await worker.worker.terminate();
      storage.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  afterAll(() => {
    // Leaked-worker guard: every contention worker must have exited by the
    // time the describe completes. A live nested worker thread with an open
    // message port would keep the Vitest tinypool thread (and therefore the
    // whole root suite) alive forever; fail loudly instead of hanging.
    for (const tracked of spawnedWorkers) {
      expect(tracked.exited(), `contention worker leaked (never terminated): ${tracked.phases.join(',')}`).toBe(
        true,
      );
    }
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

  it('explicitly undefined optional properties are absent after round trip', () => {
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

describe('Projection parity through persistence', () => {
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

  it('projects the serializer-snapshot legacy views and full reports exactly from persisted data', () => {
    // Spec 015's normative baseline for a persisted record is the serializer
    // snapshot: parseEvidenceRecord(JSON.parse(serializeEvidenceRecord(caller))).record.
    // Project that snapshot with the real compatibility projectors, save the
    // caller input, retrieve, project again, and require exact equality of
    // both views and the full ProjectionReport values. Caller-input
    // projection is never called the "pre-persistence snapshot".
    const caller = makeProofRecord();
    const snapshotParsed = parseEvidenceRecord(JSON.parse(serializeEvidenceRecord(caller)));
    expect(snapshotParsed.ok).toBe(true);
    if (!snapshotParsed.ok) return;
    const snapshot = snapshotParsed.record;

    const snapshotTrace = evidenceToLegacyTrace(snapshot);
    const snapshotRun = evidenceToAgentRun(snapshot);
    expect(snapshotTrace.ok).toBe(true);
    expect(snapshotRun.ok).toBe(true);
    if (!snapshotTrace.ok || !snapshotRun.ok) return;

    const outcome = storage.saveEvidenceRecord(caller);
    expect(outcome.status).toBe('stored');
    if (outcome.status !== 'stored') return;

    const read = storage.getEvidenceRecord(caller.trace.traceId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const persistedTrace = evidenceToLegacyTrace(read.record);
    const persistedRun = evidenceToAgentRun(read.record);
    expect(persistedTrace.ok).toBe(true);
    expect(persistedRun.ok).toBe(true);
    if (!persistedTrace.ok || !persistedRun.ok) return;

    expect(persistedTrace.view).toEqual(snapshotTrace.view);
    expect(persistedTrace.report).toEqual(snapshotTrace.report);
    expect(persistedRun.view).toEqual(snapshotRun.view);
    expect(persistedRun.report).toEqual(snapshotRun.report);
  });

  it('asserts the explicit-undefined representation loss, then projects the serializer snapshot and persisted record identically', () => {
    // Representation-sensitive parity through real save/retrieval. The caller
    // owns an optional property whose value is explicitly undefined; the JSON
    // round trip cannot represent that ownership, so the serializer snapshot
    // loses it. The normative baseline is the snapshot, not the caller record:
    // we first assert the representation loss itself (caller owns the
    // property, snapshot does not, value-level JSON meaning otherwise
    // equivalent), then require the snapshot and the persisted record to
    // project identically with both real projectors.
    const caller = makeProofRecord();
    (caller as { trace: { conditions?: unknown } }).trace.conditions = undefined;
    expect(Object.prototype.hasOwnProperty.call(caller.trace, 'conditions')).toBe(true);

    const snapshotText = serializeEvidenceRecord(caller);
    const snapshotParsed = parseEvidenceRecord(JSON.parse(snapshotText));
    expect(snapshotParsed.ok).toBe(true);
    if (!snapshotParsed.ok) return;
    const snapshot = snapshotParsed.record;

    // The representation loss: the snapshot no longer owns the property, and
    // the two representations carry the same value-level JSON meaning.
    expect(Object.prototype.hasOwnProperty.call(snapshot.trace, 'conditions')).toBe(false);
    expect(JSON.parse(JSON.stringify(caller))).toEqual(JSON.parse(JSON.stringify(snapshot)));

    const snapshotTrace = evidenceToLegacyTrace(snapshot);
    const snapshotRun = evidenceToAgentRun(snapshot);
    expect(snapshotTrace.ok).toBe(true);
    expect(snapshotRun.ok).toBe(true);
    if (!snapshotTrace.ok || !snapshotRun.ok) return;

    const outcome = storage.saveEvidenceRecord(caller);
    expect(outcome.status).toBe('stored');
    if (outcome.status !== 'stored') return;

    const read = storage.getEvidenceRecord(caller.trace.traceId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect((read.record as { trace: { conditions?: unknown } }).trace.conditions).toBeUndefined();

    const persistedTrace = evidenceToLegacyTrace(read.record);
    const persistedRun = evidenceToAgentRun(read.record);
    expect(persistedTrace.ok).toBe(true);
    expect(persistedRun.ok).toBe(true);
    if (!persistedTrace.ok || !persistedRun.ok) return;

    expect(persistedTrace.view).toEqual(snapshotTrace.view);
    expect(persistedTrace.report).toEqual(snapshotTrace.report);
    expect(persistedRun.view).toEqual(snapshotRun.view);
    expect(persistedRun.report).toEqual(snapshotRun.report);
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

  it('persisted unknown-additive-field round-trip under admitting custom policy', () => {
    const admittingPolicy: PersistencePolicy = {
      name: 'test.admitting',
      version: '1.0.0',
      decide: () => ({ accept: true } as PersistencePolicyDecision),
    };
    const admittingStorage = new EvidenceStorage(makeConfig(dir, { persistencePolicy: admittingPolicy }));

    const record = makeProofRecord();
    (record as any).customField = 'custom-value';

    const saveResult = admittingStorage.saveEvidenceRecord(record);
    expect(saveResult.status).toBe('stored');

    const readResult = admittingStorage.getEvidenceRecord(record.trace.traceId);
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;

    // Custom field should survive round-trip
    expect((readResult.record as any).customField).toBe('custom-value');
    admittingStorage.close();
  });

  it('legacy deleteTrace does not touch canonical rows', () => {
    // Save a canonical record
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);

    // Open legacy TraceStorage on the same database
    const legacyStorage = new TraceStorage({ databasePath: join(dir, 'test.db') });

    // Call deleteTrace (should not affect canonical rows)
    legacyStorage.deleteTrace(record.trace.traceId);
    legacyStorage.close();

    // Verify canonical record still exists
    const readResult = storage.getEvidenceRecord(record.trace.traceId);
    expect(readResult.ok).toBe(true);
  });

  it('legacy deleteExpiredTraces does not touch canonical rows', () => {
    // Save a canonical record
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);

    // Open legacy TraceStorage on the same database
    const legacyStorage = new TraceStorage({ databasePath: join(dir, 'test.db') });

    // Call deleteExpiredTraces (should not affect canonical rows)
    legacyStorage.deleteExpiredTraces();
    legacyStorage.close();

    // Verify canonical record still exists
    const readResult = storage.getEvidenceRecord(record.trace.traceId);
    expect(readResult.ok).toBe(true);
  });

  it('corrupt-read: malformed JSON', () => {
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);

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

  it('corrupt-read: digest mismatch', () => {
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);

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

  it('corrupt-read: invalid stored_at timestamp', () => {
    const record = makeProofRecord();
    storage.saveEvidenceRecord(record);

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
