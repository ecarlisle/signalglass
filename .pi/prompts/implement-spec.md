# Implement one Signalglass spec

You are implementing a single spec for Signalglass. Do not implement adjacent specs unless explicitly requested.

## Input

Target spec path: `{{specPath}}`

## Required reading order

1. `AGENTS.md`
2. `specs/000-index.md`
3. The target spec at `{{specPath}}`
4. Every doc and spec referenced by the target spec

## Instructions

- Implement only what the target spec requires.
- Preserve the existing offline analyzer behavior.
- Keep provider-specific logic out of `@signalglass/core`.
- Keep ingress/network logic out of `@signalglass/core`.
- Keep persistence/storage logic out of `@signalglass/core`.
- OpenAI-compatible shapes must not become the internal data model.
- Raw payload capture must remain opt-in.
- API keys must be referenced by environment variable name and never stored directly.
- Add or update tests for the new behavior.
- Avoid unrelated refactors.
- If the spec is ambiguous, prefer the smallest implementation that satisfies the acceptance criteria.

## Verification

1. Run `pnpm test`.
2. Run `pnpm build`.
3. If both pass, update the spec status to **Implemented** when appropriate.
4. Commit with a clear message that references the spec, e.g.:
   `git add . && git commit -m "Implement spec 006: OpenAI-compatible ingress"`

## Report

Return a summary with:

- Files created
- Files modified
- Tests added or updated
- `pnpm test` result
- `pnpm build` result
- Spec status before and after
- Git commit hash
- Assumptions made
- Recommended next spec to implement
