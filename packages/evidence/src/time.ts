/**
 * Public deterministic-helper facade for ISO 8601 UTC millisecond timestamps
 * (Spec 014 §1.2, §4.2). The implementation lives in `src/internal/time.ts`;
 * this module is the public contract surface so `src/internal/` is never
 * directly re-exported from the package entry (§1.3).
 */
export { isTimestamp } from './internal/time.js';
