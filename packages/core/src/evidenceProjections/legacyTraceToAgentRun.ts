/**
 * Legacy `Trace`/`TraceEvent` → legacy `AgentRun` view (Spec 014 §6.1
 * direction 2; the documented legacy conversion required by Spec 013 §11.2).
 *
 * This projection uses the existing `traceToAgentRun` conversion behavior —
 * it does not create a competing interpretation of `AgentRun`. It preserves
 * the current turn-boundary convention, trace id / provider / model / agent /
 * task behavior, and the existing safe-excerpt and metadata-filtering rules
 * (including the prohibition on exposing secrets or full raw payloads).
 *
 * Determinism (Spec 014 §6.5): the wrapped conversion receives a
 * deterministic identifier generator so identical input produces identical
 * `AgentRun` views and reports; the synthesized turn/block identifiers are
 * reported `inferred` and are never presented as canonical evidence.
 *
 * An otherwise valid legacy trace with an empty `events` array yields an
 * empty valid `AgentRun` view; an absent, non-array, or otherwise invalid
 * event collection returns `ok: false` with a structured issue.
 */
import type { AgentRun, ContextBlock, Turn } from '../types.js';
import type { ContentPhase, Trace, TraceEvent, TraceEventType } from '../traces.js';
import { traceToAgentRun } from '../traceToAgentRun.js';
import { SOURCE_TYPES } from '../sourceTypes.js';
import {
  LEGACY_TRACE_SCHEMA_VERSION,
  LEGACY_TRACE_TO_AGENT_RUN_PROJECTION_VERSION,
  PROJECTION_ISSUE_CODES,
} from './types.js';
import type {
  ProjectionIssue,
  ProjectionMapping,
  ProjectionReport,
  ProjectionResult,
  ProjectionStage,
} from './types.js';

const STAGE: ProjectionStage = 'legacy_trace_to_agent_run';

const LEGACY_TRACE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'message',
  'instruction',
  'context',
  'transformation',
  'inference',
  'tool_call',
  'tool_result',
  'provider_request',
  'provider_response',
  'provider_error',
  'egress_response',
]);

const LEGACY_CONTENT_PHASES: ReadonlySet<string> = new Set([
  'said',
  'sent',
  'transformed',
  'requested',
  'observed',
  'generated',
  'returned',
]);

const LEGACY_SOURCE_TYPES: ReadonlySet<string> = new Set(SOURCE_TYPES);

/**
 * Projection-boundary validator for legacy `TraceEvent` entries, driven by a
 * declarative field table (object shape plus required `id`/`traceId`/
 * `timestamp`/`type` fields and the applicable optional `contentPhase`/
 * `sourceType` vocabulary). Messages never echo event contents or values;
 * failures anchor to `events[index]`. The legacy package has no public
 * runtime validator, so this small boundary check guards the wrapped legacy
 * conversion.
 */
const LEGACY_EVENT_FIELD_CHECKS: ReadonlyArray<{
  read: (event: Record<string, unknown>) => unknown;
  optional: boolean;
  invalid: (value: unknown) => boolean;
  message: string;
}> = [
  { read: (event) => event['id'], optional: false, invalid: (v) => typeof v !== 'string' || v.length === 0, message: 'legacy trace event is missing a valid id field' },
  { read: (event) => event['traceId'], optional: false, invalid: (v) => typeof v !== 'string' || v.length === 0, message: 'legacy trace event is missing a valid traceId field' },
  { read: (event) => event['timestamp'], optional: false, invalid: (v) => typeof v !== 'string' || v.length === 0, message: 'legacy trace event is missing a valid timestamp field' },
  { read: (event) => event['type'], optional: false, invalid: (v) => typeof v !== 'string' || !LEGACY_TRACE_EVENT_TYPES.has(v), message: 'legacy trace event type is not in the legacy TraceEventType vocabulary' },
  { read: (event) => event['contentPhase'], optional: true, invalid: (v) => typeof v !== 'string' || !LEGACY_CONTENT_PHASES.has(v), message: 'legacy trace event contentPhase is not in the legacy ContentPhase vocabulary' },
  { read: (event) => event['sourceType'], optional: true, invalid: (v) => typeof v !== 'string' || !LEGACY_SOURCE_TYPES.has(v), message: 'legacy trace event sourceType is not in the legacy SourceType vocabulary' },
];

