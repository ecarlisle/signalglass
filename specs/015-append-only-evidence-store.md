# Spec 015: Append-only evidence store

## Status

**Draft (revision 2).** Proposed for architectural review; not Accepted and
not to be implemented until accepted. Revision 2 incorporates the review
corrections: a mandatory non-bypassable storage-safety admission gate and a
conservative reference persistence policy, mutation-safe policy evaluation,
honest runtime input validation and version triage, exact UTF-8 digest and
exact-text conflict rules, fully structured corrupt-read handling, open-time
SQLite schema verification with a namespaced canonical-storage ledger, and
tightened identity wording. Writing corrections does not mark the spec
Accepted. This specification is documentation-only; the PR that introduces
it MUST NOT contain production code changes.

## Purpose

Define the smallest honest persistence increment that can store and retrieve
authoritative canonical `EvidenceRecord` values (Spec 013 §1.2) beside the
existing legacy `TraceStorage` (Spec 007) without:

- overwriting evidence;
- silently normalizing or redacting canonical records;
- storing material that repository security rules prohibit, under any
  policy;
- confusing collection, persistence, and export policy (Spec 013 §9);
- breaking the existing legacy `TraceStorage`;
- beginning ingress, streaming, measurement, UI, or consumer migration.

The store persists one complete, validated `EvidenceRecord` per interaction
as an immutable, self-describing serialized document, with clearly separated
administrative metadata, an explicit authoritative identity, deterministic
conflict detection, and a two-stage admission boundary: a mandatory storage
safety gate followed by a selected named/versioned operator persistence
policy. Deletion, retention, tombstones, revisions, migration of legacy
rows, and ingress adoption are explicitly out of scope and deferred to
later specifications.

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
  the supported-version policy (`checkEvidenceSchemaVersion`, §3.3),
  unknown-additive-field preservation (§5.3), the public
  `sha256Hex(Uint8Array)` / `utf8Encode(string)` deterministic helpers
  (§1.2, §4.5), and the compatibility projections used to verify
  persisted-parity (§6). Spec 014 explicitly ends at slice 4; **Spec 015 is
  not "Spec 014 slice 5"** — it is a separate specification for persistence.
- **Spec 007 (Implemented)** defines the legacy `TraceStorage` and
  `sanitizeTraceForStorage`. Spec 015 adds canonical storage beside it and
  MUST NOT change, reuse, or reinterpret legacy storage behavior. The
  legacy redaction categories in `sanitizeTraceForStorage` inform — but do
  not bind — the canonical safety gate's detection set (see "Storage safety
  admission gate").

## Scope

- Canonical `EvidenceRecord` persistence in SQLite beside the legacy
  `traces` / `trace_events` tables.
- An append-only save/retrieve contract with structured outcomes, an
  authoritative identity, deterministic conflict detection, a mandatory
  storage-safety admission gate, and a persistence-policy admission
  boundary.
