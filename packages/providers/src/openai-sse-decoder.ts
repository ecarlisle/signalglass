/**
 * OpenAI-compatible SSE frame decoder (Spec 016 S4, L3).
 *
 * This module deliberately emits only provider-neutral values and closed
 * classifications. Provider JSON, property names, and exception text never
 * cross the decoder boundary.
 */
import type {
  InternalDecoderFailureCode,
  MalformedStreamCode,
  ProviderErrorFrameCode,
  UnmappedDeltaFieldCategory,
} from '@signalglass/evidence';
import type { FrameResult } from '@signalglass/streaming';

export const OPENAI_SSE_DECODER_NAME = 'signalglass.providers.openai-sse' as const;
export const OPENAI_SSE_DECODER_VERSION = '1.0.0' as const;

export type StreamDecodedEvent =
  | {
      kind: 'chunk';
      choiceIndex: number;
      chunkIndex: number;
      delta: string | null;
      finishReason?: string;
      unmappedDeltaFields?: readonly UnmappedDeltaFieldCategory[];
    }
  | {
      kind: 'usage';
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    }
  | {
      kind: 'provider-error';
      code: ProviderErrorFrameCode;
      description: string;
    };

export type FrameDecodeResult =
  | { kind: 'events'; events: readonly StreamDecodedEvent[] }
  | { kind: 'done' }
  | { kind: 'malformed'; code: MalformedStreamCode }
  | { kind: 'unrecognized' }
  | { kind: 'decode-error'; code: InternalDecoderFailureCode };

/** L2 results that L3 is permitted to decode. Observer failures and
 * post-terminal bookkeeping stay at the streaming/orchestration boundary. */
export type DecodableSseFrameResult =
  | Extract<FrameResult, { kind: 'frame' }>
  | (Extract<FrameResult, { kind: 'malformed' }> & { afterTerminal: false });

export type OpenAiSseDecoder = {
  decode(frame: DecodableSseFrameResult): FrameDecodeResult;
};

type JsonObject = Record<string, unknown>;

const FINISH_REASON_LIMIT = 128;
const ERROR_DESCRIPTION_LIMIT = 200;
const DELTA_CATEGORY_ORDER: readonly UnmappedDeltaFieldCategory[] = [
  'role',
  'tool-calls',
  'refusal',
  'audio',
  'multimodal',
  'per-choice-usage',
  'other-extension',
];

/** Create a decoder whose only state is the per-choice chunk ordinal. */
export function createOpenAiSseDecoder(): OpenAiSseDecoder {
  const nextChunkIndex = new Map<number, number>();
  return { decode: (frame) => decodeFrame(frame, nextChunkIndex) };
}

/** Convenience decoder for one frame. Stateful streams should use the factory. */
export function decodeSseFrame(frame: DecodableSseFrameResult): FrameDecodeResult {
  return createOpenAiSseDecoder().decode(frame);
}