function validateLegacyEventEntry(
  entry: unknown,
  index: number,
): ProjectionIssue | null {
  const path = `events[${index}]`;
  if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
    return {
      path,
      stage: STAGE,
      code: PROJECTION_ISSUE_CODES.invalidLegacyEvent,
      message:
        'legacy trace event is not a plain object; the entry cannot be projected',
    };
  }
  const event = entry as Record<string, unknown>;
  for (const field of LEGACY_EVENT_FIELD_CHECKS) {
    const value = field.read(event);
    if ((!field.optional || value !== undefined) && field.invalid(value)) {
      return {
        path, stage: STAGE, code: PROJECTION_ISSUE_CODES.invalidLegacyEvent, message: field.message,
      };
    }
  }
  return null;
}

/**
 * Deterministic identifier generator for the wrapped legacy conversion
 * (Spec 014 §6.5). A fresh generator is created per call, seeded with the
 * trace id so generated ids are deterministic per trace and do not collide
 * across different trace projections. Ids are stable, opaque, and never
 * presented as canonical evidence.
 */
function makeDeterministicIdGenerator(traceId: string): () => string {
  let counter = 0;
  return () => `pt-${traceId}-${counter++}`;
}

/**
 * Project a legacy `Trace`/`TraceEvent` view into a legacy `AgentRun` view.
 *
 * Returns `ok: false` when the trace lacks an array `events` collection
 * (absent, non-array, or otherwise invalid) or when any entry fails the
 * projection-boundary shape/vocabulary checks; an empty array is valid and
 * produces an empty `AgentRun` view. `traceToAgentRun` is never invoked
 * after validation fails. Never throws on expected invalid input.
 */
export function legacyTraceToAgentRun(trace: Trace): ProjectionResult<AgentRun> {
  if (trace == null || !Array.isArray(trace.events)) {
    const issues: ProjectionIssue[] = [
      {
        path: 'events',
        stage: STAGE,
        code: PROJECTION_ISSUE_CODES.invalidEventCollection,
        message:
          'Cannot build an AgentRun view: the legacy trace has an absent or invalid events collection.',
      },
    ];
    return {
      ok: false,
      report: {
        projectionVersion: LEGACY_TRACE_TO_AGENT_RUN_PROJECTION_VERSION,
        sourceSchemaVersion: LEGACY_TRACE_SCHEMA_VERSION,
        mappings: [],
      },
      issues,
    };
  }

  // Validate every entry before invoking the wrapped legacy conversion; the
  // legacy package has no public runtime validator (Spec 014 §9.1).
  const entryIssues: ProjectionIssue[] = [];
  for (let index = 0; index < trace.events.length; index += 1) {
    const issue = validateLegacyEventEntry(trace.events[index], index);
    if (issue != null) entryIssues.push(issue);
  }
  if (entryIssues.length > 0) {
    return {
      ok: false,
      report: {
        projectionVersion: LEGACY_TRACE_TO_AGENT_RUN_PROJECTION_VERSION,
        sourceSchemaVersion: LEGACY_TRACE_SCHEMA_VERSION,
        mappings: [],
      },
      issues: entryIssues,
    };
  }

  const view = traceToAgentRun(trace, {
    generateId: makeDeterministicIdGenerator(trace.id),
  });

  const mappings = buildProjectionMappings(trace, view);

  const report: ProjectionReport = {
    projectionVersion: LEGACY_TRACE_TO_AGENT_RUN_PROJECTION_VERSION,
    sourceSchemaVersion: LEGACY_TRACE_SCHEMA_VERSION,
    mappings,
  };

  return { ok: true, view, report };
}

/**
 * Build the ordered loss/identity report for a legacy trace → `AgentRun`
 * projection (Spec 014 §6.2–§6.5). Preserves the legacy field-exactness
 * semantics, reports synthesized identifiers as `inferred`, and discloses
 * the safe-excerpt and trace-metadata filtering boundaries as explicit loss.
 */
