/**
 * Envelope types (Spec 014 §2.2.4–§2.2.5). Provider-native payloads are
 * preserved at a declared fidelity; `providerNative` is never flattened.
 */
import type { ContentHash } from './types-base.js';
import type { ProviderNativeFidelity } from './vocabulary.js';

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
} & NativeByteFields;