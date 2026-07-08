# Review a Signalglass spec implementation

You are reviewing the implementation of a single spec. Do not modify files.

## Input

Target spec path: `{{specPath}}`

## Required reading order

1. `AGENTS.md`
2. `specs/000-index.md`
3. The target spec at `{{specPath}}`
4. Every doc and spec referenced by the target spec

## Checks

For the implementation of the target spec, verify:

- [ ] All acceptance criteria in the spec are satisfied.
- [ ] Each acceptance criterion has test coverage.
- [ ] Required tests from the spec are present.
- [ ] Fixture or contract tests exist for public JSON shapes, adapter outputs, report contracts, CLI outputs, trace schemas, provider config schemas, storage schemas, or redaction behavior when applicable.
- [ ] Existing tests were not weakened, removed, or skipped.
- [ ] Spec status was marked **Implemented** only after tests and build passed.
- [ ] No scope creep into adjacent specs.
- [ ] No OpenAI or provider-specific shapes leaked into `@signalglass/core`.
- [ ] No ingress/network code in `@signalglass/core`.
- [ ] No persistence/storage code in `@signalglass/core`.
- [ ] Raw payload capture is opt-in, not default.
- [ ] No API keys, authorization headers, secrets, raw payload captures, trace dumps, local databases, or `.signalglass/` data committed.
- [ ] No duplicate types or parallel concepts introduced.
- [ ] Existing offline analyzer behavior is preserved.
- [ ] No generated files (`dist/`, `*.tsbuildinfo`, etc.) are tracked.
- [ ] `pnpm test` and `pnpm build` pass.

## PR review checks

If reviewing a pull request, also verify:

- [ ] Branch name matches the spec, e.g. `spec/<number>-<short-name>`.
- [ ] PR title references the spec, e.g. `Implement Spec <number>: <title>`.
- [ ] PR body includes validation results.
- [ ] Spec status was updated to **Implemented** only if all acceptance criteria were satisfied.
- [ ] No unrelated files were changed.
- [ ] No secrets, `.env` files, trace dumps, local databases, generated artifacts, or raw payload captures were included.

## Report

Return:

- Pass/fail summary
- Findings by severity (critical, warning, note)
- File references where possible
- Recommended fixes
- Whether the spec status in `specs/000-index.md` is appropriate
- Suggested next prompt
