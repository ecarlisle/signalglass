# Spec 009: Dashboard views

## Status

Draft

## Purpose

Define the interactive educational report viewer for Signalglass.

## Scope

- Static-first dashboard app.
- Views for both offline runs and live traces.
- Visual distinction of content phases and savings/opportunities/recommendations.

## Non-goals

- Server-side rendering.
- Real-time streaming UI.
- Authentication or access control.

## Required files or modules

- `apps/dashboard/`
- `apps/dashboard/src/App.tsx`
- `apps/dashboard/src/fixtures/sample-analysis.json`

## Required types or contracts

- `AnalysisResult`, `Trace`, `TraceEvent`, `ContextSmell`, `Recommendation` from `core`.

## Required views

| View | Purpose |
|---|---|
| Run Summary | High-level run metadata and token totals. |
| Context Timeline | Turn-by-turn or event-by-event context. |
| Token Breakdown | Tokens by source type and turn. |
| Context Smells | Educational smell cards with evidence and next steps. |
| Evidence Drawer | Raw evidence behind a finding. |
| Recommendations | Inspect/try suggestions. |
| Run/Model Comparison | Side-by-side run comparison. |
| Trace View | Live ingress event timeline. |
| Payload View | Raw or redacted request/response inspection. |
| Story View | Human-readable lifecycle explanation. |
| Savings Lens | Realized savings, opportunities, and recommendations. |

## Required behavior

- Load analysis JSON and trace JSON in the browser.
- Label estimates as approximate.
- Label heuristics as heuristics.
- Preserve content-phase distinctions: said, sent, transformed, requested, observed, generated, returned.
- Separate realized savings from opportunities and recommendations.
- Remain static-first; no server required for viewing a report.

## Acceptance criteria

- [ ] `pnpm --filter @signalglass/dashboard build` succeeds.
- [ ] The dashboard displays the sample report.
- [ ] Placeholder sections for all planned views are visible or documented.

## Tests

- Dashboard build test.
- Component smoke tests for smell cards and summary cards.

## References

- `docs/ui-vision.md`
- `docs/views.md`
- `specs/008-reports.md`
