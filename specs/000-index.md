# Spec 000: Index

## Status

Accepted

## Purpose

Provide a single directory of implementation specifications for SignalGlass. Each spec defines what a part of the system must contain, how it must behave, and how to verify it.

## Spec status definitions

- **Draft** — proposed but not ready for implementation.
- **Accepted** — ready to implement.
- **Implemented** — implemented and passing tests/build.
- **Superseded** — replaced by another spec.

## Spec implementation rules

- Only **Accepted** specs should be implemented.
- A spec may be marked **Implemented** only when its acceptance criteria are satisfied, its required tests exist, and both `pnpm test` and `pnpm build` pass.
- Every spec that requires implementation should define the expected tests and map them to its acceptance criteria.
- Acceptance criteria should be testable whenever possible.
- Specs that introduce or change contracts (public JSON shapes, adapter outputs, report contracts, CLI output, trace schemas, provider config schemas, storage schemas, or redaction behavior) should require fixture or contract tests.
- `pnpm test` and `pnpm build` must pass before committing implementation work.
- Runtime code changes should reference the spec they implement.
- Read `AGENTS.md` and this index before implementing any spec.
- Read the target spec and all docs it references before coding.

## Architectural realignment

SignalGlass is being restarted as a disciplined observability platform for AI interactions. The authoritative target direction is [`docs/architectural-foundation.md`](../docs/architectural-foundation.md) (approved v0.1), and the completed current-state assessment is [`docs/assessments/2026-08-01-current-state.md`](../docs/assessments/2026-08-01-current-state.md).

Under the realignment, the following specifications describe the **legacy/current v0.x implementation**:

- [002](002-core-domain.md) — Core domain model (`AgentRun`/`Turn`/`ContextBlock`).
- [003](003-offline-analysis.md) — Offline Run Analysis (built on `AgentRun` and smell/recommendation interpretation).
- [004](004-trace-model.md) — Trace and timeline model (`Trace`/`TraceEvent`).
- [009](009-dashboard-views.md) — Dashboard views (optimization-oriented views such as the Savings Lens).
- [010](010-insight-evaluation.md) — Insight evaluation (smells, opportunities, recommendations).

These remain **accurate records of the current v0.x state** (implemented for [002](002-core-domain.md), [003](003-offline-analysis.md), and [004](004-trace-model.md); planned for [009](009-dashboard-views.md) and [010](010-insight-evaluation.md)), but they are **no longer authoritative for the target architecture**. They are labeled here as legacy/current-state contracts pending replacement; they are **not yet marked Superseded**. [Spec 013 — Evidence model](013-evidence-model.md) (Draft) is the **current authority for the target architecture**; when it is accepted, it will formally supersede them. [012](012-versioning-and-releases.md) also references the v0.x `AgentRun`/`Trace` schemas in its public API surface list; those surfaces are pending replacement by the evidence-model specification's contracts.

Infrastructure specifications ([001](001-workspace.md), [005](005-provider-adapters.md), [006](006-ingress-openai-compatible.md), [007](007-storage-and-privacy.md), [008](008-reports.md), [011](011-cli.md)) remain relevant to the target architecture as the substrate for capture, storage, rendering, and tooling, subject to future amendment.

## Specs

| Spec | Title | Status |
|---|---|---|
| [001](001-workspace.md) | Workspace and package layout | Implemented |
| [002](002-core-domain.md) | Core domain model | Implemented — legacy v0.x, pending supersession by [013](013-evidence-model.md) (acceptance criteria unchecked) |
| [003](003-offline-analysis.md) | Offline Run Analysis | Implemented — legacy v0.x, pending supersession by [013](013-evidence-model.md) (acceptance criteria unchecked) |
| [004](004-trace-model.md) | Trace and timeline model | Implemented — legacy v0.x, pending supersession by [013](013-evidence-model.md) |
| [005](005-provider-adapters.md) | Provider adapters | Implemented (OpenAI-compatible), Draft (others) |
| [006](006-ingress-openai-compatible.md) | OpenAI-compatible ingress | Implemented |
| [007](007-storage-and-privacy.md) | Storage and privacy | Implemented |
| [008](008-reports.md) | Reports | Implemented (offline + trace reports), Draft (dashboard report views) |
| [009](009-dashboard-views.md) | Dashboard views | Draft — legacy v0.x (optimization-oriented views) |
| [010](010-insight-evaluation.md) | Insight evaluation | Draft — legacy v0.x (optimization-oriented) |
| [011](011-cli.md) | CLI | Implemented (analyze, ingress, traces) |
| [012](012-versioning-and-releases.md) | Versioning and releases | Accepted — references legacy v0.x public surfaces |
| [013](013-evidence-model.md) | Evidence model | **Draft — current authority for the target architecture** |

## Project framing

SignalGlass is a disciplined observability platform for AI interactions. Its current v0.x implementation provides two complementary modes:

1. **Offline Run Analysis** — analyze captured agent runs from JSON, parser inputs, and samples.
2. **Live Ingress Observability** — act as an OpenAI-compatible ingress/proxy that captures traces, timeline events, provider requests/responses, and token usage.

The existing offline analyzer is preserved. Live ingress is added beside it, not as a replacement. Optimization-oriented deliverables (smells, recommendations, savings) are legacy/optional analysis scope under the architectural foundation and are not core behavior; the target architecture separates observations, deterministic measurements, and interpretations.

The v0.x models behind these modes (`AgentRun`, `Trace`/`TraceEvent`) are compatibility projections over the canonical evidence model defined by [Spec 013](013-evidence-model.md).

## References

- `AGENTS.md`
- `docs/architectural-foundation.md`
- `docs/assessments/2026-08-01-current-state.md`
- `docs/architecture.md`
- `docs/roadmap.md`
- `docs/decisions/0002-two-modes.md`
- `docs/decisions/0004-evidence-first.md`