function buildProjectionMappings(
  trace: Trace,
  view: AgentRun,
): ProjectionMapping[] {
  const mappings: ProjectionMapping[] = [
    {
      path: 'id',
      stage: STAGE,
      outcome: 'exact',
      reason: 'AgentRun id preserves the legacy trace id',
    },
    {
      path: 'name',
      stage: STAGE,
      outcome: 'exact',
      reason: 'run name follows the legacy convention (agent, else task, else derived from trace id)',
    },
  ];
  if (view.model != null) {
    mappings.push({ path: 'model', stage: STAGE, outcome: 'exact', reason: 'model is preserved from the legacy trace' });
  } else {
    mappings.push({ path: 'model', stage: STAGE, outcome: 'unavailable', reason: 'legacy trace carries no model' });
  }
  if (view.provider != null) {
    mappings.push({ path: 'provider', stage: STAGE, outcome: 'exact', reason: 'provider is preserved from the legacy trace' });
  } else {
    mappings.push({ path: 'provider', stage: STAGE, outcome: 'unavailable', reason: 'legacy trace carries no provider' });
  }
  if (view.agent != null) {
    mappings.push({ path: 'agent', stage: STAGE, outcome: 'exact', reason: 'agent is preserved from the legacy trace' });
  } else {
    mappings.push({ path: 'agent', stage: STAGE, outcome: 'unavailable', reason: 'legacy trace carries no agent' });
  }
  if (view.task != null) {
    mappings.push({ path: 'task', stage: STAGE, outcome: 'exact', reason: 'task is preserved from the legacy trace' });
  } else {
    mappings.push({ path: 'task', stage: STAGE, outcome: 'unavailable', reason: 'legacy trace carries no task' });
  }

  // Turn-boundary convention preserved (legacy egress_response cycles).
  mappings.push({
    path: 'turns',
    stage: STAGE,
    outcome: 'exact',
    reason: 'turn grouping preserves the legacy egress_response cycle-boundary convention',
  });

  // Synthesized identifiers are deterministic and reported as inferred.
  view.turns.forEach((turn, turnIndex) => {
    mappings.push({
      path: `turns[${turnIndex}].id`,
      stage: STAGE,
      outcome: 'inferred',
      reason: 'turn identifier is deterministically synthesized by the projection; never presented as canonical evidence',
    });
    turn.contextBlocks.forEach((block, blockIndex) => {
      mappings.push({
        path: `turns[${turnIndex}].contextBlocks[${blockIndex}].id`,
        stage: STAGE,
        outcome: 'inferred',
        reason: 'context-block identifier is deterministically synthesized by the projection; never presented as canonical evidence',
      });
    });
  });

  // Context-block content is limited to safe excerpts carried by the trace.
  const contentBearing = countContentBearingBlocks(view);
  if (contentBearing > 0) {
    mappings.push({
      path: 'turns[].contextBlocks[].content',
      stage: STAGE,
      outcome: 'partial',
      reason: 'context-block content is limited to the legacy safe excerpts carried on the trace (payloadRef.excerpt); full payloads and secrets are never included',
    });
  } else {
    mappings.push({
      path: 'turns[].contextBlocks[].content',
      stage: STAGE,
      outcome: 'unavailable',
      reason: 'no safe excerpts are carried by the legacy trace events, so no context-block content is produced',
    });
  }

  // Trace metadata passes through the legacy sanitizer, which drops
  // secret-bearing and raw-payload keys; the filtering boundary is explicit.
  if (trace.metadata != null && Object.keys(trace.metadata).length > 0) {
    mappings.push({
      path: 'metadata.traceMetadata',
      stage: STAGE,
      outcome: 'partial',
      reason: 'legacy trace metadata is filtered to safe keys by the legacy sanitizer; secret-bearing and raw-payload keys are dropped and are never projected',
    });
  } else {
    mappings.push({
      path: 'metadata.traceMetadata',
      stage: STAGE,
      outcome: 'unavailable',
      reason: 'legacy trace carries no metadata, so no filtered trace metadata is projected',
    });
  }

  return mappings;
}

function countContentBearingBlocks(run: AgentRun): number {
  let count = 0;
  for (const turn of run.turns) {
    for (const block of turn.contextBlocks) {
      if (block.content.length > 0) count += 1;
    }
  }
  return count;
}

export type { Turn, ContextBlock };
