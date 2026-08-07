# Spec 015: Append-only evidence store

## Status

**Draft (revision 6).** Proposed for architectural review; not Accepted and
not to be implemented until accepted. Revision 6 redesigns the safety-code
taxonomy so every code is reachable and non-overlapping, resolves the
Phase-A/Phase-B execution contract, corrects the TypeScript-shape claims
against the actual source, hardens runtime policy-decision validation with
an exact own-key contract, bounds policy-version metadata and validates it
on read, and decides the connection/journaling strategy. Writing corrections
does not mark the spec Accepted. This specification is documentation-only;
the PR that introduces it MUST NOT contain production code changes.

## Purpose

Define the smallest honest persistence increment that can store and retrieve
authoritative canonical `EvidenceRecord` values (Spec 013 §1.2) beside the
existing legacy `TraceStorage` (Spec 007) without:

- overwriting evidence;
- silently normalizing or redacting canonical records;
- storing material that repository security rules prohibit, under any
  policy;
- leaking rejected content through policy or validation results;
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
  be append-only and never rewritten in place (§10). It also defines the
  closed status vocabulary (§4.1): `captured`, `redacted`, `truncated`,
  `missing`, `unknown`, `not_applicable` — `inferred` is explicitly NOT an
  evidence status (it appears only on derived records such as measurements
  and interpretations and MUST be labeled there). Spec 015 never substitutes
  projection classifications (e.g. `inferred_after`, `exact_replay`) for
  evidence statuses.
- **Spec 014 (Implemented, 27/27)** provides the additive TypeScript
  primitives this store consumes: `EvidenceRecord` / `EvidenceObservation` /
  `EventRecord` types, the single `EvidenceRecordParseResult` validation
  contract, the deterministic `serializeEvidenceRecord` /
  `parseEvidenceRecord` JSON round trip (§5.7), the supported-version policy
  (`checkEvidenceSchemaVersion`, §3.3), unknown-additive-field preservation
  (§5.3), `projectCanonicalEvent` (§5.2 — the sole replay comparison that
  merges kind-specific payload fields onto the `EventRecord` top level and
  drops control-event payloads), the public `sha256Hex(Uint8Array)` /
  `utf8Encode(string)` deterministic helpers (§1.2, §4.5), and the
  compatibility projections used to verify persisted-parity (§6). Spec 014
  explicitly ends at slice 4; **Spec 015 is not "Spec 014 slice 5"** — it is
  a separate specification for persistence.
- **Spec 007 (Implemented)** defines the legacy `TraceStorage` and
  `sanitizeTraceForStorage`. Spec 015 adds canonical storage beside it and
  MUST NOT change, reuse, or reinterpret legacy storage behavior. The legacy
  redaction categories in `sanitizeTraceForStorage` inform — but do not bind
  — the canonical safety gate's detection set (see "Storage safety admission
  gate").

## Scope

- Canonical `EvidenceRecord` persistence in SQLite beside the legacy
  `traces` / `trace_events` tables.
- An append-only save/retrieve contract with structured outcomes, an
  authoritative identity, deterministic conflict detection, a mandatory
  storage-safety admission gate, and a persistence-policy admission
  boundary.
- A storage manifest (administrative metadata) contract.
- A namespaced storage-format version ledger and open-time schema
  verification with atomic initialization.
- Coexistence and durability guarantees (restart, rollback, initialization
  against an existing legacy database).
