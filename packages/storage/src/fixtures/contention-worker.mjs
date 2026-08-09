/**
 * Spec 015 test fixture: an independently executing second SQLite connection.
 *
 * The worker opens the same WAL database on its own better-sqlite3 connection
 * and performs raw SQL only. It never imports the storage package, so it runs
 * from a clean checkout without any build artifacts (no `dist/` dependency).
 *
 * Protocol (barrier-based, no timing assumptions for overlap):
 *
 *   hold-then-commit  — BEGIN IMMEDIATE + INSERT, post `{phase:'locked'}`,
 *                       then commit on the worker's own timer and post
 *                       `{phase:'committed'}`. While the worker holds the
 *                       write lock, a main-thread storage save is provably
 *                       blocked at its own BEGIN IMMEDIATE; the commit lands
 *                       inside that window and the save's in-transaction
 *                       re-read observes the persisted row.
 *
 *   hold-indefinitely — BEGIN IMMEDIATE + INSERT, post `{phase:'locked'}`, and
 *                       hold the write lock until the parent posts
 *                       `{command:'release'}`; then ROLLBACK and post
 *                       `{phase:'released'}`. Used to exhaust the storage's
 *                       bounded retry policy.
 *
 * workerData: {
 *   databasePath: string,
 *   operation: 'hold-then-commit' | 'hold-indefinitely',
 *   commitDelayMs?: number,            // hold-then-commit only
 *   row: { evidence_identity, evidence_schema_version, storage_format_version,
 *          persistence_policy_name, persistence_policy_version, stored_at,
 *          storage_digest, serialized_record }
 * }
 */
import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';

const { databasePath, operation, commitDelayMs, row } = workerData;

const port = parentPort;
if (!port) {
  throw new Error('contention-worker must run as a worker thread');
}

/** Closes the message port so the thread exits naturally after the final phase. */
function finish(phase, message) {
  try {
    port.postMessage(message ?? { phase });
  } finally {
    // Closing the port removes the last active handle: the thread exits on its
    // own even if the parent never calls terminate(). This guarantees the
    // nested worker thread cannot keep the Vitest tinypool thread alive.
    port.close();
  }
}

let db;
try {
  db = new Database(databasePath, { timeout: 0 });
  const insert = db.prepare(
    `INSERT INTO evidence_records (
       evidence_identity, evidence_schema_version, storage_format_version,
       persistence_policy_name, persistence_policy_version, stored_at,
       storage_digest, serialized_record
     ) VALUES (
       @evidence_identity, @evidence_schema_version, @storage_format_version,
       @persistence_policy_name, @persistence_policy_version, @stored_at,
       @storage_digest, @serialized_record
     )`
  );

  db.exec('BEGIN IMMEDIATE');
  insert.run(row);
  port.postMessage({ phase: 'locked' });

  if (operation === 'hold-indefinitely') {
    port.on('message', (msg) => {
      if (msg && msg.command === 'release') {
        try {
          db.exec('ROLLBACK');
          db.close();
          finish('released');
        } catch (err) {
          try {
            db.close();
          } catch {
            // ignore close failure while reporting the primary error
          }
          finish('error', { phase: 'error', message: String(err) });
        }
      }
    });
  } else {
    setTimeout(() => {
      try {
        db.exec('COMMIT');
        db.close();
        finish('committed');
      } catch (err) {
        try {
          db.close();
        } catch {
          // ignore close failure while reporting the primary error
        }
        finish('error', { phase: 'error', message: String(err) });
      }
    }, commitDelayMs ?? 150);
  }
} catch (err) {
  if (db) {
    try {
      db.close();
    } catch {
      // ignore close failure while reporting the primary error
    }
  }
  finish('error', { phase: 'error', message: String(err) });
}
