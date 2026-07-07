# AGENTS.md — Signalglass

Rules for anyone (human or agent) working on this codebase.

## Product stance

- Keep the project **observability-first** and educational.
- Do **not** build a proxy in the initial scaffold.
- Do **not** add provider-specific integrations yet.
- Do **not** promise automatic optimization where Signalglass only reports recommendations.
- Every smell, recommendation, and report finding should explain what happened, why it matters, what evidence supports it, and what to inspect or try next.

## Code style

- Keep types explicit and domain-focused.
- Prefer readable, boring TypeScript over clever abstractions.
- Avoid magic numbers; put thresholds and heuristics in named constants.
- Avoid claiming exact token counts while using approximate estimation.

## Testing

- Add or update tests with behavior changes.
- Use Vitest. Prefer unit tests for domain logic and smoke tests for report generation.

## Documentation

- Update docs when project concepts change.
- Keep `docs/product-brief.md`, `docs/product-principles.md`, `docs/ui-vision.md`, `docs/mvp-plan.md`, and `docs/glossary.md` aligned with the code.

## Dependencies

- Keep dependencies minimal unless justified.
- Favor workspace packages over external packages for Signalglass-specific logic.
