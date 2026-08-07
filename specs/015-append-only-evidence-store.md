# Spec 015: Append-only evidence store

## Status

**Draft.** Proposed for architectural review; not Accepted and not to be
implemented until accepted. This specification is documentation-only; the
PR that introduces it MUST NOT contain production code changes.

## Purpose

Define the smallest honest persistence increment that can store and retrieve
authoritative canonical `EvidenceRecord` values (Spec 013 §1.2) beside the
existing legacy `TraceStorage` (Spec 007) without:

- overwriting evidence;
- silently normalizing or redacting canonical records;
- confusing collection, persistence, and export policy (Spec 013 §9);
- breaking the existing legacy `TraceStorage`;
- beginning ingress, streaming, measurement, UI, or consumer migration.

The store persists one complete, validated `EvidenceRecord` per interaction
as an immutable, self-describing serialized document, with clearly separated
administrative metadata, an explicit authoritative identity, deterministic
conflict detection, and an explicit persistence-policy admission boundary.
Deletion, retention, tombstones, revisions, migration of legacy rows, and
ingress adoption are explicitly out of scope and deferred to later
specifications.

## Relationship to the architectural foundation and prior specs

- **Spec 013 (Accepted)** is the canonical evidence contract. It defines the
  authoritative `EvidenceRecord` (§1.2), identity rules (§2.1), policy
  separation and the recording locations for policy versions (§9.2),
  administrative-versus-evidence metadata, tombstone semantics for
  administrative deletion, and the versioning rules that require evidence to
  be append-only and never rewritten in place (§10).
- **Spec 014 (Implemented, 27/27)** provides the additive TypeScript
  primitives this store consumes: `EvidenceRecord` types, the single
  `EvidenceRecordParseResult` validation contract, the deterministic
  `serializeEvidenceRecord` / `parseEvidenceRecord` JSON round trip (§5.7),
  the supported-version policy (§3.3), unknown-additive-field preservation
  (§5.3), and the compatibility projections used to verify persisted-parity
  (§6). Spec 014 explicitly ends at slice 4; **Spec 015 is not "Spec 014
  slice 5"** — it is a separate specification for persistence.
- **Spec 007 (Implemented)** defines the legacy `TraceStorage` and
  `sanitizeTraceForStorage`. Spec 015 adds canonical storage beside it and
  MUST NOT change, reuse, or reinterpret legacy storage behavior.

## Scope

- Canonical `EvidenceRecord` persistence in SQLite beside the legacy
  `traces` / `trace_events` tables.
- An append-only save/retrieve contract with structured outcomes, an
  authoritative identity, deterministic conflict detection, and a
  persistence-policy admission boundary.
- A storage manifest (administrative metadata) contract.
- A storage-format version and migration rule set.
- Coexistence and durability guarantees (restart, rollback, initialization
  against an existing legacy database).
- Privacy and diagnostic rules for stored canonical evidence.

## Non-goals

Spec 015 explicitly does not cover, and its implementation must not include:

- Production ingress migration — routing collectors or the ingress server
  onto canonical storage.
- Request/response streaming assembly.
- Provider adapter changes.
- Pi, MCP, tool, retrieval, or Graphify instrumentation.
- Native-byte capture changes (retained bytes are already serialized
  canonically by `@signalglass/evidence` §5.7; this store persists that
  serialization).
- Deterministic token, latency, usage, cost, or quality measurements.
- Analyzer or report semantic changes.
- Dashboard or trace-explorer work.
- Export workflows.
- Canonical retention/deletion/tombstone implementation (deferred to the
  later retention/deletion specification — see "Deletion and tombstones").
- Migration or deletion of legacy `TraceStorage`.
- Conversion of existing legacy rows into canonical evidence.
- Remote/cloud databases.
- Encryption-at-rest design.
- Access-control or multi-tenant design.
- Unrelated refactoring.
- Dependency upgrades.
- Any production code in this specification's PR (the PR is
  documentation-only).

## RFC-style terms

- **MUST** — a normative requirement; an implementation is not conformant
  unless it is met.
- **MUST NOT** — a normative prohibition.
- **SHOULD** — a recommendation; deviation is permitted only with documented
  justification.
- **MAY** — an optional capability.
- **Undefined** — no contract is offered; implementations MUST NOT rely on it.

## Normative terminology

