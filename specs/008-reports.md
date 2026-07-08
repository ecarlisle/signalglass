# Spec 008: Reports

## Status

Implemented (offline), Draft (trace views)

## Purpose

Define how Signalglass renders analysis results into human- and machine-readable outputs.

## Scope

- Terminal report.
- JSON report.
- Static HTML report.
- Report contract compliance.

## Non-goals

- Interactive dashboard rendering (see Spec 009).
- Real-time report updates.

## Required files or modules

- `packages/reports/src/terminal.ts`
- `packages/reports/src/json.ts`
- `packages/reports/src/html.ts`
- `packages/reports/src/reports.test.ts`

## Required types or contracts

- `AnalysisResult` from `packages/core`.
- `ContextSmell`, `Recommendation` from `packages/core`.
- Report contract defined in `docs/report-contract.md`.

## Required behavior

- Terminal report is compact and human-readable.
- JSON report is the full `AnalysisResult` serialized.
- HTML report is self-contained, static, and educational.
- All reports include run metadata, token totals, source-type breakdown, turn breakdown, largest blocks, repeated context, smells, and recommendations.
- All reports label token counts as approximate.
- Heuristic smells are labeled as heuristics.
- Future trace reports may add Trace View, Payload View, Story View, and Savings Lens sections.

## Acceptance criteria

- [ ] `renderTerminal(analysis)` contains the run name and input tokens.
- [ ] `renderJson(analysis)` round-trips to the same `AnalysisResult` shape.
- [ ] `renderHtml(analysis)` contains `<html>` and all required sections.
- [ ] Reports do not claim exact token counts.

## Tests

- `packages/reports/src/reports.test.ts`

## References

- `docs/report-contract.md`
- `specs/002-core-domain.md`
