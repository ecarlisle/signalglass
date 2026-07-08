# SignalGlass MVP plan

SignalGlass supports two complementary modes:

1. **Offline Run Analysis** — analyze captured runs from JSON or parser inputs.
2. **Live Ingress Observability** — act as an OpenAI-compatible ingress/proxy that captures traces, timeline events, provider requests/responses, token usage, transformations, and optimization opportunities.

See `docs/roadmap.md` for the versioned milestone breakdown.

## Phase 1 — Offline static analyzer (implemented)

- Define core domain models (`AgentRun`, `Turn`, `ContextBlock`, source type).
- Implement approximate token estimation.
- Implement generic JSON parser for SignalGlass sample runs.
- Implement terminal, JSON, and static HTML report formatters.
- Implement initial context-smell detectors and recommendations.
- Add sample run data and basic tests.

Success condition: `signalglass analyze samples/messy-agent-run.json` produces a useful terminal report.

## Phase 2 — More input formats and provider adapter foundation (partially implemented)

- OpenCode run parsing remains future work.
- The provider adapter interface and config schema are implemented.
- The `openai-compatible` provider adapter is implemented using request/response fixtures.
- Broader provider adapters remain future work.

## Phase 3 — Comparison (future)

- Extend the data model to support run comparison.
- Add report views that compare two or more runs across dimensions such as model, provider, agent, task, total tokens, turns, tool calls, repeated context, smells, and patch size.

## Phase 4 — Live ingress / proxy (implemented foundation)

- The OpenAI-compatible non-streaming ingress server is implemented.
- Trace capture covers timeline events, provider request/response metadata, token usage, routing decisions, and provider errors.
- Standard capture defaults to metadata, metrics, event timeline, and redacted excerpts; it does not store full raw payloads.
- Opt-in local SQLite storage for traces and events is implemented.
- Keep observability-first: live ingress is for diagnosis, not automatic rewriting.

## Phase 5 — Optimization assistance (future)

- Add explicit recommendations and optionally generate summaries or diffs that a developer can review before applying.
- Distinguish realized savings from potentially correctable opportunities.
- Any optimization remains human-approved.
