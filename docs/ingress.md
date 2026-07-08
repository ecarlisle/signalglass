# Signalglass live ingress

Live ingress is the second Signalglass mode. It sits between an AI agent tool and an upstream model provider, captures what passes through, and produces traces that can be analyzed and visualized.

Live ingress starts with an **OpenAI-compatible doorway**. Agents that already talk to OpenAI can point their base URL at Signalglass without code changes.

## Modes recap

1. **Offline Run Analysis** — analyze captured runs from JSON or parser inputs.
2. **Live Ingress Observability** — capture traces, timeline events, provider requests/responses, token usage, transformations, and optimization opportunities as they happen.

Both modes produce the same underlying observability data. A live trace can be converted into an `AgentRun` for offline-style analysis.

## Conceptual pipeline

```
Client / Agent Tool
  ↓
OpenAI-Compatible Ingress
  ↓
Ingress Adapter
  ↓
SignalGlass Trace / Timeline Events
  ↓
Provider Adapter
  ↓
Upstream Provider
  ↓
Response Normalizer
  ↓
Client-Compatible Response
```

1. The agent sends an OpenAI-compatible request to Signalglass.
2. The ingress receives it and emits a `request_received` event.
3. The ingress adapter normalizes the request to internal trace events.
4. The provider adapter selects the upstream provider and translates the request back to the provider's native format.
5. The provider returns a response.
6. The response normalizer converts it to a client-compatible response and emits timeline events.
7. The response is returned to the agent.

## Starting the ingress

Conceptual CLI command:

```bash
signalglass ingress --config signalglass.config.json --port 8080
```

The ingress exposes an OpenAI-compatible base URL:

```bash
export OPENAI_BASE_URL=http://localhost:8080/v1
export OPENAI_API_KEY=$YOUR_PROVIDER_KEY
```

Agents that read `OPENAI_BASE_URL` will now route through Signalglass.

## What the ingress captures

By default, the ingress captures only what is needed for observability:

- Trace metadata (id, timestamps, provider, model, agent, task).
- Timeline event metadata (kind, phase, source type, timestamps).
- Token metrics (input/output tokens reported by the provider or estimated).
- Routing decisions (which provider and model were selected).
- Transformation summaries (what changed, not full before/after text).
- Short redacted excerpts of content (for display in Trace and Story views).

## What the ingress does NOT capture by default

- Full raw request payloads.
- Full raw response payloads.
- Secrets, API keys, or authorization headers.
- Full tool results, unless the capture policy explicitly allows them.

Full payload capture is opt-in per provider or per trace. See `docs/privacy.md`.

## Storage

Captured traces can be persisted via the `@signalglass/storage` package (SQLite backend). Storage is opt-in: pass `--storage <path>` to the ingress CLI command. When enabled, traces are sanitized (redacted) before storage. Only the items listed above are written unless the capture policy is changed.

See `docs/privacy.md` for redaction rules and `specs/007-storage-and-privacy.md` for the storage specification.

## CLI commands

```bash
signalglass ingress --config signalglass.config.json [--port <port>] [--storage <path>]
signalglass traces --storage <path> list [--report terminal|json] [--output <file>]
signalglass traces --storage <path> show <trace-id> [--report terminal|json|html] [--output <file>]
```

Future CLI commands:

```bash
signalglass traces export <trace-id> --output run.json
```

## Security notes

- API keys are read from environment variables referenced by name in the config. They are never written to disk or stored in traces.
- Authorization headers are stripped before any event is stored.
- The ingress should run locally or behind a trusted reverse proxy.
- See `docs/privacy.md` for retention, redaction, and compliance guidance.
