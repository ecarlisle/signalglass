# ADR 0002: SignalGlass supports two complementary modes

## Status

Accepted

## Context

SignalGlass began as an offline run analyzer: users save an agent run to a JSON file and run `signalglass analyze` to inspect it. This is valuable for post-hoc review, education, and comparison, but it requires users to export or capture run data manually.

Many users also want observability at the point of ingress: a proxy or adapter that captures what an agent sends to a model and what comes back, as it happens. This enables real-time debugging, timeline reconstruction, and eventually live optimization opportunities.

Rather than choosing one path, SignalGlass should support both:

1. **Offline Run Analysis** — analyze captured runs from JSON or parser inputs.
2. **Live Ingress Observability** — act as an OpenAI-compatible ingress/proxy that captures traces, timeline events, provider requests/responses, token usage, transformations, and optimization opportunities.

## Decision

SignalGlass will support two complementary modes.

- **Offline Run Analysis** remains the first mode and the foundation of the product.
- **Live Ingress Observability** is added as a second mode. It starts with an OpenAI-compatible ingress doorway and may later support Anthropic, Gemini, Ollama, and custom adapters.
- Both modes feed the same internal domain model. A live trace can be converted into an `AgentRun` so the existing analyzer, smells, recommendations, and reports can be reused.
- Live ingress defaults to privacy-safe capture: metadata, metrics, routing decisions, transformation summaries, and short redacted excerpts are stored by default. Full raw payloads are opt-in.
- API keys are referenced by environment variable names, never stored directly.

## Consequences

### Positive

- Users can choose the mode that fits their workflow.
- The existing offline analyzer, reports, and dashboard remain valid and are strengthened by live-mode data.
- The internal model (`AgentRun`, `Turn`, `ContextBlock`, `ContextSmell`, `Recommendation`, `AnalysisResult`) stays central and provider-agnostic.
- Live-mode captures can be exported as offline runs for sharing, comparison, and long-term storage.

### Negative

- The codebase grows to include an ingress server, provider adapters, trace storage, and capture policy.
- Live ingress introduces runtime, networking, and security concerns that offline analysis does not.
- More documentation and testing are required to keep both modes consistent.

### Accepted trade-offs

- Live ingress starts with OpenAI compatibility because it is the most common agent interoperability surface. OpenAI compatibility is a doorway, not the core architecture.
- Anthropic-compatible ingress will be added later.
- Full payload capture is disabled by default to protect privacy and reduce storage.

## Related documents

- `docs/product-principles.md`
- `docs/architecture.md`
- `docs/trace-model.md`
- `docs/ingress.md`
- `docs/privacy.md`
- `docs/provider-config.md`
- `docs/decisions/0003-provider-adapter-architecture.md`
