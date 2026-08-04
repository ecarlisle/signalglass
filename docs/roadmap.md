# SignalGlass roadmap

SignalGlass follows SemVer and is currently pre-1.0. Minor versions represent milestones. Patch versions contain fixes and small additions within a milestone.

**Direction:** The authoritative target direction is [`docs/architectural-foundation.md`](architectural-foundation.md). This roadmap is directional, not a release ledger, and it is ordered by dependency: **evidence model, capture fidelity, completeness, deterministic measurements, and streaming come before optimization features.** Optimization-oriented functionality (reduction previews, budgets, recommendations as core features) is deferred until the evidence foundation exists.

## Near-term implementation forecast (non-binding)

**Updated:** August 4, 2026

This forecast translates the dependency-ordered roadmap into ten focused implementation slices after the Spec 014 compatibility-projection work in PR #18. It is a planning aid, not an architectural contract, release promise, or change to any specification.

The forecast assumes:

- PR #18 merges by August 7, 2026.
- Work proceeds at approximately one focused implementation PR every 3–5 working days.
- Review findings may change scope, dates, or ordering.
- Slice names and dependency order are stable planning references. GitHub PR numbers are anticipated only and may shift if another PR is opened.
- This documentation-only roadmap PR is expected to occupy #19; therefore the implementation PRs below begin at anticipated #20.

| Slice | Anticipated PR | Forecast window | Planned result |
|---|---:|---|---|
| Analyzer parity | #20 | Aug 7–13 | Complete Spec 014 slice 4 by verifying that canonical-evidence projections preserve the applicable legacy analyzer behavior. |
| Append-only evidence store | #21 | Aug 12–18 | Persist and retrieve canonical records without overwriting authoritative observations. |
| Streaming ingress and trace assembly | #22 | Aug 17–21 | Assemble durable records from requests, response chunks, usage, errors, and lifecycle events. |
| Pi provider-boundary capture | #23 | Aug 20–27 | Enable the first Pi smoke test, initially through stored evidence and JSON/report output. |
| Pi agent, tool, and MCP instrumentation | #24 | Aug 25–Sep 1 | Make Pi testing representative of agent behavior by observing tool calls, MCP activity, context assembly, and provenance. |
| Deterministic measurements | #25 | Aug 28–Sep 4 | Add versioned latency, token, usage, completeness, and cost derivations without changing evidence. |
| Graphify capture adapter | #26 | Sep 2–9 | Observe Graphify-assisted activity as an explicitly labeled experimental condition. |
| Trace query/read API | #27 | Sep 7–11 | Expose stable trace summaries, events, evidence, and measurements to UI consumers. |
| React trace explorer MVP | #28 | Sep 10–17 | Make captured data viewable through a trace list, detail view, timeline, events, and basic measurements. |
| Graphify provenance and comparison UI | #29 | Sep 15–22 | Make Graphify activity visible and comparable with baseline or non-Graphify runs. |

### Forecast capability milestones

| Capability | First useful slice | Forecast availability |
|---|---|---|
| Basic Pi testing | Pi provider-boundary capture (anticipated #23) | Around August 27 |
| Full Pi agent/tool testing | Pi agent, tool, and MCP instrumentation (anticipated #24) | Around September 1 |
| Initial Graphify integration | Graphify capture adapter (anticipated #26) | Around September 9 |
| Data viewable in React | React trace explorer MVP (anticipated #28) | Around September 17 |
| Graphify data visible and comparable in React | Graphify provenance and comparison UI (anticipated #29) | Around September 22 |

“Possible” arrives in stages. The first Pi milestone proves that SignalGlass can observe a real model interaction; the following Pi slice adds agent-level activity. The Graphify adapter captures a separately labeled condition before the React explorer displays it. The final comparison slice connects Graphify provenance to the controlled-comparison experience.

These slices preserve the evidence-first dependency chain: validate compatibility, capture and store evidence, derive measurements, then visualize and compare. Graphify remains an external observed system; SignalGlass does not silently modify its results or place it inside the trusted decision-making path.

## Target roadmap (in dependency order)

### Evidence foundation

Ratify the architectural foundation (done in the realignment docs PR); write
and accept the evidence-model specification (done — [Spec 013](../specs/013-evidence-model.md)
is accepted): interactions, spans, events, capture profiles, and versioning.
[Spec 014 — Evidence primitives](../specs/014-evidence-primitives.md)
(Accepted) defines the additive TypeScript evidence primitives and
compatibility projections before any storage or capture migration;
acceptance authorizes implementation. Slice 1 (the dependency-free
[`@signalglass/evidence`](../packages/evidence/README.md) foundation:
types, validators, parse/serialize, normalization) is implemented;
the compatibility-projection and migration slices remain pending.

- Interaction/span/event model with span parentage (`parentSpanId`) and events attached to spans (`spanId`).
- Evidence records carry an evidence-schema version; derived measurement records carry an algorithm/derivation version plus references to their inputs.
- Capture profiles as separate **collection**, **persistence**, and **export** decisions. A metadata-only profile must not collect full payloads in the first place. A redacted profile may discard content at its declared capture boundary. Full-fidelity capture is explicit, appropriately protected, and never the universal default.
- Legacy v0.x models (`Trace`/`TraceEvent`, `AgentRun`) formally superseded by the accepted evidence-model specification; to be re-framed as projections.

### Deterministic fixtures and negative controls

Deterministic serialized fixtures for the nine normative examples in `docs/evidence-model.md`, fixture-backed positive tests, deterministic negative controls covering status/fidelity/availability, media types/hashes, sequence/duplicates/gaps, and versions/discriminants, retained-byte Base64 fixture coverage, and version-compatibility fixture coverage — implemented per Spec 014 §8.2.

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
