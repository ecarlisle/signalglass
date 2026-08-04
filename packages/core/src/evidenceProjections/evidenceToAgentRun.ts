/**
 * Canonical evidence → legacy `AgentRun` view (Spec 014 §6.1 direction 3).
 *
 * Implemented as an explicit composition of `EvidenceToLegacyTrace` followed
 * by `LegacyTraceToAgentRun` (Spec 014 §6.2 "Composition"): the report
 * concatenates the two stages' mappings in stage order, each attributed with
 * its `stage` field, and the composed report's `sourceSchemaVersion` is the
 * canonical `EvidenceRecord` schema version.
 *
 * Composition failure behavior (Spec 014 §6.2):
 * - if `evidenceToLegacyTrace` fails, this returns `ok: false` with the
 *   first stage's report and issues and MUST NOT invoke the second stage;
 * - if the first stage succeeds but `legacyTraceToAgentRun` fails, this
 *   returns `ok: false` with the first stage's mappings plus the second
 *   stage's report and issues.
 *
 * Token fields remain `unavailable` until the measurement layer exists; this
 * projection never derives token counts from character counts and never
 * calls the legacy token estimator (Spec 014 §6.3).
 */
import type { AgentRun } from '../types.js';
import type { EvidenceRecord } from '@signalglass/evidence';
import { evidenceToLegacyTrace } from './evidenceToLegacyTrace.js';
import { legacyTraceToAgentRun } from './legacyTraceToAgentRun.js';
import { EVIDENCE_TO_AGENT_RUN_PROJECTION_VERSION } from './types.js';
import type {
  ProjectionMapping,
  ProjectionReport,
  ProjectionResult,
} from './types.js';

/**
 * Compose the canonical `EvidenceRecord` → legacy `AgentRun` view from the
 * two documented stages. Never throws on expected invalid or lossy input.
 */
export function evidenceToAgentRun(record: EvidenceRecord): ProjectionResult<AgentRun> {
  const legacyTraceResult = evidenceToLegacyTrace(record);

  if (!legacyTraceResult.ok) {
    // First-stage failure: return its report and issues; do not invoke the
    // second stage (Spec 014 §6.2).
    return {
      ok: false,
      report: {
        projectionVersion: EVIDENCE_TO_AGENT_RUN_PROJECTION_VERSION,
        sourceSchemaVersion:
          record != null && typeof record.evidenceSchemaVersion === 'string'
            ? record.evidenceSchemaVersion
            : 'unknown',
        mappings: legacyTraceResult.report.mappings,
      },
      issues: legacyTraceResult.issues,
    };
  }

  const agentRunResult = legacyTraceToAgentRun(legacyTraceResult.view);

  if (!agentRunResult.ok) {
    // Second-stage failure: concatenated first-stage mappings plus the
    // second stage's report and issues (Spec 014 §6.2).
    return {
      ok: false,
      report: {
        projectionVersion: EVIDENCE_TO_AGENT_RUN_PROJECTION_VERSION,
        sourceSchemaVersion: record.evidenceSchemaVersion,
        mappings: legacyTraceResult.report.mappings,
      },
      issues: agentRunResult.issues,
    };
  }

  // Success: concatenate mappings from both stages in stage order.
  const mappings: ProjectionMapping[] = [
    ...legacyTraceResult.report.mappings,
    ...agentRunResult.report.mappings,
  ];

  const report: ProjectionReport = {
    projectionVersion: EVIDENCE_TO_AGENT_RUN_PROJECTION_VERSION,
    sourceSchemaVersion: record.evidenceSchemaVersion,
    mappings,
  };

  return { ok: true, view: agentRunResult.view, report };
}
