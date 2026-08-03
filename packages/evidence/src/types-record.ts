/**
 * Authoritative evidence record, capture boundary, completeness, and parse
 * result types (Spec 014 §2.2.9–§2.2.11, §5.2).
 */
import type {
  CaptureSurface,
  EvidenceStatus,
  ObservationRole,
} from './vocabulary.js';
import type { SemanticVersion } from './types-base.js';
import type { MissingDeclaration } from './types-base.js';
import type { EvidenceTrace, EvidenceObservation } from './types-trace.js';
import type { EvidenceStructuralAnalysis, SequenceGap, ValidationIssue } from './types-analysis.js';

/** Declared boundary and capture-surface declarations for completeness. */
export type CaptureBoundary = {
  captureSurface: CaptureSurface;
  observationBoundary: ObservationRole;
  declaredEventKinds: readonly string[];
  declaredSurfaces: readonly CaptureSurface[];
  missingRecord: MissingDeclaration | null;
};

/**
 * Derived completeness record (Spec 014 §2.2.9; Spec 013 §4.3). Serialized
 * exactly once at `EvidenceRecord.completeness`, never on `EvidenceTrace`.
 * Derived, not recorded evidence.
 */
export type TraceCompleteness = {
  eventsByStatus: Record<EvidenceStatus, number>;
  seqGaps: readonly SequenceGap[];
  duplicatesDetected: readonly string[];
  boundaryStatement: string;
};

/**
 * The single authoritative serialized evidence record. `rawObservations` is
 * authoritative captured evidence; `trace`, `analysis`, and `completeness` are
 * deterministic derivations.
 */
export type EvidenceRecord = {
  rawObservations: readonly EvidenceObservation[];
  trace: EvidenceTrace;
  analysis: EvidenceStructuralAnalysis;
  completeness: TraceCompleteness;
  evidenceSchemaVersion: string;
  captureBoundary: CaptureBoundary;
};

/**
 * Parse-result union — the single success/failure contract of this package
 * (Spec 014 §5.2). No nested result wrappers. `ok:false` yields structured
 * issues and never a `record`; validators never throw for malformed input.
 */
export type EvidenceRecordParseResult =
  | { ok: true; record: EvidenceRecord }
  | { ok: false; issues: readonly ValidationIssue[] };
