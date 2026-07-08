# Local alpha dogfood notes

Date: 2026-07-08

Release under test: v0.1.0-alpha.3

Tester: Eric Carlisle

## Workflow tested

1. Installed dependencies and rebuilt native packages.
2. Built workspace (`pnpm build`).
3. Ran tests (`pnpm test`).
4. Copied example config and configured OpenCode Zen as an OpenAI-compatible provider.
5. Started SignalGlass ingress with SQLite trace storage.
6. Called `GET /v1/models` to verify available models.
7. Sent one `POST /v1/chat/completions` request using the returned model id.
8. Listed stored traces.
9. Generated and inspected a terminal trace report.
10. Generated an HTML trace report.

## Findings

### 1. Setup assumes local config exists

The getting-started flow assumes `signalglass.config.json` exists, but a fresh checkout does not include one.

**Fix applied:**

- Added `signalglass.config.example.json` at repo root with safe placeholder values.
- Added `signalglass.config.json` to `.gitignore`.
- Updated `docs/getting-started.md` and `README.md` to tell users to copy the example config.
- Documented that API keys should be provided through environment variables, not committed in config files.

### 2. pnpm native build approval is required

`pnpm install` may block native build scripts for `better-sqlite3` and `esbuild`. Observed failure: storage tests could not locate the `better-sqlite3` native binding.

**Fix applied:**

- Added `onlyBuiltDependencies` for `better-sqlite3` and `esbuild` in `pnpm-workspace.yaml`.
- Added troubleshooting steps in `docs/getting-started.md` covering `pnpm approve-builds` and `pnpm rebuild`.

### 3. Commands should be run from the repo root

Running `signalglass` commands from a parent workspace (e.g., `~/repos`) produced an unrelated pnpm workspace warning.

**Fix applied:**

- Updated `docs/getting-started.md` and `README.md` with explicit instructions to run commands from the SignalGlass repo root.

### 4. Users must call `/v1/models` first

The model `id` returned by `GET /v1/models` must be used in `POST /v1/chat/completions` requests. A model name that the upstream provider returns may differ from what the client expects.

**Fix applied:**

- Added documentation in `docs/getting-started.md` clarifying the `/v1/models` → `/v1/chat/completions` flow.
- Included a curl example using the discovered model id.

### 5. OpenCode Zen worked as an upstream provider

OpenCode Zen (`https://opencode.ai/zen/v1`) was configured as an OpenAI-compatible upstream. The model id returned by SignalGlass was `deepseek-v4-flash-free`. A basic chat completion request succeeded, and the trace was stored and reportable.

**OpenCode Zen config used:**

```json
{
  "providers": [
    {
      "id": "opencode-zen",
      "label": "OpenCode Zen",
      "kind": "openai-compatible",
      "baseUrl": "https://opencode.ai/zen/v1",
      "apiKeyEnv": "OPENCODE_ZEN_API_KEY",
      "defaultModel": "deepseek-v4-flash-free",
      "models": [
        { "id": "deepseek-v4-flash-free" }
      ],
      "capabilities": {
        "streaming": false,
        "tools": true,
        "jsonMode": true
      }
    }
  ]
}
```

### 6. Trace reports worked

- Terminal trace report (`--report terminal`) rendered correctly.
- HTML trace report (`--report html --output trace.html`) generated and rendered correctly in a browser.
- Both reports showed request/response metadata, redacted content excerpts, and approximate token estimates.

### 7. Provider usage reporting has discrepancies (deferred follow-up)

The trace report shows visible token estimates alongside provider-reported usage. These can differ significantly (e.g., approximate character-based estimates vs. real tokenizer counts from the upstream provider). Improving the accuracy of token reporting and reconciling provider-reported usage with SignalGlass estimates is deferred to a future spec.

No code changes were made for this item. This note documents the observed gap only.

## Summary

The local alpha flow is functional for basic observability. The fixes in this session address the setup friction points and documentation gaps identified during manual testing. Provider usage reporting accuracy remains a known gap for future work.
