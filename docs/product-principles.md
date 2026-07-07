# Signalglass product principles

Signalglass is observability for AI coding-agent runs. These principles guide every design and implementation decision.

## 1. Observability before optimization

You cannot improve what you cannot see. The first job of Signalglass is to show developers what an agent actually sent to a model, not to rewrite that context automatically.

## 2. Signal, not magic

Signalglass offers **signal**: cost, relevance, behavior, comparison, and education. It does not promise automatic fixes. Recommendations are starting points for human judgment, not prescriptions.

## 3. Educate as it observes

Every report, smell, and recommendation should teach the user something about how agent context works. A finding that only says “this is bad” is insufficient. A good finding explains:

- **What happened** — the observable pattern.
- **Why it matters** — how it affects tokens, relevance, or behavior.
- **What evidence supports it** — the blocks, turns, or ratios behind the claim.
- **What to inspect or try next** — concrete, non-magical next steps.

## 4. Token estimates are approximate

Until a real tokenizer is wired in, Signalglass uses a simple approximation (roughly one token per four characters). Reports must label estimates as approximate and avoid claiming exact model token counts.

## 5. Heuristics must be honest

Some detections are heuristics, not proofs. When Signalglass guesses (for example, that a file is relevant or late), it must say so clearly and avoid false certainty.

## 6. Smells are educational, not just warnings

A context smell is an invitation to learn. Each smell should help the user understand a common context-window anti-pattern and decide whether it matters for their specific run.

## 7. The UI is a key product surface

The web dashboard is not an afterthought. It is the primary place where developers will explore context, compare runs, and build intuition. The architecture should make room for an interactive, educational report surface from day one.

## 8. Prefer boring, maintainable code

Signalglass should remain readable and maintainable. Clever abstractions that obscure the domain model are worse than explicit, slightly verbose code.
