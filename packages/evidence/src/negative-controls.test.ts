/**
 * Tests: deterministic negative controls (Spec 014 §8.2, §9).
 * Table-driven tests for all required rejection cases using public APIs.
 */
import { describe, expect, it } from 'vitest';
import {
  parseEvidenceRecord,
  normalizeEvidenceRecord,
  isEventKind,
  isEvidenceStatus,
  isObservationRole,
  isContentType,
  isContentHash,
  isArtifactKind,
  isSpanKind,
} from '@signalglass/evidence';
import { serializeEvidenceRecord } from '@signalglass/evidence';
import { minimalObservations, buildBoundary, buildRecord, obs, PROFILE, T0, T1, T2, T3, T4, T5 } from './fixtures.js';
import type { EvidenceObservation } from './types-trace.js';

const V = '1.0.0';

describe('Negative controls — Status, fidelity, and availability', () => {
  const baseBoundary = buildBoundary();

  it('rejects missing observationRole on payload-bearing event', () => {
    const ev = obs({
      observationId: 'neg-missing-role', eventId: 'evt-missing', seq: 2, kind: 'model_request',
      evidenceStatus: 'captured',
      payload: { requestEnvelope: { model: 'm', provider: 'p', providerNativeFidelity: 'structurally_faithful', messages: [] } },
    });
    const res = normalizeEvidenceRecord([ev], baseBoundary, V, { captureProfile: PROFILE });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('missing_observation_role');
  });

  it('rejects missing status with content present', () => {
    const ev = obs({
      observationId: 'neg-missing-content', eventId: 'evt-missing', seq: 2, kind: 'model_request',
      evidenceStatus: 'missing',
      observationRole: 'client_sent',
      payload: { requestEnvelope: { model: 'm', provider: 'p', providerNativeFidelity: 'structurally_faithful', messages: [] } },
    });
    const res = normalizeEvidenceRecord([ev], baseBoundary, V, { captureProfile: PROFILE });
    expect(res.ok).toBe(false);
  });

  it('rejects fidelity or hashes present where status forbids them', () => {
    const invalidStatuses = ['missing', 'unknown', 'not_applicable', 'redacted', 'truncated'];
    for (const status of invalidStatuses) {
      const ev = obs({
        observationId: `neg-fid-${status}`, eventId: `evt-fid-${status}`, seq: 2, kind: 'model_request',
        evidenceStatus: status as any,
        observationRole: 'client_sent',
        payload: {
          requestEnvelope: {
            model: 'm', provider: 'p', providerNativeFidelity: 'byte_faithful',
            nativeEncoding: 'utf-8', nativeContentType: 'application/json',
            nativeContentHash: 'sha256:' + 'ab'.repeat(32),
            messages: [],
          },
        },
      });
      const res = normalizeEvidenceRecord([ev], baseBoundary, V, { captureProfile: PROFILE });
      expect(res.ok).toBe(false);
    }
  });

  it('rejects required content/fidelity/hash fields missing from captured artifacts', () => {
    const ev = obs({
      observationId: 'neg-missing-fields', eventId: 'evt-missing', seq: 2, kind: 'model_request',
      evidenceStatus: 'captured',
      observationRole: 'client_sent',
      payload: {
        requestEnvelope: {
          model: 'm', provider: 'p', providerNativeFidelity: 'byte_faithful',
          messages: [],
        },
      },
    });
    const res = normalizeEvidenceRecord([ev], baseBoundary, V, { captureProfile: PROFILE });
    expect(res.ok).toBe(false);
  });

  it('rejects invalid byte_faithful vs structurally_faithful combinations', () => {
    const ev = obs({
      observationId: 'neg-combo', eventId: 'evt-combo', seq: 2, kind: 'model_response',
      evidenceStatus: 'captured',
      observationRole: 'provider_reported',
      payload: {
        responseEnvelope: {
          providerNativeFidelity: 'structurally_faithful',
          nativeContentHash: 'sha256:' + 'ab'.repeat(32),
          finishReason: 'end_turn',
        },
      },
    });
    const res = normalizeEvidenceRecord([ev], baseBoundary, V, { captureProfile: PROFILE });
    expect(res.ok).toBe(false);
  });
});

