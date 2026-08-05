/**
 * Projection parity and loss verification (Spec 014 slice 4; acceptance
 * criterion 10).
 *
 * Every test case is a **paired fixture**: one canonical `EvidenceRecord`
 * built deterministically in memory through the public `@signalglass/evidence`
 * contract, and one legacy `Trace` describing the same observable
 * interaction. The semantic gate is exact deep equality:
 * `evidenceToLegacyTrace(record).view === legacyTrace` — this prevents the
 * two fixture halves from drifting apart. A passing snapshot of either path
 * alone is not parity; both paths must produce identical views, identical
 * analysis, and identical reports.
 *
 * Pipeline under test (real public APIs, no mocks):
 * - direct legacy path: `legacyTraceToAgentRun(trace)` → `analyzeRun(view)`
 *   → `renderTerminal` / `renderJson` / `renderHtml`;
 * - canonical path: `evidenceToAgentRun(record)` (the real composition of
 *   `evidenceToLegacyTrace` then `legacyTraceToAgentRun`) → `analyzeRun(view)`
 *   → the same three report functions.
 *
 * The analyzer reads the wall clock for `generatedAt`; time is frozen with
 * Vitest fake timers, the exact fixed timestamp is asserted, and complete
 * `AnalysisResult` values plus terminal/JSON/HTML strings are compared
 * exactly. No keys are deleted, no output is regex-scrubbed, and no findings,
 * IDs, order, tokens, smells, recommendations, or report text are
 * normalized. Deterministic synthesized ids are asserted, not removed.
 *
 * Honest exclusions (documented here and in docs/evidence-projection-matrix.md):
 * - a literally empty canonical `EvidenceRecord` (no observations) is not a
 *   supported valid record (`missing_interaction_start`); the valid
 *   incomplete interaction (lifecycle-only) is the paired incomplete case;
 * - multiple analyzer turns cannot be paired: the legacy converter splits on
 *   `egress_response`, which has no canonical event equivalent;
 * - canonical native bodies, context contributions/artifacts, tool payloads,
 *   and assembled context are never converted into `payloadRef.excerpt`, so
 *   no content-bearing analyzer parity is manufactured;
 * - tool/MCP/retrieval/context-provider events, errors/cancellation/retry,
 *   usage/token values, trace metadata, and conditions have no legacy
 *   equivalent or no additional analyzer/report behavior currently
 *   expressible; their projection/loss tests remain in
 *   `packages/core/src/evidenceProjections/`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeRun,
  createDefaultCapturePolicy,
  evidenceToAgentRun,
  evidenceToLegacyTrace,
  legacyTraceToAgentRun,
} from '@signalglass/core';
import type { AgentRun, Trace } from '@signalglass/core';
import { renderHtml, renderJson, renderTerminal } from './index.js';
import { normalizeEvidenceRecord } from '@signalglass/evidence';
import type {
  CaptureBoundary,
  EvidenceObservation,
  EvidenceRecord,
} from '@signalglass/evidence';

const T0 = '2025-06-01T14:00:00.000Z';
const T1 = '2025-06-01T14:00:00.200Z';
const T2 = '2025-06-01T14:00:00.400Z';
const T3 = '2025-06-01T14:00:03.000Z';
const T4 = '2025-06-01T14:00:03.200Z';
const T5 = '2025-06-01T14:00:03.400Z';

/** Frozen wall clock for `analyzeRun`'s `generatedAt`. */
const FIXED_NOW = '2025-06-01T14:00:00.000Z';

/** Harmless sentinel native content: must never reach views, analysis, reports, or projection diagnostics. */
const REQUEST_SENTINEL = 'parity-request-native-sentinel';
const RESPONSE_SENTINEL = 'parity-response-native-sentinel';
const CHUNK_SENTINEL = 'parity-chunk-native-sentinel';
const AUTH_SENTINEL = 'parity-auth-sentinel-value';

const PROFILE = { name: 'dev-basic', version: '1.2.0' };

