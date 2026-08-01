# SignalGlass Current-State Architectural Assessment

**Date:** 2026-08-01
**Basis:** read-only inspection of `main` at `a3a9737` (clean tree, 43 commits), plus the completed assessment reported on this date.
**Purpose:** preserved as repository evidence for the architectural realignment. This version incorporates the corrections agreed for the realignment: measurements vs. interpretations, versioning rules, span/event parentage, capture-policy decomposition, conservative ingress fidelity claims, and legacy labeling of v0.x specifications.

## Evidence labeling

Findings are labeled with:

- **[FACT]** — confirmed by reading the current code, schema, tests, or committed documents.
- **[INFERENCE]** — concluded from the implementation, not directly stated anywhere.
- **[RECOMMENDATION]** — a proposed disposition or next step.

Where code and documentation disagree, the current code is treated as evidence of behavior and the disagreement is called out.

**Validation limitation:** `node_modules` is absent, so `pnpm test` and `pnpm build` could not be executed during this assessment. Test/validation claims are based on reading test files and the validation recorded in `docs/releases/v0.1.0-alpha.3.md` (168 tests across 12 files). No CI exists (no `.github/`); validation is manual.

## Executive conclusion

[FACT] The repository contains a coherent, working v0.x implementation: a pnpm monorepo with eight packages/apps, an offline analyzer, an OpenAI-compatible ingress, SQLite trace storage, terminal/JSON/HTML reports, privacy/redaction layers with strong regression tests, and a spec-driven process with ADRs.

[FACT] The canonical domain models — `Trace`/`TraceEvent` (`packages/core/src/traces.ts`) and `AgentRun`/`Turn`/`ContextBlock` (`packages/core/src/types.ts`) — represent one non-streaming chat-completion exchange (Trace) or a normalized turn/block structure (AgentRun). Neither is an evidence record.

[INFERENCE] The architecture does not require a wholesale rewrite. The migration is substantial in the **domain model and capture surface**, not the scaffolding.

[RECOMMENDATION] Retain the repository. Introduce evidence primitives beside the v0.x models (incremental migration), treat `Trace`/`AgentRun` as projections, move interpretations to an optional analysis module, keep measurements (including cost) as deterministic derivations in the measurement layer, and harden the ingress for streaming and span capture.

## Repository map

| Path | Responsibility | Depends on | Disposition |
|---|---|---|---|
| `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`, `vitest.config.ts` | Monorepo orchestration, shared TS config, test aliases | — | keep |
| `packages/core` | Domain types (`AgentRun`, `Trace`, `TraceEvent`), token estimator, smells, recommendations, analyzer, redaction helpers | none | refactor (evidence model moves to a new home; analysis becomes optional) |
| `packages/parsers` | Offline run parsers (SignalGlass JSON; OpenCode placeholder throwing) | core | keep (offline mode) |
| `packages/providers` | `ProviderConfig`, `ProviderAdapter` interface, OpenAI-compatible adapter, Anthropic placeholder | core | keep and harden |
| `apps/ingress` | OpenAI-compatible HTTP proxy; trace assembly; provider forwarding | providers, core | keep and harden (streaming, spans, envelopes, clocks) |
| `packages/storage` | SQLite persistence for traces/events; sanitization; retention | core, better-sqlite3 | refactor (schema versions, evidence tables, missing `actor` column) |
| `packages/reports` | Terminal/JSON/HTML formatters for runs and traces | core | keep (renderers of derived views) |
| `packages/cli` | `analyze`, `ingress`, `traces` commands; wires packages | core, ingress, parsers, reports, storage | keep |
| `apps/dashboard` | Minimal Vite+React viewer of a hard-coded fixture | react, react-dom | refactor (reprioritize toward evidence/trace exploration) |
| `samples/messy-agent-run.json` | Offline analyzer sample designed to trigger smells | — | keep (offline fixture) |
| `docs/`, `specs/`, `docs/decisions/` | Spec-driven process; 12 specs; 3 ADRs; roadmap | — | amend/label legacy (this PR) |

[FACT] Dependency facts: `@signalglass/storage` is only a devDependency of `apps/ingress` (the CLI wires storage, not the ingress). `vitest.config.ts` aliases `core`, `parsers`, `providers`, `reports` to `src` but not `storage`/`ingress`, which resolve through package exports to `dist`. No linter is configured.

