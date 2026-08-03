/**
 * Tests: unknown additive fields survive parse/serialize round trips at
 * equivalent JSON values and structural paths (Spec 014 §5.3, criterion 5),
 * while never influencing ordering, collision resolution, status,
 * completeness, hashing, or provenance, and never being accepted in place of
 * malformed owned fields.
 */
import { describe, expect, it } from 'vitest';
import { parseEvidenceRecord } from './validate.js';
import { serializeEvidenceRecord } from './serialize.js';
import { minimalObservations, buildRecord, obs, T0, T2, T4 } from './fixtures.js';
import type { EvidenceObservation } from './types-trace.js';
import type { EvidenceRecord } from './types-record.js';

/** Record with a same-ID/different-seq duplicate and an unoccupied discarded
 * position (gap), so analysis carries nested duplicate and gap records. */
function duplicateRecord(): EvidenceRecord {
  const base = minimalObservations();
  const higherSeq = { ...base[2]!, observationId: 'o2-higher', seq: 6, capturedAt: T4, rawCapturedAt: T4 };
  return buildRecord([...base.slice(0, 3), ...base.slice(3, 5), higherSeq, base[5]!]);
}

/** Record with an exact replay (canonicalContentDigest present). */
function replayRecord(): EvidenceRecord {
  const base = minimalObservations();
  return buildRecord([...base.slice(0, 3), { ...base[2]!, observationId: 'o2-replay' }, ...base.slice(3)]);
}

/** Record whose model_request observation payload carries an unknown additive
 * field that the canonical event projection must retain. */
function payloadUnknownRecord(): EvidenceRecord {
  const base = minimalObservations();
  const req = base[2]!;
  const withExtra = {
    ...req,
    payload: { ...(req.payload as Record<string, unknown>), promptNote: 'hello-world' },
  } as EvidenceObservation;
  return buildRecord([...base.slice(0, 2), withExtra, ...base.slice(3)]);
}

function jsonOf(record: EvidenceRecord): Record<string, unknown> {
  return JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
}

function parseOk(json: Record<string, unknown>): EvidenceRecord {
  const res = parseEvidenceRecord(json);
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error('expected ok');
  return res.record;
}

function reparse(text: string): EvidenceRecord {
  return parseOk(JSON.parse(text) as Record<string, unknown>);
}

/** Read an unknown additive field off a typed record via the JSON view. */
function extra<T>(value: unknown, key: string): T {
  return (value as Record<string, unknown>)[key] as T;
}

