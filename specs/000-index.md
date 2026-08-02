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

## Architectural authority

The current authority for the target architecture is **[Spec 013 — Evidence model](013-evidence-model.md)** (Draft) together with the [Architectural Foundation](../docs/architectural-foundation.md) (v0.1) and [ADR 0004](../docs/decisions/0004-evidence-first.md). Spec 013 defines the canonical, provider-neutral evidence model and supersedes the legacy v0.x model specs below. Legacy specs remain as historical records of the implemented v0.x model and are not deleted. Acceptance of 013 finalizes this supersession; the authority boundary is unambiguous now.

## Specs

| Spec | Title | Status |
|---|---|---|
| [001](001-workspace.md) | Workspace and package layout | Implemented |
| [002](002-core-domain.md) | Core domain model | Superseded (by [013](013-evidence-model.md)); legacy v0.x |
| [003](003-offline-analysis.md) | Offline Run Analysis | Superseded (by [013](013-evidence-model.md)); legacy v0.x |
| [004](004-trace-model.md) | Trace and timeline model | Superseded (by [013](013-evidence-model.md)); legacy v0.x |
| [005](005-provider-adapters.md) | Provider adapters | Implemented (OpenAI-compatible), Draft (others) |
| [006](006-ingress-openai-compatible.md) | OpenAI-compatible ingress | Implemented |
| [007](007-storage-and-privacy.md) | Storage and privacy | Implemented |
| [008](008-reports.md) | Reports | Implemented (offline + trace reports), Draft (dashboard report views) |
| [009](009-dashboard-views.md) | Dashboard views | Draft (legacy v0.x; see [013](013-evidence-model.md) §12) |
| [010](010-insight-evaluation.md) | Insight evaluation | Draft (legacy v0.x; see [013](013-evidence-model.md) §7–8) |
| [011](011-cli.md) | CLI | Implemented (analyze, ingress, traces) |
| [012](012-versioning-and-releases.md) | Versioning and releases | Accepted |
| [013](013-evidence-model.md) | Evidence model | **Draft — current authority for the target architecture** |

## Project framing

SignalGlass has two complementary modes:

1. **Offline Run Analysis** — analyze captured agent runs from JSON, parser inputs, and samples.
2. **Live Ingress Observability** — act as an OpenAI-compatible ingress/proxy that captures traces, timeline events, provider requests/responses, token usage, transformations, and optimization opportunities.

The existing offline analyzer is preserved. Live ingress is added beside it, not as a replacement.

The v0.x models behind these modes (`AgentRun`, `Trace`/`TraceEvent`) are compatibility projections over the canonical evidence model defined by [Spec 013](013-evidence-model.md).

## References

- `AGENTS.md`
- `docs/architecture.md`
- `docs/roadmap.md`
- `docs/decisions/0002-two-modes.md`
