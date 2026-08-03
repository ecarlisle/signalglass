/**
 * Structured per-record field validators (Spec 014 §5.4, §2.2). These mirror
 * `scripts/validate-evidence-examples.mjs` rules so the package validators
 * agree with the repository's existing semantic validator. Messages never echo
 * payload content.
 */
import type { ValidationIssue } from './types-analysis.js';
import type { EvidenceObservation } from './types-trace.js';
import type { CaptureBoundary } from './types-record.js';
import type { MissingDeclaration } from './types-base.js';
import type { RequestEnvelope, ResponseEnvelope } from './types-envelope.js';
import {
  ARTIFACT_KINDS,
  CAPTURE_SURFACES,
  CONTROL_EVENT_KINDS,
  ERROR_ACTORS,
  EVIDENCE_STATUSES,
  EVENT_KINDS,
  LIFECYCLE_EFFECTS,
  LIFECYCLE_TARGETS,
  OBSERVATION_ROLES,
} from './vocabulary.js';
import { isRecord } from './internal/guards.js';
import { isTimestamp } from './internal/time.js';
import { isIdentifier, isSeq, isOptionalSpanId } from './internal/id.js';
import { isContentHash, isContentType } from './internal/formats.js';

const STATUSES: Set<string> = new Set(EVIDENCE_STATUSES);
const ROLES: Set<string> = new Set(OBSERVATION_ROLES);
const KINDS: Set<string> = new Set(EVENT_KINDS);
const CONTROL: Set<string> = new Set(CONTROL_EVENT_KINDS);
const TARGETS: Set<string> = new Set(LIFECYCLE_TARGETS);
const ACTORS: Set<string> = new Set(ERROR_ACTORS);
const SURFACES: Set<string> = new Set(CAPTURE_SURFACES);
const REQUEST_KINDS = new Set(
  EVENT_KINDS.filter((k) => /_(request|call)$/.test(k)),
);

export function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}

/** Envelope fidelity / nativeContentHash contract (Spec 013 §3.2) — the same
 * coherent rule set as `checkEnvelope` in the repo validator. */
export function validateEnvelope(
  env: unknown,
  eventStatus: unknown,
  kind: 'request' | 'response',
  path: string,
  out: ValidationIssue[],
): void {
  if (!isRecord(env)) {
    out.push(issue('envelope_not_object', path, `${kind}Envelope must be an object`));
    return;
  }
  const v = env as Record<string, unknown>;
  const fid = v['providerNativeFidelity'];
  if (fid !== 'structurally_faithful' && fid !== 'byte_faithful') {
    out.push(issue('envelope_invalid_fidelity', path, `${kind}Envelope missing required providerNativeFidelity (structurally_faithful | byte_faithful)`));
    return;
  }
  if (v['nativeContentHash'] !== undefined && !isContentHash(v['nativeContentHash'])) {
    out.push(issue('native_content_hash_invalid', `${path}.nativeContentHash`, `nativeContentHash is not 'sha256:' + 64 lowercase hex`));
  }
  if (fid === 'byte_faithful') {
    if (eventStatus !== 'captured') {
      out.push(issue('byte_faithful_without_captured', path, `${kind}Envelope declares byte_faithful but event evidenceStatus is ${String(eventStatus)} — byte fidelity requires the exact native bytes to have been observed and captured`));
      return;
    }
    if (typeof v['nativeEncoding'] !== 'string' || !isContentType(v['nativeContentType'])) {
      out.push(issue('byte_faithful_requires_native_fields', path, `${kind}Envelope byte_faithful requires nativeEncoding and nativeContentType`));
    }
    if (v['nativeContentHash'] === undefined) {
      out.push(issue('byte_faithful_requires_native_hash', path, `${kind}Envelope byte_faithful with captured native bytes requires nativeContentHash over the observed native bytes`));
    }
  } else if (v['nativeContentHash'] !== undefined && eventStatus !== 'captured') {
    out.push(issue('native_hash_without_captured', path, `${kind}Envelope carries nativeContentHash but event evidenceStatus is ${String(eventStatus)} — a native content hash claims observed, retained bytes`));
  }
  if (kind === 'request') {
    if (typeof v['model'] !== 'string' || v['model'].length === 0) {
      out.push(issue('request_envelope_missing_model', `${path}.model`, `requestEnvelope missing required model`));
    }
    if (typeof v['provider'] !== 'string' || v['provider'].length === 0) {
      out.push(issue('request_envelope_missing_provider', `${path}.provider`, `requestEnvelope missing required provider`));
    }
  }
}

