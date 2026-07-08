# SignalGlass product principles

SignalGlass is observability for AI coding-agent runs. These principles guide every design and implementation decision.

## 1. Observability before optimization

You cannot improve what you cannot see. The first job of SignalGlass is to show developers what an agent actually sent to a model, not to rewrite that context automatically.

## 2. Signal, not magic

SignalGlass offers **signal**: cost, relevance, behavior, comparison, and education. It does not promise automatic fixes. Recommendations are starting points for human judgment, not prescriptions.

## 3. Educate as it observes

Every report, smell, and recommendation should teach the user something about how agent context works. A finding that only says “this is bad” is insufficient. A good finding explains:

- **What happened** — the observable pattern.
- **Why it matters** — how it affects tokens, relevance, or behavior.
- **What evidence supports it** — the blocks, turns, or ratios behind the claim.
- **What to inspect or try next** — concrete, non-magical next steps.

## 4. Token estimates are approximate

Until a real tokenizer is wired in, SignalGlass uses a simple approximation (roughly one token per four characters). Reports must label estimates as approximate and avoid claiming exact model token counts.

## 5. Heuristics must be honest

Some detections are heuristics, not proofs. When SignalGlass guesses (for example, that a file is relevant or late), it must say so clearly and avoid false certainty.

## 6. Smells are educational, not just warnings

A context smell is an invitation to learn. Each smell should help the user understand a common context-window anti-pattern and decide whether it matters for their specific run.

## 7. Two modes, one model

SignalGlass supports both **Offline Run Analysis** and **Live Ingress Observability**. A live trace should be convertible into the same `AgentRun` model used for offline analysis so that smells, recommendations, and reports can be reused.

## 8. Privacy by default

Live ingress stores metadata, metrics, routing decisions, transformation summaries, and short redacted excerpts by default. Full raw payloads, secrets, and API keys are not stored unless the user explicitly opts in.

## 9. Provider-agnostic internal model

OpenAI compatibility is a doorway, not the architecture. Provider-specific shapes are translated into the internal model at the adapter boundary and must not leak into `AgentRun`, `ContextBlock`, or `AnalysisResult`.

## 10. Realized savings vs. opportunities

SignalGlass must keep these separate:

- **Savings** are what SignalGlass or the user already fixed.
- **Opportunities** are what SignalGlass noticed but did not change.
- **Recommendations** are what the user can choose to change.

## 11. The UI is a key product surface

The web dashboard is not an afterthought. It is the primary place where developers will explore context, compare runs, and build intuition. The architecture should make room for an interactive, educational report surface from day one.

## 12. Prefer boring, maintainable code

SignalGlass should remain readable and maintainable. Clever abstractions that obscure the domain model are worse than explicit, slightly verbose code.
