/**
 * Canonical evidence storage (Spec 015).
 *
 * `EvidenceStorage` persists authoritative `EvidenceRecord` values in SQLite
 * beside the legacy `TraceStorage`. It implements append-only save/retrieve,
 * an authoritative identity, deterministic exact-text conflict detection, a
 * mandatory non-bypassable storage-safety gate, and a named/versioned
 * persistence-policy boundary.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  isCredentialLikeText,
} from '@signalglass/core';
import {
  type EvidenceRecord,
  type EvidenceObservation,
  type EventRecord,
  type EvidenceTrace,
  type SpanRecord,
  type EvidenceStructuralAnalysis,
  type TraceCompleteness,
  type CaptureBoundary,
  type Condition,
  type RequestEnvelope,
  type ResponseEnvelope,
  type UsageRecord,
  type UsageValue,
  type ToolCall,
  type ToolResult,
  type McpRequest,
  type McpResult,
  type RetrievalRequest,
  type RetrievalResult,
  type ContextProvider,
  type RetryRecord,
  type ErrorPayload,
  type ContextContribution,
  parseEvidenceRecord,
  serializeEvidenceRecord,
  checkEvidenceSchemaVersion,
  sha256Hex,
  utf8Encode,
  projectCanonicalEvent,
  EVIDENCE_STATUSES,
  CONTROL_EVENT_KINDS,
  EVENT_KINDS,
} from '@signalglass/evidence';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_FORMAT_VERSION = '1.0.0';
const EVIDENCE_STORAGE_META_KEY = 'evidence_storage_format_version';

const POLICY_NAME_MAX_LENGTH = 128;
const POLICY_VERSION_MAX_LENGTH = 64;
const LABEL_MAX_CODE_POINTS = 128;

const POLICY_NAME_REGEX = /^[a-z][a-z0-9._-]{0,127}$/;
const POLICY_VERSION_REGEX = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'proxy-authorization',
]);

const SENSITIVE_KEY_PATTERNS = [
  /secret/i,
  /password/i,
  /credential/i,
  /auth/i,
];

const STORAGE_SAFETY_CODES = ['S1', 'S2', 'S3', 'S5', 'S6'] as const;

const POLICY_REJECTION_CODES = [
  'rejected',
  'captured-content',
  'unknown-additive-field',
  'unbounded-label',
] as const;

const CORRUPT_CODES = [
  'json_parse_failed',
  'format_version_mismatch',
  'identity_mismatch',
  'policy_metadata_malformed',
  'stored_at_malformed',
  'digest_mismatch',
  'invalid_version_syntax',
  'schema_version_mismatch',
  'validation_failed',
  'trace_identity_mismatch',
] as const;

const REFERENCE_POLICY_NAME = 'signalglass.persistence.metadata-safe';
const REFERENCE_POLICY_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type StorageSafetyCode = (typeof STORAGE_SAFETY_CODES)[number];

export type PolicyRejectionCode = (typeof POLICY_REJECTION_CODES)[number];

export type PolicyFailureReason = 'exception' | 'malformed-decision';

export type CorruptCode = (typeof CORRUPT_CODES)[number];

export interface StorageManifest {
  /** Canonical-storage layout version. */
  storageFormatVersion: string;
  /** Record's evidenceSchemaVersion. */
  evidenceSchemaVersion: string;
  /** Persistence policy in effect at write time. */
  persistencePolicy: { name: string; version: string };
  /** ISO 8601 UTC storage timestamp. */
  storedAt: string;
  /** SHA-256 hex over the exact UTF-8 bytes of the stored serialized text. */
  storageDigest: string;
}

export interface StorageSafeIssue {
  /** Controlled issue code from the @signalglass/evidence vocabulary. */
  code: string;
  /** Normalized structural path or null when it would carry unsafe data. */
  path: string | null;
}

export type SaveOutcome =
  | { status: 'stored'; identity: string; digest: string; manifest: StorageManifest }
  | { status: 'already-present'; identity: string; digest: string }
  | {
      status: 'conflict';
      identity: string;
      existingDigest: string;
      suppliedDigest: string;
      storedAt: string;
    }
  | { status: 'invalid'; identity: string | null; issues: readonly StorageSafeIssue[] }
  | { status: 'unsupported-version'; version: string }
  | { status: 'safety-rejected'; reasons: readonly StorageSafetyCode[] }
  | {
      status: 'policy-rejected';
      policy: { name: string; version: string };
      code: PolicyRejectionCode;
    }
  | {
      status: 'policy-failed';
      policy: { name: string; version: string };
      reason: PolicyFailureReason;
    }
  | { status: 'clock-failed' };

export type EvidenceReadFailure =
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'corrupt'; code: CorruptCode }
  | { ok: false; reason: 'unsupported-version'; version: string };

export type EvidenceReadResult =
  | { ok: true; record: EvidenceRecord }
  | EvidenceReadFailure;

export type StoredEvidenceReadResult =
  | { ok: true; record: EvidenceRecord; manifest: StorageManifest }
  | EvidenceReadFailure;

/** Deeply readonly structural variant of EvidenceRecord. */
export type ReadonlyEvidenceRecord = {
  readonly [K in keyof EvidenceRecord]: DeepReadonly<EvidenceRecord[K]>;
};

type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export interface PersistencePolicy {
  name: string;
  version: string;
  decide(snapshot: ReadonlyEvidenceRecord): PersistencePolicyDecision;
}

export type PersistencePolicyDecision =
  | { accept: true }
  | { accept: false; code: PolicyRejectionCode };

export interface EvidenceStorageConfig {
  databasePath: string;
  persistencePolicy: PersistencePolicy;
  now?: () => string;
}

// ---------------------------------------------------------------------------
// Internal brand for the reference policy so plain-object spoofing fails.
// ---------------------------------------------------------------------------

const REFERENCE_POLICY_BRAND = Symbol('signalglass.referencePolicy');

interface ReferencePolicyInternal extends PersistencePolicy {
  [REFERENCE_POLICY_BRAND]: true;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class StorageFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageFormatError';
  }
}

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultNow(): string {
  return new Date().toISOString();
}

function isIso8601Utc(value: string): boolean {
  // Require the exact ISO 8601 UTC form produced by Date.toISOString().
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  const props = Object.getOwnPropertyNames(value);
  for (const key of props) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== null && typeof v === 'object') {
      deepFreeze(v);
    }
  }
  return Object.freeze(value);
}

function validatePolicyName(name: string): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new StorageConfigError('policy name must be a non-empty string');
  }
  if (name.length > POLICY_NAME_MAX_LENGTH) {
    throw new StorageConfigError('policy name exceeds 128 code points');
  }
  if (!POLICY_NAME_REGEX.test(name)) {
    throw new StorageConfigError('policy name violates the bounded grammar');
  }
  if (isCredentialLikeText(name)) {
    throw new StorageConfigError('policy name is credential-like');
  }
}

function validatePolicyVersion(version: string): void {
  if (typeof version !== 'string' || version.length === 0) {
    throw new StorageConfigError('policy version must be a non-empty string');
  }
  if (version.length > POLICY_VERSION_MAX_LENGTH) {
    throw new StorageConfigError('policy version exceeds 64 code points');
  }
  if (!POLICY_VERSION_REGEX.test(version)) {
    throw new StorageConfigError('policy version violates the bounded semantic-version grammar');
  }
}

function validatePolicyIdentity(policy: PersistencePolicy): void {
  if (!policy || typeof policy !== 'object') {
    throw new StorageConfigError('persistencePolicy is required');
  }
  if (typeof policy.name !== 'string' || typeof policy.version !== 'string') {
    throw new StorageConfigError('persistencePolicy must have name and version strings');
  }
  if (typeof policy.decide !== 'function') {
    throw new StorageConfigError('persistencePolicy must have a decide function');
  }
  validatePolicyName(policy.name);
  validatePolicyVersion(policy.version);
}

