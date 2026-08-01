# SignalGlass

A disciplined observability platform for AI interactions.

SignalGlass observes, records, measures, visualizes, compares, and replays AI interactions — preserving the fidelity of application-visible requests, responses, tool activity, and context provenance.

Its guiding commitments:

- **Evidence is authoritative.** Raw captured evidence is ground truth. Metrics, visualizations, and explanations are derived, versioned views over that evidence.
- **Observe before optimizing.** SignalGlass never rewrites, summarizes, compresses, deduplicates, or otherwise changes the interactions it measures. Prompt optimization and context transformation are only ever explicit experimental conditions or optional analysis — not core behavior.
- **Separation by design.** Observations, deterministic measurements, and interpretations are kept separate. Token counts, latency, and cost are deterministic derivations (cost = measured usage × a versioned pricing schedule); smells, recommendations, and narrative are optional, clearly labeled interpretations.
- **Honest boundaries.** Capture boundaries and uncertainty are explicit. SignalGlass does not claim to know hidden provider behavior, and it reports what it could not capture.
- **Tools are observable systems.** MCP, Graphify, retrieval systems, and other tools are treated as independently observable systems.

The authoritative target-direction document is **[docs/architectural-foundation.md](docs/architectural-foundation.md)**. The completed current-state assessment is in **[docs/assessments/2026-08-01-current-state.md](docs/assessments/2026-08-01-current-state.md)**.

## Current v0.x functionality

The repository today ships a working v0.x implementation (see the [assessment](docs/assessments/2026-08-01-current-state.md)):

1. **Offline Run Analysis** — analyze captured agent runs from JSON or parser inputs.
2. **Live Ingress Observability** — act as an OpenAI-compatible ingress/proxy that captures traces, timeline events, provider requests/responses, token usage, routing decisions, and provider errors.

Both modes share the same internal domain model. A live trace can be converted into an `AgentRun` so the existing analyzer can be reused.

> **Note on legacy optimization features.** The current analyzer's smells, recommendations, and token-conservation language date from an earlier optimization-centered mission. Under the architectural foundation they are **legacy/optional functionality** — interpretations over measurements, not core behavior. They remain available in the v0.x code and are being re-framed as an optional analysis module in the target architecture.

## What SignalGlass is not (yet)

- An automatic optimizer that rewrites context for you.
- A first-class integration for every agent harness.
- A system that stores full raw payloads or API keys by default. Capture fidelity is governed by explicit capture profiles in the target architecture; full-fidelity capture is opt-in and never the universal default.
- A production gateway with auth, encryption at rest, or remote storage.
- A system that claims exact provider behavior or byte-exact request preservation (the current ingress parses request JSON before forwarding).

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
├── docs/                   # Foundation, principles, architecture, roadmap, glossary, ADRs, assessments
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

SignalGlass currently uses a simple character-based approximation (roughly one token per four characters). In the target architecture, token counts are deterministic measurements recorded as versioned derivations over evidence, with provider-reported and locally estimated values distinguished.

## License

MIT
