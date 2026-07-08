# Signalglass MVP plan

Signalglass supports two complementary modes:

1. **Offline Run Analysis** — analyze captured runs from JSON or parser inputs.
2. **Live Ingress Observability** — act as an OpenAI-compatible ingress/proxy that captures traces, timeline events, provider requests/responses, token usage, transformations, and optimization opportunities.

See `docs/roadmap.md` for the versioned milestone breakdown.

## Phase 1 — Offline static analyzer (current)

- Define core domain models (`AgentRun`, `Turn`, `ContextBlock`, source type).
- Implement approximate token estimation.
- Implement generic JSON parser for Signalglass sample runs.
- Implement terminal, JSON, and static HTML report formatters.
- Implement initial context-smell detectors and recommendations.
- Add sample run data and basic tests.

Success condition: `signalglass analyze samples/messy-agent-run.json` produces a useful terminal report.

## Phase 2 — More input formats and provider adapter foundation

- Add a parser for OpenCode run dumps.
- Map OpenCode messages, tool calls, and outputs to Signalglass normalized blocks.
- Design the provider adapter interface and config schema.
- Implement the `openai-compatible` provider adapter using request/response fixtures.

## Phase 3 — Comparison

- Extend the data model to support run comparison.
- Add report views that compare two or more runs across dimensions such as model, provider, agent, task, total tokens, turns, tool calls, repeated context, smells, and patch size.

## Phase 4 — Live ingress / proxy

- Build an OpenAI-compatible ingress server.
- Capture traces, timeline events, provider request/response metadata, token usage, and routing decisions.
- Default to metadata, metrics, event timeline, and redacted excerpts; do not store full raw payloads by default.
- Add SQLite storage for traces and events.
- Keep observability-first: live ingress is for diagnosis, not automatic rewriting.

## Phase 5 — Optimization assistance

- Add explicit recommendations and optionally generate summaries or diffs that a developer can review before applying.
- Distinguish realized savings from potentially correctable opportunities.
- Any optimization remains human-approved.
