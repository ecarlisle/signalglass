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
import { parseEvidenceRecord } from '@signalglass/evidence';
import type {
  EvidenceRecord,
  EventRecord,
  ObservationRole,
  TraceStatus,
  ValidationIssue,
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

/**
 * Translate an authoritative-validator rejection into safe `ProjectionIssue`s
 * with stable codes and accurate paths. The validator's messages are
 * structural (they never echo captured content or secrets), so they are
 * carried through unchanged. The codes are bucketed into the projection's
 * stable issue-code vocabulary.
 */
const VALIDATION_CODE_TO_PROJECTION_CODE: Readonly<Record<string, string>> = {
  unsupported_evidence_schema_version: PROJECTION_ISSUE_CODES.unsupportedSchemaVersion,
  trace_disagrees_with_derivation: PROJECTION_ISSUE_CODES.traceDerivationConflict,
  analysis_disagrees_with_derivation: PROJECTION_ISSUE_CODES.traceDerivationConflict,
  completeness_disagrees_with_derivation: PROJECTION_ISSUE_CODES.traceDerivationConflict,
  terminal_declaration_not_final: PROJECTION_ISSUE_CODES.lifecycleInvalid,
  cancelled_invalid_effect: PROJECTION_ISSUE_CODES.lifecycleInvalid,
  cancelled_invalid_target: PROJECTION_ISSUE_CODES.lifecycleInvalid,
  error_invalid_effect: PROJECTION_ISSUE_CODES.lifecycleInvalid,
  error_invalid_target: PROJECTION_ISSUE_CODES.lifecycleInvalid,
  error_invalid_actor: PROJECTION_ISSUE_CODES.lifecycleInvalid,
  target_span_requires_span: PROJECTION_ISSUE_CODES.lifecycleInvalid,
  target_trace_requires_null_span: PROJECTION_ISSUE_CODES.lifecycleInvalid,
};

function validationIssuesToProjectionIssues(
  issues: readonly ValidationIssue[],
): ProjectionIssue[] {
  return issues.map((validation) => ({
    path: validation.path,
    stage: STAGE,
    code: VALIDATION_CODE_TO_PROJECTION_CODE[validation.code] ??
      PROJECTION_ISSUE_CODES.invalidEvidenceRecord,
    message: validation.message,
  }));
}

/**
 * Legacy trace status from canonical lifecycle status (partial).
 */
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
 * The authoritative input is validated first through the public
 * `@signalglass/evidence` `parseEvidenceRecord` contract — the complete
 * record including its raw observations and deterministic derived views.
 * Structurally invalid, unsupported-version, derivationally inconsistent,
 * or lifecycle-invalid records return `ok: false` with translated
 * `ProjectionIssue`s; the projection never duplicates evidence validation
 * rules and never imports evidence internals.
 *
 * Returns `ok: false` only when no valid legacy trace view can be
 * constructed. Lossy input always returns `ok: true` with
 * `partial`/`inferred`/`unavailable` report entries. Never throws on
 * expected invalid input; the supplied record is never mutated.
 */
export function evidenceToLegacyTrace(record: EvidenceRecord): ProjectionResult<Trace> {
  const parsed = parseEvidenceRecord(record);
  if (!parsed.ok) {
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
      issues: validationIssuesToProjectionIssues(parsed.issues),
    };
  }

  const trace = parsed.record.trace;
  const mappings: ProjectionMapping[] = [];

  // ---- Trace identity and timing (exact) ----
  mappings.push({
    path: 'trace.traceId',
    stage: STAGE,
    outcome: 'exact',
    reason: 'legacy trace id preserves the canonical traceId',
  });
  mappings.push({
    path: 'trace.interactionId',
    stage: STAGE,
    outcome: 'exact',
    reason:
      'canonical interactionId equals traceId (validated invariant); the value is preserved by legacy Trace.id, though the separate interactionId field is not carried',
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
      reason: `canonical trace has no observed terminal time (status "${trace.status}"); legacy endedAt is omitted`,
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
    reason: 'legacy Trace has no capture-surface field; the declared capture surface is not projected',
  });
  mappings.push({
    path: 'trace.observationBoundary',
    stage: STAGE,
    outcome: 'unavailable',
    reason: 'legacy Trace has no observation-boundary field; the declared observation boundary is not projected',
  });
  mappings.push({
    path: 'completeness',
    stage: STAGE,
    outcome: 'unavailable',
    reason: 'legacy Trace has no completeness record; the canonical derived EvidenceRecord.completeness (eventsByStatus, seqGaps, duplicatesDetected, boundaryStatement) is not projected',
  });

  // ---- Conditions (only when present) ----
  if (trace.conditions != null && trace.conditions.length > 0) {
    mappings.push({
      path: 'trace.conditions',
      stage: STAGE,
      outcome: 'unavailable',
      reason: 'legacy Trace has no conditions field; canonical experimental/environmental conditions are not projected',
    });
  }

  // ---- Spans (only when present) ----
  if (trace.spans.length > 0) {
    mappings.push({
      path: 'trace.spans',
      stage: STAGE,
      outcome: 'unavailable',
      reason: 'legacy Trace has no span records; span hierarchy, kind, name, lifecycle status, seq ordering, and timing are not projected',
    });
    trace.spans.forEach((span, spanIndex) => {
      if (span.durationMs != null) {
        mappings.push({
          path: `trace.spans[${spanIndex}].durationMs`,
          stage: STAGE,
          outcome: 'unavailable',
          reason: 'legacy Trace has no duration field or clock-basis contract; span durationMs is not projected',
        });
      }
      if (span.participants != null && span.participants.length > 0) {
        mappings.push({
          path: `trace.spans[${spanIndex}].participants`,
          stage: STAGE,
          outcome: 'unavailable',
          reason: 'legacy Trace has no span-participant concept; span participants are not projected',
        });
      }
    });
  }

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

    pushEventSpecificLossMappings(mappings, event, path);
  });

  const view: Trace = {
    id: trace.traceId,
    startedAt: trace.startedAt,
    ...(trace.finishedAt != null ? { endedAt: trace.finishedAt } : {}),
    ...(derived.provider != null ? { provider: derived.provider } : {}),
    ...(derived.model != null ? { model: derived.model } : {}),
    mode: 'standard',
    capturePolicy: createDefaultCapturePolicy('standard'),
    status: statusMapping.status,
    events,
  };

  const report: ProjectionReport = {
    projectionVersion: EVIDENCE_TO_LEGACY_TRACE_PROJECTION_VERSION,
    sourceSchemaVersion: record.evidenceSchemaVersion,
    mappings,
  };

  return { ok: true, view, report };
}

