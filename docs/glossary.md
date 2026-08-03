# SignalGlass glossary

## Agent run
A single end-to-end session in which an AI coding agent interacts with a model to complete a task. A run contains one or more turns.

## Turn
A single exchange step in a run. A turn usually contains context sent to the model and may include messages, tool calls, tool outputs, or explicit context blocks.

## Context block
A normalized unit of context sent to the model during a turn. Each block has a source type (for example `file_content`, `tool_output`, `project_instruction`), content, and optional metadata.

## Source type
A classification describing where a context block came from, such as `system_instruction`, `project_instruction`, `user_message`, `tool_output`, `file_tree`, or `generated_artifact`.

## Context smell
A heuristic indicator that something in the context window may be wasteful, noisy, or poorly structured. Smells are observations, not proof of a bug.

## Token budget
A configurable threshold for token usage. SignalGlass can flag when a run, turn, source type, or single block exceeds a budget.

## Repeated context
Content that appears more than once across turns. Repeated context inflates token usage without adding new information.

## Tool output
Text produced by an external tool invoked by the agent, such as a build log, test result, or command output.

## Signal
Useful information extracted from an agent run. Signal categories include cost, relevance, behavior, comparison, and education.

## Offline Run Analysis
The first SignalGlass mode. Users analyze captured agent runs from JSON or parser inputs.

## Live Ingress Observability
The second SignalGlass mode. SignalGlass acts as an OpenAI-compatible ingress/proxy that captures traces, timeline events, provider requests/responses, token usage, transformations, and privacy boundaries as they happen.

## Trace
A live-captured session representing a complete provider exchange. A trace can be converted into an `AgentRun` for offline-style analysis.

> **Legacy v0.x — superseded by [Spec 013 — Evidence model](../specs/013-evidence-model.md).** Under the evidence model, a trace is the deterministic canonical view derived from an authoritative `EvidenceRecord`; it carries both `traceId` and `interactionId` at the top level (equal values; the equality is an invariant), with nested records referencing `traceId`.

## TraceEvent
A single event in a trace. Current event types include `message`, `instruction`, `context`, `transformation`, `tool_call`, `tool_result`, `provider_request`, `provider_response`, `provider_error`, `inference`, and `egress_response`.

> **Legacy v0.x — superseded by [Spec 013 — Evidence model](../specs/013-evidence-model.md).** Under the evidence model, the canonical event vocabulary is the provider-neutral `Event` (kinds in Spec 013 §3.1) with `observationRole` and `evidenceStatus`; `TraceEvent` describes the v0.x runtime vocabulary.

## Content phase
A label describing the role of content in an exchange: said, sent, transformed, requested, observed, generated, or returned.

## Provider adapter
A module that translates between a provider-native request/response format and the internal SignalGlass trace model.

## ProviderKind
The type of provider adapter: `openai-compatible`, `anthropic`, `gemini`, `ollama`, or `custom`.

## Savings opportunity
A potentially correctable pattern with an estimated token savings and confidence. Distinct from realized savings and recommendations.

## Realized savings
Tokens already saved by SignalGlass or the user, as opposed to opportunities that remain available.

## Evidence drawer
A planned UI surface that shows the raw blocks, turns, and token counts behind a specific finding. It helps users verify claims and learn from source data.

## Heuristic
A rule-of-thumb detection that is useful but not certain. SignalGlass labels heuristics clearly and avoids presenting them as facts.

## Evidence
An observed, recorded fact about an AI interaction (a payload, event, or envelope), with an explicit evidence status and observation boundary. Evidence is the unit of truth for the target architecture; see [Spec 013](../specs/013-evidence-model.md).

## Evidence primitive
A canonical TypeScript representation of a Spec 013 evidence record (trace envelope, span, event, request/response envelope, context artifact, context contribution, completeness record, or their vocabulary types), as defined by [Spec 014 — Evidence primitives](../specs/014-evidence-primitives.md) (Draft). Evidence primitives are added beside the existing v0.x runtime models, are provider-neutral, and carry runtime validation and JSON-safe serialization; they are not measurements or interpretations.

## Interaction
The enclosing logical AI exchange or task execution being observed (one agent step, one user turn). The domain entity whose evidence is serialized as exactly one authoritative `EvidenceRecord` containing one deterministic canonical trace view.

## Span
A structured segment of an interaction with a lifecycle (start/end): a model request, tool call, MCP call, retrieval, context-provider call, or context assembly. Spans carry hierarchy, timing, and status; events carry content.

## Event
A discrete observed occurrence attached to a span or trace root, carrying content, evidence status, and a deterministic sequence position (`seq`).

## Observation boundary
The declared scope of what a capture surface could and could not observe, recorded with the evidence. Claims are scoped to the boundary where they were observed.

## Evidence status
The state of an evidence payload: `captured`, `redacted`, `truncated`, `missing`, `unknown`, or `not_applicable`. `inferred` appears only on derived records. Statuses are never collapsed into `null` or omitted fields.

## Content hash
A SHA-256 digest (`sha256:` + 64 lowercase hex) whose input is the retained payload representation, hashed as bytes. The hashing path is selected from the artifact's own serialized fields — `contentFidelity`, `contentType`, `contentCanonicalizer` — never from an enclosing event or envelope: `byte_faithful` bytes are hashed directly (never treated as UTF-8 text); `structurally_faithful` JSON is canonicalized with RFC 8785 (JCS) and hashed as UTF-8; other structured formats use their declared versioned canonicalizer and its output encoding; when retained content exists but no supported deterministic canonicalizer is available, no hash is emitted and `contentHashUnavailableReason: "unsupported_canonicalizer"` is recorded instead. It hashes only retained payload content, never metadata, and never implies possession of discarded original content.

## Native content hash
A SHA-256 digest (`sha256:` + 64 lowercase hex) over the exact native byte sequence observed by a capture surface, before decoding, normalization, envelope construction, or serialization. Recorded on an envelope; required when fidelity is `byte_faithful` and the payload is `captured` (`byte_faithful` itself requires `evidenceStatus: "captured"`), optional on `structurally_faithful` envelopes when a transparent surface observed and retained the exact bytes, and forbidden when the exact bytes were not observed or retained (missing/unknown/not applicable/redacted/truncated). Equal to `contentHash` only when the retained representation is the exact observed byte sequence with no transformation; otherwise the two digests differ.

## Measurement record
A deterministic derivation over evidence (token counts, latency, duration, cost) with algorithm/version, input references, and configuration versions. Cost is a derivation, not evidence.

## Interpretation record
A labeled, optional, versioned judgment derived from measurements and evidence (for example, a smell or recommendation), with a checkable claim and an explicitly subjective confidence.

## Capture profile
A named, versioned bundle of policy references and configuration settings that selects collection rules, persistence rules, and export defaults or permitted export profiles (redaction, retention, and overrides included). It is a convenience bundling; collection, persistence, and export remain three independent policies. See [capture profiles](capture-profiles.md).

## Projection
A derived representation of evidence (for example, a Run, a legacy `Trace`/`AgentRun` shape, or a redacted export). Projections never alter or overwrite authoritative evidence.

## Trace completeness
A derived description of which evidence was captured, redacted, truncated, missing, or unknown for an interaction, including `seq` gaps (assigned sequence positions absent from retained evidence), boundary statements, and explicit `missing` records. Never invents evidence.
