/**
 * Envelope types (Spec 014 §2.2.4–§2.2.5). Provider-native payloads are
 * preserved at a declared fidelity; `providerNative` is never flattened.
 */
import type { ContentHash } from './types-base.js';
import type { ProviderNativeFidelity, NormalizedRole, LeafOwnerStatus } from './vocabulary.js';
import type {
  LeafRedactionDeclaration,
  LeafTruncationDeclaration,
} from './types-base.js';

/**
 * Native-fidelity fields present on an envelope ONLY when the payload is
 * `byte_faithful` and the event `evidenceStatus` is `captured`. `nativeEncoding`
 * records the original character encoding (e.g. `utf-8`); `nativeContentHash`
 * is over the exact observed native bytes, never the Base64-encoded text
 * (§5.7).
 */
export type NativeByteFields = {
  nativeEncoding?: string;
  nativeContentType?: string;
  nativeContentHash?: ContentHash;
};

/**
 * Request envelope: normalized common fields plus the provider-native payload
 * at a declared fidelity (Spec 013 §3.2). `messages` is the canonical common
 * model; `providerNative` is preserved verbatim.
 */
export type RequestEnvelope = {
  model: string;
  provider: string;
  providerNativeFidelity: ProviderNativeFidelity;
  messages?: unknown;
  providerNative?: unknown;
} & NativeByteFields;

type ResponseEnvelopeCommon = {
  providerNativeFidelity: ProviderNativeFidelity;
} & NativeByteFields;

export type ResponseMetadata = {
  statusCode: number;
  contentType?: string;
  contentEncoding?: string;
};

/** Schema-1.0 response envelope. EventRecord is not schema-versioned, so
 * both response event variants retain this legacy-compatible alternative. */
export type LegacyResponseEnvelope = ResponseEnvelopeCommon & {
  finishReason?: string;
  providerNative?: unknown;
  usage?: unknown;
  chunkIndex?: number;
  responseMeta?: never;
  choiceIndex?: never;
  deltaText?: never;
};

/** Schema-1.1 metadata-only response envelope. */
export type StreamingResponseHeaderEnvelope = ResponseEnvelopeCommon & {
  responseMeta: ResponseMetadata;
  finishReason?: never;
  providerNative?: never;
  usage?: never;
  chunkIndex?: never;
  choiceIndex?: never;
  deltaText?: never;
};

/** Schema-1.1 streaming chunk response envelope. */
export type StreamingResponseChunkEnvelope = ResponseEnvelopeCommon & {
  finishReason?: string;
  providerNative?: unknown;
  usage?: unknown;
  chunkIndex?: number;
  choiceIndex: number;
  deltaText?: string;
  responseMeta?: never;
};

/** Header-event envelope across the supported schema-1 versions. */
export type ResponseHeaderEnvelope = LegacyResponseEnvelope | StreamingResponseHeaderEnvelope;

/** Chunk-event envelope across the supported schema-1 versions. */
export type ResponseChunkEnvelope = LegacyResponseEnvelope | StreamingResponseChunkEnvelope;

/** Event-discriminated response envelope union. */
export type ResponseEnvelope = ResponseHeaderEnvelope | ResponseChunkEnvelope;

/** Leaf-level request message content (Spec 016 §8.7). Each message
 * is a content leaf with its own evidence status and declarations. */
export type ContentLeaf = {
  text: string;
  evidenceStatus: LeafOwnerStatus;
  redaction?: LeafRedactionDeclaration;
  truncation?: LeafTruncationDeclaration;
};

export type NormalizedContentPart =
  | { kind: 'text'; text: ContentLeaf }
  | { kind: 'image_url'; url: ContentLeaf }
  | { kind: 'tool_call'; id: string; name: string; arguments: ContentLeaf }
  | { kind: 'tool_result'; toolCallId: string; content: ContentLeaf };

export type RequestMessage = {
  role: NormalizedRole;
  content: ContentLeaf | readonly NormalizedContentPart[];
  name?: string;
};

/** Request message collection for schema versions ≥ 1.1.x. */
export type RequestMessages = readonly RequestMessage[];
