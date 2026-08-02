# Capture profiles and policy separation

Collection, persistence, and export are **three independent policies**. A
capture profile is a named, versioned **bundle of policy references and
configuration settings**: it selects collection rules, persistence rules, and
export defaults or permitted export profiles, and may carry redaction
configuration, retention configuration, and environment-appropriate overrides.
It is a convenience bundling — it MUST NOT collapse the three policies into
one — and it is recorded at every capture point so evidence stays
interpretable in the policy context it was captured under. The normative
contract is [Spec 013 §9](../specs/013-evidence-model.md).

Why separate the three policies? Because they answer different questions:

- **Collection** — *what do we observe?*
- **Persistence** — *what is retained, for how long, and what happens when it must go?*
- **Export** — *what may leave the system, and in what shape?*

Changing one MUST NOT silently change another. A collection profile that starts
capturing full payloads should not force exports to include them; an export
profile that redacts secrets should not force persistence to redact them.

## Collection policy

Controls what is observed and how.

| Setting | Meaning |
|---|---|
| `surfaces` | Capture surfaces in effect: `client_side`, `ingress_proxy`, `tool`, `mcp`, `context_provider`. |
| `boundaries` | Observation roles collected: `application_constructed`, `client_sent`, `provider_reported`, `returned`. |
| `payloadCapture` | `full`, `excerpt`, or `none` per event kind. |
| `redactionRules` | Patterns/policies applied at capture (for example, `secrets-v1`). |
| `truncation` | Maximum stored length per payload kind; the boundary is recorded with the evidence. |
| `eventKinds` | Which canonical event kinds are collected (see Spec 013 §3.1). |

Rules:

- Redaction and truncation MUST be recorded on the affected payloads
  (`evidenceStatus: "redacted"` / `"truncated"` plus the rule or boundary).
- A surface that is not configured MUST NOT silently claim to have observed
  activity; it is recorded as `unobservable` with `unknown` status.
- The `captureProfile` name and version MUST be recorded on the trace.

## Persistence policy

Controls retention and the handling of evidence over time.

| Setting | Meaning |
|---|---|
| `retention` | How long evidence is kept (for example, `30d`, `indefinite`). |
| `durability` | Storage class / replication expectations. |
| `form` | Storage form (for example, raw records plus derived projections). |
| `deletion` | Administrative deletion rules. |
| `purging` | Automated purging rules (for example, by age or profile). |

Rules:

- Administrative deletion MUST produce a deletion record (tombstone) with a
  reason and scope, so completeness remains honest. Deleting evidence silently
  erases the ability to explain what happened.
- A deletion record is an **administrative record**, not evidence: it documents
  what was deleted, when, and under which policy; it does not reconstruct
  deleted evidence or restore trace completeness.
- The tombstone MUST NOT live only inside the deleted trace, which may itself
  be purged. Where policy and law permit, it is retained separately, outside
  the deleted trace, as a non-sensitive administrative record containing no
  deleted content, no sensitive payload data, no recoverable content hashes
  that would create disclosure risk, and no identifiers the applicable
  deletion requirement prohibits retaining.
- A tombstone MUST NOT retain the deleted content or any sensitive payload
  data.
- Where legal or privacy requirements demand deletion without retaining
  identifying metadata, the tombstone itself MUST be deleted; the persistence
  policy MUST state explicitly that no audit evidence and no later completeness
  reconstruction survives.
- Purging by policy MUST be recorded in the affected traces' completeness
  records where those traces survive; where the trace is purged entirely, the
  administrative deletion record carries the statement of the purge.

## Export policy

Controls what may leave the system and in what shape.

| Setting | Meaning |
|---|---|
| `projection` | The shape(s) allowed: raw evidence, redacted evidence, legacy `Trace`/`AgentRun` projections. |
| `exclusions` | Fields or payload kinds that MUST NOT be exported. |
| `redactions` | Redaction rules applied at export time (in addition to any capture-time redaction). |

Rules:

- Redacted exports are projections; they MUST NOT overwrite authoritative
  evidence.
- Exports MUST label the policy context they were produced under (profile name
  and version) and MUST NOT claim to show evidence the policy excluded.

## Profile versioning and recording

- Profiles are versioned (`name` + semantic version). A profile definition is
  immutable once used: changing a setting creates a new profile version so old
  traces remain interpretable in the context they were captured under.
- **Where policy versions are recorded** (Spec 013 §9.2):
  - The **collection** profile in effect is recorded on the trace
    (`captureProfile: { name, version }`) and inherited by its records unless
    a record-level override is declared.
  - The **persistence** policy version is recorded on stored-record or
    storage-manifest metadata written by the storage layer at storage time —
    never on canonical raw evidence.
  - The **export** policy version is recorded on the export package or export
    manifest — never on canonical raw evidence records; the trace is not an
    export projection.
- Profile definitions SHOULD be stored alongside evidence (or in a versioned
  registry) so a trace can be re-read without the current application build.
- **Evidence vs administrative metadata:** collection context (what was
  observed, under which profile, by which surface) is evidence metadata;
  persistence/export versions, storage timestamps, and deletion records are
  administrative metadata about operations on evidence and are recorded beside
  the evidence, never merged into payload status.

## Example profile

```json
{
  "name": "dev-standard",
  "version": "2.0.0",
  "collection": {
    "surfaces": ["client_side", "ingress_proxy"],
    "boundaries": ["application_constructed", "client_sent", "provider_reported", "returned"],
    "payloadCapture": { "model_request": "full", "model_response": "excerpt", "tool_result": "full" },
    "redactionRules": ["secrets-v1"],
    "truncation": { "maxLength": 8000, "appliesTo": ["model_response"] },
    "eventKinds": ["interaction_start", "interaction_end", "span_start", "span_end", "model_request", "model_response", "model_usage", "tool_call", "tool_result", "mcp_request", "mcp_result", "retrieval_request", "retrieval_result", "context_provider_request", "context_provider_result", "context_assembled", "error", "cancelled", "retry"]
  },
  "persistence": {
    "retention": "30d",
    "durability": "standard",
    "form": "raw-plus-projections",
    "deletion": "recorded-tombstone",
    "purging": "by-age"
  },
  "export": {
    "projection": ["redacted-evidence", "legacy-agentrun"],
    "exclusions": ["requestEnvelope.providerNative"],
    "redactions": ["secrets-v1"]
  }
}
```

## Related documentation

- [Spec 013 — Evidence model §9 (normative contract)](../specs/013-evidence-model.md)
- [Evidence model](evidence-model.md)
- [Model versioning](model-versioning.md)
- [Privacy](../docs/privacy.md)