- A storage manifest (administrative metadata) contract.
- A namespaced storage-format version ledger and open-time schema
  verification.
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
| **Authoritative identity** | The storage key of a canonical record: the record's trace identity (`record.trace.traceId`, which MUST equal `record.trace.interactionId` per Spec 013 §1.2 and is enforced by `parseEvidenceRecord`). The database enforces uniqueness of this key within the canonical store; the store never substitutes a database row id or a content-derived identifier. |
| **Stored document** | The exact text produced by the public `serializeEvidenceRecord` serializer at write time; the single authoritative representation of the record inside the database. |
| **Storage manifest** | Administrative metadata recorded beside the stored document: storage-format version, evidence-schema version, persistence-policy name/version, storage timestamp, and the storage digest. Never part of the canonical record. |
| **Storage digest** | A deterministic SHA-256 hex digest computed over the exact UTF-8 bytes of the stored-document text (`sha256Hex(utf8Encode(storedDocument))`). Administrative integrity metadata; it supports detection and MAY serve as a lookup optimization, but exact document comparison — never digest equality alone — decides idempotency and conflicts. Never presented as canonical evidence and never conflated with `contentHash` or `nativeContentHash`. |
| **Storage safety gate** | The mandatory, non-bypassable admission gate that runs on every save and rejects records containing storage-prohibited material (repository security rules). Not overridable by any persistence policy. |
| **Persistence policy** | A named, versioned decision function that accepts or rejects a complete, detached, validated canonical record snapshot for persistence (Spec 013 §9.1). A custom policy may be stricter than the safety gate, never weaker. |
| **Detached snapshot** | A deep-frozen, caller-independent parse of the serialized document, passed to policy code; the caller's mutable record object is never passed to policy. |
| **Storage-format version** | The version of the canonical-storage layout (tables, columns, manifest shape), recorded in the namespaced ledger `evidence_storage_meta` key `evidence_storage_format_version`. It versions ONLY canonical evidence storage, never the legacy `traces` / `trace_events` schema. Distinct from the evidence-schema version carried by the record. |
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
evidence records ───────────────────►  EvidenceStorage (this spec)   → evidence_records + evidence_storage_meta
(Spec 013/014)                          TraceStorage (legacy, Spec 007) → traces, trace_events
```

## Dependency boundaries

- `@signalglass/evidence` MUST remain provider-, storage-, network-, and
  UI-independent with zero runtime dependencies (Spec 014 §1.1, §1.4). It is
  consumed, never modified, by this spec.
- `@signalglass/storage` is the owner of persistence. It MUST gain
  `@signalglass/evidence` as a workspace dependency (`workspace:*`) so it can
  consume public evidence types, validators, serializers, and deterministic
  helpers directly. `@signalglass/storage` retains its existing
  `@signalglass/core` dependency for the legacy `TraceStorage` surface. This
  is the smallest dependency change: one additive workspace dependency, no
  new external runtime dependencies (SQLite already uses the existing
  `better-sqlite3`).
- Canonical evidence MUST NOT be routed through `@signalglass/core` merely to
  reach storage; storage imports `@signalglass/evidence` directly.
- Provider logic stays in `@signalglass/providers`; ingress/network logic
  stays in `apps/ingress`; analyzer behavior stays in `@signalglass/core`.
  This spec changes none of them.

## Canonical record and administrative metadata ownership

**The stored document is authoritative; administrative columns are
index/support data.** The serialized record in
`evidence_records.serialized_record` is the single authoritative
representation of the evidence. Administrative columns
(`evidence_schema_version`, `storage_format_version`,
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
- On read, the stored text MUST be parsed and validated through the guarded
  six-stage read pipeline (see "Read pipeline"), never through an unguarded
  `parseEvidenceRecord(JSON.parse(text))` expression, because `JSON.parse`
  can throw.
- Retrieval MUST expose both forms: `getEvidenceRecord(identity)` returns
  the canonical record (parsed and re-validated); `getStoredEvidence(identity)`
  returns the canonical record **plus** its `StorageManifest`.

## Append-only semantics

### Authoritative identity

The authoritative identity key is **`record.trace.traceId`** (equal to
`record.trace.interactionId`, enforced by `parseEvidenceRecord`). It is:

- assigned at capture time and immutable (Spec 013 §2.1);
- opaque and never content-derived;
- the primary key of the canonical store, whose uniqueness the database
  enforces **within this canonical store** — storage does not rely on a
  global installation-wide uniqueness guarantee to detect collisions;
- resolved on collision by **exact document comparison** and structured
  conflict (never by overwriting).

A mutable database row id, the storage digest, observation ids, and content
hashes are NEVER evidence identity, and the store never substitutes one for
the identity key.

### Observable behavior

The following behaviors MUST hold:

1. **First write.** A first save of a valid, gate-safe, policy-admitted
   record appends exactly one immutable authoritative row under the record's
   authoritative identity.
2. **Byte-identical repeat.** Saving a record whose serialized text is
   byte-identical to an already-stored record under the same identity is
   **idempotent**: it returns `already-present` and MUST NOT create a second
   authoritative row and MUST NOT modify the existing row.
3. **Same identity, different text.** Saving a record with the same
   authoritative identity but different serialized text is a **structured
   conflict**, never an update, upsert, or overwrite: it returns `conflict`
   and the original row remains byte-identical. **The deciding comparison is
   exact stored-text equality, never digest equality**: even when the two
   documents' digests coincide (a simulated or real collision), different
   text is a conflict. This is also the conservative rule when the two texts
   parse to canonically equal records: the stored document is the
   authoritative serialization, and two different documents for one identity
   are ambiguous. A future successor/revision mechanism (with provenance and
   immutable revision identity, per `docs/model-versioning.md`) is the only
   sanctioned way to represent changing evidence for one interaction; it is
   deferred, so conflicting same-identity writes are rejected in this slice.
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
7. **Unsupported evidence-schema versions.** A save whose record carries a
   syntactically valid but unsupported major `evidenceSchemaVersion` returns
   `unsupported-version` and writes nothing (version triage precedes any
   write; see Save pipeline).
8. **Malformed evidence.** A save of input that fails validation returns
   `invalid` with the structured `ValidationIssue` list and writes nothing;
   malformed runtime input never throws.
9. **Storage-safety rejection.** A save of a record that contains
   storage-prohibited material returns `safety-rejected` with structural
   reason codes and writes nothing, regardless of the active policy.
10. **Storage-policy rejection.** A save that the active persistence policy
    rejects returns `policy-rejected` and writes nothing.

### Immutability

Canonical evidence rows MUST NOT be updated in place. The storage layer MUST
NOT issue `UPDATE`, `REPLACE`, or `DELETE` statements against
`evidence_records` in this slice (the only statements are `INSERT` and
`SELECT`; `evidence_storage_meta` writes are limited to initialization and
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

Three distinct concerns MUST stay distinct:

| Concern | Owner | Behavior |
|---|---|---|
| **Collection-time evidence status** | Canonical evidence (capture boundary) | Redaction, truncation, and missing status are authoritative evidence (`evidenceStatus: "redacted" \| "truncated" \| "missing" \| …`), recorded at capture per Spec 013 §9.2. Storage MUST NOT change them. |
| **Mandatory storage safety** | `EvidenceStorage` (storage invariant) | A non-bypassable admission gate that rejects storage-prohibited material on every save, before any policy. Not configurable, not overridable, never weaker under any policy. |
| **Configurable persistence admission** | Operator policy (named + versioned) | The selected persistence policy accepts or rejects the complete detached record. MAY be stricter than the mandatory gate; MUST NOT be weaker. |

### Storage safety admission gate

The safety gate MUST run for every save, before the persistence policy, and
MUST NOT be overridable by any custom policy or configuration. It inspects
the validated detached snapshot and rejects the complete record — without
modification — when it detects storage-prohibited material. Because
canonical storage cannot silently strip or redact evidence, rejection is the
correct behavior.

At minimum, the gate MUST cover the repository's existing prohibited
storage categories (AGENTS.md security rules; legacy categories in
`sanitizeTraceForStorage` / `redaction.ts`), each detected structurally and
reported as a structural reason code that NEVER echoes the detected value:

- **S1 — API keys and tokens:** credential-like string values (for example,
  `sk-…`-prefixed values, bearer tokens) and fields keyed like
  `api_key` / `token`.
- **S2 — Sensitive headers:** `authorization`, `x-api-key`, `cookie`,
  `set-cookie`, and `proxy-authorization` header names and credential-like
  header values.
- **S3 — Secrets and credentials:** fields keyed like
  `password` / `secret` / `credential` / `auth` and credential-like values.
- **S4 — Credential-bearing storage references:** storage-key-like
  references whose value is credential-like (mirroring the legacy
  `storageKey` rule).
- **S5 — Full raw/provider-native payload captures:** payload content
  retained at full provider-native fidelity (`byte_faithful` or
  `structurally_faithful`) without a declared redaction/truncation boundary
  — i.e., full raw request/response/provider-native payload content, which
  repository rules prohibit storing. The precise structural predicate is an
  implementation contract pinned by tests; the gate MUST reject such records
  unless a later accepted specification introduces the protections needed to
  persist full-fidelity content.

A record containing any S1–S5 material is rejected as `safety-rejected`
with the list of structural reason codes; nothing is written and no policy
can admit it.

### Persistence policy

- `EvidenceStorage` MUST be constructed with an explicit persistence policy
  (a missing policy is a configuration error and the constructor throws).
  There is no implicit default policy and **no default or reference policy
  that accepts arbitrary valid records**.
- The policy evaluates a **detached, deep-frozen snapshot** of the validated
  record — never the caller's mutable object (see "Mutation safety").
- The policy accepts or rejects the complete record. It MUST NOT silently
  strip fields, replace payloads, change evidence statuses, rewrite
  completeness, or store a modified value under the same authoritative
  identity. Rejection returns `policy-rejected` with the policy identity and
  a structural reason.
- A custom policy may be stricter than the mandatory gate (for example,
  rejecting a content class the gate admits); it can never weaken or bypass
  the gate, which has already run.

### Reference policy: `signalglass.persistence.metadata-safe` (v1.0.0)

The initial slice ships exactly one conservative reference policy:

- **Name:** `signalglass.persistence.metadata-safe`; **version:** `1.0.0`.
- It accepts records that are already safe for the current local persistence
  guarantees: metadata, declared redacted/truncated/missing content, and no
  storage-prohibited material.
- It rejects prohibited secrets and credential material (the S1–S4
  categories) and rejects full raw/provider-native payload capture (S5)
  unless a later accepted specification introduces the protection needed to
  persist it — re-evaluating the same structural detector on the detached
  snapshot as defense in depth (the mandatory gate runs first regardless).
- It never rewrites evidence; its decisions are accept/reject only.
- Rejection reasons are structural codes/messages and never echo detected
  values.
- Policy name/version MUST be recorded in the storage manifest and in
  `evidence_records` administrative columns — never inside the canonical
  record, never in `serialized_record`.

### Mutation safety

The storage implementation MUST NOT pass the caller-owned mutable object
directly to policy code. The smallest deterministic mechanism, normative
here:

1. **Validate and serialize first** — the validated record is serialized to
   `storedDocument` before any policy evaluation.
2. **Construct a detached validated snapshot from the serialized document**
   — `snapshot = parseEvidenceRecord(JSON.parse(storedDocument)).record`,
   which is a fresh object tree independent of the caller's object.
3. **Deep-freeze the snapshot** (recursively `Object.freeze` every object and
   array; retained bytes are already canonical Base64 strings after
   serialization, so no `Uint8Array` survives into the snapshot) so any
   mutation attempt throws in strict mode.
4. **Pass the deep-frozen snapshot as a deeply readonly policy view** to
   `persistencePolicy.decide(snapshot)`.
5. **Persist the pre-policy serialized document only if admission succeeds**;
   the policy can never alter what is written, because the document was fixed
   at step 1 and the snapshot cannot be mutated.

Consequences, all normative:

- A policy that attempts to mutate the snapshot (observable as a thrown
  `TypeError` against the frozen tree) or that throws for any reason writes
  nothing. The save returns a structured **`policy-failed`** outcome
  (`reason: 'exception' | 'mutation-attempted'`) — a policy defect is a
  structured configuration/policy failure, not an environmental throw, and
  it must not crash a save loop. The underlying exception message is never
  surfaced by storage (a policy could embed payload values in its own error
  text); only the structural reason is reported.
- Policy reasons and exceptions MUST NOT expose payload values. Storage does
  not log policy exception messages or reason strings that could contain
  content.
- A mutating or throwing policy cannot alter: the caller's record, the
  stored document, the authoritative identity, completeness, evidence
  status, or the digest basis (all fixed before policy evaluation).

### Persistence-time removal

Persistence-time removal is not representable honestly in this slice.
Removing content at persistence time would require a canonical successor
record with provenance, completeness changes, and/or an administrative
deletion record (Spec 013 §9.2). That mechanism is deferred (see "Deletion
and tombstones"); it is not approximated by silent stripping, and the safety
gate's rejection is not a rewrite — it is a whole-record admission decision.

### Policy contract

```ts
import type { EvidenceRecord } from '@signalglass/evidence';