// fallow-ignore-next-line complexity
function validateStoredPolicyMetadata(name: string, version: string): CorruptCode | null {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > POLICY_NAME_MAX_LENGTH ||
    !POLICY_NAME_REGEX.test(name) ||
    isCredentialLikeText(name)
  ) {
    return 'policy_metadata_malformed';
  }
  if (
    typeof version !== 'string' ||
    version.length === 0 ||
    version.length > POLICY_VERSION_MAX_LENGTH ||
    !POLICY_VERSION_REGEX.test(version)
  ) {
    return 'policy_metadata_malformed';
  }
  return null;
}

function guardedGet<V, K extends keyof V>(obj: V, key: K): V[K] | { threw: unknown } {
  try {
    return obj[key];
  } catch (err) {
    return { threw: err } as unknown as V[K];
  }
}

// fallow-ignore-next-line complexity
function validatePolicyDecision(result: unknown): { valid: true; decision: PersistencePolicyDecision } | { valid: false } {
  // Plain-object requirement.
  if (!isPlainObject(result)) {
    return { valid: false };
  }

  // Guarded thenable check.
  const thenValue = guardedGet(result as Record<string, unknown>, 'then');
  if (
    typeof thenValue === 'object' &&
    thenValue !== null &&
    'threw' in (thenValue as object)
  ) {
    return { valid: false };
  }
  if (typeof thenValue === 'function') {
    return { valid: false };
  }

  // Guarded exact own-key enumeration.
  let ownKeys: (string | symbol)[];
  try {
    ownKeys = Reflect.ownKeys(result as object);
  } catch {
    return { valid: false };
  }
  if (ownKeys.some((k) => typeof k !== 'string')) {
    return { valid: false };
  }
  const stringKeys = ownKeys as string[];
  const sorted = [...stringKeys].sort();

  // Guarded descriptor inspection and value reads.
  const values: Record<string, unknown> = {};
  for (const key of stringKeys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(result as object, key);
    } catch {
      return { valid: false };
    }
    if (!descriptor) return { valid: false };
    if ('get' in descriptor || 'set' in descriptor) return { valid: false };
    if (!descriptor.enumerable) return { valid: false };
    try {
      values[key] = Reflect.get(result as object, key);
    } catch {
      return { valid: false };
    }
  }

  const accept = values['accept'];
  if (typeof accept !== 'boolean') {
    return { valid: false };
  }

  if (accept) {
    if (sorted.length !== 1 || sorted[0] !== 'accept') {
      return { valid: false };
    }
    return { valid: true, decision: { accept: true } };
  }

  if (sorted.length !== 2 || sorted[0] !== 'accept' || sorted[1] !== 'code') {
    return { valid: false };
  }
  const code = values['code'];
  if (typeof code !== 'string' || !POLICY_REJECTION_CODES.includes(code as PolicyRejectionCode)) {
    return { valid: false };
  }
  return { valid: true, decision: { accept: false, code: code as PolicyRejectionCode } };
}

function toStorageSafeIssues(
  issues: { code: string; path: string }[],
): StorageSafeIssue[] {
  return issues.map((i) => {
    const path = isSafePath(i.path) ? i.path : null;
    return { code: i.code, path };
  });
}

function isSafePath(path: string): boolean {
  // Only known field names and numeric indices; no caller-controlled identifiers or unknown keys.
  if (path === '$') return true;
  const segments = path.split('.');
  for (const segment of segments) {
    if (segment === '$') continue;
    if (/^\d+$/.test(segment)) continue;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(segment)) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Storage safety gate
// ---------------------------------------------------------------------------

interface SafetyPath {
  key: string;
  value: unknown;
}

function detectRetainedBytes(value: unknown): boolean {
  if (value instanceof Uint8Array) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((v) => detectRetainedBytes(v));
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      if (detectRetainedBytes(value[key])) return true;
    }
  }
  return false;
}

function isCredentialLikeString(value: unknown): value is string {
  return typeof value === 'string' && isCredentialLikeText(value);
}

function isSensitiveHeaderKey(key: string): boolean {
  return SENSITIVE_HEADERS.has(key.toLowerCase());
}

function isSensitiveKeyPattern(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower === 'storagekey' || lower === 'storage_key') return true;
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(key));
}

function classifyPath(key: string, value: unknown): StorageSafetyCode | null {
  if (isSensitiveHeaderKey(key)) return 'S2';
  if (isCredentialLikeString(value)) return 'S1';
  if (isSensitiveKeyPattern(key)) return 'S3';
  return null;
}

function walkForSafety(value: unknown, codes: Set<StorageSafetyCode>): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walkForSafety(item, codes);
    }
    return;
  }
  for (const key of Object.keys(value)) {
    const child = (value as Record<string, unknown>)[key];
    const code = classifyPath(key, child);
    if (code) codes.add(code);
    if (child !== null && typeof child === 'object') {
      walkForSafety(child, codes);
    }
  }
}

// fallow-ignore-next-line complexity
function detectFullRawCaptures(record: EvidenceRecord): void {
  const codes = new Set<StorageSafetyCode>(); // unused locally; we throw directly below
  for (const obs of record.rawObservations) {
    if (
      obs.evidenceStatus !== 'captured' ||
      !['model_request', 'model_response', 'model_response_chunk'].includes(obs.kind)
    ) {
      continue;
    }
    const payload = obs.payload;
    if (!isRecord(payload)) continue;
    const envelopeKey = obs.kind === 'model_request' ? 'requestEnvelope' : 'responseEnvelope';
    const envelope = payload[envelopeKey];
    if (!isRecord(envelope)) continue;
    const fidelity = envelope['providerNativeFidelity'];
    const providerNative = envelope['providerNative'];
    if (fidelity === 'byte_faithful' || providerNative !== undefined) {
      codes.add('S5');
    }
  }
  if (codes.size > 0) {
    throw new Error('S5 detected'); // internal signal; caught below
  }
}

function runSafetyGatePhaseB(record: EvidenceRecord): StorageSafetyCode[] {
  const codes = new Set<StorageSafetyCode>();
  walkForSafety(record as unknown as Record<string, unknown>, codes);
  try {
    detectFullRawCaptures(record);
  } catch {
    codes.add('S5');
  }
  const ordered: StorageSafetyCode[] = [];
  for (const c of STORAGE_SAFETY_CODES) {
    if (codes.has(c)) ordered.push(c);
  }
  return ordered;
}

function runSafetyGate(record: EvidenceRecord): StorageSafetyCode[] {
  // Phase A: short-circuit on retained bytes.
  if (detectRetainedBytes(record as unknown as Record<string, unknown>)) {
    return ['S6'];
  }
  // Phase B: structural/text scan.
  return runSafetyGatePhaseB(record);
}

// ---------------------------------------------------------------------------
// Reference policy: signalglass.persistence.metadata-safe (v1.0.0)
// ---------------------------------------------------------------------------

function isDeclaredContent(status: string): boolean {
  return status === 'redacted' || status === 'truncated';
}

function isControlEventKind(kind: string): boolean {
  return CONTROL_EVENT_KINDS.includes(kind as (typeof CONTROL_EVENT_KINDS)[number]);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null;
}

function countCodePoints(value: string): number {
  return Array.from(value).length;
}

function hasControlCharacters(value: string): boolean {
  // C0 and C1 control characters, plus DEL.
  return /[\x00-\x1f\x7f-\x9f]/.test(value);
}

function isValidLabel(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length === 0) return false;
  if (countCodePoints(value) > LABEL_MAX_CODE_POINTS) return false;
  if (hasControlCharacters(value)) return false;
  return true;
}

function isFiniteNonNegativeNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isClosedEvidenceStatus(value: unknown): boolean {
  return typeof value === 'string' && EVIDENCE_STATUSES.includes(value as (typeof EVIDENCE_STATUSES)[number]);
}

