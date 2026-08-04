/**
 * Canonical evidence → legacy `Trace`/`TraceEvent` view (Spec 014 §6.1
 * direction 1; Spec 013 §11.2). Reads the deterministic canonical `trace`
 * view of the authoritative `EvidenceRecord` without mutating the record;
 * redacted/missing/unknown evidence is never fabricated into false certainty.
 *
 * Loss behavior (Spec 014 §6.3–§6.4): canonical `seq`, `observationRole`,
 * `evidenceStatus`, hashes, completeness, and portions of the canonical event
 * vocabulary have no exact legacy equivalent and are reported explicitly.
 * `ContentPhase` is the documented approximation of observation roles
 * (Spec 013 §11.2) and every such conversion is reported `partial`. Event
 * kinds without a valid legacy `TraceEventType` are reported `unavailable`
 * and omitted — never mapped to a semantically incorrect legacy kind.
 */
import type {
  ContentPhase,
  Trace,
  TraceEvent,
  TraceEventType,
} from '../traces.js';
import { createDefaultCapturePolicy } from '../traces.js';
import type {
  EvidenceRecord,
  EventRecord,
  ObservationRole,
  TraceStatus,
} from '@signalglass/evidence';
import {
  EVIDENCE_TO_LEGACY_TRACE_PROJECTION_VERSION,
  PROJECTION_ISSUE_CODES,
} from './types.js';
import type {
  ProjectionIssue,
  ProjectionMapping,
  ProjectionReport,
  ProjectionResult,
  ProjectionStage,
} from './types.js';
import { mapCanonicalEventKind } from './eventMapping.js';

const STAGE: ProjectionStage = 'evidence_to_legacy_trace';

/**
 * `ContentPhase` is the documented approximation of observation roles
 * (Spec 013 §11.2; Spec 014 §6.3): phase labels describe where content was
 * observed, never provider-internal state. `unobservable` has no phase
 * approximation and is reported `unavailable` instead.
 */
const OBSERVATION_ROLE_TO_CONTENT_PHASE: Readonly<
  Partial<Record<ObservationRole, ContentPhase>>
> = {
  application_constructed: 'transformed',
  client_sent: 'sent',
  provider_reported: 'observed',
  returned: 'returned',
};

/** Approximate an observation role with a legacy `ContentPhase` (partial). */
function observationRoleToContentPhase(
  role: ObservationRole | undefined,
): ContentPhase | null {
  if (role == null) return null;
  return OBSERVATION_ROLE_TO_CONTENT_PHASE[role] ?? null;
}

/** Legacy trace status from canonical lifecycle status (partial). */
function legacyStatusFromTraceStatus(
  status: TraceStatus,
): { status: Trace['status']; reason: string } {
  switch (status) {
    case 'completed':
      return { status: 'success', reason: 'canonical trace status "completed" maps to legacy status "success"' };
    case 'failed':
      return { status: 'error', reason: 'canonical trace status "failed" maps to legacy status "error"' };
    case 'cancelled':
      return { status: 'error', reason: 'canonical status "cancelled" has no legacy equivalent; mapped to legacy "error" as abnormal termination' };
    case 'unknown':
      return { status: 'started', reason: 'canonical status "unknown" (termination unobserved) has no legacy equivalent; mapped to legacy "started"' };
  }
}

/**
 * Deterministically derive the trace-level provider/model from the first
 * `model_request` event's request envelope, in `seq` order (Spec 013 §2.2:
 * `seq` is the only ordering key). Derived values are reported `inferred`
 * and are never presented as canonical evidence.
 */
function deriveTraceProviderModel(events: readonly EventRecord[]): {
  provider?: string;
  model?: string;
} {
  for (const event of events) {
    if (event.kind === 'model_request' && event.requestEnvelope != null) {
      return {
        provider: event.requestEnvelope.provider,
        model: event.requestEnvelope.model,
      };
    }
  }
  return {};
}

