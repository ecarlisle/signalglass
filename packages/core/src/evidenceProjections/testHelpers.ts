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
 */
export function buildRecord(
  observations: readonly EvidenceObservation[],
  boundary: CaptureBoundary = buildBoundary(),
  evidenceSchemaVersion = '1.0.0',
): EvidenceRecord {
  const result = normalizeEvidenceRecord(observations, boundary, evidenceSchemaVersion, {
    captureProfile: PROFILE,
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
