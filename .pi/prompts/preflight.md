# Preflight check before implementing a Signalglass spec

Run this before starting implementation work. Do not modify files unless cleanup is required.

## Input

Target spec path (optional): `{{specPath}}`

## Checks

1. Print current git branch.
2. Print latest commit hash and message.
3. Run `git status --short`.
4. Run `pnpm test`.
5. Run `pnpm build`.
6. Verify `AGENTS.md` exists.
7. Verify `specs/000-index.md` exists.
8. If `{{specPath}}` is provided, verify it exists.

## Look for problems

Flag any of the following:

- Uncommitted changes that are not part of the planned work.
- `node_modules/`, `dist/`, `build/`, `*.tsbuildinfo`, `.env`, `.signalglass/`, `data/`, `*.sqlite`, `*.sqlite3`, `*.db`, trace dumps, or payload captures appearing in `git status`.
- Failing tests or build.
- Missing `AGENTS.md`, `specs/000-index.md`, or target spec.

## Report

Return:

- Current repo state
- Whether it is safe to proceed
- Cleanup needed before coding
- Recommended next action
