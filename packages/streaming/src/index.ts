/**
 * Network-free streaming primitives (Spec 016 S3/S4).
 *
 * Provider JSON decoding, evidence assembly, transport I/O, storage, clocks,
 * and randomness deliberately do not belong in this package.
 */
export {
  SSE_MAX_FRAME_BYTES,
  createSseParser,
} from './sse-parser.js';
export {
  DEFAULT_EVIDENCE_BUDGETS,
  FAILURE_CLASSIFICATION,
  FAILURE_CLASSIFICATION_ROWS,
  OPENAI_SSE_DECODER_CONTRACT_NAME,
  OPENAI_SSE_DECODER_CONTRACT_VERSION,
  STREAMING_ASSEMBLER_NAME,
  STREAMING_ASSEMBLER_VERSION,
  assembleTrace,
  classifyFailureCode,
  countBudgetAllows,
  measureFinalizableSnapshotBytes,
  observationFromDecodedEvent,
  reservedTerminalSuffixCount,
  validateEvidenceBudgets,
} from './assembler.js';
export type {
  AssemblerBoundaryFacts,
  AssemblerDecodedEvent,
  AssemblerOptions,
  AssemblyResult,
  AssemblyTerminal,
  AssemblyWarning,
  EvidenceBudgets,
  FailureClassificationRow,
  FinalizationBundle,
  FinalizationValue,
  TerminalBoundaryPreview,
  TerminalReservationState,
} from './assembler.js';
export { buildTerminalBoundaryPreviews } from './boundary-previews.js';
export {
  CAPTURE_PROFILE_NAME,
  CAPTURE_PROFILE_VERSION,
  DETECTOR_NAME,
  DETECTOR_VERSION,
  RETAINED_CONTENT_CODE_POINT_LIMIT,
  countCodePoints,
  normalizeRequestMessages,
  retainText,
} from './retention.js';
export type { NormalizeMessagesResult, RetainedText } from './retention.js';
export type {
  FrameResult,
  SseDecoderDisposition,
  SseMalformedCode,
  SseParser,
  SseParserFacts,
  SseParserOptions,
} from './sse-parser.js';