## Current execution and data flow

**Offline mode.** [FACT] `packages/cli/src/cli.ts` → `analyze <file>` → `parseSignalglassJson` (`packages/parsers/src/signalglassJson.ts`) → `AgentRun` → `analyzeRun` (`packages/core/src/analyzer.ts`) → `AnalysisResult` → `renderTerminal`/`renderJson`/`renderHtml` (`packages/reports/src/`). `analyzeRun` re-estimates every block's tokens via `estimateTokens(b.content)` (char/4 approximation, `packages/core/src/tokenEstimator.ts`), aggregates by turn/source type, runs `detectRepeatedBlockGroups` (`repeated.ts`, exact `sourceType::content` match), 10 smell detectors (`smells.ts`), and a static recommendation map (`recommendations.ts`).

**Live mode.** [FACT] `ingress` command → `loadConfig` (`apps/ingress/src/config.ts`, strict validation) → `startIngressServer` (`server.ts`). `POST /v1/chat/completions` → `readJsonBody` (10 MB limit, 413) → `selectProvider` (`routing.ts`) → `resolveProviderApiKey` (env var only) → `openaiAdapter.normalizeRequest` → `forwardToUpstream` (`forward.ts`) → `normalizeResponse` → trace assembled in memory with `mode: 'standard'` and a fresh standard capture policy → `onTrace` → optional `TraceStorage.saveTrace`. Upstream non-2xx/invalid-body/failure → `provider_error` event + normalized error envelope plus `x-signalglass-trace-id`.

[FACT — conservative fidelity note] The ingress does **not** forward request bytes exactly. `server.ts` parses the request body with `JSON.parse` (`readJsonBody`) and `forward.ts` re-serializes it with `JSON.stringify(requestBody)` before sending upstream; the upstream response is likewise parsed and re-serialized to the client. Byte-exact preservation is therefore not claimed; whether raw-byte behavior is needed or achievable is deferred to separate verification.

**Trace → analysis.** [FACT] `traceToAgentRun` (`packages/core/src/traceToAgentRun.ts`) groups events into turns on `egress_response` boundaries, maps events to `ContextBlock`s (control events become empty `unknown` blocks; content-bearing events without an excerpt are dropped), and sanitizes trace metadata.

**Storage.** [FACT] `TraceStorage` (`packages/storage/src/storage.ts`) — `traces` + `trace_events` tables, FK cascade, `expires_at` retention, `sanitizeTraceForStorage` (`redaction.ts`) re-redacts on write. Reports re-sanitize at render (`reports/src/sanitize.ts`).

## Findings by subsystem

### 1. Workspace and tooling (spec 001 — Implemented, matches docs)

- **Behavior:** [FACT] pnpm monorepo, `apps/*` + `packages/*`, `onlyBuiltDependencies` for `better-sqlite3`/`esbuild`, ES2022 NodeNext strict TS, Vitest with partial src aliasing.
- **Evidence:** `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`.
- **Conflicts:** [FACT] No CI; no linter; vitest alias coverage inconsistent.
- **Disposition:** [RECOMMENDATION] keep.
- **Assets:** [FACT] workspace graph, spec-driven process, `.pi/prompts/*` workflow prompts — all reusable.

### 2. Core domain: `AgentRun`/`Turn`/`ContextBlock` (spec 002 — status claims Implemented)

- **Behavior:** [FACT] `types.ts` — `AgentRun`, `Turn`, `ContextBlock`; `SourceType` taxonomy in `sourceTypes.ts` (15 values); parser normalizes run dumps into blocks; analyzer produces `AnalysisResult`.
- **Docs mismatch:** [FACT] Spec 002 is marked **Implemented** in `specs/000-index.md`, but all three acceptance criteria checkboxes are unchecked, including "`analyzeRun` returns all fields required by `docs/report-contract.md`". Spec 003 shows the same pattern. This violates the spec process's own rule ("A spec may be marked Implemented only when its acceptance criteria are satisfied").
- **Fidelity:** [FACT] `ContextBlock.content` is normalized block content; token counts are char/4 re-estimates; `estimatedTokens` from a live trace are overridden by `analyzeRun` re-estimation, so provider-reported numbers never reach the offline analysis path.
- **Observation/measurement/interpretation:** [FACT] Mixed. The model stores content (observation), estimates tokens (measurement), and the analyzer immediately derives smells/recommendations (interpretation) with no separate derivation layer.
- **Disposition:** [RECOMMENDATION] move to an optional analysis projection; demote from canonical.
- **Assets:** [FACT] `SourceType` taxonomy as a projection-level classification; repeated-content exact-hash detection; analyzer structure; `analyzer.test.ts`, `smells.test.ts`.