// fallow-ignore-next-line complexity -- closed decoder-result classification matrix
function decodeFrame(
  frame: DecodableSseFrameResult,
  nextChunkIndex: Map<number, number>,
): FrameDecodeResult {
  try {
    if (frame.kind === 'malformed') return { kind: 'malformed', code: frame.code };
    if (frame.terminal) return { kind: 'done' };

    let parsed: unknown;
    try {
      parsed = JSON.parse(frame.data) as unknown;
    } catch {
      return { kind: 'malformed', code: 'sse-invalid-data-json' };
    }
    if (!isObject(parsed)) return { kind: 'unrecognized' };

    if (isObject(parsed['error'])) {
      return {
        kind: 'events',
        events: [{
          kind: 'provider-error',
          code: 'provider-error-frame',
          description: providerErrorDescription(),
        }],
      };
    }

    const choices = parsed['choices'];
    const usage = parsed['usage'];
    if (choices === undefined && usage === undefined) return { kind: 'unrecognized' };
    if (choices !== undefined && !Array.isArray(choices)) return { kind: 'unrecognized' };
    if (usage !== undefined && !isObject(usage)) return { kind: 'unrecognized' };

    const events: StreamDecodedEvent[] = [];
    const seen = new Set<number>();
    const pendingOrdinals = new Map<number, number>();
    if (Array.isArray(choices)) {
      for (let position = 0; position < choices.length; position += 1) {
        const choice = choices[position];
        if (!isObject(choice)) return { kind: 'unrecognized' };
        const rawIndex = choice['index'];
        const choiceIndex = rawIndex === undefined ? position : rawIndex;
        if (!isNonNegativeInteger(choiceIndex) || seen.has(choiceIndex)) {
          return { kind: 'malformed', code: 'sse-invalid-choice-index' };
        }
        seen.add(choiceIndex);

        const delta = choice['delta'];
        const decodedDelta = decodeDelta(delta, choice);
        if (decodedDelta === null) return { kind: 'unrecognized' };
        const finishReason = normalizeFinishReason(choice['finish_reason']);
        const chunkIndex = nextChunkIndex.get(choiceIndex) ?? 0;
        pendingOrdinals.set(choiceIndex, chunkIndex + 1);
        events.push({
          kind: 'chunk',
          choiceIndex,
          chunkIndex,
          delta: decodedDelta.text,
          ...(finishReason !== undefined ? { finishReason } : {}),
          ...(decodedDelta.categories.length > 0
            ? { unmappedDeltaFields: decodedDelta.categories }
            : {}),
        });
      }
    }

    if (usage !== undefined) events.push(decodeUsage(usage));
    for (const [choiceIndex, ordinal] of pendingOrdinals) {
      nextChunkIndex.set(choiceIndex, ordinal);
    }
    return { kind: 'events', events };
  } catch {
    return { kind: 'decode-error', code: 'decode-error' };
  }
}

// fallow-ignore-next-line complexity -- closed unmapped-field category matrix
function decodeDelta(
  value: unknown,
  choice: JsonObject,
): { text: string | null; categories: readonly UnmappedDeltaFieldCategory[] } | null {
  if (value !== undefined && !isObject(value)) return null;
  const delta = value ?? Object.create(null) as JsonObject;
  const content = delta['content'];
  let text: string | null = null;
  const categories = new Set<UnmappedDeltaFieldCategory>();
  if (typeof content === 'string' || content === null || content === undefined) {
    text = typeof content === 'string' ? content : null;
  } else if (Array.isArray(content)) {
    categories.add('multimodal');
  } else {
    categories.add('other-extension');
  }

  for (const key of Object.keys(delta)) {
    if (key === 'content') continue;
    if (key === 'role') categories.add('role');
    else if (key === 'tool_calls') categories.add('tool-calls');
    else if (key === 'refusal') categories.add('refusal');
    else if (key === 'audio') categories.add('audio');
    else categories.add('other-extension');
  }
  if (Object.hasOwn(choice, 'usage')) categories.add('per-choice-usage');
  for (const key of Object.keys(choice)) {
    if (!['index', 'delta', 'finish_reason', 'usage'].includes(key)) categories.add('other-extension');
  }
  return {
    text,
    categories: DELTA_CATEGORY_ORDER.filter((category) => categories.has(category)),
  };
}

function decodeUsage(usage: JsonObject): StreamDecodedEvent {
  const inputTokens = tokenCount(usage['prompt_tokens']);
  const outputTokens = tokenCount(usage['completion_tokens']);
  const totalTokens = tokenCount(usage['total_tokens']);
  return {
    kind: 'usage',
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function tokenCount(value: unknown): number | undefined {
  return isNonNegativeInteger(value) ? value : undefined;
}

function normalizeFinishReason(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return [...value].slice(0, FINISH_REASON_LIMIT).join('');
}

function providerErrorDescription(): string {
  return [...'Provider reported an error.'].slice(0, ERROR_DESCRIPTION_LIMIT).join('');
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
