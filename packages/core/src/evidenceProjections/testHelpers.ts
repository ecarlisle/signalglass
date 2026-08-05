/**
 * Deterministic in-memory construction helpers for the projection test
 * suites (Spec 014 §9.2: fixed timestamps and caller-supplied ids; no
 * clocks, network, or random identifiers). Inputs are built through the
 * public `@signalglass/evidence` contract (`normalizeEvidenceRecord`); no
 * production ingress, storage, or capture code is involved.
 *
 * Test-only module; not exported from the package's public surface.
 */
import { normalizeEvidenceRecord } from '@signalglass/evidence';
import type {
  CaptureBoundary,
  EvidenceObservation,
  EvidenceRecord,
  NormalizeOptions,
} from '@signalglass/evidence';

export const T0 = '2025-06-01T14:00:00.000Z';
export const T1 = '2025-06-01T14:00:00.200Z';
export const T2 = '2025-06-01T14:00:00.400Z';
export const T3 = '2025-06-01T14:00:03.000Z';
export const T4 = '2025-06-01T14:00:03.200Z';
export const T5 = '2025-06-01T14:00:03.400Z';

const PROFILE = { name: 'dev-basic', version: '1.2.0' };

function buildBoundary(overrides: Partial<CaptureBoundary> = {}): CaptureBoundary {
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
    ...overrides,
  };
}

export function obs(
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

/**
 * Build an authoritative `EvidenceRecord` from raw observations through the
 * public normalization contract. Throws (test-authoring error) when the
 * observations do not form a valid record, never for expected input.
 * `normalizeOptions` merges over the default capture profile (for example
 * `conditions`).
 */
export function buildRecord(
  observations: readonly EvidenceObservation[],
  boundary: CaptureBoundary = buildBoundary(),
  evidenceSchemaVersion = '1.0.0',
  normalizeOptions: NormalizeOptions = {},
): EvidenceRecord {
  const result = normalizeEvidenceRecord(observations, boundary, evidenceSchemaVersion, {
    captureProfile: PROFILE,
    ...normalizeOptions,
  });
  if (!result.ok) {
    throw new Error(
      `test record invalid: ${result.issues.map((i) => `${i.code}@${i.path}`).join('; ')}`,
    );
  }
  return result.record;
}

/** Complete minimal interaction: start + one model span + request/response + end. */
export function minimalObservations(): EvidenceObservation[] {
  return [
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
          providerNative: { temperature: 0.2 },
        },
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
          providerNative: { content: 'hi' },
        },
      },
    }),
    obs({
      observationId: 'o4', eventId: 'evt-span-end', seq: 4, spanId: 'sp-1',
      kind: 'span_end', capturedAt: T4, rawCapturedAt: T4,
      payload: { durationMs: 3000 },
    }),
    obs({ observationId: 'o5', eventId: 'evt-interaction-end', seq: 5, kind: 'interaction_end', capturedAt: T5, rawCapturedAt: T5 }),
  ];
}

/**
 * A completed trace containing every canonical event kind, used by the
 * mapping-table suites to prove that kind-level loss rows are exercised
 * against a real record rather than asserted against tables only.
 */