function isValidUsageValue(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const v = value['value'];
  if (v !== undefined && !isFiniteNonNegativeNumber(v)) return false;
  const status = value['evidenceStatus'];
  if (status !== undefined && !isClosedEvidenceStatus(status)) return false;
  // reason is free-text metadata (M4); no extra check.
  return true;
}

interface PolicyIssue {
  code: PolicyRejectionCode;
  path: string;
}

class PolicyClassifier {
  issues: PolicyIssue[] = [];

  reject(code: PolicyRejectionCode, path: string): void {
    this.issues.push({ code, path });
  }

  classify(record: EvidenceRecord): void {
    this.classifyTrace(record.trace, 'trace');
    this.classifyAnalysis(record.analysis, 'analysis');
    this.classifyCompleteness(record.completeness, 'completeness');
    this.classifyCaptureBoundary(record.captureBoundary, 'captureBoundary');
    for (let i = 0; i < record.rawObservations.length; i++) {
      this.classifyObservation(record.rawObservations[i], `rawObservations[${i}]`);
    }
    for (let i = 0; i < record.trace.events.length; i++) {
      this.classifyEvent(record.trace.events[i], `trace.events[${i}]`);
    }
    // Record-level unknown additive fields are preserved by the serializer and are safe here
    // because the safety gate already scanned them; they are classified as unknown below.
    this.checkUnknownFields(record as unknown as Record<string, unknown>, ['rawObservations', 'trace', 'analysis', 'completeness', 'evidenceSchemaVersion', 'captureBoundary'], '$', false);
  }

  private classifyTrace(trace: EvidenceTrace, path: string): void {
    this.requireId(trace.interactionId, `${path}.interactionId`);
    this.requireId(trace.traceId, `${path}.traceId`);
    this.requireMeta(trace.evidenceSchemaVersion, `${path}.evidenceSchemaVersion`);
    this.requireLabel(trace.captureProfile.name, `${path}.captureProfile.name`);
    this.requireMeta(trace.captureProfile.version, `${path}.captureProfile.version`);
    this.requireMeta(trace.captureSurface, `${path}.captureSurface`);
    this.requireMeta(trace.observationBoundary, `${path}.observationBoundary`);
    this.requireMeta(trace.startedAt, `${path}.startedAt`);
    this.requireMeta(trace.status, `${path}.status`);
    if (trace.finishedAt !== undefined) this.requireMeta(trace.finishedAt, `${path}.finishedAt`);
    if (trace.conditions !== undefined) {
      for (let i = 0; i < trace.conditions.length; i++) {
        this.classifyCondition(trace.conditions[i], `${path}.conditions[${i}]`);
      }
    }
    for (let i = 0; i < trace.spans.length; i++) {
      this.classifySpan(trace.spans[i], `${path}.spans[${i}]`);
    }
    this.checkUnknownFields(trace as unknown as Record<string, unknown>, [
      'interactionId', 'traceId', 'evidenceSchemaVersion', 'captureProfile', 'captureSurface',
      'observationBoundary', 'startedAt', 'status', 'finishedAt', 'conditions', 'spans', 'events',
    ], path, false);
  }

  private classifySpan(span: SpanRecord, path: string): void {
    this.requireId(span.spanId, `${path}.spanId`);
    this.requireMeta(span.kind, `${path}.kind`);
    this.requireLabel(span.name, `${path}.name`);
    this.requireIdOrNull(span.parentSpanId, `${path}.parentSpanId`);
    this.requireMeta(span.startSeq, `${path}.startSeq`);
    this.requireMeta(span.startedAt, `${path}.startedAt`);
    this.requireMeta(span.status, `${path}.status`);
    if (span.endSeq !== undefined) this.requireMeta(span.endSeq, `${path}.endSeq`);
    if (span.finishedAt !== undefined) this.requireMeta(span.finishedAt, `${path}.finishedAt`);
    if (span.durationMs !== undefined) this.requireMeta(span.durationMs, `${path}.durationMs`);
    if (span.participants !== undefined) {
      for (let i = 0; i < span.participants.length; i++) {
        this.requireLabel(span.participants[i], `${path}.participants[${i}]`);
      }
    }
    this.checkUnknownFields(span as unknown as Record<string, unknown>, [
      'spanId', 'kind', 'name', 'parentSpanId', 'startSeq', 'startedAt', 'status',
      'endSeq', 'finishedAt', 'durationMs', 'participants',
    ], path, false);
  }

  private classifyCondition(condition: Condition, path: string): void {
    this.requireLabel(condition.label, `${path}.label`);
    this.requireMeta(condition.version, `${path}.version`);
    if (condition.value !== null) {
      this.reject('captured-content', `${path}.value`);
    }
    this.checkUnknownFields(condition as unknown as Record<string, unknown>, ['label', 'value', 'version'], path, false);
  }

  private classifyAnalysis(analysis: EvidenceStructuralAnalysis, path: string): void {
    this.requireMeta(analysis.completenessDerivationAlgorithmVersion, `${path}.completenessDerivationAlgorithmVersion`);
    for (let i = 0; i < analysis.validationIssues.length; i++) {
      const issue = analysis.validationIssues[i];
      this.requireMeta(issue.code, `${path}.validationIssues[${i}].code`);
      // path may be unsafe; do not surface it. message is M4.
      this.checkUnknownFields(issue as unknown as Record<string, unknown>, ['code', 'path', 'message'], `${path}.validationIssues[${i}]`, false);
    }
    this.checkUnknownFields(analysis as unknown as Record<string, unknown>, [
      'duplicateObservations', 'sequenceGaps', 'validationIssues', 'completenessDerivationAlgorithmVersion',
    ], path, false);
  }

  private classifyCompleteness(completeness: TraceCompleteness, path: string): void {
    this.requireMeta(completeness.eventsByStatus, `${path}.eventsByStatus`);
    this.requireMeta(completeness.seqGaps, `${path}.seqGaps`);
    this.requireMeta(completeness.duplicatesDetected, `${path}.duplicatesDetected`);
    // boundaryStatement is M4 free-text metadata.
    this.checkUnknownFields(completeness as unknown as Record<string, unknown>, [
      'eventsByStatus', 'seqGaps', 'duplicatesDetected', 'boundaryStatement',
    ], path, false);
  }

  private classifyCaptureBoundary(boundary: CaptureBoundary, path: string): void {
    this.requireMeta(boundary.captureSurface, `${path}.captureSurface`);
    this.requireMeta(boundary.observationBoundary, `${path}.observationBoundary`);
    this.requireMeta(boundary.declaredEventKinds, `${path}.declaredEventKinds`);
    this.requireMeta(boundary.declaredSurfaces, `${path}.declaredSurfaces`);
    if (boundary.missingRecord) {
      this.requireMeta(boundary.missingRecord.reason, `${path}.missingRecord.reason`);
      if (boundary.missingRecord.note !== undefined) {
        // note is M4 free-text metadata.
      }
      this.checkUnknownFields(boundary.missingRecord as unknown as Record<string, unknown>, ['reason', 'note', 'reportedBy'], `${path}.missingRecord`, false);
    }
    this.checkUnknownFields(boundary as unknown as Record<string, unknown>, [
      'captureSurface', 'observationBoundary', 'declaredEventKinds', 'declaredSurfaces', 'missingRecord',
    ], path, false);
  }

