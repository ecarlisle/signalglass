# SignalGlass live ingress

Live ingress is the second SignalGlass mode. It sits between an AI agent tool and an upstream model provider, captures what passes through, and produces traces that can be reported on later.

The implemented ingress is an **OpenAI-compatible doorway**. Agent harnesses that can point an OpenAI-compatible base URL at a local endpoint can route through SignalGlass without code changes to SignalGlass itself.

Local usage is currently alpha/dev-oriented. It is useful for observing and reporting on local traces, but it is not a production gateway and does not yet include auth, encryption at rest, remote storage, or first-class harness integrations.

## Modes recap

1. **Offline Run Analysis** — analyze captured runs from JSON or parser inputs.
2. **Live Ingress Observability** — capture traces, timeline events, provider requests/responses, token usage, transformations, and privacy boundaries as requests happen.

## Implemented HTTP endpoints

```text
GET  /health
GET  /v1/models
POST /v1/chat/completions
```

`POST /v1/chat/completions` forwards a non-streaming OpenAI-compatible chat completion request to the selected upstream provider and returns the upstream response to the client.

## Starting the ingress

From a source checkout:

```bash
export OPENAI_API_KEY=sk-...
pnpm --filter @signalglass/cli dev -- ingress --config signalglass.config.json --port 8080
```

With trace persistence:

```bash
pnpm --filter @signalglass/cli dev -- ingress \
  --config signalglass.config.json \
  --port 8080 \
  --storage .signalglass/traces.db
```

The ingress exposes an OpenAI-compatible base URL:

```bash
http://localhost:8080/v1
```

Client tools should use their own configured API key for the local SignalGlass endpoint if they require one syntactically. SignalGlass does not use the inbound client key for upstream auth; it reads upstream provider keys from environment variable names referenced in `signalglass.config.json`.

## Example provider config

```json
{
  "providers": [
    {
      "id": "openai",
      "label": "OpenAI",
      "kind": "openai-compatible",
      "baseUrl": "https://api.openai.com/v1",
      "apiKeyEnv": "OPENAI_API_KEY",
      "defaultModel": "gpt-4o",
      "models": [{ "id": "gpt-4o" }, { "id": "gpt-4o-mini" }],
      "capabilities": { "tools": true, "jsonMode": true }
    }
  ]
}
```

See `docs/provider-config.md` for the full shape and validation rules.

## What the ingress captures

By default, the ingress captures:

- Trace metadata: id, timestamps, provider, model, mode, status.
- Timeline event metadata: event type, content phase, source type, timestamps.
- Token metrics: provider-reported usage when available, approximate estimates otherwise.
- Routing decisions and transformation summaries when present.
- Short redacted excerpts of content.
- `provider_error` events for upstream non-2xx responses, invalid upstream response bodies, and forwarding failures.

## What the ingress does not capture by default

- Full raw request payloads.
- Full raw response payloads.
- Secrets, API keys, authorization headers, cookies, or proxy authorization headers.
- Full tool results.

Full payload capture is debug-mode opt-in in the trace model and storage policy, not a default behavior. See `docs/privacy.md`.

## Storage

Storage is opt-in. Passing `--storage <path>` wires the ingress `onTrace` callback to SQLite-backed storage:

```bash
pnpm --filter @signalglass/cli dev -- ingress --config signalglass.config.json --storage .signalglass/traces.db
```

If `--storage` is omitted, ingress still forwards requests but does not persist traces.

Inspect persisted traces with:

```bash
pnpm --filter @signalglass/cli dev -- traces --storage .signalglass/traces.db list
pnpm --filter @signalglass/cli dev -- traces --storage .signalglass/traces.db show <trace-id>
pnpm --filter @signalglass/cli dev -- traces --storage .signalglass/traces.db show <trace-id> --report json
pnpm --filter @signalglass/cli dev -- traces --storage .signalglass/traces.db show <trace-id> --report html --output trace.html
```

## CLI commands

```bash
signalglass analyze <file> [--report terminal|json|html] [--output <file>]
signalglass ingress --config <file> [--port <port>] [--storage <path>]
signalglass traces --storage <path> list [--report terminal|json] [--output <file>]
signalglass traces --storage <path> show <trace-id> [--report terminal|json|html] [--output <file>]
```

There is no default storage path. Trace commands require `--storage <path>`.

## Security notes

- API keys are read from environment variables referenced by name in the provider config.
- Provider config rejects credential-bearing URLs and sensitive configured headers.
- Authorization and other credential-like fields are stripped or redacted before storage/reporting.
- Run local ingress only where you have permission to proxy the agent/model traffic.
- For production deployments, add controls outside SignalGlass today: auth, access control, encryption at rest, retention jobs, and network restrictions.
