# Spec 005: Provider adapters

## Status

Implemented (OpenAI-compatible), Draft (Anthropic/Gemini/Ollama/Custom)

## Purpose

Define the boundary between provider-native protocols and the internal SignalGlass trace model.

## Scope

- Provider config and model config types.
- Provider capabilities.
- Provider adapter interface.
- OpenAI-compatible adapter.
- Anthropic placeholder.

## Non-goals

- Ingress routing logic.
- Streaming support.
- Storage or persistence.

## Required files or modules

- `packages/providers/src/types.ts`
- `packages/providers/src/openaiAdapter.ts`
- `packages/providers/src/anthropicPlaceholder.ts`
- `packages/providers/src/openaiAdapter.test.ts`
- `packages/providers/src/fixtures/openai-chat-request.json`
- `packages/providers/src/fixtures/openai-chat-response.json`

## Required types or contracts

```ts
type ProviderKind =
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "custom";

interface ProviderConfig {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKeyEnv?: string;
  defaultModel?: string;
  models?: ProviderModelConfig[];
  capabilities?: ProviderCapabilities;
  headers?: Record<string, string>;
}

interface ProviderModelConfig { ... }
interface ProviderCapabilities { streaming?, tools?, vision?, jsonMode?, reasoning? }

interface ProviderAdapter {
  kind: ProviderKind;
  name: string;
  normalizeRequest(input: unknown, provider: ProviderConfig): TraceEvent[];
  normalizeResponse(input: unknown, provider: ProviderConfig): TraceEvent[];
  buildUpstreamRequest?(input: unknown, provider: ProviderConfig): unknown;
  buildClientResponse?(input: unknown, provider: ProviderConfig): unknown;
}
```

## Required behavior

- Adapters translate provider-native request/response JSON into `TraceEvent[]`.
- OpenAI-compatible adapter emits:
  - `instruction`/`sent` for system messages.
  - `message`/`said` for user messages.
  - `context`/`requested` for tool definitions.
  - `provider_request`/`requested` with routing metadata.
  - `provider_response`/`observed`.
  - `message`/`generated` for assistant content.
  - `inference`/`observed` for usage metadata.
  - `egress_response`/`returned`.
- Adapter output never contains API keys, authorization headers, or secrets.
- API keys are referenced by `apiKeyEnv` and resolved at runtime; they are never persisted.
- Anthropic adapter placeholder throws `not implemented`.

## Acceptance criteria

- [x] `openaiAdapter.normalizeRequest(fixture)` returns the expected event types and phases.
- [x] `openaiAdapter.normalizeResponse(fixture)` returns usage metadata and generated content.
- [x] Adapter output contains no `api_key`, `authorization`, or secret values.
- [x] `createProviderConfig` provides sensible defaults.
- [x] `resolveProviderApiKey` reads from the named environment variable.

## Tests

- `packages/providers/src/openaiAdapter.test.ts`

## References

- `docs/provider-config.md`
- `docs/decisions/0003-provider-adapter-architecture.md`
- `specs/004-trace-model.md`
