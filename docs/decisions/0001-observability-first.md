# ADR 0001: SignalGlass is observability-first

## Status

Accepted

## Context

SignalGlass could have been built in several ways:

1. **A proxy** that sits between an AI coding agent and a model provider, intercepting every request.
2. **A compressor** that automatically removes or rewrites context to save tokens.
3. **A provider gateway** with integrations for specific APIs or agents.
4. **An automatic context rewriter** that changes prompts or tool output without human review.
5. **An observability and reporting tool** that analyzes saved run data and helps developers understand what happened.

Each option has trade-offs. A proxy gives the most data but couples the product to runtime infrastructure. A compressor or rewriter can save tokens but risks discarding important context silently. Provider gateways fragment the codebase and require ongoing maintenance. Observability-first starts with understanding before changing anything.

## Decision

SignalGlass will begin as an **observability and reporting tool**.

Specifically for the initial scaffold:

- SignalGlass will **not** start as a proxy.
- SignalGlass will **not** start as an automatic compressor.
- SignalGlass will **not** start as a provider-specific gateway.
- SignalGlass will **not** automatically rewrite context without human review.

The first goal is to answer: **“What did the agent send to the model, and what can we learn from it?”**

Optimization features, if added later, will be built on top of this observability foundation and will keep the human in the loop.

## Amendment

ADR 0002 added a second mode: **Live Ingress Observability**. The proxy is still observability-first and does not automatically rewrite context. The initial decision to avoid provider-specific gateways is preserved through the provider adapter architecture in ADR 0003.

## Original consequences

### Positive

- The codebase stays small, focused, and easy to maintain.
- Developers can adopt SignalGlass without changing their agent or model setup.
- The product builds trust by showing evidence before suggesting changes.
- The domain model (runs, turns, context blocks, source types) remains central.
- Future features (comparison, budgets, capture, reduction previews) have a clear foundation.

### Negative

- SignalGlass could not observe live traffic until the later capture/proxy milestone now described by ADR 0002.
- Users had to export or save run data to analyze it in early versions.
- Token counts remain estimates until a real tokenizer or provider metadata is integrated.

### Accepted trade-offs

- Early versions required manual input files. Live capture was added later.
- Reports will label estimates and heuristics honestly rather than claim certainty.
- The CLI and static HTML reports are prioritized over a live service.

## Related documents

- `docs/product-principles.md`
- `docs/product-brief.md`
- `docs/architecture.md`
- `docs/roadmap.md`
