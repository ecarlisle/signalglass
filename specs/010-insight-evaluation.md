# Spec 010: Insight evaluation

## Status

Draft

## Purpose

Define how Signalglass detects inefficiencies and produces smells, opportunities, and recommendations.

## Scope

- Code-first detection for measurable patterns.
- Optional agent-based review for judgment-based patterns.
- `ContextSmell` and `Recommendation` evolution.

## Non-goals

- Automatic context rewriting.
- Model training or fine-tuning.

## Required files or modules

- `packages/core/src/smells.ts`
- `packages/core/src/recommendations.ts`
- Future insight engine package.

## Required types or contracts

- `ContextSmell`, `Recommendation`, `SavingsOpportunity` from `core`.
- Severity levels: `info`, `warning`, `high`.

## Required behavior

Code-first detection is preferred for:

- token counts and ratios,
- repeated content hashes,
- tool usage counts,
- retry counts,
- latency,
- context window usage,
- model/provider metadata.

Optional agent review is reserved for:

- conflicting instructions,
- overlapping instruction layers,
- low relevance context,
- relevance drift,
- authority-level mismatch,
- unclear agent role,
- multi-task prompts.

Agent review must be gated, optional, and not required for core functionality.

Savings language must remain precise:

- **Savings** — already realized.
- **Opportunities** — noticed but not changed.
- **Recommendations** — user can choose to act.

## Acceptance criteria

- [ ] Every smell explains what happened, why it matters, evidence, and next steps.
- [ ] Potential opportunities are not counted as realized savings.
- [ ] New detectors can be added without replacing `ContextSmell` or `Recommendation`.

## Tests

- `packages/core/src/smells.test.ts`
- Future tests for new detectors and opportunity estimation.

## References

- `docs/design-notes.md`
- `specs/002-core-domain.md`