  // fallow-ignore-next-line complexity
  private classifyObservation(obs: EvidenceObservation, path: string): void {
    this.requireId(obs.observationId, `${path}.observationId`);
    this.requireId(obs.eventId, `${path}.eventId`);
    this.requireId(obs.traceId, `${path}.traceId`);
    this.requireIdOrNull(obs.spanId, `${path}.spanId`);
    this.requireMeta(obs.seq, `${path}.seq`);
    this.requireMeta(obs.kind, `${path}.kind`);
    this.requireMeta(obs.capturedAt, `${path}.capturedAt`);
    this.requireMeta(obs.evidenceStatus, `${path}.evidenceStatus`);
    if (obs.observationRole !== null && obs.observationRole !== undefined) {
      this.requireMeta(obs.observationRole, `${path}.observationRole`);
    }
    this.requireMeta(obs.rawCapturedAt, `${path}.rawCapturedAt`);

    if (isControlEventKind(obs.kind)) {
      if (obs.observationRole !== undefined && obs.observationRole !== null) {
        this.reject('unknown-additive-field', `${path}.observationRole`);
      }
      if (obs.kind === 'interaction_start' || obs.kind === 'interaction_end') {
        if (obs.payload !== null && obs.payload !== undefined) {
          this.reject('unknown-additive-field', `${path}.payload`);
        }
      }
      // span_start / span_end payloads are structural metadata and classified below.
      if (obs.kind === 'span_start' || obs.kind === 'span_end') {
        this.classifyPayload(obs.kind, obs.payload, `${path}.payload`, obs.evidenceStatus, false);
      }
      this.checkUnknownFields(obs as unknown as Record<string, unknown>, [
        'observationId', 'eventId', 'traceId', 'spanId', 'seq', 'kind', 'capturedAt',
        'evidenceStatus', 'observationRole', 'payload', 'rawCapturedAt',
      ], path, false);
      return;
    }

    if (obs.observationRole === undefined || obs.observationRole === null) {
      this.reject('unknown-additive-field', `${path}.observationRole`);
    }

    this.classifyPayload(obs.kind, obs.payload, `${path}.payload`, obs.evidenceStatus, false);

    this.checkUnknownFields(obs as unknown as Record<string, unknown>, [
      'observationId', 'eventId', 'traceId', 'spanId', 'seq', 'kind', 'capturedAt',
      'evidenceStatus', 'observationRole', 'payload', 'rawCapturedAt',
    ], path, false);
  }

  private classifyEvent(event: EventRecord, path: string): void {
    this.requireId(event.eventId, `${path}.eventId`);
    this.requireId(event.traceId, `${path}.traceId`);
    this.requireIdOrNull(event.spanId, `${path}.spanId`);
    this.requireMeta(event.seq, `${path}.seq`);
    this.requireMeta(event.kind, `${path}.kind`);
    this.requireMeta(event.capturedAt, `${path}.capturedAt`);
    this.requireMeta(event.evidenceStatus, `${path}.evidenceStatus`);

    if (isControlEventKind(event.kind)) {
      if ('observationRole' in event) {
        this.reject('unknown-additive-field', `${path}.observationRole`);
      }
      // Projected control events have no payload; container fields are checked below.
      this.checkUnknownFields(event as unknown as Record<string, unknown>, [
        'eventId', 'traceId', 'spanId', 'seq', 'kind', 'capturedAt', 'evidenceStatus',
      ], path, false);
      return;
    }

    if (!('observationRole' in event) || event.observationRole === undefined) {
      this.reject('unknown-additive-field', `${path}.observationRole`);
      return;
    }
    this.requireMeta(event.observationRole, `${path}.observationRole`);

    const payload = this.extractProjectedPayload(event);
    if (payload !== null) {
      this.classifyPayload(event.kind, payload, path, event.evidenceStatus, true);
    }

    const containerFields = [
      'eventId', 'traceId', 'spanId', 'seq', 'kind', 'capturedAt', 'evidenceStatus', 'observationRole',
    ];
    // For projected payload-bearing events, unknown additive payload fields appear at the top level
    // alongside container fields. They are admitted only when the event is declared retained content.
    this.checkUnknownFields(
      event as unknown as Record<string, unknown>,
      containerFields,
      path,
      isDeclaredContent(event.evidenceStatus),
    );
  }

  // fallow-ignore-next-line complexity
  private extractProjectedPayload(event: EventRecord): Record<string, unknown> | null {
    switch (event.kind) {
      case 'model_request':
        return {
          requestEnvelope: (event as Record<string, unknown>)['requestEnvelope'],
          contextContributions: (event as Record<string, unknown>)['contextContributions'],
        };
      case 'model_response':
      case 'model_response_chunk':
        return { responseEnvelope: (event as Record<string, unknown>)['responseEnvelope'] };
      case 'model_usage':
        return { usage: (event as Record<string, unknown>)['usage'] };
      case 'tool_call':
        return { tool: (event as Record<string, unknown>)['tool'] };
      case 'tool_result':
        return { toolResult: (event as Record<string, unknown>)['toolResult'] };
      case 'mcp_request':
        return { mcp: (event as Record<string, unknown>)['mcp'] };
      case 'mcp_result':
        return { mcpResult: (event as Record<string, unknown>)['mcpResult'] };
      case 'retrieval_request':
        return { retrieval: (event as Record<string, unknown>)['retrieval'] };
      case 'retrieval_result':
        return { retrievalResult: (event as Record<string, unknown>)['retrievalResult'] };
      case 'context_provider_request':
      case 'context_provider_result':
        return { contextProvider: (event as Record<string, unknown>)['contextProvider'] };
      case 'context_assembled':
        return { contextContributions: (event as Record<string, unknown>)['contextContributions'] };
      case 'error':
        return {
          actor: (event as Record<string, unknown>)['actor'],
          lifecycleTarget: (event as Record<string, unknown>)['lifecycleTarget'],
          lifecycleEffect: (event as Record<string, unknown>)['lifecycleEffect'],
          error: (event as Record<string, unknown>)['error'],
        };
      case 'cancelled':
        return {
          lifecycleTarget: (event as Record<string, unknown>)['lifecycleTarget'],
          lifecycleEffect: (event as Record<string, unknown>)['lifecycleEffect'],
          cancellation: (event as Record<string, unknown>)['cancellation'],
        };
      case 'retry':
        return { retry: (event as Record<string, unknown>)['retry'] };
      default:
        return null;
    }
  }

