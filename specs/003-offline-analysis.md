# Spec 003: Offline Run Analysis

## Status

Implemented

## Purpose

Define how SignalGlass analyzes captured agent runs from files, dumps, and parser inputs.

## Scope

- Generic JSON parser for SignalGlass sample runs.
- OpenCode parser placeholder.
- CLI `analyze` command.
- Terminal, JSON, and HTML report outputs.

## Non-goals

- Live ingress.
- Streaming request/response handling.
- Provider adapter behavior (see Spec 005).

## Required files or modules

- `packages/parsers/src/signalglassJson.ts`
- `packages/parsers/src/opencodePlaceholder.ts`
- `packages/cli/src/cli.ts`
- `packages/reports/src/terminal.ts`
- `packages/reports/src/json.ts`
- `packages/reports/src/html.ts`
- `samples/messy-agent-run.json`

## Required types or contracts

- `AgentRun`, `Turn`, `ContextBlock` from `core`.
- Parser interface: `input: unknown -> AgentRun`.
- CLI interface: `signalglass analyze <file> [--report terminal|json|html] [--output <file>]`.
- Report formatters accept `AnalysisResult` and return a string.

## Required behavior

- The CLI reads a JSON file, parses it into an `AgentRun`, analyzes it, and renders the selected report.
- The generic JSON parser accepts messages, tool calls, and explicit context blocks and normalizes them into `ContextBlock` objects.
- The OpenCode parser placeholder throws `not implemented` until implemented.
- Default report is terminal.
- Reports label token estimates as approximate and heuristic smells as heuristics.

## Acceptance criteria

- [ ] `signalglass analyze samples/messy-agent-run.json` produces a terminal report.
- [ ] `--report json` produces a valid JSON `AnalysisResult`.
- [ ] `--report html --output report.html` produces a self-contained HTML file.
- [ ] The OpenCode parser placeholder is present.

## Tests

- `packages/parsers/src/signalglassJson.test.ts`
- `packages/reports/src/reports.test.ts`
- CLI smoke test via root scripts.

## References

- `docs/roadmap.md` v0.1.0 and v0.2.0
- `docs/report-contract.md`
