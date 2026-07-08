# AGENTS.md — Signalglass

Rules for anyone (human or agent) working on this codebase.

## Read before making changes

1. Read this file (`AGENTS.md`).
2. Read `specs/000-index.md`.
3. Read the target spec you are implementing.
4. Read all docs referenced by the target spec.

## Spec-driven workflow

- Implement only the target spec.
- Do not implement adjacent specs unless explicitly requested.
- If a spec is ambiguous, prefer the smallest implementation that satisfies the acceptance criteria.
- Runtime code changes should reference the spec they implement, either in commit messages or code comments where helpful.
- Only specs marked **Accepted** should be implemented. A spec may be marked **Implemented** only when its acceptance criteria are satisfied.

## Product stance

- Keep the project **observability-first** and educational.
- Support two complementary modes: **Offline Run Analysis** and **Live Ingress Observability**.
- Preserve the existing offline analyzer behavior.
- Keep the internal model (`AgentRun`, `Turn`, `ContextBlock`, `AnalysisResult`) provider-agnostic. OpenAI compatibility is a doorway, not the architecture.
- Do **not** promise automatic optimization where Signalglass only reports recommendations.
- Do **not** store full raw payloads, secrets, or API keys by default.
- Reference API keys by environment variable names, never store them directly.
- Every smell, recommendation, and report finding should explain what happened, why it matters, what evidence supports it, and what to inspect or try next.

## Architecture boundaries

- Keep provider-specific logic out of `@signalglass/core`.
- Keep ingress/network logic out of `@signalglass/core`.
- Keep persistence/storage logic out of `@signalglass/core`.
- OpenAI-compatible shapes must not become the internal data model.
- Provider adapters live in `@signalglass/providers`.
- Ingress servers live in `apps/ingress`.
- Storage implementations live in `@signalglass/storage`.

## Code style

- Keep types explicit and domain-focused.
- Prefer readable, boring TypeScript over clever abstractions.
- Avoid magic numbers; put thresholds and heuristics in named constants.
- Avoid claiming exact token counts while using approximate estimation.

## Security rules

Never commit, log, or store:

- API keys or tokens.
- Authorization headers.
- Secrets or credentials.
- Full raw payload captures.
- Trace dumps.
- Local SQLite databases or `.signalglass/` data directories.
- `.env` files (except `.env.example`).

API keys must be referenced by environment variable name and resolved at runtime only.

## Test/build/commit expectations

- Add or update tests with behavior changes.
- Use Vitest. Prefer unit tests for domain logic and smoke tests for report generation.
- Run `pnpm test` before committing implementation work.
- Run `pnpm build` before committing implementation work.
- Both must pass.
- Commit with a clear message that references the spec, e.g. `Implement spec 006: OpenAI-compatible ingress`.

## Scope creep

- Do not refactor unrelated code while implementing a spec.
- Do not add new dependencies unless justified and documented.
- Do not expand a spec's acceptance criteria without updating the spec first.
- If a change feels outside the target spec, stop and ask.

## Documentation

- Update docs when project concepts change.
- Keep `docs/product-brief.md`, `docs/product-principles.md`, `docs/ui-vision.md`, `docs/versioning.md`, `docs/report-contract.md`, `docs/architecture.md`, `docs/roadmap.md`, `docs/trace-model.md`, `docs/provider-config.md`, `docs/ingress.md`, `docs/privacy.md`, `docs/views.md`, `docs/mvp-plan.md`, `docs/glossary.md`, `docs/decisions/`, and `specs/` aligned with the code.

## Dependencies

- Keep dependencies minimal unless justified.
- Favor workspace packages over external packages for Signalglass-specific logic.