### 3. Trace / TraceEvent model (spec 004 — matches its own docs; wrong canonical model for the target)

- **Behavior:** [FACT] `traces.ts` — `Trace` (one provider exchange), `TraceEvent`, `CapturePolicy` (minimal/standard/debug), `PayloadReference`, `SavingsOpportunity`. `traceToAgentRun` conversion.
- **Native envelope preserved before normalization?** [FACT] No. The raw request is parsed and excerpted to ≤240 redacted chars by the adapter (`openaiAdapter.ts` `makePayloadRef`); the upstream response is buffered for the client but only excerpts/metadata enter the trace. `storageKey` full-payload refs are stripped in standard mode.
- **What does the Trace represent?** [FACT] One non-streaming chat-completion exchange, per `docs/trace-model.md` ("The current ingress emits one trace per `/v1/chat/completions` request").
- **Multiple model/MCP/retrieval/tool spans?** [FACT] No. Flat `events[]`; `parentEventId` exists but is never populated by the adapter or ingress; `tool_call`/`tool_result` event types are defined but never emitted by any adapter; MCP/retrieval/Graphify are absent.
- **Deterministic event ordering?** [INFERENCE] Order is array order in memory; storage reads `ORDER BY timestamp` (`storage.ts` `getTrace`), which is nondeterministic for same-millisecond events. No sequence number.
- **Wall-clock vs. monotonic vs. overhead?** [FACT] Only wall-clock ISO timestamps (`startedAt`, `endedAt`, event `timestamp`). No durations, no monotonic clock, no instrumentation-overhead recording, no upstream latency measurement.
- **Schema/derivation versions?** [FACT] None on any record. SQLite has no schema-version table or migration framework.
- **Evidence recalculable into measurements later?** [INFERENCE] Partially: provider-reported tokens are retained in `inference` event metadata (`promptTokens`/`completionTokens`/`totalTokens`) and used by trace reports, but `traceToAgentRun` collapses them into `turn.metadata` and the analyzer re-estimates input from excerpts, so provider-reported input counts do not survive to `AnalysisResult.totalInputTokens`.
- **Provider-reported vs. estimated distinguishable?** [FACT] In trace reports, yes (`traceMetrics.ts` prefers `promptTokens`/`completionTokens`; `approximate: true` always). In the analysis path, no.
- **Cost as versioned derivation?** [FACT] Absent. `ProviderModelConfig.pricing` (`providers/src/types.ts`) is validated in `apps/ingress/src/config.ts` but never used to compute cost.
- **Context sources/contributions explicit?** [INFERENCE] Source-type classification exists per block, but there is no provenance record (which retrieval source, which file rule, which MCP call contributed which block).
- **Completeness/dropped evidence?** [FACT] Not reported. There is no "captured vs. omitted" marker; a missing `payloadRef` is indistinguishable from a never-captured payload.
- **Privacy preventing full-fidelity claims?** [FACT] Yes, by design. Standard mode truncates to 240 chars, and the ingress can only ever use standard mode (see subsystem 5).
- **External tool execution observed?** [FACT] No. Only tool definitions in the request are captured (`context/requested` events). Agent-side tool execution (including MCP tools) is invisible; assistant `tool_calls` in responses are ignored by `normalizeResponse` (it only reads `message.content`).
- **Disposition:** [RECOMMENDATION] replace through migration as the canonical model; demote `Trace` to a derived projection. Under the foundation, event/span parentage uses spans (`parentSpanId`) with events attached to a span via `spanId`; detailed schema fields are deferred to the future evidence-model specification.
- **Migration dependencies:** [FACT] storage schema, reports, `traceToAgentRun`, adapter contract, and CLI trace commands all assume the current `Trace` shape.