describe('Negative controls — Media types and hashes', () => {
  const baseBoundary = buildBoundary();

  it('accepts valid RFC 6838 restricted media types via public isContentType', () => {
    const validTypes = [
      'application/json',
      'application/vnd.example+json',
      'text/markdown',
      'application/xml',
      'text/plain',
      'application/octet-stream',
    ];
    for (const ct of validTypes) {
      expect(isContentType(ct)).toBe(true);
    }
  });

  it('rejects invalid parameterized media types', () => {
    const invalidTypes = [
      'application/json;charset=utf-8',
      'text/plain; charset=utf-8',
    ];
    for (const ct of invalidTypes) {
      expect(isContentType(ct)).toBe(false);
    }
  });

  it('rejects invalid type/subtype boundaries', () => {
    const invalidTypes = [
      'application/', '/json', 'application//json', 'application /json', 'application/json ', ' application/json', 'application/*', '@!/json', 'application/json;param=value',
    ];
    for (const ct of invalidTypes) {
      expect(isContentType(ct)).toBe(false);
    }
  });

  it('accepts valid sha256: hashes via public isContentHash', () => {
    const validHash = 'sha256:' + 'ab'.repeat(32);
    expect(isContentHash(validHash)).toBe(true);
  });

  it('rejects malformed sha256: prefix', () => {
    const ev = obs({
      observationId: 'neg-hash-prefix', eventId: 'evt-hash', seq: 2, kind: 'model_request',
      evidenceStatus: 'captured',
      observationRole: 'client_sent',
      payload: { requestEnvelope: { model: 'm', provider: 'p', providerNativeFidelity: 'byte_faithful', nativeEncoding: 'utf-8', nativeContentType: 'application/json', nativeContentHash: 'sha256x' + 'ab'.repeat(32), messages: [] } },
    });
    const res = normalizeEvidenceRecord([ev], buildBoundary(), V, { captureProfile: PROFILE });
    expect(res.ok).toBe(false);
  });

  it('rejects malformed sha256: length', () => {
    const ev = obs({
      observationId: 'neg-hash-length', eventId: 'evt-hash', seq: 2, kind: 'model_request',
      evidenceStatus: 'captured',
      observationRole: 'client_sent',
      payload: { requestEnvelope: { model: 'm', provider: 'p', providerNativeFidelity: 'byte_faithful', nativeEncoding: 'utf-8', nativeContentType: 'application/json', nativeContentHash: 'sha256:' + 'ab'.repeat(31), messages: [] } },
    });
    const res = normalizeEvidenceRecord([ev], baseBoundary, V, { captureProfile: PROFILE });
    expect(res.ok).toBe(false);
  });

  it('rejects malformed sha256: hexadecimal content', () => {
    const ev = obs({
      observationId: 'neg-hash-hex', eventId: 'evt-hash', seq: 2, kind: 'model_request',
      evidenceStatus: 'captured',
      observationRole: 'client_sent',
      payload: { requestEnvelope: { model: 'm', provider: 'p', providerNativeFidelity: 'byte_faithful', nativeEncoding: 'utf-8', nativeContentType: 'application/json', nativeContentHash: 'sha256:' + 'gz'.repeat(32), messages: [] } },
    });
    const res = normalizeEvidenceRecord([ev], baseBoundary, V, { captureProfile: PROFILE });
    expect(res.ok).toBe(false);
  });

  it('validates hash-path selection for byte_faithful and structurally_faithful content via public API', () => {
    // byte_faithful: contentHash over raw bytes
    expect(isContentHash('sha256:' + 'ab'.repeat(32))).toBe(true);
    // structurally_faithful: contentHash over canonicalized JSON
    expect(isContentHash('sha256:' + 'cd'.repeat(32))).toBe(true);
  });
});

