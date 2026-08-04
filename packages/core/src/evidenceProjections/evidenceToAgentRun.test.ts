/**
 * Tests: canonical evidence → legacy `AgentRun` composed projection
 * (Spec 014 §6.1 direction 3, §6.2 composition rules). Fixed, in-memory
 * authoritative `EvidenceRecord` inputs built through the public
 * `@signalglass/evidence` contract.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { evidenceToAgentRun } from './evidenceToAgentRun.js';
import { evidenceToLegacyTrace } from './evidenceToLegacyTrace.js';
import { legacyTraceToAgentRun } from './legacyTraceToAgentRun.js';
import * as legacyModule from './legacyTraceToAgentRun.js';
import {
  EVIDENCE_TO_AGENT_RUN_PROJECTION_VERSION,
  PROJECTION_ISSUE_CODES,
} from './types.js';
import {
  buildRecord,
  minimalObservations,
  obs,
  T0,
  T1,
  T2,
  T3,
} from './testHelpers.js';
import type { EvidenceRecord } from '@signalglass/evidence';

// Wrap the second stage in a controllable mock so the second-stage-failure
// composition branch is testable; default behavior passes through.
vi.mock('./legacyTraceToAgentRun.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./legacyTraceToAgentRun.js')>();
  return { ...actual, legacyTraceToAgentRun: vi.fn(actual.legacyTraceToAgentRun) };
});

const SECRET = 'sk-composed-secret-xyz';
const NATIVE_RESPONSE_BODY = 'provider-native-response-body-sentinel';

function recordWithSecret(): EvidenceRecord {
  return buildRecord([
    obs({ observationId: 'z0', eventId: 'evt-start', seq: 0, kind: 'interaction_start', capturedAt: T0 }),
    obs({
      observationId: 'z1', eventId: 'evt-req', seq: 1, kind: 'model_request',
      capturedAt: T1, observationRole: 'client_sent',
      payload: {
        requestEnvelope: {
          model: 'gpt-4o', provider: 'openai', providerNativeFidelity: 'structurally_faithful',
          providerNative: { authorization: SECRET },
        },
      },
    }),
    obs({
      observationId: 'z2', eventId: 'evt-resp', seq: 2, kind: 'model_response',
      capturedAt: T2, observationRole: 'provider_reported',
      payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', providerNative: { text: NATIVE_RESPONSE_BODY } } },
    }),
    obs({ observationId: 'z3', eventId: 'evt-end', seq: 3, kind: 'interaction_end', capturedAt: T3 }),
  ]);
}

describe('evidenceToAgentRun — composition', () => {
  beforeEach(() => {
    vi.mocked(legacyModule.legacyTraceToAgentRun).mockClear();
  });

  it('composes both stages into an AgentRun view with concatenated stage-order mappings', () => {
    const record = buildRecord(minimalObservations());
    const result = evidenceToAgentRun(record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.report.projectionVersion).toBe(EVIDENCE_TO_AGENT_RUN_PROJECTION_VERSION);
    expect(result.report.sourceSchemaVersion).toBe('1.0.0');

    const stages = result.report.mappings.map((m) => m.stage);
    const firstStageEnd = stages.lastIndexOf('evidence_to_legacy_trace');
    const secondStageStart = stages.indexOf('legacy_trace_to_agent_run');
    // Stage-ordered: all evidence_to_legacy_trace mappings precede the
    // legacy_trace_to_agent_run mappings, and both stages are present.
    expect(firstStageEnd).toBeGreaterThanOrEqual(0);
    expect(secondStageStart).toBe(firstStageEnd + 1);

    // Both stages were invoked.
    expect(vi.mocked(legacyModule.legacyTraceToAgentRun)).toHaveBeenCalledTimes(1);
  });

  it('produces a view equivalent to explicit manual composition', () => {
    const record = buildRecord(minimalObservations());
    const composed = evidenceToAgentRun(record);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;

    const first = evidenceToLegacyTrace(record);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = legacyTraceToAgentRun(first.view);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(composed.view).toEqual(second.view);
    expect(composed.report.mappings).toEqual([
      ...first.report.mappings,
      ...second.report.mappings,
    ]);
  });

  it('does not invoke the second stage when the first stage fails', () => {
    const result = evidenceToAgentRun(null as unknown as EvidenceRecord);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]!.code).toBe(PROJECTION_ISSUE_CODES.invalidEvidenceRecord);
    expect(result.issues[0]!.stage).toBe('evidence_to_legacy_trace');
    expect(result.report.mappings).toEqual([]);
    expect(vi.mocked(legacyModule.legacyTraceToAgentRun)).not.toHaveBeenCalled();
  });

  it('concatenates first-stage mappings with second-stage mappings and issues on second-stage failure', () => {
    const record = buildRecord(minimalObservations());
    const first = evidenceToLegacyTrace(record);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // The second stage records at least one mapping before it fails.
    const secondStageMapping = {
      path: 'events[999]',
      stage: 'legacy_trace_to_agent_run' as const,
      outcome: 'unavailable' as const,
      reason: 'second-stage mapping recorded before validation failure',
    };
    vi.mocked(legacyModule.legacyTraceToAgentRun).mockImplementationOnce(() => ({
      ok: false as const,
      report: {
        projectionVersion: 'test',
        sourceSchemaVersion: 'legacy-trace-v0',
        mappings: [secondStageMapping],
      },
      issues: [
        {
          path: 'events',
          stage: 'legacy_trace_to_agent_run' as const,
          code: PROJECTION_ISSUE_CODES.invalidEventCollection,
          message: 'Cannot build an AgentRun view: the legacy trace has an absent or invalid events collection.',
        },
      ],
    }));

    const result = evidenceToAgentRun(record);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    // All first-stage mappings precede the second-stage mapping; the composed
    // failure report retains both stages' mappings in stage order.
    expect(result.report.mappings).toEqual([
      ...first.report.mappings,
      secondStageMapping,
    ]);
    expect(result.issues[0]!.stage).toBe('legacy_trace_to_agent_run');
    expect(result.issues[0]!.code).toBe(PROJECTION_ISSUE_CODES.invalidEventCollection);
    expect(result.report.projectionVersion).toBe(EVIDENCE_TO_AGENT_RUN_PROJECTION_VERSION);
    // Composed sourceSchemaVersion stays the canonical record version.
    expect(result.report.sourceSchemaVersion).toBe('1.0.0');
  });
});

describe('evidenceToAgentRun — loss, determinism, safety', () => {
  it('leaves token fields unavailable (no invented token counts)', () => {
    const record = buildRecord([
      obs({ observationId: 'z0', eventId: 'evt-start', seq: 0, kind: 'interaction_start', capturedAt: T0 }),
      obs({
        observationId: 'z1', eventId: 'evt-usage', seq: 1, kind: 'model_usage',
        capturedAt: T1, observationRole: 'provider_reported',
        payload: {
          usage: {
            evidenceStatus: 'captured',
            inputTokens: { value: 3, evidenceStatus: 'captured' },
            outputTokens: { value: 1, evidenceStatus: 'captured' },
          },
        },
      }),
      obs({ observationId: 'z2', eventId: 'evt-end', seq: 2, kind: 'interaction_end', capturedAt: T2 }),
    ]);
    const result = evidenceToAgentRun(record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.outputTokens).toBeUndefined();
    for (const turn of result.view.turns) {
      expect(turn.outputTokens).toBeUndefined();
      for (const block of turn.contextBlocks) {
        expect(block.estimatedTokens).toBeUndefined();
      }
    }
    // The composed report inherits the first stage's token-unavailability loss.
    expect(
      result.report.mappings.some((m) => m.reason.includes('token accounting')),
    ).toBe(true);
  });

  it('does not leak provider-native bodies or authorization material', () => {
    const result = evidenceToAgentRun(recordWithSecret());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The provider-native secret value and the provider-native response body
    // must never appear in the composed AgentRun view.
    const serialized = JSON.stringify(result.view);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(NATIVE_RESPONSE_BODY);
    // The intermediate legacy trace also exposes neither sentinel.
    const legacy = evidenceToLegacyTrace(recordWithSecret());
    expect(legacy.ok).toBe(true);
    if (legacy.ok) {
      const legacySerialized = JSON.stringify(legacy.view);
      expect(legacySerialized).not.toContain(SECRET);
      expect(legacySerialized).not.toContain(NATIVE_RESPONSE_BODY);
    }
  });

  it('produces deeply equal views and reports across repeated calls', () => {
    const record = buildRecord(minimalObservations());
    expect(evidenceToAgentRun(record)).toEqual(evidenceToAgentRun(record));
  });

  it('does not mutate the input record', () => {
    const record = buildRecord(minimalObservations());
    const snapshot = JSON.stringify(record);
    evidenceToAgentRun(record);
    expect(JSON.stringify(record)).toBe(snapshot);
  });
});
