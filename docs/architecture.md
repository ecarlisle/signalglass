# Signalglass architecture

Signalglass is a pnpm monorepo organized around a small, explicit domain model and a pipeline from external run formats to reports.

## High-level data flow

```
External run format
        │
        ▼
┌───────────────────┐
│ @signalglass/parsers │  → normalized AgentRun
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  @signalglass/core   │  → analysis (tokens, smells, recommendations)
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ @signalglass/reports │  → terminal / JSON / HTML
└───────────────────┘
        │
        ▼
┌───────────────────┐
│   @signalglass/cli   │  → command-line entrypoint
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  apps/dashboard     │  → future interactive educational report viewer
└───────────────────┘
```

## Package boundaries

### `@signalglass/core`

Owns the domain model and analysis logic.

Responsibilities:
- Define `AgentRun`, `Turn`, `ContextBlock`, source types, and message/tool-call shapes.
- Provide token estimation with a pluggable estimator interface.
- Aggregate tokens by turn and source type.
- Detect repeated context.
- Detect context smells and generate recommendations.
- Define the `AnalysisResult` contract.

Nothing in core should know about the CLI, parsers, reports, or React UI.

### `@signalglass/parsers`

Converts external run formats into the normalized `AgentRun`.

Responsibilities:
- Implement a generic JSON parser for Signalglass sample runs.
- Provide a clear adapter interface for future parsers (OpenCode, etc.).
- Validate and normalize input without inventing data.

Parsers depend only on `@signalglass/core`.

### `@signalglass/reports`

Renders analysis results into human- and machine-readable outputs.

Responsibilities:
- Terminal report formatter.
- JSON report formatter (full `AnalysisResult`).
- Static HTML report formatter.

Reports depend only on `@signalglass/core`. They do not perform new analysis.

### `@signalglass/cli`

Command-line entrypoint.

Responsibilities:
- Parse arguments.
- Read input files.
- Invoke the parser, analyzer, and selected report formatter.
- Write output to stdout or a file.

The CLI wires together core, parsers, and reports but contains no domain logic of its own.

### `apps/dashboard`

Future interactive educational report viewer.

Responsibilities:
- Display a run as an interactive, educational report.
- Eventually host the planned sections: Run Summary, Context Timeline, Token Breakdown, Context Smells, Evidence Drawer, Recommendations, Run/Model Comparison.
- Stay static-first where possible and consume the same analysis data as the CLI reports.

The dashboard is intentionally minimal today. It exists to validate the data model and leave a clear path for the Observatory UI milestone.

## Design principles

- **Domain-first**: the core model is the source of truth.
- **Observability-first**: analyze before optimizing.
- **Educational**: every finding explains what happened, why it matters, what evidence supports it, and what to inspect or try next.
- **Static-friendly**: CLI reports and HTML output should work without a running server.
- **Explicit over clever**: prefer readable code to abstraction magic.
