# Signalglass privacy and capture policy

Signalglass is an observability layer, not a data lake. It captures only what is needed to help developers understand agent/model communication, and it defaults to the minimum.

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
    "storeFullPayloads": false,
    "storeToolResults": false,
    "maxExcerptLength": 240,
    "retentionDays": 30
  }
}
```

- `storeFullPayloads` — when true, full request/response payloads may be stored. Use with caution.
- `storeToolResults` — when true, full tool results may be stored.
- `maxExcerptLength` — maximum length of redacted excerpts.
- `retentionDays` — automatic deletion after N days.

Even when `storeFullPayloads` is true, API keys and authorization headers are always stripped.

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

Before any content is stored, Signalglass applies redaction rules:

- Strip `Authorization` and `X-Api-Key` headers.
- Strip strings matching common secret patterns.
- Truncate excerpts to the configured maximum length.
- Mark content as redacted when only an excerpt is stored.

## Retention

The default retention period is 30 days. Users can configure shorter or longer periods. When retention expires, traces and events are deleted automatically.

## Report output

Trace reports and summary views follow the same privacy rules as storage:

- Full raw payloads are never included in reports.
- API keys, secrets, and authorization headers are never included in reports.
- `storageKey` values are not exposed in standard-mode reports.
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
