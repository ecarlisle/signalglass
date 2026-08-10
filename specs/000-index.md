# Spec 000: Index

## Status

Accepted

## Purpose

Provide a single directory of implementation specifications for SignalGlass. Each spec defines what a part of the system must contain, how it must behave, and how to verify it.

## Spec status definitions

- **Draft** — proposed but not ready for implementation.
- **Accepted** — ready to implement.
- **Implemented** — implemented and passing tests/build.
- **Legacy/current-state (v0.x)** — an accurate record of the implemented or
  planned v0.x behavior that is no longer authoritative for the target
  architecture and is pending supersession by a newer spec; it is not formally
  Superseded until the replacing spec is accepted. A legacy spec may describe
  implemented behavior (the acceptance criteria are not re-checked) without
  claiming the **Implemented** status definition above.
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

These remain **accurate records of the v0.x state** (implemented for [002](002-core-domain.md), [003](003-offline-analysis.md), and [004](004-trace-model.md); planned for [009](009-dashboard-views.md) and [010](010-insight-evaluation.md)), but they are **no longer authoritative for the target architecture**. [Spec 013 — Evidence model](013-evidence-model.md) (Accepted) is the **canonical evidence contract** and formally supersedes the implemented legacy model contracts [002](002-core-domain.md), [003](003-offline-analysis.md), and [004](004-trace-model.md), which are marked **Superseded** and retained as historical records. [009](009-dashboard-views.md) and [010](010-insight-evaluation.md) remain legacy v0.x drafts: their optimization-oriented concepts are constrained by Spec 013 §11.3, but those specs were never accepted and are not themselves formally superseded. [012](012-versioning-and-releases.md) also references the v0.x `AgentRun`/`Trace` schemas in its public API surface list; those surfaces are pending replacement by the evidence-model specification's contracts.

Infrastructure specifications ([001](001-workspace.md), [005](005-provider-adapters.md), [006](006-ingress-openai-compatible.md), [007](007-storage-and-privacy.md), [008](008-reports.md), [011](011-cli.md)) remain relevant to the target architecture as the substrate for capture, storage, rendering, and tooling, subject to future amendment.

## Specs