  // fallow-ignore-next-line complexity
  private classifyPayload(
    kind: string,
    payload: unknown,
    path: string,
    status: string,
    projected: boolean,
  ): void {
    if (!isRecord(payload)) {
      this.reject('unknown-additive-field', path);
      return;
    }
    const declared = isDeclaredContent(status);
    const basePath = projected ? path : `${path}`;

    switch (kind) {
      case 'span_start': {
        const spanPayload = payload['span'];
        if (isRecord(spanPayload)) {
          this.requireMeta(spanPayload['kind'], `${basePath}.span.kind`);
          this.requireLabel(spanPayload['name'], `${basePath}.span.name`);
          this.requireIdOrNull(spanPayload['parentSpanId'], `${basePath}.span.parentSpanId`);
          this.checkUnknownFields(spanPayload, ['kind', 'name', 'parentSpanId'], `${basePath}.span`, false);
        } else if (payload !== null && payload !== undefined) {
          this.reject('unknown-additive-field', basePath);
        }
        this.checkUnknownFields(payload, ['span'], basePath, false);
        break;
      }
      case 'span_end': {
        if (!declared && payload['durationMs'] !== undefined) {
          this.requireMeta(payload['durationMs'], `${basePath}.durationMs`);
        }
        this.checkUnknownFields(payload, ['durationMs'], basePath, false);
        break;
      }
      case 'model_request': {
        const envelope = payload['requestEnvelope'];
        if (isRecord(envelope)) {
          this.classifyRequestEnvelope(envelope, `${basePath}.requestEnvelope`, declared);
        }
        if (payload['contextContributions'] !== undefined) {
          this.classifyContextContributions(payload['contextContributions'], `${basePath}.contextContributions`);
        }
        this.checkUnknownFields(payload, ['requestEnvelope', 'contextContributions'], basePath, false);
        break;
      }
      case 'model_response':
      case 'model_response_chunk': {
        const envelope = payload['responseEnvelope'];
        if (isRecord(envelope)) {
          this.classifyResponseEnvelope(envelope, `${basePath}.responseEnvelope`, declared);
        }
        this.checkUnknownFields(payload, ['responseEnvelope'], basePath, false);
        break;
      }
      case 'model_usage': {
        const usage = payload['usage'];
        if (isRecord(usage)) {
          this.classifyUsageRecord(usage, `${basePath}.usage`);
        }
        this.checkUnknownFields(payload, ['usage'], basePath, false);
        break;
      }
      case 'tool_call': {
        const tool = payload['tool'];
        if (isRecord(tool)) {
          this.requireLabel(tool['name'], `${basePath}.tool.name`);
          this.requireContent(tool['arguments'], `${basePath}.tool.arguments`, declared);
          this.checkUnknownFields(tool, ['name', 'arguments'], `${basePath}.tool`, declared);
        }
        this.checkUnknownFields(payload, ['tool'], basePath, false);
        break;
      }
      case 'tool_result': {
        const toolResult = payload['toolResult'];
        if (isRecord(toolResult)) {
          this.requireMeta(toolResult['exitCode'], `${basePath}.toolResult.exitCode`);
          this.requireContent(toolResult['stdout'], `${basePath}.toolResult.stdout`, declared);
          this.requireContent(toolResult['stderr'], `${basePath}.toolResult.stderr`, declared);
          this.checkUnknownFields(toolResult, ['exitCode', 'stdout', 'stderr'], `${basePath}.toolResult`, declared);
        }
        this.checkUnknownFields(payload, ['toolResult'], basePath, false);
        break;
      }
      case 'mcp_request': {
        const mcp = payload['mcp'];
        if (isRecord(mcp)) {
          this.requireLabel(mcp['server'], `${basePath}.mcp.server`);
          this.requireLabel(mcp['tool'], `${basePath}.mcp.tool`);
          this.requireContent(mcp['arguments'], `${basePath}.mcp.arguments`, declared);
          this.checkUnknownFields(mcp, ['server', 'tool', 'arguments'], `${basePath}.mcp`, declared);
        }
        this.checkUnknownFields(payload, ['mcp'], basePath, false);
        break;
      }
      case 'mcp_result': {
        const mcpResult = payload['mcpResult'];
        if (isRecord(mcpResult)) {
          this.requireContent(mcpResult['content'], `${basePath}.mcpResult.content`, declared);
          this.checkUnknownFields(mcpResult, ['content'], `${basePath}.mcpResult`, declared);
        }
        this.checkUnknownFields(payload, ['mcpResult'], basePath, false);
        break;
      }
      case 'retrieval_request': {
        const retrieval = payload['retrieval'];
        if (isRecord(retrieval)) {
          this.requireContent(retrieval['query'], `${basePath}.retrieval.query`, declared);
          this.requireMeta(retrieval['topK'], `${basePath}.retrieval.topK`);
          this.checkUnknownFields(retrieval, ['query', 'topK'], `${basePath}.retrieval`, declared);
        }
        this.checkUnknownFields(payload, ['retrieval'], basePath, false);
        break;
      }
      case 'retrieval_result': {
        const retrievalResult = payload['retrievalResult'];
        if (isRecord(retrievalResult)) {
          this.requireContent(retrievalResult['query'], `${basePath}.retrievalResult.query`, declared);
          this.requireMeta(retrievalResult['resultCount'], `${basePath}.retrievalResult.resultCount`);
          this.checkUnknownFields(retrievalResult, ['query', 'resultCount'], `${basePath}.retrievalResult`, declared);
        }
        this.checkUnknownFields(payload, ['retrievalResult'], basePath, false);
        break;
      }
      case 'context_provider_request':
      case 'context_provider_result': {
        const provider = payload['contextProvider'];
        if (isRecord(provider)) {
          this.requireLabel(provider['name'], `${basePath}.contextProvider.name`);
          this.requireLabel(provider['kind'], `${basePath}.contextProvider.kind`);
          this.checkUnknownFields(provider, ['name', 'kind'], `${basePath}.contextProvider`, false);
        }
        this.checkUnknownFields(payload, ['contextProvider'], basePath, false);
        break;
      }
      case 'context_assembled': {
        const contributions = payload['contextContributions'];
        if (contributions !== undefined) {
          this.classifyContextContributions(contributions, `${basePath}.contextContributions`);
        }
        this.checkUnknownFields(payload, ['contextContributions'], basePath, false);
        break;
      }
      case 'error': {
        this.requireMeta(payload['actor'], `${basePath}.actor`);
        this.requireMeta(payload['lifecycleTarget'], `${basePath}.lifecycleTarget`);
        this.requireMeta(payload['lifecycleEffect'], `${basePath}.lifecycleEffect`);
        const error = payload['error'];
        if (isRecord(error)) {
          this.requireLabel(error['type'], `${basePath}.error.type`);
          this.requireContent(error['message'], `${basePath}.error.message`, declared);
          this.checkUnknownFields(error, ['type', 'message'], `${basePath}.error`, declared);
        }
        this.checkUnknownFields(payload, ['actor', 'lifecycleTarget', 'lifecycleEffect', 'error'], basePath, false);
        break;
      }
      case 'cancelled': {
        this.requireMeta(payload['lifecycleTarget'], `${basePath}.lifecycleTarget`);
        this.requireMeta(payload['lifecycleEffect'], `${basePath}.lifecycleEffect`);
        const cancellation = payload['cancellation'];
        if (isRecord(cancellation)) {
          this.requireLabel(cancellation['requestedBy'], `${basePath}.cancellation.requestedBy`);
          this.checkUnknownFields(cancellation, ['requestedBy'], `${basePath}.cancellation`, false);
        }
        this.checkUnknownFields(payload, ['lifecycleTarget', 'lifecycleEffect', 'cancellation'], basePath, false);
        break;
      }
      case 'retry': {
        const retry = payload['retry'];
        if (isRecord(retry)) {
          this.requireId(retry['originalRequestEventId'], `${basePath}.retry.originalRequestEventId`);
          if (retry['errorEventId'] !== undefined) {
            this.requireId(retry['errorEventId'], `${basePath}.retry.errorEventId`);
          }
          this.requireMeta(retry['attempt'], `${basePath}.retry.attempt`);
          if (retry['observedDelayMs'] !== undefined) {
            this.requireMeta(retry['observedDelayMs'], `${basePath}.retry.observedDelayMs`);
          }
          this.checkUnknownFields(retry, ['originalRequestEventId', 'errorEventId', 'attempt', 'observedDelayMs'], `${basePath}.retry`, false);
        }
        this.checkUnknownFields(payload, ['retry'], basePath, false);
        break;
      }
      default: {
        // Unknown kind: every payload field is unknown additive. The evidence validator already
        // rejects unknown kinds, so this path is defensive.
        this.reject('unknown-additive-field', basePath);
      }
    }
  }

  private classifyRequestEnvelope(envelope: Record<string, unknown>, path: string, declared: boolean): void {
    this.requireLabel(envelope['model'], `${path}.model`);
    this.requireLabel(envelope['provider'], `${path}.provider`);
    this.requireMeta(envelope['providerNativeFidelity'], `${path}.providerNativeFidelity`);
    this.requireContent(envelope['messages'], `${path}.messages`, declared);
    this.requireContent(envelope['providerNative'], `${path}.providerNative`, declared);
    this.requireNativeByteFields(envelope, path);
    this.checkUnknownFields(envelope, [
      'model', 'provider', 'providerNativeFidelity', 'messages', 'providerNative',
      'nativeEncoding', 'nativeContentType', 'nativeContentHash',
    ], path, false);
  }