/** Validate a raw observation's structure, vocabularies, and kind-specific
 * fields. Identity uniqueness is enforced separately across the array. */
export function validateObservation(obs: unknown, path: string, out: ValidationIssue[]): void {
  if (!isRecord(obs)) {
    out.push(issue('observation_not_object', path, 'raw observation must be an object'));
    return;
  }
  const v = obs as Record<string, unknown>;
  if (!isIdentifier(v['observationId'])) {
    out.push(issue('observation_id_invalid', `${path}.observationId`, 'observationId must be a non-empty opaque string'));
  }
  if (!isIdentifier(v['eventId'])) {
    out.push(issue('event_id_invalid', `${path}.eventId`, 'eventId must be a non-empty opaque string'));
  }
  if (!isIdentifier(v['traceId'])) {
    out.push(issue('trace_id_invalid', `${path}.traceId`, 'traceId must be a non-empty opaque string'));
  }
  if (!isOptionalSpanId(v['spanId'])) {
    out.push(issue('span_id_invalid', `${path}.spanId`, 'spanId must be an opaque string or null'));
  }
  if (!isSeq(v['seq'])) {
    out.push(issue('seq_invalid', `${path}.seq`, `seq must be a non-negative integer (got ${JSON.stringify(v['seq'])})`));
  }
  if (typeof v['kind'] !== 'string' || !KINDS.has(v['kind'])) {
    out.push(issue('unknown_event_kind', `${path}.kind`, `kind '${String(v['kind'])}' is not in the closed event-kind vocabulary`));
    return;
  }
  const kind = v['kind'] as string;
  if (!isTimestamp(v['capturedAt'])) {
    out.push(issue('captured_at_invalid', `${path}.capturedAt`, 'capturedAt must be an ISO 8601 UTC timestamp with millisecond precision'));
  }
  if (!STATUSES.has(v['evidenceStatus'] as string)) {
    out.push(issue('invalid_evidence_status', `${path}.evidenceStatus`, `evidenceStatus '${String(v['evidenceStatus'])}' is not in the closed status vocabulary`));
  }
  if (!isTimestamp(v['rawCapturedAt'])) {
    out.push(issue('raw_captured_at_invalid', `${path}.rawCapturedAt`, 'rawCapturedAt must be an ISO 8601 UTC timestamp with millisecond precision'));
  }
  const role = v['observationRole'] ?? null;
  if (CONTROL.has(kind)) {
    if (role !== null && role !== undefined) {
      out.push(issue('control_event_has_role', `${path}.observationRole`, `control event kind '${kind}' must not carry observationRole`));
    }
  } else if (role === null || role === undefined) {
    out.push(issue('missing_observation_role', `${path}.observationRole`, `payload-bearing event (kind '${kind}') missing required observationRole`));
  } else if (!ROLES.has(role as string)) {
    out.push(issue('invalid_observation_role', `${path}.observationRole`, `observationRole '${String(role)}' is not in the closed role vocabulary`));
  } else if (role === 'unobservable' && v['evidenceStatus'] !== 'unknown') {
    out.push(issue('unobservable_requires_unknown', `${path}.observationRole`, "observationRole 'unobservable' requires evidenceStatus 'unknown'"));
  }
  const payload = v['payload'];
  if (!CONTROL.has(kind)) {
    if (!isRecord(payload)) {
      out.push(issue('payload_not_object', `${path}.payload`, `payload-bearing event (kind '${kind}') requires an object payload`));
    }
  }
  validateKindSpecific(v, payload, kind, path, out);
}

