/**
 * Tests: parseEvidenceRecord / normalizeEvidenceRecord, authoritative record
 * round trips, collision processing, and completeness verification (Spec 014
 * §4.4, §5.2, §5.7–§5.8; §9.1).
 */
import { describe, expect, it } from 'vitest';
import {
  parseEvidenceRecord,
  normalizeEvidenceRecord,
} from './validate.js';
import { serializeEvidenceRecord, serializeEvidenceExport } from './serialize.js';
import type { EvidenceObservation } from './types-trace.js';
import {
  minimalObservations,
  buildBoundary,
  buildRecord,
  obs,
  T0, T1, T2, T4, T5,
  PROFILE,
} from './fixtures.js';

const V = '1.0.0';

function serializeParse(record: ReturnType<typeof buildRecord>) {
  const text = serializeEvidenceRecord(record);
  return { text, parsed: parseEvidenceRecord(JSON.parse(text) as unknown) };
}

describe('parseEvidenceRecord', () => {
  it('parses a valid authoritative record and returns the full EvidenceRecord', () => {
    const record = buildRecord();
    const res = parseEvidenceRecord(record as unknown);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.rawObservations).toHaveLength(6);
    expect(res.record.trace.status).toBe('completed');
    expect(res.record.trace.finishedAt).toBe(T5);
    expect(res.record.trace.events).toHaveLength(6);
    expect(res.record.trace.spans[0]).toMatchObject({
      spanId: 'sp-1',
      kind: 'model',
      startSeq: 1,
      endSeq: 4,
      status: 'completed',
      finishedAt: T4,
      durationMs: 3000,
    });
    expect(res.record.analysis.validationIssues).toEqual([]);
    expect(res.record.completeness.eventsByStatus).toEqual({ captured: 6 });
  });

  it('rejects non-object input without throwing', () => {
    for (const input of [null, undefined, 42, 'x', [], true]) {
      const res = parseEvidenceRecord(input);
      expect(res.ok).toBe(false);
    }
  });

  it('rejects an unknown or breaking MAJOR schema version', () => {
    const record = buildRecord();
    const bad = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    bad['evidenceSchemaVersion'] = '2.0.0';
    const res = parseEvidenceRecord(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('unsupported_evidence_schema_version');
  });

  it('accepts a compatible additive minor revision within the supported MAJOR', () => {
    const record = buildRecord(undefined, buildBoundary(), { evidenceSchemaVersion: '1.1.0' });
    const res = parseEvidenceRecord(record as unknown);
    expect(res.ok).toBe(true);
  });

  it('rejects serialized trace disagreeing with the deterministic derivation', () => {
    const record = buildRecord();
    const bad = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    const trace = bad['trace'] as Record<string, unknown>;
    trace['status'] = 'unknown';
    const res = parseEvidenceRecord(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('trace_disagrees_with_derivation');
  });

  it('rejects serialized completeness disagreeing with the derivation (contradiction)', () => {
    const record = buildRecord();
    const bad = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    const comp = bad['completeness'] as Record<string, unknown>;
    comp['eventsByStatus'] = { captured: 99 };
    const res = parseEvidenceRecord(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('completeness_disagrees_with_derivation');
  });

  it('rejects a serialized analysis omitting duplicate provenance', () => {
    const observations = [
      ...minimalObservations().slice(0, 3),
      { ...minimalObservations()[2]!, observationId: 'o2-replay' },
      ...minimalObservations().slice(3),
    ];
    const record = buildRecord(observations);
    const bad = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    (bad['analysis'] as Record<string, unknown>)['duplicateObservations'] = [];
    const res = parseEvidenceRecord(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('analysis_disagrees_with_derivation');
  });

  it('preserves raw array order and observation ids losslessly through serialize-parse-serialize', () => {
    const observations = minimalObservations().reverse();
    const record = buildRecord(observations);
    const { text, parsed } = serializeParse(record);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.record.rawObservations.map((o) => o.observationId)).toEqual(
      observations.map((o) => o.observationId),
    );
    // Serialized rawObservations array order preserved.
    const raw = (JSON.parse(text) as Record<string, unknown>)['rawObservations'] as Record<string, unknown>[];
    expect(raw.map((o) => o['observationId'])).toEqual(observations.map((o) => o.observationId));
    // And serialize(parsed) is byte-identical to the original serialization.
    expect(serializeEvidenceRecord(parsed.record)).toBe(text);
  });

  it('keeps unknown top-level additive fields on round trips (value level)', () => {
    const record = buildRecord();
    const obj = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    obj['futureField'] = { nested: [1, 2, 3] };
    const res = parseEvidenceRecord(obj);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const out = JSON.parse(serializeEvidenceRecord(res.record)) as Record<string, unknown>;
    expect(out['futureField']).toEqual({ nested: [1, 2, 3] });
  });
});

describe('collision processing (§4.4)', () => {
  it('collapses an exact replay group without a representative and without a gap', () => {
    const base = minimalObservations();
    const replay = [
      ...base.slice(0, 3),
      { ...base[2]!, observationId: 'o2-replay-a', rawCapturedAt: T2 },
      { ...base[2]!, observationId: 'o2-replay-b', rawCapturedAt: T2 },
      ...base.slice(3),
    ];
    const record = buildRecord(replay);
    expect(record.trace.events).toHaveLength(6);
    expect(record.analysis.duplicateObservations).toHaveLength(1);
    const dup = record.analysis.duplicateObservations[0]!;
    expect(dup.classification).toBe('exact_replay');
    if (dup.classification === 'exact_replay') {
      expect(dup.eventId).toBe(base[2]!.eventId);
      expect(dup.seq).toBe(2);
      expect([...dup.observationIds].sort()).toEqual(['o2', 'o2-replay-a', 'o2-replay-b'].sort());      expect(dup.canonicalContentDigest?.algorithm).toBe('sha256');
    }
    expect(record.completeness.seqGaps).toEqual([]);
    expect(record.completeness.duplicatesDetected).toEqual(['exact_replay:evt-req@2']);
    // Round trip preserves every replay copy.
    const { parsed } = serializeParse(record);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.record.rawObservations.map((o) => o.observationId)).toHaveLength(8);
    }
  });

  it('rejects a same-ID same-seq content conflict', () => {
    const base = minimalObservations();
    const conflicting = [
      ...base.slice(0, 3),
      {
        ...base[2]!,
        observationId: 'o2-conflict',
        payload: { requestEnvelope: { model: 'different-model', provider: 'anthropic', providerNativeFidelity: 'structurally_faithful' } },
      },
      ...base.slice(3),
    ] as EvidenceObservation[];
    const res = normalizeEvidenceRecord(conflicting, buildBoundary(), V, { captureProfile: PROFILE });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('same_id_same_seq_content_conflict');
  });

  it('rejects a different-ID same-seq collision', () => {
    const base = minimalObservations();
    const collision = [
      ...base.slice(0, 4),
      {
        ...base[3]!,
        observationId: 'o3-other',
        eventId: 'evt-req-2', // different id claims seq 3 alongside evt-resp
        kind: 'model_request' as EvidenceObservation['kind'],
        payload: { requestEnvelope: { model: 'claude-sonnet-4', provider: 'anthropic', providerNativeFidelity: 'structurally_faithful' } },
      },
      ...base.slice(4),
    ] as EvidenceObservation[];
    const res = normalizeEvidenceRecord(collision, buildBoundary(), V, { captureProfile: PROFILE });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('different_id_same_seq_collision');
  });

  it('resolves a same-ID different-seq conflict retaining the lowest seq with gap provenance', () => {
    const base = minimalObservations();
    // evt-req observed at seq 2 and again at seq 6 (before interaction_end).
    const moved = base[2]!;
    const higherSeq = {
      ...moved,
      observationId: 'o2-higher',
      seq: 6,
      capturedAt: T4,
      rawCapturedAt: T4,
    };
    const observations = [...base.slice(0, 3), ...base.slice(3, 5), higherSeq, base[5]!];
    const record = buildRecord(observations);
    // Retained: lowest seq (2). Discarded: seq 6 (gap).
    expect(record.trace.events.find((e) => e.eventId === 'evt-req')?.seq).toBe(2);
    const dup = record.analysis.duplicateObservations.find((d) => d.classification === 'same_id_different_seq');
    expect(dup).toBeDefined();
    if (dup && dup.classification === 'same_id_different_seq') {
      expect(dup.retainedPosition.seq).toBe(2);
      expect(dup.discardedPositions).toEqual([
        { seq: 6, observationIds: ['o2-higher'], positionIndependentlyRepresented: false },
      ]);
    }
    expect(record.completeness.seqGaps).toContainEqual({ startSeq: 6, endSeq: 7, adjacentRetainedEventIds: ['evt-interaction-end'] });
  });

  it('never renumbers retained events', () => {
    const base = minimalObservations();
    const observations = [
      base[0]!, base[1]!, base[2]!,
      { ...base[4]!, seq: 9 }, // span_end moved to seq 9
      { ...base[5]!, seq: 10 }, // interaction_end moved
    ];
    const record = buildRecord(observations);
    const seqs = record.trace.events.map((e) => e.seq);
    expect(seqs).toEqual([0, 1, 2, 9, 10]);
    expect(record.completeness.seqGaps).toContainEqual({ startSeq: 3, endSeq: 9, adjacentRetainedEventIds: ['evt-req', 'evt-span-end'] });
  });

  it('is invariant under permutation of the same identified observations', () => {
    const observations = minimalObservations();
    const shuffled = [...observations].reverse();
    const a = buildRecord(observations);
    const b = buildRecord(shuffled);
    expect(a.trace.events.map((e) => e.seq)).toEqual(b.trace.events.map((e) => e.seq));
    expect(a.completeness).toEqual(b.completeness);
    expect(a.analysis.sequenceGaps).toEqual(b.analysis.sequenceGaps);
  });
});