### 4. Provider adapters (spec 005 — OpenAI Implemented, others Draft)

- **Behavior:** [FACT] `openaiAdapter.ts` normalizes request/response JSON into `TraceEvent[]`. `buildUpstreamRequest`/`buildClientResponse` are optional interface members and are not implemented — `server.ts` forwards the raw body and returns the raw upstream body; the adapter is used only for event emission. `anthropicPlaceholder.ts` throws.
- **Alignment:** [INFERENCE] The adapter boundary (provider shapes translated to internal model, never the reverse) matches ADR 0003 and the target direction.
- **Fidelity gaps:** [FACT] Excerpt-first capture (240 chars); no `tool_call`/`tool_result` emission; no streaming; content phases are assigned from wire data — user messages get `said` even though they are what arrived in the request body, so `said` vs. `sent` is nominal, not actual intent capture; `size` is char length, not bytes.
- **Disposition:** [RECOMMENDATION] keep and harden (streaming normalization, tool-call events, envelope capture under a full-fidelity profile).
- **Assets:** [FACT] adapter interface, config types, fixture-driven tests (`openaiAdapter.test.ts`, fixtures in `packages/providers/src/fixtures/`).

### 5. Ingress/proxy capture (spec 006 — Implemented, matches docs)

- **Behavior:** [FACT] non-streaming OpenAI-compatible proxy; strict config validation; 10 MB body limit; env-var API keys; normalized error envelopes; `provider_error` tracing; one trace per request; capture policy hardcoded to `standard` in `assembleTrace` (`server.ts`) — `minimal`/`debug` modes are unreachable in live operation, and the config file has no `capturePolicy` section.
- **Byte fidelity:** [FACT] The request is parsed (`JSON.parse`) before forwarding and re-serialized (`JSON.stringify`) upstream; the response is likewise re-serialized to the client. Exact byte preservation is not claimed (see correction note above).
- **Alignment:** [INFERENCE] The proxy architecture is the right capture surface for the target, but it currently changes/omits evidence: captures only excerpts, measures no latency, drops tool calls, and breaks on `stream: true` (buffered SSE fails the JSON-object check → `provider_error`/502).
- **Disposition:** [RECOMMENDATION] keep and harden.
- **Assets:** [FACT] routing, config validation, error-envelope behavior, body-limit handling, `onTrace` seam, and `server.test.ts` (24 tests incl. secret-leak regression).

### 6. Storage (spec 007 — Implemented, matches docs)

- **Behavior:** [FACT] SQLite `traces`/`trace_events`, FK cascade, `expires_at` retention (`deleteExpiredTraces`), `sanitizeTraceForStorage` defense-in-depth, capture-policy round-trip.
- **Fidelity losses:** [FACT] **`TraceEvent.actor` is not a column** — `insertEvent`/`reconstructTrace` omit it, so actor identity is silently dropped on persistence. No schema version/migration table (DDL is `CREATE TABLE IF NOT EXISTS`). No sequence column.
- **Disposition:** [RECOMMENDATION] refactor — evidence tables, actor column, sequence numbers, `schema_version` + migration framework; keep current tables readable during transition.
- **Assets:** [FACT] retention logic, sanitization layer, `storage.test.ts` (911 lines, 47 tests).

### 7. Reports (spec 008 — Implemented)

- **Behavior:** [FACT] offline terminal/JSON/HTML; trace terminal/JSON/HTML; list summaries; `traceMetrics.ts` token accounting (provider-preferred, no double-counting of `inference`); sanitization on every path; privacy disclaimers.
- **Alignment:** [INFERENCE] Renderers are cleanly separated from analysis and label estimates; well positioned to render derived, versioned views.
- **Disposition:** [RECOMMENDATION] keep (adapt contracts to the new model; they are renderers, not interpretation).
- **Assets:** [FACT] token-metrics logic, sanitization, HTML escaping, privacy disclaimers, `reports.test.ts` (583 lines, 25 tests).

### 8. CLI (spec 011 — Implemented)

- **Behavior:** [FACT] `analyze`/`ingress`/`traces` commands; thin wiring; usage errors; port validation.
- **Disposition:** [RECOMMENDATION] keep.

### 9. Dashboard (spec 009 — Draft)

