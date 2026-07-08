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

## TraceEvent
A single event in a trace. Current event types include `message`, `instruction`, `context`, `transformation`, `tool_call`, `tool_result`, `provider_request`, `provider_response`, `provider_error`, `inference`, and `egress_response`.

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
