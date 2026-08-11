# SignalGlass architecture

SignalGlass is a pnpm monorepo that supports two complementary modes: **Offline Run Analysis** and **Live Ingress Observability**. Both modes share the same internal domain model so that analysis, smells, recommendations, and reports can be reused.

## High-level data flow

### Offline mode

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
```

### Live mode

```
Client / Agent Tool
        │
        ▼
┌───────────────────┐
│   apps/ingress       │  → OpenAI-compatible ingress server
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ @signalglass/providers│ → provider adapter selection
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ @signalglass/core    │  → Trace / Timeline Events
└───────────────────┘
        │
        ▼
Upstream Provider
        │
        ▼
Response Normalizer
        │
        ▼
┌───────────────────┐
│ @signalglass/storage │  → evidence records + legacy trace data
└───────────────────┘
        │
        ▼
AgentRun conversion → analysis → reports / dashboard
```

A live trace can be converted into an `AgentRun` so the existing analyzer can be reused.

## Package boundaries

### `@signalglass/core`

Owns the domain model and analysis logic.

Responsibilities:
- Define `AgentRun`, `Turn`, `ContextBlock`, source types, and message/tool-call shapes.
- Define `Trace`, `TraceEvent`, and content-phase distinctions for live ingress.
- Provide token estimation with a pluggable estimator interface.
- Aggregate tokens by turn and source type.
- Detect repeated context.
- Detect context smells and generate recommendations.
- Define the `AnalysisResult` contract.

Nothing in core should know about the CLI, parsers, ingress, providers, reports, or React UI.

### `@signalglass/parsers`

Converts external run formats into the normalized `AgentRun`.

Responsibilities:
- Implement a generic JSON parser for SignalGlass sample runs.
- Provide a clear adapter interface for future parsers (OpenCode, etc.).
- Validate and normalize input without inventing data.

Parsers depend only on `@signalglass/core`.

### `@signalglass/providers`

Converts between provider-native request/response formats and the internal SignalGlass trace model.

Responsibilities:
- Define `ProviderConfig`, `ProviderKind`, and the provider adapter interface.
- Implement the current `openai-compatible` adapter and preserve clear extension points for future adapters.
- Resolve API keys from environment variable names.
- Declare provider capabilities and model mappings.

Providers depend only on `@signalglass/core` and must not leak provider shapes into the internal model.

### `@signalglass/storage`

Persists canonical evidence records (append-only) beside the legacy trace storage.

Responsibilities:
- **Append-only evidence store** ([Spec 015](../specs/015-append-only-evidence-store.md)): save and retrieve canonical `EvidenceRecord`s in their own SQLite schema (`evidence_records`, `evidence_storage_meta`, namespaced indices) beside the legacy `traces` / `trace_events` tables. Saves are transactional with exact-text idempotency and structured conflict classification, a mandatory storage-safety gate, explicit `metadata-safe` v1.0.0/v1.1.0 reference-policy selection (Spec 016 S2), and read-integrity verification before trust.
- **Legacy trace storage**: SQLite schema for traces and timeline events; query and export APIs (list traces, fetch trace, convert trace to `AgentRun`).
- Apply capture and retention policies before writing.

Storage depends on `@signalglass/core` (legacy trace model) and `@signalglass/evidence` (canonical record types, validators, serialization) and follows the privacy defaults in `docs/privacy.md`.

### `@signalglass/reports`

Renders analysis results and trace data into human- and machine-readable outputs.

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

### `apps/ingress`

Live ingress server.

Responsibilities:
- Expose an OpenAI-compatible endpoint for agent tools.
- Route requests to the correct upstream provider via `@signalglass/providers`.
- Emit trace and timeline events.
- Apply capture/redaction policies before storage.
- Return a client-compatible response.

`apps/ingress` depends on `@signalglass/providers` and `@signalglass/core`. The CLI optionally wires completed traces to `@signalglass/storage`.

### `apps/dashboard`

Future interactive educational report viewer.

Responsibilities:
- Display a run or trace as an interactive, educational report.
- Host the planned sections: Run Summary, Context Timeline, Token Breakdown, Context Smells, Evidence Drawer, Recommendations, Run/Model Comparison.
- Host the live-ingress views: Trace View, Payload View, Story View, Savings Lens.
- Stay static-first where possible and consume the same analysis data as the CLI reports.

The dashboard is intentionally minimal today. It exists to validate the data model and leave a clear path for the Observatory UI milestone.

## Design principles

- **Domain-first**: the core model is the source of truth.
- **Two modes, one model**: offline runs and live traces both feed `AgentRun`, `ContextBlock`, `ContextSmell`, `Recommendation`, and `AnalysisResult`.
- **Observability-first**: analyze before optimizing.
- **Educational**: every finding explains what happened, why it matters, what evidence supports it, and what to inspect or try next.
- **Privacy-by-default**: live ingress stores metadata, metrics, and redacted excerpts by default. Full raw payloads are opt-in.
- **Provider-agnostic internal model**: OpenAI compatibility is a doorway, not the architecture.
- **Static-friendly**: CLI reports and HTML output should work without a running server.
- **Explicit over clever**: prefer readable code to abstraction magic.