| Term | Definition |
|---|---|
| **Canonical record** | An `EvidenceRecord` (Spec 013 §1.1) — the authoritative serialized evidence record of one interaction. |
| **Authoritative identity** | The storage key of a canonical record: the record's trace identity (`record.trace.traceId`, which MUST equal `record.trace.interactionId` per Spec 013 §1.2 and is enforced by `parseEvidenceRecord`). Never a database row id, digest, observation id, or content hash. |
| **Stored document** | The exact text produced by the public `serializeEvidenceRecord` serializer at write time; the single authoritative representation of the record inside the database. |
| **Storage manifest** | Administrative metadata recorded beside the stored document: storage-format version, evidence-schema version, persistence-policy name/version, storage timestamp, and the storage digest. Never part of the canonical record. |
| **Storage digest** | A deterministic SHA-256 hex digest over the exact stored-document text, used for idempotency and conflict detection. Administrative integrity/conflict metadata; never presented as canonical evidence and never conflated with `contentHash` or `nativeContentHash`. |
| **Persistence policy** | A named, versioned decision function that accepts or rejects a complete validated canonical record for persistence (Spec 013 §9.1). |
| **Storage-format version** | The version of the storage layout (tables, columns, manifest shape). Distinct from the evidence-schema version carried by the record. |
| **Tombstone** | A future administrative deletion record (Spec 013 §9.2). Explicitly out of scope here. |

## Architectural context

The target architecture (docs/architectural-foundation.md §4) persists
evidence and derivations with schema versions and migration support. This
spec implements the smallest persistence foundation for canonical evidence
in `@signalglass/storage`, keeping the existing legacy `TraceStorage`
untouched. The canonical store is a sibling capability, not a replacement:

```text
collectors / ingress (future)          @signalglass/storage
────────────────────────────           ─────────────────────
evidence records ───────────────────►  EvidenceStorage (this spec)   → evidence_records (+ storage_meta)
(Spec 013/014)                          TraceStorage (legacy, Spec 007) → traces, trace_events
```

## Dependency boundaries

- `@signalglass/evidence` MUST remain provider-, storage-, network-, and
  UI-independent with zero runtime dependencies (Spec 014 §1.1, §1.4). It is
  consumed, never modified, by this spec.
- `@signalglass/storage` is the owner of persistence. It MUST gain
  `@signalglass/evidence` as a workspace dependency (`workspace:*`) so it can
  consume public evidence types, validators, and serializers directly.
  `@signalglass/storage` retains its existing `@signalglass/core` dependency
  for the legacy `TraceStorage` surface. This is the smallest dependency
  change: one additive workspace dependency, no new external runtime
  dependencies (SQLite already uses the existing `better-sqlite3`).
- Canonical evidence MUST NOT be routed through `@signalglass/core` merely to
  reach storage; storage imports `@signalglass/evidence` directly.
- Provider logic stays in `@signalglass/providers`; ingress/network logic
  stays in `apps/ingress`; analyzer behavior stays in `@signalglass/core`.
  This spec changes none of them.

## Canonical record and administrative metadata ownership

**The stored document is authoritative; administrative columns are
index/support data.** The serialized record in `evidence_records.serialized_record`
is the single authoritative representation of the evidence. Administrative
columns (`evidence_schema_version`, `storage_format_version`,
`persistence_policy_name`, `persistence_policy_version`, `stored_at`,
`storage_digest`) and the manifest are metadata about storage operations
(Spec 013 §9.2 "administrative metadata"), MUST NOT be injected into the
`EvidenceRecord`, and MUST NOT redefine events, spans, envelopes,
declarations, or completeness. Normalized SQLite columns are NOT a second
authoritative representation of canonical evidence.

### Serialization contract

- The stored representation MUST be produced by the public
  `serializeEvidenceRecord(record): string` serializer from
  `@signalglass/evidence` (Spec 014 §5.7). No other serializer, stringifier,
  or transformation is used.
- The **exact serializer output text** MUST be preserved: the stored
  `serialized_record` value is byte-for-byte the string returned by
  `serializeEvidenceRecord` at write time. Storage MUST NOT re-encode,
  re-order, pretty-print, or otherwise alter it.
- Unknown additive fields (Spec 013 §10; Spec 014 §5.3) are preserved by the
  serializer (record-level passthrough at equivalent JSON values) and
  therefore survive storage and retrieval: `parseEvidenceRecord` carries them
  back on the parsed record. Storage MUST NOT claim lexical byte preservation
  of the *parsed* record — the stored text is preserved exactly; a caller who
  re-serializes the parsed record gets unknown fields at equivalent JSON
  values, per the `@signalglass/evidence` contract.
- On read, the stored text MUST be parsed and validated with
  `parseEvidenceRecord(JSON.parse(text))`. The parser never throws for
  malformed input; it returns the single `EvidenceRecordParseResult` union.
- When the stored record's `evidenceSchemaVersion` is unsupported by the
  reader (`checkEvidenceSchemaVersion` returns `unsupported_major`), reads
  MUST return a structured `unsupported-version` failure — never a silent
  misread and never a throw.
- Retrieval MUST expose both forms: `getEvidenceRecord(identity)` returns
  the canonical record (parsed and re-validated); `getStoredEvidence(identity)`
  returns the canonical record **plus** its `StorageManifest`.

