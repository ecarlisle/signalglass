# Signalglass visualization views

Signalglass is an observability, education, and optimization layer. The UI presents captured agent/model communication through several complementary views.

Some views are already named in `docs/ui-vision.md` (Run Summary, Context Timeline, Token Breakdown, Context Smells, Evidence Drawer, Recommendations, Run/Model Comparison). This document adds the live-ingress-specific views and explains how they relate to the core concepts.

## Trace View

A chronological, event-level view of everything that happened during a live provider exchange.

What it shows:

- Request received, normalized, routed, and sent upstream.
- Response chunks and final response.
- Tool calls and tool results.
- Transformations applied.
- Errors and retries.

Educational purpose: prove what happened at each step of the pipeline.

## Payload View

A structured view of request and response payloads.

What it shows:

- Provider-native payload shapes.
- Internal normalized representations.
- Diffs between `sent`, `transformed`, and `returned` content.

Privacy note: Payload View is only populated when the capture policy allows full payloads. By default it shows redacted excerpts.

Educational purpose: help developers understand how provider formats map to Signalglass internal events.

## Story View

A narrative summary of a run or trace.

What it shows:

- What the agent asked for.
- What the model returned.
- What context dominated the run.
- Which smells and recommendations apply.
- Why certain patterns matter.

Educational purpose: turn low-level events into a human-readable explanation.

## Savings Lens

A view that separates what Signalglass already improved from what the user can still improve.

### Realized savings

Savings are what Signalglass fixed automatically or the user already applied:

- Tokens removed by a transformation.
- Duplicate context that was collapsed.
- Noisy tool output that was trimmed.

Realized savings are concrete and measurable.

### Opportunities

Opportunities are what Signalglass noticed but did not change:

- Repeated instructions that could be cached.
- Generated artifacts that could be excluded.
- Lockfiles that could be omitted.

Opportunities are potentially correctable patterns. They are presented with estimated token savings and confidence.

### Recommendations

Recommendations are what the user can choose to change. Each recommendation links to one or more opportunities and explains:

- Why it matters.
- What to inspect.
- What to try.

This preserves the distinction between observation and action.

## Content phase distinctions

Across all views, Signalglass preserves the distinction between:

- **said** — what was intended.
- **sent** — what was placed on the wire.
- **transformed** — what was modified by middleware.
- **requested** — what was explicitly asked for.
- **observed** — what Signalglass saw pass through.
- **generated** — what the model produced.
- **returned** — what was delivered back to the agent.

These phases help users understand where context changed and why.

## Relationship to existing views

| Existing view | Related new view | Purpose |
|---|---|---|
| Run Summary | Story View | High-level human-readable summary. |
| Context Timeline | Trace View | Detailed turn-by-turn or event-by-event timeline. |
| Evidence Drawer | Payload View | Raw evidence behind a finding. |
| Context Smells | Savings Lens | Observations plus realized/opportunity savings. |
| Recommendations | Savings Lens | Actionable suggestions linked to opportunities. |
| Run/Model Comparison | all views | Compare traces across models and providers. |