describe('unknown additive fields at equivalent structural paths (§5.3)', () => {
  it('preserves unknowns on record root, trace root, span, event, analysis (root + nested), completeness, and raw observations', () => {
    const record = duplicateRecord();
    const json = jsonOf(record);

    // Inject unknown additive fields at every required structural path.
    json['futureRoot'] = { note: 'record-root' };
    const trace = json['trace'] as Record<string, unknown>;
    trace['futureTrace'] = ['a', 'b'];
    (trace['spans'] as Record<string, unknown>[])[0]['futureSpan'] = { depth: 1 };
    (trace['events'] as Record<string, unknown>[])[2]['futureEvent'] = 'evt-extra';
    const analysis = json['analysis'] as Record<string, unknown>;
    analysis['futureAnalysis'] = { x: 1 };
    (analysis['duplicateObservations'] as Record<string, unknown>[])[0]['futureDup'] = 'dup-extra';
    (analysis['sequenceGaps'] as Record<string, unknown>[])[0]['futureGap'] = true;
    (json['completeness'] as Record<string, unknown>)['futureCompleteness'] = 'comp-extra';
    ((json['rawObservations'] as Record<string, unknown>[])[0])['futureObs'] = { n: 0 };

    const parsed = parseOk(json);

    // Values survive at the same paths.
    expect(extra(parsed, 'futureRoot')).toEqual({ note: 'record-root' });
    expect(extra(parsed.trace, 'futureTrace')).toEqual(['a', 'b']);
    expect(extra(parsed.trace.spans[0], 'futureSpan')).toEqual({ depth: 1 });
    expect(extra(parsed.trace.events[2], 'futureEvent')).toBe('evt-extra');
    expect(extra(parsed.analysis, 'futureAnalysis')).toEqual({ x: 1 });
    expect(extra(parsed.analysis.duplicateObservations[0], 'futureDup')).toBe('dup-extra');
    expect(extra(parsed.analysis.sequenceGaps[0], 'futureGap')).toBe(true);
    expect(extra(parsed.completeness, 'futureCompleteness')).toBe('comp-extra');
    expect(extra(parsed.rawObservations[0], 'futureObs')).toEqual({ n: 0 });

    // parse -> serialize -> parse retains equivalent values and paths.
    const again = reparse(serializeEvidenceRecord(parsed));
    expect(extra(again, 'futureRoot')).toEqual({ note: 'record-root' });
    expect(extra(again.trace, 'futureTrace')).toEqual(['a', 'b']);
    expect(extra(again.trace.spans[0], 'futureSpan')).toEqual({ depth: 1 });
    expect(extra(again.trace.events[2], 'futureEvent')).toBe('evt-extra');
    expect(extra(again.analysis, 'futureAnalysis')).toEqual({ x: 1 });
    expect(extra(again.analysis.duplicateObservations[0], 'futureDup')).toBe('dup-extra');
    expect(extra(again.analysis.sequenceGaps[0], 'futureGap')).toBe(true);
    expect(extra(again.completeness, 'futureCompleteness')).toBe('comp-extra');
    expect(extra(again.rawObservations[0], 'futureObs')).toEqual({ n: 0 });
  });

  it('preserves unknown additive fields on canonical event payloads (projected from observations)', () => {
    const record = payloadUnknownRecord();
    const json = jsonOf(record);
    // The observation-level unknown already projected onto the event.
    const evt = (json['trace'] as Record<string, unknown>)['events'] as Record<string, unknown>[];
    const reqEvt = evt.find((e) => e['kind'] === 'model_request') as Record<string, unknown>;
        expect(reqEvt['promptNote']).toBe('hello-world');
    const parsed = parseOk(json);
    expect(extra(parsed.trace.events.find((e) => e.kind === 'model_request'), 'promptNote')).toBe('hello-world');
    const again = reparse(serializeEvidenceRecord(parsed));
    expect(extra(again.trace.events.find((e) => e.kind === 'model_request'), 'promptNote')).toBe('hello-world');
  });

  it('unknown fields never influence status, ordering, provenance, hashing, or completeness', () => {
    const clean = duplicateRecord();
    const json = jsonOf(clean);
    (json['trace'] as Record<string, unknown>)['future'] = 1;
    ((json['trace'] as Record<string, unknown>)['spans'] as Record<string, unknown>[])[0]['future'] = 2;
    ((json['trace'] as Record<string, unknown>)['events'] as Record<string, unknown>[])[0]['future'] = 3;
    ((json['analysis'] as Record<string, unknown>)['duplicateObservations'] as Record<string, unknown>[])[0]['future'] = 4;
    (json['completeness'] as Record<string, unknown>)['future'] = 5;

    const parsed = parseOk(json);
    // Derived facts recomputed from observations alone are unchanged.
    expect(parsed.trace.status).toBe(clean.trace.status);
    expect(parsed.trace.events.map((e) => e.seq)).toEqual(clean.trace.events.map((e) => e.seq));
    expect(parsed.trace.spans.map((s) => s.spanId)).toEqual(clean.trace.spans.map((s) => s.spanId));
    expect(parsed.completeness.eventsByStatus).toEqual(clean.completeness.eventsByStatus);
    expect(parsed.completeness.seqGaps).toEqual(clean.completeness.seqGaps);
    expect(parsed.completeness.boundaryStatement).toBe(clean.completeness.boundaryStatement);
    const dup = parsed.analysis.duplicateObservations[0]!;
    const cleanDup = clean.analysis.duplicateObservations[0]!;
    expect(dup.classification).toBe(cleanDup.classification);
    if (dup.classification === 'same_id_different_seq' && cleanDup.classification === 'same_id_different_seq') {
      expect(dup.retainedPosition.seq).toBe(cleanDup.retainedPosition.seq);
      expect(dup.discardedPositions).toEqual(cleanDup.discardedPositions);
    }
  });

  it('exact-replay canonicalContentDigest stays the derived digest despite unknown fields', () => {
    const clean = replayRecord();
    const json = jsonOf(clean);
    const dups = (json['analysis'] as Record<string, unknown>)['duplicateObservations'] as Record<string, unknown>[];
    const exact = dups.find((d) => d['classification'] === 'exact_replay') as Record<string, unknown>;
    expect(exact).toBeDefined();
    exact['futureDup'] = 'x';
    const parsed = parseOk(json);
    const pExact = parsed.analysis.duplicateObservations.find((d) => d.classification === 'exact_replay');
    expect(pExact).toBeDefined();
    if (pExact?.classification === 'exact_replay') {
      const cExact = clean.analysis.duplicateObservations.find((d) => d.classification === 'exact_replay');
      expect(pExact.canonicalContentDigest).toEqual(cExact?.canonicalContentDigest);
      expect(pExact.observationIds).toEqual(cExact?.observationIds);
    }
  });

  it('preserves unknowns inside retainedPosition/discardedPositions of duplicate provenance', () => {
    const record = duplicateRecord();
    const json = jsonOf(record);
    const dups = (json['analysis'] as Record<string, unknown>)['duplicateObservations'] as Record<string, unknown>[];
    const dup = dups.find((d) => d['classification'] === 'same_id_different_seq') as Record<string, unknown>;
    (dup['retainedPosition'] as Record<string, unknown>)['futurePos'] = 'pos';
    (dup['discardedPositions'] as Record<string, unknown>[])[0]['futureDiscarded'] = 'disc';
    const parsed = parseOk(json);
    const pDup = parsed.analysis.duplicateObservations.find((d) => d.classification === 'same_id_different_seq');
    expect(pDup).toBeDefined();
    if (pDup?.classification === 'same_id_different_seq') {
      expect(extra(pDup.retainedPosition, 'futurePos')).toBe('pos');
      expect(extra(pDup.discardedPositions[0], 'futureDiscarded')).toBe('disc');
    }
  });
});

