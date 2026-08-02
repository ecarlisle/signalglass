# SignalGlass Architectural Foundation

**Version:** v0.1
**Status:** Approved — authoritative target-direction document.

This document is the canonical statement of where SignalGlass is going. It defines the vision, principles, terminology, high-level architecture, roadmap priorities, boundaries, and the non-modifying measurement plan.

Specifications, ADRs, and other documents that describe the current v0.x implementation (notably the `Trace`/`TraceEvent` and `AgentRun` models and optimization-oriented features) remain accurate records of what exists, but they are **no longer authoritative for the target architecture**. The accepted evidence-model specification ([Spec 013](../specs/013-evidence-model.md)) formally supersedes them; their concepts are to be re-framed as compatibility projections in implementation.

## 1. Vision

SignalGlass is a disciplined observability platform for AI interactions.

Its purpose is to **observe, record, measure, visualize, compare, and replay** AI interactions while preserving the fidelity of what actually happened: application-visible requests, responses, tool activity, and context provenance.

The platform's commitments:

- **Fidelity first.** Preserve the fidelity of application-visible requests, responses, tool activity, and context provenance. Do not rewrite, summarize, compress, deduplicate, optimize, or otherwise change the interactions being measured.
- **Evidence is authoritative.** Captured evidence is the authoritative record of what SignalGlass observed at its declared capture boundary. It does not prove hidden provider behavior or unobserved activity. All metrics, visualizations, and explanations are derived, versioned views over that evidence.
- **Separation of concerns.** Observations, deterministic measurements, and interpretations are kept separate. Mixing them is an architecture violation.
- **Honest boundaries.** Capture boundaries and uncertainty are explicit. SignalGlass does not claim to know hidden provider behavior, and it reports what it could not capture.
- **Tools are observable systems.** MCP, Graphify, retrieval systems, and other tools are treated as independently observable systems with their own capture boundaries, not as opaque subroutines.
- **Optimization is not core.** Prompt optimization and context transformation are explicit experimental conditions or optional analysis — never core behavior and never applied silently.

## 2. Principles

1. **Observe before optimizing.** The first job is to show what an agent actually sent and what came back. Optimization features are optional analysis on top of that foundation.
2. **Preserve what is captured.** The capture path must not transform semantic inputs. Instrumentation may add metadata around evidence; it must not alter the evidence itself.
3. **Evidence → measurement → interpretation.** Evidence records are captured facts. Measurements are deterministic derivations over evidence (token counts, latency, cost, durations). Interpretations are human-facing explanations (smells, recommendations, narrative) that may involve judgment and must be labeled as such.
4. **Captured evidence is authoritative; everything else is derived and versioned.** Captured evidence is the authoritative record of what SignalGlass observed at its declared capture boundary, not proof of hidden provider behavior or unobserved activity. Metrics, visualizations, and explanations must record the versions of the evidence schema and of the algorithms that produced them.
5. **Uncertainty is explicit.** Estimates are labeled estimates. Approximations are labeled approximations. Missing evidence is reported as missing, not silently assumed.
6. **Capture, persistence, and export are separate decisions.** A capture policy is not one switch. Collection, storage, and disclosure each have their own settings, and each must be honored independently.
7. **Full fidelity is explicit, not default.** Full-fidelity capture is opt-in, appropriately protected, and never presented as the universal default. Lower-fidelity profiles may discard content at their declared capture boundary.
8. **Tools are first-class subjects.** MCP servers, retrieval systems, Graphify, and other tools are independently observable systems with documented capture boundaries.
9. **Incremental migration.** The repository is migrated incrementally: new evidence primitives are added beside the current v0.x models, which are retained as legacy/current-state contracts until formally superseded.
10. **Boring, readable engineering.** Types are explicit and domain-focused. Thresholds and heuristics live in named constants. Clever abstraction is avoided.

## 3. Terminology

