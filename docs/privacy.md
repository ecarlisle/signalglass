# SignalGlass privacy and capture policy

SignalGlass is an observability layer, not a data lake. It captures only what is needed to help developers understand agent/model communication, and it defaults to the minimum.

## Default capture policy

By default, Signalglass stores:

- Trace metadata (id, timestamps, provider, model, agent, task, status).
- Timeline event metadata (event kind, content phase, source type, timestamps).
- Token metrics (input/output tokens, estimated or reported).
- Routing decisions (provider id, model, adapter kind).
- Transformation summaries (what changed, not full before/after content).
- Short redacted excerpts of content (for display in Trace and Story views).

## What is NOT stored by default

- Full raw request payloads.
- Full raw response payloads.
- Secrets, API keys, or authorization headers.
- Full tool results.
- Any content that has not been explicitly allowed by the capture policy.

## Opt-in capture

Users can opt into storing more data per provider or per trace:

```json
{
  "capturePolicy": {
    "mode": "standard",
    "storeShortRedactedExcerpts": true,
    "storeFullRawPayloads": false,
    "storeFullToolResults": false,
    "redaction": {
      "maxExcerptLength": 240,
      "secretPatterns": [],
      "stripHeaders": ["authorization", "x-api-key", "cookie", "proxy-authorization"]
    },
    "retentionDays": 30
  }
}
```

- `storeShortRedactedExcerpts` — when true, short privacy-filtered excerpts may be stored.
- `storeFullRawPayloads` — when true in `debug` mode, full payload references may be stored. Use with caution.
- `storeFullToolResults` — when true in `debug` mode, full tool results may be stored.
- `redaction.maxExcerptLength` — maximum length of stored redacted excerpts.
- `redaction.secretPatterns` — additional regular expression strings to redact from excerpts and report-bound strings.
- `redaction.stripHeaders` — header names removed before storage.
- `retentionDays` — expiry window used by `deleteExpiredTraces()`.

Even when `storeFullRawPayloads` is true, API keys, authorization headers, cookies, proxy authorization headers, and credential-like `storageKey` values are stripped or redacted before storage/reporting.

## API key handling

Provider config references API keys by environment variable name:

```json
"apiKeyEnv": "OPENAI_API_KEY"
```

Signalglass reads the key at runtime and uses it only to forward requests upstream. Keys are never:

- written to config files,
- stored in the database,
- included in traces or reports,
- logged to stdout or files.

## Redaction

Before any content is stored, SignalGlass applies redaction rules:

- Strip `Authorization`, `X-Api-Key`, `Cookie`, and `Proxy-Authorization` headers.
- Strip strings matching common secret patterns.
- Strip or redact API keys, bearer tokens, password/secret/token values, and `.env`-style assignments.
- Truncate excerpts to the configured maximum length.
- Mark content as redacted when only an excerpt is stored.
- Re-apply excerpt redaction during storage even when an incoming `payloadRef` already claims to be redacted.

## Retention

Retention is configurable via the optional `capturePolicy.retentionDays` field. When `retentionDays` is not set by the caller, traces have no automatic expiry and are kept indefinitely. `deleteExpiredTraces()` removes traces whose expiry has passed, and SQLite cascade deletion removes their events. Deployments that need automatic cleanup should set `retentionDays` and schedule periodic calls to `deleteExpiredTraces()`. The default capture policy does not set `retentionDays`.

## Report output

Trace reports and summary views follow the same privacy rules as storage:

- Full raw payloads are never included in reports.
- API keys, bearer tokens, secrets, cookies, proxy authorization headers, `.env` values, and authorization headers are redacted from report-bound strings.
- `storageKey` values are not exposed in reports.
- Redacted excerpts appear only when the capture policy allowed them and the stored trace contains them.
- Reports include a privacy disclaimer stating what is and is not included.

See `docs/report-contract.md` for the report privacy and redaction section.

## Compliance notes

- Live ingress should be run in environments where the operator has permission to intercept agent/model traffic.
- Enterprises may require additional controls: encryption at rest, access controls, audit logging, and shorter retention.
- Signalglass does not claim compliance with any specific regulation by default. Operators are responsible for configuring capture policies appropriately.

## Related documents

- `docs/ingress.md`
- `docs/provider-config.md`
- `docs/trace-model.md`
- `docs/report-contract.md`
