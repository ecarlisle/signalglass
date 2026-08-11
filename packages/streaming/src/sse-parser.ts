/** The exact Spec 016 L2 frame-buffer ceiling: 16 MiB. */
export const SSE_MAX_FRAME_BYTES = 16 * 1024 * 1024;

const INITIAL_BUFFER_BYTES = 4 * 1024;

const POST_FIELD_DATA = 1 << 0;
const POST_FIELD_EVENT = 1 << 1;
const POST_FIELD_ID = 1 << 2;
const POST_FIELD_RETRY = 1 << 3;
const POST_FIELD_ALL =
  POST_FIELD_DATA | POST_FIELD_EVENT | POST_FIELD_ID | POST_FIELD_RETRY;

const POST_FIELD_BYTES: readonly {
  readonly mask: number;
  readonly bytes: readonly number[];
}[] = [
  { mask: POST_FIELD_DATA, bytes: [0x64, 0x61, 0x74, 0x61] },
  { mask: POST_FIELD_EVENT, bytes: [0x65, 0x76, 0x65, 0x6e, 0x74] },
  { mask: POST_FIELD_ID, bytes: [0x69, 0x64] },
  { mask: POST_FIELD_RETRY, bytes: [0x72, 0x65, 0x74, 0x72, 0x79] },
];

const POST_UTF8_LEAD_RANGES: readonly {
  readonly first: number;
  readonly last: number;
  readonly remaining: number;
  readonly nextMin: number;
  readonly nextMax: number;
}[] = [
  { first: 0xc2, last: 0xdf, remaining: 1, nextMin: 0x80, nextMax: 0xbf },
  { first: 0xe0, last: 0xe0, remaining: 2, nextMin: 0xa0, nextMax: 0xbf },
  { first: 0xe1, last: 0xec, remaining: 2, nextMin: 0x80, nextMax: 0xbf },
  { first: 0xed, last: 0xed, remaining: 2, nextMin: 0x80, nextMax: 0x9f },
  { first: 0xee, last: 0xef, remaining: 2, nextMin: 0x80, nextMax: 0xbf },
  { first: 0xf0, last: 0xf0, remaining: 3, nextMin: 0x90, nextMax: 0xbf },
  { first: 0xf1, last: 0xf3, remaining: 3, nextMin: 0x80, nextMax: 0xbf },
  { first: 0xf4, last: 0xf4, remaining: 3, nextMin: 0x80, nextMax: 0x8f },
];

export type SseParserOptions = {
  /**
   * Maximum raw bytes retained for one unterminated frame. Defaults to the
   * Spec 016 ceiling and may only make that ceiling more restrictive.
   */
  maxFrameBytes?: number;
};

export type SseDecoderDisposition = 'openai-sse' | 'unsupported-encoding';

export type SseMalformedCode =
  | 'sse-invalid-utf8'
  | 'sse-partial-frame-at-eof'
  | 'sse-eof-without-done';

export type FrameResult =
  | {
      kind: 'frame';
      data: string;
      terminal: false;
      unrecognizedExtensionFrameObserved: boolean;
    }
  | {
      kind: 'frame';
      data: '[DONE]';
      terminal: true;
      unrecognizedExtensionFrameObserved: boolean;
    }
  | {
      kind: 'post-terminal-content';
    }
  | {
      kind: 'malformed';
      code: SseMalformedCode;
      afterTerminal: boolean;
    }
  | {
      kind: 'observation-failure';
      code: 'frame-overflow';
      afterTerminal: boolean;
    };

export type SseParserFacts = {
  doneObserved: boolean;
  detached: boolean;
  bufferedBytes: number;
  maxFrameBytes: number;
  postTerminal: 'none-observed' | 'observed-not-retained' | 'unknown';
  sseMetadataObservedButNotRetained: boolean;
};

export type SseParser = {
  /** Consume the next arbitrary byte partition. */
  push(chunk: Uint8Array): readonly FrameResult[];
  /** Signal transport EOF. Repeated calls are deterministic no-ops. */
  finish(): readonly FrameResult[];
  /**
   * Return closed observation facts. The metadata-loss fact is applicable
   * only when the caller's selected decoder disposition is `openai-sse`.
   */
  facts(decoderDisposition?: SseDecoderDisposition): SseParserFacts;
};

type ParsedFrame = {
  data: string | undefined;
  metadataObserved: boolean;
  unrecognizedExtensionFrameObserved: boolean;
};

