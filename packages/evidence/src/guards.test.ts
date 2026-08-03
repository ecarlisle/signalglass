/**
 * Tests: public per-record validators, vocabulary guards, and format checks
 * (Spec 014 §2.2.12, §5.4; Spec 013 §3.2, §6.1).
 */
import { describe, expect, it } from 'vitest';
import {
  isEvidenceStatus,
  isObservationRole,
  isEventKind,
  isSpanKind,
  isArtifactKind,
  isContentHash,
  isContentType,
  isSemanticVersion,
  isContextArtifact,
  isRequestEnvelope,
  isResponseEnvelope,
  isEvidenceObservation,
  isSpanRecord,
  isEventRecord,
} from './guards.js';
import { isTimestamp } from './internal/time.js';
import { isSupportedEvidenceSchemaVersion } from './version.js';
import { isJsonContentType, majorVersion } from './internal/formats.js';
import { minimalObservations } from './fixtures.js';

describe('vocabulary guards', () => {
  it('isEvidenceStatus: closed status vocabulary, inferred is not a status', () => {
    for (const s of ['captured', 'redacted', 'truncated', 'missing', 'unknown', 'not_applicable']) {
      expect(isEvidenceStatus(s)).toBe(true);
    }
    expect(isEvidenceStatus('inferred')).toBe(false);
    expect(isEvidenceStatus('completed')).toBe(false);
    expect(isEvidenceStatus(null)).toBe(false);
  });

  it('isObservationRole / isEventKind / isSpanKind / isArtifactKind', () => {
    expect(isObservationRole('client_sent')).toBe(true);
    expect(isObservationRole('unobservable')).toBe(true);
    expect(isObservationRole('observer')).toBe(false);
    expect(isEventKind('model_request')).toBe(true);
    expect(isEventKind('mcp_request')).toBe(true);
    expect(isEventKind('totally_new_kind')).toBe(false);
    expect(isSpanKind('model')).toBe(true);
    expect(isSpanKind('context_assembly')).toBe(true);
    expect(isSpanKind('database')).toBe(false);
    expect(isArtifactKind('fragment')).toBe(true);
    expect(isArtifactKind('document')).toBe(true);
    expect(isArtifactKind('blob')).toBe(false);
  });
});

describe('hash and media-type formats', () => {
  it('isContentHash: sha256: + 64 lowercase hex exactly', () => {
    const ok = `sha256:${'ab'.repeat(32)}`;
    expect(isContentHash(ok)).toBe(true);
    expect(isContentHash('sha256:abc')).toBe(false);
    expect(isContentHash(`sha256:${'AB'.repeat(32)}`)).toBe(false); // uppercase
    expect(isContentHash(`sha256:${'ab'.repeat(31)}cdefg`)).toBe(false);
    expect(isContentHash('md5:' + 'ab'.repeat(16))).toBe(false);
    expect(isContentHash(ok.toUpperCase())).toBe(false);
  });

  it('isContentType: RFC 6838 restricted-name syntax', () => {
    expect(isContentType('application/json')).toBe(true);
    expect(isContentType('application/vnd.example+json')).toBe(true);
    expect(isContentType('text/markdown')).toBe(true);
    expect(isContentType('application/json;charset=utf-8')).toBe(false); // parameters rejected
    expect(isContentType('application/')).toBe(false);
    expect(isContentType('/json')).toBe(false);
    expect(isContentType('application/example/json')).toBe(false);
    expect(isContentType('application/*')).toBe(false);
    expect(isContentType('application /json')).toBe(false);
    expect(isContentType('@/!')).toBe(false);
    expect(isContentType(`${'a'.repeat(128)}/json`)).toBe(false);
    expect(isContentType(`${'a'.repeat(127)}/json`)).toBe(true); // 127-char boundary
    expect(isContentType(`application/${'b'.repeat(127)}`)).toBe(true);
  });

  it('isJsonContentType detects JSON and +json suffixes', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('application/vnd.example+json')).toBe(true);
    expect(isJsonContentType('text/markdown')).toBe(false);
  });

  it('majorVersion / isSupportedEvidenceSchemaVersion', () => {
    expect(majorVersion('1.0.0')).toBe(1);
    expect(majorVersion('2.5.0')).toBe(2);
    expect(majorVersion('nope')).toBeNull();
    expect(isSupportedEvidenceSchemaVersion('1.0.0')).toBe(true);
    expect(isSupportedEvidenceSchemaVersion('1.2.3')).toBe(true);
    expect(isSupportedEvidenceSchemaVersion('2.0.0')).toBe(false);
    expect(isSupportedEvidenceSchemaVersion('banana')).toBe(false);
    expect(isSemanticVersion('1.0.0')).toBe(true);
    expect(isSemanticVersion('1.0.0-rc.1+build.5')).toBe(true);
    expect(isSemanticVersion('v1.0.0')).toBe(false);
  });
});

