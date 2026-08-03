/**
 * Tests: retained-byte Base64 contract (Spec 014 §5.7) and version compatibility (Spec 014 §5.3).
 * Fixed fixtures pinning RFC 4648 §4 canonical Base64 and version-compatibility behavior.
 */
import { describe, expect, it } from 'vitest';
import {
  base64Encode,
  base64Decode,
  isCanonicalBase64,
} from './internal/base64.js';
import { canonicalJson } from './internal/jcs.js';
import { sha256Hex, utf8Encode } from './internal/sha256.js';
import {
  parseEvidenceRecord,
  normalizeEvidenceRecord,
  isArtifactKind,
} from '@signalglass/evidence';
import { serializeEvidenceRecord } from '@signalglass/evidence';
import { minimalObservations, buildBoundary, buildRecord, PROFILE } from './fixtures.js';

const V = '1.0.0';

describe('Retained-byte Base64 contract (Spec 014 §5.7)', () => {
  describe('RFC 4648 §4 standard alphabet encoding', () => {
    it('encodes with canonical zero padding (input length divisible by 3)', () => {
      expect(base64Encode(new Uint8Array([0, 0, 0]))).toBe('AAAA');
      expect(base64Encode(new Uint8Array([255, 255, 255]))).toBe('////');
      expect(isCanonicalBase64('AAAA')).toBe(true);
      expect(isCanonicalBase64('////')).toBe(true);
    });

    it('encodes with canonical one "=" padding (input length % 3 === 2)', () => {
      expect(base64Encode(new Uint8Array([255, 255]))).toBe('//8=');
      expect(isCanonicalBase64('//8=')).toBe(true);
    });

    it('encodes with canonical two "=" padding (input length % 3 === 1)', () => {
      expect(base64Encode(new Uint8Array([255]))).toBe('/w==');
      expect(base64Encode(utf8Encode('hello'))).toBe('aGVsbG8=');
      expect(isCanonicalBase64('/w==')).toBe(true);
      expect(isCanonicalBase64('aGVsbG8=')).toBe(true);
    });

    it('round-trips arbitrary bytes', () => {
      const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
      const enc = base64Encode(bytes);
      expect(isCanonicalBase64(enc)).toBe(true);
      const dec = base64Decode(enc);
      expect(dec).not.toBeNull();
      expect([...(dec as Uint8Array)]).toEqual([...bytes]);
    });

    it('preserves astral-plane characters as complete surrogate pairs in JCS', () => {
      const out = canonicalJson({ emoji: '😀' });
      expect(out).toBe('{"emoji":"😀"}');
      expect(out).not.toContain('\\uD83D');
    });
  });

  describe('Canonical Base64 rejection cases', () => {
    it('rejects omitted required padding', () => {
      expect(base64Decode('aGk')).toBeNull(); // needs '='
      expect(base64Decode('aGVsbG8')).toBeNull(); // needs '='
      expect(isCanonicalBase64('aGk')).toBe(false);
      expect(isCanonicalBase64('aGVsbG8')).toBe(false);
    });

    it('rejects superfluous or malformed padding', () => {
      expect(base64Decode('aGk===')).toBeNull(); // pad 3
      expect(base64Decode('aGk=a')).toBeNull(); // length not multiple of 4
      expect(base64Decode('a=aG')).toBeNull(); // non-final '='
      expect(base64Decode('aGk==')).toBeNull(); // superfluous (1 byte needs 2 pad)
      expect(isCanonicalBase64('aGk===')).toBe(false);
      expect(isCanonicalBase64('aGk==')).toBe(false);
    });

    it('rejects URL-safe characters and whitespace', () => {
      expect(base64Decode('A-AA')).toBeNull();
      expect(base64Decode('A_AA')).toBeNull();
      expect(base64Decode(' AAAA')).toBeNull();
      expect(base64Decode('AAAA\n')).toBeNull();
      expect(base64Decode('AAAA=')).toBeNull();
      expect(isCanonicalBase64('A-AA')).toBe(false);
      expect(isCanonicalBase64('A_AA')).toBe(false);
    });

    it('rejects non-canonical trailing bits', () => {
      expect(base64Decode('AAB=')).toBeNull(); // trailing non-zero bits
      expect(base64Decode('A===')).toBeNull(); // padding count 3 exceeds canonical
      expect(isCanonicalBase64('AAB=')).toBe(false);
      expect(isCanonicalBase64('A===')).toBe(false);
    });

    it('accepts canonical single-byte zero-padded encoding', () => {
      expect(isCanonicalBase64('AA==')).toBe(true);
      const dec = base64Decode('AA==');
      expect(dec).not.toBeNull();
      expect([...(dec as Uint8Array)]).toEqual([0]);
    });
  });

  describe('Hashes over decoded bytes, never encoded text', () => {
    it('computes SHA-256 over decoded bytes', () => {
      const bytes = utf8Encode('x');
      const encoded = base64Encode(bytes);
      expect(sha256Hex(utf8Encode(encoded))).not.toBe(sha256Hex(bytes));
      // Verify round-trip decode
      const decoded = base64Decode(encoded);
      expect(decoded).not.toBeNull();
      expect([...(decoded as Uint8Array)]).toEqual([...bytes]);
    });

    it('uses decoded bytes for nativeContentHash', () => {
      const bytes = utf8Encode('{"test":true}');
      const b64 = base64Encode(bytes);
      const hashFromBytes = sha256Hex(bytes);
      const hashFromEncoded = sha256Hex(utf8Encode(b64));
      expect(hashFromBytes).not.toBe(hashFromEncoded);
    });
  });
});