## Append-only semantics

### Authoritative identity

The authoritative identity key is **`record.trace.traceId`** (equal to
`record.trace.interactionId`). It is:

- assigned at capture time and immutable (Spec 013 §2.1);
- opaque and never content-derived;
- unique within a SignalGlass installation;
- enforced by `parseEvidenceRecord`, which the save path runs before any
  write.

A mutable database row id, the storage digest, observation ids, and content
hashes are NEVER evidence identity.

### Observable behavior

The following behaviors MUST hold:

1. **First write.** A first save of a valid record appends exactly one
   immutable authoritative row under the record's authoritative identity.
2. **Byte-identical repeat.** Saving a record whose serialized text is
   byte-identical to an already-stored record under the same identity is
   **idempotent**: it returns `already-present` and MUST NOT create a second
   authoritative row and MUST NOT modify the existing row.
3. **Same identity, different text.** Saving a record with the same
   authoritative identity but different serialized text is a **structured
   conflict**, never an update, upsert, or overwrite: it returns `conflict`
   and the original row remains byte-identical. This is the conservative
   rule even when the two texts parse to canonically equal records: the
   stored document is the authoritative serialization, and two different
   documents for one identity are ambiguous. A future successor/revision
   mechanism (with provenance and immutable revision identity, per
   `docs/model-versioning.md`) is the only sanctioned way to represent
   changing evidence for one interaction; it is deferred, so conflicting
   same-identity writes are rejected in this slice.
4. **Restart and repeated writes.** Behavior is identical across database
   close/reopen cycles: writes are durable, and a repeated write after
   restart still resolves to `already-present` or `conflict` against the
   persisted row.
5. **Concurrency/transactional conflicts.** Writes are transactional. If two
   writers race on the same identity, exactly one wins; the loser MUST
   observe a structured `already-present` or `conflict` result derived from
   the persisted row (re-read inside the transaction), not a raw constraint
   exception surfaced as an environmental error.
6. **Partial database failures.** A failed save rolls the transaction back;
   no partial row, manifest, or index state survives. The database remains
   in its prior consistent state.
7. **Unsupported evidence-schema versions.** A save whose record carries an
   unsupported `evidenceSchemaVersion` returns `unsupported-version` and
   writes nothing (validation precedes any write; see Save pipeline).
8. **Malformed evidence.** A save of a record that fails
   `parseEvidenceRecord` returns `invalid` with the structured
   `ValidationIssue` list and writes nothing.
9. **Storage-policy rejection.** A save that the active persistence policy
   rejects returns `policy-rejected` and writes nothing.

### Immutability

Canonical evidence rows MUST NOT be updated in place. The storage layer MUST
NOT issue `UPDATE`, `REPLACE`, or `DELETE` statements against
`evidence_records` in this slice (the only statements are `INSERT` and
`SELECT`; schema/`storage_meta` writes are limited to initialization and
migration). Storage-layout migrations MAY change indices or table shape but
MUST NEVER rewrite the meaning of stored evidence.

## Persistence-policy boundary

This is the decisive policy decision for Spec 015.

**Spec 013 §9 requires collection, persistence, and export to remain
separate, and requires persistence-policy versions to be recorded on storage
metadata, never on canonical evidence.** The legacy `TraceStorage` sanitizes
`Trace` values before writing (`sanitizeTraceForStorage`); that behavior is a
legacy storage decision that MUST remain unchanged and MUST apply only to
legacy storage. Canonical evidence MUST NOT be silently rewritten.

The smallest honest boundary:

1. **Collection-time decisions stay in the evidence.** Redaction,
   truncation, and missing status are authoritative canonical evidence
   (`evidenceStatus: "redacted" | "truncated" | "missing" | …`), recorded at
   the capture boundary (Spec 013 §9.2). Storage MUST NOT change them.
2. **Canonical storage validates, then admits.** Storage runs
   `parseEvidenceRecord`; a valid record is then submitted to the active
   persistence policy's admission decision.
3. **The persistence policy accepts or rejects the complete record.** It
   MUST NOT silently strip fields, replace payloads, change evidence
   statuses, rewrite completeness, or store a modified value under the same
   authoritative identity. If the policy disallows content present in the
   record, it returns an explicit rejection; the save outcome is
   `policy-rejected` and nothing is written.
4. **No permissive full-payload default.** The storage layer MUST NOT apply
   any implicit default policy and MUST NOT ship a default that silently
   permits full raw payload persistence. `EvidenceStorage` MUST be
   constructed with an explicit persistence policy (a missing policy is a
   configuration error and the constructor throws). Nothing in Spec 015
   enables or defaults to full-fidelity capture: full-fidelity capture
   remains a collection-time decision, and a record that carries content the
   operator must not persist is either never collected under that policy or
   explicitly rejected at admission. The initial slice ships exactly one
   reference policy — **`signalglass.persistence.accept-valid` (v1.0.0)** —
   which accepts any record that already passed `parseEvidenceRecord`
   validation. This reference policy is documented as content-class-agnostic:
   it is NOT a guarantee of secret-freedom or payload-freedom, and operators
   who must reject content classes MUST author their own rejecting policy
   (policy authoring is beyond this slice; see Open questions).
