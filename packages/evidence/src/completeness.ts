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

  const boundaryStatement = buildBoundaryStatement(boundary, trace.events.length);

  return {
    eventsByStatus: counts as TraceCompleteness['eventsByStatus'],
    seqGaps: analysis.sequenceGaps,
    duplicatesDetected,
    boundaryStatement,
  };
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