describe('unknown-field boundary enforcement', () => {
  it('never preserves prototype keys on the record root or trace root', () => {
    const record = duplicateRecord();
    const json = jsonOf(record);
    const trace = json['trace'] as Record<string, unknown>;
    const polluted: Record<string, unknown> = { polluted: true };
    Object.defineProperty(json, '__proto__', { value: polluted, enumerable: true });
    Object.defineProperty(trace, '__proto__', { value: polluted, enumerable: true });
    trace['constructor'] = { bad: 1 };
    json['prototype'] = { bad: 2 };

    const parsed = parseOk(json);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(parsed.trace)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(parsed, 'polluted')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed.trace, 'polluted')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed.trace, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed, 'prototype')).toBe(false);
    // The polluted value must not appear anywhere after round trip.
    const again = reparse(serializeEvidenceRecord(parsed));
    expect(JSON.stringify(again)).not.toContain('polluted');
  });

  it('malformed owned fields still reject even when unknown fields are present', () => {
    const record = duplicateRecord();
    const json = jsonOf(record);
    (json['trace'] as Record<string, unknown>)['future'] = 1;

    // Malformed known field on a span -> reject.
    const badSpan = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    ((badSpan['trace'] as Record<string, unknown>)['spans'] as Record<string, unknown>[])[0]['status'] = 'awesome';
    (badSpan['trace'] as Record<string, unknown>)['future'] = 1;
    const res1 = parseEvidenceRecord(badSpan);
    expect(res1.ok).toBe(false);

    // Incorrect completeness counts -> reject.
    const badComp = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    ((badComp['completeness'] as Record<string, unknown>)['eventsByStatus']) = { captured: 99 };
    (badComp['completeness'] as Record<string, unknown>)['future'] = 1;
    const res2 = parseEvidenceRecord(badComp);
    expect(res2.ok).toBe(false);

    // Unknown event discriminant -> reject (unknown discriminant refusal).
    const badKind = JSON.parse(serializeEvidenceRecord(record)) as Record<string, unknown>;
    ((badKind['trace'] as Record<string, unknown>)['events'] as Record<string, unknown>[])[0]['kind'] = 'teleport';
    const res3 = parseEvidenceRecord(badKind);
    expect(res3.ok).toBe(false);
  });

  it('a malformed known field is never silently filtered as an unknown addition', () => {
    const record = duplicateRecord();
    const json = jsonOf(record);
    const trace = json['trace'] as Record<string, unknown>;
    trace['status'] = 'completed';
    // Actually tamper: the record is completed; flip to failed with a fake
    // finishedAt — this must reject, not be dropped as "unknown".
    trace['status'] = 'failed';
    trace['finishedAt'] = T4;
    const res = parseEvidenceRecord(json);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('trace_disagrees_with_derivation');
  });
});

// ---------------------------------------------------------------------------
// Additive-field hardening: recursive unsafe-key exclusion and semantic
// (order-independent) alignment for gaps, matching the agreement contract.
// ---------------------------------------------------------------------------

/** Record whose retained events sit at seqs 0, 2, 4, so interior positions 1
 * and 3 form two distinct gap runs: [1,2) and [3,4). */
