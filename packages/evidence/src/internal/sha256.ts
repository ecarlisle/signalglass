/**
 * Dependency-free SHA-256 (FIPS 180-4) operating on byte arrays. Used for
 * `sha256:` hashes and the RFC 8785 (JCS) canonical-content digest. The
 * package must work in Node and browsers with no runtime dependencies, so
 * this is a self-contained implementation rather than `node:crypto` or a
 * WebCrypto import. Internal-only.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
]);

/** SHA-256 of the given byte sequence as a 64-char lowercase hex digest. */
export function sha256Hex(bytes: Uint8Array): string {
  const len = bytes.length;
  const bitLenHi = Math.floor(len / 0x20000000); // len * 8 as 64-bit split
  const bitLenLo = len * 8;

  // Message schedule padding: 0x80, zeros, then 64-bit big-endian length.
  const paddedLen = Math.ceil((len + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLen - 8, bitLenHi);
  dv.setUint32(paddedLen - 4, bitLenLo);

  const h = H0.slice();
  const w = new Uint32Array(64);

  for (let block = 0; block < paddedLen; block += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getUint32(block + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        ((w[i - 15]! >>> 7) | (w[i - 15]! << 25)) ^
        ((w[i - 15]! >>> 18) | (w[i - 15]! << 14)) ^
        (w[i - 15]! >>> 3);
      const s1 =
        ((w[i - 2]! >>> 17) | (w[i - 2]! << 15)) ^
        ((w[i - 2]! >>> 19) | (w[i - 2]! << 13)) ^
        (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;

    for (let i = 0; i < 64; i++) {
      const S1 =
        ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^
        ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 =
        ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^
        ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }

  let out = "";
  for (let i = 0; i < 8; i++) out += h[i]!.toString(16).padStart(8, "0");
  return out;
}

/** UTF-8 encode without relying on TextEncoder availability differences.
 * Lone surrogates (unpaired UTF-16 code units) are replaced with U+FFFD,
 * matching the WHATWG Encoding Standard so byte output is always well-formed
 * UTF-8 and consistent with platform TextEncoder behavior. */
export function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let cp = text.codePointAt(i) ?? 0;
    if (cp > 0xffff) {
      i++; // valid surrogate pair consumed by codePointAt
    } else if (cp >= 0xd800 && cp <= 0xdfff) {
      cp = 0xfffd; // lone surrogate -> U+FFFD (WHATWG replacement)
    }
    if (cp <= 0x7f) bytes.push(cp);
    else if (cp <= 0x7ff) {
      bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp <= 0xffff) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

/** Convenience: SHA-256 of a UTF-8 string as `sha256:<hex>` value. */
export function sha256Value(text: string): string {
  return `sha256:${sha256Hex(utf8Encode(text))}`;
}
