/**
 * Worker thread for testing concurrent evidence storage writes.
 * Used by contention tests to verify actual concurrent behavior.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { join } from 'node:path';
import {
  EvidenceStorage,
  createMetadataSafePolicy,
  type SaveOutcome,
} from './evidenceStorage.js';
import { normalizeEvidenceRecord, type CaptureBoundary } from '@signalglass/evidence';

interface WorkerConfig {
  dir: string;
  traceId: string;
  captureProfileName: string;
}

const captureBoundary: CaptureBoundary = {
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
};

function makeObservation(opts: any): any {
  const idBase = `${opts.kind}-${opts.seq ?? 0}`;
  const isControl = ['interaction_start', 'interaction_end', 'span_start', 'span_end'].includes(opts.kind);
  return {
    observationId: `obs-${idBase}`,
    eventId: `evt-${idBase}`,
    traceId: opts.traceId || 'trace-abc',
    spanId: opts.spanId || null,
    capturedAt: '2026-08-12T12:00:00.000Z',
    evidenceStatus: opts.evidenceStatus || 'captured',
    observationRole: isControl ? null : (opts.observationRole || 'application_constructed'),
    payload: opts.payload || null,
    rawCapturedAt: '2026-08-12T12:00:00.000Z',
    ...opts,
  };
}

function makeProofRecord(traceId: string, captureProfileName: string): any {
  const observations = [
    makeObservation({ kind: 'interaction_start', seq: 0, traceId, payload: null }),
    makeObservation({
      kind: 'span_start',
      seq: 1,
      traceId,
      spanId: 'span-1',
      payload: { span: { kind: 'model', name: 'model:claude-sonnet-4', parentSpanId: null } },
    }),
    makeObservation({
      kind: 'model_request',
      seq: 2,
      traceId,
      spanId: 'span-1',
      observationRole: 'client_sent',
      evidenceStatus: 'redacted',
      payload: {
        requestEnvelope: {
          model: 'claude-sonnet-4',
          provider: 'anthropic',
          providerNativeFidelity: 'structurally_faithful',
        },
        contextContributions: [],
      },
    }),
    makeObservation({
      kind: 'model_response',
      seq: 3,
      traceId,
      spanId: 'span-1',
      observationRole: 'provider_reported',
      evidenceStatus: 'truncated',
      payload: {
        responseEnvelope: {
          providerNativeFidelity: 'structurally_faithful',
          finishReason: 'end_turn',
          usage: { inputTokens: 3, outputTokens: 1 },
        },
      },
    }),
    makeObservation({ kind: 'span_end', seq: 4, traceId, spanId: 'span-1', payload: { durationMs: 3000 } }),
    makeObservation({ kind: 'interaction_end', seq: 5, traceId, payload: null }),
  ];

  const parsed = normalizeEvidenceRecord(
    observations,
    captureBoundary,
    '1.0.0',
    { captureProfile: { name: captureProfileName, version: '1.2.0' } }
  );

  if (!parsed.ok) {
    throw new Error(`Failed to create proof record: ${JSON.stringify(parsed.issues)}`);
  }

  return parsed.record;
}

async function runWorker(): Promise<void> {
  const config = workerData as WorkerConfig;
  const dbPath = join(config.dir, 'test.db');
  const storage = new EvidenceStorage({
    databasePath: dbPath,
    persistencePolicy: createMetadataSafePolicy(),
  });

  try {
    const record = makeProofRecord(config.traceId, config.captureProfileName);
    const outcome = storage.saveEvidenceRecord(record);
    
    parentPort?.postMessage({
      status: outcome.status,
      identity: (outcome as any).identity,
      traceId: config.traceId,
      captureProfileName: config.captureProfileName,
    });
  } catch (err) {
    parentPort?.postMessage({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      traceId: config.traceId,
      captureProfileName: config.captureProfileName,
    });
  } finally {
    storage.close();
  }
}

runWorker();
