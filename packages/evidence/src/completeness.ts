/**
 * Completeness derivation (Spec 014 §2.2.9; Spec 013 §4.3). Pure and
 * deterministic: counts from the trace events, gaps and duplicates from the
 * structural analysis, and a boundary statement from the declared capture
 * boundary. Never invents events or statuses; a trace whose boundary cannot
 * be determined yields an incomplete statement, not a fabricated one.
 */
import type { EvidenceTrace } from './types-trace.js';
import type { EvidenceStructuralAnalysis } from './types-analysis.js';
import type { CaptureBoundary, TraceCompleteness } from './types-record.js';
import { EVIDENCE_STATUSES } from './vocabulary.js';
import type { DeclaredLossCode, ObservationTerminal } from './vocabulary.js';
import type { EventRecord } from './types-event.js';

/**
 * The deterministic completeness derivation. Signature is exactly the
 * accepted contract:
 *
 *   deriveCompleteness(trace, analysis, boundary): TraceCompleteness
 */
export function deriveCompleteness(
  trace: EvidenceTrace,
  analysis: EvidenceStructuralAnalysis,
  boundary: CaptureBoundary,
): TraceCompleteness {
  const eventsByStatus = {} as Record<string, number>;
  for (const status of EVIDENCE_STATUSES) eventsByStatus[status] = 0;
  for (const ev of trace.events) {
    const s = ev.evidenceStatus;
    eventsByStatus[s] = (eventsByStatus[s] ?? 0) + 1;
  }
  const counts: Record<string, number> = {};
  for (const status of EVIDENCE_STATUSES) {
    if ((eventsByStatus[status] ?? 0) > 0) counts[status] = eventsByStatus[status]!;
  }

  const duplicatesDetected = analysis.duplicateObservations.map((d) =>
    d.classification === 'exact_replay'
      ? `exact_replay:${d.eventId}@${d.seq}`
      : `same_id_different_seq:${d.eventId}@${d.retainedPosition.seq}`,
  );

  const terminal = boundary.streaming ? deriveObservationTerminal(trace.events) : undefined;
  const declaredLosses = boundary.streaming ? deriveDeclaredLosses(trace.events, boundary.streaming.losses, boundary.streaming.decoderDisposition, terminal!) : undefined;
  const boundaryStatement = boundary.streaming
    ? buildStreamingBoundaryStatement(terminal!, boundary.streaming.remainder.knowledge, declaredLosses!.length)
    : buildBoundaryStatement(boundary, trace.events.length);

  return {
    eventsByStatus: counts as TraceCompleteness['eventsByStatus'],
    seqGaps: analysis.sequenceGaps,
    duplicatesDetected,
    boundaryStatement,
    ...(boundary.streaming ? {
      lifecycle: {
        upstream: boundary.streaming.upstream,
        clientResponse: boundary.streaming.clientResponse,
        observation: { terminal: terminal! },
        remainder: boundary.streaming.remainder,
      },
      declaredLosses,
    } : {}),
  };
}

function deriveObservationTerminal(events: readonly EventRecord[]): ObservationTerminal {
  const event = events[events.length - 1];
  if (!event) return 'observation-detached';
  if (event.kind === 'interaction_end') return 'completed';
  if (event.kind === 'cancelled') return event.cancellation.requestedBy === 'client' ? 'client-cancelled' : 'ingress-cancelled';
  if (event.kind === 'error') {
    if (event.lifecycleTarget === 'none' && event.lifecycleEffect === 'none') return 'observation-detached';
    if (event.actor === 'capture') return 'request-failed';
    return event.error.type.startsWith('sse-') ? 'malformed-stream' : 'upstream-failed';
  }
  return 'observation-detached';
}