5. **Persistence-time removal is not representable honestly in this slice.**
   Removing content at persistence time would require a canonical successor
   record with provenance, completeness changes, and/or an administrative
   deletion record (Spec 013 §9.2). That mechanism is deferred (see
   "Deletion and tombstones"); it is not approximated by silent stripping.
6. **Policy name/version recording.** The active policy's `name` and
   `version` MUST be recorded in the storage manifest and in
   `evidence_records` administrative columns — never inside the canonical
   record, never in `serialized_record`.

### Policy contract

```ts
export interface PersistencePolicyDecision {
  accept: boolean;
  /** Required when accept === false; a named, human-readable reason. */
  reason?: string;
}

export interface PersistencePolicy {
  /** Stable policy name, e.g. "signalglass.persistence.accept-valid". */
  name: string;
  /** Semantic version of this policy definition (Spec 013 §9.2). */
  version: string;
  /** Whole-record admission decision. MUST NOT mutate or return a modified record. */
  decide(record: EvidenceRecord): PersistencePolicyDecision;
}
```

## Deletion and tombstones

- This slice exposes **no canonical hard-delete API** that silently removes
  evidence, and it MUST NOT reuse the legacy `deleteTrace()` /
  `deleteExpiredTraces()` for canonical records (those operate on
  `traces` / `trace_events` only).