describe('normalizeEvidenceRecord', () => {
  it('rejects duplicate observation identities deterministically', () => {
    const base = minimalObservations();
    const dup = [{ ...base[0]! }, { ...base[0]!, observationId: 'o0-copy' }];
    // Two observations with the SAME observationId.
    const bad = [{ ...base[0]!, observationId: 'dup' }, { ...base[1]!, observationId: 'dup' }, ...base.slice(2)];
    const res = normalizeEvidenceRecord(bad, buildBoundary(), V, { captureProfile: PROFILE });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('duplicate_observation_id');
    void dup;
  });

  it('reports a documented gap as parseable incomplete evidence', () => {
    const base = minimalObservations();
    const observations = [base[0]!, base[1]!, base[2]!, { ...base[4]!, seq: 8 }, { ...base[5]!, seq: 9 }];
    const record = buildRecord(observations);
    expect(record.completeness.seqGaps.length).toBeGreaterThan(0);
    // A correctly documented incomplete trace remains parseable.
    const res = parseEvidenceRecord(record as unknown);
    expect(res.ok).toBe(true);
  });
});

describe('normalized export', () => {
  it('declares omitted raw observations and reduced verification boundary', () => {
    const record = buildRecord();
    const text = serializeEvidenceExport(
      record.trace,
      record.analysis,
      record.completeness,
      record.captureBoundary,
    );
    const doc = JSON.parse(text) as Record<string, unknown>;
    expect(doc['rawObservationsOmitted']).toBe(true);
    expect(doc['verificationBoundary']).toBe('reduced');
    expect(doc['duplicateAnalysis']).toBe('reported-derived');
    expect(String(doc['statement'])).toContain('not the authoritative evidence record');
    expect(doc['rawObservations']).toBeUndefined();
  });
});

describe('version', () => {
  it('refuses invalid version syntax', () => {
    const res = normalizeEvidenceRecord(minimalObservations(), buildBoundary(), 'not-semver', {
      captureProfile: PROFILE,
    });
    expect(res.ok).toBe(false);
  });
});

void obs;
void T0;
void T1;