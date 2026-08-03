/**
 * RFC 8785 (JCS) canonical JSON serialization (Spec 014 §4.5, §5.2). Used for
 * `structurally_faithful` JSON content hashes and the optional canonical-event
 * content digest. Internal-only; deterministic byte output for equivalent
 * JSON values.
 */
import { utf8Encode } from './sha256.js';

/** True when `value` is a JSON-safe value: no undefined, functions, symbols,
 * bigint, NaN/Infinity, dates, or class instances. */
export function isJsonSafe(value: unknown): boolean {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return true;
  if (Array.isArray(value)) return value.every(isJsonSafe);
  if (typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    for (const k of Object.keys(value)) if (!isJsonSafe((value as Record<string, unknown>)[k])) return false;
    return true;
  }
  return false;
}

function escapeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i) ?? 0;
    const c = s[i]!;
    if (cp > 0xffff) {
      // Valid surrogate pair: emit both UTF-16 units verbatim and skip the
      // low surrogate so it is never dropped or double-encoded.
      out += c + s[i + 1];
      i++;
      continue;
    }
    if (c === '"') out += '\\"';
    else if (c === "\\") out += "\\\\";
    else if (c === "\b") out += "\\b";
    else if (c === "\f") out += "\\f";
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
    else if (cp < 0x20 || (cp >= 0xd800 && cp <= 0xdfff)) {
      // Control characters and lone surrogates as \uXXXX.
      out += "\\u" + cp.toString(16).toUpperCase().padStart(4, "0");
    } else {
      out += c;
    }
  }
  return out + '"';
}

/** RFC 8785 canonical JSON. `value` MUST be JSON-safe; throws otherwise. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number is not JSON-safe");
    return String(value);
  }
  if (typeof value === "string") return escapeString(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalJson(v)).join(",") + "]";
  }
  if (typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new Error("class instances are not JSON-safe");
    }
    const keys = Object.keys(value).sort((a, b) => compareCodePoints(a, b));
    return (
      "{" +
      keys
        .map((k) => escapeString(k) + ":" + canonicalJson((value as Record<string, unknown>)[k]))
        .join(",") +
      "}"
    );
  }
  throw new Error(`value of type ${typeof value} is not JSON-safe`);
}

function compareCodePoints(a: string, b: string): number {
  const ap = Array.from(a);
  const bp = Array.from(b);
  const n = Math.min(ap.length, bp.length);
  for (let i = 0; i < n; i++) {
    const ca = ap[i]!.codePointAt(0)!;
    const cb = bp[i]!.codePointAt(0)!;
    if (ca !== cb) return ca - cb;
  }
  return ap.length - bp.length;
}

/** RFC 8785 canonical JSON as UTF-8 bytes. */
export function canonicalJsonBytes(value: unknown): Uint8Array {
  return utf8Encode(canonicalJson(value));
}