function deriveDeclaredLosses(
  events: readonly EventRecord[],
  losses: NonNullable<CaptureBoundary['streaming']>['losses'],
  decoderDisposition: NonNullable<CaptureBoundary['streaming']>['decoderDisposition'],
  terminal: ObservationTerminal,
): readonly DeclaredLossCode[] {
  const out: DeclaredLossCode[] = [];
  const add = (when: boolean, code: DeclaredLossCode): void => { if (when) out.push(code); };
  add(losses.requestBody === 'fully-observed-not-retained' || losses.requestBody === 'partially-observed-not-retained', 'request-body-not-retained');
  add(losses.requestBody === 'no-bytes-observed' || losses.requestBody === 'partially-observed-not-retained', 'request-body-not-fully-observed');
  add(losses.messageContent === 'partially-retained' || losses.messageContent === 'omitted', 'message-content-not-retained');
  add(losses.deltaContent === 'partially-retained' || losses.deltaContent === 'omitted', 'delta-content-not-retained');
  add(losses.unmappedDeltaFields.length > 0, 'unmapped-delta-fields');
  add(losses.providerNative === 'not-retained', 'provider-native-not-retained');
  add(losses.providerErrorBody === 'not-retained', 'provider-error-body-not-retained');
  add(losses.wireBytes === 'not-retained', 'wire-bytes-not-retained');
  add(losses.postTerminalContent === 'observed-not-retained', 'post-terminal-content-not-retained');
  add(losses.postTerminalContent === 'unknown', 'post-terminal-content-unknown');
  add(terminal === 'observation-detached', 'remainder-after-observation-detach-not-observed');
  const headers = events.some((event) => event.kind === 'model_response');
  add(terminal === 'client-cancelled' && headers, 'remainder-after-client-cancellation');
  add(terminal === 'ingress-cancelled' && headers, 'remainder-after-ingress-cancellation');
  const decodedFrame = events.some((event) => event.kind === 'model_response_chunk' || event.kind === 'model_usage');
  add(decoderDisposition === 'openai-sse' && decodedFrame && !events.some((event) => event.kind === 'model_usage'), 'provider-usage-absent');
  add(decoderDisposition === 'openai-sse' && decodedFrame && !events.some((event) => event.kind === 'model_response_chunk' && event.responseEnvelope.finishReason !== undefined), 'finish-reason-absent');
  add(losses.multimodalContentObserved, 'multimodal-payload-not-retained');
  add(losses.requestMessageUnknownKeysObserved, 'request-message-unknown-fields');
  add(losses.unrecognizedRoleObserved, 'unrecognized-role-not-retained');
  add(losses.sseMetadataObservedButNotRetained, 'sse-metadata-not-retained');
  add(losses.unrecognizedExtensionFrameObserved, 'unrecognized-extension-frame');
  add(losses.headerValuesBeyondAllowlist, 'response-header-values-not-retained');
  add(losses.contentTypeParametersDropped, 'content-type-parameters-not-retained');
  add(losses.contentEncodingUnsupported, 'encoded-content-not-observed');
  add(losses.maskedContent, 'original-content-masked');
  return out;
}

function buildStreamingBoundaryStatement(terminal: ObservationTerminal, remainder: string, lossCount: number): string {
  return `streaming(terminal=${terminal}; remainder=${remainder}; declaredLosses=${lossCount})`;
}

function buildBoundaryStatement(boundary: CaptureBoundary, eventCount: number): string {
  const parts = [
    `captureSurface=${boundary.captureSurface}`,
    `observationBoundary=${boundary.observationBoundary}`,
    `declaredEventKinds=${boundary.declaredEventKinds.length > 0 ? `[${boundary.declaredEventKinds.join(',')}]` : '[]'}`,
    `declaredSurfaces=${boundary.declaredSurfaces.length > 0 ? `[${boundary.declaredSurfaces.join(',')}]` : '[]'}`,
  ];
  if (boundary.missingRecord) {
    parts.push(
      `missing=${boundary.missingRecord.reason}` +
        (boundary.missingRecord.reportedBy
          ? ` reportedBy=${boundary.missingRecord.reportedBy.captureSurface}/${boundary.missingRecord.reportedBy.observationBoundary}`
          : ''),
    );
  } else {
    parts.push('missing=none');
  }
  parts.push(`events=${eventCount}`);
  return `boundary(${parts.join('; ')})`;
}
