/**
 * Canonical event kind → legacy `TraceEventType` mapping table (Spec 014
 * §6.2–§6.4; Spec 013 §11.2).
 *
 * For every canonical event kind this table records whether it is mapped
 * (to which legacy type), or has no legacy equivalent and is omitted
 * (`unavailable`). Kinds are never mapped to a semantically incorrect legacy
 * kind merely to retain them; kinds without a valid legacy equivalent are
 * reported `unavailable` and omitted from the view.
 *
 * Documented non-equivalences (Spec 014 §6.4): the legacy vocabulary has a
 * smaller, differently named event set; `seq`, `observationRole` and
 * `evidenceStatus` have no exact legacy fields; content hashes and
 * completeness records have no legacy equivalents.
 */
import type { EventKind } from '@signalglass/evidence';
import type { TraceEventType } from '../traces.js';

/** Outcome of mapping one canonical event kind. */
export type CanonicalEventMapping = {
  /** Legacy `TraceEventType` the kind maps to, when a valid equivalent exists. */
  legacyType: TraceEventType;
  /** Documented reason for the type mapping (and its loss). */
  reason: string;
};

/**
 * Canonical kinds with a valid legacy `TraceEventType` equivalent. Kinds
 * absent from this map have no legacy equivalent and are omitted with an
 * `unavailable` mapping.
 *
 * - `model_request` → `provider_request`: canonical provider-request control
 *   event; the legacy `provider_request` type is the equivalent control
 *   event. Content (envelopes, messages, provider-native bodies) is never
 *   inlined into the legacy excerpt surface.
 * - `model_response` / `model_response_chunk` → `provider_response`: legacy
 *   has no chunk distinction; streaming chunks collapse to a single
 *   `provider_response` (chunk indexing is lost). Provider-native content is
 *   never projected into legacy content excerpts.
 * - `model_usage` → `inference`: the legacy `inference` event is the closest
 *   equivalent usage carrier; numeric token accounting is NOT populated in
 *   this slice (measurement layer pending, Spec 014 §6.3) and is reported
 *   `unavailable`.
 * - `tool_call` / `tool_result` → `tool_call` / `tool_result`: equivalent
 *   content-bearing kinds; tool payloads are not inlined (no safe excerpt is
 *   synthesized) so the legacy analyzer skips them, which is reported.
 * - `context_assembled` → `context`: the assembled-context snapshot maps to
 *   the legacy `context` event; artifact references and content are not
 *   inlined (reported).
 * - `error` → `provider_error`: legacy has a single error type; the
 *   canonical `actor`, `lifecycleTarget`, and `lifecycleEffect` vocabulary is
 *   not representable (reported `unavailable`).
 */
export const CANONICAL_EVENT_MAPPINGS: Readonly<Partial<Record<EventKind, CanonicalEventMapping>>> = {
  model_request: {
    legacyType: 'provider_request',
    reason: 'canonical model_request maps to legacy provider_request control event; envelope and native content are not projected into legacy excerpts',
  },
  model_response: {
    legacyType: 'provider_response',
    reason: 'canonical model_response maps to legacy provider_response; provider-native content is not projected',
  },
  model_response_chunk: {
    legacyType: 'provider_response',
    reason: 'canonical model_response_chunk maps to legacy provider_response; legacy has no chunk type so the chunk boundary is lost',
  },
  model_usage: {
    legacyType: 'inference',
    reason: 'canonical model_usage maps to legacy inference event; numeric token accounting is unavailable until the measurement layer exists',
  },
  tool_call: {
    legacyType: 'tool_call',
    reason: 'canonical tool_call maps to legacy tool_call; tool arguments are not inlined into a legacy excerpt',
  },
  tool_result: {
    legacyType: 'tool_result',
    reason: 'canonical tool_result maps to legacy tool_result; tool output is not inlined into a legacy excerpt',
  },
  context_assembled: {
    legacyType: 'context',
    reason: 'canonical context_assembled maps to legacy context event; artifact references and assembled content are not inlined',
  },
  error: {
    legacyType: 'provider_error',
    reason: 'canonical error maps to legacy provider_error; canonical actor, lifecycleTarget, and lifecycleEffect are not representable in the legacy type',
  },
};

/**
 * Canonical kinds with NO valid legacy `TraceEventType` equivalent. These are
 * reported `unavailable` and omitted from the projected view:
 *
 * - lifecycle control events (`interaction_start`, `interaction_end`,
 *   `span_start`, `span_end`) — legacy has no control/lifecycle event type;
 *   mapping them to a content-bearing legacy kind would be semantically
 *   wrong.
 * - `mcp_request` / `mcp_result` — legacy has no MCP concept; mapping to
 *   `tool_call`/`tool_result` would conflate the MCP protocol boundary.
 * - `retrieval_request` / `retrieval_result` — legacy has no retrieval
 *   concept.
 * - `context_provider_request` / `context_provider_result` — legacy has no
 *   context-provider protocol concept.
 * - `cancelled` — legacy has no cancellation type.
 * - `retry` — legacy has no retry type.
 */
export const CANONICAL_EVENT_KINDS_WITHOUT_LEGACY_EQUIVALENT: ReadonlyArray<EventKind> = [
  'interaction_start',
  'interaction_end',
  'span_start',
  'span_end',
  'mcp_request',
  'mcp_result',
  'retrieval_request',
  'retrieval_result',
  'context_provider_request',
  'context_provider_result',
  'cancelled',
  'retry',
];

/**
 * Look up the legacy mapping for a canonical event kind. Returns `null` for
 * kinds with no valid legacy equivalent (they are omitted with an
 * `unavailable` mapping). This table is exhaustive over the closed canonical
 * event vocabulary (`EVENT_KINDS`); any kind not listed in
 * `CANONICAL_EVENT_MAPPINGS` is in `CANONICAL_EVENT_KINDS_WITHOUT_LEGACY_EQUIVALENT`.
 */
export function mapCanonicalEventKind(kind: EventKind): CanonicalEventMapping | null {
  return CANONICAL_EVENT_MAPPINGS[kind] ?? null;
}
