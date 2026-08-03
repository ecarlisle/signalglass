/**
 * Deterministic test fixtures (Spec 014 §9.1–§9.2). Fixed timestamps and
 * caller-supplied ids; no clocks, network, or random identifiers. Imported
 * only by the package's own tests; not part of the public surface.
 */
import type { EvidenceObservation } from './types-trace.js';
import type { CaptureBoundary } from './types-record.js';
import type { NormalizeOptions } from './validate.js';
import { normalizeEvidenceRecord } from './validate.js';
import { serializeEvidenceRecord } from './serialize.js';
import type { EvidenceRecord } from './types-record.js';

export const T0 = '2025-06-01T14:00:00.000Z';
export const T1 = '2025-06-01T14:00:00.200Z';
export const T2 = '2025-06-01T14:00:00.400Z';
export const T3 = '2025-06-01T14:00:03.000Z';
export const T4 = '2025-06-01T14:00:03.200Z';
export const T5 = '2025-06-01T14:00:03.400Z';

export const PROFILE = { name: 'dev-basic', version: '1.2.0' };

export function buildBoundary(
  overrides: Partial<CaptureBoundary> = {},
): CaptureBoundary {
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
    ],
    declaredSurfaces: ['client_side'],
    missingRecord: null,
    ...overrides,
  };
}

export function obs(
  o: Partial<EvidenceObservation> & { observationId: string; eventId: string; seq: number; kind: EvidenceObservation['kind'] },
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

/** A complete minimal trace: interaction + one model span + request/response. */
export function minimalObservations(): EvidenceObservation[] {
  return [
    obs({
      observationId: 'o0', eventId: 'evt-interaction-start', seq: 0,
      kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0,
    }),
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
          usage: { inputTokens: 3, outputTokens: 1 },
        },
      },
    }),
    obs({
      observationId: 'o4', eventId: 'evt-span-end', seq: 4, spanId: 'sp-1',
      kind: 'span_end', capturedAt: T4, rawCapturedAt: T4,
      payload: { durationMs: 3000 },
    }),
    obs({
      observationId: 'o5', eventId: 'evt-interaction-end', seq: 5, spanId: null,
      kind: 'interaction_end', capturedAt: T5, rawCapturedAt: T5,
    }),
  ];
}

export function buildRecord(
  observations: readonly EvidenceObservation[] = minimalObservations(),
  boundary: CaptureBoundary = buildBoundary(),
  options: EvidenceRecordOptions = {},
): Extract<ReturnType<typeof normalizeEvidenceRecord>, { ok: true }>['record'] {
  const result = normalizeEvidenceRecord(
    observations,
    boundary,
    options.evidenceSchemaVersion ?? '1.0.0',
    { captureProfile: options.captureProfile ?? PROFILE, ...(options.conditions ? { conditions: options.conditions } : {}) },
  );
  if (!result.ok) {
    throw new Error(`fixture not valid: ${result.issues.map((i) => `${i.code}:${i.path}`).join('; ')}`);
  }
  return result.record;
}

export type EvidenceRecordOptions = {
  evidenceSchemaVersion?: string;
  captureProfile?: { name: string; version: string };
  conditions?: NormalizeOptions['conditions'];
};

export function toJsonRecord(record: EvidenceRecord): string {
  return serializeEvidenceRecord(record);
}