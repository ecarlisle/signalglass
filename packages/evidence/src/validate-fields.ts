/**
 * Structured per-record field validators (Spec 014 §5.4, §2.2; Spec 016).
 * These mirror `scripts/validate-evidence-examples.mjs` rules so the package
 * validators agree with the repository's existing semantic validator.
 * Messages never echo payload content.
 */
import type { ValidationIssue } from './types-analysis.js';
import type { EvidenceObservation } from './types-trace.js';
import type { EvidenceTrace } from './types-trace.js';
import type { StreamingCaptureBoundary } from './types-record.js';
import type { MissingDeclaration } from './types-base.js';
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
  REQUEST_ROLES,
  DECODER_DISPOSITIONS,
  REQUEST_BODY_RETENTION,
  POST_TERMINAL,
  UPSTREAM_OUTCOMES,
  CLIENT_RESPONSE_OUTCOMES,
  UPSTREAM_CANCELLATION_CAUSES,
  MALFORMED_STREAM_CODES,
  CLIENT_REQUEST_FAILURE_CODES,
  TRANSPORT_FAILURE_CODES,
  OBSERVATION_FAILURE_CODES,
  UPSTREAM_FAILURE_CODES,
  RETENTION3_VALUES,
  RETENTION4_VALUES,
  REMAINDER_KNOWLEDGE_VALUES,
  UNMAPPED_DELTA_FIELD_CATEGORIES,
} from './vocabulary.js';
import { isRecord } from './internal/guards.js';
import { isTimestamp } from './internal/time.js';
import { isIdentifier, isSeq, isOptionalSpanId } from './internal/id.js';
import { isContentHash, isContentType, isSemanticVersion } from './internal/formats.js';

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
const REQUEST_ROLES_SET: Set<string> = new Set(REQUEST_ROLES);
const DECODER_DISPOSITIONS_SET: Set<string> = new Set(DECODER_DISPOSITIONS);
const REQUEST_BODY_RETENTION_SET: Set<string> = new Set(REQUEST_BODY_RETENTION);
const POST_TERMINAL_SET: Set<string> = new Set(POST_TERMINAL);
const UPSTREAM_OUTCOMES_SET: Set<string> = new Set(UPSTREAM_OUTCOMES);
const CLIENT_RESPONSE_OUTCOMES_SET: Set<string> = new Set(CLIENT_RESPONSE_OUTCOMES);
const UPSTREAM_CANCELLATION_CAUSES_SET: Set<string> = new Set(UPSTREAM_CANCELLATION_CAUSES);
const MALFORMED_STREAM_CODES_SET: Set<string> = new Set(MALFORMED_STREAM_CODES);
const CLIENT_REQUEST_FAILURE_CODES_SET: Set<string> = new Set(CLIENT_REQUEST_FAILURE_CODES);
const TRANSPORT_FAILURE_CODES_SET: Set<string> = new Set(TRANSPORT_FAILURE_CODES);
const OBSERVATION_FAILURE_CODES_SET: Set<string> = new Set(OBSERVATION_FAILURE_CODES);
const UPSTREAM_FAILURE_CODES_SET: Set<string> = new Set(UPSTREAM_FAILURE_CODES);
const ALL_ERROR_CODES_SET = new Set<string>([...MALFORMED_STREAM_CODES, ...CLIENT_REQUEST_FAILURE_CODES, ...UPSTREAM_FAILURE_CODES, ...OBSERVATION_FAILURE_CODES]);
const RETENTION3_SET = new Set<string>(RETENTION3_VALUES);
const RETENTION4_SET = new Set<string>(RETENTION4_VALUES);
const REMAINDER_SET = new Set<string>(REMAINDER_KNOWLEDGE_VALUES);
const UNMAPPED_DELTA_SET = new Set<string>(UNMAPPED_DELTA_FIELD_CATEGORIES);
const MAX_RETAINED_CONTENT_CODE_POINTS = 240;
const MAX_METADATA_LABEL_CODE_POINTS = 128;
const MAX_ERROR_MESSAGE_CODE_POINTS = 200;

function isAtLeast11(version: string): boolean {
  if (!isSemanticVersion(version)) return false;
  const [major, minor] = version.split('.').map(Number);
  return major === 1 && (minor ?? 0) >= 1;
}

function codePoints(value: string): number {
  return [...value].length;
}

function closedObject(value: Record<string, unknown>, keys: readonly string[], path: string, out: ValidationIssue[]): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    out.push(issue('closed_shape_unknown_key', path, 'object contains a field outside the closed schema'));
  }
}

export function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}

/** Envelope fidelity / nativeContentHash contract (Spec 013 §3.2) — the same
 * coherent rule set as `checkEnvelope` in the repo validator. */
function validateEnvelope(
  env: unknown,
  eventStatus: unknown,
  kind: 'request' | 'response',
  path: string,
  out: ValidationIssue[],
  schemaVersion = '1.0.0',
  eventKind?: string,
): void {
  if (!isRecord(env)) {
    out.push(issue('envelope_not_object', path, `${kind}Envelope must be an object`));
    return;
  }
  const v = env as Record<string, unknown>;
  if (isAtLeast11(schemaVersion)) {
    const common = ['providerNativeFidelity', 'nativeEncoding', 'nativeContentType', 'nativeContentHash'];
    const requestKeys = [...common, 'model', 'provider', 'messages', 'providerNative'];
    const responseHeaderKeys = [...common, 'responseMeta'];
    const responseChunkKeys = [...common, 'finishReason', 'providerNative', 'usage', 'chunkIndex', 'choiceIndex', 'deltaText'];
    closedObject(v, kind === 'request' ? requestKeys : eventKind === 'model_response' ? responseHeaderKeys : responseChunkKeys, path, out);
  }
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
    if (isAtLeast11(schemaVersion) && v['messages'] !== undefined) validateMessages(v['messages'], `${path}.messages`, out);
  } else if (isAtLeast11(schemaVersion)) {
    validateResponse11(v, eventStatus, eventKind, path, out);
  } else if (v['responseMeta'] !== undefined || v['choiceIndex'] !== undefined || v['deltaText'] !== undefined) {
    out.push(issue('field_not_allowed_in_schema_version', path, '1.1 response fields are not allowed in schema 1.0.x'));
  }
}

