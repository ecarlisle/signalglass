# ADR 0004: SignalGlass is evidence-first

## Status

Accepted

## Context

SignalGlass is being restarted as a disciplined observability platform for AI interactions. The current repository is valuable existing work, but its present architecture and terminology (the `Trace`/`TraceEvent` and `AgentRun` models, and optimization-oriented features such as smells, recommendations, and savings) grew from an earlier mission that mixed observation with optimization.

The new mission requires a clear foundation before any further model work:

- Observe, record, measure, visualize, compare, and replay AI interactions.
- Preserve the fidelity of application-visible requests, responses, tool activity, and context provenance.
- Keep observations, deterministic measurements, and interpretations separate.
- Avoid rewriting, summarizing, compressing, deduplicating, optimizing, or otherwise changing the interactions being measured.
- Treat prompt optimization and context transformation only as explicit experimental conditions or optional analysis — not as core behavior.
- Treat MCP, Graphify, retrieval systems, and other tools as independently observable systems.
- Make uncertainty and capture boundaries explicit. Do not claim to know hidden provider behavior.
- Treat raw captured evidence as authoritative; all metrics, visualizations, and explanations must be derived, versioned views.

The authoritative target-direction statement is `docs/architectural-foundation.md` (v0.1). This ADR records only the architectural decisions that are already established. It deliberately does **not** define the complete evidence schema; that belongs to a future evidence-model specification.

## Decision

SignalGlass adopts the following architectural decisions:

1. **Captured evidence is authoritative.** Raw captured evidence is the ground truth. All metrics, visualizations, and explanations are derived, versioned views over that evidence. No metric or explanation may be presented as if it were itself raw evidence.

2. **Observations, measurements, and interpretations are separate.**
   - **Observations** are captured facts (requests, responses, tool activity, context provenance).
   - **Measurements** are deterministic derivations over evidence: token counts, latency, durations, and cost. Cost is derived from measured usage multiplied by a **versioned pricing schedule** and lives in the measurement/derivation layer — not in the optional optimization-analysis module.
   - **Interpretations** are human-facing explanations or judgments (smells, recommendations, narrative). They are optional, clearly labeled, and never presented as measurements.
   Mixing these layers is an architecture violation.

3. **Capture boundaries and uncertainty are explicit.** Every capture surface declares what it observes and what it cannot see (for example, an HTTP proxy does not see client-side tool execution). Missing evidence is reported as missing; estimates and approximations are labeled; hidden provider behavior is never claimed.

4. **Core instrumentation must not transform semantic inputs.** The capture path must not rewrite, summarize, compress, deduplicate, or otherwise change the interactions being measured. Any transformation that occurs (for example, excerpting under a redacted profile) happens at a declared capture boundary and is recorded as such. Capture, persistence, and export are separate decisions: a metadata-only profile must not collect full payloads in the first place; a redacted profile may discard content at its declared capture boundary; full-fidelity capture is explicit, appropriately protected, and not the universal default.

5. **Optimization is optional experimental or analysis scope.** Prompt optimization and context transformation are explicit experimental conditions or optional analysis outputs that the user chooses to act on. They are never core behavior and never applied automatically.

6. **The repository will be migrated incrementally, not replaced.** The current v0.x models (`Trace`/`TraceEvent`, `AgentRun`/`Turn`/`ContextBlock`) and their specifications remain accurate records of what exists. They are labeled as legacy/current-state contracts and are no longer authoritative for the target architecture. A later accepted evidence-model specification will formally supersede them. New evidence primitives are added beside the existing models without requiring a rewrite of the current runtime.

## Consequences

### Positive

- The repository gains a stable, authoritative direction (`docs/architectural-foundation.md`) before any schema work begins.
- Existing code, tests, and documentation retain their value as accurate records of the v0.x implementation while the target architecture is built incrementally.
- Measurements (including cost) are kept deterministic and versioned, so results are reproducible and auditable.
- Interpretations become clearly optional, which prevents optimization framing from leaking into core behavior.

### Negative

- A parallel set of evidence primitives will coexist with the v0.x models for a transition period.
- Documentation currently framed around the `Trace`/`AgentRun` models and optimization vocabulary remains in the tree and may confuse readers until it is amended or labeled; this is accepted for the transition.

### Accepted trade-offs

- This ADR does not resolve concrete schema questions (span/event fields, versioning mechanics, capture-profile representation, streaming mechanics, cost pricing-schedule format, sequencing and clock specifics, storage migration mechanics). Those are deferred to the future evidence-model specification and its implementation.
- Formal supersession of legacy specifications is deferred until the evidence-model specification is accepted.

## Related documents

- `docs/architectural-foundation.md`
- `docs/assessments/2026-08-01-current-state.md`
- `README.md`
- `docs/roadmap.md`
- `specs/000-index.md`
- `docs/decisions/0001-observability-first.md`
- `docs/decisions/0002-two-modes.md`
