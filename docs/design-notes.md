# SignalGlass design notes

This document captures planning notes and product intent before the next implementation pass. It is an appendix, not the canonical specification. For authoritative design, see:

- `docs/architecture.md`
- `docs/trace-model.md`
- `docs/provider-config.md`
- `docs/ingress.md`
- `docs/privacy.md`
- `docs/views.md`
- `docs/report-contract.md`
- `docs/roadmap.md`
- `docs/decisions/0002-two-modes.md`
- `docs/decisions/0003-provider-adapter-architecture.md`

---

## SignalGlass identity

SignalGlass is not just a proxy. It is an observability, education, and optimization layer for AI-agent communication.

It should help users see the invisible lifecycle of LLM interactions: prompts, context assembly, instructions, tool definitions, provider routing, model calls, token usage, transformations, tool calls, provider responses, and final responses.

## Two product modes

SignalGlass supports two complementary modes:

1. **Offline Run Analysis** — analyze captured agent runs from files, dumps, parser inputs, and samples.
2. **Live Ingress Observability** — act as an OpenAI-compatible ingress/proxy that captures trace/timeline events and forwards requests to configured upstream providers.

Offline analysis already exists and should be preserved. Live ingress should be added without replacing the offline analyzer. A live trace can be converted into an `AgentRun` so existing analysis, smells, recommendations, and reports can be reused.

## OpenAI first, Anthropic later

OpenAI-compatible ingress comes first because it provides broad compatibility with agent tools and model routers. Anthropic-compatible ingress comes later.

OpenAI compatibility must not become the internal data model.

## Provider strategy

SignalGlass should support multiple providers and multiple models.

Provider compatibility should be explicit through adapter kinds, not inferred from URLs:

```ts
type ProviderKind =
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "custom";
```

Provider config should reference API keys by environment variable name, not store raw tokens.

## Technical storyboard

The web UI should make LLM communication feel inspectable as a technical storyboard. It may borrow from word balloons, caption boxes, speaker labels, panels, badges, annotations, sequence lines, and collapsed stacks.

However, it must remain technically accurate and must not represent every lifecycle event as ordinary speech. The UI should distinguish:

- `said`
- `sent`
- `transformed`
- `requested`
- `observed`
- `generated`
- `returned`

## UI views

Future UI views:

- **Trace View** — for developer debugging.
- **Payload View** — for raw or redacted request/response inspection.
- **Story View** — for human-readable lifecycle explanation.
- **Savings Lens** — highlights token-heavy blocks, realized savings, repeated content, and optimization opportunities.

## Savings language

SignalGlass should separate:

- **Savings** — what SignalGlass fixed.
- **Opportunities** — what SignalGlass noticed.
- **Recommendations** — what the user can choose to change.

Do not count potential opportunities as realized savings.

Good:

> SignalGlass saved 1,240 tokens through deduplication.
> Potential opportunity: the system prompt may be reducible by 2,000 tokens.

Bad:

> SignalGlass saved 3,240 tokens.

## Inefficiency pattern detection

SignalGlass should eventually detect correctable patterns such as:

- large system prompt
- overlapping instruction layers
- conflicting instructions
- bloated developer prompt
- oversized tool schema bundle
- unused tool exposure
- large conversation history
- stale conversation context
- repeated file context
- low-relevance attached files
- full file included when excerpt would suffice
- duplicate documentation sources
- oversized examples
- excessive planning loop
- re-reading same files
- tool result flooding
- retry overhead
- model oversizing
- model undersizing
- context window mismatch
- high static context ratio
- multi-task prompt
- ambiguous request causing exploration
- excessive tool availability for simple tasks
- large policy blocks
- missing context compaction
- excessive error log inclusion
- low signal-to-noise context
- overly broad retrieval
- relevance drift across agent loop
- metadata overhead
- expensive formatting instructions
- large JSON schema overhead
- unclear agent role
- excessive style or personality context
- free-model retry overhead
- excessive agent self-documentation
- missing canonical project summary
- high latency from sequential calls
- context included at wrong authority level

## Evaluation approach

Use a hybrid evaluation strategy:

> Code finds fingerprints. Agents explain the crime scene.

Prefer code-first detection for measurable patterns:

- token counts
- ratios
- thresholds
- repeated content
- hashes
- tool usage counts
- retry counts
- latency
- context window usage
- model/provider metadata

Use semantic similarity or optional agent review only when judgment is needed:

- conflicting instructions
- overlapping instruction layers
- low relevance context
- relevance drift
- authority-level mismatch
- unclear agent role
- multi-task prompts

Agent-based review should be gated, optional, and not required for the core product to function.

## Storage principle

SignalGlass should collect enough metadata to explain savings and opportunities without requiring raw payload storage.

Default behavior should store metadata, metrics, timeline events, routing decisions, transformation summaries, and short redacted excerpts.

Full raw payload storage should be opt-in and treated as debug mode.

## Implementation guidance

For ongoing code passes:

1. Preserve existing offline analyzer types and behavior.
2. Keep live-mode trace types beside the current run-analysis model.
3. Keep provider-specific logic out of `@signalglass/core`.
4. Keep provider config and provider adapters in their separate package.
5. Keep ingress isolated in `apps/ingress`.
6. Keep storage and raw payload capture policy explicit.
7. Avoid duplicating `ContextSmell` and `Recommendation`; evolve them with optional fields instead.

---

*This document records design intent and should be consolidated into canonical docs or ADRs when decisions become stable.*
