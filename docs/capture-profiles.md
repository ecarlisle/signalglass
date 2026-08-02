# Capture profiles and policy separation

Collection, persistence, and export are **three independent policies**. A
capture profile is a named, versioned bundle of one setting from each policy,
recorded at every capture point so evidence stays interpretable in the policy
context it was captured under. The normative contract is
[Spec 013 §9](../specs/013-evidence-model.md).

Why separate the three policies? Because they answer different questions:

- **Collection** — *what evidence do we observe and keep?*
- **Persistence** — *how long do we keep it, and what happens when it must go?*
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
- Purging by policy MUST be recorded in the affected traces' completeness
  records.

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
- Every trace records `captureProfile: { name, version }`.
- Profile definitions SHOULD be stored alongside evidence (or in a versioned
  registry) so a trace can be re-read without the current application build.

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
