# AGENTS.md — Signalglass

Rules for anyone (human or agent) working on this codebase.

## Product stance

- Keep the project **observability-first** and educational.
- Support two complementary modes: **Offline Run Analysis** and **Live Ingress Observability**.
- Keep the internal model (`AgentRun`, `Turn`, `ContextBlock`, `AnalysisResult`) provider-agnostic. OpenAI compatibility is a doorway, not the architecture.
- Do **not** promise automatic optimization where Signalglass only reports recommendations.
- Do **not** store full raw payloads, secrets, or API keys by default.
- Reference API keys by environment variable names, never store them directly.
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
- Keep `docs/product-brief.md`, `docs/product-principles.md`, `docs/ui-vision.md`, `docs/versioning.md`, `docs/report-contract.md`, `docs/architecture.md`, `docs/roadmap.md`, `docs/trace-model.md`, `docs/provider-config.md`, `docs/ingress.md`, `docs/privacy.md`, `docs/views.md`, `docs/mvp-plan.md`, `docs/glossary.md`, and `docs/decisions/` aligned with the code.

## Dependencies

- Keep dependencies minimal unless justified.
- Favor workspace packages over external packages for Signalglass-specific logic.
