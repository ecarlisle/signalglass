# SignalGlass roadmap

SignalGlass follows SemVer and is currently pre-1.0. Minor versions represent milestones. Patch versions contain fixes and small additions within a milestone.

**Direction:** The authoritative target direction is [`docs/architectural-foundation.md`](architectural-foundation.md). This roadmap is directional, not a release ledger, and it is ordered by dependency: **evidence model, capture fidelity, completeness, deterministic measurements, and streaming come before optimization features.** Optimization-oriented functionality (reduction previews, budgets, recommendations as core features) is deferred until the evidence foundation exists.

## Target roadmap (in dependency order)

### Evidence foundation

Ratify the architectural foundation (done in the realignment docs PR); write
and accept the evidence-model specification (done — [Spec 013](../specs/013-evidence-model.md)
is accepted): interactions, spans, events, capture profiles, and versioning.
[Spec 014 — Evidence primitives](../specs/014-evidence-primitives.md)
(Accepted) defines the additive TypeScript evidence primitives and
compatibility projections before any storage or capture migration;
acceptance authorizes implementation, which has not yet begun.

- Interaction/span/event model with span parentage (`parentSpanId`) and events attached to spans (`spanId`).
- Evidence records carry an evidence-schema version; derived measurement records carry an algorithm/derivation version plus references to their inputs.
- Capture profiles as separate **collection**, **persistence**, and **export** decisions. A metadata-only profile must not collect full payloads in the first place. A redacted profile may discard content at its declared capture boundary. Full-fidelity capture is explicit, appropriately protected, and never the universal default.
- Legacy v0.x models (`Trace`/`TraceEvent`, `AgentRun`) formally superseded by the accepted evidence-model specification; to be re-framed as projections.

### Capture fidelity

- Native request/response evidence captured without semantic transformation; byte-exact preservation verified and documented where claimed.
- Capture profiles implemented end-to-end (collection → persistence → export).
- Core instrumentation provably non-modifying; any transformation happens at a declared capture boundary and is recorded as such.

### Completeness

- Deterministic event ordering (sequence numbers).
- Per-interaction and per-event capture-completeness reporting: captured, redacted, truncated, not captured.
- Missing evidence reported explicitly, never silently assumed.

### Deterministic measurements

- Token accounting, latency/duration, and cost as versioned derivations over evidence, with algorithm versions and input references.
- Provider-reported vs. locally estimated values distinguished everywhere.
- Cost derived from measured usage × a versioned pricing schedule, kept in the measurement layer (not the optional analysis module).

### Streaming

- Transparent streaming capture (SSE passthrough with event extraction), so real agent-harness traffic (Pi, OpenCode) can be observed without being changed.

### Multi-span interactions

- Model, tool, MCP, and retrieval spans within one logical interaction.
- MCP, Graphify, retrieval systems, and other tools as independently observable systems with documented capture boundaries.

### Replay and comparison

- Deterministic request reconstruction: reissuing a recorded request under a declared environment, with reproducible replay configuration and orchestration.
- Side-by-side comparison of derived measurements across runs, models, and providers.
- Identical responses cannot be guaranteed: models, providers, tools, external data, and inference may be nondeterministic or may change over time.

### Optional analysis

- Smells, recommendations, savings lenses, and reduction previews as a clearly labeled, **optional analysis module** over measurements and evidence.
- Optimization and context transformation only as explicit experimental conditions or optional analysis — never core behavior.

## Deferred optimization features

The following are **explicitly deferred** until the evidence, capture-fidelity, completeness, deterministic-measurement, and streaming milestones above are in place:

- Reduction previews (v0.9 "Reduction Preview" in the old roadmap).
- Context budgets as core features.
- Recommendations and savings language as core report content (they survive only as legacy/optional analysis output).
- Automatic context rewriting (never core; human-approved at most).

## Current state (v0.x, historical)

The milestones below describe what the v0.x implementation has already delivered. They remain accurate records of current behavior but are **no longer authoritative for the target architecture**; their terminology and priorities predate the architectural foundation.

### v0.1.0 — First Light (delivered)

Offline CLI analyzer for sample/generic run files.

- Normalized run, turn, and context-block schema.
- Generic JSON parser for SignalGlass sample runs.
- Approximate token estimation.
- Terminal and JSON reports.
- Initial context-smell detectors.
- Sample run data and basic tests.

**Success condition:** `signalglass analyze samples/messy-agent-run.json` produces a useful terminal report.

### v0.2.0 — Glass Report (delivered)

Static HTML report generation.

- Self-contained HTML report with summary cards, tables, smells, and recommendations.
- Report contract documented.
- Education-first formatting in HTML output.

### v0.3.0 — Context Smells (delivered)

Richer smell detection with evidence and recommendations.

- Every smell includes what happened, why it matters, evidence, and next steps.
- Heuristic smells are explicitly labeled.
- Recommendations include inspect and try suggestions.
- Smell severity ranking and grouping.

### v0.5.0 — OpenCode Adapter + Ingress Foundation (partially delivered)

Expand input formats and lay the groundwork for live ingress.

- Provider config schema and adapter interface for `openai-compatible`, `anthropic`, `gemini`, `ollama`, `custom`.
- OpenAI-compatible adapter implemented against request/response fixtures.
- OpenCode run parser remains a placeholder.

### v0.6.0 — Observatory UI (foundation delivered)

Interactive dashboard/report viewer for both offline runs and live traces.

- Minimal Vite + React dashboard validating the data model (sample report only).
- Full views (Context Timeline, Evidence Drawer, Payload View, Story View) remain future work and will be reprioritized toward evidence/trace exploration under the target roadmap.

### v0.8.0 — Capture & Storage (delivered)

Local capture/proxy prototype with persistence.

- OpenAI-compatible ingress with trace/timeline capture and provider-error tracing.
- Opt-in SQLite storage for traces, events, metrics, and redacted excerpts.
- Capture remains observability-first: record and report, do not automatically rewrite.
- Privacy and security considerations documented.

## Earlier milestones no longer authoritative

The following older milestone intents have been superseded in priority by the target roadmap above:

- **v0.4.0 — Run Comparison:** comparison is retained but re-scoped under "Replay and comparison" as comparison of derived measurements.
- **v0.7.0 — Budgets:** deferred (optimization-adjacent).
- **v0.9.0 — Reduction Preview:** deferred (optimization).
- **v1.0.0 — Stable Observatory:** retained in spirit (stable schema, CLI, docs, report contract, adapter API) but the 1.0 contract will be defined by the evidence-model specification, not the v0.x schemas.

## Milestone reality check

Some ingress, local storage, and trace-report work originally placed in later milestones has already landed (see the historical section); the target roadmap re-orders what comes next rather than re-describing what exists. `docs/releases/` and `docs/dogfood/` contain accurate historical records of the v0.x alpha.
