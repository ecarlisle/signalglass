/**
 * Context artifact and provenance types (Spec 014 §2.2.6–§2.2.7; Spec 013
 * §6.1–§6.2). The hashing path is selected from the artifact's OWN fields
 * (`contentFidelity` + `contentType` + `contentCanonicalizer`), never from an
 * enclosing event or envelope.
 */
import type { ArtifactKind, EvidenceStatus } from './vocabulary.js';
import type { ArtifactId, ContentHash, ContentType, SemanticVersion, TraceId } from './types-base.js';

/**
 * Context artifact (Spec 013 §6.1). `evidenceStatus` lives at the top level,
 * never inside `payloadRef`. `contentHash` and `contentHashUnavailableReason`
 * are mutually exclusive and top-level; `contentHash` never implies possession
 * of discarded originals.
 */
export type ContextArtifact = {
  artifactId: ArtifactId;
  kind: ArtifactKind;
  evidenceStatus: EvidenceStatus;
  /** Payload-reference fields only. */
  payloadRef?: unknown;
  /** Fidelity describes the retained representation only. */
  contentFidelity?: 'byte_faithful' | 'structurally_faithful';
  contentType?: ContentType;
  contentHash?: ContentHash;
  contentCanonicalizer?: { name: string; version: string };
  contentHashUnavailableReason?: 'unsupported_canonicalizer';
  provenance?: unknown;
  /** Standalone artifacts MUST serialize these explicitly. */
  traceId?: TraceId;
  evidenceSchemaVersion?: SemanticVersion;
};