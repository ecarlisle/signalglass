# Signalglass roadmap

Signalglass follows SemVer and is currently pre-1.0. Minor versions represent milestones. Patch versions contain fixes and small additions within a milestone.

## v0.1.0 — First Light

A CLI analyzer for sample/generic run files.

- Normalized run, turn, and context-block schema.
- Generic JSON parser for Signalglass sample runs.
- Approximate token estimation.
- Terminal and JSON reports.
- Initial context-smell detectors.
- Sample run data and basic tests.

**Success condition:** `signalglass analyze samples/messy-agent-run.json` produces a useful terminal report.

## v0.2.0 — Glass Report

Static HTML report generation.

- Self-contained HTML report with summary cards, tables, smells, and recommendations.
- Report contract documented.
- Education-first formatting in HTML output.

## v0.3.0 — Context Smells

Richer smell detection with evidence and recommendations.

- Every smell includes what happened, why it matters, evidence, and next steps.
- Heuristic smells are explicitly labeled.
- Recommendations include inspect and try suggestions.
- Smell severity ranking and grouping.

## v0.4.0 — Run Comparison

Compare two or more runs side by side.

- Data model extended for run comparison.
- Compare model, provider, agent, task, tokens, turns, tool calls, repeated context, smells, patch size, and outcome.
- CLI support for comparing runs.
- Comparison report in terminal, JSON, and HTML.

## v0.5.0 — OpenCode Adapter

Parse real OpenCode sessions and logs.

- OpenCode run parser.
- Map OpenCode messages, tool calls, and outputs to Signalglass normalized blocks.
- Adapter interface formalized and documented.
- Tests against real OpenCode samples.

## v0.6.0 — Observatory UI

Interactive dashboard/report viewer.

- Web UI sections: Run Summary, Context Timeline, Token Breakdown, Context Smells, Evidence Drawer, Recommendations.
- Load and visualize analysis JSON in the browser.
- Keep static export path intact.

## v0.7.0 — Budgets

Configurable context budgets.

- Per-run, per-turn, per-source-type, and per-block budgets.
- Budget alerts as smells.
- Default and user-defined budget profiles.

## v0.8.0 — Capture

Local capture/proxy prototype.

- Optional lightweight capture of agent runs as they happen.
- Capture must remain observability-first: record and report, do not automatically rewrite.
- Privacy and security considerations documented.

## v0.9.0 — Reduction Preview

Preview safe context reductions without automatically applying them.

- Suggest reductions (deduplication, trimming, summarization) with estimated token savings.
- Show before/after previews.
- Human approval before any change.

## v1.0.0 — Stable Observatory

Stable schema, CLI, docs, report contract, and adapter API.

- Commitment to backward compatibility after 1.0.
- Stable report contract and parser adapter API.
- Comprehensive documentation and governance.
- Real-world validation across multiple agents and providers.