| Spec | Title | Status |
|---|---|---|
| [001](001-workspace.md) | Workspace and package layout | Implemented |
| [002](002-core-domain.md) | Core domain model | Superseded by [013](013-evidence-model.md) — historical v0.x record (acceptance criteria unchecked) |
| [003](003-offline-analysis.md) | Offline Run Analysis | Superseded by [013](013-evidence-model.md) — historical v0.x record (acceptance criteria unchecked) |
| [004](004-trace-model.md) | Trace and timeline model | Superseded by [013](013-evidence-model.md) — historical v0.x record |
| [005](005-provider-adapters.md) | Provider adapters | Implemented (OpenAI-compatible), Draft (others) |
| [006](006-ingress-openai-compatible.md) | OpenAI-compatible ingress | Implemented |
| [007](007-storage-and-privacy.md) | Storage and privacy | Implemented |
| [008](008-reports.md) | Reports | Implemented (offline + trace reports), Draft (dashboard report views) |
| [009](009-dashboard-views.md) | Dashboard views | Draft — legacy v0.x (optimization-oriented views) |
| [010](010-insight-evaluation.md) | Insight evaluation | Draft — legacy v0.x (optimization-oriented) |
| [011](011-cli.md) | CLI | Implemented (analyze, ingress, traces) |
| [012](012-versioning-and-releases.md) | Versioning and releases | Accepted — references legacy v0.x public surfaces |
| [013](013-evidence-model.md) | Evidence model | **Accepted — canonical evidence contract** |
| [014](014-evidence-primitives.md) | Evidence primitives | **Implemented (27/27)** — additive TypeScript primitives and compatibility projections for the accepted evidence contract (Spec 013). Slices 1–4 implemented: foundation (`@signalglass/evidence`, dependency-free), deterministic fixtures and negative controls, compatibility projections (`@signalglass/core/src/evidenceProjections/`), and projection parity and loss verification (paired-fixture parity gates, analyzer/report parity, loss-and-mapping matrix). Production capture/storage migration belongs to later specifications, not unfinished Spec 014 work |
| [015](015-append-only-evidence-store.md) | Append-only evidence store | **Implemented** — canonical `EvidenceRecord` persistence beside the legacy `TraceStorage` (append-only save/retrieve, authoritative identity, exact-text conflict resolution, mandatory non-bypassable storage-safety gate with closed deterministic `StorageSafetyCode` taxonomy (S1/S2/S3/S5/S6) and short-circuit retained-bytes rejection, conservative `metadata-safe` reference persistence policy with field-level content classification aligned to the exact TypeScript shapes, unspoofable reference-policy identity with bounded policy-version metadata, hardened runtime-validated policy decisions, stored-versus-in-memory parity at the serializer snapshot, clock-independent idempotency classification, read integrity verified before any `unsupported-version` result, dedicated WAL connection with contention contract, atomic initialization with rollback, namespaced storage-format ledger). Implemented and merged to main in PR #22 |
| [016](016-streaming-ingress-trace-assembly.md) | Streaming ingress and trace assembly | **Draft** — proposed; implementation prohibited until accepted. Defines how the OpenAI-compatible ingress observes a streaming interaction and assembles one canonical `EvidenceRecord` (client request → upstream dispatch → response headers → ordered SSE chunks → usage → finish reason → `[DONE]` → errors/cancellation → lifecycle/completeness declarations), with twenty-three decision blocks: the two-lifecycle separation (client passthrough vs. evidence observation) with the upstream and client-response outcomes modeled as independent closed vocabularies and a complete 5×4 cross-field validity matrix (14 valid cells; 6 impossible pairs rejected at parse), the single-save assembly/persistence boundary with the honest crash limitation, the preserved EvidenceRecord authority model (authoritative `captureBoundary.streaming` facts; `completeness.lifecycle`/`declaredLosses`/`boundaryStatement` deterministic derivations verified at parse), deterministic `seq`/identity ordering (never timestamps or content-hash identity; honest `choiceIndex` identity vs. per-choice `chunkIndex` ordinal), byte/order-transparent backpressured passthrough with no silent frame mutation across four observation layers and encoded-stream transparency via a bounded decoder tee, the full SSE parsing/multi-choice/terminalization matrix with the Spec 014 §4.7 final-event rule (interaction_end only on `completed`), the closed evidence-status vocabulary with declared losses (no fabricated zeros/finish reasons/counts; phase-accurate request-body and pre-dispatch losses; leaf-level request-content ownership; closed role discriminants; declared omitted SSE metadata), honest collection-time privacy with bounded detector-scanned captured content admitted by `metadata-safe` v1.1.0 (per-leaf inspection, never the aggregate status; deterministic 240-code-point cap; **v1.0.0 unchanged — whole-payload event-level authorization, `unknown-additive-field` refusal, v1.1.0 delegating v1.0 admission/classification semantics for 1.0 records with truthful deciding-policy identity**), bounded in-memory assembly via named evidence budgets with a **normative reference snapshot measurement** (`serializeEvidenceRecord` + `utf8Encode` of the complete finalizable snapshot, taken as the **maximum over every valid terminal-suffix alternative** — `completed` is `span_end` + `interaction_end` — with deterministic pre-allocated finalization inputs), the state-dependent **terminal-suffix reservation** (two canonical + two raw slots while `completed` remains possible; one + one after the span closed), **feasible count budgets (`maxRawObservations ≥ maxCanonicalEvents`)**, **atomic observation admission running the actual Spec 014 collapse semantics** (replay = identical canonical projection; same-ID/same-seq divergence = the Spec 014 conflict/collision contract, never a second ordinary event), **first-terminal-wins exhaustion (no candidates after the final event)**, an **exhaustive observation-failure classification matrix** (`record-budget-exceeded` on the internal-observer-failure row; every closed-union member maps exactly once), and the limits serialized under `captureBoundary.streaming.budgets`, the additive 1.1 schema (seven new serialized paths incl. `deltaText`, `responseMeta`, and `choiceIndex`) with preserved genuine 1.0 compatibility (legacy `messages` values never reinterpreted), persistence outcomes matched to the real Spec 015 API (`EvidenceContentionError` → closed environmental code; `policy-crash` removed), package boundaries (proposed network-free `@signalglass/streaming`; provider decoding in `@signalglass/providers`, ingress wiring in `apps/ingress`), and closed public contracts with explicit versioning — 165 test groups (T01–T165) and 74 acceptance criteria (AC1–AC74) with a many-to-many mapping. Drafted in documentation-only PR #23 and revised by documentation-only correction passes (revisions 2 through 10) — forecast only, not accepted |

## Project framing

SignalGlass is a disciplined observability platform for AI interactions. Its current v0.x implementation provides two complementary modes:

1. **Offline Run Analysis** — analyze captured agent runs from JSON, parser inputs, and samples.
2. **Live Ingress Observability** — act as an OpenAI-compatible ingress/proxy that captures traces, timeline events, provider requests/responses, and token usage.

The existing offline analyzer is preserved. Live ingress is added beside it, not as a replacement. Optimization-oriented deliverables (smells, recommendations, savings) are legacy/optional analysis scope under the architectural foundation and are not core behavior; the target architecture separates observations, deterministic measurements, and interpretations.

The v0.x models behind these modes (`AgentRun`, `Trace`/`TraceEvent`) are
targeted to be expressed as compatibility projections over the canonical
evidence model defined by [Spec 013](013-evidence-model.md) (Accepted;
implementation proceeds incrementally through Spec 014). [Spec 014 — Evidence primitives](014-evidence-primitives.md)
(Implemented) defined the additive TypeScript implementation increment of
that contract: canonical evidence primitives beside the existing runtime
model, plus the compatibility projections; its dependency-free foundation
package (`@signalglass/evidence`), the deterministic fixture slice, the
compatibility projections (`@signalglass/core/src/evidenceProjections/`),
and projection parity and loss verification are all implemented. Production
migration of capture/storage pipelines onto canonical evidence belongs to
later specifications.

## References

- `AGENTS.md`
- `docs/architectural-foundation.md`
- `docs/assessments/2026-08-01-current-state.md`
- `docs/architecture.md`
- `docs/roadmap.md`
- `docs/decisions/0002-two-modes.md`
- `docs/decisions/0004-evidence-first.md`
