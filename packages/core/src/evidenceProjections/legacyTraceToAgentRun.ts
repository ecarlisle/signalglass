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
import type { Trace } from '../traces.js';
import { traceToAgentRun } from '../traceToAgentRun.js';
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

/**
 * Deterministic identifier generator for the wrapped legacy conversion
 * (Spec 014 §6.5). A fresh generator is created per call, so identical input
 * produces identical synthesized ids; ids are stable, opaque, and never
 * presented as canonical evidence.
 */
function makeDeterministicIdGenerator(): () => string {
  let counter = 0;
  return () => `pt-${counter++}`;
}

/**
 * Project a legacy `Trace`/`TraceEvent` view into a legacy `AgentRun` view.
 *
 * Returns `ok: false` when the trace lacks an array `events` collection
 * (absent, non-array, or otherwise invalid); an empty array is valid and
 * produces an empty `AgentRun` view. Never throws on expected invalid input.
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

  const view = traceToAgentRun(trace, {
    generateId: makeDeterministicIdGenerator(),
  });

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

  const report: ProjectionReport = {
    projectionVersion: LEGACY_TRACE_TO_AGENT_RUN_PROJECTION_VERSION,
    sourceSchemaVersion: LEGACY_TRACE_SCHEMA_VERSION,
    mappings,
  };

  return { ok: true, view, report };
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
