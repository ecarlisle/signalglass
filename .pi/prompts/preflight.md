# Preflight check before implementing a Signalglass spec

Recommended model: GLM-5.2 or Qwen3.7 Max

Run this before starting implementation work. Do not modify files unless cleanup is required.

## Input

Target spec path (optional): `{{specPath}}`
Implementation intent (optional): `{{intent}}` — set to `implementation` if the goal is to implement the spec.

## Checks

1. Print current git branch.
2. Print latest commit hash and message.
3. Run `git status --short`.
4. Run `git remote -v`.
5. Run `gh auth status`.
6. Check whether the current branch is `main`.
7. Check whether the working tree is clean.
8. If network access is available, check whether local `main` is up to date with `origin/main`.
9. Run `pnpm test`.
10. Run `pnpm build`.
11. Verify `AGENTS.md` exists.
12. Verify `specs/000-index.md` exists.
13. If `{{specPath}}` is provided, verify it exists.
14. If `{{intent}}` is `implementation` and `{{specPath}}` is provided, verify the target spec has status **Accepted**.

## Look for problems

Flag any of the following:

- Uncommitted changes that are not part of the planned work.
- `node_modules/`, `dist/`, `build/`, `*.tsbuildinfo`, `.env`, `.signalglass/`, `data/`, `*.sqlite`, `*.sqlite3`, `*.db`, trace dumps, or payload captures appearing in `git status`.
- Failing tests or build.
- Missing `AGENTS.md`, `specs/000-index.md`, or target spec.
- Current branch is not `main` when starting implementation.
- Working tree is not clean when starting implementation.
- Local `main` is behind `origin/main` when network access is available.
- Target spec does not exist.
- Target spec is not **Accepted** when the intent is implementation.

## Report

Return:

- Current repo state
- Whether it is safe to proceed
- Cleanup needed before coding
- Recommended next action
