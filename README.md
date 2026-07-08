# SignalGlass

Observability for AI coding-agent runs.

SignalGlass helps developers inspect what context AI coding agents send to models, where tokens are spent, what gets repeated, what appears wasteful, and how different models or agent runs behave on the same task.

SignalGlass is an observability and education tool. Token savings matter, but the larger goal is to make agent behavior legible. Its core offering is **signal**, not automatic optimization.

## Two complementary modes

1. **Offline Run Analysis** — analyze captured agent runs from JSON or parser inputs.
2. **Live Ingress Observability** — act as an OpenAI-compatible ingress/proxy that captures traces, timeline events, provider requests/responses, token usage, transformations, and optimization opportunities.

Both modes share the same internal domain model. A live trace can be converted into an `AgentRun` so the existing analyzer, smells, recommendations, and reports can be reused.

## What it is

- An analyzer and reporting tool for saved agent-run data.
- A live ingress observability layer with OpenAI-compatible proxy support.
- A way to answer: **“What did the agent send to the model, and what can we learn from it?”**
- A source of SIGNAL: cost, relevance, behavior, comparison, and education.
- Every finding should explain what happened, why it matters, what evidence supports it, and what to inspect or try next.

## What it is not (yet)

- An automatic optimizer that rewrites context for you.
- A first-class integration for every agent harness.
- A system that stores full raw payloads or API keys by default.
- A production gateway with auth, encryption at rest, or remote storage.

## Quick start

All commands should be run from the SignalGlass repo root.

```bash
# Install dependencies (see docs/getting-started.md if native builds are blocked)
pnpm install

# Build workspace
pnpm build

# Run tests
pnpm test

# Copy the example provider config and edit it
cp signalglass.config.example.json signalglass.config.json
# Then edit signalglass.config.json with your upstream provider
# Set the API key environment variable referenced in the config

# Run offline analysis
pnpm --filter @signalglass/cli dev -- analyze samples/messy-agent-run.json
```

For live ingress setup, storage, trace reports, Pi, and OpenCode examples, see:

- [General local setup](docs/getting-started.md)
- [Pi local setup](docs/getting-started-pi.md)
- [OpenCode local setup](docs/getting-started-opencode.md)

## Repository structure

```text
signalglass/
├── apps/
│   ├── dashboard/          # Vite + React report viewer (future Observatory UI)
│   └── ingress/            # OpenAI-compatible ingress server
├── packages/
│   ├── cli/                # CLI entrypoint
│   ├── core/               # Domain models, token estimation, analysis, smells, trace model
│   ├── parsers/            # Offline format parsers (SignalGlass JSON + OpenCode placeholder)
│   ├── providers/          # Provider configs and adapters (openai-compatible, anthropic placeholder, gemini/ollama/custom stubs)
│   ├── reports/            # Terminal, JSON, and static HTML report formatters
│   └── storage/            # SQLite persistence for traces/events
├── samples/                # Example agent-run files
├── docs/                   # Principles, architecture, roadmap, report contract, glossary, ADRs
├── README.md
└── AGENTS.md
```

## Commands

```bash
# Terminal report (default)
pnpm --filter @signalglass/cli dev -- analyze samples/messy-agent-run.json

# JSON report
pnpm --filter @signalglass/cli dev -- analyze samples/messy-agent-run.json --report json

# Static HTML report
pnpm --filter @signalglass/cli dev -- analyze samples/messy-agent-run.json --report html --output report.html

# Live ingress with optional SQLite trace storage
pnpm --filter @signalglass/cli dev -- ingress --config signalglass.config.json --port 8080 --storage .signalglass/traces.db

# List stored traces
pnpm --filter @signalglass/cli dev -- traces --storage .signalglass/traces.db list

# Show one stored trace
pnpm --filter @signalglass/cli dev -- traces --storage .signalglass/traces.db show <trace-id> --report terminal
```

See `docs/ingress.md`, `docs/provider-config.md`, and `docs/privacy.md` for details on live ingress and privacy-safe storage.

## Token counts are approximate

SignalGlass currently uses a simple character-based approximation (roughly one token per four characters). It is designed so that a real tokenizer can be plugged in later.

## License

MIT