- **Behavior:** [FACT] `apps/dashboard/src/App.tsx` renders a hard-coded `fixtures/sample-analysis.json` with summary cards (incl. "Repeated context %"), token-by-source table, smell cards, and recommendation cards. The planned nav is a static list. No trace view, payload view, story view, or real evidence drawer. No tests; build-only.
- **Alignment conflict:** [FACT] The dashboard emphasizes optimization (duplicate ratio, smells, recommendations) over trace exploration and cannot load a live trace.
- **Disposition:** [RECOMMENDATION] refactor (reprioritize toward evidence/trace exploration; move the Savings Lens to optional analysis).
- **Assets:** [FACT] static-first approach, severity styling, smell-card component pattern.

### 10. Privacy/redaction (cross-cutting)

- **Behavior:** [FACT] Three layers — `core/privacy.ts` regex redaction, `storage/redaction.ts` recursive sanitization, `reports/sanitize.ts` report-bound strings; plus `traceToAgentRun`'s `sanitizeTraceMetadata`.
- **Assessment:** [FACT] Strong defense-in-depth, genuinely preservable. [INFERENCE] But redaction is **capture-time**, not **profile-based**: the adapter redacts before the excerpt is created, so raw evidence is never available to later profiles. [RECOMMENDATION] Under the foundation, capture, persistence, and export are independent policy stages: metadata-only collection must not collect complete content; collection-time redaction may intentionally prevent sensitive content from entering SignalGlass; persistence may retain less than was transiently observed; export may disclose less than was persisted; full-fidelity capture is explicit, protected, and not the universal default.

### 11. Token / latency / cost / savings

- Tokens: [FACT] char/4 approximation, labeled approximate everywhere; provider-reported usage on `inference` events used by trace reports; analyzer re-estimates.
- Latency: [FACT] absent — no duration anywhere (only `Date.now`-based id generators).
- Cost: [FACT] absent — `pricing` config validated but unused.
- Savings: [FACT] `SavingsOpportunity` type exists but is never produced by any detector; recommendations carry unused `potentialSavings?`. The savings vocabulary is aspiration only.
- **[RECOMMENDATION — correction]:** Cost is a deterministic derivation (measured usage × versioned pricing schedule) and belongs in the measurement/derivation layer, **not** in the optional optimization-analysis module. The same applies to token counts and latency: they are measurements or deterministic derivations, kept separate from interpretations.

### 12. Streaming

- [FACT] Not supported in any layer: spec 006 lists it as a non-goal; `forwardToUpstream` buffers; `normalizeResponse` expects a JSON object. A `stream: true` request would be forwarded upstream and the SSE response would fail the JSON-object check → `provider_error` + 502. Real Pi/OpenCode traffic streams, so live observability is unusable for real harnesses today.

### 13. MCP / tool-call / retrieval / Graphify

- [FACT] Absent. `tool_call`/`tool_result` types exist but no adapter emits them; no MCP, retrieval, or Graphify code anywhere. `docs/design-notes.md` lists "overly broad retrieval" as a future detection.

## Canonical-model gap analysis

Required separation: **evidence → measurement → interpretation**. The table below compares the current state with the target and incorporates the agreed corrections.

