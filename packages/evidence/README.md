# `@signalglass/evidence`

> **Foundation slice of [Spec 014 — Evidence primitives](../specs/014-evidence-primitives.md).**
> Spec 014 is **Accepted — ready for implementation** (full acceptance pending
> the compatibility-projection and migration slices). This package ships the
> first additive slice: canonical evidence primitives.

Dependency-free, provider-neutral canonical evidence primitives: the
authoritative evidence record types, runtime validators, JSON-safe
serialization, and deterministic helpers for the accepted Spec 013 evidence
contract.

## Highlights

- **Zero runtime dependencies.** No `node:crypto`, no WebCrypto, no providers,
  storage, or analysis imports. Works in Node and browsers. Only dev
  dependencies (`typescript`, `vitest`) are used to build and test.
- **Authoritative record.** `EvidenceRecord` holds `rawObservations`
  (authoritative captured evidence) plus `trace`, `analysis`, and
  `completeness` as **deterministic derivations** — never independently
  authoritative when serialized.
- **Non-throwing runtime validation.** `parseEvidenceRecord(input):
  EvidenceRecordParseResult` returns a single `{ ok: true }` / `{ ok: false,
  issues }` union with structured `ValidationIssue` entries. It never throws
  for malformed input. `serializeEvidenceRecord` validates first, then throws
  only on an already-invalid record (a programming-error guard).
- **Deterministic ordering and collisions.** `seq` is the only ordering key.
  Exact replays collapse (no representative, no gap), same-ID/same-seq
  content conflicts reject, same-ID/different-seq retains the lowest seq
  (each unoccupied discarded position is a gap), different-ID/same-seq
  collisions reject. Retained events are never renumbered; ambiguous
  collisions are rejected, never tie-broken.
- **Retained bytes.** `byte_faithful` envelopes keep `Uint8Array` payloads in
  memory and serialize them as RFC 4648 §4 canonical Base64. `contentHash`
  digests are SHA-256 over decoded bytes.
- **Version-aware.** Compatible additive minor/patch revisions within the
  supported MAJOR (`1`) are accepted; unknown or breaking MAJOR versions are
  refused with structured errors; unknown additive fields are preserved at
  equivalent JSON values on round trips.

## Package layout

```
packages/evidence/
  src/
    index.ts             public export surface (Spec 014 §1.2)
    vocabulary.ts        closed vocabularies (statuses, kinds, roles, …)
    version.ts           supported-schema-version policy
    types-*.ts           canonical record, trace, event, envelope, analysis
    guards.ts            public per-record boolean validators
    validate.ts          parseEvidenceRecord / normalizeEvidenceRecord + semantic equality
    validate-fields.ts   structured per-field validators
    serialize.ts         serializeEvidenceRecord / serializeEvidenceExport
    project.ts           projectCanonicalEvent
    derive-trace.ts      deriveTrace (canonical trace/status derivation)
    completeness.ts      deriveCompleteness
    normalize.ts         collapseObservations (collision/duplicate/gap rule)
    internal/            dependency-free helpers, never re-exported
      sha256.ts          pure-TypeScript SHA-256 (+ UTF-8 encode)
      jcs.ts             RFC 8785 (JCS) canonical JSON
      base64.ts          RFC 4648 §4 canonical Base64 + strict decode
      formats.ts         RFC 6838 media-type + content-hash checks
      time.ts            ISO 8601 UTC millisecond timestamps
      id.ts              caller-supplied identifier checks
      guards.ts          internal structural guards
  *.test.ts              colocated Vitest suites
```

## Usage

```ts
import {
  parseEvidenceRecord, serializeEvidenceRecord,
  normalizeEvidenceRecord, deriveCompleteness,
  canonicalJson, sha256Hex, isContentHash, isContentType,
} from '@signalglass/evidence';

// Construct an authoritative record from raw observations, then parse it
// (verifying serialized trace/analysis/completeness agree with derivation).
const record = normalizeEvidenceRecord(
  rawObservations, captureBoundary, '1.0.0',
).record;

const json = serializeEvidenceRecord(record);          // deterministic bytes
const result = parseEvidenceRecord(JSON.parse(json));  // never throws
```

## Conventions

- NodeNext module resolution: imports use `.js` extensions.
- Colocated `*.test.ts` files, compiled by `tsc -p .`.
- Implementation/internal helpers live under `src/internal/` and are never
  re-exported.

See [Spec 014](https://github.com/ecarlisle/signalglass/blob/main/specs/014-evidence-primitives.md)
for the normative contract.