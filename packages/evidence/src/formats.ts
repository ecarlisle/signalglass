/**
 * Public deterministic-helper facade for RFC 6838 media-type and content-hash
 * format checks (Spec 014 §1.2, §5.4). The implementation lives in
 * `src/internal/formats.ts`; this module is the public contract surface so
 * `src/internal/` is never directly re-exported from the package entry
 * (§1.3).
 */
export {
  isContentHash,
  isContentType,
  isJsonContentType,
  isSemanticVersion,
  majorVersion,
} from './internal/formats.js';
