/**
 * Tests: serialization contract (Spec 014 §5.7) — RFC 4648 §4 canonical
 * Base64, byte_faithful round trips, unknown-field preservation, deterministic
 * output, and the derivative export. Also SHA-256 and JCS primitives.
 */
import { describe, expect, it } from 'vitest';
import {
  base64Encode,
  base64Decode,
  isCanonicalBase64,
} from './internal/base64.js';
import { sha256Hex, utf8Encode } from './internal/sha256.js';
import { canonicalJson } from './internal/jcs.js';
import {
  serializeEvidenceRecord,
  serializeEvidenceExport,
} from './serialize.js';
import { parseEvidenceRecord } from './validate.js';
import {
  minimalObservations,
  buildBoundary,
  buildRecord,
  obs,
  T2, T3,
  PROFILE,
} from './fixtures.js';
import type { EvidenceObservation } from './types-trace.js';

describe('RFC 4648 §4 canonical Base64', () => {
  it('encodes with zero, one, or two canonical padding characters', () => {
    expect(base64Encode(new Uint8Array([255]))).toBe('/w==');
    expect(base64Encode(new Uint8Array([255, 255]))).toBe('//8=');
    expect(base64Encode(new Uint8Array([255, 255, 255]))).toBe('////');
    expect(base64Encode(new Uint8Array([0, 0, 0]))).toBe('AAAA'); // zero padding
    expect(base64Encode(new Uint8Array([104, 105]))).toBe('aGk=');
    expect(base64Encode(utf8Encode('hello'))).toBe('aGVsbG8=');
  });

  it('accepts canonical zero-padding encodings on decode', () => {
    const decoded = base64Decode('AAAA');
    expect(decoded).not.toBeNull();
    expect([...(decoded as Uint8Array)]).toEqual([0, 0, 0]);
    expect(isCanonicalBase64('AAAA')).toBe(true);
  });

  it('rejects omitted required padding', () => {
    expect(base64Decode('aGk')).toBeNull(); // needs '='
    expect(isCanonicalBase64('aGk')).toBe(false);
  });

  it('rejects superfluous or malformed padding', () => {
    expect(base64Decode('aGk===')).toBeNull(); // pad 3
    expect(base64Decode('aGk=a')).toBeNull(); // length not multiple of 4
    expect(base64Decode('a=aG')).toBeNull(); // non-final '='
    expect(base64Decode('aGk==')).toBeNull(); // superfluous (1 byte needs 2 pad)
  });

  it('rejects URL-safe characters and whitespace', () => {
    expect(base64Decode('A-AA')).toBeNull();
    expect(base64Decode('A_AA')).toBeNull();
    expect(base64Decode(' AAAA')).toBeNull();
    expect(base64Decode('AAAA\n')).toBeNull();
    expect(base64Decode('AAAA=')).toBeNull();
  });

  it('rejects non-canonical trailing bits and enforces decode-re-encode', () => {
    expect(base64Decode('AAB=')).toBeNull(); // trailing non-zero bits
    expect(base64Decode('A===')).toBeNull(); // padding count 3 exceeds canonical
    expect(base64Decode('aGVsbG8')).toBeNull(); // length not multiple of 4
    expect(isCanonicalBase64('aGVsbG8')).toBe(false);
    expect(isCanonicalBase64('AA==')).toBe(true); // canonical 1-byte encoding
    expect([...(base64Decode('AA==') as Uint8Array)]).toEqual([0]);
  });

  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
    const enc = base64Encode(bytes);
    expect(isCanonicalBase64(enc)).toBe(true);
    const dec = base64Decode(enc);
    expect(dec).not.toBeNull();
    expect([...(dec as Uint8Array)]).toEqual([...bytes]);
  });
});

