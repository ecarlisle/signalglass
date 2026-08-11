/**
 * Network-free L2 streaming primitives (Spec 016 Slice S3).
 *
 * Provider JSON decoding, evidence assembly, transport I/O, storage, clocks,
 * and randomness deliberately do not belong in this package.
 */
export {
  SSE_MAX_FRAME_BYTES,
  createSseParser,
} from './sse-parser.js';
export type {
  FrameResult,
  SseDecoderDisposition,
  SseMalformedCode,
  SseParser,
  SseParserFacts,
  SseParserOptions,
} from './sse-parser.js';
