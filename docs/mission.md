# SignalGlass Mission

SignalGlass helps developers understand what AI agents do with context.

It is an observability and education tool for agent runs, prompts, traces, provider requests, responses, token usage, and privacy boundaries.

SignalGlass is not only a token reduction tool. Token savings matter, but the larger goal is to make agent behavior legible.

## What SignalGlass helps users see

- what the user said
- what the agent sent
- what was transformed
- what was requested upstream
- what was observed from tools and providers
- what was generated
- what was returned
- where tokens were spent
- where context could be improved
- what privacy boundaries were preserved

## Product principles

- Privacy-safe by default
- Raw payloads are not stored or reported in standard mode
- Secrets, API keys, authorization headers, cookies, and `.env` values must not be exposed
- Realized savings must be distinguished from opportunities and recommendations
- Reports should educate, not merely dump data
- Specs should accurately describe implemented behavior
- Human review controls merging

## Design metaphor

SignalGlass uses an observatory metaphor: traces are signals, reports are lenses, and the UI should help users inspect agent behavior without exposing sensitive material.

The metaphor should guide product clarity, but technical documentation should prioritize precision.