/** Deeply readonly structural variant of EvidenceRecord. */
export type ReadonlyEvidenceRecord = DeepReadonly<EvidenceRecord>;

export type PersistencePolicyDecision =
  | { accept: true }
  | { accept: false; reason: string };   // reason required on rejection

export interface PersistencePolicy {
  /** Nonempty, stable policy name, e.g. "signalglass.persistence.metadata-safe". */
  name: string;
  /** Valid semantic version of this policy definition (Spec 013 §9.2). */
  version: string;
  /** Whole-record admission decision on the deep-frozen detached snapshot.
   *  MUST NOT mutate the snapshot; MUST NOT rewrite or return a modified record. */
  decide(snapshot: ReadonlyEvidenceRecord): PersistencePolicyDecision;
}
```

Policy name/version validity is enforced at construction: an empty name or a
non-semantic version is a configuration error and the constructor throws.

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
  ValidationIssue,
} from '@signalglass/evidence';

export interface StorageManifest {
  /** Canonical-storage layout version, e.g. "1.0.0" (see Versioning and migration). */
  storageFormatVersion: string;
  /** Record's evidenceSchemaVersion, for safe lookup and version checks. */
  evidenceSchemaVersion: string;
  /** Persistence policy in effect at write time (administrative only). */
  persistencePolicy: { name: string; version: string };
  /** ISO 8601 UTC storage timestamp (injectable clock). */
  storedAt: string;
  /** SHA-256 hex over the exact UTF-8 bytes of the stored serialized text.
   *  Administrative integrity metadata; never canonical evidence. */
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
  /** Mandatory storage-safety gate rejection; structural codes only (S1–S5). */
  | { status: 'safety-rejected'; reasons: readonly string[] }
  | {
      status: 'policy-rejected';
      policy: { name: string; version: string };
      reason: string;
    }
  | {
      status: 'policy-failed';
      policy: { name: string; version: string };
      reason: 'exception' | 'mutation-attempted';
    };

export type EvidenceReadFailure =
  | { ok: false; reason: 'not-found' }
  /** Structural code only; never serialized content (see Read pipeline). */
  | { ok: false; reason: 'corrupt'; code: string }
  | { ok: false; reason: 'unsupported-version'; version: string };

export type EvidenceReadResult =
  | { ok: true; record: EvidenceRecord }
  | EvidenceReadFailure;

export type StoredEvidenceReadResult =
  | { ok: true; record: EvidenceRecord; manifest: StorageManifest }
  | EvidenceReadFailure;

export interface EvidenceStorageConfig {
  databasePath: string;
  /** Required — no implicit default policy (see Persistence-policy boundary). */
  persistencePolicy: PersistencePolicy;
  /** Injectable ISO 8601 UTC clock for storedAt; default: () => new Date().toISOString(). */
  now?: () => string;
}

export class EvidenceStorage {
  constructor(config: EvidenceStorageConfig);
  /** Save pipeline over unknown runtime input; structured outcome, never throws
   *  for malformed input. See Save pipeline. */
  saveEvidenceRecord(input: unknown): SaveOutcome;
  /** Read the canonical record (parsed and re-validated) by authoritative identity. */
  getEvidenceRecord(identity: string): EvidenceReadResult;
  /** Read the canonical record plus its storage manifest. */
  getStoredEvidence(identity: string): StoredEvidenceReadResult;
  close(): void;
}
```