describe('timestamps', () => {
  it('requires ISO 8601 UTC with millisecond precision', () => {
    expect(isTimestamp('2025-06-01T14:00:00.123Z')).toBe(true);
    expect(isTimestamp('2025-06-01T14:00:00Z')).toBe(false); // no ms
    expect(isTimestamp('2025-06-01T14:00:00.123+02:00')).toBe(false); // offset
    expect(isTimestamp('2025-02-30T00:00:00.000Z')).toBe(false); // invalid date
    expect(isTimestamp('2025-06-01T24:00:00.000Z')).toBe(false);
    expect(isTimestamp(1234567890)).toBe(false);
  });
});

describe('per-record guards', () => {
  it('isEvidenceObservation rejects malformed observations', () => {
    const good = minimalObservations()[0]!;
    expect(isEvidenceObservation(good)).toBe(true);
    expect(isEvidenceObservation({ ...good, seq: '5' })).toBe(false); // no coercion
    expect(isEvidenceObservation({ ...good, evidenceStatus: null })).toBe(false);
    expect(isEvidenceObservation({ ...good, observationRole: 'made_up' })).toBe(false);
    expect(isEvidenceObservation({ ...good, kind: 'unknown_kind' })).toBe(false);
  });

  it('isSpanRecord / isEventRecord minimal structure', () => {
    const span = { spanId: 's1', kind: 'model', name: 'n', parentSpanId: null, startSeq: 1, startedAt: '2025-06-01T14:00:00.000Z', status: 'completed' };
    expect(isSpanRecord(span)).toBe(true);
    expect(isSpanRecord({ ...span, kind: 'database' })).toBe(false); // kind outside the closed vocabulary
    expect(isSpanRecord({ ...span, parentSpanId: 123 })).toBe(false); // no coercion of non-string parent
    expect(isSpanRecord({ ...span, startSeq: -1 })).toBe(false); // negative sequence
    expect(isEventRecord({ eventId: 'e1', traceId: 't', spanId: null, seq: 0, kind: 'interaction_start', capturedAt: '2025-06-01T14:00:00.000Z', evidenceStatus: 'captured' })).toBe(true);
  });

  it('isRequestEnvelope / isResponseEnvelope fidelity discriminant', () => {
    expect(isRequestEnvelope({ model: 'm', provider: 'p', providerNativeFidelity: 'structurally_faithful' })).toBe(true);
    expect(isRequestEnvelope({ providerNativeFidelity: 'structurally_faithful' })).toBe(false); // missing model/provider
    expect(isRequestEnvelope({ model: 'm', provider: 'p', providerNativeFidelity: 'whatever' })).toBe(false);
    expect(isResponseEnvelope({ providerNativeFidelity: 'byte_faithful' })).toBe(true);
  });

  it('isContextArtifact minimal shape', () => {
    expect(isContextArtifact({ artifactId: 'a1', kind: 'fragment', evidenceStatus: 'captured' })).toBe(true);
    expect(isContextArtifact({ artifactId: 'a1', kind: 'fragment' })).toBe(false); // no status
  });
});