export function allKindsObservations(): EvidenceObservation[] {
  return [
    obs({ observationId: 'k0', eventId: 'evt-interaction-start', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
    obs({
      observationId: 'k1', eventId: 'evt-span-start', seq: 1, spanId: 'sp-1',
      kind: 'span_start', capturedAt: T1, rawCapturedAt: T1,
      payload: { span: { kind: 'model', name: 'model:claude-sonnet-4', parentSpanId: null } },
    }),
    obs({
      observationId: 'k2', eventId: 'evt-model-request', seq: 2, spanId: 'sp-1',
      kind: 'model_request', capturedAt: T2, rawCapturedAt: T2, observationRole: 'client_sent',
      payload: {
        requestEnvelope: {
          model: 'claude-sonnet-4', provider: 'anthropic',
          providerNativeFidelity: 'structurally_faithful',
          messages: [{ role: 'user', content: 'hello' }],
          providerNative: { temperature: 0.2 },
        },
        contextContributions: [
          { artifactId: 'art-1', locator: { type: 'whole' }, position: 0, provenanceState: 'recorded' },
        ],
      },
    }),
    obs({
      observationId: 'k3', eventId: 'evt-model-response', seq: 3, spanId: 'sp-1',
      kind: 'model_response', capturedAt: T3, rawCapturedAt: T3, observationRole: 'provider_reported',
      payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', finishReason: 'end_turn' } },
    }),
    obs({
      observationId: 'k4', eventId: 'evt-chunk', seq: 4, spanId: 'sp-1',
      kind: 'model_response_chunk', capturedAt: T3, rawCapturedAt: T3, observationRole: 'provider_reported',
      payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', chunkIndex: 0 } },
    }),
    obs({
      observationId: 'k5', eventId: 'evt-usage', seq: 5, spanId: 'sp-1',
      kind: 'model_usage', capturedAt: T3, rawCapturedAt: T3, observationRole: 'provider_reported',
      payload: { usage: { evidenceStatus: 'captured', inputTokens: { value: 3, evidenceStatus: 'captured' }, outputTokens: { value: 1, evidenceStatus: 'captured' } } },
    }),
    obs({
      observationId: 'k6', eventId: 'evt-tool-call', seq: 6, kind: 'tool_call',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'application_constructed',
      payload: { tool: { name: 'read_file', arguments: { path: 'x' } } },
    }),
    obs({
      observationId: 'k7', eventId: 'evt-tool-result', seq: 7, kind: 'tool_result',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'returned',
      payload: { toolResult: { stdout: 'file contents' } },
    }),
    obs({
      observationId: 'k8', eventId: 'evt-mcp-request', seq: 8, kind: 'mcp_request',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'application_constructed',
      payload: { mcp: { server: 'fs', tool: 'read', arguments: { path: 'x' } } },
    }),
    obs({
      observationId: 'k9', eventId: 'evt-mcp-result', seq: 9, kind: 'mcp_result',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'returned',
      payload: { mcpResult: { content: 'ok' } },
    }),
    obs({
      observationId: 'k10', eventId: 'evt-retrieval-request', seq: 10, kind: 'retrieval_request',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'application_constructed',
      payload: { retrieval: { query: 'q', topK: 3 } },
    }),
    obs({
      observationId: 'k11', eventId: 'evt-retrieval-result', seq: 11, kind: 'retrieval_result',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'returned',
      payload: { retrievalResult: { resultCount: 3 } },
    }),
    obs({
      observationId: 'k12', eventId: 'evt-cp-request', seq: 12, kind: 'context_provider_request',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'application_constructed',
      payload: { contextProvider: { name: 'graphify', kind: 'retrieval' } },
    }),
    obs({
      observationId: 'k13', eventId: 'evt-cp-result', seq: 13, kind: 'context_provider_result',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'returned',
      payload: { contextProvider: { name: 'graphify', kind: 'retrieval' } },
    }),
    obs({
      observationId: 'k14', eventId: 'evt-context-assembled', seq: 14, kind: 'context_assembled',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'application_constructed',
      payload: { contextContributions: [{ artifactId: 'art-1', locator: { type: 'whole' }, position: 0, provenanceState: 'recorded' }] },
    }),
    obs({
      observationId: 'k15', eventId: 'evt-error', seq: 15, kind: 'error',
      capturedAt: T3, rawCapturedAt: T3, observationRole: 'returned',
      payload: { actor: 'model', lifecycleTarget: 'none', lifecycleEffect: 'none', error: { type: 'timeout' } },
    }),
    obs({
      observationId: 'k16', eventId: 'evt-cancelled', seq: 16, kind: 'cancelled',
      capturedAt: T4, rawCapturedAt: T4, observationRole: 'application_constructed',
      payload: { lifecycleTarget: 'none', lifecycleEffect: 'cancel', cancellation: { requestedBy: 'user' } },
    }),
    obs({
      observationId: 'k17', eventId: 'evt-retry', seq: 17, kind: 'retry',
      capturedAt: T4, rawCapturedAt: T4, observationRole: 'application_constructed',
      payload: { retry: { originalRequestEventId: 'evt-model-request', errorEventId: 'evt-error', attempt: 2, observedDelayMs: 500 } },
    }),
    obs({
      observationId: 'k18', eventId: 'evt-span-end', seq: 18, spanId: 'sp-1',
      kind: 'span_end', capturedAt: T4, rawCapturedAt: T4, payload: { durationMs: 3000 },
    }),
    obs({ observationId: 'k19', eventId: 'evt-interaction-end', seq: 19, kind: 'interaction_end', capturedAt: T5, rawCapturedAt: T5 }),
  ];
}