The `identity` argument of the read APIs is the authoritative trace identity
(`traceId`). Reads address rows by primary key only.

### Save pipeline (normative order)

The runtime input contract is honest: `saveEvidenceRecord(input: unknown)`.
The pipeline never dereferences malformed input and never throws for
malformed input:

1. **Shape guard.** `input` must be a non-null object (a plain structural
   object check). Otherwise return `invalid` with a single structural issue
   (`record_not_object`, mirroring the parser's code). No property access
   occurs before this step.
2. **Version triage.** Now that the shape is guaranteed, read
   `input.evidenceSchemaVersion` and apply the public
   `checkEvidenceSchemaVersion` contract:
   - `invalid_syntax` (absent, non-string, or non-semantic version) →
     return `invalid` (issue list from `parseEvidenceRecord`, which never
     throws; identity `null`).
   - `unsupported_major` → return `unsupported-version` with the version
     string; nothing written. A syntactically valid but unsupported major is
     a version refusal, not an invalid record.
3. **Full validation.** `parseEvidenceRecord(input)`:
   - failure → `invalid` with its structured issues (identity `null` — a
     failed parse is not trusted for identity);
   - success → `validatedRecord`. This is the ONLY record shape that is
     serialized and passed toward policy; the caller's original object is
     not used again.
4. **Serialize first.** `storedDocument = serializeEvidenceRecord(validatedRecord)`
   — the exact text that will be persisted. (The serializer re-validates and
   throws only on an already-invalid record — a programming-error guard, not
   a data path.)
5. **Detached snapshot.** `snapshot = parseEvidenceRecord(JSON.parse(storedDocument)).record`
   (always `ok` — the same serializer produced the text) and **deep-freeze**
   it. The caller's mutable object is never passed to policy.
6. **Mandatory safety gate.** `detectStorageProhibitedMaterial(snapshot)`:
   any S1–S5 finding → return `safety-rejected` with the structural reason
   codes; nothing written. Non-bypassable.
7. **Policy admission.** `persistencePolicy.decide(snapshot)` (deep-frozen,
   deeply readonly):
   - `{ accept: false; reason }` → `policy-rejected` with policy identity
     and reason; nothing written.
   - throws, or attempts mutation of the frozen snapshot (observed as a
     thrown `TypeError`) → `policy-failed` (`exception` |
     `mutation-attempted`); nothing written; the exception message is never
     surfaced.
8. **Digest.** `storageDigest = sha256Hex(utf8Encode(storedDocument))` — over
   the exact UTF-8 bytes of the exact stored serializer output (public
   `sha256Hex(bytes: Uint8Array)` and `utf8Encode(text: string)` from
   `@signalglass/evidence`).
9. **Append (transactional).** Inside one transaction: read the existing row
   by identity:
   - absent → `INSERT` (document + administrative columns) → return `stored`
     with the manifest;
   - present → **compare the exact stored `serialized_record` text with
     `storedDocument`**: exact text equality → `already-present`; different
     text → `conflict` — **regardless of whether the digests match**. Digest
     equality is never proof of document equality; the digest may be an
     integrity check or lookup optimization but MUST NOT replace exact text
     comparison for correctness.
   - A unique-key constraint raced by a concurrent writer is resolved by
     re-reading inside the transaction and classifying by the same exact-text
     comparison — never surfaced as a raw constraint error.

### Read pipeline (normative order)

Reads are fully structured; nothing in the read path throws for stored-data
conditions. `getStoredEvidence` follows the same pipeline and additionally
returns the manifest:

1. **Read the row** by identity. Absent → `not-found`.
2. **Safely parse JSON** inside a guarded boundary (`try/catch` around
   `JSON.parse(serialized_record)`). Malformed JSON → `corrupt`
   (`json_parse_failed`).
3. **Safely inspect schema version.** `checkEvidenceSchemaVersion(doc.evidenceSchemaVersion)`:
   - `invalid_syntax` → `corrupt` (`invalid_version_syntax`);
   - `unsupported_major` → `unsupported-version` with the version (a valid
     document with a syntactically valid unsupported major is a version
     refusal, not corruption).
4. **Validate.** `parseEvidenceRecord(doc)`. Failure → `corrupt`
   (`validation_failed`) — internally inconsistent stored data.
5. **Recompute and verify the storage digest.**
   `sha256Hex(utf8Encode(serialized_record_text))` must equal the row's
   `storage_digest`; mismatch → `corrupt` (`digest_mismatch`).
6. **Verify administrative agreement.** All of the following MUST hold; any
   failure returns `corrupt` with the named structural code:
   - requested identity === parsed `trace.traceId` (`identity_mismatch`);
   - parsed `trace.traceId` === parsed `trace.interactionId`
     (`trace_identity_mismatch`);
   - row `evidence_identity` === parsed identity (`identity_mismatch`);
   - row `evidence_schema_version` === document `evidenceSchemaVersion`
     (`schema_version_mismatch`);
   - row `storage_format_version` === the supported canonical-store format
     (`format_version_mismatch`);
   - `persistence_policy_name` nonempty and `persistence_policy_version` a
     valid semantic version (`policy_metadata_malformed`);
   - `stored_at` a valid ISO 8601 timestamp (`stored_at_malformed`).
7. **Return** `{ ok: true, record }` (or `{ ok: true, record, manifest }`).

`corrupt` outcomes carry only a structural `code`; corrupted serialized
content MUST NOT be included in issues, codes, or diagnostics.

### Structured results vs. throws

- Expected invalid input, unsupported versions, safety rejection, policy
  rejection, policy failure, identity conflicts, idempotent repeats, and
  absent/corrupt/unsupported reads MUST produce structured results (the
  unions above); they MUST NOT rely on raw SQLite constraint exceptions and
  MUST NOT throw.
- Genuine environmental failures — I/O errors, disk-full, unrecoverable
  database-locked states after retry, an unsupported or incompatible
  storage-format version on open, a missing or invalid persistence policy in
  the constructor — MAY throw. `parseEvidenceRecord` never throws; the only
  throw in the save path is the documented serializer programming-error
  guard.

## SQLite schema contract

The canonical store MUST add exactly two tables to the existing database
file and MUST NOT modify `traces` / `trace_events`. Initialization and
schema verification are defined in "Open-time schema verification" below;
`CREATE TABLE IF NOT EXISTS` alone is never proof of an existing table's
contract.

```sql
-- Namespaced canonical-storage ledger. Versions ONLY canonical evidence
-- storage; it never versions the legacy traces/trace_events schema.
CREATE TABLE IF NOT EXISTS evidence_storage_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Ledger row: key = 'evidence_storage_format_version', value = '1.0.0'

-- Immutable authoritative evidence rows. Administrative columns are clearly
-- separated from the canonical document and never redefine evidence.
CREATE TABLE IF NOT EXISTS evidence_records (
  evidence_identity          TEXT PRIMARY KEY,  -- record.trace.traceId (== interactionId); immutable
  evidence_schema_version    TEXT NOT NULL,     -- administrative lookup index (record.evidenceSchemaVersion)
  storage_format_version     TEXT NOT NULL,     -- administrative: canonical layout version at write time
  persistence_policy_name    TEXT NOT NULL,     -- administrative (Spec 013 §9.2)
  persistence_policy_version TEXT NOT NULL,     -- administrative (Spec 013 §9.2)
  stored_at                  TEXT NOT NULL,     -- administrative; ISO 8601 UTC (injectable clock)
  storage_digest             TEXT NOT NULL,     -- administrative; sha256 hex of the exact UTF-8 stored text
  serialized_record          TEXT NOT NULL      -- the authoritative document (exact serializer output)
);

CREATE INDEX IF NOT EXISTS idx_evidence_records_schema_version
  ON evidence_records (evidence_schema_version);
CREATE INDEX IF NOT EXISTS idx_evidence_records_stored_at
  ON evidence_records (stored_at);
```

### Contract rules

- **Primary key:** `evidence_identity` (authoritative identity). Uniqueness
  is enforced by the database within this canonical store and is the
  last-line conflict guard; the API resolves races structurally by exact-text
  comparison.
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
  `storage_format_version` (the canonical layout version, mirrored in
  `evidence_storage_meta`).
- **Digest/conflict detection:** `storage_digest` is an administrative
  integrity value and MAY serve as a lookup optimization, but it MUST NOT be
  used as proof of document equality. It is **not indexed** in this slice:
  no API queries by digest, and a speculative digest index would serve no
  query. Idempotency and conflict are decided by exact `serialized_record`
  text comparison under the primary key. Equal digests imply nothing for
  correctness; differing text under the same identity is always `conflict`.
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
  MUST create only `evidence_storage_meta` and `evidence_records`.
- **Restart behavior:** close/reopen preserves all rows; re-opening runs the
  same initialization, verification, and migration checks idempotently.

## Open-time schema verification

`CREATE TABLE IF NOT EXISTS` does not prove that an existing table with the
same name has the expected columns, constraints, or meaning. Opening
`EvidenceStorage` MUST therefore verify the canonical-storage contract from
SQLite metadata before any read or write:

1. **Inspect existing canonical metadata.** Query `sqlite_master` for
   `evidence_storage_meta`, `evidence_records`, and their indices.
2. **Ledger triage.**
   - `evidence_storage_meta` absent → proceed to initialization (step 3).
   - Ledger present with `evidence_storage_format_version` equal to the
     supported version (`1.0.0`) → proceed to verification (step 4).
   - Version **higher** than supported → refuse to open with a clear
     storage-format error; a newer layout must not be silently read or
     written by an older build.
   - Version **lower** than supported → apply forward migrations in order
     (none exist for `1.0.0`), inside a transaction, then verify.
   - Ledger present but the format-version key missing, duplicated, or
     non-semantic → refuse to open (malformed/incompatible ledger); never
     silently treat it as `1.0.0`.
3. **Initialize when absent (atomic).** Create `evidence_storage_meta` +
   `evidence_records` + indices and insert the ledger row
   (`evidence_storage_format_version = '1.0.0'`) in ONE transaction. A
   failure rolls back; the prior database (including any legacy tables)
   remains intact.
4. **Verify the exact required contract.** Regardless of whether the tables
   were just created or already existed, verify with `PRAGMA table_info`
   and index metadata that `evidence_records` has exactly the required
   columns, types, `NOT NULL` constraints, and primary key
   (`evidence_identity`), and that the required indices exist. Any mismatch
   with an existing table — missing/renamed column, wrong type, missing
   primary key, wrong constraint — MUST refuse to open with a clear
   storage-format error. An incompatible pre-existing table is never
   silently treated as version `1.0.0`.
5. **Leave legacy tables and rows untouched.** No statement in
   initialization or verification targets `traces` / `trace_events`.

The ledger `evidence_storage_meta` / `evidence_storage_format_version`
namespaces storage-format versioning to canonical evidence storage only. It
MUST NOT be presented as a version ledger for the legacy `traces` /
`trace_events` schema, which Spec 007 owns and this spec does not version.

## Versioning and migration rules

- **Two independent versions.** (a) The evidence-schema version lives on the
  record (`evidenceSchemaVersion`) and is governed by Spec 013 §10 / Spec
  014 §3.3: compatible additive minor/patch revisions within supported MAJOR
  1 are accepted; unknown MAJORs are refused with structured results. The
  storage layer MUST NOT migrate or rewrite records across evidence-schema
  versions. (b) The canonical storage-format version
  (`evidence_storage_meta` key `evidence_storage_format_version`) versions
  the canonical layout and manifest shape only.
- **Migration changes layout, never meaning.** A future storage migration
  MAY add tables, columns, or indices and MAY rewrite the manifest shape;
  it MUST NOT rewrite or reinterpret `serialized_record`, and it MUST NOT
  change the meaning of stored evidence (`docs/model-versioning.md`).
- **Open behavior.** On open: ledger absent → initialize at the current
  version; ledger version lower than current → apply forward migrations in
  order (none for `1.0.0`); ledger version higher than supported → refuse to
  open; malformed ledger or incompatible pre-existing tables → refuse to
  open (see "Open-time schema verification").
- **Idempotent writes after restart** are guaranteed by the append-only
  rules; no replay log is introduced.

## Privacy and diagnostic rules

- The storage layer MUST NOT log, print, or include in diagnostics the
  `serialized_record` text, any payload content, or any recovered secret.
  Diagnostics (outcome statuses, identities, structural reason codes,
  digests, policy names/versions, schema versions, timestamps) are
  administrative and MUST NOT embed payload values or credential material.
- Safety-gate and policy rejection reasons are **structural codes/messages
  only** and MUST NEVER echo the detected values (no header values, no
  credential text, no excerpt of a rejected payload).
- `corrupt` read failures carry only a structural `code`; corrupted
  serialized content MUST NOT be included in issues, codes, or diagnostics.
- Credentials, authorization headers, API keys, and secrets MUST never be
  committed, logged, or placed in test fixtures (AGENTS.md security rules).
  Collection-time redaction (Spec 013 §9.2) is the only sanctioned way
  sensitive content is represented in canonical evidence; storage neither
  strips it nor un-redacts it, the mandatory safety gate rejects
  storage-prohibited material, and the persistence-policy boundary provides
  the operator admission decision.
- The `storageDigest` is administrative integrity/conflict metadata. It MUST
  be labeled as such in documentation and code comments and MUST NOT be
  presented as canonical evidence, a content hash, or confused with
  `contentHash` / `nativeContentHash` (which are canonical evidence fields).
- No new secret stores, key files, or credential handling are introduced.

## Failure behavior

- **Structured failures (no throw):** invalid runtime input, invalid version
  syntax, unsupported major version (save and read), safety rejection,
  policy rejection, policy exception/mutation, identity conflict, idempotent
  repeat, absent record, and every corrupt-read integrity failure.
- **Throwing failures (environmental/configuration):** I/O and disk
  failures, unrecoverable lock contention, unsupported or incompatible
  canonical storage-format on open, missing/invalid persistence policy in
  the constructor, and the documented serializer programming-error guard.
- **Atomicity:** every save is transactional; a failure at any step rolls
  back and leaves the prior state intact. Reads never mutate state.
  Initialization is atomic (see "Open-time schema verification").

## Implementation slices

Recommended additive sequence after acceptance (each slice independently
reviewable, testable, and mergeable; none touches legacy storage, ingress,
or production consumers):

1. **Contracts, safety gate, and schema.** Public result/manifest/policy/
   config types (`SaveOutcome`, `StorageManifest`, `PersistencePolicy`,
   `EvidenceStorageConfig`), the structural safety-gate detector (S1–S5),
   the additive `evidence_storage_meta` + `evidence_records` schema,
   open-time schema verification, and contract tests (serialized-shape and
   `PRAGMA table_info` schema pinning, ledger namespacing, gate detection
   negative controls).
2. **Append-only save, conflict detection, retrieval.**
   `saveEvidenceRecord` with the normative pipeline, `getEvidenceRecord`,
   `getStoredEvidence`, `close`; tests for first write, idempotent repeats,
   exact-text conflicts (including simulated digest collision), rollback,
   and close/reopen durability.
3. **Policy admission, mutation safety, failure, privacy, coexistence.**
   The `metadata-safe` reference policy; `policy-rejected` /
   `policy-failed`; mutation and exception isolation; version triage and
   invalid-input handling; privacy/diagnostic rules; initialization against
   an existing legacy database and coexistence with `TraceStorage` on one
   file; open-time refusal cases (malformed/incompatible table, higher
   format).
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
secrets, no raw payloads in fixtures — sentinel markers are used instead):