type ParsedFrameAccumulator = {
  dataLines: string[];
  metadataObserved: boolean;
  unrecognizedExtensionFrameObserved: boolean;
};

type ParserState = {
  readonly maxFrameBytes: number;
  buffer: Uint8Array;
  bufferedLength: number;
  rawFrameBytes: number;
  currentLineBytes: number;
  pendingCr: boolean;
  detached: boolean;
  ended: boolean;
  terminalReached: boolean;
  doneObserved: boolean;
  metadataObserved: boolean;
  postTerminal: 'none-observed' | 'observed-not-retained' | 'unknown';
  postTerminalStopped: boolean;
  postFrameHasData: boolean;
  postFrameInvalidUtf8: boolean;
  postLineKind: 'field' | 'comment' | 'value';
  postFieldCandidates: number;
  postFieldLength: number;
  postUtf8Remaining: number;
  postUtf8NextMin: number;
  postUtf8NextMax: number;
};

export function createSseParser(options: SseParserOptions = {}): SseParser {
  const maxFrameBytes = options.maxFrameBytes ?? SSE_MAX_FRAME_BYTES;
  assertFrameBudget(maxFrameBytes);

  const state: ParserState = {
    maxFrameBytes,
    buffer: new Uint8Array(Math.min(INITIAL_BUFFER_BYTES, maxFrameBytes)),
    bufferedLength: 0,
    rawFrameBytes: 0,
    currentLineBytes: 0,
    pendingCr: false,
    detached: false,
    ended: false,
    terminalReached: false,
    doneObserved: false,
    metadataObserved: false,
    postTerminal: 'none-observed',
    postTerminalStopped: false,
    postFrameHasData: false,
    postFrameInvalidUtf8: false,
    postLineKind: 'field',
    postFieldCandidates: POST_FIELD_ALL,
    postFieldLength: 0,
    postUtf8Remaining: 0,
    postUtf8NextMin: 0x80,
    postUtf8NextMax: 0xbf,
  };

  return {
    push: (chunk) => pushChunk(state, chunk),
    finish: () => finishStream(state),
    facts: (disposition = 'openai-sse') => parserFacts(state, disposition),
  };
}

function assertFrameBudget(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > SSE_MAX_FRAME_BYTES) {
    throw new RangeError(
      'maxFrameBytes must be a positive integer no greater than the Spec 016 ceiling',
    );
  }
}

function pushChunk(
  state: ParserState,
  chunk: Uint8Array,
): readonly FrameResult[] {
  if (
    state.ended ||
    state.detached ||
    state.postTerminalStopped ||
    chunk.byteLength === 0
  ) {
    return [];
  }

  const results: FrameResult[] = [];
  for (const byte of chunk) {
    if (state.detached || state.postTerminalStopped) break;
    consumeByte(state, byte, results);
  }
  return results;
}

function finishStream(state: ParserState): readonly FrameResult[] {
  if (state.ended) return [];
  state.ended = true;
  if (state.detached) return [];

  const results: FrameResult[] = [];
  finishPendingCr(state, results);
  if (state.detached || state.postTerminalStopped) return results;

  if (state.terminalReached) {
    finishPostTerminal(state, results);
    return results;
  }

  if (hasPartialFrame(state)) signalPartialFrame(state, results);
  else {
    state.terminalReached = true;
    results.push({
      kind: 'malformed',
      code: 'sse-eof-without-done',
      afterTerminal: false,
    });
  }
  return results;
}

function finishPendingCr(state: ParserState, results: FrameResult[]): void {
  if (!state.pendingCr) return;
  state.pendingCr = false;
  if (state.terminalReached) endPostTerminalLine(state, 1, results);
  else endLine(state, 1, results);
}

function finishPostTerminal(
  state: ParserState,
  results: FrameResult[],
): void {
  if (hasPartialFrame(state)) signalPostTerminalPartial(state, results);
}

function signalPartialFrame(
  state: ParserState,
  results: FrameResult[],
): void {
  const afterTerminal = state.terminalReached;
  if (afterTerminal) state.postTerminal = 'unknown';
  state.terminalReached = true;
  resetFrame(state);
  results.push({
    kind: 'malformed',
    code: 'sse-partial-frame-at-eof',
    afterTerminal,
  });
}

