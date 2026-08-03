/**
 * RFC 6838 media-type and content-hash format checks (Spec 014 §2.2.12,
 * §5.4). Internal-only; the exact rules enforced by the repository's existing
 * semantic validator are ported verbatim so the package validators agree.
 */

/** `sha256:` followed by exactly 64 lowercase hexadecimal characters. */
export const CONTENT_HASH_RE = /^sha256:[0-9a-f]{64}$/;

/**
 * RFC 6838 restricted-name syntax: one '/', each name 1-127 characters, first
 * character alphanumeric, remaining characters from `A-Za-z0-9!#$&^_.+-`.
 * Parameters, whitespace, wildcards, empty components, and additional slashes
 * are rejected.
 */
export const MEDIA_TYPE_RE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/;

export function isContentHash(value: unknown): value is string {
  return typeof value === 'string' && CONTENT_HASH_RE.test(value);
}

export function isContentType(value: unknown): value is string {
  return typeof value === 'string' && MEDIA_TYPE_RE.test(value);
}

/** True when the media type is JSON (`application/json` or any `+json` suffix). */
export function isJsonContentType(contentType: unknown): boolean {
  if (typeof contentType !== 'string') return false;
  const base = contentType.split(';')[0]!.trim().toLowerCase();
  return base === 'application/json' || base.endsWith('+json');
}

/**
 * Semantic-version string: `MAJOR.MINOR.PATCH` with optional pre-release and
 * build metadata (Spec 014 §3.3). The validator only needs to gate
 * major-version compatibility.
 */
export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

export function isSemanticVersion(value: unknown): value is string {
  return typeof value === 'string' && SEMVER_RE.test(value);
}

/** Major-version component of a semantic-version string, or `null`. */
export function majorVersion(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d+)\./);
  if (!m) return null;
  return Number(m[1]);
}