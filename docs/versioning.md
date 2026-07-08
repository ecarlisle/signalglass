# SignalGlass versioning policy

SignalGlass uses [Semantic Versioning](https://semver.org/) (SemVer).

## Pre-1.0 stance

Until `v1.0.0`, SignalGlass is considered early and exploratory. The public API surface is still stabilizing, and breaking changes may occur between `0.x.0` releases. Breaking changes will be noted in release notes and, where possible, deprecated in a prior minor release.

## Version format

```
0.MINOR.PATCH
```

- **MINOR** — a named milestone or a set of backward-incompatible / significant feature changes.
- **PATCH** — bug fixes, documentation improvements, or small additive changes within a milestone.

## Public API surface

The following are considered public and will be kept stable once documented:

- The CLI command structure (`signalglass analyze ...`, `signalglass ingress ...`).
- The report contract (fields present in JSON and HTML reports).
- The normalized `AgentRun` schema and source-type enum.
- The `Trace` and `TraceEvent` schema.
- The parser adapter interface (input → normalized run).
- The provider adapter interface and `ProviderConfig` schema.

Internal implementation details, heuristic thresholds, and exact report formatting may change more freely.

## Reaching 1.0

SignalGlass will move to `v1.0.0` once the report contract, CLI, schema, docs, and adapter API have proven stable through real-world use and the project is confident about backward compatibility.