  private classifyResponseEnvelope(envelope: Record<string, unknown>, path: string, declared: boolean): void {
    this.requireMeta(envelope['providerNativeFidelity'], `${path}.providerNativeFidelity`);
    if (envelope['finishReason'] !== undefined) {
      this.requireLabel(envelope['finishReason'], `${path}.finishReason`);
    }
    if (envelope['usage'] !== undefined) {
      this.requireResponseUsage(envelope['usage'], `${path}.usage`);
    }
    if (envelope['chunkIndex'] !== undefined) {
      this.requireMeta(envelope['chunkIndex'], `${path}.chunkIndex`);
    }
    this.requireContent(envelope['providerNative'], `${path}.providerNative`, declared);
    this.requireNativeByteFields(envelope, path);
    this.checkUnknownFields(envelope, [
      'providerNativeFidelity', 'finishReason', 'usage', 'chunkIndex', 'providerNative',
      'nativeEncoding', 'nativeContentType', 'nativeContentHash',
    ], path, false);
  }

  private requireResponseUsage(value: unknown, path: string): void {
    if (!isRecord(value)) {
      this.reject('captured-content', path);
      return;
    }
    const keys = Object.keys(value);
    for (const key of keys) {
      if (!['inputTokens', 'outputTokens', 'totalTokens'].includes(key)) {
        this.reject('captured-content', `${path}.${key}`);
        return;
      }
    }
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) {
      const v = value[key];
      if (v !== undefined && !isFiniteNonNegativeNumber(v)) {
        this.reject('captured-content', `${path}.${key}`);
        return;
      }
    }
  }

  private classifyUsageRecord(usage: Record<string, unknown>, path: string): void {
    this.requireClosedEvidenceStatus(usage['evidenceStatus'], `${path}.evidenceStatus`);
    this.requireUsageValueOrAbsent(usage['inputTokens'], `${path}.inputTokens`);
    this.requireUsageValueOrAbsent(usage['outputTokens'], `${path}.outputTokens`);
    this.requireUsageValueOrAbsent(usage['totalTokens'], `${path}.totalTokens`);
    // reason is M4.
    this.checkUnknownFields(usage, ['evidenceStatus', 'inputTokens', 'outputTokens', 'totalTokens', 'reason'], path, false);
  }

  private classifyContextContributions(value: unknown, path: string): void {
    if (!Array.isArray(value)) {
      this.reject('unknown-additive-field', path);
      return;
    }
    for (let i = 0; i < value.length; i++) {
      const contribution = value[i];
      if (!isRecord(contribution)) {
        this.reject('unknown-additive-field', `${path}[${i}]`);
        continue;
      }
      this.requireId(contribution['artifactId'], `${path}[${i}].artifactId`);
      const locator = contribution['locator'];
      if (isRecord(locator)) {
        this.requireMeta(locator['type'], `${path}[${i}].locator.type`);
        this.checkUnknownFields(locator, ['type'], `${path}[${i}].locator`, false);
      }
      this.requireMeta(contribution['position'], `${path}[${i}].position`);
      this.requireMeta(contribution['provenanceState'], `${path}[${i}].provenanceState`);
      this.checkUnknownFields(contribution, ['artifactId', 'locator', 'position', 'provenanceState'], `${path}[${i}]`, false);
    }
  }

  private requireNativeByteFields(envelope: Record<string, unknown>, path: string): void {
    if (envelope['nativeEncoding'] !== undefined) this.requireMeta(envelope['nativeEncoding'], `${path}.nativeEncoding`);
    if (envelope['nativeContentType'] !== undefined) this.requireMeta(envelope['nativeContentType'], `${path}.nativeContentType`);
    if (envelope['nativeContentHash'] !== undefined) this.requireMeta(envelope['nativeContentHash'], `${path}.nativeContentHash`);
  }

  private requireContent(value: unknown, path: string, declared: boolean): void {
    if (value === undefined || value === null) return;
    if (!declared) {
      this.reject('captured-content', path);
    }
  }

  private requireMeta(value: unknown, path: string): void {
    if (value === undefined) {
      // Missing required metadata is a validation issue that should have been caught by the
      // evidence validator; treat as unknown-additive-field for policy purposes.
      this.reject('unknown-additive-field', path);
    }
  }

  private requireId(value: unknown, path: string): void {
    if (typeof value !== 'string' || value.length === 0) {
      this.reject('unknown-additive-field', path);
    }
  }

  private requireIdOrNull(value: unknown, path: string): void {
    if (value !== null && (typeof value !== 'string' || value.length === 0)) {
      this.reject('unknown-additive-field', path);
    }
  }

  private requireLabel(value: unknown, path: string): void {
    if (!isValidLabel(value)) {
      this.reject('unbounded-label', path);
    }
  }

  private requireClosedEvidenceStatus(value: unknown, path: string): void {
    if (!isClosedEvidenceStatus(value)) {
      this.reject('unknown-additive-field', path);
    }
  }

  private requireUsageValueOrAbsent(value: unknown, path: string): void {
    if (value === undefined) return;
    if (!isValidUsageValue(value)) {
      this.reject('captured-content', path);
    }
  }

  private checkUnknownFields(
    obj: Record<string, unknown>,
    allowed: string[],
    path: string,
    underDeclaredContent: boolean,
  ): void {
    const allowedSet = new Set(allowed);
    for (const key of Object.keys(obj)) {
      if (allowedSet.has(key)) continue;
      const fieldPath = path === '$' ? key : `${path}.${key}`;
      const value = obj[key];
      if (underDeclaredContent) {
        // Unknown fields under a declared content-bearing path are admitted as declared content.
        continue;
      }
      if (value === null) continue;
      this.reject('unknown-additive-field', fieldPath);
    }
  }
}

function metadataSafeDecide(record: EvidenceRecord): PersistencePolicyDecision {
  // The safety gate has already run; M0 is satisfied by contract.
  const classifier = new PolicyClassifier();
  classifier.classify(record);
  if (classifier.issues.length === 0) {
    return { accept: true };
  }
  // Return the first issue's code. All codes are closed storage-owned policy codes.
  return { accept: false, code: classifier.issues[0].code };
}

export function createMetadataSafePolicy(): PersistencePolicy {
  const policy: ReferencePolicyInternal = {
    name: REFERENCE_POLICY_NAME,
    version: REFERENCE_POLICY_VERSION,
    decide: metadataSafeDecide,
    [REFERENCE_POLICY_BRAND]: true,
  };
  return policy;
}

export function isMetadataSafePolicy(policy: PersistencePolicy): boolean {
  return (
    policy === createMetadataSafePolicy() ||
    (isRecord(policy) && (policy as Record<string | symbol, unknown>)[REFERENCE_POLICY_BRAND] === true)
  );
}

// ---------------------------------------------------------------------------
// EvidenceStorage
// ---------------------------------------------------------------------------

export class EvidenceStorage {
  private db: Database.Database;
  private policy: PersistencePolicy;
  private now: () => string;

  constructor(config: EvidenceStorageConfig) {
    if (!config || typeof config !== 'object') {
      throw new StorageConfigError('EvidenceStorage config is required');
    }
    validatePolicyIdentity(config.persistencePolicy);
    this.policy = config.persistencePolicy;
    this.now = config.now ?? defaultNow;

    this.ensureDirectoryExists(config.databasePath);
    this.db = new Database(config.databasePath);
    this.db.pragma('journal_mode = WAL');
    const journalMode = this.db.pragma('journal_mode', { simple: true });
    if (journalMode !== 'wal') {
      this.db.close();
      throw new StorageConfigError(`Failed to enable WAL journaling mode (got ${String(journalMode)})`);
    }

    this.verifyOrInitializeSchema();
  }

  close(): void {
    this.db.close();
  }

