# Signalglass MVP plan

## Phase 1 — Static analyzer (current)

- Define core domain models (run, turn, context block, source type).
- Implement approximate token estimation.
- Implement generic JSON parser for Signalglass sample runs.
- Implement terminal, JSON, and static HTML report formatters.
- Implement initial context-smell detectors.
- Add sample run data and basic tests.

Success condition: `signalglass analyze samples/messy-agent-run.json` produces a useful terminal report.

## Phase 2 — OpenCode parser

- Add a parser for OpenCode run dumps.
- Map OpenCode messages, tool calls, and outputs to Signalglass normalized blocks.
- Keep parser architecture extensible for future formats.

## Phase 3 — Comparison

- Extend the data model to support run comparison.
- Add report views that compare two or more runs across dimensions such as model, provider, agent, task, total tokens, turns, tool calls, repeated context, smells, and patch size.

## Phase 4 — Live capture / proxy

- Explore optional live capture of agent runs.
- Consider a lightweight proxy or instrumentation hook for capturing context as it is sent.
- Keep observability-first: live capture is for diagnosis, not automatic rewriting.

## Phase 5 — Optimization assistance

- Add explicit recommendations and optionally generate summaries or diffs that a developer can review before applying.
- Any optimization remains human-approved.