- save/retrieval round trip with exact canonical-record equality (raw
  observations included);
- exact serialized-text preservation (stored document equals
  `serializeEvidenceRecord` output at write; no re-encoding);
- unknown additive field preservation across save → read → re-serialize
  (equivalent JSON values, per the `@signalglass/evidence` contract);
- validation before write (invalid → `invalid`, nothing written) and
  validation after read (corrupt stored data → `corrupt`, never a throw);
- idempotent byte-identical writes (`already-present`, one row);
- conflicting same-identity writes (`conflict`, original row byte-identical,
  no update/upsert), decided by exact stored-text comparison;
- simulated digest collision (equal digest, different text) still resolves
  to `conflict`;
- digest computed over the exact UTF-8 bytes of the serializer output
  (`sha256Hex(utf8Encode(storedDocument))`), pinned by contract test;
- transaction rollback on failure (no partial rows);
- close/reopen durability;
- coexistence with legacy `traces` / `trace_events` and `TraceStorage` on
  the same file; initialization against a pre-existing legacy database;
- policy name/version recorded only in administrative metadata (manifest +
  columns; absent from `serialized_record`);
- policy rejection writes nothing and leaves the record unmodified;
- safety-gate rejection (S1–S5) writes nothing, returns structural codes,
  and echoes no detected values (sentinel-based);