function parserFacts(
  state: ParserState,
  decoderDisposition: SseDecoderDisposition,
): SseParserFacts {
  return {
    doneObserved: state.doneObserved,
    detached: state.detached,
    bufferedBytes: state.bufferedLength,
    maxFrameBytes: state.maxFrameBytes,
    postTerminal: state.postTerminal,
    sseMetadataObservedButNotRetained:
      decoderDisposition === 'openai-sse' && state.metadataObserved,
  };
}

function consumeByte(
  state: ParserState,
  byte: number,
  results: FrameResult[],
): void {
  if (state.terminalReached) {
    consumePostTerminalByte(state, byte, results);
    return;
  }

  if (state.pendingCr) {
    state.pendingCr = false;
    if (byte === 0x0a) {
      endLine(state, 2, results);
      return;
    }
    endLine(state, 1, results);
    if (state.detached) return;
    if (state.terminalReached) {
      consumePostTerminalByte(state, byte, results);
      return;
    }
  }

  if (byte === 0x0d) {
    state.pendingCr = true;
  } else if (byte === 0x0a) {
    endLine(state, 1, results);
  } else {
    appendContentByte(state, byte, results);
  }
}

function appendContentByte(
  state: ParserState,
  byte: number,
  results: FrameResult[],
): void {
  if (state.rawFrameBytes === state.maxFrameBytes) {
    detachForOverflow(state, results);
    return;
  }

  ensureCapacity(state, state.bufferedLength + 1);
  state.buffer[state.bufferedLength] = byte;
  state.bufferedLength += 1;
  state.rawFrameBytes += 1;
  state.currentLineBytes += 1;
}

function endLine(
  state: ParserState,
  delimiterBytes: 1 | 2,
  results: FrameResult[],
): void {
  if (state.currentLineBytes === 0) {
    completeFrame(state, results);
    return;
  }

  if (state.rawFrameBytes > state.maxFrameBytes - delimiterBytes) {
    detachForOverflow(state, results);
    return;
  }

  ensureCapacity(state, state.bufferedLength + 1);
  state.buffer[state.bufferedLength] = 0x0a;
  state.bufferedLength += 1;
  state.rawFrameBytes += delimiterBytes;
  state.currentLineBytes = 0;
}

function completeFrame(state: ParserState, results: FrameResult[]): void {
  if (state.rawFrameBytes === 0) {
    resetFrame(state);
    return;
  }

  const normalizedLength =
    state.bufferedLength > 0 && state.buffer[state.bufferedLength - 1] === 0x0a
      ? state.bufferedLength - 1
      : state.bufferedLength;
  const bytes = state.buffer.subarray(0, normalizedLength);

  const text = decodeFrame(bytes);
  resetFrame(state);
  if (text === undefined) {
    signalInvalidUtf8(state, results);
    return;
  }
  emitParsedFrame(state, parseFrame(text), results);
}

