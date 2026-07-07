# Signalglass

Observability for AI coding-agent runs.

Signalglass helps developers inspect what context AI coding agents send to models, where tokens are spent, what gets repeated, what appears wasteful, and how different models or agent runs behave on the same task.

Signalglass educates as it observes. Its core offering is **signal**, not automatic optimization.

## What it is

- An analyzer and reporting tool for saved agent-run data.
- A way to answer: **“What did the agent send to the model, and what can we learn from it?”**
- A source of SIGNAL: cost, relevance, behavior, comparison, and education.
- Every finding should explain what happened, why it matters, what evidence supports it, and what to inspect or try next.

## What it is not (yet)

- A proxy between your agent and a model provider.
- An automatic optimizer that rewrites context for you.
- A provider-specific integration.

## Quick start

```bash
pnpm install
pnpm build
pnpm test
pnpm --filter @signalglass/cli dev -- analyze samples/messy-agent-run.json
```

## Repository structure

```
signalglass/
├── apps/
│   └── dashboard/          # Vite + React report viewer
├── packages/
│   ├── cli/                # CLI entrypoint
│   ├── core/               # Domain models, token estimation, analysis, smells
│   ├── parsers/            # Input format parsers (Signalglass JSON + OpenCode placeholder)
│   └── reports/            # Terminal, JSON, and static HTML report formatters
├── samples/                # Example agent-run files
├── docs/                   # Product brief, principles, UI vision, MVP plan, glossary
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
```

## Token counts are approximate

Signalglass currently uses a simple character-based approximation (roughly one token per four characters). It is designed so that a real tokenizer can be plugged in later.

## License

MIT
