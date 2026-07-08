# Spec 002: Core domain model

## Status

Implemented

## Purpose

Define the provider-agnostic domain model used for offline run analysis and shared with live ingress.

## Scope

- Run, turn, and context-block types.
- Source-type classification.
- Token estimation.
- Repeated-context detection.
- Context smells and recommendations.
- Analysis result contract.

## Non-goals

- Provider-specific request/response shapes.
- Ingress server behavior.
- UI rendering.

## Required files or modules

- `packages/core/src/types.ts`
- `packages/core/src/sourceTypes.ts`
- `packages/core/src/analysis.ts`
- `packages/core/src/tokenEstimator.ts`
- `packages/core/src/repeated.ts`
- `packages/core/src/smells.ts`
- `packages/core/src/recommendations.ts`
- `packages/core/src/analyzer.ts`

## Required types or contracts

- `AgentRun` — top-level run with metadata and turns.
- `Turn` — one exchange step with context blocks.
- `ContextBlock` — normalized chunk of context with `sourceType`, `content`, `name`, optional `estimatedTokens`.
- `SourceType` — union of source types including `system_instruction`, `project_instruction`, `user_message`, `assistant_message`, `tool_call`, `tool_output`, `file_tree`, `file_content`, `diff`, `log_output`, `test_output`, `build_output`, `dependency_lockfile`, `generated_artifact`, `unknown`.
- `TokenEstimator` — pluggable interface; default approximation is ~1 token per 4 characters.
- `RepeatedBlockGroup` — exact duplicate groups across blocks.
- `ContextSmell` — educational observation with `whatHappened`, `whyItMatters`, `evidenceSummary`, `recommendation`, `suggestedNextSteps`, severity, heuristic flag, and optional live-mode fields.
- `Recommendation` — actionable suggestion with `whyItMatters`, `inspectSuggestion`, `trySuggestion`, and optional live-mode fields.
- `AnalysisResult` — full report contract object.

Live-mode optional fields:

```ts
// ContextSmell
contentPhase?: ContentPhase;
traceEventIds?: string[];
savingsOpportunity?: SavingsOpportunity;

// Recommendation
potentialSavings?: number;
automationStatus?: "manual" | "preview" | "assisted";
traceEventIds?: string[];
```

## Required behavior

- `analyzeRun(run: AgentRun): AnalysisResult` computes token totals, per-turn totals, source-type breakdown, largest blocks, repeated groups, smells, and recommendations.
- Token counts are approximate and labeled as such.
- Smells are sorted by severity (high, warning, info).
- Recommendations are deduplicated and derived from smells.
- Existing types and behavior are preserved when live-mode optional fields are added.

## Acceptance criteria

- [ ] `analyzeRun` returns all fields required by `docs/report-contract.md`.
- [ ] All current smell detectors produce valid `ContextSmell` objects.
- [ ] Adding optional live-mode fields does not break existing tests or reports.

## Tests

- `packages/core/src/tokenEstimator.test.ts`
- `packages/core/src/analyzer.test.ts`
- `packages/core/src/smells.test.ts`
- `packages/core/src/traces.test.ts`

## References

- `docs/trace-model.md`
- `docs/report-contract.md`
- `docs/decisions/0002-two-modes.md`