function validateKindSpecific(
  v: Record<string, unknown>,
  payload: unknown,
  kind: string,
  path: string,
  out: ValidationIssue[],
): void {
  const p = isRecord(payload) ? payload : {};
  const pv = p as Record<string, unknown>;
  const eventStatus = v['evidenceStatus'];
  const spanId = v['spanId'];

  if (kind === 'model_request') {
    if (!isRecord(pv['requestEnvelope'])) {
      out.push(issue('model_request_missing_envelope', `${path}.payload.requestEnvelope`, "model_request requires requestEnvelope"));
    } else {
      validateEnvelope(pv['requestEnvelope'], eventStatus, 'request', `${path}.payload.requestEnvelope`, out);
    }
  } else if (kind === 'model_response' || kind === 'model_response_chunk') {
    if (!isRecord(pv['responseEnvelope'])) {
      out.push(issue('model_response_missing_envelope', `${path}.payload.responseEnvelope`, `${kind} requires responseEnvelope`));
    } else {
      validateEnvelope(pv['responseEnvelope'], eventStatus, 'response', `${path}.payload.responseEnvelope`, out);
    }
  } else if (kind === 'model_usage') {
    if (!isRecord(pv['usage'])) {
      out.push(issue('usage_missing', `${path}.payload.usage`, 'model_usage requires usage'));
    }
  } else if (kind === 'tool_call') {
    if (!isRecord(pv['tool']) || typeof (pv['tool'] as Record<string, unknown>)['name'] !== 'string') {
      out.push(issue('tool_call_invalid', `${path}.payload.tool`, 'tool_call requires tool with a name'));
    }
  } else if (kind === 'tool_result') {
    if (!isRecord(pv['toolResult'])) {
      out.push(issue('tool_result_invalid', `${path}.payload.toolResult`, 'tool_result requires toolResult'));
    }
  } else if (kind === 'mcp_request') {
    if (!isRecord(pv['mcp'])) {
      out.push(issue('mcp_request_invalid', `${path}.payload.mcp`, 'mcp_request requires mcp'));
    }
  } else if (kind === 'mcp_result') {
    if (!isRecord(pv['mcpResult'])) {
      out.push(issue('mcp_result_invalid', `${path}.payload.mcpResult`, 'mcp_result requires mcpResult'));
    }
  } else if (kind === 'retrieval_request') {
    if (!isRecord(pv['retrieval'])) {
      out.push(issue('retrieval_request_invalid', `${path}.payload.retrieval`, 'retrieval_request requires retrieval'));
    }
  } else if (kind === 'retrieval_result') {
    if (!isRecord(pv['retrievalResult'])) {
      out.push(issue('retrieval_result_invalid', `${path}.payload.retrievalResult`, 'retrieval_result requires retrievalResult'));
    }
  } else if (kind === 'context_provider_request' || kind === 'context_provider_result') {
    if (!isRecord(pv['contextProvider'])) {
      out.push(issue('context_provider_invalid', `${path}.payload.contextProvider`, `${kind} requires contextProvider`));
    }
  } else if (kind === 'error') {
    if (!ACTORS.has(pv['actor'] as string)) {
      out.push(issue('error_invalid_actor', `${path}.payload.actor`, `error actor '${String(pv['actor'])}' is not in the closed actor vocabulary`));
    }
    if (!TARGETS.has(pv['lifecycleTarget'] as string)) {
      out.push(issue('error_invalid_target', `${path}.payload.lifecycleTarget`, `error lifecycleTarget '${String(pv['lifecycleTarget'])}' is not in {trace, span, none}`));
    }
    if (pv['lifecycleEffect'] !== 'fail' && pv['lifecycleEffect'] !== 'none') {
      out.push(issue('error_invalid_effect', `${path}.payload.lifecycleEffect`, 'error lifecycleEffect must be fail or none'));
    }
    if (!isRecord(pv['error'])) {
      out.push(issue('error_payload_missing', `${path}.payload.error`, 'error requires an error payload object'));
    }
    validateTargetSpan(spanId, pv['lifecycleTarget'], path, out);
  } else if (kind === 'cancelled') {
    if (pv['lifecycleEffect'] !== 'cancel') {
      out.push(issue('cancelled_invalid_effect', `${path}.payload.lifecycleEffect`, "cancelled lifecycleEffect must be 'cancel'"));
    }
    if (!TARGETS.has(pv['lifecycleTarget'] as string)) {
      out.push(issue('cancelled_invalid_target', `${path}.payload.lifecycleTarget`, `cancelled lifecycleTarget '${String(pv['lifecycleTarget'])}' is not in {trace, span, none}`));
    }
    if (!isRecord(pv['cancellation'])) {
      out.push(issue('cancellation_missing', `${path}.payload.cancellation`, 'cancelled requires cancellation'));
    }
    validateTargetSpan(spanId, pv['lifecycleTarget'], path, out);
  } else if (kind === 'retry') {
    const r = pv['retry'];
    if (!isRecord(r)) {
      out.push(issue('retry_missing', `${path}.payload.retry`, 'retry requires retry'));
    } else {
      const rv = r as Record<string, unknown>;
      if (typeof rv['originalRequestEventId'] !== 'string' || rv['originalRequestEventId'].length === 0) {
        out.push(issue('retry_missing_original', `${path}.payload.retry.originalRequestEventId`, 'retry missing originalRequestEventId'));
      }
      if (typeof rv['attempt'] !== 'number' || !Number.isInteger(rv['attempt']) || rv['attempt'] < 1) {
        out.push(issue('retry_invalid_attempt', `${path}.payload.retry.attempt`, 'retry attempt must be a positive integer'));
      }
    }
  }

  if (kind === 'model_request' && Array.isArray(pv['contextContributions'])) {
    for (const [ci, c] of (pv['contextContributions'] as unknown[]).entries()) {
      if (!isRecord(c)) {
        out.push(issue('contribution_invalid', `${path}.payload.contextContributions[${ci}]`, 'context contribution must be an object'));
        continue;
      }
      const cv = c as Record<string, unknown>;
      if (typeof cv['artifactId'] !== 'string' || cv['artifactId'].length === 0) {
        out.push(issue('contribution_missing_artifact', `${path}.payload.contextContributions[${ci}].artifactId`, 'context contribution missing artifactId'));
      }
      if (typeof cv['position'] !== 'number' || !Number.isInteger(cv['position']) || cv['position'] < 0) {
        out.push(issue('contribution_invalid_position', `${path}.payload.contextContributions[${ci}].position`, 'contribution position must be a non-negative integer'));
      }
    }
  }
}