| Requirement | Current state | Gap / target note |
|---|---|---|
| Native request/response envelope preserved | [FACT] No; excerpts only; request parsed and re-serialized before forwarding | Envelope capture under a full-fidelity profile must be added; byte-exact behavior verified separately |
| One logical interaction = multiple spans (model, MCP, retrieval, tool) | [FACT] One flat exchange per chat completion | Target: interactions containing spans; spans reference a parent via `parentSpanId`; events belong to a span via `spanId` (detailed schema deferred to the evidence-model specification) |
| Deterministic event ordering | [FACT] Array order; DB read orders by timestamp (same-ms nondeterminism) | Add sequence numbers |
| Wall-clock + monotonic duration + overhead | [FACT] Wall-clock ISO only | Record clocks at capture; durations derived later |
| Versioning | [FACT] None | Evidence records carry an **evidence-schema version** (no derivation version on raw evidence). Derived measurement records carry an **algorithm/derivation version** plus references to their inputs |
| Evidence recalculable into measurements later | [INFERENCE] Provider usage survives trace reports but not `analyzeRun` | Measurements are derivations over evidence; analyzer must not re-estimate destructively |
| Provider-reported vs. locally estimated distinguishable | [FACT] Yes in trace reports; lost in analysis path | Propagate token-source provenance through projections |
| Cost as versioned derivation | [FACT] Absent | Cost = measured usage × versioned pricing schedule; part of the measurement layer, **not** the optimization-analysis module |
| Context sources/contributions explicit | [INFERENCE] SourceType classification; no provenance | Add provenance links (retrieval source, file rule, MCP call) |
| Completeness/dropped-evidence reporting | [FACT] None | Per-interaction and per-event completeness metadata; "not captured" reported, never silently assumed |
| Capture policy decomposed | [FACT] One hardwired `standard` mode at capture | Collection, persistence, and export are independent policy stages. Metadata-only must not collect complete content; collection-time redaction may intentionally prevent sensitive content from entering SignalGlass; persistence may retain less than was transiently observed; export may disclose less than was persisted; full-fidelity is explicit, protected, and not the universal default |
| Tool execution observed | [FACT] Only tool definitions in the request | Tool/MCP/retrieval systems as independently observable capture surfaces |
| `AgentRun` as optional projection | [FACT] Canonical | Demote; keep as analysis projection |
| Smells/recommendations/savings outside core | [FACT] Inside `@signalglass/core` | Move to an optional, clearly labeled analysis module; savings language is interpretation, not measurement |

## Fidelity and observation-boundary analysis

What SignalGlass currently **observes** [FACT] (from `server.ts`, `forward.ts`, `openaiAdapter.ts`):
- The parsed request JSON (in memory; re-serialized when forwarded — byte-exactness not claimed).
- The parsed upstream response JSON (buffered; re-serialized to the client).
- Provider-reported usage (`prompt_tokens`, `completion_tokens`, `total_tokens`).
- Routing decisions, base URL, message/tool counts.
- Its own ISO wall-clock timestamps.

What it **transforms** [FACT]:
- Content → 240-char redacted excerpts (`redactAndTruncateSensitiveText` at the adapter); `size` recorded as char length.
- Content phases are reconstructed labels, not captured states (`said` vs. `sent` are indistinguishable in practice).
- The client-visible response is the raw upstream body re-serialized, not a re-rendered normalized one (`buildClientResponse` is unimplemented).

What it **estimates** [FACT]:
- Tokens (char/4) for every non-inference event; `approximate: true` even when provider usage is present.

What it **omits / cannot know** [FACT]:
- Agent-side tool execution, MCP tool calls, retrieval internals, Graphify activity (client-side, invisible to the proxy).
- Assistant `tool_calls` in responses (ignored by `normalizeResponse`).
- Streaming responses (broken at the SSE boundary).
- Latency, durations, queueing, overhead.
- Cost.
- The `actor` of every stored event (dropped by the schema).
- Whether anything was dropped (no completeness record).

[INFERENCE] Observation boundary: SignalGlass today observes a single OpenAI-compatible chat-completion exchange at one network hop. Everything outside that hop is outside its boundary; the docs mostly acknowledge this, but the mission requires tool/MCP/retrieval systems to be independently observable via their own capture surfaces or documented adapters.

## Documentation conflicts

1. [FACT] **Spec status vs. acceptance criteria.** `specs/000-index.md` marks 002 and 003 "Implemented" while every acceptance criterion in `specs/002-core-domain.md` and `specs/003-offline-analysis.md` is unchecked.
2. [FACT] **Optimization vocabulary in current docs.** `README.md`, `docs/decisions/0002-two-modes.md`, `docs/ingress.md`, and `specs/000-index.md` still promise "transformations, and optimization opportunities" as a live-mode deliverable; `docs/product-brief.md` §"Token conservation opportunities" and `docs/roadmap.md` v0.9 "Reduction Preview" frame optimization as core trajectory. These conflict with the foundation (optimization is optional/experimental scope).
3. [FACT] **`docs/trace-model.md` treats `Trace` as the canonical live model.** It is a lossy per-request projection under the foundation.
4. [FACT] **"Preserve the existing offline analyzer behavior"** is a standing rule (`AGENTS.md`, ADR 0002, `docs/design-notes.md`) that must be restated as "preserve offline analysis as an optional projection" (requires permission to amend `AGENTS.md`; not part of this PR).
5. [FACT] **Privacy vs. fidelity.** `docs/privacy.md`'s "not a data lake" framing is consistent with code but needs capture-profile framing under the foundation.
6. [FACT] **`docs/versioning.md`** lists `AgentRun`/`Trace` schemas as public API surfaces. Pre-1.0 breaking changes are allowed but must be documented.
7. [FACT] `docs/releases/v0.1.0-alpha.3.md` and `docs/dogfood/local-alpha-notes.md` are accurate historical records; they will go stale after realignment (acceptable for historical docs).
8. [FACT] `AGENTS.md` model routing references are operational process, orthogonal to the domain change.

