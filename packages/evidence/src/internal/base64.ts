/**
 * Canonical Base64 encoding per RFC 4648 §4 (Spec 014 §5.7). Standard
 * alphabet, contiguous output with no whitespace/line breaks, and exactly the
 * canonical number of '=' padding characters (zero, one, or two) required for
 * the encoded length. Internal-only: correctness is delegated to strict
 * decode-and-re-encode equivalence.
 */

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Position lookup for strict decoding; -1 = not a standard-alphabet char. */
const DECODE_TABLE = new Int8Array(257);
for (let i = 0; i < DECODE_TABLE.length; i++) DECODE_TABLE[i] = -1;
for (let i = 0; i < ALPHABET.length; i++) DECODE_TABLE[ALPHABET.charCodeAt(i)] = i;

/** RFC 4648 §4 encoder. */
export function base64Encode(bytes: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1]!;
    const b2 = bytes[i + 2]!;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out.push(
      ALPHABET[(n >> 18) & 63]!,
      ALPHABET[(n >> 12) & 63]!,
      ALPHABET[(n >> 6) & 63]!,
      ALPHABET[n & 63]!,
    );
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const b0 = bytes[i]!;
    out.push(ALPHABET[(b0 >> 2) & 63]!, ALPHABET[(b0 << 4) & 63]!, "=", "=");
  } else if (rem === 2) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1]!;
    out.push(
      ALPHABET[(b0 >> 2) & 63]!,
      ALPHABET[((b0 << 4) | (b1 >> 4)) & 63]!,
      ALPHABET[(b1 << 2) & 63]!,
      "=",
    );
  }
  return out.join("");
}

/**
 * Strict canonical decoder (RFC 4648 §4). Returns the decoded bytes, or
 * `null` when the input is non-canonical (wrong alphabet, URL-safe characters,
 * embedded whitespace/line breaks, omitted required padding, superfluous or
 * malformed padding).
 */
export function base64Decode(input: string): Uint8Array | null {
  if (input.length === 0) return new Uint8Array(0);
  if (input.length % 4 !== 0) return null;

  // Count (only) trailing '=' padding characters.
  let pad = 0;
  for (let k = input.length - 1; k >= 0 && input.codePointAt(k) === 0x3d; k--) pad++;
  if (pad > 2) return null;

  const dataLen = input.length * 3 / 4;
  const out = new Uint8Array(dataLen);
  let o = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.codePointAt(i) ?? -1;
    if (c === 0x3d /* '=' */) {
      // '=' may only appear in the final padding positions.
      if (i < input.length - pad) return null;
      continue;
    }
    if (c > 256) return null;
    const v = DECODE_TABLE[c]!;
    if (v < 0) return null; // includes '-', '_', whitespace, all others
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  // RFC 4648 §3.5: the bits covered by the padding must be exactly the
  // leftover bits and they must all be zero (canonical values only).
  const leftover = pad * 2;
  if (bits !== leftover) return null;
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) return null;
  // Padding count must equal the canonical count for the decoded byte length.
  const expectedPad = o === 0 ? 0 : (3 - (o % 3)) % 3;
  if (pad !== expectedPad) return null;
  return out.subarray(0, o);
}

/** Canonical iff decode-and-re-encode reproduces the input exactly. */
export function isCanonicalBase64(input: string): boolean {
  const decoded = base64Decode(input);
  if (decoded === null) return false;
  return base64Encode(decoded) === input;
}