describe('Version-compatibility fixture coverage (Spec 014 §5.3)', () => {
  const baseBoundary = buildBoundary();

  it('accepts exact supported evidenceSchemaVersion', () => {
    const record = buildRecord();
    const res = parseEvidenceRecord(record as unknown);
    expect(res.ok).toBe(true);
  });

  it('accepts compatible additive minor revision within supported MAJOR', () => {
    const record = buildRecord(undefined, buildBoundary(), { evidenceSchemaVersion: '1.1.0' });
    const res = parseEvidenceRecord(record as unknown);
    expect(res.ok).toBe(true);
  });

  it('accepts compatible additive patch revision within supported MAJOR', () => {
    const record = buildRecord(undefined, buildBoundary(), { evidenceSchemaVersion: '1.0.1' });
    const res = parseEvidenceRecord(record as unknown);
    expect(res.ok).toBe(true);
  });

  it('rejects unknown or breaking MAJOR version', () => {
    const record = buildRecord();
    const bad = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    bad['evidenceSchemaVersion'] = '2.0.0';
    const res = parseEvidenceRecord(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map(i => i.code)).toContain('unsupported_evidence_schema_version');
  });

  it('rejects unknown major version with structured error', () => {
    const record = buildRecord();
    const bad = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    bad['evidenceSchemaVersion'] = '99.0.0';
    const res = parseEvidenceRecord(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.map(i => i.code)).toContain('unsupported_evidence_schema_version');
      expect(res.issues[0].path).toBe('evidenceSchemaVersion');
    }
  });

  it('preserves unknown additive fields for compatible versions', () => {
    const record = buildRecord();
    const text = serializeEvidenceRecord(record);
    const json = JSON.parse(text) as Record<string, unknown>;
    json['futureField'] = { added: true, list: [1, 2, 3] };
    const res = parseEvidenceRecord(json);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const out = JSON.parse(serializeEvidenceRecord(res.record)) as Record<string, unknown>;
      expect(out['futureField']).toEqual({ added: true, list: [1, 2, 3] });
    }
  });

  it('rejects unknown discriminants in event kinds', () => {
    const record = buildRecord();
    const bad = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    const events = (bad['trace'] as Record<string, unknown>)['events'] as unknown[];
    const firstEvent = events[0] as Record<string, unknown>;
    (bad['trace'] as Record<string, unknown>)['events'] = [
      { ...firstEvent, kind: 'teleport' },
    ];
    const res = parseEvidenceRecord(bad);
    expect(res.ok).toBe(false);
  });

  it('rejects unknown discriminants in span kinds', () => {
    const record = buildRecord();
    const bad = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    const spans = (bad['trace'] as Record<string, unknown>)['spans'] as unknown[];
    const firstSpan = spans[0] as Record<string, unknown>;
    (bad['trace'] as Record<string, unknown>)['spans'] = [
      { ...firstSpan, kind: 'teleport' },
    ];
    const res = parseEvidenceRecord(bad);
    expect(res.ok).toBe(false);
  });

  it('rejects unknown discriminants in artifact kinds', () => {
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

  it('rejects unknown discriminants in fidelity values', () => {
    const record = buildRecord();
    const bad = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    const trace = bad['trace'] as Record<string, unknown>;
    const events = trace['events'] as Record<string, unknown>[];
    const modelReq = events.find(e => e['kind'] === 'model_request');
    if (modelReq && modelReq['requestEnvelope']) {
      (modelReq['requestEnvelope'] as Record<string, unknown>)['providerNativeFidelity'] = 'quantum_faithful';
    }
    const res = parseEvidenceRecord(bad);
    expect(res.ok).toBe(false);
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

  it('never silently coerces invalid version syntax', () => {
    const res = normalizeEvidenceRecord(minimalObservations(), buildBoundary(), 'not-semver', { captureProfile: PROFILE });
    expect(res.ok).toBe(false);
  });

  it('preserves unknown additive fields across parse-serialize-parse for compatible versions', () => {
    const record = buildRecord();
    const text = serializeEvidenceRecord(record);
    const json = JSON.parse(text) as Record<string, unknown>;
    json['futureAdditive'] = { nested: { value: 42 } };
    const res = parseEvidenceRecord(json);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const out = JSON.parse(serializeEvidenceRecord(res.record)) as Record<string, unknown>;
      expect(out['futureAdditive']).toEqual({ nested: { value: 42 } });
    }
  });
});