function validateTargetSpan(spanId: unknown, target: unknown, path: string, out: ValidationIssue[]): void {
  if (target === 'span' && (spanId === null || spanId === undefined)) {
    out.push(issue('target_span_requires_span', `${path}.spanId`, 'lifecycleTarget span requires a non-null spanId matching the attached span'));
  }
  if (target === 'trace' && spanId !== null && spanId !== undefined) {
    out.push(issue('target_trace_requires_null_span', `${path}.spanId`, 'lifecycleTarget trace requires spanId: null'));
  }
}

/** Validate the capture boundary declaration. */
export function validateCaptureBoundary(boundary: unknown, path: string, out: ValidationIssue[]): void {
  if (!isRecord(boundary)) {
    out.push(issue('capture_boundary_missing', path, 'captureBoundary must be an object'));
    return;
  }
  const v = boundary as Record<string, unknown>;
  if (typeof v['captureSurface'] !== 'string' || !SURFACES.has(v['captureSurface'])) {
    out.push(issue('capture_surface_invalid', `${path}.captureSurface`, `captureSurface '${String(v['captureSurface'])}' is not in the closed surface vocabulary`));
  }
  if (typeof v['observationBoundary'] !== 'string' || !ROLES.has(v['observationBoundary'])) {
    out.push(issue('observation_boundary_invalid', `${path}.observationBoundary`, `observationBoundary '${String(v['observationBoundary'])}' is not a valid observation role`));
  }
  if (!Array.isArray(v['declaredEventKinds']) || !v['declaredEventKinds'].every((k) => typeof k === 'string')) {
    out.push(issue('declared_event_kinds_invalid', `${path}.declaredEventKinds`, 'declaredEventKinds must be an array of strings'));
  }
  if (!Array.isArray(v['declaredSurfaces']) || !v['declaredSurfaces'].every((s) => SURFACES.has(s as string))) {
    out.push(issue('declared_surfaces_invalid', `${path}.declaredSurfaces`, 'declaredSurfaces must be an array of valid capture surfaces'));
  }
  const mr = v['missingRecord'];
  if (mr !== null && mr !== undefined) {
    if (!isRecord(mr)) {
      out.push(issue('missing_record_invalid', `${path}.missingRecord`, 'missingRecord must be an object or null'));
    } else {
      const mv = mr as Record<string, unknown>;
      if (typeof mv['reason'] !== 'string' || mv['reason'].length === 0) {
        out.push(issue('missing_record_reason_invalid', `${path}.missingRecord.reason`, 'missingRecord requires a reason'));
      }
    }
  }
}

/** Validate the trace capture-profile reference. */
export function validateCaptureProfile(profile: unknown, path: string, out: ValidationIssue[]): void {
  if (!isRecord(profile)) {
    out.push(issue('capture_profile_missing', path, 'trace.captureProfile must be an object'));
    return;
  }
  const v = profile as Record<string, unknown>;
  if (typeof v['name'] !== 'string' || v['name'].length === 0) {
    out.push(issue('capture_profile_name_invalid', `${path}.name`, 'captureProfile.name must be a non-empty string'));
  }
  if (typeof v['version'] !== 'string' || v['version'].length === 0) {
    out.push(issue('capture_profile_version_invalid', `${path}.version`, 'captureProfile.version must be a non-empty string'));
  }
}
