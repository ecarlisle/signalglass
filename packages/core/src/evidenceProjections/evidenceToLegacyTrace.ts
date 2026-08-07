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
  RequestEnvelope,
  ResponseEnvelope,
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

  // ---- Raw missing/redaction/truncation declarations (only when present) ----
  pushRawDeclarationLossMappings(mappings, record);

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
 * observation role (no ContentPhase approximation), envelope fields that
 * have no legacy equivalent (fidelity, messages, provider-native payloads,
 * native byte metadata, hashes, finish reason, usage, chunk index), the
 * usage-record surface, and context contributions. Kept out of the
 * projection loop so the loop stays readable and the loss rules stay
 * colocated and testable.
 */
function pushEventSpecificLossMappings(
  mappings: ProjectionMapping[],
  event: EventRecord,
  path: string,
): void {
  pushUnobservableRoleMapping(mappings, event, path);
  pushEnvelopeLossMappings(mappings, event, path);
  pushUsageRecordLossMappings(mappings, event, path);
  pushContextContributionLossMapping(mappings, event, path);
  pushErrorFieldLossMappings(mappings, event, path);
}

/**
 * Envelope field losses, emitted only for the fields the canonical event
 * actually carries (`providerNativeFidelity` is required on every valid
 * envelope and is always reported; optional fields are reported when
 * present). Every reason is structural — field names and vocabulary only,
 * never payload values, provider bodies, or hash values.
 */
function pushEnvelopeLossMappings(
  mappings: ProjectionMapping[],
  event: EventRecord,
  path: string,
): void {
  if (event.kind === 'model_request') {
    pushRequestEnvelopeLossMappings(mappings, event.requestEnvelope, path);
  }
  if (event.kind === 'model_response' || event.kind === 'model_response_chunk') {
    pushResponseEnvelopeLossMappings(mappings, event.responseEnvelope, path);
  }
}

/** Request-envelope field losses, one per actual envelope field. */
function pushRequestEnvelopeLossMappings(
  mappings: ProjectionMapping[],
  envelope: RequestEnvelope | undefined,
  path: string,
): void {
  if (envelope == null) return;
  pushUnavailable(mappings, `${path}.requestEnvelope.providerNativeFidelity`,
    'legacy TraceEvent carries no fidelity discriminant; the canonical request providerNativeFidelity (structurally_faithful | byte_faithful) is not projected');
  pushUnavailableIfPresent(mappings, `${path}.requestEnvelope.messages`, envelope.messages,
    'legacy excerpts never inline normalized request messages; the canonical request messages are not projected');
  pushUnavailableIfPresent(mappings, `${path}.requestEnvelope.providerNative`, envelope.providerNative,
    'legacy TraceEvent has no provider-native payload field; the canonical request providerNative body is not projected');
  pushUnavailableIfPresent(mappings, `${path}.requestEnvelope.nativeEncoding`, envelope.nativeEncoding,
    'legacy TraceEvent has no native-encoding field; the canonical request nativeEncoding is not projected');
  pushUnavailableIfPresent(mappings, `${path}.requestEnvelope.nativeContentType`, envelope.nativeContentType,
    'legacy TraceEvent has no native-content-type field; the canonical request nativeContentType is not projected');
  pushUnavailableIfPresent(mappings, `${path}.requestEnvelope.nativeContentHash`, envelope.nativeContentHash,
    'legacy Trace has no content-hash contract; the request envelope nativeContentHash is not projected');
}

