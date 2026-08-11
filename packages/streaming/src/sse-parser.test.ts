import { describe, expect, it } from 'vitest';

import {
  SSE_MAX_FRAME_BYTES,
  createSseParser,
  type FrameResult,
} from './index.js';

const encoder = new TextEncoder();

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function parseChunks(chunks: readonly Uint8Array[]): {
  results: readonly FrameResult[];
  finish: readonly FrameResult[];
} {
  const parser = createSseParser();
  const results = chunks.flatMap((chunk) => [...parser.push(chunk)]);
  return { results, finish: parser.finish() };
}

describe('@signalglass/streaming SSE parser (Spec 016 S3)', () => {
  it('T01 frames CRLF input across every byte boundary', () => {
    const input = bytes('data: one\r\n\r\ndata: [DONE]\r\n\r\n');
    const expected = parseChunks([input]);

    for (let split = 0; split <= input.byteLength; split += 1) {
      expect(
        parseChunks([input.subarray(0, split), input.subarray(split)]),
      ).toEqual(expected);
    }

    expect(expected).toEqual({
      results: [
        {
          kind: 'frame',
          data: 'one',
          terminal: false,
          unrecognizedExtensionFrameObserved: false,
        },
        {
          kind: 'frame',
          data: '[DONE]',
          terminal: true,
          unrecognizedExtensionFrameObserved: false,
        },
      ],
      finish: [],
    });
  });

  it('T02 accepts LF-only and CR-only framing', () => {
    const lf = parseChunks([bytes('data: lf\n\ndata: [DONE]\n\n')]);
    const cr = parseChunks([bytes('data: cr\r\rdata: [DONE]\r\r')]);

    expect(lf.results[0]).toMatchObject({ kind: 'frame', data: 'lf' });
    expect(cr.results[0]).toMatchObject({ kind: 'frame', data: 'cr' });
    expect(lf.results[1]).toMatchObject({ terminal: true });
    expect(cr.finish[0]).toMatchObject({ terminal: true });
  });

  it('T03 emits multiple blank-line-delimited frames from one chunk', () => {
    const parser = createSseParser();
    expect(parser.push(bytes('data: a\n\ndata: b\n\n'))).toEqual([
      {
        kind: 'frame',
        data: 'a',
        terminal: false,
        unrecognizedExtensionFrameObserved: false,
      },
      {
        kind: 'frame',
        data: 'b',
        terminal: false,
        unrecognizedExtensionFrameObserved: false,
      },
    ]);
  });

  it('T04 recognizes only exact assembled data [DONE] as terminal', () => {
    const parser = createSseParser();
    expect(
      parser.push(
        bytes(
          'event: [DONE]\ndata: ordinary\n\n' +
            'data: [DONE] \n\n' +
            'data: [DONE]\n\n',
        ),
      ),
    ).toEqual([
      {
        kind: 'frame',
        data: 'ordinary',
        terminal: false,
        unrecognizedExtensionFrameObserved: true,
      },
      {
        kind: 'frame',
        data: '[DONE] ',
        terminal: false,
        unrecognizedExtensionFrameObserved: false,
      },
      {
        kind: 'frame',
        data: '[DONE]',
        terminal: true,
        unrecognizedExtensionFrameObserved: false,
      },
    ]);
    expect(parser.facts().doneObserved).toBe(true);
  });

  it('T05 keeps framing after DONE but never returns trailing data', () => {
    const parser = createSseParser();
    expect(
      parser.push(
        bytes(
          'data: [DONE]\n\n' +
            ': heartbeat\n\n' +
            'data: must-not-escape\n\n',
        ),
      ),
    ).toEqual([
      {
        kind: 'frame',
        data: '[DONE]',
        terminal: true,
        unrecognizedExtensionFrameObserved: false,
      },
      { kind: 'post-terminal-content' },
    ]);
    expect(parser.facts().postTerminal).toBe('observed-not-retained');
    expect(JSON.stringify(parser.facts())).not.toContain('must-not-escape');
  });

  it('T06 ignores comment-only frames and does not count comments as metadata', () => {
    const parser = createSseParser();
    expect(parser.push(bytes(': secret-comment\n:\n\n'))).toEqual([]);
    expect(parser.facts().sseMetadataObservedButNotRetained).toBe(false);
    expect(parser.finish()).toEqual([
      {
        kind: 'malformed',
        code: 'sse-eof-without-done',
        afterTerminal: false,
      },
    ]);
  });

  it('T07 joins multiline and empty data fields with newline', () => {
    const parser = createSseParser();
    expect(parser.push(bytes('data: first\ndata:\ndata: third\n\n'))).toEqual([
      {
        kind: 'frame',
        data: 'first\n\nthird',
        terminal: false,
        unrecognizedExtensionFrameObserved: false,
      },
    ]);

    expect(parser.push(bytes('data:\n\n'))).toEqual([
      {
        kind: 'frame',
        data: '',
        terminal: false,
        unrecognizedExtensionFrameObserved: false,
      },
    ]);
  });

  it('T08 declares unknown event types without exposing their value and continues', () => {
    const parser = createSseParser();
    const secretType = 'private-extension-token';
    const results = parser.push(
      bytes(
        `event: ${secretType}\ndata: one\n\n` +
          'event: message\ndata: two\n\n',
      ),
    );

    expect(results).toEqual([
      {
        kind: 'frame',
        data: 'one',
        terminal: false,
        unrecognizedExtensionFrameObserved: true,
      },
      {
        kind: 'frame',
        data: 'two',
        terminal: false,
        unrecognizedExtensionFrameObserved: false,
      },
    ]);
    expect(JSON.stringify(results)).not.toContain(secretType);
  });

  it('T09 distinguishes partial EOF from EOF after a completed frame', () => {
    const partial = createSseParser();
    partial.push(bytes('data: partial\n'));
    expect(partial.finish()).toEqual([
      {
        kind: 'malformed',
        code: 'sse-partial-frame-at-eof',
        afterTerminal: false,
      },
    ]);

    const complete = createSseParser();
    complete.push(bytes('data: complete\n\n'));
    expect(complete.finish()).toEqual([
      {
        kind: 'malformed',
        code: 'sse-eof-without-done',
        afterTerminal: false,
      },
    ]);
  });

  it('T10 reports invalid UTF-8 per completed frame with a closed code', () => {
    const parser = createSseParser();
    const prefix = bytes('data: ');
    const input = new Uint8Array(prefix.byteLength + 3);
    input.set(prefix);
    input.set([0xff, 0x0a, 0x0a], prefix.byteLength);

    expect(parser.push(input)).toEqual([
      {
        kind: 'malformed',
        code: 'sse-invalid-utf8',
        afterTerminal: false,
      },
    ]);
  });

  it('T11 detaches on overflow and cannot reinterpret discarded suffix bytes', () => {
    const parser = createSseParser({ maxFrameBytes: 12 });
    const results = parser.push(
      bytes('data: oversized-and-data: [DONE]\n\ndata: [DONE]\n\n'),
    );

    expect(results).toEqual([
      {
        kind: 'observation-failure',
        code: 'frame-overflow',
        afterTerminal: false,
      },
    ]);
    expect(parser.facts()).toMatchObject({
      detached: true,
      doneObserved: false,
      bufferedBytes: 0,
      postTerminal: 'none-observed',
    });
    expect(parser.push(bytes('data: [DONE]\n\n'))).toEqual([]);
    expect(parser.finish()).toEqual([]);
  });

  it('T12 never reports retained frame bytes above the configured budget', () => {
    const parser = createSseParser({ maxFrameBytes: 9 });
    for (const byte of bytes('data: never-ending-provider-stream')) {
      parser.push(Uint8Array.of(byte));
      expect(parser.facts().bufferedBytes).toBeLessThanOrEqual(9);
    }
    expect(parser.facts()).toMatchObject({ detached: true, bufferedBytes: 0 });
  });

  it('T131 records only the closed metadata-loss fact for repeated fields', () => {
    const parser = createSseParser();
    const secrets = ['event-secret', 'id-secret', 'retry-secret'];
    const results = parser.push(
      bytes(
        'event: message\n' +
          `event: ${secrets[0]}\n` +
          `id: ${secrets[1]}\n` +
          `retry: ${secrets[2]}\n` +
          'data: safe\n\n',
      ),
    );
    const observable = JSON.stringify({ results, facts: parser.facts() });

    expect(parser.facts().sseMetadataObservedButNotRetained).toBe(true);
    expect(results[0]).toMatchObject({
      unrecognizedExtensionFrameObserved: true,
    });
    for (const secret of secrets) expect(observable).not.toContain(secret);
  });

  it('T142 gates the metadata fact to the openai-sse disposition', () => {
    const parser = createSseParser();
    parser.push(bytes('id: sensitive-id\ndata: safe\n\n'));

    expect(
      parser.facts('openai-sse').sseMetadataObservedButNotRetained,
    ).toBe(true);
    expect(
      parser.facts('unsupported-encoding').sseMetadataObservedButNotRetained,
    ).toBe(false);
  });

  it('decodes a multibyte UTF-8 scalar split at every byte boundary', () => {
    const input = bytes('data: before-🪟-after\n\ndata: [DONE]\n\n');
    const expected = parseChunks([input]);

    for (let split = 0; split <= input.byteLength; split += 1) {
      expect(
        parseChunks([input.subarray(0, split), input.subarray(split)]),
      ).toEqual(expected);
    }
    expect(expected.results[0]).toMatchObject({ data: 'before-🪟-after' });
  });

  it('accepts a raw frame exactly at 16 MiB and rejects one byte more', () => {
    const exact = makeSizedDataFrame(SSE_MAX_FRAME_BYTES);
    const exactParser = createSseParser();
    const exactResults = exactParser.push(exact);
    expect(exactResults).toHaveLength(1);
    expect(exactResults[0]).toMatchObject({
      kind: 'frame',
      terminal: false,
      unrecognizedExtensionFrameObserved: false,
    });
    expect(exactParser.facts()).toMatchObject({
      detached: false,
      bufferedBytes: 0,
    });

    const over = makeSizedDataFrame(SSE_MAX_FRAME_BYTES + 1);
    const overParser = createSseParser();
    expect(overParser.push(over)).toEqual([
      {
        kind: 'observation-failure',
        code: 'frame-overflow',
        afterTerminal: false,
      },
    ]);
    expect(overParser.facts()).toMatchObject({
      detached: true,
      bufferedBytes: 0,
    });
  });

  it('is deterministic across whole, bytewise, and every two-way partition', () => {
    const input = bytes(
      ': comment\r\nevent: message\r\nid: ignored\r\n' +
        'data: one\r\ndata: 🪟\r\n\r\ndata: [DONE]\r\n\r\n',
    );
    const whole = parseChunks([input]);
    const bytewise = parseChunks([...input].map((byte) => Uint8Array.of(byte)));
    expect(bytewise).toEqual(whole);

    for (let split = 0; split <= input.byteLength; split += 1) {
      expect(
        parseChunks([input.subarray(0, split), input.subarray(split)]),
      ).toEqual(whole);
    }
  });

  it('makes EOF and post-EOF calls deterministic no-ops after terminal', () => {
    const parser = createSseParser();
    parser.push(bytes('data: [DONE]\n\n'));
    expect(parser.finish()).toEqual([]);
    expect(parser.finish()).toEqual([]);
    expect(parser.push(bytes('data: ignored\n\n'))).toEqual([]);
  });

  it('marks incomplete or invalid post-terminal observation unknown', () => {
    const partial = createSseParser();
    partial.push(bytes('data: [DONE]\n\ndata: partial'));
    expect(partial.finish()).toEqual([
      {
        kind: 'malformed',
        code: 'sse-partial-frame-at-eof',
        afterTerminal: true,
      },
    ]);
    expect(partial.facts()).toMatchObject({
      doneObserved: true,
      postTerminal: 'unknown',
    });

    const overflow = createSseParser({ maxFrameBytes: 16 });
    overflow.push(bytes('data: [DONE]\n\n'));
    expect(overflow.push(bytes('data: far-too-long-for-budget'))).toEqual([
      {
        kind: 'observation-failure',
        code: 'frame-overflow',
        afterTerminal: true,
      },
    ]);
    expect(overflow.facts().postTerminal).toBe('unknown');
  });

  it('retains zero trailing bytes for a long unterminated post-terminal frame', () => {
    const parser = createSseParser({ maxFrameBytes: 1024 * 1024 });
    expect(parser.push(bytes('data: [DONE]\n\n'))).toHaveLength(1);

    expect(parser.push(bytes('data: private-prefix-'))).toEqual([]);
    const block = new Uint8Array(4096).fill(0x61);
    for (let index = 0; index < 100; index += 1) {
      expect(parser.push(block)).toEqual([]);
      expect(parser.facts().bufferedBytes).toBe(0);
      expect(parser.facts().postTerminal).toBe('none-observed');
    }

    expect(parser.finish()).toEqual([
      {
        kind: 'malformed',
        code: 'sse-partial-frame-at-eof',
        afterTerminal: true,
      },
    ]);
    expect(parser.facts()).toMatchObject({
      bufferedBytes: 0,
      postTerminal: 'unknown',
    });
  });

  it('emits one closed transition result for arbitrarily many trailing frames', () => {
    const parser = createSseParser();
    parser.push(bytes('data: [DONE]\n\n'));

    let resultCount = 0;
    for (let index = 0; index < 10_000; index += 1) {
      resultCount += parser.push(bytes(`data: trailing-${index}\n\n`)).length;
      expect(parser.facts().bufferedBytes).toBe(0);
    }

    expect(resultCount).toBe(1);
    expect(parser.facts().postTerminal).toBe('observed-not-retained');
    expect(parser.finish()).toEqual([]);
  });

  it('keeps output and retained state constant for input beyond the frame limit', () => {
    const parser = createSseParser({ maxFrameBytes: 64 });
    parser.push(bytes('data: [DONE]\n\n'));

    expect(parser.push(bytes('data: '))).toEqual([]);
    expect(parser.facts().bufferedBytes).toBe(0);
    expect(parser.push(new Uint8Array(58).fill(0x61))).toEqual([]);
    expect(parser.facts().bufferedBytes).toBe(0);
    expect(parser.push(Uint8Array.of(0x61))).toEqual([
      {
        kind: 'observation-failure',
        code: 'frame-overflow',
        afterTerminal: true,
      },
    ]);
    expect(parser.push(new Uint8Array(1024 * 1024).fill(0x62))).toEqual([]);
    expect(parser.facts()).toMatchObject({
      detached: true,
      bufferedBytes: 0,
      postTerminal: 'unknown',
    });
  });

  it('treats comment-only trailing frames as none across all delimiters', () => {
    const parser = createSseParser();
    parser.push(bytes('data: [DONE]\n\n'));

    const trailing = bytes(': lf\n\n: cr\r\r: crlf\r\n\r\n:\r\n\r\n');
    for (const byte of trailing) {
      expect(parser.push(Uint8Array.of(byte))).toEqual([]);
      expect(parser.facts().bufferedBytes).toBe(0);
    }

    expect(parser.finish()).toEqual([]);
    expect(parser.facts().postTerminal).toBe('none-observed');
  });

  it('does not expose first or later trailing content, including split UTF-8', () => {
    const parser = createSseParser();
    parser.push(bytes('data: [DONE]\n\n'));
    const firstSecret = 'first-private-🪟';
    const laterSecret = 'later-private-value';
    const first = bytes(`data: ${firstSecret}\r\n\r\n`);

    const results: FrameResult[] = [];
    for (const byte of first) {
      results.push(...parser.push(Uint8Array.of(byte)));
    }
    expect(results).toEqual([{ kind: 'post-terminal-content' }]);
    expect(parser.push(bytes(`data: ${laterSecret}\n\n`))).toEqual([]);

    const observable = JSON.stringify({ results, facts: parser.facts() });
    expect(observable).not.toContain(firstSecret);
    expect(observable).not.toContain(laterSecret);
    expect(parser.facts()).toMatchObject({
      bufferedBytes: 0,
      postTerminal: 'observed-not-retained',
    });
  });

  it('reports invalid post-terminal UTF-8 once, without retaining its suffix', () => {
    const parser = createSseParser();
    parser.push(bytes('data: [DONE]\n\n'));
    const prefix = bytes('data: private-');
    const invalid = new Uint8Array(prefix.byteLength + 4);
    invalid.set(prefix);
    invalid.set([0xff, 0x0a, 0x0a, 0x61], prefix.byteLength);

    const results = parser.push(invalid);
    expect(results).toEqual([
      {
        kind: 'malformed',
        code: 'sse-invalid-utf8',
        afterTerminal: true,
      },
    ]);
    expect(parser.push(bytes('data: must-not-be-observed\n\n'))).toEqual([]);
    expect(JSON.stringify({ results, facts: parser.facts() })).not.toContain(
      'private',
    );
    expect(parser.facts()).toMatchObject({
      bufferedBytes: 0,
      postTerminal: 'unknown',
    });
  });

  it('is deterministic after terminal across whole, bytewise, and split input', () => {
    const input = bytes(
      'data: [DONE]\r\n\r\n' +
        ': comment\r\n\r\n' +
        'event: message\rdata: first-🪟\r\r' +
        'data: later\n\n',
    );
    const expected = parseChunks([input]);

    expect(
      parseChunks([...input].map((byte) => Uint8Array.of(byte))),
    ).toEqual(expected);
    for (let split = 0; split <= input.byteLength; split += 1) {
      expect(
        parseChunks([input.subarray(0, split), input.subarray(split)]),
      ).toEqual(expected);
    }
    expect(expected).toEqual({
      results: [
        {
          kind: 'frame',
          data: '[DONE]',
          terminal: true,
          unrecognizedExtensionFrameObserved: false,
        },
        { kind: 'post-terminal-content' },
      ],
      finish: [],
    });
  });

  it('treats repeated DONE frames as one post-terminal content transition', () => {
    const parser = createSseParser();
    parser.push(bytes('data: [DONE]\n\n'));

    let resultCount = 0;
    for (let index = 0; index < 1_000; index += 1) {
      resultCount += parser.push(bytes('data: [DONE]\n\n')).length;
    }

    expect(resultCount).toBe(1);
    expect(parser.facts()).toMatchObject({
      doneObserved: true,
      bufferedBytes: 0,
      postTerminal: 'observed-not-retained',
    });
  });

  it('rejects invalid configured budgets with fixed, value-free errors', () => {
    for (const maxFrameBytes of [0, -1, 1.5, Number.NaN, SSE_MAX_FRAME_BYTES + 1]) {
      expect(() => createSseParser({ maxFrameBytes })).toThrowError(
        'maxFrameBytes must be a positive integer no greater than the Spec 016 ceiling',
      );
    }
  });
});

function makeSizedDataFrame(rawFrameBytes: number): Uint8Array {
  // The terminating blank-line LF is not part of the retained frame budget.
  const prefix = bytes('data: ');
  const payloadBytes = rawFrameBytes - prefix.byteLength - 1;
  const frame = new Uint8Array(rawFrameBytes + 1);
  frame.set(prefix, 0);
  frame.fill(0x61, prefix.byteLength, prefix.byteLength + payloadBytes);
  frame[rawFrameBytes - 1] = 0x0a;
  frame[rawFrameBytes] = 0x0a;
  return frame;
}
