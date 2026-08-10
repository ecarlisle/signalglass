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

/** Response envelope, including stream chunks and final usage. */
export type ResponseEnvelope = {
  providerNativeFidelity: ProviderNativeFidelity;
  finishReason?: string;
  providerNative?: unknown;
  usage?: unknown;
  chunkIndex?: number;
  /** Response metadata: present on the first model_response event only (§13.3). */
  responseMeta?: {
    statusCode: number;
    contentType?: string;
    contentEncoding?: string;
  };
  /** Choice index identity: present on chunk events (§13.5). */
  choiceIndex?: number;
  /** Delta text content: present on model_response_chunk events when retained (§13.5). */
  deltaText?: string;
} & NativeByteFields;

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