/** Response-envelope field losses, one per actual envelope field. */
function pushResponseEnvelopeLossMappings(
  mappings: ProjectionMapping[],
  envelope: ResponseEnvelope | undefined,
  path: string,
): void {
  if (envelope == null) return;
  pushUnavailable(mappings, `${path}.responseEnvelope.providerNativeFidelity`,
    'legacy TraceEvent carries no fidelity discriminant; the canonical response providerNativeFidelity (structurally_faithful | byte_faithful) is not projected');
  pushUnavailableIfPresent(mappings, `${path}.responseEnvelope.finishReason`, envelope.finishReason,
    'legacy TraceEvent has no finish-reason field; the canonical response finishReason is not projected');
  pushUnavailableIfPresent(mappings, `${path}.responseEnvelope.providerNative`, envelope.providerNative,
    'legacy TraceEvent has no provider-native payload field; the canonical response providerNative body is not projected');
  pushUnavailableIfPresent(mappings, `${path}.responseEnvelope.usage`, envelope.usage,
    'legacy TraceEvent has no usage field; the canonical responseEnvelope usage record (with per-field evidence status) is not projected');
  pushUnavailableIfPresent(mappings, `${path}.responseEnvelope.chunkIndex`, envelope.chunkIndex,
    'legacy TraceEvent has no chunk-index field; streaming chunk index semantics are not representable');
  pushUnavailableIfPresent(mappings, `${path}.responseEnvelope.nativeEncoding`, envelope.nativeEncoding,
    'legacy TraceEvent has no native-encoding field; the canonical response nativeEncoding is not projected');
  pushUnavailableIfPresent(mappings, `${path}.responseEnvelope.nativeContentType`, envelope.nativeContentType,
    'legacy TraceEvent has no native-content-type field; the canonical response nativeContentType is not projected');
  pushUnavailableIfPresent(mappings, `${path}.responseEnvelope.nativeContentHash`, envelope.nativeContentHash,
    'legacy Trace has no content-hash contract; the response envelope nativeContentHash is not projected');
}

/** Push one always-present unavailable mapping. */
function pushUnavailable(
  mappings: ProjectionMapping[],
  path: string,
  reason: string,
): void {
  mappings.push({ path, stage: STAGE, outcome: 'unavailable', reason });
}

/** Push one unavailable mapping only when the optional field is present. */
function pushUnavailableIfPresent(
  mappings: ProjectionMapping[],
  path: string,
  value: unknown,
  reason: string,
): void {
  if (value == null) return;
  mappings.push({ path, stage: STAGE, outcome: 'unavailable', reason });
}

/**
 * Usage-record loss on `model_usage` events: the legacy vocabulary has no
 * per-field usage surface (legacy usage is a plain number), so the record's
 * evidenceStatus and any present token fields are reported unavailable.
 * Token values and their per-field evidence status are never invented.
 */
