/**
 * Public deterministic-helper facade for RFC 8785 (JCS) canonical JSON
 * (Spec 014 §1.2, §4.5). The implementation lives in `src/internal/jcs.ts`;
 * this module is the public contract surface so `src/internal/` is never
 * directly re-exported from the package entry (§1.3).
 */
export { canonicalJson, isJsonSafe } from './internal/jcs.js';
