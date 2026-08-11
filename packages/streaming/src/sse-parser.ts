/** The exact Spec 016 L2 frame-buffer ceiling: 16 MiB. */
export const SSE_MAX_FRAME_BYTES = 16 * 1024 * 1024;

const INITIAL_BUFFER_BYTES = 4 * 1024;

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
  if (state.ended || state.detached || chunk.byteLength === 0) return [];

  const results: FrameResult[] = [];
  for (const byte of chunk) {
    if (state.detached) break;
    consumeByte(state, byte, results);
  }
  return results;
}

function finishStream(state: ParserState): readonly FrameResult[] {
  if (state.ended) return [];
  state.ended = true;
  if (state.detached) return [];

  const results: FrameResult[] = [];
  if (state.pendingCr) {
    state.pendingCr = false;
    endLine(state, 1, results);
  }
  if (state.detached) return results;

  if (hasPartialFrame(state)) {
    signalPartialFrame(state, results);
  } else if (!state.terminalReached) {
    state.terminalReached = true;
    results.push({
      kind: 'malformed',
      code: 'sse-eof-without-done',
      afterTerminal: false,
    });
  }
  return results;
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
  if (state.pendingCr) {
    state.pendingCr = false;
    if (byte === 0x0a) {
      endLine(state, 2, results);
      return;
    }
    endLine(state, 1, results);
    if (state.detached) return;
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
  state.terminalReached = true;
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
    state.terminalReached = true;
    state.doneObserved = true;
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