**Correction applied in this PR:** existing Trace/AgentRun and optimization-oriented specifications are labeled as **legacy/current-state contracts (v0.x)** — accurate records of what exists, no longer authoritative for the target architecture — rather than formally Superseded. A later accepted evidence-model specification will formally supersede them.

## Test preservation map

**Tests that survive unchanged (strong keepers) [FACT]:**
- `packages/storage/src/storage.test.ts` — retention, cascade, sanitization, policy round-trip (will need additive cases for new tables/actor/sequence).
- `apps/ingress/src/server.test.ts` — config validation, error envelopes, 413, secret-leak regression, `onTrace` seam (will need additions for streaming/spans).
- `packages/providers/src/openaiAdapter.test.ts` — adapter fixture tests (extend, don't replace).
- `packages/reports/src/reports.test.ts` — renderer/sanitization/token-metrics tests (contracts may shift for trace reports).
- `packages/cli/src/cli.test.ts` — CLI wiring/error paths.
- Privacy/redaction behaviors currently inside `storage.test.ts` and `reports.test.ts`.

**Tests needing adaptation [FACT]:**
- `packages/core/src/traces.test.ts`, `traceToAgentRun.test.ts` — the `Trace` model changes; re-frame as projection tests.
- `packages/core/src/analyzer.test.ts`, `smells.test.ts` — move with the analysis module; fixtures stay.
- `packages/parsers/src/signalglassJson.test.ts` — survives as offline parser contract.

**Missing tests required by the target model [RECOMMENDATION]:**
- Envelope round-trip under a full-fidelity profile.
- Span tree construction/ordering; sequence-number determinism across DB round-trip.
- Clock: monotonic duration + overhead recorded and non-negative.
- Schema versioning/migration from current `traces`/`trace_events` tables.
- Completeness reporting: "captured", "redacted", "truncated", "not captured".
- Provider vs. estimated token provenance in projections.
- Cost derivation (versioned pricing inputs, versioned outputs, input references).
- Streaming: SSE passthrough with event capture, including mid-stream error.
- Tool/MCP/retrieval span capture.
- Capture profiles: collection/persistence/export behavior end-to-end.
- Actor persistence regression (currently silently dropped).

## Risk register

| # | Risk | Severity | Why it matters |
|---|---|---|---|
| R1 | Canonical model migration touches every package, with no storage migration framework | High | DDL is `CREATE TABLE IF NOT EXISTS` with no versioning; existing `.signalglass/*.db` files would be incompatible; a misstep breaks all three CLI modes |
| R2 | Capture-time redaction destroys evidence before any profile can use it | High | The mission's core value is fidelity; implementing collection, persistence, and export as independent policy stages — including protected full-fidelity collection and collection-time redaction that intentionally prevents sensitive content from entering SignalGlass — while preserving the existing privacy guarantees (and their regression tests) is the riskiest privacy work |
| R3 | No streaming support | High | Real harnesses (Pi, OpenCode) stream by default; live observability is unusable until SSE is transparent |
| R4 | Tool/MCP/retrieval execution invisible | Medium-High | Mission explicitly names these as observable systems; the proxy boundary alone cannot see agent-side tool execution |
| R5 | Non-deterministic event order after storage | Medium | Undermines deterministic request reconstruction and deterministic measurements; needs sequence numbers |
| R6 | Silent data loss in the current schema (actor column absent) | Medium | Stored traces lose actor identity without any indication |
| R7 | No CI; manual validation; spec-status inaccuracy (002/003) | Medium | Migration is exactly when regression risk spikes |
| R8 | Scope creep into optimization features (roadmap v0.7/v0.9) | Medium | Pulls toward the old mission; must be deferred until the evidence core exists |
| R9 | `docs/versioning.md` public-surface promises | Low-Medium | Breaking 0.x changes are permitted but must be documented |

## Recommended migration sequence

1. **Documentation-only realignment** (this PR): architectural foundation, corrected assessment, ADR 0004; amend README, roadmap, `specs/000-index.md`; label legacy specs without formal supersession.
2. **Evidence-model specification** (future, separate): evidence schema for interactions, spans, events, capture profiles, versioning — the document that will formally supersede the legacy specs.
3. **Additive evidence package** beside v0.x models — no breaking changes; old `Trace`/`AgentRun` types remain as deprecated projections.
4. **Storage migration framework** + evidence tables + `actor`/`sequence` columns + `schema_version`.
5. **Ingress hardening**: streaming transparency, tool-call/tool-result events, envelope capture under a full-fidelity profile, clocks + latency instrumentation, sequence numbers, completeness flags.
6. **Move interpretations out of core** into an optional analysis module; keep measurements (tokens, latency, cost) as deterministic derivations in the measurement layer.
7. **Reports/CLI/dashboard re-pointing**: versioned derivation records, completeness reporting; dashboard reprioritized to evidence/trace exploration.
8. **Roadmap rewrite** continues to defer budgets/reduction previews to post-evidence.

## Proposed scope of the first realignment PR (this PR)

The first PR is **documentation-only**:

- **Add:** `docs/architectural-foundation.md` (approved v0.1); `docs/assessments/2026-08-01-current-state.md` (this document, corrected and labeled); `docs/decisions/0004-evidence-first.md` (established decisions only, no schema).
- **Amend:** `README.md` (mission framing, link to foundation, optimization described as legacy/optional); `docs/roadmap.md` (evidence/capture/completeness/measurements/streaming before optimization; defer reduction previews and recommendations); `specs/000-index.md` (realignment note; label legacy specs; correct status bookkeeping only where evidence supports it).
- **Deferred (not in this PR):** `specs/013-evidence-model.md`, `docs/evidence-model.md`, `docs/capture-profiles.md`, `docs/model-versioning.md`; any runtime code, tests, fixtures, package manifests, build config, or `AGENTS.md` changes.
- **Validation:** `git diff` documentation-only; documentation checks (none configured beyond the stub lint script); `pnpm test`/`pnpm build` if dependencies are available (they are not — `node_modules` absent); every new relative Markdown link checked; mission cross-consistency across README, roadmap, ADR 0004, and the foundation; remaining conflicting documents reported without editing them.

## Open architectural decisions

Decisions intentionally **deferred to the future evidence-model specification** (not resolved in this PR, and not finalized in ADR 0004):

1. **Concrete evidence schema.** Interaction, span, and event field shapes; how spans nest (`parentSpanId`) and how events attach (`spanId`). Naming conventions are fixed at the principle level; detailed fields are not.
2. **Versioning mechanics.** Exact placement and format of the evidence-schema version on evidence records and of the algorithm/derivation version plus input references on derived measurement records.
3. **Capture-profile representation.** How collection, persistence, and export decisions are configured and versioned; how a metadata-only profile is guaranteed not to collect full payloads first.
4. **Tool/MCP/retrieval observation scope.** Span model plus per-system capture surfaces vs. proxy-only observation; which systems get first-class observers.
5. **Streaming capture mechanics.** Transparent SSE passthrough and per-chunk span events.
6. **Cost derivation inputs.** Versioned pricing schedule format and where it is configured.
7. **Sequencing and clock specifics.** Sequence-number generation and the exact clocks recorded at capture.
8. **Storage migration strategy.** Migration framework mechanics and how legacy tables are retained as projections.

Decisions **recorded as established in ADR 0004** (do not require the evidence-model spec): captured evidence is the authoritative record of what SignalGlass observed at its declared capture boundary; observations/measurements/interpretations are separate; capture boundaries and uncertainty are explicit; core instrumentation must not transform semantic inputs; optimization is optional experimental/analysis scope; the repository is migrated incrementally rather than replaced.