function pushUsageRecordLossMappings(
  mappings: ProjectionMapping[],
  event: EventRecord,
  path: string,
): void {
  if (event.kind !== 'model_usage' || event.usage == null) return;
  mappings.push({
    path: `${path}.usage.evidenceStatus`,
    stage: STAGE,
    outcome: 'unavailable',
    reason: 'legacy usage is a plain number with no per-field evidence-status surface; the canonical usage-record evidenceStatus is not projected',
  });
  if (event.usage.inputTokens != null) {
    mappings.push({
      path: `${path}.usage.inputTokens`,
      stage: STAGE,
      outcome: 'unavailable',
      reason: 'legacy usage is a plain number; the canonical usage inputTokens value and its per-field evidence status are not projected (token accounting is a later measurement)',
    });
  }
  if (event.usage.outputTokens != null) {
    mappings.push({
      path: `${path}.usage.outputTokens`,
      stage: STAGE,
      outcome: 'unavailable',
      reason: 'legacy usage is a plain number; the canonical usage outputTokens value and its per-field evidence status are not projected (token accounting is a later measurement)',
    });
  }
  if (event.usage.totalTokens != null) {
    mappings.push({
      path: `${path}.usage.totalTokens`,
      stage: STAGE,
      outcome: 'unavailable',
      reason: 'legacy usage is a plain number; the canonical usage totalTokens value and its per-field evidence status are not projected (token accounting is a later measurement)',
    });
  }
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

/** True for plain record-shaped payloads (never arrays or primitives). */
function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Unavailable mappings for raw missing/redaction/truncation declarations
 * present on the authoritative raw observation payloads (Spec 014 §5.8).
 * The canonical EventRecord type does not carry them, so the loss paths
 * point at the raw observation payload exactly as it is stored. Reasons are
 * structural only: declaration values (policy names, reason lists, lengths,
 * notes) are never echoed.
 */
function pushRawDeclarationLossMappings(
  mappings: ProjectionMapping[],
  record: EvidenceRecord,
): void {
  record.rawObservations.forEach((observation, rawIndex) => {
    const payload = observation.payload;
    if (!isRecordLike(payload)) return;
    pushRawDeclaration(mappings, rawIndex, payload, 'missing',
      'the canonical missing-evidence declaration is not representable in the legacy vocabulary; the reported absence is never fabricated into content');
    pushRawDeclaration(mappings, rawIndex, payload, 'redaction',
      'the canonical redaction declaration is not representable in the legacy vocabulary; redacted evidence is never turned into content');
    pushRawDeclaration(mappings, rawIndex, payload, 'truncation',
      'the canonical truncation declaration is not representable in the legacy vocabulary; the truncated value is never fabricated into content');
  });
}

/** Push one unavailable mapping for a present raw payload declaration. */
function pushRawDeclaration(
  mappings: ProjectionMapping[],
  rawIndex: number,
  payload: Record<string, unknown>,
  declaration: 'missing' | 'redaction' | 'truncation',
  reason: string,
): void {
  if (payload[declaration] == null) return;
  mappings.push({
    path: `rawObservations[${rawIndex}].payload.${declaration}`,
    stage: STAGE,
    outcome: 'unavailable',
    reason,
  });
}

/**
 * Error-event field losses (Spec 014 §3.3): every field of the canonical
 * error payload is discarded by the legacy `provider_error` type, which
 * carries neither actor, lifecycle targeting, nor the observed error
 * payload. Each field is reported `unavailable` at its exact event path,
 * only for actual `error` events. Reasons are structural — field names and
 * vocabulary only, never error types, messages, or payload values.
 */
function pushErrorFieldLossMappings(
  mappings: ProjectionMapping[],
  event: EventRecord,
  path: string,
): void {
  if (event.kind !== 'error') return;
  pushUnavailable(mappings, `${path}.actor`,
    'legacy TraceEvent provider_error has no actor field; the canonical error actor is not projected');
  pushUnavailable(mappings, `${path}.lifecycleTarget`,
    'legacy TraceEvent provider_error has no lifecycle-target field; the canonical error lifecycleTarget is not projected');
  pushUnavailable(mappings, `${path}.lifecycleEffect`,
    'legacy TraceEvent provider_error has no lifecycle-effect field; the canonical error lifecycleEffect is not projected');
  pushUnavailable(mappings, `${path}.error`,
    'legacy TraceEvent provider_error has no error payload field; the canonical error payload is not projected');
}

/**
 * Explicit accounting for context contributions (Spec 014 §6.3): both
 * `model_request` and `context_assembled` events carry
 * `contextContributions`. The field is reported `unavailable` on whichever
 * event actually carries it (as an array — including an empty one) and is
 * never silently dropped; an event without the field produces no mapping.
 */
function pushContextContributionLossMapping(
  mappings: ProjectionMapping[],
  event: EventRecord,
  path: string,
): void {
  const carriesContributions =
    (event.kind === 'model_request' || event.kind === 'context_assembled') &&
    Array.isArray(event.contextContributions);
  if (!carriesContributions) return;
  mappings.push({
    path: `${path}.contextContributions`,
    stage: STAGE,
    outcome: 'unavailable',
    reason: 'legacy Trace has no context-contribution concept; artifact references are not projected',
  });
}

/** Legacy `TraceEventType` vocabulary, exported for mapping documentation. */
export type { TraceEventType };
