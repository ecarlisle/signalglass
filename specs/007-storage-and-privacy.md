# Spec 007: Storage and privacy

## Status

Draft

## Purpose

Define how live ingress data is persisted and what is captured by default.

## Scope

- SQLite storage schema.
- Capture policies.
- Redaction rules.
- Retention.
- API key handling.

## Non-goals

- Remote or cloud storage.
- Encryption at rest.
- Audit logging.

## Required files or modules

- `packages/storage/` (future package).
- `packages/core/src/traces.ts` for `CapturePolicy` and `RedactionPolicy`.

## Required types or contracts

- `StorageMode`, `CapturePolicy`, `RedactionPolicy`, `PayloadReference` from `core`.
- Storage API: `saveTrace(trace)`, `getTrace(id)`, `listTraces()`, `deleteTrace(id)`.

## Required behavior

- Standard mode stores:
  - trace metadata,
  - timeline event metadata,
  - token metrics,
  - routing decisions,
  - transformation summaries,
  - short redacted excerpts.
- Standard mode does **not** store:
  - full raw payloads,
  - secrets,
  - API keys,
  - full tool results.
- Debug mode may opt into full raw payloads and full tool results.
- API keys are referenced by environment variable names and never persisted.
- Authorization headers and common secret patterns are stripped before storage.
- Retention is configurable; default is 30 days.

## Acceptance criteria

- [ ] Standard policy rejects storage of full raw payloads.
- [ ] Debug policy can allow full raw payloads.
- [ ] Querying a trace never returns an API key or authorization header.
- [ ] Expired traces are deleted according to retention policy.

## Tests

- Policy validation tests.
- Storage round-trip tests for metadata and redacted excerpts.
- Tests confirming secrets are stripped.

## References

- `docs/privacy.md`
- `docs/provider-config.md`
- `specs/004-trace-model.md`
