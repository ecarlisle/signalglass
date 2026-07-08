# Spec 006: OpenAI-compatible ingress

## Status

Accepted

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
- Dashboard work or UI views.
- Advanced routing, load balancing, or gateway features beyond model-based provider selection.
- Token reduction or context optimization pipeline.
- Raw payload storage by default (full payloads are opt-in per `docs/privacy.md`).

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
- Implement the following HTTP endpoints:
  - `GET /health` — return a health check response.
  - `GET /v1/models` — return the models available from the configured providers.
  - `POST /v1/chat/completions` — accept an OpenAI-compatible chat completion request and return a client-compatible response.
- Read provider configuration from a JSON file.
- Resolve API keys from environment variable names.
- For each chat completion request:
  1. Receive client request.
  2. Call `adapter.normalizeRequest(input, provider)` to emit trace events.
  3. Forward the request to the upstream provider.
  4. Receive provider response.
  5. Call `adapter.normalizeResponse(input, provider)` to emit trace events.
  6. Return a client-compatible response.
  7. Assemble events into a `Trace`.
- Do not store or log API keys.
- Apply the capture policy before storing anything. By default, store only metadata, metrics, routing decisions, transformation summaries, and short redacted excerpts (see `docs/privacy.md`). Full raw payloads are opt-in.
- Use the existing OpenAI-compatible adapter from `@signalglass/providers`.

## Acceptance criteria

- [ ] `GET /health` returns a success response.
- [ ] `GET /v1/models` returns the models available from the configured providers.
- [ ] An agent can set `OPENAI_BASE_URL` to Signalglass and complete a chat completion through `POST /v1/chat/completions`.
- [ ] The ingress emits `TraceEvent` objects for the full lifecycle.
- [ ] No API keys appear in logs, events, or responses.
- [ ] The assembled `Trace` can be converted into an `AgentRun`.
- [ ] Default capture stores only metadata, metrics, routing decisions, transformation summaries, and short redacted excerpts.

## Tests

- Unit/integration tests for config loading and provider selection.
- Tests that API keys are resolved from the environment variable name configured in `apiKeyEnv`.
- Tests for `GET /health` and `GET /v1/models`.
- Integration tests for `POST /v1/chat/completions` with a mocked upstream provider.
- No real provider API calls in tests.
- Verify the emitted `TraceEvent` sequence matches the expected pipeline.
- Verify no API keys, authorization headers, or secrets appear in trace events, logs, or responses.
- Verify default capture is metadata/redacted-excerpt only.
- Verify the assembled `Trace` can be converted into an `AgentRun`.
- `pnpm test` and `pnpm build` pass.

## References

- `docs/ingress.md`
- `docs/provider-config.md`
- `docs/privacy.md`
- `docs/trace-model.md`
- `docs/decisions/0002-two-modes.md`
- `docs/decisions/0003-provider-adapter-architecture.md`
- `specs/004-trace-model.md`
- `specs/005-provider-adapters.md`