- Canonical deletion and expiry are **entirely deferred** to a later
  specification (roadmap slice "Retention, deletion records, and access
  boundaries", anticipated #37), which MUST define: tombstone semantics per
  Spec 013 §9.2 (deletion records with reason and scope, retained outside
  the deleted trace, content-free and non-sensitive), legal-erasure behavior
  including tombstone destruction where required, retained administrative
  metadata, and the completeness implications (`EvidenceRecord.completeness`
  notes) for surviving records.
- No partial deletion design is invented here merely to mirror the legacy
  API. Minimal tombstone support is NOT required for the correctness of this
  storage foundation and is therefore not added.

## Public API contract

The canonical store is a distinct class — **`EvidenceStorage`** — in
`@signalglass/storage`, exported alongside `TraceStorage` from the package
index. It MUST NOT copy the legacy API mechanically (no
`saveTrace`/`getTrace`/`deleteTrace` shape).

```ts
// types (module: @signalglass/storage, e.g. src/evidenceStorage.ts)
import type {
  EvidenceRecord,
  EvidenceRecordParseResult,
  ValidationIssue,
} from '@signalglass/evidence';

export interface StorageManifest {
  /** Storage-layout version, e.g. "1.0.0" (see Versioning and migration). */
  storageFormatVersion: string;
  /** Record's evidenceSchemaVersion, for safe lookup and version checks. */
  evidenceSchemaVersion: string;
  /** Persistence policy in effect at write time (administrative only). */
  persistencePolicy: { name: string; version: string };
  /** ISO 8601 UTC storage timestamp (injectable clock). */
  storedAt: string;
  /** SHA-256 hex over the exact stored serialized text. Administrative; never canonical. */
  storageDigest: string;
}

export type SaveOutcome =
  | { status: 'stored'; identity: string; digest: string; manifest: StorageManifest }
  | { status: 'already-present'; identity: string; digest: string }
  | {
      status: 'conflict';
      identity: string;
      existingDigest: string;
      suppliedDigest: string;
      storedAt: string;
    }
  | { status: 'invalid'; identity: string | null; issues: readonly ValidationIssue[] }
  | { status: 'unsupported-version'; version: string }
  | {
      status: 'policy-rejected';
      policy: { name: string; version: string };
      reason: string;
    };

export type EvidenceReadFailureReason = 'not-found' | 'corrupt' | 'unsupported-version';

export type EvidenceReadResult =
  | { ok: true; record: EvidenceRecord }
  | { ok: false; reason: EvidenceReadFailureReason; issues?: readonly ValidationIssue[]; version?: string };

export type StoredEvidenceReadResult =
  | { ok: true; record: EvidenceRecord; manifest: StorageManifest }
  | { ok: false; reason: EvidenceReadFailureReason; issues?: readonly ValidationIssue[]; version?: string };

export interface EvidenceStorageConfig {
  databasePath: string;
  /** Required — no implicit default policy (see Persistence-policy boundary). */
  persistencePolicy: PersistencePolicy;
  /** Injectable ISO 8601 UTC clock for storedAt; default: () => new Date().toISOString(). */
  now?: () => string;
}

export class EvidenceStorage {
  constructor(config: EvidenceStorageConfig);
  /** Validate → admit → serialize → append. Structured outcome; see Save pipeline. */
  saveEvidenceRecord(record: EvidenceRecord): SaveOutcome;
  /** Read the canonical record (parsed and re-validated) by authoritative identity. */
  getEvidenceRecord(identity: string): EvidenceReadResult;
  /** Read the canonical record plus its storage manifest. */
  getStoredEvidence(identity: string): StoredEvidenceReadResult;
  close(): void;
}
```

### Save pipeline (normative order)

1. **Version check** — `checkEvidenceSchemaVersion(record.evidenceSchemaVersion)`.
   Unsupported → `unsupported-version`; nothing written.
2. **Validation** — `parseEvidenceRecord(record)`. Failure → `invalid` with
   the issues (identity is `null` when it cannot be determined safely).
3. **Identity** — `identity = record.trace.traceId` (parser-enforced
   `=== interactionId`).
4. **Admission** — `persistencePolicy.decide(record)`. Rejection →
   `policy-rejected` with the policy name/version and the reason; nothing
   written.
5. **Serialization** — `serializeEvidenceRecord(record)` produces the stored
   document. (The serializer re-validates and throws only on an
   already-invalid record — a programming-error guard, not a data path.)
6. **Digest** — `storageDigest = sha256Hex(storedDocument)` (public
   `sha256Hex` from `@signalglass/evidence`).
7. **Append** — inside one transaction: read the existing row by identity;
   absent → `INSERT` and return `stored` with the manifest; present with
   equal digest → `already-present`; present with different digest →
   `conflict` (no write). A unique-key constraint raced by a concurrent
   writer is resolved by re-reading and classifying as `already-present` or
   `conflict` — never surfaced as a raw constraint error.

### Structured results vs. throws

- Expected invalid input, policy rejection, unsupported versions, conflicts,
  idempotent repeats, and absent/corrupt reads MUST produce structured
  results (the unions above); they MUST NOT rely on raw SQLite constraint
  exceptions and MUST NOT throw.
- Genuine environmental failures — I/O errors, disk-full, unrecoverable
  database-locked states after retry, an unsupported storage-format version
  on open, a missing persistence policy in the constructor — MAY throw.
  `parseEvidenceRecord` never throws; the only throw in the save path is the
  documented serializer programming-error guard.

## SQLite schema contract

The canonical store MUST add exactly two tables to the existing database
file and MUST NOT modify `traces` / `trace_events`. Initialization uses
`CREATE TABLE IF NOT EXISTS` and is therefore additive against an existing
legacy database.

```sql
-- Single-row storage-layout version ledger (initialization + migration).
CREATE TABLE IF NOT EXISTS storage_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- storage_meta row: key = 'storage_format_version', value = '1.0.0'

-- Immutable authoritative evidence rows. Administrative columns are clearly
-- separated from the canonical document and never redefine evidence.
CREATE TABLE IF NOT EXISTS evidence_records (
  evidence_identity          TEXT PRIMARY KEY,  -- record.trace.traceId (== interactionId); immutable
  evidence_schema_version    TEXT NOT NULL,     -- administrative lookup index (record.evidenceSchemaVersion)
  storage_format_version     TEXT NOT NULL,     -- administrative: layout version at write time
  persistence_policy_name    TEXT NOT NULL,     -- administrative (Spec 013 §9.2)
  persistence_policy_version TEXT NOT NULL,     -- administrative (Spec 013 §9.2)
  stored_at                  TEXT NOT NULL,     -- administrative; ISO 8601 UTC (injectable clock)
  storage_digest             TEXT NOT NULL,     -- administrative; sha256 hex of serialized_record
  serialized_record          TEXT NOT NULL      -- the authoritative document (exact serializer output)
);

CREATE INDEX IF NOT EXISTS idx_evidence_records_schema_version
  ON evidence_records (evidence_schema_version);
CREATE INDEX IF NOT EXISTS idx_evidence_records_stored_at
  ON evidence_records (stored_at);
```

### Contract rules

- **Primary key:** `evidence_identity` (authoritative identity). Uniqueness
  is the last-line conflict guard; the API resolves races structurally.
- **Foreign keys:** none. Canonical records are self-contained; the record
  references nothing outside itself, and nothing references its row.
- **Immutable columns:** all columns of `evidence_records` are immutable
  after insert for the life of the slice. The storage layer issues only
  `INSERT` and `SELECT` against this table.
- **Serialized-record column type:** `TEXT`, holding the exact
  `serializeEvidenceRecord` output. No BLOB, no compressed or re-encoded
  form, no JSON normalization at rest.
- **Schema/version columns:** `evidence_schema_version` (the record's
  evidence-schema version, for safe lookup and read-time refusal) and
  `storage_format_version` (the layout version, mirrored in
  `storage_meta`).
- **Digest/conflict detection:** `storage_digest` is a non-unique indexed
  administrative value (two identical documents ⇒ equal digests — the
  idempotency signal; different documents ⇒ different digests — the conflict
  signal). It is never a key.
- **Deterministic retrieval:** reads address rows by primary key only; no
  result depends on SQLite rowid, insertion order, or undocumented defaults.
- **Initial indices:** `evidence_schema_version` (safe-lookup filtering) and
  `stored_at` (deterministic listing order when listing is later added).
  No speculative query, measurement, FTS, or event-shredding tables are
  added by this slice.
- **Transaction boundaries:** every save is one transaction; the insert and
  its conflict resolution are atomic. Reads are single-statement and do not
  require transactions.
- **Initialization on an existing legacy database:** opening
  `EvidenceStorage` against a file that already contains `traces` /
  `trace_events` MUST leave those tables and all legacy rows untouched and
  MUST create only `storage_meta` and `evidence_records`.
- **Restart behavior:** close/reopen preserves all rows; re-opening runs the
  same initialization and migration checks idempotently.

## Versioning and migration rules

- **Two independent versions.** (a) The evidence-schema version lives on the
  record (`evidenceSchemaVersion`) and is governed by Spec 013 §10 / Spec
  014 §3.3: compatible additive minor/patch revisions within supported MAJOR
  1 are accepted; unknown MAJORs are refused with structured results. The
  storage layer MUST NOT migrate or rewrite records across evidence-schema
  versions. (b) The storage-format version (`storage_meta` /
  `storage_format_version`) versions the layout and manifest shape.
- **Migration changes layout, never meaning.** A future storage migration
  MAY add tables, columns, or indices and MAY rewrite the manifest shape;
  it MUST NOT rewrite or reinterpret `serialized_record`, and it MUST NOT
  change the meaning of stored evidence (`docs/model-versioning.md`).
- **Open behavior.** On open: `storage_meta` absent → create and set the
  current storage-format version (`1.0.0`); version lower than current →
  apply forward migrations in order (none exist for `1.0.0`); version higher
  than supported → refuse to open with a clear error (a newer layout must
  not be silently read or written by an older build).
- **Idempotent writes after restart** are guaranteed by the append-only
  rules; no replay log is introduced.

## Privacy and diagnostic rules

- The storage layer MUST NOT log, print, or include in diagnostics the
  `serialized_record` text, any payload content, or any recovered secret.
  Diagnostics (outcome statuses, identities, digests, policy names/versions,
  schema versions, timestamps, issue codes) are administrative and MUST NOT
  embed payload values or credential material.
- Credentials, authorization headers, API keys, and secrets MUST never be
  committed, logged, or placed in test fixtures (AGENTS.md security rules).
  Collection-time redaction (Spec 013 §9.2) is the only sanctioned way
  sensitive content is represented in canonical evidence; storage neither
  strips it nor un-redacts it, and the persistence-policy boundary provides
  the admission decision when content must not be persisted.
- The `storageDigest` is administrative integrity/conflict metadata. It MUST
  be labeled as such in documentation and code comments and MUST NOT be
  presented as canonical evidence, a content hash, or confused with
  `contentHash` / `nativeContentHash` (which are canonical evidence fields).
- No new secret stores, key files, or credential handling are introduced.

## Failure behavior

- **Structured failures (no throw):** invalid record, unsupported
  evidence-schema version, policy rejection, identity conflict, idempotent
  repeat, absent record, corrupt stored document, unsupported-version read.
- **Throwing failures (environmental/configuration):** I/O and disk
  failures, unrecoverable lock contention, unsupported storage-format
  version on open, missing persistence policy in the constructor, and the
  documented serializer programming-error guard.
- **Atomicity:** every save is transactional; a failure at any step rolls
  back and leaves the prior state intact. Reads never mutate state.

## Implementation slices

Recommended additive sequence after acceptance (each slice independently
reviewable, testable, and mergeable; none touches legacy storage, ingress,
or production consumers):

1. **Contracts and schema.** Public result/manifest/policy/config types
   (`SaveOutcome`, `StorageManifest`, `PersistencePolicy`,
   `EvidenceStorageConfig`), the additive `storage_meta` +
   `evidence_records` schema, open/version checks, and contract tests
   (serialized-shape and `PRAGMA table_info` schema pinning).
2. **Append-only save, conflict detection, retrieval.**
   `saveEvidenceRecord` with the normative pipeline, `getEvidenceRecord`,
   `getStoredEvidence`, `close`; tests for first write, idempotent repeats,
   conflicts, rollback, and close/reopen durability.
3. **Policy admission, restart, failure, privacy, coexistence.**
   Policy admission and `policy-rejected`; unsupported versions and invalid
   input; privacy/diagnostic rules; initialization against an existing
   legacy database and coexistence with `TraceStorage` on one file.
4. **Projection parity from persisted evidence.** Retrieving a persisted
   record and projecting it through `evidenceToLegacyTrace` /
   `evidenceToAgentRun` (or the composed report) MUST produce views and
   `ProjectionReport`s identical to projecting the in-memory record
   (reusing the Spec 014 paired-equality approach).
5. **Documentation and completion evidence.** Update `docs/architecture.md`,
   `docs/privacy.md`, `docs/glossary.md`, the roadmap, and the spec index;
   mark the spec Implemented only when all acceptance criteria pass.

## Testing and conformance requirements

Future implementation tests MUST cover, using Vitest and fixed fixtures (no
secrets, no raw payloads in fixtures):

- save/retrieval round trip with exact canonical-record equality (raw
  observations included);
- exact serialized-text preservation (stored document equals
  `serializeEvidenceRecord` output at write; no re-encoding);
- unknown additive field preservation across save → read → re-serialize
  (equivalent JSON values, per the `@signalglass/evidence` contract);
- validation before write (invalid → `invalid`, nothing written) and
  validation after read (corrupt stored text → `corrupt` failure);
- idempotent byte-identical writes (`already-present`, one row);
- conflicting same-identity writes (`conflict`, original row byte-identical,
  no update/upsert);
- transaction rollback on failure (no partial rows);
- close/reopen durability;
- coexistence with legacy `traces` / `trace_events` and `TraceStorage` on
  the same file; initialization against a pre-existing legacy database;
- policy name/version recorded only in administrative metadata (manifest +
  columns; absent from `serialized_record`);
- policy rejection writes nothing and leaves the record unmodified;
- absence of silent sanitization/normalization (no `sanitizeTraceForStorage`
  path; evidence statuses and completeness unchanged);
- no canonical hard-delete behavior (no delete API; legacy `deleteTrace`
  does not touch `evidence_records`);
- deterministic list ordering if listing is included (MAY; ordered by
  `stored_at`, then identity);
- safe behavior for unsupported evidence-schema versions on save and read;
- no secret values in diagnostics (sentinel-based negative tests);
- persisted vs. in-memory projection parity (identical views and
  ProjectionReports);
- serialized-shape and SQLite-schema contract tests (`PRAGMA table_info`),
  because this spec changes public persistence contracts;
- identity contract: authoritative identity is `traceId` (=== `interactionId`),
  never rowid/digest/observation id;
- storage digest is administrative and distinct from `contentHash` /
  `nativeContentHash` (contract + documentation test).

## Acceptance criteria

- [ ] A valid canonical record can be saved and retrieved, with the retrieved
  record equal to the saved record (raw observations included).
- [ ] The exact deterministic serialized-record text produced by
  `serializeEvidenceRecord` is preserved byte-for-byte in storage and
  returned unchanged as the stored document basis.
- [ ] Unknown additive fields survive storage and retrieval and re-serialize
  at equivalent JSON values (never claimed as lexical byte preservation of
  the parsed record).
- [ ] Every record is validated with `parseEvidenceRecord` before any write;
  an invalid record returns `invalid` with structured issues and writes
  nothing.
- [ ] Every read re-validates the stored document; a corrupt stored document
  returns a structured `corrupt` failure, never a throw or a silent misread.
- [ ] A byte-identical repeat save is idempotent: it returns
  `already-present` and creates no second authoritative row and no update.
- [ ] A same-identity write with different serialized text is rejected as
  `conflict` without modifying the original row in any way.
- [ ] A failing save rolls back its transaction; no partial row or index
  state survives and prior state is intact.
- [ ] A record persists across database close/reopen and reads back equal.
- [ ] `EvidenceStorage` coexists with legacy `traces` / `trace_events`
  tables and `TraceStorage` APIs on the same database file; legacy rows are
  untouched.
- [ ] Initializing `EvidenceStorage` against an existing legacy database
  leaves all legacy tables and rows unchanged and creates only the canonical
  tables.
- [ ] Persistence-policy name/version is recorded only in administrative
  metadata (manifest and columns), never inside the canonical record or its
  serialized document.
- [ ] A persistence-policy rejection returns `policy-rejected` with the
  policy identity and reason, writes nothing, and does not modify the
  record.
- [ ] No silent sanitization or normalization: the stored document is the
  exact serializer output; evidence statuses, completeness, and payloads are
  never rewritten by storage.
- [ ] No canonical hard-delete behavior exists in this slice; no API deletes
  or overwrites canonical rows, and legacy `deleteTrace()` /
  `deleteExpiredTraces()` never touch canonical rows.
- [ ] If listing is included, results are deterministically ordered
  (`stored_at`, then identity); listing is not required by this slice.
- [ ] Unsupported evidence-schema versions are refused with structured
  `unsupported-version` results on both save and read; nothing is written
  and nothing is silently misread.
- [ ] Diagnostics and logs contain no serialized-record text, payload
  content, credentials, or secret values (sentinel-based negative tests).
- [ ] Retrieved in-memory and persisted canonical records produce identical
  compatibility projections and `ProjectionReport`s
  (`evidenceToLegacyTrace` / `evidenceToAgentRun`).
- [ ] All pre-existing legacy storage, projection, and report tests remain
  unchanged and passing.
- [ ] Serialized-shape and SQLite-schema contract tests exist and pin the
  public persistence contracts changed by this spec.
- [ ] The authoritative identity is `record.trace.traceId` (equal to
  `interactionId`), enforced and tested; database row ids, digests, and
  hashes are never evidence identity.
- [ ] The storage digest is labeled administrative and documented as
  distinct from canonical `contentHash` / `nativeContentHash` fields.
- [ ] `@signalglass/storage` consumes `@signalglass/evidence` directly
  (workspace dependency); `@signalglass/evidence` remains zero-runtime-
  dependency and unchanged; no new external runtime dependencies are added.

## Explicit exclusions

Spec 015 excludes (no implementation in this spec's PR, and no planning
delegation into the slices): production ingress migration; streaming
assembly; provider adapter changes; Pi/MCP/tool/retrieval/Graphify
instrumentation; native-byte capture changes; deterministic measurements;
analyzer or report semantic changes; dashboard or trace-explorer work;
export workflows; canonical retention/deletion/tombstone implementation;
migration or deletion of legacy `TraceStorage`; conversion of legacy rows
into canonical evidence; remote/cloud databases; encryption-at-rest design;
access-control or multi-tenant design; unrelated refactoring; dependency
upgrades; and any production code in the specification PR.

## Documentation impact

When accepted and implemented, the following documentation MUST be updated
consistently with this spec:

- `docs/architecture.md` — `@signalglass/storage` section gains the
  `EvidenceStorage` responsibility and the dependency on
  `@signalglass/evidence`.
- `docs/privacy.md` — persistence-policy admission boundary, administrative
  metadata separation, and the absence of canonical hard-delete in this
  slice.
- `docs/capture-profiles.md` — persistence-policy recording location (already
  aligned; add the `EvidenceStorage` manifest reference).
- `docs/model-versioning.md` — storage-format version vs. evidence-schema
  version distinction (already aligned in principle).
- `docs/glossary.md` — `EvidenceStorage`, storage manifest, storage digest,
  authoritative identity entries.
- `docs/roadmap.md` and `specs/000-index.md` — status and slice registration.

This Draft PR updates only: `specs/000-index.md` (register Spec 015 as
Draft), `docs/roadmap.md` (near-term entry points at the Draft), and the
new spec file. Completed Spec 014 history is not rewritten.

## Open questions

Limited to decisions that cannot be resolved from current repository
evidence; they concern implementation mechanics, not core identity,
overwrite, policy, or deletion behavior (those are decided above):

1. **Connection and journaling strategy.** `TraceStorage` opens its own
   `better-sqlite3` connection with default journaling. Whether
   `EvidenceStorage` opens its own connection against the same file, shares
   an injected connection, and/or selects WAL journaling to reduce
   cross-connection `SQLITE_BUSY` contention is not determinable from repo
   evidence and is left to the slice-1 implementation review. Both options
   preserve the documented atomicity and durability guarantees because
   `better-sqlite3` is synchronous and every save is transactional.
2. **Reference-policy set.** Whether the initial slice ships only
   `signalglass.persistence.accept-valid` (v1.0.0) or also a second
   rejecting content-class example policy cannot be decided until a real
   collector exists to expose operator needs; the contract supports any
   number of operator-authored policies without schema changes.

## References

- `AGENTS.md`
- [`docs/architectural-foundation.md`](../docs/architectural-foundation.md)
- [`docs/architecture.md`](../docs/architecture.md)
- [`docs/capture-profiles.md`](../docs/capture-profiles.md)
- [`docs/model-versioning.md`](../docs/model-versioning.md)
- [`docs/privacy.md`](../docs/privacy.md)
- [`docs/roadmap.md`](../docs/roadmap.md)
- [`docs/glossary.md`](../docs/glossary.md)
- [`specs/000-index.md`](000-index.md)
- [`specs/007-storage-and-privacy.md`](007-storage-and-privacy.md)
- [`specs/013-evidence-model.md`](013-evidence-model.md)
- [`specs/014-evidence-primitives.md`](014-evidence-primitives.md)
- [`packages/evidence/README.md`](../packages/evidence/README.md)
