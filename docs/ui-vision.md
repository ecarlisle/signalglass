# Signalglass UI vision

The Signalglass web UI is an **interactive educational report**. It helps developers explore what an agent sent to a model, understand why it matters, and compare runs.

This document describes the planned sections. The current dashboard is intentionally minimal; it exists to validate the data model and leave a clear path for these concepts.

## Planned sections

### Run Summary

A high-level view of a single run.

Intended content:
- Run name, model, provider, agent, and task
- Estimated input and output tokens
- Number of turns and context blocks
- Repeated context percentage
- Top-level smell count and severity distribution

Educational purpose: set the stage and give developers a quick sense of scale.

### Context Timeline

A turn-by-turn view of what entered the context window.

Intended content:
- Each turn as a timeline card
- Blocks grouped by source type
- Token volume per turn
- Repeated blocks highlighted across turns

Educational purpose: show how context grows and changes over the life of a run.

### Token Breakdown

Where the tokens went.

Intended content:
- Tokens by source type (table and simple bar chart)
- Tokens per turn
- Largest individual blocks

Educational purpose: make cost visible and concrete.

### Context Smells

Observations about potentially wasteful, noisy, or late context.

Intended content:
- Smell cards with severity
- For each smell: what happened, why it matters, evidence, and what to try next
- Clear labels for heuristic detections

Educational purpose: turn warnings into learning opportunities.

### Evidence Drawer

A slide-out or expandable panel that shows the raw evidence behind any finding.

Intended content:
- The exact blocks and turns referenced by a smell or recommendation
- Snippets of repeated content
- Token counts for the selected evidence

Educational purpose: prove the claim and let users inspect the source data themselves.

### Recommendations

Actionable, human-reviewed suggestions derived from smells.

Intended content:
- One recommendation per underlying pattern
- Why the recommendation matters
- What to inspect
- What to try

Educational purpose: bridge observation and action without pretending to be automatic magic.

### Run / Model Comparison

Compare two or more runs side by side.

Intended content:
- Select runs by model, provider, agent, or task
- Compare total tokens, turns, tool calls, repeated context, smells, and patch size
- Highlight meaningful differences

Educational purpose: answer questions like “Which model solved this task with less noise?” and “Did the cheaper model miss important context?”

## Design notes

- Keep the UI static-first where possible (static HTML reports are a first-class output).
- Every number should be labeled as an estimate where appropriate.
- Every heuristic should be labeled as a heuristic.
- The default experience should teach, not scold.