function boundary(): CaptureBoundary {
  return {
    captureSurface: 'client_side',
    observationBoundary: 'application_constructed',
    declaredEventKinds: [
      'interaction_start',
      'interaction_end',
      'span_start',
      'span_end',
      'model_request',
      'model_response',
      'model_response_chunk',
      'model_usage',
      'tool_call',
      'tool_result',
      'mcp_request',
      'mcp_result',
      'retrieval_request',
      'retrieval_result',
      'context_provider_request',
      'context_provider_result',
      'context_assembled',
      'error',
      'cancelled',
      'retry',
    ],
    declaredSurfaces: ['client_side'],
    missingRecord: null,
  };
}

function obs(
  o: Partial<EvidenceObservation> & {
    observationId: string;
    eventId: string;
    seq: number;
    kind: EvidenceObservation['kind'];
  },
): EvidenceObservation {
  return {
    traceId: 'trace-1',
    spanId: null,
    capturedAt: T0,
    evidenceStatus: 'captured',
    observationRole: null,
    payload: null,
    rawCapturedAt: T0,
    ...o,
  };
}

/** Build an authoritative record through the public normalization contract. */
function buildRecord(
  observations: readonly EvidenceObservation[],
): EvidenceRecord {
  const result = normalizeEvidenceRecord(observations, boundary(), '1.0.0', {
    captureProfile: PROFILE,
  });
  if (!result.ok) {
    throw new Error(
      `test record invalid: ${result.issues.map((i) => `${i.code}@${i.path}`).join('; ')}`,
    );
  }
  return result.record;
}

// ---- Paired fixtures ----

type PairedFixture = {
  name: string;
  record: EvidenceRecord;
  legacyTrace: Trace;
};

