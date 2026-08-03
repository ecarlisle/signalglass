/**
 * Public per-record validators (Spec 014 §5.2) — composable, non-throwing
 * boolean guards. The structured `parseEvidenceRecord` runs the same rules and
 * reports issues with stable codes; these guards expose single-value checks
 * for reuse.
 */
import type { EvidenceObservation } from './types-trace.js';
import type { SpanRecord } from './types-trace.js';
import type { EventRecord } from './types-event.js';
import type { ContextArtifact } from './types-artifact.js';
import type { RequestEnvelope, ResponseEnvelope } from './types-envelope.js';
import type { CaptureBoundary } from './types-record.js';
import {
  EVIDENCE_STATUSES,
  OBSERVATION_ROLES,
  EVENT_KINDS,
  SPAN_KINDS,
  ARTIFACT_KINDS,
} from './vocabulary.js';
import { isContentHash, isContentType, isSemanticVersion } from './internal/formats.js';
import { isRecord } from './internal/guards.js';
import { isTimestamp } from './internal/time.js';
import { isIdentifier, isSeq, isOptionalSpanId } from './internal/id.js';

export function isEvidenceStatus(value: unknown): boolean {
  return typeof value === 'string' && (EVIDENCE_STATUSES as readonly string[]).includes(value);
}

export function isObservationRole(value: unknown): boolean {
  return typeof value === 'string' && (OBSERVATION_ROLES as readonly string[]).includes(value);
}

export function isEventKind(value: unknown): boolean {
  return typeof value === 'string' && (EVENT_KINDS as readonly string[]).includes(value);
}

export function isSpanKind(value: unknown): boolean {
  return typeof value === 'string' && (SPAN_KINDS as readonly string[]).includes(value);
}

export function isArtifactKind(value: unknown): boolean {
  return typeof value === 'string' && (ARTIFACT_KINDS as readonly string[]).includes(value);
}

export { isContentHash, isContentType, isSemanticVersion };

/** A partial void guard over the artifact-level §6.1 matrix features. */
export function isContextArtifact(value: unknown): value is ContextArtifact {
  if (!isRecord(value)) return false;
  if (typeof value['artifactId'] !== 'string' || !isArtifactKind(value['kind'])) return false;
  if (!isEvidenceStatus(value['evidenceStatus'])) return false;
  return true;
}

export function isCaptureBoundary(value: unknown): value is CaptureBoundary {
  return isRecord(value) &&
    typeof value['captureSurface'] === 'string' &&
    typeof value['observationBoundary'] === 'string' &&
    Array.isArray(value['declaredEventKinds']) &&
    Array.isArray(value['declaredSurfaces']);
}

/** Minimal structural envelope checks (fidelity present and valid). */
function envelopeBase(value: unknown): value is RequestEnvelope | ResponseEnvelope {
  if (!isRecord(value)) return false;
  const fid = value['providerNativeFidelity'];
  return fid === 'structurally_faithful' || fid === 'byte_faithful';
}

export function isRequestEnvelope(value: unknown): value is RequestEnvelope {
  if (!envelopeBase(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v['model'] === 'string' && typeof v['provider'] === 'string';
}

export function isResponseEnvelope(value: unknown): value is ResponseEnvelope {
  return envelopeBase(value);
}

export function isEvidenceObservation(value: unknown): value is EvidenceObservation {
  if (!isRecord(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['observationId'] === 'string' &&
    typeof v['eventId'] === 'string' &&
    typeof v['traceId'] === 'string' &&
    isOptionalSpanId(v['spanId']) &&
    isSeq(v['seq']) &&
    isEventKind(v['kind']) &&
    isTimestamp(v['capturedAt']) &&
    isEvidenceStatus(v['evidenceStatus']) &&
    // Control events may omit observationRole (absent/undefined); payload-bearing
    // events carry null or a valid role. The parser accepts the same set.
    (v['observationRole'] == null || isObservationRole(v['observationRole'])) &&
    isTimestamp(v['rawCapturedAt'])
  );
}

export function isSpanRecord(value: unknown): value is SpanRecord {
  if (!isRecord(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['spanId'] === 'string' &&
    isSpanKind(v['kind']) &&
    typeof v['name'] === 'string' &&
    isOptionalSpanId(v['parentSpanId']) &&
    isSeq(v['startSeq']) &&
    isTimestamp(v['startedAt']) &&
    (typeof v['status'] === 'string' &&
      ['completed', 'failed', 'cancelled', 'unknown'].includes(v['status'] as string))
  );
}

export function isEventRecord(value: unknown): value is EventRecord {
  if (!isRecord(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['eventId'] === 'string' &&
    typeof v['traceId'] === 'string' &&
    isOptionalSpanId(v['spanId']) &&
    isSeq(v['seq']) &&
    isEventKind(v['kind']) &&
    isTimestamp(v['capturedAt']) &&
    isEvidenceStatus(v['evidenceStatus'])
  );
}

export function isIdentifierString(value: unknown): boolean {
  return isIdentifier(value);
}