  private ensureDirectoryExists(databasePath: string): void {
    const dir = dirname(databasePath);
    if (dir) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // fallow-ignore-next-line complexity
  private verifyOrInitializeSchema(): void {
    const existing = this.listCanonicalObjects();
    const hasLedger = existing.has('evidence_storage_meta');
    const hasTable = existing.has('evidence_records');
    const hasSchemaIndex = existing.has('idx_evidence_records_schema_version');
    const hasStoredAtIndex = existing.has('idx_evidence_records_stored_at');

    if (!hasLedger && !hasTable && !hasSchemaIndex && !hasStoredAtIndex) {
      this.initializeSchema();
      return;
    }

    if (!hasLedger) {
      throw new StorageFormatError('Canonical tables exist without a valid storage ledger');
    }

    const ledgerValue = this.readLedgerValue();
    if (ledgerValue === null) {
      throw new StorageFormatError('Storage ledger key missing');
    }
    if (!POLICY_VERSION_REGEX.test(ledgerValue)) {
      throw new StorageFormatError('Storage ledger value is not a semantic version');
    }
    if (ledgerValue !== STORAGE_FORMAT_VERSION) {
      const cmp = compareSemanticVersion(ledgerValue, STORAGE_FORMAT_VERSION);
      if (cmp > 0) {
        throw new StorageFormatError(`Unsupported higher storage format version: ${ledgerValue}`);
      }
      throw new StorageFormatError(`Unsupported lower storage format version: ${ledgerValue}; no migration path registered`);
    }

    if (!hasTable || !hasSchemaIndex || !hasStoredAtIndex) {
      throw new StorageFormatError('Canonical storage objects are incomplete');
    }

    this.verifyTableContract();
  }

  private listCanonicalObjects(): Set<string> {
    const rows = this.db.prepare(
      `SELECT name, type FROM sqlite_master
       WHERE (type = 'table' AND name LIKE 'evidence_%')
          OR (type = 'index' AND (name LIKE 'idx_evidence_%' OR tbl_name LIKE 'evidence_%'))`
    ).all() as { name: string; type: string }[];
    return new Set(rows.map((r) => r.name));
  }

  private readLedgerValue(): string | null {
    try {
      const row = this.db.prepare(
        `SELECT value FROM evidence_storage_meta WHERE key = ?`
      ).get(EVIDENCE_STORAGE_META_KEY) as { value: string } | undefined;
      return row?.value ?? null;
    } catch {
      return null;
    }
  }

  private initializeSchema(): void {
    const createLedger = `
      CREATE TABLE IF NOT EXISTS evidence_storage_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `;
    const createRecords = `
      CREATE TABLE IF NOT EXISTS evidence_records (
        evidence_identity          TEXT NOT NULL PRIMARY KEY,
        evidence_schema_version    TEXT NOT NULL,
        storage_format_version     TEXT NOT NULL,
        persistence_policy_name    TEXT NOT NULL,
        persistence_policy_version TEXT NOT NULL,
        stored_at                  TEXT NOT NULL,
        storage_digest             TEXT NOT NULL,
        serialized_record          TEXT NOT NULL
      );
    `;
    const createIndices = `
      CREATE INDEX IF NOT EXISTS idx_evidence_records_schema_version
        ON evidence_records (evidence_schema_version);
      CREATE INDEX IF NOT EXISTS idx_evidence_records_stored_at
        ON evidence_records (stored_at);
    `;

    const init = this.db.transaction(() => {
      this.db.exec(createLedger);
      this.db.exec(createRecords);
      this.db.exec(createIndices);
      this.db.prepare(
        `INSERT INTO evidence_storage_meta (key, value) VALUES (?, ?)`
      ).run(EVIDENCE_STORAGE_META_KEY, STORAGE_FORMAT_VERSION);
      this.verifyTableContract();
    });

    try {
      init();
    } catch (err) {
      // Rollback happens automatically on throw inside a transaction; close to be safe.
      this.db.close();
      throw err;
    }
  }

  private verifyTableContract(): void {
    const columns = this.db.pragma(`table_info(evidence_records)`) as {
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }[];
    const requiredColumns = new Map<string, { type: string; notnull: boolean; pk: boolean }>([
      ['evidence_identity', { type: 'TEXT', notnull: true, pk: true }],
      ['evidence_schema_version', { type: 'TEXT', notnull: true, pk: false }],
      ['storage_format_version', { type: 'TEXT', notnull: true, pk: false }],
      ['persistence_policy_name', { type: 'TEXT', notnull: true, pk: false }],
      ['persistence_policy_version', { type: 'TEXT', notnull: true, pk: false }],
      ['stored_at', { type: 'TEXT', notnull: true, pk: false }],
      ['storage_digest', { type: 'TEXT', notnull: true, pk: false }],
      ['serialized_record', { type: 'TEXT', notnull: true, pk: false }],
    ]);

    if (columns.length !== requiredColumns.size) {
      throw new StorageFormatError('evidence_records column count mismatch');
    }

    for (const col of columns) {
      const req = requiredColumns.get(col.name);
      if (!req) {
        throw new StorageFormatError(`Unexpected column in evidence_records: ${col.name}`);
      }
      if (col.type !== req.type || !!col.notnull !== req.notnull || !!col.pk !== req.pk) {
        throw new StorageFormatError(`Column contract mismatch for ${col.name}`);
      }
    }
  }

  // fallow-ignore-next-line complexity
  saveEvidenceRecord(input: unknown): SaveOutcome {
    // Step 1: shape guard.
    if (!isRecord(input)) {
      return {
        status: 'invalid',
        identity: null,
        issues: [{ code: 'record_not_object', path: '$' }],
      };
    }

    // Step 2: version triage.
    const versionCheck = checkEvidenceSchemaVersion((input as Record<string, unknown>)['evidenceSchemaVersion']);
    if (!versionCheck.ok) {
      if (versionCheck.reason === 'unsupported_major') {
        return {
          status: 'unsupported-version',
          version: String((input as Record<string, unknown>)['evidenceSchemaVersion'] ?? ''),
        };
      }
      const parsed = parseEvidenceRecord(input);
      return {
        status: 'invalid',
        identity: null,
        issues: toStorageSafeIssues(parsed.ok ? [] : parsed.issues.map((i: { code: string; path: string }) => ({ code: i.code, path: i.path }))),
      };
    }

    // Step 3: full validation.
    const parsed = parseEvidenceRecord(input);
    if (!parsed.ok) {
      return {
        status: 'invalid',
        identity: null,
        issues: toStorageSafeIssues(parsed.issues.map((i: { code: string; path: string }) => ({ code: i.code, path: i.path }))),
      };
    }
    const validatedRecord = parsed.record;
    const identity = validatedRecord.trace.traceId;

    // Step 4: Phase A safety gate (retained bytes).
    const phaseACodes = runSafetyGate(validatedRecord);
    if (phaseACodes.length > 0 && phaseACodes.includes('S6')) {
      return { status: 'safety-rejected', reasons: phaseACodes };
    }

    // Step 5: serialize first.
    let storedDocument: string;
    try {
      storedDocument = serializeEvidenceRecord(validatedRecord);
    } catch (err) {
      // Programming-error guard: should not happen after parseEvidenceRecord succeeded.
      return {
        status: 'invalid',
        identity,
        issues: [{ code: 'record_not_object', path: '$' }],
      };
    }

    // Step 6: detached snapshot.
    const snapshotResult = parseEvidenceRecord(JSON.parse(storedDocument));
    if (!snapshotResult.ok) {
      // Should never happen: same serializer produced the text.
      return {
        status: 'invalid',
        identity,
        issues: toStorageSafeIssues(snapshotResult.issues.map((i: { code: string; path: string }) => ({ code: i.code, path: i.path }))),
      };
    }
    const snapshot = deepFreeze(snapshotResult.record);

    // Step 7: Phase B safety gate.
    const phaseBCodes = runSafetyGate(snapshotResult.record);
    if (phaseBCodes.length > 0) {
      return { status: 'safety-rejected', reasons: phaseBCodes };
    }

    // Step 8: policy admission.
    let decision: PersistencePolicyDecision;
    try {
      const rawDecision = this.policy.decide(snapshot);
      const validated = validatePolicyDecision(rawDecision);
      if (!validated.valid) {
        return {
          status: 'policy-failed',
          policy: { name: this.policy.name, version: this.policy.version },
          reason: 'malformed-decision',
        };
      }
      decision = validated.decision;
    } catch {
      return {
        status: 'policy-failed',
        policy: { name: this.policy.name, version: this.policy.version },
        reason: 'exception',
      };
    }

    if (!decision.accept) {
      return {
        status: 'policy-rejected',
        policy: { name: this.policy.name, version: this.policy.version },
        code: decision.code,
      };
    }

    // Step 9: digest.
    const storageDigest = sha256Hex(utf8Encode(storedDocument));

    // Step 10: transactional append.
    return this.appendRecord(identity, validatedRecord.evidenceSchemaVersion, storedDocument, storageDigest);
  }

  private classifyExistingRow(
    existing: { serialized_record: string; storage_digest: string; stored_at: string } | undefined,
    identity: string,
    storedDocument: string,
    storageDigest: string,
  ): SaveOutcome | null {
    if (!existing) return null;
    if (existing.serialized_record === storedDocument) {
      return { status: 'already-present', identity, digest: existing.storage_digest };
    }
    return {
      status: 'conflict',
      identity,
      existingDigest: existing.storage_digest,
      suppliedDigest: storageDigest,
      storedAt: existing.stored_at,
    };
  }

  private appendRecord(
    identity: string,
    evidenceSchemaVersion: string,
    storedDocument: string,
    storageDigest: string,
  ): SaveOutcome {
    const selectExisting = this.db.prepare(
      `SELECT serialized_record, storage_digest, stored_at FROM evidence_records WHERE evidence_identity = ?`
    );
    const insert = this.db.prepare(`
      INSERT INTO evidence_records (
        evidence_identity, evidence_schema_version, storage_format_version,
        persistence_policy_name, persistence_policy_version, stored_at, storage_digest, serialized_record
      ) VALUES (
        @identity, @evidenceSchemaVersion, @storageFormatVersion,
        @policyName, @policyVersion, @storedAt, @storageDigest, @serializedRecord
      )
    `);

    const tx = this.db.transaction(() => {
      const existing = selectExisting.get(identity) as
        | { serialized_record: string; storage_digest: string; stored_at: string }
        | undefined;

      const classified = this.classifyExistingRow(existing, identity, storedDocument, storageDigest);
      if (classified) return classified;

      let storedAt: string;
      try {
        storedAt = this.now();
      } catch {
        return { status: 'clock-failed' } as SaveOutcome;
      }
      if (!isIso8601Utc(storedAt)) {
        return { status: 'clock-failed' } as SaveOutcome;
      }

      insert.run({
        identity,
        evidenceSchemaVersion,
        storageFormatVersion: STORAGE_FORMAT_VERSION,
        policyName: this.policy.name,
        policyVersion: this.policy.version,
        storedAt,
        storageDigest,
        serializedRecord: storedDocument,
      });

      return {
        status: 'stored',
        identity,
        digest: storageDigest,
        manifest: {
          storageFormatVersion: STORAGE_FORMAT_VERSION,
          evidenceSchemaVersion,
          persistencePolicy: { name: this.policy.name, version: this.policy.version },
          storedAt,
          storageDigest,
        },
      } as SaveOutcome;
    });

    try {
      return tx();
    } catch (err) {
      // Unique constraint race: re-read and classify.
      const existing = selectExisting.get(identity) as
        | { serialized_record: string; storage_digest: string; stored_at: string }
        | undefined;
      const classified = this.classifyExistingRow(existing, identity, storedDocument, storageDigest);
      if (classified) return classified;
      throw err;
    }
  }

  getEvidenceRecord(identity: string): EvidenceReadResult {
    const result = this.getStoredEvidence(identity);
    if (!result.ok) return result;
    return { ok: true, record: result.record };
  }

  // fallow-ignore-next-line complexity
  getStoredEvidence(identity: string): StoredEvidenceReadResult {
    const row = this.db.prepare(
      `SELECT * FROM evidence_records WHERE evidence_identity = ?`
    ).get(identity) as
      | {
          evidence_identity: string;
          evidence_schema_version: string;
          storage_format_version: string;
          persistence_policy_name: string;
          persistence_policy_version: string;
          stored_at: string;
          storage_digest: string;
          serialized_record: string;
        }
      | undefined;

    if (!row) {
      return { ok: false, reason: 'not-found' };
    }

    // Step 2: safely parse JSON (must come before digest-dependent trust).
    let doc: unknown;
    try {
      doc = JSON.parse(row.serialized_record);
    } catch {
      return { ok: false, reason: 'corrupt', code: 'json_parse_failed' };
    }
    if (!isRecord(doc)) {
      return { ok: false, reason: 'corrupt', code: 'json_parse_failed' };
    }

    // Step 3: administrative integrity checks.
    if (row.storage_format_version !== STORAGE_FORMAT_VERSION) {
      return { ok: false, reason: 'corrupt', code: 'format_version_mismatch' };
    }
    if (row.evidence_identity !== identity) {
      return { ok: false, reason: 'corrupt', code: 'identity_mismatch' };
    }

    const policyMalformed = validateStoredPolicyMetadata(
      row.persistence_policy_name,
      row.persistence_policy_version,
    );
    if (policyMalformed) {
      return { ok: false, reason: 'corrupt', code: policyMalformed };
    }
    if (!isIso8601Utc(row.stored_at)) {
      return { ok: false, reason: 'corrupt', code: 'stored_at_malformed' };
    }

    const recomputedDigest = sha256Hex(utf8Encode(row.serialized_record));
    if (recomputedDigest !== row.storage_digest) {
      return { ok: false, reason: 'corrupt', code: 'digest_mismatch' };
    }

    // Step 4: version triage.
    const versionCheck = checkEvidenceSchemaVersion(doc['evidenceSchemaVersion']);
    if (!versionCheck.ok) {
      if (versionCheck.reason === 'unsupported_major') {
        if (row.evidence_schema_version !== doc['evidenceSchemaVersion']) {
          return { ok: false, reason: 'corrupt', code: 'schema_version_mismatch' };
        }
        return { ok: false, reason: 'unsupported-version', version: String(doc['evidenceSchemaVersion']) };
      }
      return { ok: false, reason: 'corrupt', code: 'invalid_version_syntax' };
    }

    const parsed = parseEvidenceRecord(doc);
    if (!parsed.ok) {
      return { ok: false, reason: 'corrupt', code: 'validation_failed' };
    }

    if (parsed.record.trace.traceId !== identity) {
      return { ok: false, reason: 'corrupt', code: 'identity_mismatch' };
    }
    if (parsed.record.trace.traceId !== parsed.record.trace.interactionId) {
      return { ok: false, reason: 'corrupt', code: 'trace_identity_mismatch' };
    }
    if (parsed.record.evidenceSchemaVersion !== row.evidence_schema_version) {
      return { ok: false, reason: 'corrupt', code: 'schema_version_mismatch' };
    }

    const manifest: StorageManifest = {
      storageFormatVersion: row.storage_format_version,
      evidenceSchemaVersion: row.evidence_schema_version,
      persistencePolicy: {
        name: row.persistence_policy_name,
        version: row.persistence_policy_version,
      },
      storedAt: row.stored_at,
      storageDigest: row.storage_digest,
    };

    return { ok: true, record: parsed.record, manifest };
  }
}

// ---------------------------------------------------------------------------
// Semantic-version comparison (storage-format version only)
// ---------------------------------------------------------------------------

function compareSemanticVersion(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10));
  const av = parse(a);
  const bv = parse(b);
  for (let i = 0; i < 3; i++) {
    if (av[i] !== bv[i]) return av[i] > bv[i] ? 1 : -1;
  }
  return 0;
}
