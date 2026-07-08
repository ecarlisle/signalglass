# Use SignalGlass locally with Pi

This is a manual, alpha/dev-oriented OpenAI-compatible setup. SignalGlass does not currently ship a first-class Pi extension.

Pi supports custom OpenAI-compatible providers through `~/.pi/agent/models.json`. SignalGlass forwards those requests to the upstream provider configured in `signalglass.config.json`.

## 1. Start SignalGlass

Configure the upstream provider as described in `docs/getting-started.md`, then:

```bash
export OPENAI_API_KEY=sk-...

pnpm --filter @signalglass/cli dev -- ingress \
  --config signalglass.config.json \
  --port 8080 \
  --storage .signalglass/traces.db
```

The real upstream key stays in the SignalGlass process environment.

## 2. Configure Pi

Add a custom provider to `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "signalglass": {
      "baseUrl": "http://localhost:8080/v1",
      "api": "openai-completions",
      "apiKey": "signalglass-local",
      "models": [
        {
          "id": "gpt-4o",
          "name": "GPT-4o through SignalGlass",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 4096,
          "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
          }
        }
      ]
    }
  }
}
```

The Pi-side `apiKey` is a local placeholder used to make the provider available and form an OpenAI-compatible request. It is not the upstream provider key. SignalGlass ignores inbound client authorization for upstream auth and resolves the actual key from `apiKeyEnv`.

Use the same model id in Pi and in the SignalGlass provider config.

## 3. Run a simple prompt

Non-interactive:

```bash
pi --provider signalglass --model gpt-4o --print "Reply with: SignalGlass Pi test"
```

Or:

```bash
pi --model signalglass/gpt-4o --print "Reply with: SignalGlass Pi test"
```

Interactive:

```bash
pi --model signalglass/gpt-4o
```

Tool and reasoning compatibility depends on the selected upstream model and Pi’s OpenAI-completions compatibility options. Start with a simple text prompt before testing tool-heavy sessions.

## 4. Verify and inspect the trace

List stored traces:

```bash
pnpm --filter @signalglass/cli dev -- traces \
  --storage .signalglass/traces.db \
  list
```

Inspect one:

```bash
pnpm --filter @signalglass/cli dev -- traces \
  --storage .signalglass/traces.db \
  show <trace-id> \
  --report json
```

## Troubleshooting

- If Pi cannot find the model, confirm `~/.pi/agent/models.json` is valid and run `pi --list-models signalglass`.
- If Pi reaches SignalGlass but forwarding fails, check the SignalGlass terminal for a missing `apiKeyEnv` variable or invalid provider/model configuration.
- If no trace appears, confirm ingress was started with `--storage` and inspect the same database path.
- If the local port changed, update Pi’s `baseUrl`.
- Standard mode stores redacted excerpts only; it does not persist full raw prompts/responses by default.

For current Pi custom-provider behavior, consult the Pi installation’s `docs/models.md` and `docs/custom-provider.md`.