/** Validate a raw observation's structure, vocabularies, and kind-specific
 * fields. Identity uniqueness is enforced separately across the array. */
export function validateObservation(obs: unknown, path: string, out: ValidationIssue[], schemaVersion = '1.0.0'): void {
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
  validateKindSpecific(v, payload, kind, path, out, schemaVersion);
}

function validateKindSpecific(
  v: Record<string, unknown>,
  payload: unknown,
  kind: string,
  path: string,
  out: ValidationIssue[],
  schemaVersion: string,
): void {
  const p = isRecord(payload) ? payload : {};
  const pv = p as Record<string, unknown>;
  const eventStatus = v['evidenceStatus'];
  const spanId = v['spanId'];

  if (kind === 'model_request') {
    if (!isRecord(pv['requestEnvelope'])) {
      out.push(issue('model_request_missing_envelope', `${path}.payload.requestEnvelope`, "model_request requires requestEnvelope"));
    } else {
      validateEnvelope(pv['requestEnvelope'], eventStatus, 'request', `${path}.payload.requestEnvelope`, out, schemaVersion, kind);
    }
  } else if (kind === 'model_response' || kind === 'model_response_chunk') {
    if (!isRecord(pv['responseEnvelope'])) {
      out.push(issue('model_response_missing_envelope', `${path}.payload.responseEnvelope`, `${kind} requires responseEnvelope`));
    } else {
      validateEnvelope(pv['responseEnvelope'], eventStatus, 'response', `${path}.payload.responseEnvelope`, out, schemaVersion, kind);
      if (kind === 'model_response_chunk' && isAtLeast11(schemaVersion)) {
        const envelope = pv['responseEnvelope'] as Record<string, unknown>;
        if (envelope['deltaText'] !== undefined) validateLeaf({
          text: envelope['deltaText'],
          evidenceStatus: eventStatus,
          ...(pv['redaction'] !== undefined ? { redaction: pv['redaction'] } : {}),
          ...(pv['truncation'] !== undefined ? { truncation: pv['truncation'] } : {}),
        }, `${path}.payload`, out);
      }
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
    if (isAtLeast11(schemaVersion) && isRecord(pv['error'])) {
      closedObject(pv['error'], ['type', 'message'], `${path}.payload.error`, out);
      if (!ALL_ERROR_CODES_SET.has(pv['error']['type'] as string)) out.push(issue('error_type_invalid', `${path}.payload.error.type`, 'error type is outside the closed vocabulary'));
      if (pv['error']['message'] !== undefined && (typeof pv['error']['message'] !== 'string' || codePoints(pv['error']['message'] as string) > MAX_ERROR_MESSAGE_CODE_POINTS)) out.push(issue('error_message_invalid', `${path}.payload.error.message`, 'error message must be bounded structural text'));
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
    if (isAtLeast11(schemaVersion) && isRecord(pv['cancellation'])) {
      closedObject(pv['cancellation'], ['requestedBy'], `${path}.payload.cancellation`, out);
      if (pv['cancellation']['requestedBy'] !== 'client' && pv['cancellation']['requestedBy'] !== 'ingress') out.push(issue('cancellation_requester_invalid', `${path}.payload.cancellation.requestedBy`, 'cancellation requester is outside the closed vocabulary'));
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

function validateLeaf(value: unknown, path: string, out: ValidationIssue[]): void {
  if (!isRecord(value)) {
    out.push(issue('content_leaf_invalid', path, 'content leaf must be an object'));
    return;
  }
  closedObject(value, ['text', 'evidenceStatus', 'redaction', 'truncation'], path, out);
  const text = value['text'];
  const status = value['evidenceStatus'];
  if (typeof text !== 'string' || codePoints(text) > MAX_RETAINED_CONTENT_CODE_POINTS) out.push(issue('content_leaf_text_invalid', `${path}.text`, `content leaf text must be a string of at most ${MAX_RETAINED_CONTENT_CODE_POINTS} code points`));
  if (status !== 'captured' && status !== 'truncated' && status !== 'redacted') out.push(issue('content_leaf_status_invalid', `${path}.evidenceStatus`, 'content leaf status is outside the closed leaf vocabulary'));
  const redaction = value['redaction'];
  const truncation = value['truncation'];
  if (redaction !== undefined) {
    if (!isRecord(redaction)) out.push(issue('leaf_redaction_invalid', `${path}.redaction`, 'leaf redaction declaration must be an object'));
    else {
      closedObject(redaction, ['policy', 'reasons', 'spanCount', 'maskedCodePoints'], `${path}.redaction`, out);
      if (typeof redaction['policy'] !== 'string' || !Array.isArray(redaction['reasons']) || !redaction['reasons'].every((x) => typeof x === 'string') || !Number.isInteger(redaction['spanCount']) || (redaction['spanCount'] as number) < 1 || !Number.isInteger(redaction['maskedCodePoints']) || (redaction['maskedCodePoints'] as number) < (redaction['spanCount'] as number)) out.push(issue('leaf_redaction_invalid', `${path}.redaction`, 'leaf redaction declaration is malformed or out of bounds'));
    }
  }
  if (truncation !== undefined) {
    if (!isRecord(truncation)) out.push(issue('leaf_truncation_invalid', `${path}.truncation`, 'leaf truncation declaration must be an object'));
    else {
      closedObject(truncation, ['maxLength', 'originalLength', 'retainedLength'], `${path}.truncation`, out);
      const retained = typeof text === 'string' ? codePoints(text) : -1;
      if (truncation['maxLength'] !== MAX_RETAINED_CONTENT_CODE_POINTS || !Number.isInteger(truncation['originalLength']) || !Number.isInteger(truncation['retainedLength']) || truncation['retainedLength'] !== retained || (truncation['originalLength'] as number) <= retained) out.push(issue('leaf_truncation_invalid', `${path}.truncation`, 'leaf truncation declaration is malformed or inconsistent'));
    }
  }
  if (status === 'captured' && (redaction !== undefined || truncation !== undefined)) out.push(issue('leaf_declaration_disagrees', path, 'captured leaf must not carry transformation declarations'));
  if (status === 'truncated' && (truncation === undefined || redaction !== undefined)) out.push(issue('leaf_declaration_disagrees', path, 'truncated leaf requires only its truncation declaration'));
  if (status === 'redacted' && redaction === undefined) out.push(issue('leaf_declaration_disagrees', path, 'redacted leaf requires a redaction declaration'));
}

function validateLabel(value: unknown, path: string, out: ValidationIssue[]): void {
  if (typeof value !== 'string' || codePoints(value) > MAX_METADATA_LABEL_CODE_POINTS) out.push(issue('metadata_label_invalid', path, `metadata label must be a string of at most ${MAX_METADATA_LABEL_CODE_POINTS} code points`));
}

function validateMessages(value: unknown, path: string, out: ValidationIssue[]): void {
  if (!Array.isArray(value)) { out.push(issue('request_messages_invalid', path, 'messages must be an array')); return; }
  value.forEach((message, index) => {
    const mp = `${path}[${index}]`;
    if (!isRecord(message)) { out.push(issue('request_message_invalid', mp, 'message must be an object')); return; }
    closedObject(message, ['role', 'content', 'name'], mp, out);
    if (typeof message['role'] !== 'string' || !REQUEST_ROLES_SET.has(message['role'])) out.push(issue('request_role_invalid', `${mp}.role`, 'request role is outside the closed vocabulary'));
    if (message['name'] !== undefined) validateLabel(message['name'], `${mp}.name`, out);
    const content = message['content'];
    if (!Array.isArray(content)) { validateLeaf(content, `${mp}.content`, out); return; }
    content.forEach((part, partIndex) => {
      const pp = `${mp}.content[${partIndex}]`;
      if (!isRecord(part) || typeof part['kind'] !== 'string') { out.push(issue('content_part_invalid', pp, 'content part must be a closed discriminated object')); return; }
      if (part['kind'] === 'text') { closedObject(part, ['kind', 'text'], pp, out); validateLeaf(part['text'], `${pp}.text`, out); }
      else if (part['kind'] === 'image_url') { closedObject(part, ['kind', 'url'], pp, out); validateLeaf(part['url'], `${pp}.url`, out); }
      else if (part['kind'] === 'tool_call') { closedObject(part, ['kind', 'id', 'name', 'arguments'], pp, out); validateLabel(part['id'], `${pp}.id`, out); validateLabel(part['name'], `${pp}.name`, out); validateLeaf(part['arguments'], `${pp}.arguments`, out); }
      else if (part['kind'] === 'tool_result') { closedObject(part, ['kind', 'toolCallId', 'content'], pp, out); validateLabel(part['toolCallId'], `${pp}.toolCallId`, out); validateLeaf(part['content'], `${pp}.content`, out); }
      else out.push(issue('content_part_kind_invalid', `${pp}.kind`, 'content part kind is outside the closed vocabulary'));
    });
  });
}

function validateResponse11(v: Record<string, unknown>, eventStatus: unknown, eventKind: string | undefined, path: string, out: ValidationIssue[]): void {
  const meta = v['responseMeta'];
  const choice = v['choiceIndex'];
  const delta = v['deltaText'];
  if (eventKind === 'model_response') {
    if (!isRecord(meta)) out.push(issue('response_meta_missing', `${path}.responseMeta`, 'model_response requires responseMeta'));
    else {
      closedObject(meta, ['statusCode', 'contentType', 'contentEncoding'], `${path}.responseMeta`, out);
      if (!Number.isInteger(meta['statusCode']) || (meta['statusCode'] as number) < 100 || (meta['statusCode'] as number) > 599) out.push(issue('response_status_invalid', `${path}.responseMeta.statusCode`, 'response status must be an integer from 100 through 599'));
      for (const key of ['contentType', 'contentEncoding']) if (meta[key] !== undefined && (typeof meta[key] !== 'string' || (meta[key] as string).length > 255 || /[\r\n]/.test(meta[key] as string))) out.push(issue('response_metadata_invalid', `${path}.responseMeta.${key}`, 'response metadata value is invalid'));
      if (meta['contentType'] !== undefined && !isContentType(meta['contentType'])) out.push(issue('response_metadata_invalid', `${path}.responseMeta.contentType`, 'content type must be a normalized media type without parameters'));
      if (meta['contentEncoding'] !== undefined && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(meta['contentEncoding'] as string)) out.push(issue('response_metadata_invalid', `${path}.responseMeta.contentEncoding`, 'content encoding must be a single token'));
    }
    for (const key of ['finishReason', 'providerNative', 'usage', 'chunkIndex', 'choiceIndex', 'deltaText']) if (v[key] !== undefined) out.push(issue('response_envelope_field_placement', `${path}.${key}`, 'field is not allowed on the metadata-only model response'));
    if (choice !== undefined || delta !== undefined) out.push(issue('response_envelope_field_placement', path, 'chunk fields are not allowed on model_response'));
  } else if (eventKind === 'model_response_chunk') {
    if (meta !== undefined) out.push(issue('response_envelope_field_placement', `${path}.responseMeta`, 'responseMeta is allowed only on model_response'));
    if (!Number.isInteger(choice) || (choice as number) < 0) out.push(issue('choice_index_invalid', `${path}.choiceIndex`, 'choiceIndex must be a non-negative integer'));
    if (delta !== undefined && (typeof delta !== 'string' || codePoints(delta) > MAX_RETAINED_CONTENT_CODE_POINTS)) out.push(issue('delta_text_invalid', `${path}.deltaText`, `deltaText must be a string of at most ${MAX_RETAINED_CONTENT_CODE_POINTS} code points`));
    if (delta !== undefined && !['captured', 'truncated', 'redacted'].includes(String(eventStatus))) out.push(issue('delta_text_status_invalid', path, 'retained deltaText requires a retaining evidence status'));
  } else if (meta !== undefined || choice !== undefined || delta !== undefined) out.push(issue('response_envelope_field_placement', path, '1.1 response fields are not allowed on this event'));
}

/** Validate the capture boundary declaration. */
export function validateCaptureBoundary(boundary: unknown, path: string, out: ValidationIssue[], schemaVersion = '1.0.0'): void {
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
  if (isAtLeast11(schemaVersion)) {
    if (v['streaming'] !== undefined) {
      if (v['captureSurface'] !== 'ingress_proxy' || v['observationBoundary'] !== 'provider_reported') out.push(issue('streaming_capture_boundary_invalid', path, 'streaming records require the ingress proxy and provider-reported boundary'));
      validateStreamingBoundary(v['streaming'], `${path}.streaming`, out);
    }
  } else if (v['streaming'] !== undefined) {
    out.push(issue('field_not_allowed_in_schema_version', `${path}.streaming`, 'streaming boundary is not allowed in schema 1.0.x'));
  }
}

const VALID_PAIRS: Record<string, readonly string[]> = {
  'not-started': ['not-started', 'closed-before-completion', 'local-error-flushed'],
  'response-completed': ['not-started', 'flushed', 'closed-before-completion', 'local-error-flushed'],
  'connection-failed': ['not-started', 'closed-before-completion', 'local-error-flushed'],
  'stream-ended-prematurely': ['not-started', 'closed-before-completion'],
  'cancelled-by-ingress': ['not-started', 'closed-before-completion'],
};

function validateIdentity(value: unknown, path: string, literal: string, out: ValidationIssue[]): void {
  if (!isRecord(value)) {
    out.push(issue('versioned_identity_invalid', path, 'versioned identity has an invalid literal name or semantic version'));
    return;
  }
  closedObject(value, ['name', 'version'], path, out);
  if (value['name'] !== literal || !isSemanticVersion(value['version'])) out.push(issue('versioned_identity_invalid', path, 'versioned identity has an invalid literal name or semantic version'));
}

function validateStreamingBoundary(value: unknown, path: string, out: ValidationIssue[]): void {
  if (!isRecord(value)) { out.push(issue('streaming_boundary_invalid', path, 'streaming boundary must be an object')); return; }
  const v = value;
  // Unknown keys are additive and intentionally preserved.
  if (!isRecord(v['upstream']) || !UPSTREAM_OUTCOMES_SET.has(v['upstream']['outcome'] as string)) out.push(issue('upstream_outcome_invalid', `${path}.upstream`, 'upstream outcome is outside the closed vocabulary'));
  if (!isRecord(v['clientResponse']) || !CLIENT_RESPONSE_OUTCOMES_SET.has(v['clientResponse']['outcome'] as string)) out.push(issue('client_response_outcome_invalid', `${path}.clientResponse`, 'client response outcome is outside the closed vocabulary'));
  const upstream = isRecord(v['upstream']) ? v['upstream'] : {};
  const client = isRecord(v['clientResponse']) ? v['clientResponse'] : {};
  closedObject(upstream, ['outcome', 'cause'], `${path}.upstream`, out);
  closedObject(client, ['outcome'], `${path}.clientResponse`, out);
  if (upstream['outcome'] === 'cancelled-by-ingress') {
    if (!UPSTREAM_CANCELLATION_CAUSES_SET.has(upstream['cause'] as string)) out.push(issue('upstream_cancel_cause_invalid', `${path}.upstream.cause`, 'cancelled upstream requires a closed cancellation cause'));
  } else if (upstream['cause'] !== undefined) out.push(issue('upstream_cancel_cause_invalid', `${path}.upstream.cause`, 'cancellation cause is allowed only for cancelled-by-ingress'));
  if (typeof upstream['outcome'] === 'string' && typeof client['outcome'] === 'string' && !VALID_PAIRS[upstream['outcome']]?.includes(client['outcome'] as string)) out.push(issue('upstream_client_outcome_invalid', path, 'upstream and client-response outcomes form an impossible pair'));
  if (!DECODER_DISPOSITIONS_SET.has(v['decoderDisposition'] as string)) out.push(issue('decoder_disposition_invalid', `${path}.decoderDisposition`, 'decoder disposition is outside the closed vocabulary'));
  if (!isRecord(v['remainder']) || !REMAINDER_SET.has(v['remainder']['knowledge'] as string)) out.push(issue('remainder_invalid', `${path}.remainder`, 'remainder knowledge is outside the closed vocabulary'));
  else {
    closedObject(v['remainder'], ['knowledge', 'lastObservedFramePosition', 'rawForwardedBytes'], `${path}.remainder`, out);
    const position = v['remainder']['lastObservedFramePosition']; const bytes = v['remainder']['rawForwardedBytes'];
    if (position !== undefined && (!Number.isInteger(position) || (position as number) < 1)) out.push(issue('frame_position_invalid', `${path}.remainder.lastObservedFramePosition`, 'last observed frame position must be a positive integer'));
    if (bytes !== undefined && (!Number.isInteger(bytes) || (bytes as number) < 0)) out.push(issue('raw_forwarded_bytes_invalid', `${path}.remainder.rawForwardedBytes`, 'raw forwarded bytes must be a non-negative integer'));
  }
  validateLosses(v['losses'], `${path}.losses`, v['decoderDisposition'], out);
  if (!isRecord(v['assembly'])) out.push(issue('assembly_invalid', `${path}.assembly`, 'assembly must be an object'));
  else {
    closedObject(v['assembly'], ['assembler', 'decoderContract'], `${path}.assembly`, out);
    validateIdentity(v['assembly']['assembler'], `${path}.assembly.assembler`, 'signalglass.streaming.assembler', out);
    const decoder = v['assembly']['decoderContract'];
    if (v['decoderDisposition'] === 'openai-sse') validateIdentity(decoder, `${path}.assembly.decoderContract`, 'signalglass.providers.openai-sse', out);
    else if (decoder !== undefined) out.push(issue('decoder_contract_disagrees', `${path}.assembly.decoderContract`, 'decoder contract is present without OpenAI SSE participation'));
  }
  validateIdentity(v['captureProfile'], `${path}.captureProfile`, 'signalglass.collection.ingress-metadata-safe', out);
  validateIdentity(v['detector'], `${path}.detector`, 'signalglass.collection.sensitive-detector', out);
  if (isRecord(v['captureProfile']) && isRecord(v['assembly']) && isRecord(v['assembly']['assembler']) && v['captureProfile']['version'] !== v['assembly']['assembler']['version']) out.push(issue('capture_profile_pedigree_disagrees', `${path}.captureProfile.version`, 'capture-profile version disagrees with the assembly pedigree version'));
  validateBudgets(v['budgets'], `${path}.budgets`, out);
}

function validateLosses(value: unknown, path: string, disposition: unknown, out: ValidationIssue[]): void {
  const enumeratedKeys = ['requestBody', 'messageContent', 'deltaContent', 'providerNative', 'providerErrorBody', 'wireBytes', 'postTerminalContent', 'unmappedDeltaFields'];
  const booleanKeys = ['unrecognizedExtensionFrameObserved', 'headerValuesBeyondAllowlist', 'contentTypeParametersDropped', 'maskedContent', 'contentEncodingUnsupported', 'multimodalContentObserved', 'requestMessageUnknownKeysObserved', 'unrecognizedRoleObserved', 'sseMetadataObservedButNotRetained'];
  const keys = [...enumeratedKeys, ...booleanKeys];
  if (!isRecord(value)) { out.push(issue('streaming_losses_invalid', path, 'losses must be a complete closed object')); return; }
  closedObject(value, keys, path, out);
  if (!keys.every((key) => key in value)) out.push(issue('streaming_losses_incomplete', path, 'losses must contain every required loss fact'));
  if (!REQUEST_BODY_RETENTION_SET.has(value['requestBody'] as string)) out.push(issue('request_body_retention_invalid', `${path}.requestBody`, 'request-body retention is outside the closed vocabulary'));
  for (const key of ['messageContent', 'deltaContent']) if (!RETENTION4_SET.has(value[key] as string)) out.push(issue('retention_fact_invalid', `${path}.${key}`, 'retention fact is outside the closed vocabulary'));
  for (const key of ['providerNative', 'providerErrorBody', 'wireBytes']) if (!RETENTION3_SET.has(value[key] as string)) out.push(issue('retention_fact_invalid', `${path}.${key}`, 'retention fact is outside the closed vocabulary'));
  if (!POST_TERMINAL_SET.has(value['postTerminalContent'] as string)) out.push(issue('post_terminal_invalid', `${path}.postTerminalContent`, 'post-terminal fact is outside the closed vocabulary'));
  if (!Array.isArray(value['unmappedDeltaFields']) || !value['unmappedDeltaFields'].every((x) => typeof x === 'string' && UNMAPPED_DELTA_SET.has(x))) out.push(issue('unmapped_delta_fields_invalid', `${path}.unmappedDeltaFields`, 'unmapped delta fields must use the closed categories'));
  for (const key of booleanKeys) if (typeof value[key] !== 'boolean') out.push(issue('loss_boolean_invalid', `${path}.${key}`, 'loss fact must be boolean'));
  if (value['sseMetadataObservedButNotRetained'] === true && disposition !== 'openai-sse') out.push(issue('sse_metadata_applicability_invalid', `${path}.sseMetadataObservedButNotRetained`, 'SSE metadata can be observed only when the OpenAI SSE decoder participated'));
  if (disposition === 'unsupported-encoding' && value['contentEncodingUnsupported'] !== true) out.push(issue('encoding_loss_disagrees', `${path}.contentEncodingUnsupported`, 'unsupported encoding disposition requires its authoritative loss fact'));
}

function validateBudgets(value: unknown, path: string, out: ValidationIssue[]): void {
  const ranges: Record<string, [number, number]> = {
    maxCanonicalEvents: [1_000, 1_000_000], maxRawObservations: [2_000, 2_000_000],
    maxRawObservationPayloadBytes: [1_048_576, 67_108_864], maxRetainedContentCodePoints: [16_384, 16_777_216],
    maxSerializedEvidenceBytes: [1_048_576, 67_108_864], maxIdLengthBytes: [16, 256],
  };
  if (!isRecord(value)) { out.push(issue('streaming_budgets_invalid', path, 'budgets must be a complete closed object')); return; }
  closedObject(value, Object.keys(ranges), path, out);
  for (const [key, [min, max]] of Object.entries(ranges)) if (!Number.isInteger(value[key]) || (value[key] as number) < min || (value[key] as number) > max) out.push(issue('streaming_budget_out_of_range', `${path}.${key}`, 'budget is outside its declared range'));
  if (typeof value['maxRawObservations'] === 'number' && typeof value['maxCanonicalEvents'] === 'number' && value['maxRawObservations'] < value['maxCanonicalEvents']) out.push(issue('streaming_budget_infeasible', path, 'raw-observation budget must be at least the canonical-event budget'));
}

export function validateStreamingConsistency(trace: EvidenceTrace, streaming: StreamingCaptureBoundary, out: ValidationIssue[]): void {
  validateStreamingTerminal(trace, streaming, out);
  const responses = trace.events.filter((event) => event.kind === 'model_response');
  const responseIndexes = trace.events.flatMap((event, index) => event.kind === 'model_response' ? [index] : []);
  const responseDerivedIndexes = trace.events.flatMap((event, index) => ['model_response', 'model_response_chunk', 'model_usage'].includes(event.kind) || (event.kind === 'error' && event.actor === 'model') ? [index] : []);
  const headersObserved = responses.length > 0;
  const responseMeta = responses.length === 1 ? responses[0]!.responseEnvelope.responseMeta : undefined;
  if ((streaming.decoderDisposition === 'openai-sse' || streaming.decoderDisposition === 'unsupported-encoding') && !headersObserved) out.push(issue('decoder_disposition_disagrees', 'captureBoundary.streaming.decoderDisposition', 'decoder participation requires an observed response metadata event'));
  if (responses.length > 1 || (headersObserved && responseIndexes[0] !== responseDerivedIndexes[0])) out.push(issue('response_meta_placement_invalid', 'trace.events', 'model_response must be the single first response-derived event'));
  if (streaming.decoderDisposition === 'not-applicable' && trace.events.some((event) => event.kind === 'model_response_chunk')) out.push(issue('decoder_disposition_disagrees', 'captureBoundary.streaming.decoderDisposition', 'chunk events require OpenAI SSE decoder participation'));
  if ((streaming.decoderDisposition === 'openai-sse' || streaming.decoderDisposition === 'unsupported-encoding') && (responseMeta?.contentType !== 'text/event-stream' || responseMeta.statusCode < 200 || responseMeta.statusCode > 299)) out.push(issue('decoder_disposition_disagrees', 'captureBoundary.streaming.decoderDisposition', 'SSE decoder disposition requires a successful event-stream response'));
  if (streaming.upstream.outcome === 'not-started' && streaming.remainder.knowledge !== 'not-applicable') out.push(issue('remainder_applicability_invalid', 'captureBoundary.streaming.remainder.knowledge', 'remainder is not applicable when upstream dispatch never started'));
  if (streaming.upstream.outcome !== 'not-started' && streaming.remainder.knowledge === 'not-applicable') out.push(issue('remainder_applicability_invalid', 'captureBoundary.streaming.remainder.knowledge', 'remainder is applicable after upstream dispatch'));
  const requestEvents = trace.events.filter((event) => event.kind === 'model_request');
  const requestStatuses = requestEvents.flatMap((event) => collectLeafStatuses(event.requestEnvelope.messages));
  const requestMessages = requestEvents.flatMap((event) => Array.isArray(event.requestEnvelope.messages) ? event.requestEnvelope.messages : []);
  const hasUnrecognizedRole = requestMessages.some((message) => isRecord(message) && message['role'] === 'unrecognized');
  if (hasUnrecognizedRole && !streaming.losses.unrecognizedRoleObserved) out.push(issue('completeness_disagrees_with_derivation', 'captureBoundary.streaming.losses.unrecognizedRoleObserved', 'unrecognized role sentinel requires its authoritative loss fact'));
  const hasImagePart = requestMessages.some((message) => isRecord(message) && Array.isArray(message['content']) && message['content'].some((part) => isRecord(part) && part['kind'] === 'image_url'));
  if (hasImagePart && !streaming.losses.multimodalContentObserved) out.push(issue('completeness_disagrees_with_derivation', 'captureBoundary.streaming.losses.multimodalContentObserved', 'multimodal content requires its authoritative loss fact'));
  if (requestStatuses.length > 0) {
    const aggregate = aggregateRetention(requestStatuses, requestMessages.some((message) => messageHasTruncation(message)));
    const eventAggregate = aggregateEventStatus(requestStatuses);
    if (requestEvents.some((event) => event.evidenceStatus !== eventAggregate)) out.push(issue('completeness_disagrees_with_derivation', 'trace.events', 'model request aggregate status disagrees with its content leaves'));
    if (streaming.losses.messageContent !== aggregate && streaming.losses.messageContent !== 'omitted') out.push(issue('completeness_disagrees_with_derivation', 'captureBoundary.streaming.losses.messageContent', 'message-content fact disagrees with retained leaves'));
  } else if (streaming.losses.messageContent === 'fully-retained' || streaming.losses.messageContent === 'partially-retained') out.push(issue('completeness_disagrees_with_derivation', 'captureBoundary.streaming.losses.messageContent', 'message-content fact claims retained leaves that do not exist'));
  const allChunks = trace.events.filter((event) => event.kind === 'model_response_chunk');
  const chunks = allChunks.filter((event) => event.responseEnvelope.deltaText !== undefined);
  const wholesaleOmission = allChunks.some((event) => event.responseEnvelope.deltaText === undefined && (event.evidenceStatus === 'missing' || event.evidenceStatus === 'unknown'));
  const deltaAggregate = wholesaleOmission
    ? 'omitted'
    : chunks.length === 0
      ? 'not-observed'
      : chunks.some((event) => event.evidenceStatus === 'truncated' || event.truncation !== undefined)
        ? 'partially-retained'
        : 'fully-retained';
  if (streaming.losses.deltaContent !== deltaAggregate) out.push(issue('completeness_disagrees_with_derivation', 'captureBoundary.streaming.losses.deltaContent', 'delta-content fact disagrees with retained chunk text and declarations'));
  const redacted = requestStatuses.includes('redacted') || chunks.some((event) => event.evidenceStatus === 'redacted');
  if (streaming.losses.maskedContent !== redacted) out.push(issue('completeness_disagrees_with_derivation', 'captureBoundary.streaming.losses.maskedContent', 'masked-content fact disagrees with owning declarations'));
  const providerNativeEvents = trace.events.filter((event) =>
    (event.kind === 'model_request' && event.requestEnvelope.providerNative !== undefined)
    || (event.kind === 'model_response_chunk' && event.responseEnvelope.providerNative !== undefined),
  );
  const hasOwnedProviderNative = providerNativeEvents.some((event) =>
    event.evidenceStatus === 'captured' || event.evidenceStatus === 'truncated' || event.evidenceStatus === 'redacted',
  );
  if (streaming.losses.providerNative === 'retained' && !hasOwnedProviderNative) out.push(issue('completeness_disagrees_with_derivation', 'captureBoundary.streaming.losses.providerNative', 'retained provider-native evidence requires an owning retained payload'));
  if (streaming.losses.providerNative !== 'retained' && providerNativeEvents.length > 0) out.push(issue('completeness_disagrees_with_derivation', 'captureBoundary.streaming.losses.providerNative', 'provider-native payloads require the authoritative retained loss fact'));
  if (trace.captureProfile.name !== streaming.captureProfile.name || trace.captureProfile.version !== streaming.captureProfile.version) out.push(issue('trace_capture_profile_disagrees', 'trace.captureProfile', 'trace capture profile disagrees with the authoritative streaming boundary'));
}

function validateStreamingTerminal(trace: EvidenceTrace, streaming: StreamingCaptureBoundary, out: ValidationIssue[]): void {
  const final = trace.events[trace.events.length - 1];
  if (!final) return;
  if (final.kind === 'interaction_end') {
    if (
      streaming.upstream.outcome !== 'response-completed'
      || streaming.decoderDisposition !== 'openai-sse'
      || streaming.remainder.knowledge !== 'protocol-terminal-observed'
    ) {
      out.push(issue('streaming_terminal_disagrees', 'captureBoundary.streaming', 'completed observation requires an observed OpenAI SSE protocol terminal on a completed upstream response'));
    }
    return;
  }
  if (final.kind === 'cancelled') {
    const requestedBy = final.cancellation.requestedBy;
    if ((requestedBy !== 'client' && requestedBy !== 'ingress') || final.lifecycleTarget !== 'trace' || final.lifecycleEffect !== 'cancel' || streaming.upstream.outcome !== 'cancelled-by-ingress' || (requestedBy === 'client' && streaming.upstream.cause !== 'client-disconnect') || (requestedBy === 'ingress' && streaming.upstream.cause === 'client-disconnect')) out.push(issue('streaming_terminal_disagrees', 'captureBoundary.streaming.upstream', 'cancellation terminal disagrees with the authoritative transport facts'));
    return;
  }
  if (final.kind !== 'error') {
    out.push(issue('streaming_terminal_invalid', 'trace.events', 'streaming record does not end in a recognized terminal event'));
    return;
  }
  const code = final.error.type;
  const modelFailureShape = final.actor === 'model' && final.lifecycleTarget === 'trace' && final.lifecycleEffect === 'fail';
  const requestFailureShape = final.actor === 'capture' && final.lifecycleTarget === 'trace' && final.lifecycleEffect === 'fail';
  const observerFailureShape = final.actor === 'capture' && final.lifecycleTarget === 'none' && final.lifecycleEffect === 'none';
  const malformedOutcome = streaming.upstream.outcome === 'response-completed' || streaming.upstream.outcome === 'stream-ended-prematurely';
  const transportOutcome = streaming.upstream.outcome === 'connection-failed' || streaming.upstream.outcome === 'stream-ended-prematurely';
  const response = trace.events.find((event) => event.kind === 'model_response');
  const responseMeta = response?.responseEnvelope.responseMeta;
  const responseIs2xx = responseMeta !== undefined && responseMeta.statusCode >= 200 && responseMeta.statusCode <= 299;
  const responseIsEventStream = responseMeta?.contentType === 'text/event-stream';
  const responseCompleted = streaming.upstream.outcome === 'response-completed';
  const providerErrorBodyApplicable = streaming.losses.providerErrorBody !== 'not-applicable';
  if (MALFORMED_STREAM_CODES_SET.has(code)) {
    if (!modelFailureShape || !malformedOutcome) out.push(issue('streaming_terminal_disagrees', 'trace.events', 'malformed-stream terminal disagrees with the exact classification matrix'));
  } else if (code === 'http-error-status') {
    if (!modelFailureShape || !responseCompleted || responseMeta === undefined || responseIs2xx || streaming.decoderDisposition !== 'not-applicable' || !providerErrorBodyApplicable) out.push(issue('streaming_terminal_disagrees', 'trace.events', 'HTTP-error terminal requires a completed non-2xx response, no SSE decoder, and applicable provider-error-body retention'));
  } else if (code === 'non-sse-response') {
    if (!modelFailureShape || !responseCompleted || !responseIs2xx || responseIsEventStream || streaming.decoderDisposition !== 'not-applicable') out.push(issue('streaming_terminal_disagrees', 'trace.events', 'non-SSE terminal requires a completed successful response whose content type is not text/event-stream'));
  } else if (code === 'provider-error-frame') {
    if (!modelFailureShape || !responseCompleted || !responseIs2xx || !responseIsEventStream || streaming.decoderDisposition !== 'openai-sse' || !providerErrorBodyApplicable) out.push(issue('streaming_terminal_disagrees', 'trace.events', 'provider error frame requires a completed successful OpenAI SSE response and applicable provider-error-body retention'));
  } else if (UPSTREAM_FAILURE_CODES_SET.has(code)) {
    const outcomeMatches = TRANSPORT_FAILURE_CODES_SET.has(code) ? transportOutcome : streaming.upstream.outcome === 'response-completed';
    if (!modelFailureShape || !outcomeMatches) out.push(issue('streaming_terminal_disagrees', 'trace.events', 'upstream-failed terminal disagrees with the exact classification matrix'));
  } else if (CLIENT_REQUEST_FAILURE_CODES_SET.has(code)) {
    if (!requestFailureShape || streaming.upstream.outcome !== 'not-started') out.push(issue('streaming_terminal_disagrees', 'trace.events', 'request-failed terminal disagrees with the exact classification matrix'));
  } else if (OBSERVATION_FAILURE_CODES_SET.has(code)) {
    if (!observerFailureShape) out.push(issue('streaming_terminal_disagrees', 'trace.events', 'observation-detached terminal disagrees with the exact classification matrix'));
  } else out.push(issue('streaming_terminal_disagrees', 'trace.events', 'terminal code is outside the exact classification matrix'));
}

function collectLeafStatuses(messages: unknown): Array<'captured' | 'truncated' | 'redacted'> {
  if (!Array.isArray(messages)) return [];
  const statuses: Array<'captured' | 'truncated' | 'redacted'> = [];
  const add = (leaf: unknown): void => { if (isRecord(leaf) && (leaf['evidenceStatus'] === 'captured' || leaf['evidenceStatus'] === 'truncated' || leaf['evidenceStatus'] === 'redacted')) statuses.push(leaf['evidenceStatus']); };
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const content = message['content'];
    if (!Array.isArray(content)) { add(content); continue; }
    for (const part of content) if (isRecord(part)) {
      if (part['kind'] === 'text') add(part['text']);
      else if (part['kind'] === 'image_url') add(part['url']);
      else if (part['kind'] === 'tool_call') add(part['arguments']);
      else if (part['kind'] === 'tool_result') add(part['content']);
    }
  }
  return statuses;
}

function messageHasTruncation(message: unknown): boolean {
  if (!isRecord(message)) return false;
  const content = message['content'];
  if (!Array.isArray(content)) return isRecord(content) && content['truncation'] !== undefined;
  return content.some((part) => isRecord(part) && [part['text'], part['url'], part['arguments'], part['content']].some((leaf) => isRecord(leaf) && leaf['truncation'] !== undefined));
}

function aggregateRetention(statuses: readonly string[], hasTruncation: boolean): 'fully-retained' | 'partially-retained' {
  return statuses.includes('truncated') || hasTruncation ? 'partially-retained' : 'fully-retained';
}

function aggregateEventStatus(statuses: readonly string[]): 'captured' | 'truncated' | 'redacted' {
  if (statuses.includes('redacted')) return 'redacted';
  if (statuses.includes('truncated')) return 'truncated';
  return 'captured';
}

/** Validate the trace capture-profile reference. */
export function validateCaptureProfile(profile: unknown, path: string, out: ValidationIssue[]): void {
  if (!isRecord(profile)) {
    out.push(issue('capture_profile_missing', path, 'trace.captureProfile must be an object'));
    return;
  }
  const v = profile as Record<string, unknown>;
  closedObject(v, ['name', 'version'], path, out);
  if (typeof v['name'] !== 'string' || v['name'].length === 0) {
    out.push(issue('capture_profile_name_invalid', `${path}.name`, 'captureProfile.name must be a non-empty string'));
  }
  if (typeof v['version'] !== 'string' || v['version'].length === 0) {
    out.push(issue('capture_profile_version_invalid', `${path}.version`, 'captureProfile.version must be a non-empty string'));
  }
}
