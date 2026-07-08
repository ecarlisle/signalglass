# Spec 012: Versioning and releases

## Status

Accepted

## Purpose

Define the SemVer policy and public API surface for Signalglass.

## Scope

- Pre-1.0 versioning.
- Public API surfaces.
- Stability commitments.

## Non-goals

- Release automation.
- Changelog format.
- Publishing to npm.

## Required files or modules

- `docs/versioning.md`
- `package.json`

## Required types or contracts

Public API surfaces:

- CLI command structure.
- Report contract fields.
- `AgentRun`, `Turn`, `ContextBlock`, `SourceType` schema.
- `Trace`, `TraceEvent` schema.
- Parser adapter interface.
- Provider adapter interface and `ProviderConfig` schema.

## Required behavior

- Version format: `0.MINOR.PATCH`.
- `MINOR` increments for milestones or significant changes.
- `PATCH` increments for fixes and small additions.
- Breaking changes in `0.x` are allowed but must be documented.
- After `1.0.0`, the public API surfaces must remain backward-compatible.

## Acceptance criteria

- [ ] `docs/versioning.md` documents the policy.
- [ ] Public API surfaces are listed.
- [ ] `package.json` version reflects the current pre-1.0 state.

## Tests

- None required.

## References

- `docs/versioning.md`
- `docs/roadmap.md`