/**
 * Event-specific unavailable mappings for losses that only exist when the
 * canonical event actually carries the information: the `unobservable`
 * observation role (no ContentPhase approximation), byte-faithful envelope
 * `nativeContentHash` fields, and context contributions. Kept out of the
 * projection loop so the loop stays readable and the loss rules stay
 * colocated and testable.
 */
function pushEventSpecificLossMappings(
  mappings: ProjectionMapping[],
  event: EventRecord,
  path: string,
): void {
  pushUnobservableRoleMapping(mappings, event, path);
  pushEnvelopeHashLossMappings(mappings, event, path);
  pushContextContributionLossMapping(mappings, event, path);
}

/**
 * The `unobservable` observation role has no ContentPhase approximation; the
 * loss must be explicit rather than folded silently into the kind mapping.
 */
function pushUnobservableRoleMapping(
  mappings: ProjectionMapping[],
  event: EventRecord,
  path: string,
): void {
  if (event.observationRole !== 'unobservable') return;
  mappings.push({
    path: `${path}.observationRole`,
    stage: STAGE,
    outcome: 'unavailable',
    reason: 'observationRole "unobservable" has no ContentPhase approximation; the role is not representable in the legacy vocabulary',
  });
}

/**
 * Hash-loss mappings identify actual envelope fields when those fields are
 * present (byte_faithful captured payloads carry nativeContentHash).
 */
function pushEnvelopeHashLossMappings(
  mappings: ProjectionMapping[],
  event: EventRecord,
  path: string,
): void {
  if (event.kind === 'model_request' && event.requestEnvelope?.nativeContentHash != null) {
    mappings.push({
      path: `${path}.requestEnvelope.nativeContentHash`,
      stage: STAGE,
      outcome: 'unavailable',
      reason: 'legacy Trace has no content-hash contract; the request envelope nativeContentHash is not projected',
    });
  }
  if (
    (event.kind === 'model_response' || event.kind === 'model_response_chunk') &&
    event.responseEnvelope?.nativeContentHash != null
  ) {
    mappings.push({
      path: `${path}.responseEnvelope.nativeContentHash`,
      stage: STAGE,
      outcome: 'unavailable',
      reason: 'legacy Trace has no content-hash contract; the response envelope nativeContentHash is not projected',
    });
  }
}

/** Explicit accounting for context contributions (Spec 014 §6.3). */
function pushContextContributionLossMapping(
  mappings: ProjectionMapping[],
  event: EventRecord,
  path: string,
): void {
  if (event.kind !== 'model_request' || !Array.isArray(event.contextContributions)) return;
  mappings.push({
    path: `${path}.contextContributions`,
    stage: STAGE,
    outcome: 'unavailable',
    reason: 'legacy Trace has no context-contribution concept; artifact references are not projected',
  });
}

/** Legacy `TraceEventType` vocabulary, exported for mapping documentation. */
export type { TraceEventType };
