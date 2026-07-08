# Spec 008: Reports

## Status

Implemented (offline + trace reports), Draft (dashboard report views)

## Purpose

Define how Signalglass renders analysis results and stored trace data into human- and machine-readable outputs.

## Scope

- Terminal report for offline analysis (`AnalysisResult`).
- JSON report for offline analysis.
- Static HTML report for offline analysis.
- Terminal report for stored traces (`Trace`).
- JSON report for stored traces.
- HTML report for stored traces.
- Summary/list report for stored traces.
- Report contract compliance.

## Non-goals

- Interactive dashboard rendering (see Spec 009).
- Real-time report updates.
- Streaming report output.

## Required files or modules

- `packages/reports/src/terminal.ts`
- `packages/reports/src/json.ts`
- `packages/reports/src/html.ts`
- `packages/reports/src/traceTerminal.ts`
- `packages/reports/src/traceJson.ts`
- `packages/reports/src/traceHtml.ts`
- `packages/reports/src/traceListSummary.ts`
- `packages/reports/src/reports.test.ts`

## Required types or contracts

- `AnalysisResult` from `packages/core`.
- `Trace` from `packages/core`.
- `ContextSmell`, `Recommendation` from `packages/core`.
- Report contract defined in `docs/report-contract.md`.

## Required behavior

### Offline analysis reports

- Terminal report is compact and human-readable.
- JSON report is the full `AnalysisResult` serialized.
- HTML report is self-contained, static, and educational.
- All reports include run metadata, token totals, source-type breakdown, turn breakdown, largest blocks, repeated context, smells, and recommendations.
- All reports label token counts as approximate.
- Heuristic smells are labeled as heuristics.

### Trace reports

- Terminal trace report renders key trace metadata without raw payloads.
- JSON trace report includes structured fields with token metrics, event type breakdown, and content phase breakdown.
- HTML trace report is self-contained and static.
- Summary/list report shows multiple traces without dumping event payloads.
- Reports do not include:
  - Full raw payloads.
  - API keys or Authorization headers.
  - Bearer tokens, cookie headers, proxy authorization headers, `.env` assignments, or credential-like `storageKey` values.
  - Secrets or credentials.
  - `storageKey` values.
- Redacted excerpts appear only when present and allowed in the stored trace data.
- Privacy disclaimers are included in all report formats.
- Report-bound free-text strings are sanitized before terminal, JSON, HTML, and list output; HTML escaping remains required after sanitization.
- Trace token metrics prefer provider-reported `promptTokens` and `completionTokens`; `totalTokens` may be reported as inference usage but is not counted as output.

## Acceptance criteria

### Offline analysis (existing)

- [x] `renderTerminal(analysis)` contains the run name and input tokens.
- [x] `renderJson(analysis)` round-trips to the same `AnalysisResult` shape.
- [x] `renderHtml(analysis)` contains `<html>` and all required sections.
- [x] Reports do not claim exact token counts.

### Trace reports (new)

- [x] `renderTraceTerminal(trace)` contains trace ID, status, provider, model, event count, timestamps, and token metrics.
- [x] `renderTraceJson(trace)` returns JSON with `trace.id`, `trace.status`, `trace.provider`, `trace.model`, `eventCount`, `eventTypeBreakdown`, and `tokenMetrics`.
- [x] `renderTraceHtml(trace)` contains `<html>` and key trace metadata.
- [x] Report output does not include sensitive metadata values (API keys, auth headers).
- [x] Report output redacts sensitive free-text values, including routing decisions, transformation summaries, excerpts, provider/model/agent/task fields, API keys, bearer tokens, cookies, proxy authorization strings, `.env` assignments, and `storageKey` values.
- [x] Reports do not include `storageKey` values.
- [x] Redacted excerpts appear only when present and allowed in stored trace data.
- [x] Trace token metrics count prompt/input and completion/output separately without treating total tokens as output.
- [x] Summary/list report includes multiple traces without dumping event payloads.
- [x] Existing offline analyze reports still pass unchanged.

## Tests

- `packages/reports/src/reports.test.ts`
  - Trace terminal report renders key metadata.
  - Trace JSON report includes expected fields.
  - Trace HTML report is valid.
  - Reports exclude sensitive metadata.
  - Reports redact sensitive report-bound strings across terminal, JSON, HTML, and list output.
  - Reports exclude storageKey values.
  - Trace token metrics prefer prompt/completion usage and avoid double-counting inference events.
  - Redacted excerpts appear only when present.
  - Summary/list reports include multiple traces.
  - Existing offline reports still pass.
- `packages/cli/src/cli.test.ts`
  - Storage initialization.
  - Trace list on empty storage.

## CLI integration

```bash
signalglass traces --storage <path> list
signalglass traces --storage <path> show <trace-id> [--report terminal|json|html] [--output <file>]
```

- `--storage <path>` is required for trace commands.
- No default storage path is introduced.
- Clear usage errors are printed.
- Existing `analyze` and `ingress` commands are not affected.

## References

- `docs/report-contract.md`
- `specs/002-core-domain.md`
- `specs/007-storage-and-privacy.md`
- `docs/trace-model.md`
- `docs/privacy.md`
