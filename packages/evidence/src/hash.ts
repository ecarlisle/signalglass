/**
 * Public deterministic-helper facade for SHA-256 and UTF-8 encoding
 * (Spec 014 §1.2, §4.5). The implementation lives in `src/internal/sha256.ts`;
 * this module is the public contract surface so `src/internal/` is never
 * directly re-exported from the package entry (§1.3).
 */
export { sha256Hex, sha256Value, utf8Encode } from './internal/sha256.js';
