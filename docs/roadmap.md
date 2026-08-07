# SignalGlass roadmap

SignalGlass follows SemVer and is currently pre-1.0. Minor versions represent milestones. Patch versions contain fixes and small additions within a milestone.

**Direction:** The authoritative target direction is [`docs/architectural-foundation.md`](architectural-foundation.md). This roadmap is directional, not a release ledger, and it is ordered by dependency: **evidence model, capture fidelity, completeness, deterministic measurements, and streaming come before optimization features.** Optimization-oriented functionality (reduction previews, budgets, recommendations as core features) is deferred until the evidence foundation exists.

## Near-term implementation forecast (non-binding)

**Updated:** August 4, 2026

This forecast translates the dependency-ordered roadmap into ten near-term implementation slices after the Spec 014 compatibility-projection work in PR #18, then extends the sequence through a working 1.0 target. It is a planning aid, not an architectural contract, release promise, or change to any specification.

The forecast assumes:

- PR #18 merges by August 7, 2026.
- Near-term work proceeds at approximately one focused implementation PR every 3–5 working days; later integration and hardening slices may require 5–8 working days.
- Review findings may change scope, dates, or ordering.
- Slice names and dependency order are stable planning references. GitHub PR numbers are anticipated only and may shift if another PR is opened.
- Spec 015 is accepted in documentation-only PR #21 and implemented in PR #22.

| Slice | Anticipated PR | Forecast window | Planned result |
|---|---:|---|---|
| Analyzer parity | #20 | Aug 7–13 | **Done** — Spec 014 slice 4: projection parity and loss verification — paired projection gates, analyzer/report parity over the real pipelines, and the loss-and-mapping matrix. Implemented and merged to main in PR #20; see `packages/reports/src/projectionParity.test.ts`, `docs/evidence-projection-matrix.md`, and the executable claim table `packages/core/src/evidenceProjections/projectionMappingMatrix.ts`. |
| Append-only evidence store | #22 | Aug 12–18 | Persist and retrieve canonical records without overwriting authoritative observations. [Spec 015 — Append-only evidence store](../specs/015-append-only-evidence-store.md) is **Implemented — in review** (accepted in documentation PR #21; append-only save/retrieve beside the legacy `TraceStorage`, authoritative identity, exact-text conflict resolution, a mandatory non-bypassable storage-safety gate with a closed deterministic `StorageSafetyCode` taxonomy (S1/S2/S3/S5/S6) and short-circuit retained-bytes rejection, the conservative `metadata-safe` reference persistence policy with field-level content classification aligned to the exact TypeScript shapes, unspoofable reference-policy identity with bounded policy-version metadata, hardened runtime-validated policy decisions, stored-versus-in-memory parity at the serializer snapshot, clock-independent idempotency classification, read integrity verified before any `unsupported-version` result, a dedicated WAL connection with contention contract, atomic initialization with rollback, and a namespaced storage-format ledger). Implemented in PR #22; pending human review/merge. |
| Streaming ingress and trace assembly | #23 | Aug 17–21 | Assemble durable records from requests, response chunks, usage, errors, and lifecycle events. |
| Pi provider-boundary capture | #24 | Aug 20–27 | Enable the first Pi smoke test, initially through stored evidence and JSON/report output. |
| Pi agent, tool, and MCP instrumentation | #25 | Aug 25–Sep 1 | Make Pi testing representative of agent behavior by observing tool calls, MCP activity, context assembly, and provenance. |
| Deterministic measurements | #26 | Aug 28–Sep 4 | Add versioned latency, token, usage, completeness, and cost derivations without changing evidence. |
| Graphify capture adapter | #27 | Sep 2–9 | Observe Graphify-assisted activity as an explicitly labeled experimental condition. |
| Trace query/read API | #28 | Sep 7–11 | Expose stable trace summaries, events, evidence, and measurements to UI consumers. |
| React trace explorer MVP | #29 | Sep 10–17 | Make captured data viewable through a trace list, detail view, timeline, events, and basic measurements. |
| Graphify provenance and comparison UI | #30 | Sep 15–22 | Make Graphify activity visible and comparable with baseline or non-Graphify runs. |

### Forecast capability milestones