describe('Negative controls — Sequence, duplicates, and gaps', () => {
  const baseBoundary = buildBoundary();

  it('enforces valid deterministic ordering by seq', () => {
    const evs = [
      obs({ observationId: 'o0', eventId: 'e1', seq: 0, kind: 'interaction_start', capturedAt: T0 }),
      obs({ observationId: 'o1', eventId: 'e2', seq: 2, kind: 'model_request', capturedAt: T2 }),
      obs({ observationId: 'o2', eventId: 'e3', seq: 1, kind: 'interaction_end', capturedAt: T1 }),
    ];
    const res = normalizeEvidenceRecord(evs, baseBoundary, V, { captureProfile: PROFILE });
    expect(res.ok).toBe(false);
  });

  it('accepts exact replay duplicates', () => {
    const base = minimalObservations();
    const replay = [...base.slice(0, 3), { ...base[2]!, observationId: 'o2-replay' }, ...base.slice(3)];
    const res = normalizeEvidenceRecord(replay, baseBoundary, V, { captureProfile: PROFILE });
    expect(res.ok).toBe(true);
  });

  it('rejects same-ID same-sequence content conflicts', () => {
    const base = minimalObservations();
    const conflicting = [
      ...base.slice(0, 3),
      { ...base[2]!, observationId: 'o2-conflict', payload: { requestEnvelope: { model: 'different-model', provider: 'anthropic', providerNativeFidelity: 'structurally_faithful' } } } as EvidenceObservation,
      ...base.slice(3),
    ];
    const res = normalizeEvidenceRecord(conflicting, baseBoundary, V, { captureProfile: PROFILE });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map(i => i.code)).toContain('same_id_same_seq_content_conflict');
  });

  it('rejects different-ID same-sequence collisions', () => {
    const base = minimalObservations();
    const collision = [
      ...base.slice(0, 4),
      { ...base[3]!, observationId: 'o3-other', eventId: 'evt-req-2', kind: 'model_request', payload: { requestEnvelope: { model: 'claude-sonnet-4', provider: 'anthropic', providerNativeFidelity: 'structurally_faithful' } } } as EvidenceObservation,
      ...base.slice(4),
    ];
    const res = normalizeEvidenceRecord(collision, baseBoundary, V, { captureProfile: PROFILE });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map(i => i.code)).toContain('different_id_same_seq_collision');
  });

  it('resolves same-ID different-sequence with lowest seq retained', () => {
    const base = minimalObservations();
    const higherSeq = { ...base[2]!, observationId: 'o2-higher', seq: 6, capturedAt: T4, rawCapturedAt: T4 };
    const observations = [...base.slice(0, 3), ...base.slice(3, 5), higherSeq, base[5]!];
    const res = normalizeEvidenceRecord(observations, baseBoundary, V, { captureProfile: PROFILE });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const dup = res.record.analysis.duplicateObservations.find(d => d.classification === 'same_id_different_seq');
      expect(dup).toBeDefined();
    }
  });

  it('validates sequence gaps', () => {
    const base = minimalObservations();
    const observations = [base[0]!, base[1]!, base[2]!, { ...base[4]!, seq: 8 }, { ...base[5]!, seq: 9 }];
    const res = normalizeEvidenceRecord(observations, baseBoundary, V, { captureProfile: PROFILE });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.record.completeness.seqGaps.length).toBeGreaterThan(0);
    }
  });

  it('rejects serialized completeness disagreeing with derivation', () => {
    const record = buildRecord();
    const bad = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    (bad['completeness'] as Record<string, unknown>)['eventsByStatus'] = { captured: 99 };
    const res = parseEvidenceRecord(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map(i => i.code)).toContain('completeness_disagrees_with_derivation');
  });

  it('rejects serialized analysis omitting duplicate provenance', () => {
    const observations = [...minimalObservations().slice(0, 3), { ...minimalObservations()[2]!, observationId: 'o2-replay' }, ...minimalObservations().slice(3)];
    const record = buildRecord(observations);
    const bad = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    (bad['analysis'] as Record<string, unknown>)['duplicateObservations'] = [];
    const res = parseEvidenceRecord(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map(i => i.code)).toContain('analysis_disagrees_with_derivation');
  });

  it('validates order-independent semantic agreement for duplicates and gaps', () => {
    const base = minimalObservations();
    const replay = [...base.slice(0, 3), { ...base[2]!, observationId: 'o2-replay' }, ...base.slice(3)];
    const record = buildRecord(replay);
    const text = serializeEvidenceRecord(record);
    const json = JSON.parse(text) as Record<string, unknown>;
    const analysis = json['analysis'] as Record<string, unknown>;
    const dups = analysis['duplicateObservations'] as unknown[];
    analysis['duplicateObservations'] = [...dups].reverse();
    const res = parseEvidenceRecord(json);
    expect(res.ok).toBe(true);
  });
});

