# Signalglass product brief

## What Signalglass is

Signalglass is observability for AI coding-agent runs.

It helps developers inspect what context AI coding agents send to models, where tokens are spent, what gets repeated, what appears wasteful, and how different models or agent runs behave on the same task.

The primary question Signalglass answers is:

> **“What did the agent send to the model, and what can we learn from it?”**

Signalglass educates as it observes. Every finding should help the user understand how agent context works.

## Two complementary modes

1. **Offline Run Analysis** — analyze captured agent runs from JSON or parser inputs.
2. **Live Ingress Observability** — act as an OpenAI-compatible ingress/proxy that captures traces, timeline events, provider requests/responses, token usage, transformations, and optimization opportunities.

Both modes share the same internal model. A live trace can be converted into an `AgentRun` so the existing analyzer can be reused.

## What Signalglass is not

- It is not an automatic optimizer that rewrites context for you.
- It is not a provider-specific integration beyond adapters.
- It is not a system that stores full raw payloads or API keys by default.

The first milestone is an analyzer and reporting tool. Live ingress is added as a second mode, still observability-first. Optimization recommendations are advisory. The human decides what to change.

## Why observability comes before optimization

You cannot optimize what you cannot see. Before compressing or rewriting context, developers need to understand:

- What actually made it into the context window
- Which sources consumed the most tokens
- What was repeated or noisy
- Whether important context arrived late

Signalglass starts as an x-ray, not a scalpel.

## What SIGNAL means

Signalglass offers SIGNAL in five categories:

1. **Cost signal** — where tokens were spent (totals, per turn, per source type, largest blocks, repeated content).
2. **Relevance signal** — what context appeared important, missing, late, noisy, or excessive.
3. **Behavior signal** — how the agent/model behaved over time (turns, tool calls, repeated failure patterns, patch size).
4. **Comparison signal** — how different runs, models, or providers compare on the same task.
5. **Education signal** — explanations that teach developers how agent context works and what they can inspect or try next.

Every major finding should eventually answer:

- **What happened?** — the observable pattern.
- **Why does it matter?** — the impact on tokens, relevance, or behavior.
- **What evidence supports it?** — the blocks, turns, or ratios behind the claim.
- **What could the user inspect or try next?** — concrete, non-magical next steps.

## Token conservation opportunities Signalglass identifies

1. Deduplication
2. Tool output trimming
3. Log collapsing
4. File-tree compression
5. Generated artifact exclusion
6. Lockfile caution
7. Context budgeting
8. Context prioritization
9. Summary substitution
10. Replay and comparison

In the first scaffold, Signalglass detects and reports these opportunities. It does not automatically apply them.
