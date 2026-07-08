# Spec 007: Storage and privacy

## Status

Implemented

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

## Implementation

### Package: `@signalglass/storage`

A dedicated workspace package providing SQLite-backed trace persistence with privacy-safe default behavior.

### Storage API

```ts
saveTrace(trace: Trace): void
getTrace(id: string): Trace | null
listTraces(limit?: number, offset?: number): Trace[]
deleteTrace(id: string): boolean
deleteExpiredTraces(): number
close(): void
```

### Redaction

Before storage, each trace is sanitized by `sanitizeTraceForStorage()`:

- `Authorization`, `X-Api-Key`, `Cookie`, and `Proxy-Authorization` headers are stripped.
- Keys matching sensitive patterns (`api_key`, `auth`, `token`, `secret`, `password`, `credential`) are removed.
- API key values (e.g. `sk-...` prefix) are detected and removed.
- Nested objects and arrays are recursively sanitized.

### Standard mode behavior

When `capturePolicy.mode` is `"standard"` (the default):

- Trace metadata, timeline event metadata, token metrics, routing decisions, and transformation summaries are stored.
- Only **already-redacted** short excerpts (`payloadRef.redacted === true`) may be persisted.
- Full raw payloads, API keys, secrets, authorization headers, and full tool results are **never** stored.
- `storageKey` references to full payloads are stripped.

### Debug mode behavior

When `capturePolicy.mode` is `"debug"` and `storeFullRawPayloads` is explicitly `true`:

- Full payload references (including `storageKey`) may be preserved.
- API keys and secrets are **still** stripped regardless of mode.

### Retention

- Retention is configurable via `capturePolicy.retentionDays` (default: 30 days).
- `deleteExpiredTraces()` removes traces whose `expires_at` is in the past.
- Expired trace events are cascade-deleted by SQLite foreign key enforcement.

### CLI integration (opt-in)

Storage is **opt-in** — the `--storage <path>` flag enables SQLite persistence. If omitted, ingress runs without persistence. Parent directories for the provided path are created automatically.

### Ingress handoff

The ingress server accepts an optional `onTrace` callback. When storage is configured, the CLI wires this callback to call `storage.saveTrace(trace)` for each assembled trace.

## Acceptance criteria

- [x] Standard policy rejects storage of full raw payloads.
- [x] Debug policy can allow full raw payloads.
- [x] Querying a trace never returns an API key or authorization header.
- [x] Expired traces are deleted according to retention policy.

## Tests

- Policy validation tests (standard mode privacy, debug mode behavior).
- Storage round-trip tests for metadata and redacted excerpts.
- Tests confirming secrets, API keys, and auth headers are stripped.
- Recursive array sanitization tests.
- capturePolicy JSON persistence and round-trip tests.
- Foreign key cascade deletion tests.
- Deterministic retention cleanup tests.
- Storage path parent directory creation tests.

## References

- `docs/privacy.md`
- `docs/provider-config.md`
- `specs/004-trace-model.md`