describe('SHA-256 and JCS primitives', () => {
  it('matches published SHA-256 vectors', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(utf8Encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('canonicalizes objects with sorted keys and compact output', () => {
    expect(canonicalJson({ b: 1, a: [2, null, true] })).toBe('{"a":[2,null,true],"b":1}');
    expect(canonicalJson({ x: 'a\nb' })).toBe('{"x":"a\\nb"}');
    expect(canonicalJson({ z: 1.0, y: -0 })).toBe('{"y":0,"z":1}');
  });

  it('preserves astral-plane characters as complete surrogate pairs (regression)', () => {
    // "😀" is U+1F600 (UTF-16 D83D DE00). The low surrogate must not be
    // dropped or double-encoded by escapeString.
    const out = canonicalJson({ emoji: '😀' });
    expect(out).toBe(JSON.stringify({ emoji: '😀' }));
    // Verbatim pair, never a lone `\uD83D` escape text with a lost low unit.
    expect(out).not.toContain('\\uD83D');
    // Round trip through JSON.parse keeps the full character.
    const round = JSON.parse(out) as { emoji: string };
    expect(round.emoji).toBe('😀');
    expect([...round.emoji].length).toBe(1);
  });

  it('escapes lone surrogates as \\uXXXX and replaces them in UTF-8 encoding', () => {
    const lone = 'a\uD800b'; // lone high surrogate between ASCII letters
    const json = canonicalJson({ s: lone });
    expect(json).toBe('{"s":"a\\uD800b"}');
    // The escaped text contains no raw surrogate units, so UTF-8 encoding is
    // well-formed; a raw lone surrogate encodes as U+FFFD (WHATWG behavior).
    expect(sha256Hex(utf8Encode(lone))).toBe(sha256Hex(utf8Encode('a\uFFFDb')));
  });
});

describe('byte_faithful retained-byte serialization', () => {
  function byteObservation(): EvidenceObservation[] {
    const bytes = utf8Encode('{"stream":true,"max_tokens":100}');
    return [
      ...minimalObservations().slice(0, 3),
      obs({
        observationId: 'o3b', eventId: 'evt-resp', seq: 3, spanId: 'sp-1',
        kind: 'model_response', capturedAt: T3, rawCapturedAt: T3,
        observationRole: 'provider_reported',
        payload: {
          responseEnvelope: {
            providerNativeFidelity: 'byte_faithful',
            nativeEncoding: 'utf-8',
            nativeContentType: 'application/json',
            nativeContentHash: `sha256:${sha256Hex(bytes)}`,
            providerNative: bytes,
          },
        },
      }),
      ...minimalObservations().slice(4),
    ];
  }

  it('serializes retained bytes as canonical Base64 and round-trips byte-identically', () => {
    const record = buildRecord(byteObservation());
    const text = serializeEvidenceRecord(record);
    const json = JSON.parse(text) as Record<string, unknown>;
    const respEvent = (json['trace'] as Record<string, unknown>)['events'] as Record<string, unknown>[];
    const env = (respEvent.find((e) => e['kind'] === 'model_response')! as Record<string, unknown>)['responseEnvelope'] as Record<string, unknown>;
    const b64 = env['providerNative'] as string;
    expect(isCanonicalBase64(b64)).toBe(true);
    expect(b64).toBe('eyJzdHJlYW0iOnRydWUsIm1heF90b2tlbnMiOjEwMH0=');

    const parsed = parseEvidenceRecord(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Serializing the parsed record reproduces identical bytes (lossless).
    expect(serializeEvidenceRecord(parsed.record)).toBe(text);
  });

  it('computes hashes over decoded bytes, never the encoded text', () => {
    const bytes = utf8Encode('x');
    const encoded = base64Encode(bytes);
    expect(sha256Hex(utf8Encode(encoded))).not.toBe(sha256Hex(bytes));
  });
});

describe('serializeEvidenceRecord contract', () => {
  it('throws on invalid records (programming-error guard), not silent repair', () => {
    const record = buildRecord();
    const bad = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    (bad['completeness'] as Record<string, unknown>)['eventsByStatus'] = { captured: 1 };
    expect(() => serializeEvidenceRecord(bad as never)).toThrow(/invalid evidence record/);
  });

  it('preserves unknown observation-level additive fields on round trips', () => {
    const base = minimalObservations();
    const obsWithExtra = {
      ...base[2]!,
      futureField: { added: true, list: [1, 2] },
    } as EvidenceObservation;
    const record = buildRecord([...base.slice(0, 2), obsWithExtra, ...base.slice(3)]);
    const { text } = (() => ({ text: serializeEvidenceRecord(record) }))();
    const json = JSON.parse(text) as Record<string, unknown>;
    const raw = (json['rawObservations'] as Record<string, unknown>[]).find((o) => o['observationId'] === 'o2')!;
    expect(raw['futureField']).toEqual({ added: true, list: [1, 2] });
    const parsed = parseEvidenceRecord(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const back = JSON.parse(serializeEvidenceRecord(parsed.record)) as Record<string, unknown>;
      const rawBack = (back['rawObservations'] as Record<string, unknown>[]).find((o) => o['observationId'] === 'o2')!;
      expect(rawBack['futureField']).toEqual({ added: true, list: [1, 2] });
    }
  });

  it('emits deterministic bytes for the same valid record', () => {
    const record = buildRecord();
    expect(serializeEvidenceRecord(record)).toBe(serializeEvidenceRecord(record));
  });

  it('serializes exactly once at EvidenceRecord.completeness, never on the trace', () => {
    const record = buildRecord();
    const json = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    expect((json['trace'] as Record<string, unknown>)['completeness']).toBeUndefined();
    expect(json['completeness']).toBeDefined();
  });
});

describe('serializeEvidenceExport (derivative)', () => {
  it('declares omitted evidence, reduced boundary, and reported-derived status', () => {
    const record = buildRecord();
    const doc = JSON.parse(serializeEvidenceExport(
      record.trace, record.analysis, record.completeness, record.captureBoundary,
    )) as Record<string, unknown>;
    expect(doc['rawObservationsOmitted']).toBe(true);
    expect(doc['verificationBoundary']).toBe('reduced');
    expect(doc['duplicateAnalysis']).toBe('reported-derived');
    expect(doc['rawObservations']).toBeUndefined();
    expect(String(doc['statement'])).toMatch(/cannot be independently proved/);
  });
});

void T2;
void PROFILE;
void buildBoundary;