/** A lifecycle-only canonical interaction: no legacy event equivalent. */
function lifecycleOnlyFixture(): PairedFixture {
  const record = buildRecord([
    obs({ observationId: 'l0', eventId: 'evt-interaction-start', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
  ]);
  const legacyTrace: Trace = {
    id: 'trace-1',
    startedAt: T0,
    mode: 'standard',
    capturePolicy: createDefaultCapturePolicy('standard'),
    status: 'started',
    events: [],
  };
  return { name: 'lifecycle-only', record, legacyTrace };
}

/** A completed single request/response with sentinel native content. */
function completedRequestResponseFixture(): PairedFixture {
  const record = buildRecord([
    obs({ observationId: 'o0', eventId: 'evt-interaction-start', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
    obs({
      observationId: 'o1', eventId: 'evt-span-start', seq: 1, spanId: 'sp-1',
      kind: 'span_start', capturedAt: T1, rawCapturedAt: T1,
      payload: { span: { kind: 'model', name: 'model:claude-sonnet-4', parentSpanId: null } },
    }),
    obs({
      observationId: 'o2', eventId: 'evt-req', seq: 2, spanId: 'sp-1',
      kind: 'model_request', capturedAt: T2, rawCapturedAt: T2,
      observationRole: 'client_sent',
      payload: {
        requestEnvelope: {
          model: 'claude-sonnet-4', provider: 'anthropic',
          providerNativeFidelity: 'structurally_faithful',
          messages: [{ role: 'user', content: 'hello' }],
          providerNative: { temperature: 0.2, body: REQUEST_SENTINEL, authorization: AUTH_SENTINEL },
        },
        contextContributions: [
          { artifactId: 'art-1', locator: { type: 'whole' }, position: 0, provenanceState: 'recorded' },
        ],
      },
    }),
    obs({
      observationId: 'o3', eventId: 'evt-resp', seq: 3, spanId: 'sp-1',
      kind: 'model_response', capturedAt: T3, rawCapturedAt: T3,
      observationRole: 'provider_reported',
      payload: {
        responseEnvelope: {
          providerNativeFidelity: 'structurally_faithful',
          finishReason: 'end_turn',
          providerNative: { content: RESPONSE_SENTINEL },
        },
      },
    }),
    obs({
      observationId: 'o4', eventId: 'evt-span-end', seq: 4, spanId: 'sp-1',
      kind: 'span_end', capturedAt: T4, rawCapturedAt: T4,
      payload: { durationMs: 3000 },
    }),
    obs({ observationId: 'o5', eventId: 'evt-interaction-end', seq: 5, kind: 'interaction_end', capturedAt: T5, rawCapturedAt: T5 }),
  ]);
  const legacyTrace: Trace = {
    id: 'trace-1',
    startedAt: T0,
    endedAt: T5,
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    mode: 'standard',
    capturePolicy: createDefaultCapturePolicy('standard'),
    status: 'success',
    events: [
      { id: 'evt-req', traceId: 'trace-1', timestamp: T2, type: 'provider_request', contentPhase: 'sent' },
      { id: 'evt-resp', traceId: 'trace-1', timestamp: T3, type: 'provider_response', contentPhase: 'observed' },
    ],
  };
  return { name: 'completed request/response', record, legacyTrace };
}

/** A streaming response: one request, multiple chunks (two equal timestamps). */
function streamingChunksFixture(): PairedFixture {
  const record = buildRecord([
    obs({ observationId: 'c0', eventId: 'evt-start', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
    obs({
      observationId: 'c1', eventId: 'evt-req', seq: 1, kind: 'model_request',
      capturedAt: T1, rawCapturedAt: T1, observationRole: 'client_sent',
      payload: {
        requestEnvelope: {
          model: 'claude-sonnet-4', provider: 'anthropic',
          providerNativeFidelity: 'structurally_faithful',
          messages: [{ role: 'user', content: 'hello' }],
          providerNative: { body: REQUEST_SENTINEL },
        },
        contextContributions: [
          { artifactId: 'art-1', locator: { type: 'whole' }, position: 0, provenanceState: 'recorded' },
        ],
      },
    }),
    obs({
      observationId: 'c2', eventId: 'evt-chunk-0', seq: 2, kind: 'model_response_chunk',
      capturedAt: T2, rawCapturedAt: T2, observationRole: 'provider_reported',
      payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', chunkIndex: 0, providerNative: { text: CHUNK_SENTINEL } } },
    }),
    // Equal timestamps, distinct seq — ordering must follow seq, not time.
    obs({
      observationId: 'c3', eventId: 'evt-chunk-1', seq: 3, kind: 'model_response_chunk',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'provider_reported',
      payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', chunkIndex: 1 } },
    }),
    obs({
      observationId: 'c4', eventId: 'evt-chunk-2', seq: 4, kind: 'model_response_chunk',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'provider_reported',
      payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', chunkIndex: 2 } },
    }),
    obs({ observationId: 'c5', eventId: 'evt-end', seq: 5, kind: 'interaction_end', capturedAt: T3, rawCapturedAt: T3 }),
  ]);
  const legacyTrace: Trace = {
    id: 'trace-1',
    startedAt: T0,
    endedAt: T3,
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    mode: 'standard',
    capturePolicy: createDefaultCapturePolicy('standard'),
    status: 'success',
    events: [
      { id: 'evt-req', traceId: 'trace-1', timestamp: T1, type: 'provider_request', contentPhase: 'sent' },
      { id: 'evt-chunk-0', traceId: 'trace-1', timestamp: T2, type: 'provider_response', contentPhase: 'observed' },
      { id: 'evt-chunk-1', traceId: 'trace-1', timestamp: T3, type: 'provider_response', contentPhase: 'observed' },
      { id: 'evt-chunk-2', traceId: 'trace-1', timestamp: T3, type: 'provider_response', contentPhase: 'observed' },
    ],
  };
  return { name: 'streaming chunks', record, legacyTrace };
}

const FIXTURES: ReadonlyArray<PairedFixture> = [
  lifecycleOnlyFixture(),
  completedRequestResponseFixture(),
  streamingChunksFixture(),
];

const ALL_SENTINELS = [REQUEST_SENTINEL, RESPONSE_SENTINEL, CHUNK_SENTINEL, AUTH_SENTINEL];

function expectNoSentinels(value: unknown, label: string): void {
  const serialized = JSON.stringify(value);
  for (const sentinel of ALL_SENTINELS) {
    expect(serialized, `${label} must not contain ${sentinel}`).not.toContain(sentinel);
  }
}

describe('paired projection gate', () => {
  it('rejects a literally empty canonical record (documented exclusion)', () => {
    const result = normalizeEvidenceRecord([], boundary(), '1.0.0', {
      captureProfile: PROFILE,
    });
    expect(result.ok).toBe(false);
  });

  it('gate: evidenceToLegacyTrace(record).view equals the paired legacy trace exactly', () => {
    for (const fixture of FIXTURES) {
      const result = evidenceToLegacyTrace(fixture.record);
      expect(result.ok, `${fixture.name}: projection must succeed`).toBe(true);
      if (!result.ok) continue;
      // Exact deep equality — the semantic gate that keeps the two halves
      // of each fixture from drifting.
      expect(result.view, `${fixture.name}: projected view === paired legacy trace`).toEqual(
        fixture.legacyTrace,
      );
    }
  });

  it('gate is meaningful: fixtures differ from each other', () => {
    expect(FIXTURES[0]!.legacyTrace).not.toEqual(FIXTURES[1]!.legacyTrace);
    expect(FIXTURES[1]!.legacyTrace).not.toEqual(FIXTURES[2]!.legacyTrace);
  });

  it('lifecycle-only: projected view is a started trace with an empty event array', () => {
    const fixture = FIXTURES[0]!;
    const result = evidenceToLegacyTrace(fixture.record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.status).toBe('started');
    expect(result.view.events).toEqual([]);
    expect(result.view.endedAt).toBeUndefined();
    expect(result.view.provider).toBeUndefined();
    expect(result.view.model).toBeUndefined();
  });
});

describe('agent-run parity', () => {
  it('legacyTraceToAgentRun(trace).view equals evidenceToAgentRun(record).view', () => {
    for (const fixture of FIXTURES) {
      const direct = legacyTraceToAgentRun(fixture.legacyTrace);
      const canonical = evidenceToAgentRun(fixture.record);
      expect(direct.ok, `${fixture.name}: direct path must succeed`).toBe(true);
      expect(canonical.ok, `${fixture.name}: canonical path must succeed`).toBe(true);
      if (!direct.ok || !canonical.ok) continue;
      expect(direct.view, `${fixture.name}: AgentRun parity`).toEqual(canonical.view);
      // The composed report carries both stages, stage-ordered.
      const stages = canonical.report.mappings.map((m) => m.stage);
      expect(stages.includes('evidence_to_legacy_trace')).toBe(true);
      expect(stages.includes('legacy_trace_to_agent_run')).toBe(true);
    }
  });

  it('lifecycle-only: projected AgentRun has zero turns', () => {
    const fixture = FIXTURES[0]!;
    const result = evidenceToAgentRun(fixture.record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.turns).toEqual([]);
    expect(result.view.outputTokens).toBeUndefined();
  });

  it('completed: one turn, provider/model inferred, deterministic ids asserted', () => {
    const fixture = FIXTURES[1]!;
    const result = evidenceToAgentRun(fixture.record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = result.view;
    expect(view.provider).toBe('anthropic');
    expect(view.model).toBe('claude-sonnet-4');
    expect(view.turns).toHaveLength(1);
    const turn = view.turns[0]!;
    // Deterministic synthesized ids (seed = trace id); asserted, not removed.
    expect(turn.id).toBe('pt-trace-1-0');
    expect(turn.contextBlocks.map((b) => b.id)).toEqual(['pt-trace-1-1', 'pt-trace-1-2']);
    expect(turn.contextBlocks.map((b) => b.sourceType)).toEqual(['unknown', 'unknown']);
    expect(turn.outputTokens).toBeUndefined();
    expect(view.outputTokens).toBeUndefined();
  });

  it('streaming chunks: one legacy provider_response per chunk, ordered by seq', () => {
    const fixture = FIXTURES[2]!;
    const result = evidenceToAgentRun(fixture.record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const direct = legacyTraceToAgentRun(fixture.legacyTrace);
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;
    expect(result.view).toEqual(direct.view);
    // One turn containing the request plus exactly three chunk events.
    expect(result.view.turns).toHaveLength(1);
    expect(result.view.turns[0]!.contextBlocks).toHaveLength(4);
  });
});

describe('analyzer parity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('analyzeRun over both paths produces identical complete AnalysisResults', () => {
    for (const fixture of FIXTURES) {
      const direct = legacyTraceToAgentRun(fixture.legacyTrace);
      const canonical = evidenceToAgentRun(fixture.record);
      expect(direct.ok && canonical.ok, `${fixture.name}: both paths succeed`).toBe(true);
      if (!direct.ok || !canonical.ok) continue;

      const analysisDirect = analyzeRun(direct.view);
      const analysisCanonical = analyzeRun(canonical.view);

      // Complete value equality (no keys deleted, no fields normalized).
      expect(analysisCanonical, `${fixture.name}: analyzer parity`).toEqual(analysisDirect);
      // The frozen clock is asserted exactly.
      expect(analysisCanonical.generatedAt).toBe(FIXED_NOW);
      expect(analysisDirect.generatedAt).toBe(FIXED_NOW);
      // Identical input again produces identical output (determinism). A
      // null pipeline result is a failure, never evidence of determinism:
      // two nulls must not satisfy the equality gate.
      const rerun = analyzeRun(canonical.view);
      expect(rerun, `${fixture.name}: analyzer rerun must not be null`).not.toBeNull();
      expect(rerun).toEqual(analysisCanonical);
    }
  });

  it('completed: analyzer facts match the projected one-turn interaction', () => {
    const fixture = FIXTURES[1]!;
    const result = evidenceToAgentRun(fixture.record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const analysis = analyzeRun(result.view);
    expect(analysis.runId).toBe('trace-1');
    expect(analysis.provider).toBe('anthropic');
    expect(analysis.model).toBe('claude-sonnet-4');
    expect(analysis.turnCount).toBe(1);
    expect(analysis.blockCount).toBe(2);
  });
});

describe('report parity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('terminal, JSON, and HTML render exactly equal strings across both paths', () => {
    for (const fixture of FIXTURES) {
      const direct = legacyTraceToAgentRun(fixture.legacyTrace);
      const canonical = evidenceToAgentRun(fixture.record);
      expect(direct.ok && canonical.ok, `${fixture.name}: both paths succeed`).toBe(true);
      if (!direct.ok || !canonical.ok) continue;

      const analysisDirect = analyzeRun(direct.view);
      const analysisCanonical = analyzeRun(canonical.view);

      expect(renderTerminal(analysisCanonical), `${fixture.name}: terminal parity`).toBe(
        renderTerminal(analysisDirect),
      );
      expect(renderJson(analysisCanonical), `${fixture.name}: JSON parity`).toBe(
        renderJson(analysisDirect),
      );
      expect(renderHtml(analysisCanonical), `${fixture.name}: HTML parity`).toBe(
        renderHtml(analysisDirect),
      );
    }
  });
});

describe('declared loss', () => {
  it('lifecycle-only: unavailable lifecycle mapping and unobserved terminal time are reported', () => {
    const fixture = FIXTURES[0]!;
    const result = evidenceToAgentRun(fixture.record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const mappings = result.report.mappings;
    // Unobserved terminal time (canonical "unknown" → legacy "started").
    const terminal = mappings.find((m) => m.path === 'trace.finishedAt');
    expect(terminal?.outcome).toBe('unavailable');
    expect(terminal?.reason).toContain('no observed terminal time');
    // The interaction_start lifecycle event has no legacy equivalent.
    const lifecycle = mappings.find(
      (m) => m.outcome === 'unavailable' && m.reason.includes('"interaction_start"'),
    );
    expect(lifecycle).toBeDefined();
    // Status vocabulary loss is declared (unknown → started).
    const status = mappings.find((m) => m.path === 'trace.status');
    expect(status?.outcome).toBe('partial');
    // The composed report carries both stages for the lifecycle-only input.
    const stages = new Set(mappings.map((m) => m.stage));
    expect(stages.has('evidence_to_legacy_trace')).toBe(true);
    expect(stages.has('legacy_trace_to_agent_run')).toBe(true);
  });

  it('completed: provider/model inference, phase approximation, and context loss are declared', () => {
    const fixture = FIXTURES[1]!;
    const result = evidenceToAgentRun(fixture.record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const mappings = result.report.mappings;
    const inferred = mappings.find((m) => m.path === 'trace.events[].requestEnvelope');
    expect(inferred?.outcome).toBe('inferred');
    expect(inferred?.reason).toContain('inferred');
    const phase = mappings.find((m) => m.path === 'trace.events[].observationRole');
    expect(phase?.outcome).toBe('partial');
    const contributions = mappings.find(
      (m) => m.path.endsWith('.contextContributions') && m.outcome === 'unavailable',
    );
    expect(contributions).toBeDefined();
  });

  it('streaming chunks: chunk kind/index loss is declared and no aggregation occurs', () => {
    const fixture = FIXTURES[2]!;
    const result = evidenceToAgentRun(fixture.record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const mappings = result.report.mappings;
    const chunkLoss = mappings.filter(
      (m) => m.reason.includes('chunk') && m.outcome === 'partial',
    );
    expect(chunkLoss.length).toBeGreaterThan(0);
    for (const mapping of chunkLoss) {
      expect(mapping.reason).toContain('no aggregation');
    }
    // No aggregation: the legacy view contains one event per chunk.
    const legacy = evidenceToLegacyTrace(fixture.record);
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    const providerResponses = legacy.view.events.filter((e) => e.type === 'provider_response');
    expect(providerResponses).toHaveLength(3);
    expect(legacy.view.events.map((e) => e.id)).toEqual([
      'evt-req',
      'evt-chunk-0',
      'evt-chunk-1',
      'evt-chunk-2',
    ]);
  });

  it('every non-exact mapping carries a concrete reason', () => {
    for (const fixture of FIXTURES) {
      const result = evidenceToAgentRun(fixture.record);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      for (const mapping of result.report.mappings) {
        if (mapping.outcome === 'exact') continue;
        expect(
          mapping.reason.length,
          `${fixture.name}: ${mapping.path} needs a loss reason`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe('determinism, immutability, and privacy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('repeated pipelines produce deeply equal results', () => {
    for (const fixture of FIXTURES) {
      const run = (): { view: AgentRun; analysis: ReturnType<typeof analyzeRun> } | null => {
        const canonical = evidenceToAgentRun(fixture.record);
        if (!canonical.ok) return null;
        return { view: canonical.view, analysis: analyzeRun(canonical.view) };
      };
      expect(run()).toEqual(run());
    }
  });

  it('does not mutate the input record', () => {
    for (const fixture of FIXTURES) {
      const snapshot = JSON.stringify(fixture.record);
      evidenceToLegacyTrace(fixture.record);
      evidenceToAgentRun(fixture.record);
      legacyTraceToAgentRun(fixture.legacyTrace);
      expect(JSON.stringify(fixture.record)).toBe(snapshot);
    }
  });

  it('sentinel native content never appears in views, analysis, reports, or projection diagnostics', () => {
    for (const fixture of FIXTURES) {
      const legacy = evidenceToLegacyTrace(fixture.record);
      expect(legacy.ok).toBe(true);
      if (!legacy.ok) continue;
      expectNoSentinels(legacy.view, `${fixture.name}: legacy trace view`);
      expectNoSentinels(legacy.report, `${fixture.name}: legacy trace report`);

      const canonical = evidenceToAgentRun(fixture.record);
      expect(canonical.ok).toBe(true);
      if (!canonical.ok) continue;
      expectNoSentinels(canonical.view, `${fixture.name}: AgentRun view`);
      expectNoSentinels(canonical.report, `${fixture.name}: composed report`);

      const direct = legacyTraceToAgentRun(fixture.legacyTrace);
      expect(direct.ok).toBe(true);
      if (!direct.ok) continue;
      expectNoSentinels(direct.view, `${fixture.name}: direct AgentRun view`);

      const analysis = analyzeRun(canonical.view);
      expectNoSentinels(analysis, `${fixture.name}: analysis`);
      expectNoSentinels(renderTerminal(analysis), `${fixture.name}: terminal`);
      expectNoSentinels(renderJson(analysis), `${fixture.name}: JSON`);
      expectNoSentinels(renderHtml(analysis), `${fixture.name}: HTML`);
    }
  });
});