- safety-gate non-bypassability: a permissive custom policy cannot admit a
  record the gate rejects;
- reference policy `metadata-safe` accepts gate-safe records, rejects
  prohibited categories, never rewrites evidence, and reports structural
  reasons only;
- policy mutation isolation: a mutating policy cannot alter the caller's
  record, the stored document, identity, completeness, evidence status, or
  the digest basis; a throwing policy returns `policy-failed` and writes
  nothing; policy reasons/exceptions expose no payload values;
- invalid runtime input (non-object, null) returns `invalid` without
  throwing;
- invalid version syntax returns `invalid`; syntactically valid unsupported
  major returns `unsupported-version` (save and read);
- malformed JSON on read returns `corrupt` without throwing;
- read-integrity mismatches each return `corrupt` with their structural code
  (identity, traceId/interactionId, schema-version column, digest,
  format-version column, policy metadata, stored_at);
- no corrupted or rejected content in issues/diagnostics (sentinel-based);
- absence of silent sanitization/normalization (no `sanitizeTraceForStorage`
  path; evidence statuses and completeness unchanged);
- no canonical hard-delete behavior (no delete API; legacy `deleteTrace`
  does not touch `evidence_records`);
- deterministic list ordering if listing is included (MAY; ordered by
  `stored_at`, then identity);
