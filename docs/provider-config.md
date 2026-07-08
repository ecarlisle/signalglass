# SignalGlass provider config

Provider config tells SignalGlass how to reach an upstream model provider and how to translate between provider-native formats and the internal SignalGlass trace model.

A single local ingress can be configured with multiple providers. Requests are routed by model id, model alias, or provider id.

## Provider config file

A minimal OpenAI-compatible config file looks like this:

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
      "models": [
        {
          "id": "gpt-4o",
          "aliases": ["gpt-4o-latest"],
          "capabilities": {
            "tools": true,
            "jsonMode": true,
            "vision": true
          },
          "limits": {
            "contextWindow": 128000,
            "maxOutputTokens": 4096
          }
        },
        {
          "id": "gpt-4o-mini"
        }
      ],
      "capabilities": {
        "streaming": false,
        "tools": true,
        "jsonMode": true,
        "vision": true
      },
      "headers": {}
    }
  ]
}
```

`models` is an array of objects, not strings. `capabilities` is an object of boolean flags, not a string array.

## Provider config fields

| Field | Required | Description |
|---|---|---|
| `id` | yes | Non-empty stable identifier used for routing and reports. |
| `label` | no | Human-readable name. Defaults to `id`. |
| `kind` | yes | Adapter kind. The current ingress accepts `openai-compatible`; other type-level adapter kinds are reserved for future implementations. |
| `baseUrl` | yes | Valid `http` or `https` upstream base URL, such as `https://api.openai.com/v1`. URLs containing username/password credentials are rejected. |
| `apiKeyEnv` | no | Name of the environment variable that holds the provider API key. Required for providers that need a key. May be omitted for local keyless endpoints. |
| `defaultModel` | no | Non-empty model id to use when the request does not specify one. |
| `models` | no | Array of `ProviderModelConfig` objects. |
| `capabilities` | no | Object of supported boolean features. |
| `headers` | no | Additional non-sensitive string headers to send upstream. |

Sensitive headers such as `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, and `x-api-key` are rejected in config. API keys must be referenced by environment variable name and are resolved at runtime.

## Provider model config

```ts
interface ProviderModelConfig {
  id: string;
  label?: string;
  aliases?: string[];
  capabilities?: ProviderCapabilities;
  limits?: {
    contextWindow?: number;
    maxOutputTokens?: number;
  };
  pricing?: {
    inputPerMillion?: number;
    outputPerMillion?: number;
  };
}
```

`id` is required. Aliases are useful when a harness uses a model name that should route to the same provider/model entry.

## Capabilities

```ts
interface ProviderCapabilities {
  streaming?: boolean;
  tools?: boolean;
  vision?: boolean;
  jsonMode?: boolean;
  reasoning?: boolean;
}
```

These flags document provider/model support. The current ingress is intentionally conservative: OpenAI-compatible non-streaming chat completions are implemented; richer validation/routing based on capabilities remains future work.

## Adapter kinds

```ts
type ProviderKind =
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "custom";
```

- `openai-compatible` — OpenAI or any endpoint that implements the OpenAI chat completions API. Implemented today.
- `anthropic`, `gemini`, `ollama`, `custom` — reserved adapter kinds. Broader provider adapters are future work.

## API key handling

API keys are never stored in config files. Config files reference the environment variable name:

```json
"apiKeyEnv": "OPENAI_API_KEY"
```

At runtime, SignalGlass reads `process.env.OPENAI_API_KEY` and uses the value only when forwarding upstream. If `apiKeyEnv` is configured and the variable is missing, the request fails before leaving SignalGlass.

## Model routing

A request can specify a model explicitly:

```json
{ "model": "gpt-4o" }
```

SignalGlass looks up the model in configured provider model ids and aliases. If no model matches, routing falls back to the first provider whose `defaultModel` matches or, when no model is provided, to the first configured provider.

## Custom headers

Custom headers are intended for non-secret provider metadata. Do not put credentials in `headers`; use `apiKeyEnv` instead. The config loader rejects common sensitive header names.