| Term | Definition |
|---|---|
| **Evidence** | A captured record of what SignalGlass observed at a declared capture boundary: a request, a response, a tool call, a retrieval result, a span lifecycle. Captured evidence is the authoritative record of what was observed; it does not prove hidden provider behavior or unobserved activity. |
| **Interaction** | The enclosing logical AI exchange or task execution being observed (for example, one agent step or one user turn). Model calls, tool calls, MCP calls, and retrieval operations are spans within an interaction, not interchangeable examples of interactions. Exact interaction-boundary rules are deferred to the evidence-model specification. |
| **Span** | A structured, hierarchically organized segment of an interaction (a model call span, a tool span, an MCP call span, a retrieval span). Spans reference a parent span via `parentSpanId`, which establishes span hierarchy. `parentSpanId` does not establish deterministic execution or replay order; ordering requires separately specified sequencing and timing rules (deferred to the evidence-model specification). |
| **Event** | A discrete observed occurrence within a span. Events attach to a span via `spanId`. Neither `parentSpanId` nor `spanId` establishes deterministic execution or replay order; ordering requires separately specified sequencing and timing rules (deferred to the evidence-model specification). |
| **Capture profile** | The declared set of collection, persistence, and export decisions for a capture point (for example, full-fidelity, redacted, metadata-only). Collection, persistence, and export are independent policy stages: metadata-only collection must not collect complete content; collection-time redaction may intentionally prevent sensitive content from entering SignalGlass; persistence may retain less than was transiently observed; export may disclose less than was persisted. Full-fidelity capture is explicit, protected, and not the universal default. |
| **Capture boundary** | The documented limit of what an observer can and cannot see (for example, an HTTP proxy cannot see client-side tool execution). Boundaries and uncertainty are explicit. |
| **Measurement** | A deterministic derivation from evidence (token counts, latency, duration, cost). Measurements record the algorithm/derivation version and references to their inputs. |
| **Derivation** | A versioned transformation of evidence or measurements into a new record (a metric, a projection, a cost figure). Derivations always reference their inputs and their algorithm version. |
| **Interpretation** | A human-facing explanation or judgment derived from measurements and evidence (smells, recommendations, narrative summaries). Interpretations are not measurements and are labeled as such. |
| **Projection** | A derived view of evidence shaped for a purpose (for example, an analysis-friendly run view). The v0.x `Trace` and `AgentRun` models are projections, not canonical evidence records. |
| **Legacy/current-state contract (v0.x)** | A specification or model that accurately describes what the repository currently implements but is no longer authoritative for the target architecture. |

## 4. High-level architecture

The target architecture keeps the existing workspace shape and package boundaries while re-centering the data model.

```text
Capture surfaces                        Evidence core                       Consumers
─────────────────                       ─────────────                       ─────────
OpenAI-compatible ingress  ─┐
Provider adapters          ─┼─►  Evidence records (authoritative)  ─►  Measurements (derived, versioned)
Agent-side capture (future)─┤        │                                    │
Tool/MCP/retrieval          ─┘        ▼                                    ▼
observers (future)            Capture profiles (collection /        Interpretations (optional,
                                persistence / export)                labeled — analysis module)
                                                                          │
                                                                          ▼
                                                                   Reports / CLI / dashboard
                                                                   (renderers of derived views)
```

Key structural decisions:

- **Evidence core** owns the evidence model: interactions, spans, events, capture profiles, and versioned records. It does not know about providers, HTTP, storage, or UI.
- **Measurements are derivations.** Token counts, latency, durations, and cost are computed by versioned derivation functions over evidence. Cost is derived from measured usage multiplied by a **versioned pricing schedule**; it is a deterministic derivation, not a judgment, and it does not live in the optional optimization-analysis module.
- **Interpretations are optional and labeled.** Smells, recommendations, and narrative explanations belong to an optional analysis layer. They never mutate evidence or measurements.
- **Capture surfaces** (the ingress today; agent-side and tool observers in the future) produce evidence and declare their capture profiles and boundaries.
- **Storage** persists evidence and derivations with schema versions and migration support, honoring persistence decisions of the capture profile.
- **Reports, CLI, and dashboard** render derived views. They do not perform analysis.

## 5. Roadmap (directional)

This roadmap is directional, not a release ledger. Milestone names are placeholders for the realignment and are ordered by dependency. Optimization features are deferred until the evidence foundation exists.

1. **Evidence foundation** — architectural foundation ratified; evidence model specification (interactions, spans, events, versioning, capture profiles); legacy v0.x models labeled as projections.
2. **Capture fidelity** — native request/response evidence captured without transformation; capture profiles (full-fidelity, redacted, metadata-only) implemented as separate collection/persistence/export decisions; full-fidelity explicit and protected.
3. **Completeness** — deterministic event ordering; per-interaction and per-event capture-completeness reporting ("captured", "redacted", "truncated", "not captured"); missing evidence reported, never silently assumed.
4. **Deterministic measurements** — token accounting, latency/duration, and cost as versioned derivations over evidence, with algorithm versions and input references; provider-reported vs. locally estimated values distinguished.
5. **Streaming** — transparent streaming capture (SSE passthrough with event extraction), so real agent-harness traffic can be observed without changing it.
6. **Multi-span interactions** — model, tool, MCP, and retrieval spans within one logical interaction, including tool/MCP/retrieval systems as independently observable capture surfaces.
7. **Replay and comparison** — deterministic request reconstruction, reproducible replay configuration and orchestration, and reissuing a recorded request under a declared environment, plus side-by-side comparison of derived measurements. Identical responses cannot be guaranteed because models, providers, tools, external data, and inference may be nondeterministic or may change over time.
8. **Optional analysis** — smells, recommendations, reduction previews, and other optimization-oriented features as a clearly labeled, optional analysis module.