function decodeFrame(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function signalInvalidUtf8(
  state: ParserState,
  results: FrameResult[],
): void {
  const afterTerminal = state.terminalReached;
  if (afterTerminal) state.postTerminal = 'unknown';
  enterPostTerminal(state);
  results.push({
    kind: 'malformed',
    code: 'sse-invalid-utf8',
    afterTerminal,
  });
}

function emitParsedFrame(
  state: ParserState,
  parsed: ParsedFrame,
  results: FrameResult[],
): void {
  if (parsed.metadataObserved) state.metadataObserved = true;
  if (parsed.data === undefined) return;

  if (state.terminalReached) {
    state.postTerminal = 'observed-not-retained';
    results.push({ kind: 'post-terminal-content' });
    return;
  }

  if (parsed.data === '[DONE]') {
    state.doneObserved = true;
    enterPostTerminal(state);
    results.push({
      kind: 'frame',
      data: '[DONE]',
      terminal: true,
      unrecognizedExtensionFrameObserved:
        parsed.unrecognizedExtensionFrameObserved,
    });
    return;
  }

  results.push({
    kind: 'frame',
    data: parsed.data,
    terminal: false,
    unrecognizedExtensionFrameObserved:
      parsed.unrecognizedExtensionFrameObserved,
  });
}

function consumePostTerminalByte(
  state: ParserState,
  byte: number,
  results: FrameResult[],
): void {
  if (state.pendingCr) {
    state.pendingCr = false;
    if (byte === 0x0a) {
      endPostTerminalLine(state, 2, results);
      return;
    }
    endPostTerminalLine(state, 1, results);
    if (state.detached || state.postTerminalStopped) return;
  }

  if (byte === 0x0d) {
    state.pendingCr = true;
  } else if (byte === 0x0a) {
    endPostTerminalLine(state, 1, results);
  } else {
    consumePostTerminalContentByte(state, byte, results);
  }
}

function consumePostTerminalContentByte(
  state: ParserState,
  byte: number,
  results: FrameResult[],
): void {
  if (state.rawFrameBytes === state.maxFrameBytes) {
    detachForOverflow(state, results);
    return;
  }

  state.rawFrameBytes += 1;
  state.currentLineBytes += 1;
  validatePostTerminalUtf8Byte(state, byte);
  classifyPostTerminalLineByte(state, byte);
}

function classifyPostTerminalLineByte(state: ParserState, byte: number): void {
  if (state.currentLineBytes === 1 && byte === 0x3a) {
    state.postLineKind = 'comment';
    state.postFieldCandidates = 0;
    return;
  }
  if (state.postLineKind !== 'field') return;

  if (byte === 0x3a) {
    observePostTerminalField(state);
    state.postLineKind = 'value';
    return;
  }

  let matching = 0;
  for (const candidate of POST_FIELD_BYTES) {
    if (candidate.bytes[state.postFieldLength] === byte) {
      matching |= candidate.mask;
    }
  }
  state.postFieldCandidates &= matching;
  state.postFieldLength += 1;
}

function observePostTerminalField(state: ParserState): void {
  const field = resolvedPostTerminalField(state);
  if (field === POST_FIELD_DATA) {
    state.postFrameHasData = true;
  } else if (
    field === POST_FIELD_EVENT ||
    field === POST_FIELD_ID ||
    field === POST_FIELD_RETRY
  ) {
    state.metadataObserved = true;
  }
}

function resolvedPostTerminalField(state: ParserState): number {
  for (const candidate of POST_FIELD_BYTES) {
    if (
      (state.postFieldCandidates & candidate.mask) !== 0 &&
      candidate.bytes.length === state.postFieldLength
    ) {
      return candidate.mask;
    }
  }
  return 0;
}

function endPostTerminalLine(
  state: ParserState,
  delimiterBytes: 1 | 2,
  results: FrameResult[],
): void {
  if (state.currentLineBytes === 0) {
    completePostTerminalFrame(state, results);
    return;
  }

  if (state.postLineKind === 'field') observePostTerminalField(state);
  if (state.postUtf8Remaining !== 0) {
    state.postFrameInvalidUtf8 = true;
    resetPostTerminalUtf8(state);
  }
  if (state.rawFrameBytes > state.maxFrameBytes - delimiterBytes) {
    detachForOverflow(state, results);
    return;
  }

  state.rawFrameBytes += delimiterBytes;
  state.currentLineBytes = 0;
  resetPostTerminalLine(state);
}

function completePostTerminalFrame(
  state: ParserState,
  results: FrameResult[],
): void {
  if (state.rawFrameBytes === 0) {
    resetPostTerminalFrame(state);
    return;
  }

  if (state.postFrameInvalidUtf8 || state.postUtf8Remaining !== 0) {
    state.postTerminal = 'unknown';
    state.postTerminalStopped = true;
    resetPostTerminalFrame(state);
    results.push({
      kind: 'malformed',
      code: 'sse-invalid-utf8',
      afterTerminal: true,
    });
    return;
  }

  const firstContentFrame =
    state.postFrameHasData && state.postTerminal === 'none-observed';
  if (state.postFrameHasData) {
    state.postTerminal = 'observed-not-retained';
  }
  resetPostTerminalFrame(state);
  if (firstContentFrame) results.push({ kind: 'post-terminal-content' });
}

function validatePostTerminalUtf8Byte(state: ParserState, byte: number): void {
  if (state.postFrameInvalidUtf8) return;

  if (state.postUtf8Remaining !== 0) {
    if (byte < state.postUtf8NextMin || byte > state.postUtf8NextMax) {
      state.postFrameInvalidUtf8 = true;
      resetPostTerminalUtf8(state);
      return;
    }
    state.postUtf8Remaining -= 1;
    state.postUtf8NextMin = 0x80;
    state.postUtf8NextMax = 0xbf;
    return;
  }

  if (byte <= 0x7f) return;
  const lead = POST_UTF8_LEAD_RANGES.find(
    (range) => byte >= range.first && byte <= range.last,
  );
  if (lead === undefined) {
    state.postFrameInvalidUtf8 = true;
    return;
  }
  beginPostTerminalUtf8(
    state,
    lead.remaining,
    lead.nextMin,
    lead.nextMax,
  );
}

function beginPostTerminalUtf8(
  state: ParserState,
  remaining: number,
  nextMin: number,
  nextMax: number,
): void {
  state.postUtf8Remaining = remaining;
  state.postUtf8NextMin = nextMin;
  state.postUtf8NextMax = nextMax;
}

function signalPostTerminalPartial(
  state: ParserState,
  results: FrameResult[],
): void {
  state.postTerminal = 'unknown';
  state.postTerminalStopped = true;
  resetPostTerminalFrame(state);
  results.push({
    kind: 'malformed',
    code: 'sse-partial-frame-at-eof',
    afterTerminal: true,
  });
}

function enterPostTerminal(state: ParserState): void {
  state.terminalReached = true;
  state.buffer = new Uint8Array(0);
  resetPostTerminalFrame(state);
}

function resetPostTerminalFrame(state: ParserState): void {
  resetFrame(state);
  state.postFrameHasData = false;
  state.postFrameInvalidUtf8 = false;
  resetPostTerminalLine(state);
  resetPostTerminalUtf8(state);
}

function resetPostTerminalLine(state: ParserState): void {
  state.postLineKind = 'field';
  state.postFieldCandidates = POST_FIELD_ALL;
  state.postFieldLength = 0;
}

function resetPostTerminalUtf8(state: ParserState): void {
  state.postUtf8Remaining = 0;
  state.postUtf8NextMin = 0x80;
  state.postUtf8NextMax = 0xbf;
}

function parseFrame(text: string): ParsedFrame {
  const parsed: ParsedFrameAccumulator = {
    dataLines: [],
    metadataObserved: false,
    unrecognizedExtensionFrameObserved: false,
  };

  for (const line of text.split('\n')) {
    if (line.startsWith(':')) continue;
    parseField(line, parsed);
  }

  return {
    data:
      parsed.dataLines.length === 0 ? undefined : parsed.dataLines.join('\n'),
    metadataObserved: parsed.metadataObserved,
    unrecognizedExtensionFrameObserved:
      parsed.unrecognizedExtensionFrameObserved,
  };
}

function parseField(line: string, parsed: ParsedFrameAccumulator): void {
  const [field, value] = splitField(line);

  switch (field) {
    case 'data':
      parsed.dataLines.push(value);
      return;
    case 'event':
      parsed.metadataObserved = true;
      parsed.unrecognizedExtensionFrameObserved ||=
        value !== '' && value !== 'message';
      return;
    case 'id':
    case 'retry':
      parsed.metadataObserved = true;
      return;
    default:
      parsed.unrecognizedExtensionFrameObserved = true;
  }
}

function splitField(line: string): readonly [field: string, value: string] {
  const colon = line.indexOf(':');
  const field = colon === -1 ? line : line.slice(0, colon);
  let value = colon === -1 ? '' : line.slice(colon + 1);
  if (value.startsWith(' ')) value = value.slice(1);
  return [field, value];
}

function detachForOverflow(
  state: ParserState,
  results: FrameResult[],
): void {
  const afterTerminal = state.terminalReached;
  state.detached = true;
  if (afterTerminal) state.postTerminal = 'unknown';
  state.buffer = new Uint8Array(0);
  resetFrame(state);
  results.push({
    kind: 'observation-failure',
    code: 'frame-overflow',
    afterTerminal,
  });
}

function ensureCapacity(state: ParserState, required: number): void {
  if (required <= state.buffer.byteLength) return;

  const nextCapacity = Math.min(
    state.maxFrameBytes,
    Math.max(required, Math.max(1, state.buffer.byteLength * 2)),
  );
  const next = new Uint8Array(nextCapacity);
  next.set(state.buffer.subarray(0, state.bufferedLength));
  state.buffer = next;
}

function hasPartialFrame(state: ParserState): boolean {
  return state.rawFrameBytes !== 0 || state.currentLineBytes !== 0;
}

function resetFrame(state: ParserState): void {
  state.bufferedLength = 0;
  state.rawFrameBytes = 0;
  state.currentLineBytes = 0;
}
