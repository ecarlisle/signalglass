# Spec 001: Workspace and package layout

## Status

Accepted

## Purpose

Define the pnpm monorepo structure so the project can be built, tested, and extended consistently.

## Scope

- Workspace configuration.
- Package and app boundaries.
- Build and test orchestration.

## Non-goals

- CI/CD pipelines.
- Deployment packaging.
- Public package publishing.

## Required files or modules

- `pnpm-workspace.yaml` listing `apps/*` and `packages/*`.
- Root `package.json` with `build`, `test`, and `dev` scripts.
- Root `tsconfig.base.json` shared by packages.
- Root `vitest.config.ts` with workspace aliases for each public package.

## Required packages and apps

| Path | Responsibility |
|---|---|
| `packages/core` | Domain model, token estimation, analysis, smells, recommendations, trace types. |
| `packages/parsers` | Offline format parsers (Signalglass JSON, OpenCode, future formats). |
| `packages/providers` | Provider configs and adapters. |
| `packages/reports` | Terminal, JSON, and static HTML report formatters. |
| `packages/storage` | SQLite persistence for traces and events (future). |
| `packages/cli` | Command-line entrypoint. |
| `apps/dashboard` | Interactive educational report viewer (future Observatory UI). |
| `apps/ingress` | OpenAI-compatible ingress server (future). |

## Required behavior

- Each package has its own `package.json`, `tsconfig.json`, and `src/index.ts`.
- Package exports point to `./dist/index.js` and `./dist/index.d.ts`.
- `pnpm -r build` compiles packages in dependency order.
- `pnpm test` runs Vitest across the workspace.
- Workspace aliases in `vitest.config.ts` let tests import packages by name during development.

## Acceptance criteria

- [ ] `pnpm install` succeeds.
- [ ] `pnpm build` succeeds for all packages.
- [ ] `pnpm test` succeeds for all packages.
- [ ] No circular dependencies between `core` and other packages.

## Tests

- Root `pnpm build` and `pnpm test` serve as integration smoke tests.

## References

- `docs/architecture.md`
- `vitest.config.ts`
