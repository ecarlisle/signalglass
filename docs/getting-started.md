# SignalGlass local getting started

SignalGlass local usage is currently alpha/dev-oriented. The offline analyzer, OpenAI-compatible ingress, SQLite trace storage, and terminal/JSON/HTML reports are implemented. Dashboard trace views, remote storage, auth/access control, encryption at rest, and first-class agent-harness integrations remain future work.

## Prerequisites

- Node.js 20 or newer.
- pnpm.
- An API key for an OpenAI-compatible upstream provider, unless using a keyless local provider.

## Install, build, and test

All commands in this guide should be run from the SignalGlass repo root.

```bash
pnpm install
pnpm build
pnpm test
```

The root currently has no separate `typecheck` script. TypeScript is exercised by package builds.

> **Note:** On first install, pnpm may block native build scripts for `better-sqlite3` and `esbuild`.
> If build or tests fail with a missing native binding, run:
> ```bash
> pnpm approve-builds
> # approve better-sqlite3 and esbuild when prompted
> pnpm rebuild better-sqlite3 esbuild
> ```
> See the troubleshooting section below for details.

## Run offline analysis

Terminal report:

```bash
pnpm --filter @signalglass/cli dev -- analyze samples/messy-agent-run.json
```

JSON report:

```bash
pnpm --filter @signalglass/cli dev -- analyze \
  samples/messy-agent-run.json \
  --report json
```

HTML report:

```bash
pnpm --filter @signalglass/cli dev -- analyze \
  samples/messy-agent-run.json \
  --report html \
  --output report.html
```

Generated reports are local artifacts and should not be committed.

## Configure a provider

Start from the example config and copy it to your local config:

```bash
cp signalglass.config.example.json signalglass.config.json
```

Then edit `signalglass.config.json` with your upstream provider details:

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
        { "id": "gpt-4o" },
        { "id": "gpt-4o-mini" }
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

Set the upstream key in the shell. Do not put the key in the JSON file:

```bash
export YOUR_API_KEY_ENV_VAR=sk-...
```

Replace `YOUR_API_KEY_ENV_VAR` with the value of `apiKeyEnv` from your config. See `docs/provider-config.md` for the full validated shape.

## Start live ingress

Without persistence:

```bash
pnpm --filter @signalglass/cli dev -- ingress \
  --config signalglass.config.json \
  --port 8080
```

With SQLite trace persistence:

```bash
pnpm --filter @signalglass/cli dev -- ingress \
  --config signalglass.config.json \
  --port 8080 \
  --storage .signalglass/traces.db
```

The OpenAI-compatible base URL is:

```text
http://localhost:8080/v1
```

Check the server:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/v1/models
```

Use the model `id` from the `/v1/models` response in your `/v1/chat/completions` requests. The model id must match one of the models configured in `signalglass.config.json`.

Example test request:

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Reply with: Hello from SignalGlass"}]
  }'
```

## Inspect stored traces

List traces:

```bash
pnpm --filter @signalglass/cli dev -- traces \
  --storage .signalglass/traces.db \
  list
```

List as JSON:

```bash
pnpm --filter @signalglass/cli dev -- traces \
  --storage .signalglass/traces.db \
  list \
  --report json
```

Show a trace in the terminal:

```bash
pnpm --filter @signalglass/cli dev -- traces \
  --storage .signalglass/traces.db \
  show <trace-id>
```

Show JSON:

```bash
pnpm --filter @signalglass/cli dev -- traces \
  --storage .signalglass/traces.db \
  show <trace-id> \
  --report json
```

Write HTML:

```bash
pnpm --filter @signalglass/cli dev -- traces \
  --storage .signalglass/traces.db \
  show <trace-id> \
  --report html \
  --output trace.html
```

## Agent harness guides

- `docs/getting-started-pi.md`
- `docs/getting-started-opencode.md`

These are manual OpenAI-compatible endpoint configurations, not first-class SignalGlass integrations.

## Troubleshooting

### Provider API key not found

If ingress reports that an environment variable is not set, confirm the provider config uses the variable name and the shell running ingress exports the value:

```bash
export YOUR_API_KEY_ENV_VAR=sk-...
```

Replace `YOUR_API_KEY_ENV_VAR` with the actual `apiKeyEnv` value from your `signalglass.config.json`.

### Unsupported provider or malformed config

Only `openai-compatible` forwarding is implemented. The config loader validates provider ids, URLs, nested model/capability objects, and custom headers. Use the shapes in `docs/provider-config.md`.

### Port already in use

Choose another port:

```bash
pnpm --filter @signalglass/cli dev -- ingress --config signalglass.config.json --port 8081
```

Then update the agent harness base URL to match.

### No traces are stored

Ingress persistence is opt-in. Restart ingress with:

```bash
--storage .signalglass/traces.db
```

Trace commands must use the same storage path.

### pnpm native build script approval

`pnpm install` may block native build scripts for `better-sqlite3` and `esbuild` in a fresh checkout. If build or tests fail, approve the builds and rebuild:

```bash
pnpm approve-builds
# When prompted, approve better-sqlite3 and esbuild
pnpm rebuild better-sqlite3 esbuild
```

Alternatively, add the packages to `pnpm-workspace.yaml`:

```yaml
onlyBuiltDependencies:
  - better-sqlite3
  - esbuild
```

Do not blindly approve dependency scripts in an untrusted checkout. Review the lockfile and dependency source first.

### better-sqlite3 native binding errors

If storage tests or trace commands report that the `better_sqlite3.node` binding cannot be found, reinstall and rebuild dependencies in an environment with a working native compiler toolchain and permitted package build scripts:

```bash
pnpm rebuild better-sqlite3
```

### Privacy

Standard mode stores sanitized metadata and redacted, bounded excerpts only. It does not store full raw payloads, secrets, API keys, or authorization headers by default.
