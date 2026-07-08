# Signalglass report contract

Every Signalglass report — whether terminal, JSON, or static HTML — must contain the following information. Formatting may vary by output type, but the data and meaning must be present.

## 1. Run metadata

- `runId` — stable identifier for the run.
- `runName` — human-readable run name.
- `model` — model used, if known.
- `provider` — model provider, if known.
- `agent` — agent name, if known.
- `task` — task description, if known.
- `generatedAt` — ISO timestamp when the report was produced.

## 2. Estimated token totals

- `totalInputTokens` — estimated input tokens across the entire run.
- `totalOutputTokens` — output tokens, if reported by the run.

Reports must label these as estimates, not exact model token counts.

## 3. Source-type breakdown

A list of source types consumed by the run, each with:

- `sourceType` — e.g. `project_instruction`, `tool_output`, `file_content`.
- `tokens` — estimated tokens for that source type.
- `blockCount` — number of blocks of that source type.
- `percentage` — share of total input tokens.

## 4. Turn-by-turn breakdown

A list of turns, each with:

- `turnId` and `turnNumber`.
- `inputTokens` — estimated tokens sent during that turn.
- `outputTokens` — output tokens for that turn, if known.

## 5. Largest context blocks

A ranked list of the largest individual blocks, each with:

- `blockId`, `name`, `sourceType`, `turnNumber`.
- `tokens` — estimated tokens for that block.

## 6. Repeated context findings

A list of repeated-block groups, each with:

- `sourceType`.
- `occurrences`.
- `tokensPerOccurrence` and `totalTokens`.
- `blockIds` and `turnIds` involved.

Plus a top-level `duplicateTokenCount` and `duplicateRatio`.

## 7. Context smells

A list of observations about potentially wasteful, noisy, or late context. Each smell must include:

- `id` — stable smell identifier.
- `title` — human-readable title.
- `severity` — `info`, `warning`, or `high`.
- `whatHappened` — observable pattern.
- `whyItMatters` — impact on tokens, relevance, or behavior.
- `evidenceSummary` — blocks, turns, or ratios that support the claim.
- `recommendation` — concise advice.
- `suggestedNextSteps` — concrete inspect/try steps.
- `isHeuristic` — true when the smell is a heuristic rather than a direct measurement.
- `estimatedTokensInvolved` — tokens implicated by the smell.
- `relatedTurnIds` and `relatedBlockIds` — evidence references.

## 8. Recommendations

A deduplicated list of actions derived from smells. Each recommendation must include:

- `id`, `title`, `description`.
- `whyItMatters`.
- `inspectSuggestion` — what the user can inspect.
- `trySuggestion` — what the user can try.
- `smellIds` — smells that produced the recommendation.

## 9. Evidence references

Reports must make it possible to trace every smell and recommendation back to raw turn and block identifiers. This is the foundation of the planned Evidence Drawer in the web UI.

## 10. Estimation disclaimers

Reports must clearly state that token counts are approximate. Signalglass does not claim to match any model tokenizer until a real tokenizer is wired in.

## Output formats

- **Terminal** — human-readable, compact, suitable for quick inspection.
- **JSON** — full normalized analysis result, suitable for tooling and storage.
- **HTML** — static, self-contained, educational report suitable for sharing.
