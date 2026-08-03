/**
 * Version support policy (Spec 014 §3.3, §5.3; `docs/model-versioning.md`).
 * Compatible additive minor/patch revisions within a supported MAJOR are
 * accepted; unknown or breaking MAJOR versions are refused with a structured
 * error. Internal helper + public constants.
 */
import { isSemanticVersion, majorVersion } from './internal/formats.js';

/** The exact evidence-schema version this package implements (§2.2.12). */
export const SUPPORTED_EVIDENCE_SCHEMA_VERSION = '1.0.0';

/** The MAJOR version supported by this package. */
export const SUPPORTED_MAJOR = 1;

/** Deterministic normalization algorithm version (collision rules §4.4). */
export const NORMALIZATION_ALGORITHM_VERSION = '1.0.0';

/** Completeness derivation algorithm version (§2.2.9). */
export const COMPLETENESS_DERIVATION_ALGORITHM_VERSION = '1.0.0';

/** Projection algorithm version for canonical-content digests (§5.2). */
export const CANONICAL_EVENT_PROJECTION_ALGORITHM_VERSION = '1.0.0';

/** Accepts the exact supported version or an additive minor/patch revision
 * within the supported MAJOR. */
export function isSupportedEvidenceSchemaVersion(value: unknown): value is string {
  if (!isSemanticVersion(value)) return false;
  return majorVersion(value) === SUPPORTED_MAJOR;
}

export type VersionCheck =
  | { ok: true; version: string }
  | { ok: false; reason: 'invalid_syntax' | 'unsupported_major' };

/** Returns whether a version is acceptable, plus a structured refusal
 * reason. A compatible additive revision within the supported MAJOR (e.g.
 * `1.1.0`) is accepted with the supported MAJOR of the caller. */
export function checkEvidenceSchemaVersion(version: unknown): VersionCheck {
  if (typeof version !== 'string' || !isSemanticVersion(version)) {
    return { ok: false, reason: 'invalid_syntax' };
  }
  if (majorVersion(version) !== SUPPORTED_MAJOR) {
    return { ok: false, reason: 'unsupported_major' };
  }
  return { ok: true, version };
}
