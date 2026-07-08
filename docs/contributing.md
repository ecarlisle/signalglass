# Contributing to Signalglass

Thank you for contributing to Signalglass. This document covers the basics of getting started; the detailed rules for working in this repo are in [`AGENTS.md`](../AGENTS.md).

## Spec-driven workflow

Signalglass is built from implementation specs in the `specs/` directory. Before changing code:

1. Read [`AGENTS.md`](../AGENTS.md).
2. Read [`specs/000-index.md`](../specs/000-index.md).
3. Read the target spec and every doc it references.

Only specs marked **Accepted** should be implemented. Do not expand a spec's scope without updating the spec first.

## Branch and pull request workflow

All spec implementation work happens on a spec-specific branch. Do not commit spec implementation directly to `main`.

Branch names use this pattern:

```text
spec/<spec-number>-<short-name>
```

For example:

```text
spec/006-ingress-openai-compatible
```

Steps:

1. Confirm the working tree is clean and you are on the latest `main`.
2. Create and check out the spec branch.
3. Implement only the target spec.
4. Run `pnpm test` and `pnpm build`.
5. Commit only if both pass.
6. Push the branch and open a GitHub pull request.
7. Do not merge the PR — the reviewer will merge after review.

For the full rules, see the **Branch and PR workflow** section in [`AGENTS.md`](../AGENTS.md).

## Approval

Before a human merges a spec PR, run the final read-only approval prompt in [`.pi/prompts/approve-pr.md`](../.pi/prompts/approve-pr.md). The Approver only reports `MERGE` or `DO NOT MERGE`; the human performs the actual merge. See the **Approval step** section in [`AGENTS.md`](../AGENTS.md) for details.

## Model routing

This project recommends role-specific Pi models. See the **Model routing** section in [`AGENTS.md`](../AGENTS.md) for the defaults and instructions. Each workflow prompt in [`.pi/prompts/`](../.pi/prompts/) lists its recommended model in a header.

## Test expectations

Every spec implementation must include tests that map to the spec's acceptance criteria. A spec is not complete until its required tests exist, pass, and cover the acceptance criteria. See the **Test expectations** section in [`AGENTS.md`](../AGENTS.md) for the full rules.

## Development commands

- `pnpm install` — install dependencies.
- `pnpm test` — run the test suite.
- `pnpm build` — build all packages and apps.

## Questions?

If a change feels outside the target spec or the rules in [`AGENTS.md`](../AGENTS.md), stop and ask before proceeding.
