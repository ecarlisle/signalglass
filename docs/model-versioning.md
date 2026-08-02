# Model versioning

Versioning rules for the evidence model and everything derived from it. The
normative contract is [Spec 013 §10](../specs/013-evidence-model.md). The goal:
**evidence remains interpretable without the current application version.**

## What is versioned

| Artifact | Versioned by | Recorded where |
|---|---|---|
| Evidence record schema | `evidenceSchemaVersion` (semantic) | Every evidence record — directly, or inherited through its trace reference (child records that reference a trace inherit its schema version; standalone records without a trace reference carry their own) |
| Collection (capture) policy | Profile name + version | Trace capture context (`captureProfile`); records inherit unless overridden |
| Persistence policy | Policy version | Stored-record / storage-manifest metadata, never canonical raw evidence |
| Export policy | Policy version | Export package / export manifest, never canonical raw evidence |
| Measurement algorithm | Algorithm name + version | Every measurement (`algorithm`) |
| Tokenizer registry | Registry id + version | Measurements that count tokens |
| Pricing table | Table id + version | Cost measurements |
| Canonicalizer registry | Canonicalizer name + version | Artifacts that hash content (`contentCanonicalizer`; RFC 8785/JCS is the schema-fixed default for JSON, non-JSON formats MUST declare their canonicalizer) |
| Interpretation labels | Label id + version | Every interpretation |
| Export shape | Export/projection version | Every export |

## Schema evolution rules

- **Additive by default.** Adding fields with defined defaults MUST NOT break
  readers of older records. Older fields MUST NOT change meaning in the same
  schema version.
- **Compatibility runs both directions.** Older readers MUST tolerate unknown
  additive fields in newer records without failing. Newer readers MUST apply
  the defined default for fields absent from older records.
- **Round-trip preservation.** Unknown fields MUST be preserved on
  read-modify-write round trips: "ignore unknown fields" never permits
  discarding them when evidence is re-serialized.
- **Breaking changes** — removing a field, changing its semantics, or changing
  `evidenceStatus` semantics — require a new `evidenceSchemaVersion` and a
  documented projection from the old version to the new. A reader that cannot
  safely interpret a breaking version MUST refuse or require a projection; it
  MUST NOT silently misread.
- **Projections and migrations never rewrite authoritative evidence.**
  Projections are derived views; migration changes storage layout or indices,
  not the meaning of the records. Evidence is append-only: authoritative
  source records are not mutated in place. A schema migration produces a new
  version or a compatible projection and MAY store it, with provenance linking
  the new representation to its source records, the migration procedure, and
  the schema versions involved; the original remains preserved where retention
  policy permits. Deletion and retention requirements remain authoritative and
  MAY limit preservation. A reader that cannot safely interpret a breaking
  version MUST refuse it or use an explicit compatibility projection.
- Readers MUST NOT fail on unknown fields (forward tolerance); unknown fields
  are preserved, not dropped, when evidence is re-serialized.
- Records MUST be self-describing: the schema version is on the record, so
  decoding never depends on the exporting application's current build.

## Measurement determinism

- A measurement is a **deterministic function of its declared evidence inputs,
  algorithm version, configuration, and applicable registries or tables**
  (tokenizer registry, pricing table, thresholds). The same inputs, algorithm
  version, and configuration MUST produce the same value.
- Different inputs MAY produce the same value (collisions are not a defect).
  Changed inputs MUST be recorded with the result so it stays reproducible;
  determinism never requires that a changed input produce a changed result.
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