- Privacy and diagnostic rules for stored canonical evidence and for
  policy/validation results.

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
| **Raw observation** | An `EvidenceObservation`: the authoritative captured unit with container metadata (`observationId`, `eventId`, `traceId`, `spanId`, `seq`, `kind`, `capturedAt`, `evidenceStatus`, `observationRole`, `payload`, `rawCapturedAt`). `payload` is REQUIRED by the TypeScript interface and typed `unknown`; the fixtures and validators accept `null` for control events as a convention/parser-compatible representation, but `null` is not a TypeScript-enforced null type. |
| **Projected event** | The `EventRecord` produced by `projectCanonicalEvent(observation)`: container metadata minus observation provenance, with kind-specific payload fields merged onto the event top level. `EventRecord` has NO generic `payload` property. Control-event payloads are dropped by the projection. `EventCommon` includes `eventId`, `traceId`, `spanId`, `seq`, `kind`, `capturedAt`, `evidenceStatus`, and (payload-bearing kinds only) `observationRole`. |
| **Evidence status** | One of the six closed statuses `captured` \| `redacted` \| `truncated` \| `missing` \| `unknown` \| `not_applicable` (Spec 013 §4.1). `inferred` is not an evidence status. |
| **Serializer snapshot** | The authoritative comparison baseline for stored evidence: `parseEvidenceRecord(JSON.parse(serializeEvidenceRecord(validatedRecord))).record` — the record as reconstructed from its own serialized form, before persistence. Persisted and retrieved records are compared against this snapshot, never against the caller-owned input. |
| **Serialization boundary** | The point where the in-memory record becomes the stored document. Representation changes declared here: retained `Uint8Array` values become canonical RFC 4648 §4 Base64 strings; JSON serialization omits explicitly `undefined` optional properties and normalizes JSON values (no `undefined` vs absent distinction, no non-JSON numbers). |
| **Stored document** | The exact text produced by the public `serializeEvidenceRecord` serializer at write time; the single authoritative representation of the record inside the database. |
| **Storage manifest** | Administrative metadata recorded beside the stored document: storage-format version, evidence-schema version, persistence-policy name/version, storage timestamp, and the storage digest. Never part of the canonical record. |
| **Storage digest** | A deterministic SHA-256 hex digest computed over the exact UTF-8 bytes of the stored-document text (`sha256Hex(utf8Encode(storedDocument))`). Administrative integrity metadata; it supports detection and MAY serve as a lookup optimization, but exact document comparison — never digest equality alone — decides idempotency and conflicts. Never presented as canonical evidence and never conflated with `contentHash` or `nativeContentHash`. |
| **Storage safety gate** | The mandatory, non-bypassable admission gate that runs on every save. It has two phases: (1) a retained-bytes scan on the validated pre-serialization record (S6), which short-circuits on any finding, and (2) a text/structural scan on the detached snapshot (S1–S3, S5). Both phases produce closed `StorageSafetyCode`s and reject storage-prohibited material. Not overridable by any persistence policy. |
| **Persistence policy** | A named, versioned decision function that accepts or rejects a complete, detached, validated canonical record snapshot for persistence (Spec 013 §9.1). Custom policies are supported in this slice. A custom policy may be stricter than the safety gate, never weaker. Decisions are runtime-validated against a closed shape/code contract; rejection never carries custom free-form text. |
| **Detached snapshot** | A deep-frozen, caller-independent parse of the serialized document, passed to policy code; the caller's mutable record object is never passed to policy. |
| **Storage-owned reason code** | A closed, storage-defined vocabulary (S1, S2, S3, S5, S6 gate codes; policy codes `rejected`, `captured-content`, `unknown-additive-field`, `unbounded-label`; corrupt-read codes) that is the only text surfaced from admission and integrity results. Never derived from payload content. |
| **Declared content** | Content-bearing fields present on an observation whose `evidenceStatus` declares a retained representation: `redacted` (masked/removed per a recorded policy) or `truncated` (declared prefix/excerpt). Under `captured`, `missing`, `unknown`, or `not_applicable`, content-bearing fields are undeclared. |
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
  helpers directly. It retains its existing `@signalglass/core` dependency
  for the legacy `TraceStorage` surface and for the public
  `isCredentialLikeText` contract required by the safety gate (see "Storage
  safety admission gate"). This is the smallest dependency change: one
  additive workspace dependency, no new external runtime dependencies
  (SQLite already uses the existing `better-sqlite3`).
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
  read pipeline (see "Read pipeline"), never through an unguarded
  `parseEvidenceRecord(JSON.parse(text))` expression, because `JSON.parse`
  can throw.
- Retrieval MUST expose both forms: `getEvidenceRecord(identity)` returns
  the canonical record (parsed and re-validated); `getStoredEvidence(identity)`
  returns the canonical record **plus** its `StorageManifest`.

### Stored-versus-in-memory parity baseline

Persistence stores the serializer representation, not the caller's in-memory
object. The authoritative comparison baseline is therefore the **serializer
snapshot**:

```text
snapshot = parseEvidenceRecord(JSON.parse(serializeEvidenceRecord(validatedRecord))).record
```

- The persisted and retrieved record MUST equal the serializer snapshot —
  the validated record reconstructed from its own serialized form before
  persistence. The spec MUST NOT claim unconditional JavaScript object
  equality with the caller-owned input: `serializeEvidenceRecord` converts
  retained `Uint8Array` values to canonical Base64 and JSON round trips
  remove non-JSON distinctions such as explicitly `undefined` optional
  properties.
- **Representation changes are declared at the serialization boundary:** (a)
  retained `Uint8Array` payload bytes become canonical RFC 4648 §4 Base64
  strings (§5.7 of Spec 014); (b) JSON serialization omits explicitly
  `undefined` optional properties (absent, not `undefined`); (c) JSON values
  are otherwise normalized per the serializer contract. Storage adds no
  further changes.
- **Retained bytes are not persisted in this slice.** The mandatory safety
  gate rejects every `Uint8Array` in the validated pre-serialization record
  (S6) before serialization, so a record containing retained bytes can
  demonstrate the serialization-boundary representation change but cannot be
  persisted and retrieved here. The serializer-boundary test and the
  persisted-parity tests are therefore separate (see "Testing and
  conformance requirements" and "Acceptance criteria").
- **Persisted-versus-in-memory projection parity compares retrieval against
  the pre-persistence serializer snapshot**, never against the caller-owned
  input, using only gate-safe, policy-admitted records. Retrieval of a stored
  record, projected through `evidenceToLegacyTrace` / `evidenceToAgentRun`
  (or the composed report), MUST produce views and `ProjectionReport`s
  identical to projecting the snapshot.
- If parity with the original caller representation is claimed, it applies
  only to an explicitly admitted subset — records with no retained bytes and
  no `undefined`-optional differences, for which original-to-snapshot
  equivalence is proven separately (for example, by a documented equality
  test at the snapshot boundary). The spec makes no general claim of
  caller-input equality.
- Tests MUST include representation-sensitive values and MUST NOT normalize
  caller and snapshot values into equality before reporting their actual
  difference. Representation-sensitive *admitted* cases — such as explicitly
  `undefined` optional properties when they are valid on the record (e.g.
  `participants`, `conditions`, `contextContributions`, `usage`,
  `finishedAt`, `durationMs` when not terminal, optional `nativeEncoding`
  fields) — MAY be exercised through persistence. Prohibited retained bytes
  are exercised only at the serializer boundary, never through persistence.

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
   authoritative row and MUST NOT modify the existing row. Validation, the
   mandatory safety gate, and the currently selected persistence policy
   still run on every save; the idempotency promise applies only to records
   that pass those stages. A record rejected by validation, the gate, or the
   policy (or one that fails policy execution) returns its structured
   rejection and never reaches existing-row classification. The clock is
   consulted only for a genuinely new insertion, never to classify an
   existing immutable row (see Save pipeline).
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
   `invalid` with a **storage-safe** issue list (controlled codes and safe
   normalized paths only — never parser messages, caller-controlled
   identifiers, keys, or values) and writes nothing; malformed runtime input
   never throws.
9. **Storage-safety rejection.** A save of a record that contains
   storage-prohibited material returns `safety-rejected` with closed
   `StorageSafetyCode`s and writes nothing, regardless of the active policy.
10. **Storage-policy rejection.** A save that the active persistence policy
    rejects returns `policy-rejected` with the validated policy identity and
    a storage-owned code (never custom free-form text) and writes nothing.
11. **Policy execution failure.** A policy that throws, or that returns a
    malformed decision (see "Runtime validation of policy decisions"),
    returns `policy-failed` with a fixed storage-owned reason and writes
    nothing; the exception text, malformed value, and any custom code are
    never surfaced.

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
| **Collection-time evidence status** | Canonical evidence (capture boundary) | Redaction, truncation, missing, unknown, and not-applicable statuses are authoritative evidence (`evidenceStatus`), recorded at capture per Spec 013 §4.1/§9.2. Storage MUST NOT change them. |
| **Mandatory storage safety** | `EvidenceStorage` (storage invariant) | A non-bypassable admission gate (S1, S2, S3, S5, S6, closed deterministic contract) that rejects storage-prohibited material on every save, before any policy. Not configurable, not overridable, never weaker under any policy. |
| **Configurable persistence admission** | Operator policy (named + versioned) | The selected persistence policy accepts or rejects the complete detached record. Custom policies are supported. MAY be stricter than the mandatory gate; MUST NOT be weaker. |

### Storage safety admission gate

The safety gate MUST run for every save, before the persistence policy, and
MUST NOT be overridable by any custom policy or configuration. It rejects
the complete record — without modification — when it detects storage-
prohibited material. Because canonical storage cannot silently strip or
redact evidence, rejection is the correct behavior.

The gate contract is **closed and deterministic**: the rules below are
exact; implementations MUST produce identical complete outcomes for
identical input. The gate returns closed `StorageSafetyCode`s
(`'S1' | 'S2' | 'S3' | 'S5' | 'S6'`) and NEVER echoes the detected value.
The same input MUST produce the same complete result, including code set,
order, and deduplication.

**Code semantics, precedence, and deterministic output.**

```ts
export type StorageSafetyCode = 'S1' | 'S2' | 'S3' | 'S5' | 'S6';
```

The taxonomy deliberately contains no decorative or unreachable code. S1
and S3 are distinguished by whether the detector fires on the value or the
key; S2 is distinguished because sensitive HTTP/header keys are a specific
prohibited storage category. Old S4 (`storageKey`/`storage_key`) is folded
into S3 because the credential detector cannot distinguish a credential-
like value under a storage key from any other credential-like value.

At each traversed path, classification uses this precedence:

1. **S2** if the lowercased key is in the sensitive-header set.
2. **S3** if the lowercased key matches a sensitive-key pattern (including
   `storagekey` / `storage_key`) AND the value is not credential-like (if it
   were credential-like, S1 would match).
3. **S1** if the value is a credential-like string.
4. **S5** if the path describes a full raw/provider-native capture.
5. **S6** if the value is a `Uint8Array` (Phase A only).

A single matched path produces exactly one code. The returned array is
**deduplicated** (each code appears at most once) and sorted in canonical
order **S1, S2, S3, S5, S6**. A rejection always produces at least one code;
the array is never empty.

**Positive witnesses (each code must be emit-table):**

- **S1:** `{ someBody: "Bearer abc123" }` — value satisfies
  `isCredentialLikeText`, key is not sensitive.
- **S2:** `{ authorization: "anything" }` — key is in the sensitive-header
  set.
- **S3:** `{ password: "not-a-secret" }` or `{ storageKey: "s3://bucket/key" }`
  — key matches a sensitive-key pattern (or is `storagekey`/`storage_key`)
  and the value does not satisfy the credential detector.
- **S5:** a captured `model_request` whose `requestEnvelope` declares
  `providerNativeFidelity: 'byte_faithful'` or carries `providerNative`.
- **S6:** any `Uint8Array` nested anywhere in the validated pre-serialization
  record.

**Overlap controls:** a path with a sensitive-header key and a credential-
like value emits **S2** only (key precedence). A path with a sensitive-key
name and a credential-like value emits **S1** only (S3 is excluded because
its predicate requires a non-credential-like value). These rules make every
code reachable and every classification deterministic.

The gate has two phases:

1. **Phase A — retained-bytes scan (S6) on the validated pre-serialization
   record.** Runs before serialization because `serializeEvidenceRecord`
   converts every `Uint8Array` to a Base64 string (`toJsonView`), and a
   Base64-encoded credential cannot be detected by the string scanner.
   **Phase A short-circuits:** the first `Uint8Array` found returns
   `safety-rejected` with exactly `['S6']`; serialization and Phase B are
   skipped. This is safe because retained bytes are prohibited regardless
   of path, and it avoids converting them to an undetectable encoding.
2. **Phase B — text/structural scan (S1–S3, S5) on the detached snapshot.**
   Runs after serialization only when Phase A finds no retained bytes. The
   snapshot is the deep-frozen object tree that policy will evaluate; all
   values are JSON-safe (no `Uint8Array`).

Both phases are mandatory and non-bypassable; together they constitute the
storage safety gate. When S6 is emitted, it is the only code and Phase B
never runs.

**Case normalization (all key matching).** Keys are normalized with
`key.toLowerCase()` (JavaScript's default locale-independent case
conversion). Sensitive-key matching compares the lowercased key against the
closed sets and patterns below; pattern matching uses the exact regular
expressions as written here, applied case-insensitively to the ORIGINAL key
(the patterns are already case-insensitive by construction and are anchored
on substrings, matching the legacy behavior).

**S1 — Credential-like value.** Any string value that satisfies the required
credential detector `isCredentialLikeText(value)` (default options), at a
path whose lowercased key is NOT in the S2 sensitive-header set and does NOT
match an S3 sensitive-key pattern. This covers API keys, tokens, secrets,
credentials, authorization/cookie header shapes, bearer tokens,
environment-style secret assignments, and credential-like values under any
non-sensitive key.

**S2 — Sensitive header key.** Any key, lowercased, that is a member of the
closed sensitive-header set:

```text
authorization, x-api-key, cookie, set-cookie, proxy-authorization
```

(the legacy `SENSITIVE_HEADERS` from `packages/storage/src/redaction.ts`,
reproduced verbatim). S2 fires regardless of the value, and takes
precedence over S1 and S3. Header-shaped values on non-header keys are
handled by S1 (the credential detector matches them).

**S3 — Sensitive key name.** Any key, lowercased, that matches the exact
closed patterns `[/secret/i, /password/i, /credential/i, /auth/i]` or is
`storagekey` / `storage_key`, EXCEPT keys already covered by S2, AND where
the value is NOT credential-like (a credential-like value would be S1). This
fires on sensitive key names even when their value is not obviously
credential-like.

**Credential detector contract.** The gate MUST use the existing public
function `isCredentialLikeText(value: string, options?): boolean` from
`@signalglass/core` (defined as `redactSensitiveText(value, options) !==
value` in `packages/core/src/privacy.ts`), invoked with the DEFAULT options
(no `secretPatterns`). This is a normative requirement: the gate's value
scan IS that function's exact behavior — the closed built-in pattern set
covering `authorization` / `proxy-authorization` / `x-api-key` / `cookie` /
`set-cookie` header shapes, `Bearer <token>` shapes, `sk-`-prefixed keys,
`api[_-]?key` / `access[_-]?token` / `refresh[_-]?token` / `id[_-]?token` /
`auth(?:orization)?` / `secret` / `password` / `credential` /
`storageKey` / `storage_key` key-value and JSON-key assignments, and
`*API[_-]?KEY` / `*TOKEN` / `*SECRET` / `*PASSWORD` / `*AUTHORIZATION` /
`*COOKIE` environment-assignment shapes. The gate MUST NOT weaken or
reproduce a different detector; if `isCredentialLikeText` is unavailable at
runtime it is a configuration error (the constructor throws).

**Custom collection secret patterns do not participate.** The legacy
`sanitizeTraceForStorage` passes capture-profile `secretPatterns` into its
redaction; the canonical gate does NOT. The mandatory gate is a fixed
storage invariant, not a policy configuration, and it uses only the default
`isCredentialLikeText` contract. If a later accepted specification
introduces storage-scoped collection secret patterns, it MUST version them
(see "Gate and policy extension versioning").

**Phase B traversal (S1–S3, S5).** The gate walks the entire detached
snapshot recursively: every plain object and every array; for each key:
normalize and test the key against S2 (header set), S3 (sensitive-key
patterns); then test the value — strings via the credential detector (S1),
plain objects/arrays by recursion, and `null`, booleans, and finite numbers
without further scanning (they carry no text). **Base64 strings in the
snapshot** are scanned as ordinary strings: the detector does not decode
Base64, so Base64-encoded credential material is not itself detected — this
is an explicit limit of Phase B, and it is safe because Phase A (S6)
short-circuits on every pre-serialization `Uint8Array` before it could
become a Base64 string.

**S5 — Full raw/provider-native payload captures.** Normative predicate over
the ACTUAL evidence shapes (there is no generic `payload` property on
`EventRecord`; the gate classifies raw observations and their payloads). The
gate rejects an observation when:

- (a) its `kind` is payload-bearing, its `evidenceStatus` is `captured`, and
  its payload's envelope — `payload.requestEnvelope` for `model_request` or
  `payload.responseEnvelope` for `model_response` / `model_response_chunk` —
  declares `providerNativeFidelity: 'byte_faithful'` (a byte-exact capture of
  the full native payload); or
- (b) its `kind` is `model_request`, `model_response`, or
  `model_response_chunk`, its `evidenceStatus` is `captured`, and the
  envelope carries a non-absent `providerNative` value (the full
  provider-native body at its declared fidelity).

These are the only schema paths that represent full raw/provider-native
payload content. Captured canonical-common content (`messages`, tool
arguments/results, MCP/retrieval content, error text) is NOT rejected by S5
— the gate is content-agnostic beyond the security rules — but IS rejected
by the `metadata-safe` reference policy (M1). Payloads whose owning
`evidenceStatus` is `redacted` or `truncated` are declared retained
representations and are not full captures; S1–S3 still scan their values.

**S6 — Retained bytes anywhere (Phase A).** Recursively detect every
`Uint8Array` in the validated pre-serialization record, regardless of path:
in normalized messages, tool/MCP/retrieval/error content, declared
redacted/truncated content, unknown additive fields, and envelope byte
fields. Reject with S6 if any is present. This is necessary because
`serializeEvidenceRecord` converts `Uint8Array` values to Base64 strings, and
a Base64-encoded credential would evade the Phase B string detector. S6 does
NOT depend on `providerNativeFidelity`; it rejects all retained bytes before
serialization. **Phase A short-circuits:** the first `Uint8Array` returns
`safety-rejected` with exactly `['S6']`; Phase B does not run.

**Gate and policy extension versioning.** No extensions to S1–S3, S5, S6
exist in this slice. Any future conservative extension (for example,
additional detector patterns) MUST be versioned in a way that does not
change the meaning of existing stored records (a gate/storage-format version
bump with documented compatibility consequences, per "Versioning and
migration rules"), MUST be documented in the storage contract, and MUST NOT
retroactively reinterpret stored documents.

A record containing any S1–S3, S5, or S6 material is rejected as
`safety-rejected` with the deduplicated, canonically ordered list of
`StorageSafetyCode`s; nothing is written and no policy can admit it. When S6
is emitted, the result contains exactly `['S6']`.

### Persistence policy

- `EvidenceStorage` MUST be constructed with an explicit persistence policy
  (a missing policy is a configuration error and the constructor throws).
  There is no implicit default policy and **no default or reference policy
  that accepts arbitrary valid records**. Custom policies are supported in
  this slice; the public API and runtime validation contract apply to any
  policy, including operator-authored ones.
- The policy evaluates a **detached, deep-frozen snapshot** of the validated
  record — never the caller's mutable object (see "Mutation safety").
- The policy accepts or rejects the complete record. It MUST NOT silently
  strip fields, replace payloads, change evidence statuses, rewrite
  completeness, or store a modified value under the same authoritative
  identity.
- **Rejection is storage-safe.** The policy signals rejection with a
  storage-owned closed code; it MUST NOT return custom free-form text, and
  storage MUST NOT surface any policy-derived string. `policy-rejected`
  exposes the validated policy identity and a fixed structural code (see
  "Storage-safe policy and validation results").
- A custom policy may be stricter than the mandatory gate (for example,
  rejecting a content class the gate admits); it can never weaken or bypass
  the gate, which has already run.

### Reference policy: `signalglass.persistence.metadata-safe` (v1.0.0)

The initial slice ships exactly one conservative reference policy: **name**
`signalglass.persistence.metadata-safe`, **version** `1.0.0`. It is a
**schema-category persistence policy**: it classifies every field of the
record by schema category (metadata vs. content) and admits the record only
when content-bearing fields are absent or under an owning declaration and
all remaining fields belong to the admitted metadata set. It is strictly
stricter than the mandatory gate (which is repository-wide and
content-agnostic beyond S1–S3, S5, S6).

**Honest scope statement.** `metadata-safe` is a schema-category policy,
not proof that arbitrary metadata strings contain no sensitive content:
schema-owned free-text fields (declaration reasons/notes, validation
messages, boundary statements, usage reasons) are admitted as metadata
because the canonical schema requires them and the evidence contract
constrains their content (Spec 014 §10 — validation messages never echo
secrets or entire captured payloads), but the policy does not assert those
strings are innocuous. The mandatory credential detector scans every string
in the record recursively and rejects credential-like content anywhere in
it; nothing in `metadata-safe` weakens or bypasses that scan.

**Normative admission contract.** A record is admitted iff ALL of the
following hold; otherwise it is rejected with the matching storage-owned
code. The decision is evaluated on the deep-frozen detached snapshot; the
mandatory safety gate has already run and remains non-bypassable.

- **M0 — Safety gate passed.** The record contains no S1–S3, S5, or S6
  material (evaluated first, always).
- **M1 — Field-level content classification.** Every observation is
  classified field-by-field using the conformance table ("Field and category
  conformance table"). Content-classified fields are admitted ONLY under an
  owning retained-representation declaration — the observation's
  `evidenceStatus` is `redacted` or `truncated`. A content-classified field
  present under `captured` (no declaration), or under `missing` / `unknown` /
  `not_applicable` (declared absence carries no retained content), is
  rejected with `captured-content`. Whole-event statuses are NOT rejected:
  lifecycle and control observations legitimately carry
  `evidenceStatus: 'captured'` (their payloads carry no content), and
  required structural metadata (for example `span_start` span-derivation
  fields) is admitted under `captured`.
- **M2 — Unknown additive fields are fail-closed.** Any field not enumerated
  in the conformance table is an unknown additive field. At container and
  administrative paths (the observation container itself, control-event
  payloads, the trace, spans, analysis, completeness, captureBoundary,
  conditions, and inside every metadata-classified payload object), unknown
  fields MUST be absent or exactly `null` — otherwise rejected with
  `unknown-additive-field`. Under a content-classified payload of a declared
  observation (`redacted` / `truncated`), unknown fields are part of the
  declared content and are admitted — the declaration covers them, and the
  safety gate still scans their values. Unknown fields must never become an
  unchecked path for payload storage; under a `captured` observation, any
  unknown payload field is content and is rejected (with
  `unknown-additive-field` when the path is undeclared, or
  `captured-content` when nested under a known content-bearing field).
- **M3 — Bounded structural labels.** Identifier-like labels are admitted
  only when they are non-empty, contain no control characters, and are at
  most 128 code points: span `name`, each `participants[]` entry,
  `captureProfile.name`, each `conditions[].label`, envelope `model` /
  `provider`, `finishReason`, tool `name`, MCP `server` / `tool`,
  `contextProvider.name`, `contextProvider.kind`, `error.type`,
  `cancellation.requestedBy`. Longer, empty, or free-text values are
  rejected with `unbounded-label`.
- **M4 — Schema-owned free-text metadata.** The following schema-owned
  free-text fields are admitted as metadata (they are required or optional
  parts of the canonical schema and cannot be removed): `missingRecord.reason`
  and `missingRecord.note`, redaction `policy` and `reasons[]`,
  `completeness.boundaryStatement`, `analysis.validationIssues[].message`
  (constrained by Spec 014 §10), usage `reason` fields, and
  `truncation.maxLength` / `originalLength` (numbers). They are still scanned
  recursively by the mandatory credential detector; `metadata-safe` adds no
  length bound beyond the schema contract and makes no claim about their
  sensitivity (see "Honest scope statement").
- **M5 — Recursive, case-normalized traversal.** All classification
  traverses objects and arrays recursively with the same case normalization
  as the gate; detection never echoes values.

**Content-bearing fields (rejected under M1 unless declared):**

- `requestEnvelope.messages` and `requestEnvelope.providerNative`
  (`model_request`);
- `responseEnvelope.providerNative` (`model_response`,
  `model_response_chunk`);
- `responseEnvelope.usage` unless it matches the policy-owned numeric
  allowlist described below;
- `tool.arguments` (`tool_call`);
- `toolResult.stdout`, `toolResult.stderr`, and every other `toolResult` key
  beyond `exitCode` (`tool_result`);
- `mcp.arguments` (`mcp_request`); `mcpResult.content` and every other
  `mcpResult` key (`mcp_result`);
- `retrieval.query` and every other `retrieval` key beyond `topK`
  (`retrieval_request`); `retrievalResult.query` and every other
  `retrievalResult` key beyond `resultCount` (`retrieval_result`);
- `error.message` and every other `error` key beyond `type` (`error`);
- `conditions[].value` (the TypeScript type requires it; for `metadata-safe`
  it is admitted only when exactly `null`);
- any unknown additive field at an undeclared path (M2).

**Response-envelope usage numeric allowlist.** `ResponseEnvelope.usage` is
`unknown` in the evidence types, not `UsageRecord`. Under `metadata-safe`
v1.0.0 it is admitted ONLY when it is an object whose every own enumerable
key is one of `inputTokens`, `outputTokens`, or `totalTokens`, and every
value is a finite non-negative number. Any other key, any non-numeric/
non-finite/negative value, or any non-object value makes the field
content-bearing. (This is a policy-owned allowlist; it does not change the
underlying `unknown` type.)

**Typed `model_usage.usage` admission.** `UsageRecord.inputTokens`,
`outputTokens`, and `totalTokens` are typed `UsageValue | undefined` in
`@signalglass/evidence` (not `number | UsageValue`). The current validators
tolerate broader values, but tolerance is not the TypeScript contract. For
`metadata-safe` v1.0.0, each of these fields is admitted only when absent
(`undefined`) or a `UsageValue` object whose `value` (if present) is a
finite non-negative number and whose `evidenceStatus` (if present) is one
of the closed evidence statuses. The `reason` field, if present, is schema-
owned free text (M4). A plain number value is NOT admitted (it does not
match the TypeScript contract), even if the validator currently tolerates
it.

**Permitted metadata set (normative enumeration):**

- **Observation container (raw representation):** `observationId`, `eventId`,
  `traceId`, `spanId`, `seq`, `kind`, `capturedAt`, `evidenceStatus`,
  `observationRole`, `rawCapturedAt`.
- **Projected event common fields (both representations):** `eventId`,
  `traceId`, `spanId`, `seq`, `kind`, `capturedAt`, `evidenceStatus`,
  `observationRole` (payload-bearing kinds only).
- **Trace:** `interactionId`, `traceId`, `evidenceSchemaVersion`,
  `captureProfile.name` (M3), `captureProfile.version` (semantic version),
  `captureSurface`, `observationBoundary`, `startedAt`, `status`,
  `finishedAt`, `conditions[].label` (M3), `conditions[].version` (semantic
  version), `conditions[].value` (only when exactly `null`).
- **Spans:** `spanId`, `kind`, `parentSpanId`, `startSeq`, `startedAt`,
  `status`, `endSeq`, `finishedAt`, `durationMs`; `name` (M3) and
  `participants` (M3).
- **Raw control-observation payloads (span derivation metadata):**
  `span_start` payload `span.kind` (closed), `span.name` (M3),
  `span.parentSpanId` (identifier or `null`); `span_end` payload
  `durationMs` (non-negative number). Nothing else in a control payload.
- **Envelope administrative fields:** `providerNativeFidelity` (closed
  fidelity vocabulary), `nativeEncoding` / `nativeContentType` /
  `nativeContentHash` (administrative; reachable only after Phase A S6
  passes — byte_faithful captured payloads are rejected before
  serialization, so these fields appear only on declared payloads or on
  captured structurally_faithful envelopes without retained bytes, and they
  are scanned by the gate).
- **Request envelope metadata:** `requestEnvelope.model` (M3),
  `requestEnvelope.provider` (M3), `providerNativeFidelity` (closed),
  `contextContributions` (metadata: `artifactId` id, `locator.type` closed,
  `position` number, `provenanceState` closed).
- **Response envelope metadata:** `responseEnvelope.providerNativeFidelity`
  (closed), `responseEnvelope.finishReason` (M3), `responseEnvelope.usage`
  only under the numeric allowlist, `responseEnvelope.chunkIndex` (number).
- **Usage (`model_usage.usage`):** `usage.evidenceStatus` (closed),
  `usage.inputTokens` / `outputTokens` / `totalTokens` each admitted only as
  `UsageValue | undefined` per the TypeScript contract (see "Typed
  `model_usage.usage` admission"); `reason` free-text fields are M4.
- **Lifecycle targeting / retry references:** `actor`, `lifecycleTarget`,
  `lifecycleEffect` (closed vocabularies); `retry.originalRequestEventId`,
  `retry.errorEventId` (identifiers), `retry.attempt`, `retry.observedDelayMs`
  (numbers); `cancellation.requestedBy` (M3); `cancellation.lifecycleEffect`
  (`'cancel'`).
- **Context contributions:** `artifactId` (identifier), `locator.type`
  (closed), `position` (number), `provenanceState` (closed).
- **Record / analysis / completeness / captureBoundary:** `evidenceSchemaVersion`,
  `captureBoundary.*` (`captureSurface`, `observationBoundary`,
  `declaredEventKinds`, `declaredSurfaces`, `missingRecord` and its fields —
  `reason`/`note` M4, `reportedBy.captureSurface`/`observationBoundary`
  closed), `analysis.*` (`duplicateObservations` with identifiers, digests,
  seq positions; `sequenceGaps` with identifiers; `validationIssues` with
  `code`, `path`, `message` (M4); `completenessDerivationAlgorithmVersion`),
  `completeness.*` (`eventsByStatus` counts, `seqGaps`, `duplicatesDetected`
  identifiers, `boundaryStatement` (M4)).
- **Declarations:** redaction `policy`/`reasons[]` (M4), truncation
  `maxLength`/`originalLength`, missing `reason`/`note`/`reportedBy` (M4).

### Field and category conformance table

Normative. Every event kind, in BOTH representations: the raw observation
payload paths (`payload.<path>`) and the projected `EventRecord` fields
(kind-specific fields merged at the top level by `projectCanonicalEvent`;
`projected —` means the projection drops the payload). Classification
values: **meta** (metadata), **label** (bounded structural label, M3),
**content** (content-bearing, declared-only, M1), **usage** (content unless
it matches the `responseEnvelope.usage` numeric allowlist), **unknown**
(unknown additive field, fail-closed, M2), **n/a** (no such field). Container
metadata on both representations (`eventId`, `traceId`, `spanId`, `seq`,
`kind`, `capturedAt`, `evidenceStatus`, `observationRole`; raw-only
`observationId`, `rawCapturedAt`) is always **meta**.

| Kind | Raw observation payload paths | Projected `EventRecord` fields | Classification |
|---|---|---|---|
| `interaction_start` | `payload: null` (fixture/parser convention); anything else | — | meta / **unknown** |
| `interaction_end` | `payload: null` (fixture/parser convention); anything else | — | meta / **unknown** |
| `span_start` | `payload: null` or `payload.span.kind` (closed), `payload.span.name` (label), `payload.span.parentSpanId` (id \| `null`); anything else | — (payload dropped) | meta / label / **unknown** |
| `span_end` | `payload: null` or `payload.durationMs` (non-negative number); anything else | — (payload dropped) | meta / **unknown** |
| `model_request` | `payload.requestEnvelope.model` (label), `payload.requestEnvelope.provider` (label), `payload.requestEnvelope.providerNativeFidelity` (closed), `payload.requestEnvelope.nativeEncoding` / `nativeContentType` / `nativeContentHash` (admin), `payload.requestEnvelope.messages` (content), `payload.requestEnvelope.providerNative` (content), `payload.contextContributions` (meta), other envelope/payload keys (unknown) | `requestEnvelope.*` (same paths), `contextContributions` | meta / label / content / **unknown** |
| `model_response` | `payload.responseEnvelope.providerNativeFidelity` (closed), `payload.responseEnvelope.finishReason` (label), `payload.responseEnvelope.usage` (usage: numeric allowlist only), `payload.responseEnvelope.chunkIndex` (number), `payload.responseEnvelope.providerNative` (content), `payload.responseEnvelope.nativeEncoding` / `nativeContentType` / `nativeContentHash` (admin), other envelope/payload keys (unknown) | `responseEnvelope.*` (same paths) | meta / label / usage / content / **unknown** |
| `model_response_chunk` | `payload.responseEnvelope.*` as `model_response` | `responseEnvelope.*` as `model_response` | meta / label / usage / content / **unknown** |
| `model_usage` | `payload.usage.evidenceStatus` (closed), `payload.usage.inputTokens` / `outputTokens` / `totalTokens` (`UsageValue \| undefined` per TypeScript; validator tolerates broader values), `payload.usage.reason` (M4) | `usage.*` | meta |
| `tool_call` | `payload.tool.name` (label), `payload.tool.arguments` (content), other tool keys (unknown) | `tool.*` | label / content / **unknown** |
| `tool_result` | `payload.toolResult.exitCode` (number); `payload.toolResult.stdout` (content), `payload.toolResult.stderr` (content), every other `toolResult` key (content) | `toolResult.*` | meta / content |
| `mcp_request` | `payload.mcp.server` (label), `payload.mcp.tool` (label), `payload.mcp.arguments` (content), other mcp keys (unknown) | `mcp.*` | label / content / **unknown** |
| `mcp_result` | `payload.mcpResult.content` (content), every other `mcpResult` key (content) | `mcpResult.*` | content |
| `retrieval_request` | `payload.retrieval.query` (content), `payload.retrieval.topK` (number), other retrieval keys (unknown) | `retrieval.*` | content / meta / **unknown** |
| `retrieval_result` | `payload.retrievalResult.query` (content), `payload.retrievalResult.resultCount` (number), every other `retrievalResult` key (content) | `retrievalResult.*` | content / meta |
| `context_provider_request` | `payload.contextProvider.name` (label), `payload.contextProvider.kind` (label), other keys (unknown) | `contextProvider.*` | label / **unknown** |
| `context_provider_result` | as above | `contextProvider.*` | label / **unknown** |
| `context_assembled` | `payload.contextContributions[]` (`artifactId` id, `locator.type` closed, `position` number, `provenanceState` closed); other contribution keys (unknown) | `contextContributions` | meta / **unknown** |
| `error` | `payload.actor` (closed), `payload.lifecycleTarget` (closed), `payload.lifecycleEffect` (closed), `payload.error.type` (label), `payload.error.message` (content), other `error` keys (content) | `actor`, `lifecycleTarget`, `lifecycleEffect`, `error.*` | meta / label / content |
| `cancelled` | `payload.lifecycleTarget` (closed), `payload.lifecycleEffect: 'cancel'` (closed), `payload.cancellation.requestedBy` (label), other cancellation keys (unknown) | `lifecycleTarget`, `lifecycleEffect`, `cancellation.*` | meta / label / **unknown** |
| `retry` | `payload.retry.originalRequestEventId` (id), `payload.retry.errorEventId` (id), `payload.retry.attempt` (number), `payload.retry.observedDelayMs` (number), other retry keys (unknown) | `retry.*` | meta / **unknown** |

**Content ownership rule.** A `content`-classified field is admitted ONLY
when its observation's `evidenceStatus` is `redacted` or `truncated`
(declared retained representation). Under `captured` — including lifecycle
events, which legitimately carry `captured` while their payloads carry no
content — content-classified fields are rejected (`captured-content`). Under
`missing` / `unknown` / `not_applicable` (declared absence), content must be
absent; a content-classified field present there is also rejected with
`captured-content` (the code's meaning: content present without an owning
retained-representation declaration).

**Proof record (normative, fixture-derived).** The policy MUST admit the
following realistic valid record, and MUST reject its captured-content
variant. Both records are schema-valid per the public
`normalizeEvidenceRecord` contract (verified against the `@signalglass/evidence`
package; timestamps and identifiers fixed):

1. `interaction_start` — `evidenceStatus: 'captured'`, `payload: null`.
2. `span_start` — `evidenceStatus: 'captured'`,
   `payload: { span: { kind: 'model', name: 'model:claude-sonnet-4',
   parentSpanId: null } }` (required span-derivation metadata).
3. `model_request` — `evidenceStatus: 'redacted'`,
   `observationRole: 'client_sent'`,
   `payload: { requestEnvelope: { model: 'claude-sonnet-4',
   provider: 'anthropic', providerNativeFidelity: 'structurally_faithful' },
   contextContributions: [] }` (declared; no `messages`, no `providerNative`).
4. `model_response` — `evidenceStatus: 'truncated'`,
   `observationRole: 'provider_reported'`,
   `payload: { responseEnvelope: { providerNativeFidelity:
   'structurally_faithful', finishReason: 'end_turn',
   usage: { inputTokens: 3, outputTokens: 1 } } }` (declared; usage admitted
   ONLY via the numeric allowlist).
5. `span_end` — `evidenceStatus: 'captured'`, `payload: { durationMs: 3000 }`.
6. `interaction_end` — `evidenceStatus: 'captured'`, `payload: null`.

With a `captureProfile` of `{ name: 'dev-basic', version: '1.2.0' }` and the
standard boundary declaration, this record normalizes, serializes, and
re-parses successfully and MUST be admitted by `metadata-safe` v1.0.0
(lifecycle/control events are `captured` and carry no content; the
`span_start` payload is the required structural span metadata; the
`model_request` / `model_response` content is declared; `responseEnvelope.
usage` satisfies the numeric allowlist).

**Negative control.** The same record with the `model_request` observation
changed to `evidenceStatus: 'captured'` and the envelope extended with
`messages: [{ role: 'user', content: 'hello' }]` and
`providerNative: { temperature: 0.2 }` is ALSO schema-valid (the evidence
validators permit captured content) but MUST be rejected by
`metadata-safe` with `captured-content`. This proves the policy rejects
captured user/provider content while admitting normal captured lifecycle
observations.

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
   mutation attempt fails.
4. **Pass the deep-frozen snapshot as a deeply readonly policy view** to
   `persistencePolicy.decide(snapshot)`.
5. **Persist the pre-policy serialized document only if admission succeeds**;
   the policy can never alter what is written, because the document was fixed
   at step 1 and the snapshot cannot be mutated.

**Classification boundary.** The storage layer MUST NOT attempt to classify
WHY arbitrary policy code threw. A policy may independently throw a
`TypeError` for its own reasons, so a thrown `TypeError` is never treated as
evidence of a mutation attempt. Every exception from policy execution, and
every malformed decision result (see "Runtime validation of policy
decisions"), maps to the single `policy-failed` outcome with a fixed
storage-owned reason. The deep-frozen snapshot still guarantees mutation
isolation in fact — the storage layer simply does not claim to infer the
cause of a throw. A distinct `mutation-attempted` outcome would require a
deterministic mutation-trapping mechanism (for example, a proxy with a
storage-owned sentinel that cannot be confused with an arbitrary policy
exception); no such mechanism is introduced, so no such outcome exists.

Consequences, all normative:

- A policy that throws for any reason writes nothing; the save returns
  `policy-failed` (`reason: 'exception'`). This is a structured
  configuration/policy failure, not an environmental throw, and it must not
  crash a save loop.
- A policy that returns a malformed decision writes nothing; the save
  returns `policy-failed` (`reason: 'malformed-decision'`). The malformed
  value and any custom code are never surfaced.
- The underlying exception message is never surfaced by storage (a policy
  could embed payload values in its own error text); only the structural
  outcome is reported.
- A mutating or throwing policy cannot alter: the caller's record, the
  stored document, the authoritative identity, completeness, evidence
  status, or the digest basis (all fixed before policy evaluation). Tests
  prove these facts directly; they do not claim storage can infer why
  policy code threw.

### Runtime validation of policy decisions

TypeScript's `PolicyRejectionCode` union does not constrain arbitrary
JavaScript policy implementations at runtime. After
`persistencePolicy.decide(snapshot)` returns, storage MUST validate the
result BEFORE reading or surfacing any property. **Every reflection step
must be guarded:** accessing `.then`, enumerating own keys, reading
property descriptors, reading `accept`, reading `code`, or any other
property access can throw; any throw maps to the fixed `policy-failed`
outcome without surfacing exception text or partially read values.

Precise validation contract:

1. **Plain-object requirement.** The result MUST be a plain object:
   `typeof result === 'object'`, `result !== null`, `!Array.isArray(result)`,
   and `Object.getPrototypeOf(result)` is either `Object.prototype` or
   `null`. Objects inheriting from other prototypes (for example, `Error`,
   `Map`, custom classes) are NOT plain objects and are malformed.
2. **Guarded thenable check.** Test `typeof result.then === 'function'`
   inside a guarded boundary. If accessing `.then` throws, or if the value
   is callable as a thenable, the result is malformed. This check MUST be
   performed before enumerating keys so that a throwing getter on another
   property cannot escape.
3. **Guarded exact own-key enumeration.** Use `Reflect.ownKeys(result)`
   inside a guarded boundary. The result MUST have exactly the own keys
   `['accept']` (when `accept` is `true`) or `['accept', 'code']` (when
   `accept` is `false`). **Symbol keys are not ignored:** any symbol own
   key makes the result malformed. Extra string keys, missing keys, or
   non-enumerable keys also make it malformed.
4. **Guarded property-descriptor inspection.** For each own key, inspect
   `Reflect.getOwnPropertyDescriptor(result, key)` inside a guarded
   boundary. The descriptor MUST be a **data descriptor** (`value` present,
   no `get`/`set` accessor). Accessor descriptors are rejected without
   invoking them. The `enumerable` flag MUST be `true`.
5. **Guarded value reads.** Read each value via `Reflect.get(result, key)`
   inside a guarded boundary. A throwing getter, Proxy trap, or accessor
   maps to malformed.
6. **Guarded `accept` read.** The `accept` value MUST be strictly boolean
   `true` or `false` — not a truthy value, not a `Boolean` object, not a
   string. If `accept` is not a boolean, the result is malformed.
7. **Guarded `code` read (when `accept === false`).** The `code` value MUST
   be a string and MUST be one of the closed `PolicyRejectionCode` values:
   `'rejected' | 'captured-content' | 'unknown-additive-field' |
   'unbounded-label'`. Any other string — including a secret value used as
   a code — is malformed.
8. **No custom-policy code restriction.** Every policy, custom or
   reference, may return any code in the closed vocabulary. The
   `captured-content` / `unknown-additive-field` / `unbounded-label` codes
   are not claimed to prove the storage-shipped implementation; they are
   simply closed codes available to any policy. This removes the spoofing
   risk entirely.
9. **Outcome mapping.** Every malformed result — null, primitives, arrays,
   functions, promises/thenables, non-plain objects, guarded access throws,
   symbol keys, accessor descriptors, non-enumerable keys, extra/missing
   keys, non-boolean `accept`, unknown/data-derived `code`, or any other
   violation — maps to the single fixed storage-owned outcome
   `policy-failed` (`reason: 'malformed-decision'`). The malformed value,
   the custom code, and any policy text are never surfaced, logged, or
   stored.

Sentinel tests MUST prove that a custom policy returning a secret value as
its `code` (for example `{ accept: false, code: 'sk-abc123…' }`), a Proxy
with a throwing getter, an accessor descriptor, or a symbol-keyed object
yields `policy-failed` and that no malformed value or partially read value
appears in the outcome, diagnostics, or database.

### Policy identity: unspoofable and leak-safe

The storage-shipped reference policy is provided as a concrete exported
value (for example, a singleton object or class instance) from
`@signalglass/storage`. The constructor recognizes it by **object identity**
(`===`) and/or an internal non-forgeable brand. A caller-supplied plain
object whose `name` equals the reserved reference policy name
`signalglass.persistence.metadata-safe` is rejected as a configuration
error; only the genuine storage-shipped value may use that reserved name.
This makes reference-policy identity unspoofable without requiring the
storage layer to trust public name/version strings.

**Policy-name grammar and safety.** Every policy name, including the
reserved reference policy name, MUST satisfy a bounded structural grammar
and be leak-safe:

- Non-empty string, at most 128 code points.
- Contains only lowercase ASCII letters (`a–z`), digits (`0–9`), dots
  (`.`), hyphens (`-`), and underscores (`_`).
- Starts with a lowercase ASCII letter.
- Regular expression: `^[a-z][a-z0-9._-]{0,127}$`.
- The name MUST NOT satisfy `isCredentialLikeText(name)` (default options).
  Credential-like policy names are rejected at construction.

**Policy-version grammar and safety.** Policy versions MUST satisfy a
bounded semantic-version grammar with NO prerelease or build suffixes:

- Non-empty string, at most 64 code points.
- Exactly three dot-separated numeric components: `MAJOR.MINOR.PATCH`.
- Each component is a non-negative integer with no leading zeros, except
  that the literal `0` is permitted.
- Regular expression: `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`.

Versions with leading zeros, non-numeric components, extra dots,
prerelease suffixes (e.g. `1.0.0-beta`), or build metadata (e.g.
`1.0.0+20250801`) are rejected at construction. This bound prevents policy
metadata from carrying arbitrary secret text.

**Policy metadata in outcomes and manifests.** `policy-rejected`,
`policy-failed`, and `StorageManifest` expose only the validated policy
`name` and `version`. Because the grammar and credential scan bound both,
policy identity cannot carry arbitrary secret text.

**Read-time policy-metadata validation.** On read, the stored
`persistence_policy_name` and `persistence_policy_version` MUST be validated
using the same leak-safe rules used at construction (bounded grammar,
credential scan for the name, bounded semantic-version grammar for the
version) BEFORE any manifest is exposed. Invalid stored policy metadata
returns `corrupt` (`policy_metadata_malformed`) and MUST NOT be returned in
a manifest or logged.

Sentinel tests MUST prove: a caller cannot spoof the reference policy with
a plain object bearing the reserved name; a policy with a credential-like
name or oversized/invalid/malformed version is rejected at construction; a
policy name containing secrets does not appear in storage or outcomes; a row
with tampered policy metadata (invalid characters, oversized version,
credential-like name) returns `corrupt` and leaks no metadata.

### Persistence-time removal

Persistence-time removal is not representable honestly in this slice.
Removing content at persistence time would require a canonical successor
record with provenance, completeness changes, and/or an administrative
deletion record (Spec 013 §9.2). That mechanism is deferred (see "Deletion
and tombstones"); it is not approximated by silent stripping, and the safety
gate's or policy's rejection is not a rewrite — it is a whole-record
admission decision.

### Storage-safe policy and validation results

**Policy rejection.** The policy contract uses a closed, storage-owned code
vocabulary (see "Runtime validation of policy decisions"). Storage MUST NOT
surface any free-form policy text: `policy-rejected` carries the validated
policy identity and the code only. Policy rejection reasons can therefore
never be derived from — or leak — payload content.

**Validation results.** The `invalid` outcome MUST NOT surface
`ValidationIssue` objects as returned by `parseEvidenceRecord`: existing
parser messages and some paths can interpolate caller-controlled event,
span, observation, or version values. Storage exposes a **storage-safe
validation result** instead:

```ts
export interface StorageSafeIssue {
  /** Controlled issue code from the @signalglass/evidence vocabulary
   *  (for example "record_not_object"); never a parser message. */
  code: string;
  /** Normalized structural path, included ONLY when it consists solely of
   *  known-schema field names and numeric indices — never
   *  caller-controlled identifiers, unknown keys, or values; else null. */
  path: string | null;
}
```

The `invalid` outcome carries `issues: readonly StorageSafeIssue[]`.
Parser messages are never surfaced; paths containing caller-controlled
identifiers or unknown keys are omitted (`null`); identifiers, keys, and
values never appear.

### Policy contract

```ts
import type { EvidenceRecord } from '@signalglass/evidence';

/** Deeply readonly structural variant of EvidenceRecord. */
export type ReadonlyEvidenceRecord = DeepReadonly<EvidenceRecord>;

/** Closed, storage-owned rejection codes available to any policy
 *  (see "Runtime validation of policy decisions"). */
export type PolicyRejectionCode =
  | 'rejected'
  | 'captured-content'
  | 'unknown-additive-field'
  | 'unbounded-label';

/** Closed, storage-owned safety-gate codes (see "Storage safety admission
 *  gate"). */
export type StorageSafetyCode = 'S1' | 'S2' | 'S3' | 'S5' | 'S6';

/** Fixed storage-owned failure reasons; never exception text, malformed
 *  values, or custom codes. */
export type PolicyFailureReason = 'exception' | 'malformed-decision';

export interface PersistencePolicy {
  /** Nonempty, stable policy name. Must satisfy the bounded grammar and
   *  credential scan (see "Policy identity"). */
  name: string;
  /** Valid semantic version of this policy definition (Spec 013 §9.2),
   *  bounded to MAJOR.MINOR.PATCH with no prerelease/build suffixes. */
  version: string;
  /** Whole-record admission decision on the deep-frozen detached snapshot.
   *  MUST NOT mutate the snapshot; MUST NOT rewrite or return a modified
   *  record; MUST NOT return free-form rejection text. The result is
   *  runtime-validated by storage (see "Runtime validation of policy
   *  decisions"). */
  decide(snapshot: ReadonlyEvidenceRecord): PersistencePolicyDecision;
}

export type PersistencePolicyDecision =
  | { accept: true }
  | { accept: false; code: PolicyRejectionCode };
```

Policy name/version validity is enforced at construction: an empty name, a
name violating the grammar, a credential-like name, or a version violating
the bounded semantic-version grammar is a configuration error and the
constructor throws. The reserved reference policy name is accepted only
from the storage-shipped reference policy value.

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

export interface StorageSafeIssue {
  /** Controlled issue code from the @signalglass/evidence vocabulary;
   *  never a parser message. */
  code: string;
  /** Normalized structural path (known field names + numeric indices only)
   *  or null when the path would carry caller-controlled identifiers,
   *  unknown keys, or values. */
  path: string | null;
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
  | { status: 'invalid'; identity: string | null; issues: readonly StorageSafeIssue[] }
  | { status: 'unsupported-version'; version: string }
  /** Mandatory storage-safety gate rejection; closed StorageSafetyCode[] only. */
  | { status: 'safety-rejected'; reasons: readonly StorageSafetyCode[] }
  | {
      status: 'policy-rejected';
      policy: { name: string; version: string };
      code: PolicyRejectionCode;
    }
  | {
      status: 'policy-failed';
      policy: { name: string; version: string };
      reason: PolicyFailureReason;
    }
  /** The injected clock threw or returned a non-ISO-8601 value; nothing
   *  written. Only reached for a genuinely new insertion (see Save pipeline). */
  | { status: 'clock-failed' };

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
  /** Required — no implicit default policy (see Persistence-policy boundary).
   *  Custom policies are supported; the reserved reference policy name is
   *  accepted only from the storage-shipped reference policy value. */
  persistencePolicy: PersistencePolicy;
  /** Injectable ISO 8601 UTC clock for storedAt; default: () => new Date().toISOString().
   *  Validated per new insertion; a throw or malformed result yields
   *  `clock-failed` with no write (see Save pipeline). */
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
malformed input. **Idempotency classification never requires the clock**:
validation, the mandatory safety gate, and the selected policy run on EVERY
save, but an existing immutable row is classified (`already-present` /
`conflict`) without calling `now()`; the clock is required only for a
genuinely new insertion.

1. **Shape guard.** `input` must be a non-null object (a plain structural
   object check). Otherwise return `invalid` with a single storage-safe
   issue (`record_not_object`). No property access occurs before this step.
2. **Version triage.** Now that the shape is guaranteed, read
   `input.evidenceSchemaVersion` and apply the public
   `checkEvidenceSchemaVersion` contract:
   - `invalid_syntax` (absent, non-string, or non-semantic version) →
     return `invalid` (storage-safe issues from `parseEvidenceRecord`, which
     never throws; identity `null`).
   - `unsupported_major` → return `unsupported-version` with the version
     string; nothing written. A syntactically valid but unsupported major is
     a version refusal, not an invalid record.
3. **Full validation.** `parseEvidenceRecord(input)`:
   - failure → `invalid` with storage-safe issues (identity `null` — a
     failed parse is not trusted for identity);
   - success → `validatedRecord`. This is the ONLY record shape that is
     serialized and passed toward policy; the caller's original object is
     not used again.
4. **Mandatory safety gate — Phase A (S6, retained bytes).** Recursively
   scan `validatedRecord` for any `Uint8Array` value. Any occurrence →
   return `safety-rejected` with exactly `['S6']`; nothing written. **Phase
   A short-circuits:** serialization and Phase B are skipped. This MUST
   happen before serialization because `serializeEvidenceRecord` converts
   retained bytes to Base64, which the string detector cannot decode.
5. **Serialize first.** `storedDocument = serializeEvidenceRecord(validatedRecord)`
   — the exact text that will be persisted. (The serializer re-validates and
   throws only on an already-invalid record — a programming-error guard, not
   a data path.) The serializer snapshot
   (`parseEvidenceRecord(JSON.parse(storedDocument)).record`) is the parity
   baseline for everything downstream.
6. **Detached snapshot.** `snapshot = parseEvidenceRecord(JSON.parse(storedDocument)).record`
   (always `ok` — the same serializer produced the text) and **deep-freeze**
   it. The caller's mutable object is never passed to policy.
7. **Mandatory safety gate — Phase B (S1–S3, S5).**
   `detectStorageProhibitedMaterial(snapshot)`: any S1–S3 or S5 finding →
   return `safety-rejected` with the deduplicated, canonically ordered codes;
   nothing written. Non-bypassable. Phase B never emits S6.
8. **Policy admission.** `persistencePolicy.decide(snapshot)` (deep-frozen,
   deeply readonly), then **runtime-validate the decision** (see "Runtime
   validation of policy decisions"):
   - `{ accept: false; code }` (valid) → `policy-rejected` with policy
     identity and the storage-owned code; nothing written.
   - throws for any reason → `policy-failed` (`reason: 'exception'`);
     nothing written; the exception message is never surfaced and the cause
     is never classified.
   - malformed decision → `policy-failed` (`reason: 'malformed-decision'`);
     nothing written; the malformed value and any custom code are never
     surfaced.
9. **Digest.** `storageDigest = sha256Hex(utf8Encode(storedDocument))` — over
   the exact UTF-8 bytes of the exact stored serializer output (public
   `sha256Hex(bytes: Uint8Array)` and `utf8Encode(text: string)` from
   `@signalglass/evidence`).
10. **Append (transactional).** Inside one transaction: read the existing
    row by identity:
    - **absent** → call and validate the clock:
      - `now()` throws or returns a non-ISO-8601-UTC value →
        `clock-failed`; the transaction rolls back; nothing written (a
        structured configuration-failure outcome, not a database write);
      - else `storedAt = now()`; `INSERT` (document + administrative
        columns) → return `stored` with the manifest;
    - **present** → **compare the exact stored `serialized_record` text with
      `storedDocument` without calling the clock**: exact text equality →
      `already-present`; different text → `conflict` — **regardless of
      whether the digests match**. Digest equality is never proof of document
      equality; the digest may be an integrity check or lookup optimization
      but MUST NOT replace exact text comparison for correctness. The
      `conflict` outcome reports the existing row's `stored_at` from the
      administrative columns.
    - A unique-key constraint raced by a concurrent writer is resolved by
      re-reading inside the transaction and classifying by the same exact-text
      comparison — never surfaced as a raw constraint error, and the clock is
      not re-entered for a row that now exists.

**Consequences (normative):** an unused or failing clock can never prevent
classification of an existing immutable row. A byte-identical repeat or a
conflicting write returns `already-present` / `conflict` even when the
injected clock would throw, because the clock is never consulted for an
existing row. `clock-failed` occurs only when a genuinely new insertion's
clock misbehaves, and then nothing is written.

### Read pipeline (normative order)

Reads are fully structured; nothing in the read path throws for stored-data
conditions. **Integrity is verified before any document is trusted, and
`unsupported-version` is returned only for byte-intact, structurally
inspectable JSON with consistent supported storage metadata.** A tampered or
administratively inconsistent row returns `corrupt` even when its serialized
text names an unsupported version.

1. **Read the row** by identity. Absent → `not-found`.
2. **Safely parse JSON** inside a guarded boundary (`try/catch` around
   `JSON.parse(serialized_record)`). Malformed JSON → `corrupt`
   (`json_parse_failed`).
3. **Administrative integrity — before trusting the document, and without
   parsing the evidence schema** (these checks depend only on the row
   columns and the raw stored text):
   - row `storage_format_version` === the supported canonical-store format
     → else `corrupt` (`format_version_mismatch`);
   - row `evidence_identity` === requested identity → else `corrupt`
     (`identity_mismatch`);
   - `persistence_policy_name` satisfies the construction-time policy-name
     grammar AND is not credential-like → else `corrupt`
     (`policy_metadata_malformed`);
   - `persistence_policy_version` satisfies the bounded semantic-version
     grammar → else `corrupt` (`policy_metadata_malformed`);
   - `stored_at` a valid ISO 8601 timestamp → else `corrupt`
     (`stored_at_malformed`);
   - **digest check:** `sha256Hex(utf8Encode(serialized_record_text))` must
     equal the row's `storage_digest` → else `corrupt` (`digest_mismatch`).
     A tampered document is caught here before it is trusted in any way.
4. **Version triage** (a structural JSON field; no schema parsing).
   `checkEvidenceSchemaVersion(doc.evidenceSchemaVersion)`:
   - `invalid_syntax` → `corrupt` (`invalid_version_syntax`);
   - `unsupported_major` → verify row `evidence_schema_version` equals the
     document's `evidenceSchemaVersion` string → else `corrupt`
     (`schema_version_mismatch`); then return `unsupported-version` with the
     version. **Declared unperformable checks on an unsupported evidence
     schema:** full `parseEvidenceRecord` validation, trace/analysis/
     completeness derivation agreement, `traceId === interactionId`, and
     document-trace identity agreement cannot be performed and are not
     claimed; the result rests on the byte-intact text (step 3 digest), the
     structurally inspectable version field, and the consistent supported
     administrative columns.
5. **Full validation** (supported schema). `parseEvidenceRecord(doc)`.
   Failure → `corrupt` (`validation_failed`) — internally inconsistent
   stored data.
6. **Semantic agreement** (supported schema):
   - requested identity === parsed `trace.traceId` → else `corrupt`
     (`identity_mismatch`);
   - parsed `trace.traceId` === parsed `trace.interactionId` → else `corrupt`
     (`trace_identity_mismatch`);
   - row `evidence_schema_version` === document `evidenceSchemaVersion` →
     else `corrupt` (`schema_version_mismatch`).
7. **Return** `{ ok: true, record }` (or `{ ok: true, record, manifest }`).

`corrupt` outcomes carry only a structural `code`; corrupted serialized
content MUST NOT be included in issues, codes, or diagnostics.

### Structured results vs. throws

- Expected invalid input, unsupported versions, safety rejection, policy
  rejection, policy failure, clock failure, identity conflicts, idempotent
  repeats, and absent/corrupt/unsupported reads MUST produce structured
  results (the unions above); they MUST NOT rely on raw SQLite constraint
  exceptions and MUST NOT throw.
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
SQLite metadata before any read or write. **Failed opening never mutates
the database.**

1. **Inspect existing canonical-storage objects.** Query `sqlite_master`
   for `evidence_storage_meta`, `evidence_records`, and the canonical
   indices.
2. **State triage.**
   - **No canonical objects exist** (neither ledger, nor table, nor
     canonical index) → proceed to clean initialization (step 3). Clean
     initialization occurs ONLY in this state.
   - **Ledger exists with `evidence_storage_format_version` equal to the
     supported version (`1.0.0`)** → proceed to verification (step 4).
   - **Ledger exists with a version higher than supported** → refuse to
     open with a clear storage-format error; a newer layout must not be
     silently read or written by an older build.
   - **Ledger exists with a version lower than supported** → refuse to
     open: no migration path is registered for `1.0.0` (a lower layout is
     never implicitly accepted or upgraded without a complete registered
     migration path; no migrations exist in this slice).
   - **Canonical tables or indices exist WITHOUT a valid ledger** (or the
     ledger key is missing, duplicated, or non-semantic) → treat as
     partial/incompatible state and refuse to open without mutation; never
     silently treat it as version `1.0.0`.
3. **Clean initialization (atomic, only when no canonical objects exist).**
   Create `evidence_storage_meta` + `evidence_records` + indices, insert
   the ledger row (`evidence_storage_format_version = '1.0.0'`), verify the
   exact required contract, and commit — all in ONE transaction, with
   verification performed before commit. Any mismatch or failure rolls back
   every canonical object created by this attempt; the prior database
   (including any legacy tables) remains intact.
4. **Verify the exact required contract** (after a compatible `1.0.0`
   ledger). Verify with `PRAGMA table_info` and index metadata that
   `evidence_records` has exactly the required columns, types, `NOT NULL`
   constraints, and primary key (`evidence_identity`), and that the required
   indices exist. Any mismatch — missing/renamed column, wrong type, missing
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
- **Gate and policy extension versioning.** Conservative extensions to the
  safety gate or to the reference policy (for example, additional detector
  patterns or classification rules) MUST be versioned — a gate/storage-format
  version bump with documented compatibility consequences — MUST NOT change
  the meaning of existing stored records, and MUST be documented in the
  storage contract before deployment. No extensions exist in this slice.
- **Open behavior.** On open: no canonical objects → clean initialize at the
  current version; ledger at the current version → verify the contract;
  ledger version lower than current → refuse (no registered migration path);
  ledger version higher than supported → refuse to open; partial or
  malformed canonical state (tables/indices without a valid ledger) → refuse
  without mutation (see "Open-time schema verification").
- **Idempotent writes after restart** are guaranteed by the append-only
  rules; no replay log is introduced.

## Connection and journaling strategy

`EvidenceStorage` opens its own dedicated `better-sqlite3` connection to the
same database file as `TraceStorage`. It uses **WAL (Write-Ahead Logging)**
journaling mode (`PRAGMA journal_mode = WAL`) to allow readers to proceed
without blocking writers and to reduce cross-connection `SQLITE_BUSY`
contention. This choice is required for this slice because the spec's
guarantees (transactional race behavior, structured handling of contention,
restart durability, and coexistence with the legacy `TraceStorage`
connection) must be testable and deterministic.

**Required contention behavior:**

- Concurrent saves targeting **different** authoritative identities MUST
  both succeed (each in its own transaction).
- Concurrent saves targeting the **same** authoritative identity MUST
  produce exactly one successful append and one structured `already-present`
  or `conflict` result after re-reading the persisted row inside its
  transaction; neither writer receives a raw constraint exception.
- Reads and writes on the canonical tables MUST NOT block the legacy
  `TraceStorage` connection on `traces` / `trace_events`.

**Permitted environmental failures:** WAL mode requires the `-wal` and
`-shm` files to be writable in the same directory as the database file. If
WAL mode cannot be enabled, or if the database file cannot be opened with
a dedicated connection, the constructor throws a configuration error. If a
save receives `SQLITE_BUSY` after a bounded, documented retry policy, the
save MAY throw an environmental error (not a structured outcome), because
unrecoverable contention is an infrastructure condition, not a persistence-
logic condition.

The claim that atomicity and durability are preserved because
`better-sqlite3` is synchronous remains true only within a single,
dedicated connection with a working journal mode; this strategy specifies
that connection model explicitly.

## Privacy and diagnostic rules

- The storage layer MUST NOT log, print, or include in diagnostics the
  `serialized_record` text, any payload content, or any recovered secret.
  Diagnostics (outcome statuses, identities, structural reason codes,
  digests, policy names/versions, schema versions, timestamps) are
  administrative and MUST NOT embed payload values or credential material.
- Safety-gate and policy rejection codes are **storage-owned structural
  codes only** and MUST NEVER echo the detected values (no header values, no
  credential text, no excerpt of a rejected payload, no free-form policy
  text, no malformed decision value, no custom code).
- The `invalid` outcome surfaces only storage-safe issues (controlled codes
  and safe normalized paths). Parser messages, caller-controlled
  identifiers, unknown keys, and values are NEVER surfaced.
- `corrupt` read failures carry only a structural `code`; corrupted
  serialized content MUST NOT be included in issues, codes, or diagnostics.
- Credentials, authorization headers, API keys, and secrets MUST never be
  committed, logged, or placed in test fixtures (AGENTS.md security rules).
  Collection-time redaction (Spec 013 §4.1/§9.2) is the only sanctioned way
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
  policy rejection, policy exception, malformed policy decision, clock
  failure, identity conflict, idempotent repeat, absent record, and every
  corrupt-read integrity failure.
- **Throwing failures (environmental/configuration):** I/O and disk
  failures, disk-full, unrecoverable database-locked states after retry, an
  unsupported or incompatible storage-format version on open, a missing or
  invalid persistence policy in the constructor, and failure to enable WAL
  journaling or open a dedicated connection.
- **Atomicity:** every save is transactional; a failure at any step rolls
  back and leaves the prior state intact. Reads never mutate state.
  Initialization is atomic and rolls back every canonical object it created
  on any mismatch (see "Open-time schema verification").

## Implementation slices

Recommended additive sequence after acceptance (each slice independently
reviewable, testable, and mergeable; none touches legacy storage, ingress,
or production consumers):

1. **Contracts, safety gate, and schema.** Public result/manifest/policy/
   config types (`SaveOutcome`, `StorageManifest`, `PersistencePolicy`,
   `StorageSafeIssue`, `PolicyFailureReason`, `StorageSafetyCode`,
   `EvidenceStorageConfig`), the deterministic structural safety-gate
   detector (S1, S2, S3, S5, S6, including the required `isCredentialLikeText`
   contract), the `metadata-safe` reference-policy contract with its
   field-level conformance table and proof record, policy-name/version
   grammar and identity checks, runtime decision validation, the additive
   `evidence_storage_meta` + `evidence_records` schema, open-time schema
   verification, dedicated WAL connection setup, and contract tests
   (serialized-shape and `PRAGMA table_info` schema pinning, ledger
   namespacing, gate/policy detection matrix, storage-safe issue shaping,
   runtime decision validation, policy-name/version safety).
2. **Append-only save, conflict detection, retrieval.**
   `saveEvidenceRecord` with the normative pipeline (including retained-bytes
   short-circuit before serialization and clock ordering: existing rows
   classified without the clock), `getEvidenceRecord`, `getStoredEvidence`,
   `close`; tests for first write, idempotent repeats, exact-text conflicts
   (including simulated digest collision), rollback, clock validation,
   contention tests on same/different identities, and close/reopen
   durability.
3. **Policy admission, mutation safety, failure, privacy, coexistence.**
   `policy-rejected` codes, `policy-failed` (`exception` /
   `malformed-decision`), runtime decision validation; mutation and exception
   isolation; version triage and invalid-input handling (storage-safe
   issues); read-integrity ordering (digest/administrative checks before
   `unsupported-version`); privacy/diagnostic rules; initialization against
   an existing legacy database and coexistence with `TraceStorage` on one
   file; open-time refusal cases (partial state, malformed table,
   higher/lower format, atomic rollback).
4. **Projection parity from persisted evidence.** Retrieving a persisted
   record and projecting it through `evidenceToLegacyTrace` /
   `evidenceToAgentRun` (or the composed report) MUST produce views and
   `ProjectionReport`s identical to projecting the pre-persistence
   serializer snapshot (gate-safe, policy-admitted records with
   representation-sensitive values; nothing normalized away).
5. **Documentation and completion evidence.** Update `docs/architecture.md`,
   `docs/privacy.md`, `docs/glossary.md`, the roadmap, and the spec index;
   mark the spec Implemented only when all acceptance criteria pass.

## Testing and conformance requirements

Future implementation tests MUST cover, using Vitest and fixed fixtures (no
secrets, no raw payloads in fixtures — sentinel markers are used instead):

- save/retrieval round trip where the retrieved record equals the
  **pre-persistence serializer snapshot**
  (`parseEvidenceRecord(JSON.parse(serializeEvidenceRecord(validatedRecord))).record`),
  using only gate-safe, policy-admitted records;
- **serializer-boundary test (separate from persisted parity):** a record
  with retained bytes (`Uint8Array`) demonstrates the caller-input versus
  serializer-snapshot representation change (`Uint8Array` → canonical
  Base64) at the serialization boundary WITHOUT being persisted — the same
  record is rejected by Phase A of the mandatory gate (S6) and is never
  described as persisted-parity coverage;
- **retained-bytes evasion tests:** `Uint8Array` nested in normalized
  messages, tool/MCP/retrieval/error content, declared redacted/truncated
  content, unknown additive fields, and non-envelope paths — each rejected
  by S6 before serialization, proving the rule does not depend on
  `providerNativeFidelity`;
- **Phase-A short-circuit:** a record with both retained bytes and an S1/S2/
  S3/S5 finding returns `safety-rejected` with exactly `['S6']`; Phase B
  never runs and never adds additional codes;
- **no persisted byte-payload parity claim:** persisted-parity tests never
  contain retained bytes; byte-payload parity is deferred until a later
  accepted specification permits byte-bearing payloads to be stored;
- representation-sensitive ADMITTED cases through persistence: explicitly
  `undefined` optional properties when valid on the record (e.g.
  `participants`, `conditions`, `contextContributions`, `usage`,
  `finishedAt` / `durationMs` when absent for non-terminal spans) — JSON
  round trip turns them into absent properties; differences between caller
  and snapshot values are reported, never normalized into equality;
- exact serialized-text preservation (stored document equals
  `serializeEvidenceRecord` output at write; no re-encoding);
- unknown additive field preservation across save → read → re-serialize
  (equivalent JSON values, per the `@signalglass/evidence` contract);
- validation before write (invalid → `invalid`, nothing written) and
  validation after read (corrupt stored data → `corrupt`, never a throw);
- **storage-safe validation results:** `invalid` carries only controlled
  issue codes and safe normalized paths; sentinel tests prove parser
  messages, caller-controlled identifiers, unknown keys, and values never
  surface in issue messages or paths;
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
- **policy-name safety:** names matching the grammar, credential-like names
  rejected at construction, reserved reference policy name rejected for
  plain-object custom policies, validated names in outcomes/manifests only;
- **policy-version safety:** valid `MAJOR.MINOR.PATCH` versions accepted;
  oversized versions, leading zeros, non-numeric components, prerelease/
  build suffixes, and malformed versions rejected at construction;
- **read-time policy-metadata validation:** stored name/version validated
  using the same leak-safe rules; tampered policy metadata returns
  `corrupt: policy_metadata_malformed` without exposing the bad metadata;
- **clock ordering:** a byte-identical repeat and a conflicting write both
  classify as `already-present` / `conflict` WITHOUT calling the injected
  clock (a throwing clock injected for the repeat/conflict save still
  produces the correct classification); a throwing or malformed `now()` on
  a genuinely new insertion returns `clock-failed` and writes nothing;
- **idempotency qualification:** validation, the mandatory gate, and the
  selected policy run on every save; a record the gate or policy rejects
  returns `safety-rejected` / `policy-rejected` / `policy-failed` even when
  the identical text is already stored;
- policy rejection returns `policy-rejected` with the storage-owned code
  only — sentinel tests prove no free-form policy text, payload values, or
  exception text ever surface (policy decisions, exceptions, invalid input,
  issue messages, issue paths, identifiers, keys, and values covered);
- **runtime decision validation:** sentinel tests — `null`, a primitive, an
  array, a function, a promise/thenable, an object with a non-null/
non-Object.prototype prototype, `{ accept: 'yes' }`, `{ accept: true, code: 'x' }`,
  `{ accept: false }` (missing code), an extra property, a symbol own key,
  an accessor descriptor, an unknown/data-derived code (e.g. a secret string
  as `code`), a Proxy with a throwing getter/trap, and a non-enumerable key
  — each map to `policy-failed` (`malformed-decision`), and no malformed
  value or partially read value appears in the outcome, diagnostics, or
  database;
- **policy decision determinism:** the same malformed input always produces
  the identical `policy-failed` outcome, never a throw or a leaked value;
- safety-gate rejection (S1, S2, S3, S5, S6) writes nothing, returns closed
  `StorageSafetyCode[]`, deduplicated and canonically ordered, and echoes no
  detected values (sentinel-based); **positive and negative matrix cases are
  pinned both ways** so implementations cannot silently widen or narrow
  admission — e.g. `Authorization` header key/value rejected (S2),
  `authorization: Bearer x` value shape rejected (S1 detector),
  `sk-`-prefixed value rejected, `password` key rejected even with an
  innocuous value (S3), `storageKey: "s3://bucket/key"` rejected (S3),
  a benign plain sentence admitted, uppercase `API_KEY` and mixed-case
  `SeCrEt` keys rejected (case normalization), overlap controls proving
  `{ authorization: "Bearer x" }` emits only S2 and `{ password: "Bearer x" }`
  emits only S1;
- S5 normative predicate tested with captured `byte_faithful` envelopes and
  captured `structurally_faithful` envelopes carrying `providerNative`
  (rejected), versus declared (`redacted` / `truncated`) envelopes (not S5-
  rejected; S1–S3 still scan values);
- safety-gate non-bypassability: a permissive custom policy cannot admit a
  record the gate rejects;
- reference policy `metadata-safe`: the **field and category conformance
  table is tested cell by cell** for every event kind in both representations
  (raw observation payload paths and projected `EventRecord` fields), with
  the exact TypeScript shapes (`ResponseEnvelope.usage` as `unknown`,
  `chunkIndex` inside `responseEnvelope`, `contextContributions` in raw
  `model_request`, `ContextProvider.kind` as arbitrary string bounded label,
  `Condition.value` required and admitted only as `null`, control-event
  `payload` required and typed `unknown` with `null` as the fixture/parser
  convention):
  permitted metadata admitted; captured content of every kind rejected
  (`captured-content`); declared content (`redacted` / `truncated`)
  admitted; unknown additive fields at undeclared paths rejected
  (`unknown-additive-field`) and under declared content admitted;
  unbounded span / name labels rejected (`unbounded-label`); `conditions[].
  value` rejected unless exactly `null`; `model_usage.usage` tokens treated
  as `UsageValue | undefined` per TypeScript (not plain numbers); recursive,
  case-normalized traversal (sentinel tests including uppercase sensitive
  keys); never rewrites evidence;
- **proof record:** the fixture-derived record with captured lifecycle
  observations and captured span-derivation metadata (declared
  `model_request` / `model_response`) is admitted; its captured-content
  variant (captured `messages` / `providerNative`) is rejected with
  `captured-content`; both variants are schema-valid per
  `normalizeEvidenceRecord`;
- policy mutation isolation: a mutating policy cannot alter the caller's
  record, the stored document, identity, completeness, evidence status, or
  the digest basis; a throwing policy returns `policy-failed`
  (`reason: 'exception'`) and writes nothing; tests prove isolation and
  non-write directly and do not claim storage infers why policy code threw;
- invalid runtime input (non-object, null) returns `invalid` without
  throwing;
- invalid version syntax returns `invalid`; syntactically valid unsupported
  major returns `unsupported-version` (save and read);
- malformed JSON on read returns `corrupt` without throwing;
- **read integrity ordering:** an unsupported-major document with a stale
  digest, a mismatched schema-version column, malformed administrative
  metadata (including invalid policy name/version), or a mismatched row
  identity returns `corrupt` (never `unsupported-version`);
  `unsupported-version` is returned only for byte-intact, structurally
  inspectable JSON with consistent supported storage metadata; read-
  integrity mismatches each return `corrupt` with their structural code
  (identity, traceId/interactionId, schema-version column, digest,
  format-version column, policy metadata, stored_at);
- **contention:** concurrent saves on different identities both succeed;
  concurrent saves on the same identity produce one successful append and
  one structured `already-present`/`conflict` after transaction re-read;
- **WAL connection:** the storage constructor enables WAL journaling and
  fails if WAL cannot be enabled; the legacy `TraceStorage` connection
  remains usable;
- no corrupted or rejected content in issues/diagnostics (sentinel-based);
- absence of silent sanitization/normalization (no `sanitizeTraceForStorage`
  path; evidence statuses and completeness unchanged);
- no canonical hard-delete behavior (no delete API; legacy `deleteTrace`
  does not touch `evidence_records`);
- deterministic list ordering if listing is included (MAY; ordered by
  `stored_at`, then identity);
- persisted vs. in-memory projection parity against the serializer snapshot
  (identical views and ProjectionReports), with representation-sensitive
  admitted values;
- serialized-shape and SQLite-schema contract tests (`PRAGMA table_info`,
  ledger contents), because this spec changes public persistence contracts;
- open-time verification: clean initialization (only when no canonical
  objects exist); repeated initialization; existing legacy-only database;
  compatible canonical database; canonical tables/indices without a valid
  ledger (partial state) refused without mutation; malformed or incompatible
  canonical table refused; unsupported higher and lower storage formats
  refused; **failed initialization rolls back every canonical object created
  by that attempt — tests compare the complete canonical schema and ledger
  before and after a failed open**;
- identity contract: authoritative identity is `traceId` (=== `interactionId`),
  never rowid/digest/observation id;
- storage digest is administrative, unindexed, and distinct from
  `contentHash` / `nativeContentHash` (contract + documentation test).

## Acceptance criteria

- [ ] A valid canonical record can be saved and retrieved; the retrieved
  record equals the **pre-persistence serializer snapshot**
  (`parseEvidenceRecord(JSON.parse(serializeEvidenceRecord(validatedRecord))).record`),
  with no unconditional claim of equality with the caller-owned input.
- [ ] The exact deterministic serialized-record text produced by
  `serializeEvidenceRecord` is preserved byte-for-byte in storage and
  returned unchanged as the stored document basis.
- [ ] Representation changes at the serialization boundary are declared and
  tested: retained `Uint8Array` bytes become canonical RFC 4648 §4 Base64;
  explicitly `undefined` optional properties are absent after round trip.
- [ ] The retained-bytes representation change is demonstrated ONLY at the
  serializer boundary: the same record is rejected by Phase A of the
  mandatory gate (S6) and is never described as persisted-parity coverage;
  no persisted byte-payload parity is claimed until a later accepted
  specification permits byte-bearing payloads to be stored.
- [ ] Phase A short-circuits on the first `Uint8Array`: a record with both
  retained bytes and an S1/S2/S3/S5 finding returns `safety-rejected` with
  exactly `['S6']` and Phase B never runs.
- [ ] Persisted-parity tests use only gate-safe, policy-admitted records;
  representation-sensitive ADMITTED cases (explicitly `undefined` optional
  properties when valid on the record) are exercised through persistence;
  caller and snapshot values are never normalized into equality before their
  actual difference is reported.
- [ ] Unknown additive fields survive storage and retrieval and re-serialize
  at equivalent JSON values (never claimed as lexical byte preservation of
  the parsed record).
- [ ] Every record is validated with `parseEvidenceRecord` before any write;
  an invalid record returns `invalid` and writes nothing.
- [ ] The `invalid` outcome carries only storage-safe issues (controlled
  issue codes and safe normalized paths); parser messages, caller-controlled
  identifiers, unknown keys, and values never surface (sentinel tests cover
  issue messages, issue paths, identifiers, keys, and values).
- [ ] Every read re-validates the stored document; malformed or internally
  inconsistent stored data returns a structured `corrupt` failure, never a
  throw or a silent misread.
- [ ] A byte-identical repeat save is idempotent: it returns
  `already-present` and creates no second authoritative row and no update.
- [ ] Idempotency is qualified: validation, the mandatory safety gate, and
  the currently selected persistence policy run on every save; a record
  rejected by validation, the gate, or the policy (or failing policy
  execution) returns its structured rejection and never reaches existing-row
  classification.
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
  policy identity and a **storage-owned code only** (no free-form policy
  text), writes nothing, and does not modify the record.
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
- [ ] The mandatory storage-safety gate uses a closed deterministic
  `StorageSafetyCode` union (`'S1'|'S2'|'S3'|'S5'|'S6'`), deduplicates
  codes, and emits them in canonical order S1→S3, S5, S6; every rejection
  produces at least one code; the same input produces the identical complete
  outcome.
- [ ] Every retained `StorageSafetyCode` has a documented, reachable
  positive witness and overlap controls proving it is not subsumed by
  another code: S1 = credential-like value on a non-sensitive key; S2 =
  sensitive-header key regardless of value; S3 = sensitive-key name
  (including `storagekey`/`storage_key`) with a non-credential-like value;
  S5 = captured full raw/provider-native envelope; S6 = any `Uint8Array`
  (Phase A).
- [ ] `SaveOutcome['safety-rejected']` carries `readonly StorageSafetyCode[]`,
  not `string[]`.
- [ ] S1 is triggered only by credential-like string values on keys that are
  not sensitive-header keys and do not match sensitive-key patterns; S2
  takes precedence over S1 and S3 for sensitive-header keys; S3 takes
  precedence over S1 for sensitive-key names with non-credential-like
  values; overlap controls prove these precedence rules.
- [ ] The safety gate traverses every object, array, key, string value, and
  serialized Base64 value recursively; Base64-encoded credentials are not
  decoded by the detector, and this is safe because Phase A short-circuits
  on every retained byte before it can become Base64.
- [ ] S5's normative predicate is written over the actual evidence shapes
  (no generic event `payload`): it rejects captured `byte_faithful`
  envelopes and captured `structurally_faithful` envelopes carrying
  `providerNative`; declared (`redacted` / `truncated`) envelopes are not
  S5-rejected but remain subject to S1–S3.
- [ ] S6 rejects every `Uint8Array` in the validated pre-serialization
  record recursively, regardless of path, before serialization; this
  includes bytes in normalized messages, tool/MCP/retrieval/error content,
  declared redacted/truncated content, unknown additive fields, and non-
  envelope paths; S6 does not depend on `providerNativeFidelity`.
- [ ] The storage-safety gate is non-bypassable: no custom persistence policy
  can cause storage of material the gate rejects.
- [ ] No unversioned gate or policy extensions exist in this slice; any
  future conservative extension MUST be versioned with documented
  compatibility consequences that do not change the meaning of existing
  stored records.
- [ ] The reference policy `signalglass.persistence.metadata-safe` (v1.0.0)
  uses the actual evidence vocabularies only (`captured`, `redacted`,
  `truncated`, `missing`, `unknown`, `not_applicable`); it never uses
  `unavailable` or `inferred` as evidence statuses and never substitutes
  projection classifications for evidence statuses.
- [ ] The reference policy classifies fields, not whole events: lifecycle /
  control observations with `evidenceStatus: 'captured'` are admitted;
  captured structural metadata (including `span_start` span-derivation
  fields) is admitted; captured administrative facts (identities,
  timestamps, vocabulary values, lifecycle targeting, retry references,
  numeric usage evidence under the allowlist, bounded structural labels) are
  admitted.
- [ ] The reference policy rejects captured user/provider content fields —
  messages, provider-native bodies, tool arguments/results, MCP/retrieval
  content, error text, and equivalent unknown payload content — with
  `captured-content`; content is admitted only under an owning
  retained-representation declaration (`redacted` / `truncated`); under
  `missing` / `unknown` / `not_applicable` content must be absent.
- [ ] The reference policy admits the fixture-derived proof record (captured
  lifecycle observations, captured `span_start` span-derivation metadata,
  declared `model_request` / `model_response`) and rejects its
  schema-valid captured-content variant with `captured-content` — proven
  against the public `normalizeEvidenceRecord` contract.
- [ ] The reference policy's field and category conformance table is tested
  cell by cell for every event kind in BOTH representations (raw observation
  payload paths and projected `EventRecord` fields), with the exact
  TypeScript-shape distinctions: `ResponseEnvelope.usage` is `unknown` and
  admitted only via the numeric allowlist; `chunkIndex` is inside
  `responseEnvelope`; `contextContributions` is classified in raw
  `model_request` payloads; `ContextProvider.kind` is an arbitrary string
  bounded as a label; `Condition.value` is required by TypeScript and
  admitted only as `null`; `EvidenceObservation.payload` is required and
  typed `unknown` with `null` as the fixture/parser convention; `model_usage.
  usage` tokens are `UsageValue | undefined` per TypeScript (not
  `number | UsageValue`).
- [ ] Bounded structural labels (span `name`, `participants[]`,
  `captureProfile.name`, `conditions[].label`, envelope `model` / `provider`,
  `finishReason`, tool `name`, MCP `server` / `tool`,
  `contextProvider.name`, `contextProvider.kind`, `error.type`,
  `cancellation.requestedBy`) are admitted only as non-empty,
  control-character-free strings of at most 128 code points; longer or
  free-text values are rejected (`unbounded-label`).
- [ ] Schema-owned free-text metadata (declaration reasons/notes, validation
  messages, boundary statements, usage reasons) is admitted with the honest
  scope statement: `metadata-safe` is a schema-category policy, not proof
  that arbitrary metadata strings contain no sensitive content; the
  mandatory credential detector scans every string recursively.
- [ ] `conditions[].value` is required by TypeScript; for `metadata-safe` it
  is admitted only when exactly `null`; any other value is rejected
  (`captured-content`).
- [ ] `model_usage.usage.inputTokens` / `outputTokens` / `totalTokens` are
  `UsageValue | undefined` per TypeScript; the validator currently tolerates
  broader values, but `metadata-safe` admits only `UsageValue` shape with
  finite non-negative numeric `value` (if present) and closed
  `evidenceStatus` (if present), or absent.
- [ ] Unknown additive fields at undeclared paths must be absent or exactly
  `null`; present unknown fields (including empty strings, `0`, `false`,
  `[]`, or `{}`) are rejected (`unknown-additive-field`).
- [ ] Policy decisions are runtime-validated with guarded exact own-key
  reflection: plain object (`Object.prototype` or `null` prototype, not
  array), guarded thenable check, guarded `Reflect.ownKeys` enumeration
  (symbol own keys malformed), guarded property-descriptor inspection
  (accessor descriptors rejected without invocation), guarded value reads
  via `Reflect.get`, strict boolean `accept`, closed string `code`; any
  throw, symbol key, accessor, non-enumerable key, extra/missing key,
  non-boolean `accept`, or unknown `code` maps to `policy-failed`
  (`malformed-decision`) and is never surfaced; a custom policy returning a
  secret as its `code` cannot leak it (sentinel test).
- [ ] The closed `PolicyRejectionCode` vocabulary is available to any policy;
  no policy can return free-form text or data-derived codes; malformed
  decisions never leak partially read values.
- [ ] The storage-shipped reference policy identity is unspoofable: the
  constructor recognizes it by object identity/internal brand; a plain
  object bearing the reserved name `signalglass.persistence.metadata-safe`
  is rejected at construction; custom policies are supported and may use any
  closed rejection code.
- [ ] Policy names satisfy a bounded grammar (`^[a-z][a-z0-9._-]{0,127}$`,
  max 128 code points) and are not credential-like.
- [ ] Policy versions satisfy a bounded semantic-version grammar with no
  prerelease or build suffixes (`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.
  (0|[1-9][0-9]*)$`, max 64 code points); oversized, malformed, and
  suffixed versions are rejected at construction.
- [ ] On read, stored policy name and version are validated with the same
  leak-safe construction rules; invalid stored policy metadata returns
  `corrupt: policy_metadata_malformed` and is never exposed or logged.
- [ ] A persistence policy that attempts to mutate the detached snapshot or
  that throws for any reason returns `policy-failed`
  (`reason: 'exception'`) and writes nothing; it cannot alter the caller's
  record, the stored document, identity, completeness, evidence status, or
  the digest basis; tests prove isolation and non-write without claiming
  storage infers why policy code threw.
- [ ] Policy decisions, policy exceptions, and validation results expose no
  payload values: sentinel tests cover policy decisions, exceptions, invalid
  input, issue messages, issue paths, identifiers, keys, and values.
- [ ] The clock is consulted ONLY for a genuinely new insertion: a
  byte-identical repeat and a conflicting write classify as
  `already-present` / `conflict` without calling the injected clock (a
  throwing clock injected for the repeat/conflict save still produces the
  correct classification); a throwing or malformed `now()` on a new
  insertion returns `clock-failed`, rolls back, and writes nothing; a
  concurrent unique-key race is resolved by exact-text re-read, never a raw
  constraint error.
- [ ] Malformed JSON on read returns `corrupt` without throwing.
- [ ] Read integrity is verified before any `unsupported-version` result: an
  unsupported-major document with a stale digest, a mismatched schema-version
  column, malformed administrative metadata (including invalid stored policy
  name/version), or a mismatched row identity returns `corrupt`;
  `unsupported-version` is returned only for byte-intact, structurally
  inspectable JSON with consistent supported storage metadata.
- [ ] Reads return `corrupt` (with the structural code) for each integrity
  mismatch: requested identity vs. parsed trace identity, parsed
  traceId vs. interactionId, row evidence identity, row evidence-schema
  version vs. document version, stored vs. recomputed digest, row
  storage-format version vs. supported format, malformed policy metadata,
  and malformed stored-at timestamp.
- [ ] For an unsupported evidence schema, the spec's declared unperformable
  semantic checks (full validation, derivation agreement,
  traceId === interactionId, document-trace identity agreement) are never
  claimed and never performed.
- [ ] Diagnostics and logs contain no serialized-record text, rejected
  values, corrupted content, payload content, credentials, or secret values
  (sentinel-based negative tests).
- [ ] Retrieved in-memory and persisted canonical records produce identical
  compatibility projections and `ProjectionReport`s
  (`evidenceToLegacyTrace` / `evidenceToAgentRun`), where "in-memory" is the
  pre-persistence serializer snapshot and representation-sensitive admitted
  values are included (retained bytes excluded).
- [ ] All pre-existing legacy storage, projection, and report tests remain
  unchanged and passing.
- [ ] Serialized-shape and SQLite-schema contract tests exist and pin the
  public persistence contracts changed by this spec, including the
  namespaced `evidence_storage_meta` ledger
  (`evidence_storage_format_version`).
- [ ] Open-time verification succeeds for: clean initialization (only when
  no canonical-storage objects exist), repeated initialization, an existing
  legacy-only database, and a compatible canonical database.
- [ ] Open-time verification refuses with a clear storage-format error for:
  canonical tables/indices without a valid ledger (partial state — refused
  without mutation), a malformed/incompatible pre-existing canonical table
  (verified via `PRAGMA table_info` and index metadata), an unsupported
  higher storage format, and an unsupported lower storage format (no
  registered migration path for 1.0.0) — never silently treating any
  incompatible state as version 1.0.0.
- [ ] Failed initialization rolls back every canonical object created by
  that attempt: tests compare the complete canonical schema and ledger
  before and after a failed open.
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
- [ ] `EvidenceStorage` opens a dedicated `better-sqlite3` connection with
  WAL journaling enabled; WAL failure is a configuration error; contention
  tests verify concurrent same-identity and different-identity save
  behavior; unrecoverable `SQLITE_BUSY` after bounded retries is a
  permitted environmental failure.
- [ ] `@signalglass/storage` consumes `@signalglass/evidence` directly
  (workspace dependency) and `@signalglass/core`'s public
  `isCredentialLikeText` for the gate; `@signalglass/evidence` remains
  zero-runtime-dependency and unchanged; no new external runtime dependencies
  are added.

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
  `@signalglass/evidence` (plus `@signalglass/core`'s
  `isCredentialLikeText` for the gate).
- `docs/privacy.md` — the mandatory storage-safety gate (S1, S2, S3, S5,
  S6, retained-bytes short-circuit, Base64 non-decoding limit), the
  conservative `metadata-safe` reference policy and its honest schema-
  category scope statement, storage-safe (leak-free) policy and validation
  results, administrative metadata separation, and the absence of canonical
  hard-delete in this slice.
- `docs/capture-profiles.md` — persistence-policy recording location (already
  aligned; add the `EvidenceStorage` manifest reference).
- `docs/model-versioning.md` — storage-format version vs. evidence-schema
  version distinction, gate/policy extension versioning, and the namespaced
  canonical-storage ledger (already aligned in principle).
- `docs/glossary.md` — `EvidenceStorage`, storage manifest, storage digest,
  authoritative identity, storage safety gate, serializer snapshot,
  declared content, `StorageSafetyCode` entries.
- `docs/roadmap.md` and `specs/000-index.md` — status and slice registration.

This Draft PR updates only: `specs/015-append-only-evidence-store.md` (this
spec), `specs/000-index.md` (register Spec 015 as Draft), and
`docs/roadmap.md` (near-term entries). Completed Spec 014 history is not
rewritten.

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
