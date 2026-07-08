# Signalglass roadmap

Signalglass follows SemVer and is currently pre-1.0. Minor versions represent milestones. Patch versions contain fixes and small additions within a milestone.

The product supports two complementary modes:

1. **Offline Run Analysis** — analyze captured runs from JSON or parser inputs.
2. **Live Ingress Observability** — act as an OpenAI-compatible ingress/proxy that captures traces, timeline events, provider requests/responses, token usage, transformations, and optimization opportunities.

Both modes feed the same internal domain model. A live trace can be converted into an `AgentRun` so the existing analyzer can be reused.

## Milestones

### v0.1.0 — First Light

Offline CLI analyzer for sample/generic run files.

- Normalized run, turn, and context-block schema.
- Generic JSON parser for Signalglass sample runs.
- Approximate token estimation.
- Terminal and JSON reports.
- Initial context-smell detectors.
- Sample run data and basic tests.

**Success condition:** `signalglass analyze samples/messy-agent-run.json` produces a useful terminal report.

### v0.2.0 — Glass Report

Static HTML report generation.

- Self-contained HTML report with summary cards, tables, smells, and recommendations.
- Report contract documented.
- Education-first formatting in HTML output.

### v0.3.0 — Context Smells

Richer smell detection with evidence and recommendations.

- Every smell includes what happened, why it matters, evidence, and next steps.
- Heuristic smells are explicitly labeled.
- Recommendations include inspect and try suggestions.
- Smell severity ranking and grouping.

### v0.4.0 — Run Comparison

Compare two or more runs side by side.

- Data model extended for run comparison.
- Compare model, provider, agent, task, tokens, turns, tool calls, repeated context, smells, patch size, and outcome.
- CLI support for comparing runs.
- Comparison report in terminal, JSON, and HTML.

### v0.5.0 — OpenCode Adapter + Ingress Foundation

Expand input formats and lay the groundwork for live ingress.

- OpenCode run parser.
- Map OpenCode messages, tool calls, and outputs to Signalglass normalized blocks.
- Adapter interface formalized and documented.
- Provider config schema and adapter interface for `openai-compatible`, `anthropic`, `gemini`, `ollama`, `custom`.
- Tests against real OpenCode samples and OpenAI request/response fixtures.

### v0.6.0 — Observatory UI

Interactive dashboard/report viewer for both offline runs and live traces.

- Web UI sections: Run Summary, Context Timeline, Token Breakdown, Context Smells, Evidence Drawer, Recommendations.
- Live-ingress views: Trace View, Payload View, Story View, Savings Lens.
- Load and visualize analysis JSON and trace JSON in the browser.
- Keep static export path intact.

### v0.7.0 — Budgets

Configurable context budgets.

- Per-run, per-turn, per-source-type, and per-block budgets.
- Budget alerts as smells.
- Default and user-defined budget profiles.

### v0.8.0 — Capture & Storage

Local capture/proxy prototype with persistence.

- Optional lightweight capture of agent runs as they happen.
- SQLite storage for traces, events, metrics, and redacted excerpts.
- Capture must remain observability-first: record and report, do not automatically rewrite.
- Privacy and security considerations documented.

### v0.9.0 — Reduction Preview

Preview safe context reductions without automatically applying them.

- Suggest reductions (deduplication, trimming, summarization) with estimated token savings.
- Show before/after previews.
- Human approval before any change.
- Distinguish realized savings from potentially correctable opportunities.

### v1.0.0 — Stable Observatory

Stable schema, CLI, docs, report contract, and adapter API.

- Commitment to backward compatibility after 1.0.
- Stable report contract, trace schema, and parser/provider adapter API.
- Comprehensive documentation and governance.
- Real-world validation across multiple agents and providers.
