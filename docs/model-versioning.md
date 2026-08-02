# Model versioning

Versioning rules for the evidence model and everything derived from it. The
normative contract is [Spec 013 §10](../specs/013-evidence-model.md). The goal:
**evidence remains interpretable without the current application version.**

## What is versioned

| Artifact | Versioned by | Recorded where |
|---|---|---|
| Evidence record schema | `evidenceSchemaVersion` (semantic) | Every trace and record |
| Capture profile | Profile name + version | Every trace (`captureProfile`) |
| Measurement algorithm | Algorithm name + version | Every measurement (`algorithm`) |
| Tokenizer registry | Registry id + version | Measurements that count tokens |
| Pricing table | Table id + version | Cost measurements |
| Interpretation labels | Label id + version | Every interpretation |
| Export shape | Export/projection version | Every export |

## Schema evolution rules

- **Additive by default.** Adding fields with defined defaults MUST NOT break
  readers of older records. Older fields MUST NOT change meaning in the same
  schema version.
- **Breaking changes** — removing a field, changing its semantics, or changing
  `evidenceStatus` semantics — require a new `evidenceSchemaVersion` and a
  documented projection from the old version to the new.
- Readers MUST NOT fail on unknown fields (forward tolerance); unknown fields
  are preserved, not dropped, when evidence is re-serialized.
- Records MUST be self-describing: the schema version is on the record, so
  decoding never depends on the exporting application's current build.

## Measurement determinism

- The same measurement over the same evidence, algorithm version, and
  configuration MUST produce the same value. Changing any input changes the
  result — and the versions of all three MUST be recorded.
- Token counts reference the tokenizer registry version used. Comparing counts
  across tokenizer versions is only valid when the versions are recorded and
  accounted for.
- Cost is a derivation: cost measurements reference the pricing table version
  and the token-count measurements they multiply. Price changes MUST NOT
  rewrite historical cost records; historical cost records keep the table
  version that produced them.

## Interpretation versioning

- Interpretation labels are versioned so their meaning is stable over time.
  Reinterpreting a label (for example, what counts as "repeated context")
  bumps the label version; old interpretations keep the old label version.
- Interpretations cite the measurement/evidence versions they consumed.

## Legacy v0.x records

- Legacy `AgentRun` and `Trace`/`TraceEvent` records are not canonical under
  Spec 013 but MUST remain readable. They are interpreted through documented
  projections (see [Spec 013 §11](../specs/013-evidence-model.md)).
- Projection output carries its own projection version and the schema version
  it was produced from, so consumers can tell which layer produced which shape.

## Pre-1.0 stance

SignalGlass is pre-1.0. The evidence schema is expected to evolve; the rules
above keep that evolution additive and readable. The pre-1.0 stance does not
relax the determinism rules for measurements, which are stable by contract.

## Related documentation

- [Spec 013 — Evidence model §10 (normative contract)](../specs/013-evidence-model.md)
- [Evidence model](evidence-model.md)
- [Capture profiles](capture-profiles.md)
- [Versioning](../docs/versioning.md) (repository-wide conventions)
