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
- [ ] Required tests are present and passing.
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

## Report

Return:

- Pass/fail summary
- Findings by severity (critical, warning, note)
- File references where possible
- Recommended fixes
- Whether the spec status in `specs/000-index.md` is appropriate
- Suggested next prompt
