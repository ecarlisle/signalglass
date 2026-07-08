# Signalglass provider config

Provider config tells Signalglass how to reach an upstream model provider and how to translate between provider-native formats and the internal Signalglass trace model.

A single Signalglass instance can be configured with multiple providers. Requests are routed by provider `id` or by model name.

## Provider config file

A minimal config file might look like this:

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
      "models": ["gpt-4o", "gpt-4o-mini"],
      "capabilities": ["streaming", "tools", "json_mode"],
      "headers": {}
    }
  ]
}
```

## Provider config fields

| Field | Required | Description |
|---|---|---|
| `id` | yes | Stable identifier used for routing and logs. |
| `label` | no | Human-readable name. |
| `kind` | yes | Adapter kind. One of `openai-compatible`, `anthropic`, `gemini`, `ollama`, `custom`. |
| `baseUrl` | yes | Upstream endpoint base URL. |
| `apiKeyEnv` | yes* | Name of the environment variable that holds the API key. *May be optional for local providers like Ollama.* |
| `defaultModel` | no | Model to use when the request does not specify one. |
| `models` | no | List of supported models and aliases. |
| `capabilities` | no | Supported features such as `streaming`, `tools`, `json_mode`, `vision`. |
| `headers` | no | Additional headers to send to the upstream provider. |

## Adapter kinds

```ts
type ProviderKind =
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "custom";
```

- `openai-compatible` — OpenAI or any endpoint that implements the OpenAI chat completions API.
- `anthropic` — Anthropic Messages API.
- `gemini` — Google Gemini API.
- `ollama` — Local Ollama API.
- `custom` — User-provided adapter for specialized or proprietary endpoints.

## API key handling

API keys are **never stored in config files**.

Config files reference the environment variable name:

```json
"apiKeyEnv": "OPENAI_API_KEY"
```

At runtime, Signalglass reads `process.env["OPENAI_API_KEY"]`. If the variable is missing, the request fails before leaving Signalglass.

This rule applies to all providers and all deployment environments.

## Model routing

A request can specify a model explicitly:

```json
{ "model": "gpt-4o" }
```

Signalglass looks up the model in the configured providers. If a unique match is found, the request routes there. If the model is ambiguous or missing, the `defaultModel` of the default provider is used, or the request is rejected.

## Capabilities

Capabilities declare what a provider supports. The ingress uses them to:

- Reject unsupported parameters early.
- Choose normalized response handling.
- Decide whether streaming is available.
- Document adapter limitations.

Common capabilities:

- `streaming`
- `tools`
- `json_mode`
- `vision`
- `function_calling`

## Custom adapters

A `custom` adapter requires a user-supplied module that implements the adapter interface. Custom adapters are useful for private endpoints, gateways, or experimental providers.

The interface is documented in `docs/decisions/0003-provider-adapter-architecture.md` and will be formalized in the provider adapter API reference.
