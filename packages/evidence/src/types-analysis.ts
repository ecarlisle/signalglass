/**
 * Structural analysis types (Spec 014 §5.2). These summarize duplicate
 * observations and sequence gaps derived from `rawObservations` and `trace`.
 * Every `observationIds` collection is semantically set-like: order carries no
 * precedence and permutation does not change semantic equality.
 */
import type { ContentHash } from './types-base.js';

export type ObservationId = string;
export type ObservationIdentitySet = readonly ObservationId[];

/** A sequence position with every stable observation identity observed there. */
export type ObservationPosition = {
  seq: number;
  observationIds: ObservationIdentitySet;
};

/** Optional SHA-256 digest over the RFC 8785 (JCS) canonical bytes of
 * `projectCanonicalEvent`. Never used for ordering, precedence, or winner
 * selection. */
export type CanonicalEventDigest = {
  algorithm: 'sha256';
  projectionAlgorithmVersion: string;
  canonicalization: 'rfc8785-jcs-utf8';
  value: ContentHash;
};

/** A discarded higher-seq position for a same-ID/different-seq group. */
export type DiscardedPosition = {
  seq: number;
  observationIds: ObservationIdentitySet;
  /** True when another independently valid retained event occupies the seq. */
  positionIndependentlyRepresented: boolean;
};

/** Duplicate observation provenance (discriminated union, §4.4). */
export type DuplicateObservation =
  | {
      classification: 'exact_replay';
      eventId: string;
      seq: number;
      observationIds: ObservationIdentitySet;
      canonicalContentDigest?: CanonicalEventDigest;
      normalizationAlgorithmVersion: string;
    }
  | {
      classification: 'same_id_different_seq';
      eventId: string;
      retainedPosition: ObservationPosition;
      discardedPositions: readonly DiscardedPosition[];
      normalizationAlgorithmVersion: string;
    };

/** Sequence gap; `endSeq` exclusive, covering `[startSeq, endSeq)`. */
export type SequenceGap = {
  startSeq: number;
  endSeq: number;
  adjacentRetainedEventIds: readonly [string, string] | readonly [string] | readonly [];
};

/**
 * A structured validation problem with a stable machine-readable code, a JSON
 * path, and a human message. Messages never echo secrets or entire captured
 * payloads (Spec 014 §10).
 */
export type ValidationIssue = {
  code: string;
  path: string;
  message: string;
};

/** Deterministic structural analysis of the raw observations and trace. */
export type EvidenceStructuralAnalysis = {
  duplicateObservations: readonly DuplicateObservation[];
  sequenceGaps: readonly SequenceGap[];
  validationIssues: readonly ValidationIssue[];
  completenessDerivationAlgorithmVersion: string;
  version?: string;
};