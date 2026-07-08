# Spec 006: OpenAI-compatible ingress

## Status

Draft

## Purpose

Define the live ingress server that sits between an agent tool and an upstream provider.

## Scope

- OpenAI-compatible HTTP endpoint.
- Request/response forwarding.
- Trace event capture and trace assembly.
- Provider adapter invocation.

## Non-goals

- Anthropic-compatible ingress (see Spec 005 for adapter stub).
- Streaming responses.
- SQLite storage (see Spec 007).
- Automatic context rewriting.

## Required files or modules

- `apps/ingress/` (future app).
- `packages/providers`.
- `packages/core`.

## Required types or contracts

- `ProviderConfig`, `ProviderAdapter` from `packages/providers`.
- `Trace`, `TraceEvent` from `packages/core`.
- CLI command: `signalglass ingress --config <file> [--port <port>]`.

## Required behavior

- Expose an OpenAI-compatible base URL, e.g. `http://localhost:8080/v1`.
- Read provider configuration from a JSON file.
- Resolve API keys from environment variable names.
- For each request:
  1. Receive client request.
  2. Call `adapter.normalizeRequest(input, provider)` to emit trace events.
  3. Forward the request to the upstream provider.
  4. Receive provider response.
  5. Call `adapter.normalizeResponse(input, provider)` to emit trace events.
  6. Return a client-compatible response.
  7. Assemble events into a `Trace`.
- Do not store or log API keys.
- Apply capture policy before storing anything (storage is Spec 007).

## Acceptance criteria

- [ ] An agent can set `OPENAI_BASE_URL` to Signalglass and complete a chat completion.
- [ ] The ingress emits `TraceEvent` objects for the full lifecycle.
- [ ] No API keys appear in logs, events, or responses.
- [ ] The assembled `Trace` can be converted into an `AgentRun`.

## Tests

- Integration tests with a mocked upstream provider.
- No real provider API calls in tests.
- Verify emitted trace event sequence matches the expected pipeline.

## References

- `docs/ingress.md`
- `specs/004-trace-model.md`
- `specs/005-provider-adapters.md`