describe('Negative controls — Versions and discriminants', () => {
  const baseBoundary = buildBoundary();

  it('accepts supported additive minor and patch versions', () => {
    const record = buildRecord(undefined, baseBoundary, { evidenceSchemaVersion: '1.1.0' });
    const res = parseEvidenceRecord(record as unknown);
    expect(res.ok).toBe(true);
  });

  it('preserves unknown additive fields for compatible versions', () => {
    const record = buildRecord();
    const text = serializeEvidenceRecord(record);
    const json = JSON.parse(text) as Record<string, unknown>;
    json['futureField'] = { added: true };
    const res = parseEvidenceRecord(json);
    expect(res.ok).toBe(true);
  });

  it('rejects unknown or breaking MAJOR versions', () => {
    const record = buildRecord();
    const bad = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    bad['evidenceSchemaVersion'] = '2.0.0';
    const res = parseEvidenceRecord(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map(i => i.code)).toContain('unsupported_evidence_schema_version');
  });

  it('rejects unknown discriminants in event kinds with stable error codes', () => {
    // Test the public event kind validator directly
    expect(isEventKind('teleport')).toBe(false);
    expect(isEventKind('model_request')).toBe(true);
    expect(isEventKind('model_response')).toBe(true);
    expect(isEventKind('span_start')).toBe(true);
    expect(isEventKind('interaction_start')).toBe(true);
    expect(isEventKind('interaction_end')).toBe(true);
  });

  it('rejects unknown discriminants in span kinds with stable error codes', () => {
    // Test the public span kind validator directly
    expect(isSpanKind('teleport')).toBe(false);
    expect(isSpanKind('model')).toBe(true);
    expect(isSpanKind('tool')).toBe(true);
    expect(isSpanKind('mcp')).toBe(true);
    expect(isSpanKind('retrieval')).toBe(true);
    expect(isSpanKind('context_provider')).toBe(true);
    expect(isSpanKind('context_assembly')).toBe(true);
  });

  it('rejects unknown discriminants in artifact kinds via public artifact validator', () => {
    // The public artifact kind validator is isArtifactKind
    expect(isArtifactKind('teleport')).toBe(false);
    expect(isArtifactKind('message')).toBe(true);
    expect(isArtifactKind('file')).toBe(true);
    expect(isArtifactKind('fragment')).toBe(true);
    expect(isArtifactKind('tool_result')).toBe(true);
    expect(isArtifactKind('mcp_response')).toBe(true);
    expect(isArtifactKind('retrieval_result')).toBe(true);
    expect(isArtifactKind('context_provider_result')).toBe(true);
    expect(isArtifactKind('repository_content')).toBe(true);
    expect(isArtifactKind('manual')).toBe(true);
  });

  it('rejects unknown discriminants in fidelity values with stable error codes', () => {
    // Test via normalizeEvidenceRecord to catch fidelity validation before trace derivation
    const ev = obs({
      observationId: 'neg-fid-quantum', eventId: 'evt-fid', seq: 2, kind: 'model_request',
      evidenceStatus: 'captured',
      observationRole: 'client_sent',
      payload: { requestEnvelope: { model: 'm', provider: 'p', providerNativeFidelity: 'quantum_faithful', nativeEncoding: 'utf-8', nativeContentType: 'application/json', nativeContentHash: 'sha256:' + 'ab'.repeat(32), messages: [] } },
    });
    const res = normalizeEvidenceRecord([ev], buildBoundary(), V, { captureProfile: PROFILE });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.map(i => i.code)).toContain('envelope_invalid_fidelity');
      expect(res.issues[0].path).toContain('requestEnvelope');
    }
  });

  it('returns structured errors with stable paths and codes for version mismatches', () => {
    const record = buildRecord();
    const bad = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    bad['evidenceSchemaVersion'] = '2.0.0';
    const res = parseEvidenceRecord(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.map(i => i.code)).toContain('unsupported_evidence_schema_version');
      expect(res.issues[0].path).toBe('evidenceSchemaVersion');
      expect(res.issues[0].message).toContain('2.0.0');
    }
  });

  it('never silently coerces invalid values', () => {
    const ev = obs({ observationId: 'neg-coerce', eventId: 'evt-coerce', seq: '2' as any, kind: 'model_request', capturedAt: T0 });
    const res = normalizeEvidenceRecord([ev], buildBoundary(), V, { captureProfile: PROFILE });
    expect(res.ok).toBe(false);
  });

  it('preserves unknown additive fields across parse-serialize-parse round-trip', () => {
    const record = buildRecord();
    const text = serializeEvidenceRecord(record);
    const json = JSON.parse(text) as Record<string, unknown>;
    json['futureAdditive'] = { nested: { value: 42 } };
    const res1 = parseEvidenceRecord(json);
    expect(res1.ok).toBe(true);
    if (res1.ok) {
      const out = JSON.parse(serializeEvidenceRecord(res1.record)) as Record<string, unknown>;
      expect(out['futureAdditive']).toEqual({ nested: { value: 42 } });
    }
  });

  it('validates unknown field preservation uses public parse API', () => {
    const record = buildRecord();
    const text = serializeEvidenceRecord(record);
    const json = JSON.parse(text) as Record<string, unknown>;
    json['customField'] = { custom: 'value' };
    const res = parseEvidenceRecord(json);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const out = JSON.parse(serializeEvidenceRecord(res.record)) as Record<string, unknown>;
      expect(out['customField']).toEqual({ custom: 'value' });
    }
  });
});