- persisted vs. in-memory projection parity (identical views and
  ProjectionReports);
- serialized-shape and SQLite-schema contract tests (`PRAGMA table_info`,
  ledger contents), because this spec changes public persistence contracts;
- open-time verification: clean initialization; repeated initialization;
  existing legacy-only database; compatible canonical database; malformed or
  incompatible canonical table; unsupported higher canonical storage format;
  failed initialization leaving the prior database intact;
- identity contract: authoritative identity is `traceId` (=== `interactionId`),
  never rowid/digest/observation id;
- storage digest is administrative, unindexed, and distinct from
  `contentHash` / `nativeContentHash` (contract + documentation test).

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
- [ ] Every read re-validates the stored document; malformed or internally
  inconsistent stored data returns a structured `corrupt` failure, never a
  throw or a silent misread.
- [ ] A byte-identical repeat save is idempotent: it returns
  `already-present` and creates no second authoritative row and no update.
- [ ] A same-identity write with different serialized text is rejected as
  `conflict` without modifying the original row in any way, decided by exact
  stored-text comparison.
- [ ] A simulated digest collision (equal digest, different text) still
  resolves to `conflict`; digest equality is never proof of document
  equality.
- [ ] The storage digest is computed over the exact UTF-8 bytes of the
  serializer output (`sha256Hex(utf8Encode(storedDocument))`), pinned by a
  contract test.
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
- [ ] A syntactically valid but unsupported major `evidenceSchemaVersion`
  returns `unsupported-version` on save (nothing written) and on read; a
  syntactically invalid or absent version returns `invalid` / `corrupt`
  respectively — never a throw and never a silent misread.
