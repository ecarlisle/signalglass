# Implement one Signalglass spec

You are implementing a single spec for Signalglass. Do not implement adjacent specs unless explicitly requested.

## Input

Target spec path: `{{specPath}}`

## Required reading order

1. `AGENTS.md`
2. `specs/000-index.md`
3. The target spec at `{{specPath}}`
4. Every doc and spec referenced by the target spec

## Determine spec identity

From `{{specPath}}`:

1. Extract the spec number from the filename or the spec heading.
2. Derive the short name from the filename (the part after the spec number), e.g. `006-ingress-openai-compatible.md` → `ingress-openai-compatible`.
3. Read the spec's **Status** section.

If the target spec is not **Accepted**, stop and report that it must be accepted before implementation.

## Branch and implementation

1. Confirm the working tree is clean and you are on `main`.
2. Pull the latest `main`.
3. Create and check out a branch named:

   ```text
   spec/<spec-number>-<short-name>
   ```

4. Implement only the target spec.
5. Preserve the existing offline analyzer behavior.
6. Keep provider-specific logic out of `@signalglass/core`.
7. Keep ingress/network logic out of `@signalglass/core`.
8. Keep persistence/storage logic out of `@signalglass/core`.
9. OpenAI-compatible shapes must not become the internal data model.
10. Raw payload capture must remain opt-in.
11. API keys must be referenced by environment variable name and never stored directly.
12. Add or update tests for the new behavior.
13. Avoid unrelated refactors.
14. If the spec is ambiguous, prefer the smallest implementation that satisfies the acceptance criteria.

## Testing rule

Before coding, read the target spec's **Tests** section (or equivalent) if it exists.

- Add or update all tests required by the spec.
- Map tests to the spec's acceptance criteria.
- Add regression tests for bugs fixed during implementation.
- Add fixture or contract tests for public JSON shapes, adapter outputs, report contracts, CLI outputs, trace schemas, provider config schemas, storage schemas, or redaction behavior introduced or changed by the spec.
- Do not mark the spec as **Implemented** unless the required tests exist and pass.
- Run `pnpm test`.
- Run `pnpm build`.
- Include the test and build results in the PR body.
- Mention any acceptance criteria that are not covered by tests and explain why.

## Verification

1. Run `pnpm test`.
2. Run `pnpm build`.
3. If both pass, all acceptance criteria are satisfied, and the required tests exist and pass, update the spec status to **Implemented**.
4. Commit with a message like:

   ```text
   Implement Spec 006: OpenAI-compatible ingress
   ```

## Push and pull request

1. Push the branch.
2. Open a GitHub PR using `gh pr create`.
3. Do not merge the PR.

Use this PR title:

```text
Implement Spec <number>: <title>
```

Use this PR body:

- Summary
- Spec implemented
- Files changed
- Tests added or updated
- Validation results
- Risks or follow-up work
- Confirmation that no secrets, raw payload captures, local databases, or generated artifacts were committed

## Report

Return a summary with:

- Files created
- Files modified
- Tests added or updated
- `pnpm test` result
- `pnpm build` result
- Spec status before and after
- Branch name
- Pull request URL
- Assumptions made
- Recommended next spec to implement
