# ADR 0003: Provider adapter architecture

## Status

Accepted

## Context

Live ingress must forward agent requests to upstream providers such as OpenAI, Anthropic, Google Gemini, Ollama, or custom endpoints. Each provider has its own request/response shape, authentication, models, and capabilities.

A naive approach would embed provider-specific protocol details throughout the ingress server and internal model. That would make OpenAI compatibility the de facto internal architecture and would make future providers expensive to add.

Instead, Signalglass needs a clean boundary: an internal trace/timeline model on one side, and provider-specific adapters on the other.

## Decision

Signalglass will use a **provider adapter** layer.

- Provider adapters are responsible for translating between provider-native request/response formats and Signalglass internal trace events.
- The internal data model (`Trace`, `TraceEvent`, `AgentRun`, `ContextBlock`, etc.) must remain provider-agnostic.
- OpenAI compatibility is the first adapter, but it is not the internal model.
- Anthropic, Gemini, Ollama, and custom adapters will follow the same interface.
- API keys are configured by referencing environment variable names, never by storing key values.
- Adapters declare their capabilities so the ingress can validate requests and route appropriately.

## Adapter kinds

```ts
type ProviderKind =
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "custom";
```

- `openai-compatible` — OpenAI or OpenAI-compatible endpoints.
- `anthropic` — Anthropic Messages API.
- `gemini` — Google Gemini API.
- `ollama` — Ollama local inference API.
- `custom` — User-provided adapter for proprietary or specialized endpoints.

## Provider config fields

Each provider is configured with:

- `id` — stable identifier used for routing.
- `label` — human-readable name.
- `kind` — adapter kind from the enum above.
- `baseUrl` — upstream endpoint base URL.
- `apiKeyEnv` — name of the environment variable holding the API key.
- `defaultModel` — model to use when the request does not specify one.
- `models` — list of supported models and their aliases.
- `capabilities` — supported features (streaming, tools, JSON mode, etc.).
- `headers` — additional headers to send upstream.

## Consequences

### Positive

- Internal model stays clean and stable.
- Adding a new provider means adding one adapter, not rewriting ingress logic.
- Adapters can be tested in isolation using captured request/response fixtures.
- Provider-specific quirks are encapsulated.

### Negative

- Adapters must be kept up to date as provider APIs evolve.
- Some provider features may not map cleanly to the internal model; adapters must document limitations.

### Accepted trade-offs

- A small amount of duplication between adapters is acceptable if it keeps each adapter explicit and readable.
- Custom adapters require a documented interface but are not validated at runtime beyond type checks.

## Related documents

- `docs/provider-config.md`
- `docs/trace-model.md`
- `docs/ingress.md`
- `docs/decisions/0002-two-modes.md`
