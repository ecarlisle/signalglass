/**
 * Public deterministic-helper facade for RFC 4648 §4 canonical Base64
 * (Spec 014 §1.2, §5.7). The implementation lives in
 * `src/internal/base64.ts`; this module is the public contract surface so
 * `src/internal/` is never directly re-exported from the package entry
 * (§1.3).
 */
export { base64Encode, base64Decode, isCanonicalBase64 } from './internal/base64.js';
