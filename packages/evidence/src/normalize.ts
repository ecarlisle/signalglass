/**
 * Deterministic observation normalization and collision processing (Spec 014
 * §4.4, §5.8). Applies the normative processing order to a batch of raw
 * observations and returns the retained canonical events, duplicate and gap
 * provenance, and structured issues — without mutating or reordering the raw
 * observations and without using array position, identifiers, timestamps, or
 * digests as tie-breakers.
 */
import type { EvidenceObservation } from './types-trace.js';
import type {
  DuplicateObservation,
  SequenceGap,
  ValidationIssue,
  ObservationPosition,
} from './types-analysis.js';
import {
  CANONICAL_EVENT_PROJECTION_ALGORITHM_VERSION,
  NORMALIZATION_ALGORITHM_VERSION,
} from './version.js';
import { jsonEqual } from './internal/guards.js';
import { utf8Encode, sha256Hex } from './internal/sha256.js';
import { canonicalJson } from './internal/jcs.js';
import { projectCanonicalEvent, type ProjectedEvent } from './project.js';

/** Sort strings by unsigned UTF-8 byte order (deterministic set canonicalization). */
export function sortUtf8(values: readonly string[]): string[] {
  return [...values].sort((a, b) => {
    const ab = utf8Encode(a);
    const bb = utf8Encode(b);
    const n = Math.min(ab.length, bb.length);
    for (let i = 0; i < n; i++) if (ab[i] !== bb[i]) return ab[i]! - bb[i]!;
    return ab.length - bb.length;
  });
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** RFC 4648 §4 encoder used for the digest view (local, no import cycle). */
function base64String(bytes: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out.push(B64[(n >> 18) & 63]!, B64[(n >> 12) & 63]!, B64[(n >> 6) & 63]!, B64[n & 63]!);
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i]!;
    out.push(B64[(n >> 2) & 63]!, B64[(n << 4) & 63]!, "=", "=");
  } else if (rem === 2) {
    const n = (bytes[i]! << 8) | bytes[i + 1]!;
    out.push(B64[(n >> 10) & 63]!, B64[(n >> 4) & 63]!, B64[(n << 2) & 63]!, "=");
  }
  return out.join("");
}