- [ ] Malformed runtime input (non-object, null) returns `invalid` without
  throwing.
- [ ] The mandatory storage-safety gate rejects records containing API keys,
  tokens, sensitive headers (authorization/x-api-key/cookie/proxy-
  authorization), passwords/secrets/credentials, credential-bearing storage
  references, or full raw/provider-native payload captures with structural
  `safety-rejected` codes and writes nothing.
- [ ] The storage-safety gate is non-bypassable: no custom persistence policy
  can cause storage of material the gate rejects.
- [ ] The reference policy `signalglass.persistence.metadata-safe` (v1.0.0)
  accepts only gate-safe records, rejects prohibited secret/credential
  material and full raw/provider-native payload capture, never rewrites
  evidence, and reports structural reasons that never echo detected values.
- [ ] A persistence policy that attempts to mutate the detached snapshot or
  that throws returns `policy-failed` and writes nothing; it cannot alter
  the caller's record, the stored document, identity, completeness, evidence
  status, or the digest basis.
- [ ] Policy reasons and exceptions expose no payload values; storage
  surfaces only structural reasons.
- [ ] Malformed JSON on read returns `corrupt` without throwing.
- [ ] Reads return `corrupt` (with the structural code) for each integrity
  mismatch: requested identity vs. parsed trace identity, parsed
  traceId vs. interactionId, row evidence identity, row evidence-schema
  version vs. document version, stored vs. recomputed digest, row
  storage-format version vs. supported format, malformed policy metadata,
  and malformed stored-at timestamp.
- [ ] Diagnostics and logs contain no serialized-record text, rejected
  values, corrupted content, payload content, credentials, or secret values
  (sentinel-based negative tests).
- [ ] Retrieved in-memory and persisted canonical records produce identical
  compatibility projections and `ProjectionReport`s
  (`evidenceToLegacyTrace` / `evidenceToAgentRun`).
- [ ] All pre-existing legacy storage, projection, and report tests remain
  unchanged and passing.
- [ ] Serialized-shape and SQLite-schema contract tests exist and pin the
  public persistence contracts changed by this spec, including the
  namespaced `evidence_storage_meta` ledger
  (`evidence_storage_format_version`).
- [ ] Open-time verification succeeds for: clean initialization, repeated
  initialization, an existing legacy-only database, and a compatible
  canonical database.
- [ ] Open-time verification refuses with a clear storage-format error for:
  a malformed/incompatible pre-existing canonical table (verified via
  `PRAGMA table_info` and index metadata), an unsupported higher canonical
  storage format, and a malformed ledger — never silently treating an
  incompatible table as version 1.0.0.
- [ ] Failed initialization leaves the prior database intact (atomic
  initialization).
- [ ] The canonical-storage ledger versions only canonical evidence storage;
  it is never presented as a version ledger for the legacy `traces` /
  `trace_events` schema.
- [ ] The authoritative identity is `record.trace.traceId` (equal to
  `interactionId`), enforced and tested; database row ids, digests, and
  hashes are never evidence identity, and same-key collisions are resolved
  by exact document comparison and structured conflict.
- [ ] The storage digest is labeled administrative, is not indexed, and is
  documented as distinct from canonical `contentHash` / `nativeContentHash`
  fields.
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
- `docs/privacy.md` — the mandatory storage-safety gate, the conservative
  reference policy, administrative metadata separation, and the absence of
  canonical hard-delete in this slice.
- `docs/capture-profiles.md` — persistence-policy recording location (already
  aligned; add the `EvidenceStorage` manifest reference).
- `docs/model-versioning.md` — storage-format version vs. evidence-schema
  version distinction and the namespaced canonical-storage ledger (already
  aligned in principle).
- `docs/glossary.md` — `EvidenceStorage`, storage manifest, storage digest,
  authoritative identity, storage safety gate entries.
- `docs/roadmap.md` and `specs/000-index.md` — status and slice registration.

This Draft PR updates only: `specs/015-append-only-evidence-store.md` (this
spec), `specs/000-index.md` (register Spec 015 as Draft), and
`docs/roadmap.md` (near-term entries). Completed Spec 014 history is not
rewritten.

## Open questions

Limited to decisions that cannot be resolved from current repository
evidence; they concern implementation mechanics, not core identity,
overwrite, safety, policy, or deletion behavior (those are decided above):

1. **Connection and journaling strategy.** `TraceStorage` opens its own
   `better-sqlite3` connection with default journaling. Whether
   `EvidenceStorage` opens its own connection against the same file, shares
   an injected connection, and/or selects WAL journaling to reduce
   cross-connection `SQLITE_BUSY` contention is not determinable from repo
   evidence and is left to the slice-1 implementation review. Both options
   preserve the documented atomicity and durability guarantees because
   `better-sqlite3` is synchronous and every save is transactional.
2. **Operator policy authoring surface.** Whether the initial slice exposes
   policy authoring beyond the single `metadata-safe` reference policy (for
   example, a documented builder for content-class rejections) cannot be
   decided until a real collector exists to expose operator needs; the
   contract supports any number of operator-authored policies without schema
   changes, and any such policy remains subordinate to the mandatory safety
   gate.

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
