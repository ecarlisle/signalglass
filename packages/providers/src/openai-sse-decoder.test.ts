import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createOpenAiSseDecoder, decodeSseFrame } from './openai-sse-decoder.js';
import type { DecodableSseFrameResult, FrameDecodeResult } from './openai-sse-decoder.js';
import type { FrameResult } from '@signalglass/streaming';

function frame(data: string): Extract<FrameResult, { kind: 'frame' }> {
  return { kind: 'frame', data, terminal: false, unrecognizedExtensionFrameObserved: false };
}

describe('OpenAI SSE decoder (Spec 016 S4)', () => {
  it('normalizes chunks, finish reasons, and frame-level usage in order', () => {
    const decoder = createOpenAiSseDecoder();
    expect(decoder.decode(frame(JSON.stringify({
      choices: [
        { index: 2, delta: { content: 'a' } },
        { delta: { content: 'b' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 3, total_tokens: 3 },
    })))).toEqual({
      kind: 'events',
      events: [
        { kind: 'chunk', choiceIndex: 2, chunkIndex: 0, delta: 'a' },
        { kind: 'chunk', choiceIndex: 1, chunkIndex: 0, delta: 'b', finishReason: 'stop' },
        { kind: 'usage', inputTokens: 0, outputTokens: 3, totalTokens: 3 },
      ],
    });
  });

  it('maintains independent per-choice ordinals across frames', () => {
    const decoder = createOpenAiSseDecoder();
    decoder.decode(frame('{"choices":[{"index":4,"delta":{"content":"a"}},{"index":1,"delta":{"content":"b"}}]}'));
    expect(decoder.decode(frame('{"choices":[{"index":1,"delta":{"content":"c"}},{"index":4,"delta":{"content":"d"}}]}'))).toEqual({
      kind: 'events',
      events: [
        { kind: 'chunk', choiceIndex: 1, chunkIndex: 1, delta: 'c' },
        { kind: 'chunk', choiceIndex: 4, chunkIndex: 1, delta: 'd' },
      ],
    });
  });

  it.each([
    [{ choices: [{ index: -1, delta: {} }] }],
    [{ choices: [{ index: 1.5, delta: {} }] }],
    [{ choices: [{ index: 1, delta: {} }, { index: 1, delta: {} }] }],
  ])('rejects invalid or duplicate choice identity', (value) => {
    expect(decodeSseFrame(frame(JSON.stringify(value)))).toEqual({ kind: 'malformed', code: 'sse-invalid-choice-index' });
  });

  it('declares closed unmapped categories without retaining raw keys', () => {
    const result = decodeSseFrame(frame(JSON.stringify({ choices: [{
      delta: { role: 'assistant', tool_calls: [], refusal: 'no', audio: {}, future_secret_field: 'not retained' },
      usage: { total_tokens: 7 },
    }] })));
    expect(result).toEqual({
      kind: 'events',
      events: [{
        kind: 'chunk', choiceIndex: 0, chunkIndex: 0, delta: null,
        unmappedDeltaFields: ['role', 'tool-calls', 'refusal', 'audio', 'per-choice-usage', 'other-extension'],
      }],
    });
    expect(JSON.stringify(result)).not.toContain('future_secret_field');
    expect(JSON.stringify(result)).not.toContain('not retained');
  });

  it('distinguishes done, malformed JSON, and unrecognized JSON', () => {
    expect(decodeSseFrame({ kind: 'frame', data: '[DONE]', terminal: true, unrecognizedExtensionFrameObserved: false })).toEqual({ kind: 'done' });
    expect(decodeSseFrame(frame('{'))).toEqual({ kind: 'malformed', code: 'sse-invalid-data-json' });
    expect(decodeSseFrame(frame('{"future":true}'))).toEqual({ kind: 'unrecognized' });
    expect(decodeSseFrame({ kind: 'malformed', code: 'sse-invalid-utf8', afterTerminal: false })).toEqual({ kind: 'malformed', code: 'sse-invalid-utf8' });
  });

  it('keeps observer failures and post-terminal content outside L3 at the public type boundary', () => {
    type ObserverFailure = Extract<FrameResult, { kind: 'observation-failure' }>;
    type PostTerminal = Extract<FrameResult, { kind: 'post-terminal-content' }>;
    expectTypeOf<ObserverFailure>().not.toMatchTypeOf<DecodableSseFrameResult>();
    expectTypeOf<PostTerminal>().not.toMatchTypeOf<DecodableSseFrameResult>();
    expectTypeOf<Extract<ObserverFailure, { code: 'frame-overflow' }>>().not.toMatchTypeOf<DecodableSseFrameResult>();
  });

  it('uses decode-error only for an actual internal decoder exception', () => {
    const parsed = new Proxy({}, { get: () => { throw new Error('internal failure'); } });
    const parse = vi.spyOn(JSON, 'parse').mockReturnValueOnce(parsed);
    try {
      expect(createOpenAiSseDecoder().decode(frame('{"choices":[]}'))).toEqual({ kind: 'decode-error', code: 'decode-error' });
    } finally {
      parse.mockRestore();
    }
  });

  it('preserves the accepted closed FrameDecodeResult contract', () => {
    type Expected =
      | { kind: 'events'; events: readonly import('./openai-sse-decoder.js').StreamDecodedEvent[] }
      | { kind: 'done' }
      | { kind: 'malformed'; code: import('@signalglass/evidence').MalformedStreamCode }
      | { kind: 'unrecognized' }
      | { kind: 'decode-error'; code: import('@signalglass/evidence').InternalDecoderFailureCode };
    expectTypeOf<FrameDecodeResult>().toEqualTypeOf<Expected>();
  });

  it('emits leak-free bounded provider-error structure', () => {
    const secret = 'sk-secret-do-not-retain';
    const result = decodeSseFrame(frame(JSON.stringify({ error: { type: 'rate_limit', message: secret, body: { secret } } })));
    expect(result).toEqual({
      kind: 'events',
      events: [{ kind: 'provider-error', code: 'provider-error-frame', description: 'Provider reported an error.' }],
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