| Capability | First useful slice | Forecast availability |
|---|---|---|
| Basic Pi testing | Pi provider-boundary capture (anticipated #24) | Around August 27 |
| Full Pi agent/tool testing | Pi agent, tool, and MCP instrumentation (anticipated #25) | Around September 1 |
| Initial Graphify integration | Graphify capture adapter (anticipated #27) | Around September 9 |
| Data viewable in React | React trace explorer MVP (anticipated #29) | Around September 17 |
| Graphify data visible and comparable in React | Graphify provenance and comparison UI (anticipated #30) | Around September 22 |

“Possible” arrives in stages. The first Pi milestone proves that SignalGlass can observe a real model interaction; the following Pi slice adds agent-level activity. The Graphify adapter captures a separately labeled condition before the React explorer displays it. The final comparison slice connects Graphify provenance to the controlled-comparison experience.

These slices preserve the evidence-first dependency chain: validate compatibility, capture and store evidence, derive measurements, then visualize and compare. Graphify remains an external observed system; SignalGlass does not silently modify its results or place it inside the trusted decision-making path.


### Forecast through 1.0

The working 1.0 target is **January 22, 2027**, with approximately three weeks of uncertainty. For planning purposes, 1.0 means a dependable local/self-hosted observability product that can capture real Pi interactions, preserve canonical evidence, display traces in React, observe Graphify and MCP activity, compare controlled runs, export data safely, and recover predictably from failures. It does not require support for every provider or agent framework.

After the ten near-term slices, the anticipated sequence continues as follows:

| Slice | Anticipated PR | Forecast window | Planned result |
|---|---:|---|---|
| Secure export and explicit redaction workflow | #31 | Sep 21–29 | Complete the initial trace-explorer feature set with safe, reviewable exports. |
| Experiment manifests and declared conditions | #32 | Sep 25–Oct 5 | Make baseline, MCP-assisted, and Graphify-assisted runs formally reproducible. |
| Deterministic comparison engine | #33 | Oct 1–9 | Compare evidence-backed measurements without declaring unsupported winners. |
| React comparison experience | #34 | Oct 7–15 | Make controlled experiments usable through the UI. |
| Replay package and reproducibility metadata | #35 | Oct 13–21 | Reconstruct or reissue captured interactions with visible limitations and declared environments. |
| Second provider adapter | #36 | Oct 19–28 | Demonstrate that the evidence model is provider-neutral. |
| OpenTelemetry export and import | #37 | Oct 26–Nov 4 | Establish initial ecosystem portability. |
| Retention, deletion records, and access boundaries | #38 | Nov 2–11 | Make the evidence privacy lifecycle explicit and testable. |
| Local/self-hosted deployment packaging | #39 | Nov 9–18 | Provide a documented installation and upgrade path. |
| Reliability, recovery, and incomplete-trace handling | #40 | Nov 16–25 | Harden interrupted streams, partial writes, retries, and corrupted inputs. |
| Security and privacy review corrections | #41 | Nov 23–Dec 4 | Verify secret handling, redaction, exports, retention, and safe defaults. |
| Performance and scale qualification | #42 | Dec 1–11 | Establish practical ingestion, trace-size, query, and UI-performance limits. |
| Documentation, onboarding, and example experiments | #43 | Dec 8–18 | Provide a complete guided workflow from Pi capture to React inspection. |
| 1.0 release-candidate preparation | #44 | Dec 14–18 | Enter feature freeze; only release-blocking corrections follow. |
| Release-candidate corrections | #45 | Jan 5–15 | Address defects found during real Pi and Graphify trials. |
| 1.0 release preparation | #46 | Jan 12–22 | Complete versioning, migrations, compatibility notes, final checks, and the 1.0 release. |

The period from **December 19, 2026 through January 8, 2027** is reserved for real-world release-candidate testing and holiday schedule variability. It is not assigned a separate implementation PR.

### Readiness and release gates

The historical v0.x versions below retain their existing meanings. This forecast therefore uses named readiness gates rather than reusing already-delivered version numbers.

| Gate | Forecast date | Meaning |
|---|---:|---|
| Pi capture readiness | August 27, 2026 | First real Pi interaction captured as canonical evidence. |
| Pi and Graphify exploration readiness | September 22, 2026 | Pi and Graphify traces visible and comparable at a basic level in React. |
| Controlled-comparison readiness | October 15, 2026 | Declared experiments and deterministic comparisons usable in React. |
| Local deployment readiness | November 18, 2026 | Documented local/self-hosted packaging is available for evaluation. |
| 1.0 release candidate | December 18, 2026 | Planned feature freeze and start of release qualification. |
| **1.0 working target** | **January 22, 2027** | Stable, documented release under the scoped 1.0 definition above. |

The current confidence range is:

- **Aggressive:** December 18, 2026.
- **Working forecast:** January 22, 2027.
- **Conservative:** February 12, 2027.

Later dates have more uncertainty than the near-term capability milestones because security review, deployment, performance qualification, and real-world trials can reveal cross-cutting work. PR numbers remain anticipated identifiers; slice names and dependency order are the more stable planning references.

## Target roadmap (in dependency order)

### Evidence foundation

Ratify the architectural foundation (done in the realignment docs PR); write
and accept the evidence-model specification (done — [Spec 013](../specs/013-evidence-model.md)
is accepted): interactions, spans, events, capture profiles, and versioning.
[Spec 014 — Evidence primitives](../specs/014-evidence-primitives.md)
(**Implemented** — 27/27 acceptance criteria) defines the additive
TypeScript evidence primitives and compatibility projections before any
storage or capture migration. All four Spec 014 slices are complete:
Slice 1 (the dependency-free [`@signalglass/evidence`](../packages/evidence/README.md)
foundation: types, validators, parse/serialize, normalization), Slice 2
(deterministic fixtures and negative controls), Slice 3 (the compatibility
projections in [`@signalglass/core/src/evidenceProjections/`](../packages/core/src/evidenceProjections/)
— canonical evidence → legacy `Trace`/`TraceEvent` view, legacy
`Trace`/`TraceEvent` → legacy `AgentRun` view, and canonical evidence →
legacy `AgentRun` view), and Slice 4 (projection parity and loss
verification — see “Projection parity and loss verification” below).
Production capture/storage migration belongs to later specifications.

- Interaction/span/event model with span parentage (`parentSpanId`) and events attached to spans (`spanId`).
- Evidence records carry an evidence-schema version; derived measurement records carry an algorithm/derivation version plus references to their inputs.
- Capture profiles as separate **collection**, **persistence**, and **export** decisions. A metadata-only profile must not collect full payloads in the first place. A redacted profile may discard content at its declared capture boundary. Full-fidelity capture is explicit, appropriately protected, and never the universal default.
- Legacy v0.x models (`Trace`/`TraceEvent`, `AgentRun`) formally superseded by the accepted evidence-model specification; re-framed as compatibility projections (implemented in `@signalglass/core/src/evidenceProjections/`; projection parity verified in Spec 014 slice 4; production migration pending).

### Deterministic fixtures and negative controls

Deterministic serialized fixtures for the nine normative examples in `docs/evidence-model.md`, fixture-backed positive tests, deterministic negative controls covering status/fidelity/availability, media types/hashes, sequence/duplicates/gaps, and versions/discriminants, retained-byte Base64 fixture coverage, and version-compatibility fixture coverage — implemented per Spec 014 §8.2.

### Compatibility projections

Canonical `EvidenceRecord` → legacy `Trace`/`TraceEvent` view, legacy `Trace`/`TraceEvent` → legacy `AgentRun` view, and canonical `EvidenceRecord` → legacy `AgentRun` view (as explicit composition) with `ProjectionReport`/`ProjectionIssue`/`ProjectionResult` contracts and explicit loss metadata — implemented beside the legacy types in `@signalglass/core/src/evidenceProjections/` per Spec 014 §8.3. Projected views are ephemeral and non-authoritative; token fields remain unavailable until the deterministic measurement layer lands; production capture/storage migration remains pending in later specifications.

### Projection parity and loss verification

Spec 014 slice 4: paired canonical/legacy fixtures with the exact-equality projection gate (`evidenceToLegacyTrace(record).view === legacyTrace`), analyzer and terminal/JSON/HTML report parity over the real public pipelines with a frozen clock, deterministic IDs asserted, sentinel non-leakage, and the loss-and-mapping matrix in [`docs/evidence-projection-matrix.md`](evidence-projection-matrix.md) (executable claim table `packages/core/src/evidenceProjections/projectionMappingMatrix.ts`) — implemented per Spec 014 §8.4, closing acceptance criteria 1 and 10 (Spec 014 is now **Implemented**, 27/27).

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