Items previously prioritized as optimization features (reduction previews, budgets, recommendations, savings lenses) are **deferred** until the evidence, capture-fidelity, completeness, and measurement milestones above are in place.

## 6. Boundaries

SignalGlass makes these boundaries explicit:

- **Observation boundary.** Each capture surface observes what crosses its boundary and nothing more. An HTTP proxy observes the wire traffic it proxies; it does not see agent-side tool execution. MCP, retrieval, and Graphify activity are observable only through their own capture surfaces or documented adapters.
- **Fidelity boundary.** Capture must not transform semantic inputs. If a capture surface must parse before forwarding (for example, the current ingress parses request JSON before forwarding), that fact is documented and byte-exact preservation is not claimed until separately verified.
- **Privacy boundary.** Capture, persistence, and export are independent policy stages. Metadata-only collection must not collect complete content; collection-time redaction may intentionally prevent sensitive content from entering SignalGlass; persistence may retain less than was transiently observed; export may disclose less than was persisted. Full-fidelity collection and persistence must be explicit and appropriately protected, and are never the universal default. Redaction is a policy decision at any stage, not solely an export decision.
- **Knowledge boundary.** SignalGlass does not claim to know hidden provider behavior. Provider-reported values are recorded as provider-reported; everything else is labeled as local estimate.
- **Interpretation boundary.** Optimization advice and explanations are interpretations. They are optional, labeled, and never presented as measurements.

## 7. Non-modifying measurement plan

Measurements must be made without modifying the interactions being measured. The plan:

1. **Capture without transformation.** The capture path appends evidence records around interactions; it does not rewrite, summarize, compress, deduplicate, or reorder interaction content. Any transformation that is ever applied to payloads (for example, excerpting under a redacted profile) happens at a declared capture boundary and is recorded as such.
2. **Collect, then measure.** Measurements are computed as derivations over captured evidence. Nothing is measured by mutating the evidence. Measurements do not require evidence to be persisted: reproducible recalculation requires that the necessary evidence and derivation inputs be retained. Lower-fidelity or non-persisting profiles may intentionally limit later recalculation, and that limitation must be represented in completeness or reproducibility metadata. (The concrete schema for such metadata is deferred to the evidence-model specification.)
3. **Versioned derivation records.** Every derived measurement record carries:
   - the algorithm/derivation version that produced it, and
   - references to its inputs (evidence record ids and, where relevant, their versions).
   Raw evidence records carry an **evidence-schema version**; they do not carry a derivation version, because they are not derivations.
4. **Deterministic inputs.** Token accounting, latency, and cost derive from recorded evidence plus explicit, versioned parameters:
   - token counts: provider-reported usage where available, otherwise a named estimation algorithm (versioned);
   - latency/duration: recorded timestamps and clocks at capture;
   - cost: measured usage × a **versioned pricing schedule**. Cost is a deterministic derivation and is part of the measurement layer, not the optional optimization-analysis module.
5. **Completeness and uncertainty.** Derivation outputs state what evidence they used and what was missing. Estimates and approximations are labeled. If evidence is absent, the derivation says so.
6. **No silent optimization.** Optimization or context transformation is only ever an explicit experimental condition or an optional analysis output that the user chooses to act on. It is never applied automatically by core instrumentation.

## 8. Relationship to the current repository

- The current `Trace`/`TraceEvent` model (`packages/core/src/traces.ts`) and the `AgentRun`/`Turn`/`ContextBlock` model (`packages/core/src/types.ts`) describe the v0.x implementation. They remain functional and supported for their current uses, but they are **projections** under this foundation, not canonical evidence records.
- Specifications that describe those models or optimization-oriented behavior are labeled as **legacy/current-state contracts** in `specs/000-index.md`; they will be formally superseded by a later accepted evidence-model specification.
- The workspace, provider adapter boundary, ingress server, storage, reports, CLI, and testing conventions remain the substrate for the target architecture.
- Migration is incremental: new evidence primitives are added beside existing models, with no required rewrite of the current runtime in this phase.

## 9. Governance of this document

- This document is the authoritative target-direction reference. When other documents conflict with it, this document wins unless a newer accepted foundation revision supersedes it.
- The evidence-model specification (future) will define the concrete schema for interactions, spans, events, capture profiles, and versioning. This document deliberately does not finalize those schema fields.
- Changes to the foundation require the same spec-driven review workflow as implementation specifications.
