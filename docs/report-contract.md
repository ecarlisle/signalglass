# Signalglass report contract

Every Signalglass report — whether terminal, JSON, or static HTML — must contain the following information. Formatting may vary by output type, but the data and meaning must be present.

Reports may be produced from an offline `AgentRun` or from a live `Trace`. Both sources produce the same core contract. Live-specific reports (Trace View, Payload View) add optional sections on top of this contract.

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

## 11. Trace and timeline events (live mode)

When a report is produced from a live trace, it should include:

- `traceId`, `startedAt`, `providerId`, `model`.
- A list of `TraceEvent` objects with `kind`, `timestamp`, `contentPhase`, `sourceType`, and `excerpt`.
- Routing decisions (which provider and model were selected).
- Transformation summaries.

## 12. Payload references

Payload View and trace reports may reference stored payloads. By default, reports must not inline full raw payloads. They may include:

- `payloadRef` — a reference to a stored payload, if the capture policy allows it.
- `excerpt` — a short redacted excerpt.
- A clear note when content has been redacted.

## 13. Savings and opportunities

Reports that include the Savings Lens must separate:

- **Realized savings** — tokens already saved by Signalglass or the user.
- **Opportunities** — potentially correctable patterns with estimated savings and confidence.
- **Recommendations** — actions the user can choose to take.

Future additions to `ContextSmell` and `Recommendation` may include:

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

## 14. Content phases

Reports should preserve the distinction between:

- `said`
- `sent`
- `transformed`
- `requested`
- `observed`
- `generated`
- `returned`

When a report presents content, it should label which phase it represents.

## 15. Privacy and redaction disclaimers

Reports must state:

- Whether token counts are approximate.
- Whether full payloads, tool results, or secrets were stored.
- That API keys are never stored in reports or traces.
- When excerpts are redacted.

## Output formats

- **Terminal** — human-readable, compact, suitable for quick inspection.
- **JSON** — full normalized analysis result, suitable for tooling and storage.
- **HTML** — static, self-contained, educational report suitable for sharing.
- **Trace View** — interactive event timeline (future dashboard view).
- **Payload View** — structured request/response inspection (future dashboard view).
- **Story View** — narrative summary (future dashboard view).
- **Savings Lens** — realized savings vs. opportunities (future dashboard view).
