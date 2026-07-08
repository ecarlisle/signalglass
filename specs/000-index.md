# Spec 000: Index

## Status

Accepted

## Purpose

Provide a single directory of implementation specifications for Signalglass. Each spec defines what a part of the system must contain, how it must behave, and how to verify it.

## Specs

| Spec | Title | Status |
|---|---|---|
| [001](001-workspace.md) | Workspace and package layout | Accepted |
| [002](002-core-domain.md) | Core domain model | Implemented |
| [003](003-offline-analysis.md) | Offline Run Analysis | Implemented |
| [004](004-trace-model.md) | Trace and timeline model | Implemented (types), Accepted (behavior) |
| [005](005-provider-adapters.md) | Provider adapters | Implemented (OpenAI-compatible), Draft (others) |
| [006](006-ingress-openai-compatible.md) | OpenAI-compatible ingress | Draft |
| [007](007-storage-and-privacy.md) | Storage and privacy | Draft |
| [008](008-reports.md) | Reports | Implemented (offline), Draft (trace views) |
| [009](009-dashboard-views.md) | Dashboard views | Draft |
| [010](010-insight-evaluation.md) | Insight evaluation | Draft |
| [011](011-cli.md) | CLI | Implemented (analyze), Draft (ingress/traces) |
| [012](012-versioning-and-releases.md) | Versioning and releases | Accepted |

## Project framing

Signalglass has two complementary modes:

1. **Offline Run Analysis** — analyze captured agent runs from JSON, parser inputs, and samples.
2. **Live Ingress Observability** — act as an OpenAI-compatible ingress/proxy that captures traces, timeline events, provider requests/responses, token usage, transformations, and optimization opportunities.

The existing offline analyzer is preserved. Live ingress is added beside it, not as a replacement.

## References

- `docs/architecture.md`
- `docs/roadmap.md`
- `docs/decisions/0002-two-modes.md`