function twoGapRecord(): EvidenceRecord {
  return buildRecord([
    obs({
      observationId: 'g0', eventId: 'evt-start', seq: 0,
      kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0,
    }),
    obs({
      observationId: 'g1', eventId: 'evt-req', seq: 2,
      kind: 'model_request', capturedAt: T2, rawCapturedAt: T2,
      observationRole: 'client_sent',
      payload: {
        requestEnvelope: {
          model: 'm', provider: 'p', providerNativeFidelity: 'structurally_faithful',
          messages: [{ role: 'user', content: 'x' }],
          providerNative: {},
        },
      },
    }),
    obs({
      observationId: 'g2', eventId: 'evt-end', seq: 4,
      kind: 'interaction_end', capturedAt: T4, rawCapturedAt: T4,
    }),
  ]);
}

describe('recursive unsafe-key exclusion in additive preservation', () => {
  it('excludes __proto__, constructor, and prototype at every nesting depth of an unknown additive object', () => {
    const record = duplicateRecord();
    const json = jsonOf(record);
    const evil: Record<string, unknown> = { harmless: 1, nested: { deep: { keep: true } } };
    Object.defineProperty(evil, '__proto__', { value: { polluted: 1 }, enumerable: true });
    Object.defineProperty(evil['nested'] as Record<string, unknown>, '__proto__', { value: { deepPolluted: 1 }, enumerable: true });
    evil['constructor'] = { x: 1 };
    (evil['nested'] as Record<string, unknown>)['prototype'] = { y: 1 };
    json['futureRoot'] = evil;

    const parsed = parseOk(json);
    const v = extra<Record<string, unknown>>(parsed, 'futureRoot');
    // Valid content survives; unsafe keys do not, at any depth.
    expect(v['harmless']).toBe(1);
    expect((v['nested'] as Record<string, unknown>)['deep']).toEqual({ keep: true });
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(v['nested'])).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(v, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(v['nested'], 'prototype')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(v['nested'], 'deepPolluted')).toBe(false);

    // Neither parsing nor serialization leaves any unsafe key behind.
    const out = JSON.stringify(JSON.parse(serializeEvidenceRecord(parsed)));
    expect(out).not.toContain('deepPolluted');
    expect(out).not.toContain('polluted');
    expect(out).not.toContain('"constructor"');
    expect(out).not.toContain('"prototype"');
  });
});

describe('semantic identity alignment of gaps', () => {
  it('keeps unknown fields attached to the equivalent gap when the serialized analysis reorders gaps', () => {
    const record = twoGapRecord();
    expect(record.analysis.sequenceGaps).toHaveLength(2);
    const json = jsonOf(record);
    const analysis = json['analysis'] as Record<string, unknown>;
    const gaps = analysis['sequenceGaps'] as Record<string, unknown>[];
    expect(gaps.map((g) => `${g['startSeq']}-${g['endSeq']}`)).toEqual(['1-2', '3-4']);
    // Attach distinct unknown fields to each gap, then reorder the array.
    gaps[0]!['origin'] = 'first-gap'; // [1,2)
    gaps[1]!['origin'] = 'second-gap'; // [3,4)
    analysis['sequenceGaps'] = [gaps[1], gaps[0]];

    const parsed = parseOk(json);
    const g1 = parsed.analysis.sequenceGaps.find((g) => g.startSeq === 1 && g.endSeq === 2);
    const g2 = parsed.analysis.sequenceGaps.find((g) => g.startSeq === 3 && g.endSeq === 4);
    expect(extra(g1, 'origin')).toBe('first-gap');
    expect(extra(g2, 'origin')).toBe('second-gap');

    const again = reparse(serializeEvidenceRecord(parsed));
    expect(extra(again.analysis.sequenceGaps.find((g) => g.startSeq === 1 && g.endSeq === 2), 'origin')).toBe('first-gap');
    expect(extra(again.analysis.sequenceGaps.find((g) => g.startSeq === 3 && g.endSeq === 4), 'origin')).toBe('second-gap');
    // Canonical (derived) order is restored, not the reordered serialized order.
    expect(again.analysis.sequenceGaps.map((g) => g.startSeq)).toEqual([1, 3]);
  });

  it('rejects a reordered serialized completeness.seqGaps (order is contractually required)', () => {
    const record = twoGapRecord();
    const json = jsonOf(record);
    const comp = json['completeness'] as Record<string, unknown>;
    const gaps = comp['seqGaps'] as Record<string, unknown>[];
    comp['seqGaps'] = [gaps[1]!, gaps[0]!];
    const res = parseEvidenceRecord(json);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('completeness_disagrees_with_derivation');
  });
});