/** Recursively convert Uint8Array to its RFC 4648 §4 base64 (digest view). */
export function toJsonView(value: unknown): unknown {
  if (value instanceof Uint8Array) return base64String(value);
  if (Array.isArray(value)) return value.map(toJsonView);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) {
      out[k] = toJsonView((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** SHA-256 over the RFC 8785 (JCS) canonical bytes of the projected event. */
function digestOf(proj: ProjectedEvent): string {
  const safe = toJsonView(proj);
  return `sha256:${sha256Hex(utf8Encode(canonicalJson(safe)))}`;
}

type ExactGroup = {
  eventId: string;
  seq: number;
  obsIds: string[]; // sorted, unique
  proj: ProjectedEvent;
};

export type CollapseOutcome =
  | {
      ok: true;
      /** Retained canonical events, sorted by seq. */
      events: ProjectedEvent[];
      duplicateObservations: DuplicateObservation[];
      sequenceGaps: SequenceGap[];
    }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Applies the full §4.4 processing order to already-structurally-valid raw
 * observations. `pathPrefix` is used only in issue paths.
 */
export function collapseObservations(
  raw: readonly EvidenceObservation[],
  pathPrefix: string,
): CollapseOutcome {
  // Step: project every observation.
  const projected = raw.map((obs) => ({ obs, proj: projectCanonicalEvent(obs) }));

  // Group by (eventId, seq) — independent of raw array order.
  const groupsByKey = new Map<string, ExactGroup>();
  for (const { obs, proj } of projected) {
    const key = obs.eventId + "\u0000" + obs.seq;
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.obsIds.push(obs.observationId);
    } else {
      groupsByKey.set(key, { eventId: obs.eventId, seq: obs.seq, obsIds: [obs.observationId], proj });
    }
  }

  const issues: ValidationIssue[] = [];
  const exactGroups: ExactGroup[] = [];

  // Per (eventId, seq) position: exact replay or content conflict.
  for (const g of groupsByKey.values()) {
    const first = g.proj;
    let conflicting = false;
    for (const { obs, proj } of projected) {
      if (obs.eventId === g.eventId && obs.seq === g.seq && !jsonEqual(first, proj)) {
        conflicting = true;
        break;
      }
    }
    if (conflicting) {
      issues.push({
        code: "same_id_same_seq_content_conflict",
        path: `${pathPrefix}[eventId=${g.eventId},seq=${g.seq}]`,
        message:
          `observations for eventId '${g.eventId}' at seq ${g.seq} project to conflicting canonical events; ` +
          `rejecting without selecting a winner`,
      });
      continue;
    }
    exactGroups.push({
      eventId: g.eventId,
      seq: g.seq,
      obsIds: sortUtf8(g.obsIds),
      proj: first,
    });
  }
  if (issues.length > 0) return { ok: false, issues };

  // Per-eventId sequence positions (ascending).
  const idMap = new Map<string, Map<number, ExactGroup>>();
  for (const e of exactGroups) {
    let m = idMap.get(e.eventId);
    if (!m) {
      m = new Map();
      idMap.set(e.eventId, m);
    }
    m.set(e.seq, e);
  }

  // Resolve same-ID/different-seq: retain the lowest seq per eventId.
  const retainedCandidates: { eventId: string; seq: number; proj: ProjectedEvent; obsIds: string[] }[] = [];
  const sameIdDiscards: { eventId: string; retainedSeq: number; discarded: { seq: number; obsIds: string[] }[] }[] = [];
  for (const [eventId, seqMap] of idMap) {
    const seqs = [...seqMap.keys()].sort((a, b) => a - b);
    const lowest = seqs[0]!;
    const low = seqMap.get(lowest)!;
    retainedCandidates.push({ eventId, seq: lowest, proj: low.proj, obsIds: low.obsIds });
    if (seqs.length > 1) {
      sameIdDiscards.push({
        eventId,
        retainedSeq: lowest,
        discarded: seqs.slice(1).map((s) => ({ seq: s, obsIds: seqMap.get(s)!.obsIds })),
      });
    }
  }

  // Reject different-ID/same-seq collisions among remaining candidates.
  const finalBySeq = new Map<number, { eventId: string; proj: ProjectedEvent; obsIds: string[] }>();
  const collisionIssues: ValidationIssue[] = [];
  for (const cand of retainedCandidates) {
    const existing = finalBySeq.get(cand.seq);
    if (existing && existing.eventId !== cand.eventId) {
      collisionIssues.push({
        code: "different_id_same_seq_collision",
        path: `${pathPrefix}[seq=${cand.seq}]`,
        message: `events '${existing.eventId}' and '${cand.eventId}' both claim seq ${cand.seq}; rejecting (no tie-breaker)`,
      });
    } else if (!existing) {
      finalBySeq.set(cand.seq, cand);
    }
  }
  if (collisionIssues.length > 0) return { ok: false, issues: collisionIssues };

  // Deterministic retained event order and gap derivation. Gaps cover every
  // sequence position that is neither retained nor independently occupied —
  // interior missing positions AND unoccupied discarded positions (§4.4,
  // §5.7: an unoccupied discarded position is reported as a gap).
  const seqs = [...finalBySeq.keys()].sort((a, b) => a - b);
  const events: ProjectedEvent[] = [];
  const retainedById = new Map(seqs.map((s) => [s, finalBySeq.get(s)!]));
  const gapSet = new Set<number>();
  const maxRetained = seqs.length > 0 ? seqs[seqs.length - 1]! : -1;
  for (let s = 0; s <= maxRetained; s++) {
    if (!finalBySeq.has(s)) gapSet.add(s);
  }
  for (const d of sameIdDiscards) {
    for (const dp of d.discarded) {
      if (!finalBySeq.has(dp.seq)) gapSet.add(dp.seq);
    }
  }
  const sequenceGaps: SequenceGap[] = [];
  const gapList = [...gapSet].sort((a, b) => a - b);
  let runStart = -1;
  let prev = -1;
  for (const g of gapList) {
    if (runStart < 0) runStart = g;
    else if (g !== prev + 1) {
      emitGap(runStart, prev, seqs, retainedById, sequenceGaps);
      runStart = g;
    }
    prev = g;
  }
  if (runStart >= 0) emitGap(runStart, prev, seqs, retainedById, sequenceGaps);

  for (const s of seqs) {
    events.push(finalBySeq.get(s)!.proj);
  }

  const duplicateObservations: DuplicateObservation[] = [];

  // Exact-replay duplicates: groups with more than one participating identity.
  for (const e of exactGroups) {
    if (e.obsIds.length > 1) {
      duplicateObservations.push({
        classification: "exact_replay",
        eventId: e.eventId,
        seq: e.seq,
        observationIds: e.obsIds,
        canonicalContentDigest: {
          algorithm: "sha256",
          projectionAlgorithmVersion: CANONICAL_EVENT_PROJECTION_ALGORITHM_VERSION,
          canonicalization: "rfc8785-jcs-utf8",
          value: digestOf(e.proj),
        },
        normalizationAlgorithmVersion: NORMALIZATION_ALGORITHM_VERSION,
      });
    }
  }

  // Same-ID/different-seq duplicates with per-position provenance.
  for (const d of sameIdDiscards) {
    const retainedPosition: ObservationPosition = {
      seq: d.retainedSeq,
      observationIds: finalBySeq.get(d.retainedSeq)!.obsIds,
    };
    duplicateObservations.push({
      classification: "same_id_different_seq",
      eventId: d.eventId,
      retainedPosition,
      discardedPositions: d.discarded
        .map((dp) => ({
          seq: dp.seq,
          observationIds: dp.obsIds,
          positionIndependentlyRepresented: finalBySeq.has(dp.seq),
        }))
        .sort((a, b) => a.seq - b.seq),
      normalizationAlgorithmVersion: NORMALIZATION_ALGORITHM_VERSION,
    });
  }

  // Deterministic duplicate emission order: exact replays by seq, then
  // same-ID groups by retained seq.
  duplicateObservations.sort((a, b) => {
    const seqA = a.classification === "exact_replay" ? a.seq : a.retainedPosition.seq;
    const seqB = b.classification === "exact_replay" ? b.seq : b.retainedPosition.seq;
    if (seqA !== seqB) return seqA - seqB;
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });

  return { ok: true, events, duplicateObservations, sequenceGaps };
}

/** Emit a single gap run [start, endExclusive) with ordered adjacent ids. */
function emitGap(
  startSeq: number,
  endInclusive: number,
  retainedSeqs: readonly number[],
  retainedById: Map<number, { eventId: string; proj: ProjectedEvent; obsIds: string[] }>,
  out: SequenceGap[],
): void {
  const endSeq = endInclusive + 1;
  let prevId: string | null = null;
  for (const s of retainedSeqs) {
    if (s < startSeq) prevId = retainedById.get(s)!.eventId;
    if (s >= startSeq && s < endSeq) continue;
  }
  let nextId: string | null = null;
  for (const s of retainedSeqs) {
    if (s >= endSeq) {
      nextId = retainedById.get(s)!.eventId;
      break;
    }
  }
  const adjacent: [string, string] | [string] | [] =
    prevId !== null && nextId !== null
      ? [prevId, nextId]
      : prevId !== null
        ? [prevId]
        : [];
  out.push({ startSeq, endSeq, adjacentRetainedEventIds: adjacent });
}