/**
 * Project the canonical `EvidenceRecord`'s deterministic trace view into a
 * legacy `Trace`/`TraceEvent` view.
 *
 * Returns `ok: false` only when no valid legacy trace view can be
 * constructed (a record without a usable canonical trace view). Lossy input
 * always returns `ok: true` with `partial`/`inferred`/`unavailable` report
 * entries. Never throws on expected invalid input.
 */
export function evidenceToLegacyTrace(record: EvidenceRecord): ProjectionResult<Trace> {
  if (
    record == null ||
    record.trace == null ||
    !Array.isArray(record.trace.events)
  ) {
    const issues: ProjectionIssue[] = [
      {
        path: 'record',
        stage: STAGE,
        code: PROJECTION_ISSUE_CODES.invalidEvidenceRecord,
        message:
          'Cannot build a legacy trace view: the input lacks a usable canonical trace view with an events collection.',
      },
    ];
    return {
      ok: false,
      report: {
        projectionVersion: EVIDENCE_TO_LEGACY_TRACE_PROJECTION_VERSION,
        sourceSchemaVersion:
          record != null && typeof record.evidenceSchemaVersion === 'string'
            ? record.evidenceSchemaVersion
            : 'unknown',
        mappings: [],
      },
      issues,
    };
  }

  const trace = record.trace;
  const mappings: ProjectionMapping[] = [];

  // ---- Trace identity and timing (exact) ----
  mappings.push({
    path: 'trace.traceId',
    stage: STAGE,
    outcome: 'exact',
    reason: 'legacy trace id preserves the canonical traceId',
  });
  mappings.push({
    path: 'trace.startedAt',
    stage: STAGE,
    outcome: 'exact',
    reason: 'legacy startedAt preserves the canonical startedAt',
  });

  // ---- Terminal state (partial / unavailable) ----
  if (trace.finishedAt != null) {
    mappings.push({
      path: 'trace.finishedAt',
      stage: STAGE,
      outcome: 'exact',
      reason: 'legacy endedAt preserves the canonical finishedAt',
    });
  } else {
    mappings.push({
      path: 'trace.finishedAt',
      stage: STAGE,
      outcome: 'unavailable',
      reason: 'canonical trace has no observed terminal time (status "unknown"); legacy endedAt is omitted',
    });
  }

  // ---- Status vocabulary (partial) ----
  const statusMapping = legacyStatusFromTraceStatus(trace.status);
  mappings.push({
    path: 'trace.status',
    stage: STAGE,
    outcome: 'partial',
    reason: statusMapping.reason,
  });

  // ---- Storage mode (partial: canonical evidence carries no StorageMode) ----
  mappings.push({
    path: 'trace.captureProfile',
    stage: STAGE,
    outcome: 'partial',
    reason: 'legacy StorageMode is not carried by canonical evidence (Spec 013 §11.2); the projected view defaults to mode "standard" with its default capture policy',
  });

  // ---- Provider/model derived from evidence (inferred) / agent/task (unavailable) ----
  const derived = deriveTraceProviderModel(trace.events);
  if (derived.provider != null || derived.model != null) {
    mappings.push({
      path: 'trace.events[].requestEnvelope',
      stage: STAGE,
      outcome: 'inferred',
      reason: 'legacy trace-level provider/model are derived from the first canonical model_request envelope; reported as inferred, never presented as canonical evidence',
    });
  } else {
    mappings.push({
      path: 'trace.provider',
      stage: STAGE,
      outcome: 'unavailable',
      reason: 'no canonical model_request envelope exists from which to derive legacy provider/model',
    });
  }
  mappings.push({
    path: 'trace.agent',
    stage: STAGE,
    outcome: 'unavailable',
    reason: 'canonical evidence has no agent concept; legacy agent is omitted',
  });
  mappings.push({
    path: 'trace.task',
    stage: STAGE,
    outcome: 'unavailable',
    reason: 'canonical evidence has no task concept; legacy task is omitted',
  });

  // ---- Canonical-only concepts with no legacy equivalent (explicit loss) ----
  mappings.push({
    path: 'trace.events[].seq',
    stage: STAGE,
    outcome: 'partial',
    reason: 'legacy Trace has no seq field; canonical seq ordering is preserved by event order, the seq value itself is not representable',
  });
  mappings.push({
    path: 'trace.events[].evidenceStatus',
    stage: STAGE,
    outcome: 'unavailable',
    reason: 'legacy TraceEvent has no evidenceStatus field; redacted/truncated/missing/unknown evidence is never turned into content',
  });
  mappings.push({
    path: 'trace.events[].observationRole',
    stage: STAGE,
    outcome: 'partial',
    reason: 'canonical observation roles are approximated by legacy ContentPhase (Spec 013 §11.2); the conversion is partial and never claims provider-internal state',
  });
  mappings.push({
    path: 'trace.captureSurface',
    stage: STAGE,
    outcome: 'unavailable',
    reason: 'legacy Trace has no capture-surface or observation-boundary fields',
  });
  mappings.push({
    path: 'trace.hashes',
    stage: STAGE,
    outcome: 'unavailable',
    reason: 'legacy Trace has no content-hash contract; contentHash and nativeContentHash are not projected',
  });
  mappings.push({
    path: 'trace.completeness',
    stage: STAGE,
    outcome: 'unavailable',
    reason: 'legacy Trace has no completeness record; the canonical derived completeness is not projected',
  });

  // ---- Events ----
  const events: TraceEvent[] = [];
  trace.events.forEach((event, index) => {
    const path = `events[${index}]`;
    const mapped = mapCanonicalEventKind(event.kind);

    if (mapped == null) {
      mappings.push({
        path,
        stage: STAGE,
        outcome: 'unavailable',
        reason: `canonical event kind "${event.kind}" has no legacy TraceEventType; omitted from the legacy trace view`,
      });
      return;
    }

    const phase = observationRoleToContentPhase(event.observationRole);
    events.push({
      id: event.eventId,
      traceId: event.traceId,
      timestamp: event.capturedAt,
      type: mapped.legacyType,
      ...(phase != null ? { contentPhase: phase } : {}),
    });

    const phaseNote =
      phase != null
        ? `; observationRole "${event.observationRole}" approximated by ContentPhase "${phase}"`
        : event.observationRole === 'unobservable'
          ? '; observationRole "unobservable" has no ContentPhase approximation'
          : '';
    mappings.push({
      path,
      stage: STAGE,
      outcome: 'partial',
      reason: `kind "${event.kind}": ${mapped.reason}${phaseNote}`,
    });

    // Explicit accounting for context contributions (Spec 014 §6.3).
    if (event.kind === 'model_request' && Array.isArray(event.contextContributions)) {
      mappings.push({
        path: `${path}.contextContributions`,
        stage: STAGE,
        outcome: 'unavailable',
        reason: 'legacy Trace has no context-contribution concept; artifact references are not projected',
      });
    }
  });

  const legacyStatus = legacyStatusFromTraceStatus(trace.status).status;

  const view: Trace = {
    id: trace.traceId,
    startedAt: trace.startedAt,
    ...(trace.finishedAt != null ? { endedAt: trace.finishedAt } : {}),
    ...(derived.provider != null ? { provider: derived.provider } : {}),
    ...(derived.model != null ? { model: derived.model } : {}),
    mode: 'standard',
    capturePolicy: createDefaultCapturePolicy('standard'),
    status: legacyStatus,
    events,
  };

  const report: ProjectionReport = {
    projectionVersion: EVIDENCE_TO_LEGACY_TRACE_PROJECTION_VERSION,
    sourceSchemaVersion: record.evidenceSchemaVersion,
    mappings,
  };

  return { ok: true, view, report };
}

/** Legacy `TraceEventType` vocabulary, exported for mapping documentation. */
export type { TraceEventType };
