# Use SignalGlass locally with OpenCode

This is a manual, alpha/dev-oriented OpenAI-compatible setup. SignalGlass does not currently ship a first-class OpenCode plugin or provider.

OpenCode supports custom providers through `opencode.json` using `@ai-sdk/openai-compatible`.

## 1. Start SignalGlass

All commands should be run from the SignalGlass repo root.

Configure the upstream provider as described in `docs/getting-started.md`, then:

```bash
export YOUR_API_KEY_ENV_VAR=sk-...

pnpm --filter @signalglass/cli dev -- ingress \
  --config signalglass.config.json \
  --port 8080 \
  --storage .signalglass/traces.db
```

Call `GET /v1/models` first and use a returned model `id` in your requests.

## 2. Configure OpenCode

Create or update the project’s `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "signalglass": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "SignalGlass local ingress",
      "options": {
        "baseURL": "http://127.0.0.1:8080/v1",
        "apiKey": "signalglass-local"
      },
      "models": {
        "gpt-4o": {
          "name": "GPT-4o through SignalGlass"
        }
      }
    }
  }
}
```

The OpenCode-side `apiKey` is a local placeholder, not the upstream key. The real upstream key remains in the SignalGlass process environment and is selected through `apiKeyEnv`.

Use a model id exposed by SignalGlass `GET /v1/models` and listed in `signalglass.config.json`.

## 3. Run a simple prompt

From the project directory:

```bash
opencode run --model signalglass/gpt-4o "Reply with: SignalGlass OpenCode test"
```

You can also start the TUI and select `signalglass/gpt-4o`:

```bash
opencode
```

Exact tool-call behavior depends on OpenCode, the selected model, and the upstream endpoint. Start with a basic text prompt before testing a full coding workflow.

## 4. Verify and inspect the trace

```bash
pnpm --filter @signalglass/cli dev -- traces \
  --storage .signalglass/traces.db \
  list
```

Then:

```bash
pnpm --filter @signalglass/cli dev -- traces \
  --storage .signalglass/traces.db \
  show <trace-id> \
  --report terminal
```

JSON and HTML are also available (commands run from the SignalGlass repo root):

```bash
pnpm --filter @signalglass/cli dev -- traces \
  --storage .signalglass/traces.db \
  show <trace-id> \
  --report html \
  --output trace.html
```

## Troubleshooting

- If the model is missing, run `curl http://127.0.0.1:8080/v1/models` and make the OpenCode model key match a returned id.
- If OpenCode cannot connect, confirm SignalGlass is listening on the same host/port used in `options.baseURL`.
- If the upstream key is missing, set the environment variable referenced by the SignalGlass provider’s `apiKeyEnv`.
- If no trace appears, confirm ingress was started with `--storage` and use that same path with `signalglass traces`.
- Standard mode stores redacted excerpts only and does not persist full raw request/response payloads by default.

OpenCode provider configuration evolves independently of SignalGlass. See the official [OpenCode provider documentation](https://opencode.ai/docs/providers/) for current config behavior.
