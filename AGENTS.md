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

## Branch and PR workflow

Implementation work must happen on a spec-specific branch. Do not commit directly to `main` for spec implementation.

Branch names must use this pattern:

```text
spec/<spec-number>-<short-name>
```

Example:

```text
spec/006-ingress-openai-compatible
```

Before creating a branch:

- Confirm the working tree is clean.
- Start from the latest `main`.

On the branch:

- Implement only the target spec.
- Run `pnpm test`.
- Run `pnpm build`.
- Commit only if both pass.
- Push the branch.
- Open a GitHub pull request.
- Do not merge the PR; the human reviewer will review and merge.

If GitHub CLI authentication or permissions are unavailable, stop after committing locally and report the exact command failure plus the manual commands needed to push and open the PR.

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

## Test expectations

Every spec implementation must include tests that map to the target spec's acceptance criteria. A spec may not be marked **Implemented** unless:

- Its required tests exist.
- Its acceptance criteria are covered by tests.
- `pnpm test` passes.
- `pnpm build` passes.

Use Vitest. Prefer unit tests for domain logic and smoke tests for report generation.

When a spec introduces or changes any of the following, add fixture or contract tests for the serialized shape or output:

- Public JSON shapes.
- Adapter output.
- Report contracts.
- CLI output.
- Trace schemas.
- Provider config schemas.
- Storage schemas.
- Redaction behavior.

Add regression tests for bugs fixed during implementation.

Do not weaken or remove existing tests unless the spec explicitly requires a contract change. If a test must be changed because a contract changed, explain that in the PR body.

## Test/build/commit expectations

- Follow the **Test expectations** section above.
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
