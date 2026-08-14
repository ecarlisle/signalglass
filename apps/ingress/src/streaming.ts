/** Spec 016 S5 live streaming ingress orchestration. */
import { once } from 'node:events';
import { request as httpRequest, type ClientRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Transform } from 'node:stream';
import { createGunzip, createInflate } from 'node:zlib';
import {
  createOpenAiSseDecoder,
  resolveProviderApiKey,
  type ProviderConfig,
} from '@signalglass/providers';
import { createSseParser, type AssemblerDecodedEvent, type AssemblyTerminal } from '@signalglass/streaming';
import type { ResponseMetadata, StreamingLossFacts, UnmappedDeltaFieldCategory } from '@signalglass/evidence';
import { selectProvider } from './routing.js';
import { buildUpstreamRequestHeaders } from './forward.js';
import { sendJsonAndWait, waitForClientResponseEnd } from './httpResponses.js';
import {
  StreamingEvidenceSession,
  persistEvidenceRecord,
  type StreamingEvidenceRuntime,
} from './streamingEvidence.js';

const UPSTREAM_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 30_000;

type CancelCause = 'client-disconnect' | 'ingress-shutdown' | 'configured-limit';

export interface StreamingRuntimeOptions extends StreamingEvidenceRuntime {
  streamIdleTimeoutMs?: number;
  shutdownSignal?: AbortSignal;
}

const BASE_STREAMING_LOSSES: StreamingLossFacts = {
  requestBody: 'no-bytes-observed',
  messageContent: 'not-observed',
  deltaContent: 'not-observed',
  providerNative: 'not-applicable',
  providerErrorBody: 'not-applicable',
  wireBytes: 'not-applicable',
  postTerminalContent: 'none-observed',
  unmappedDeltaFields: [],
  unrecognizedExtensionFrameObserved: false,
  headerValuesBeyondAllowlist: false,
  contentTypeParametersDropped: false,
  maskedContent: false,
  contentEncodingUnsupported: false,
  multimodalContentObserved: false,
  requestMessageUnknownKeysObserved: false,
  unrecognizedRoleObserved: false,
  sseMetadataObservedButNotRetained: false,
};

type PendingRequest = {
  traceId: string;
  provider: string;
  model: string;
  requestMessages: readonly unknown[];
};

export async function handleStreamingRequestFailure(
  runtime: StreamingRuntimeOptions,
  res: ServerResponse,
  pending: PendingRequest,
  code: 'invalid-request' | 'body-read-failure',
  status: number,
  message: string,
  requestBody: StreamingLossFacts['requestBody'],
  messageContent: StreamingLossFacts['messageContent'],
): Promise<void> {
  const outcome = await sendJsonAndWait(res, status, {
    error: { message, type: 'invalid_request_error' },
  }, { 'x-signalglass-trace-id': pending.traceId });
  const session = new StreamingEvidenceSession({
    ...pending,
    losses: { ...BASE_STREAMING_LOSSES, requestBody, messageContent },
    decoderDisposition: 'not-applicable',
  }, runtime.evidenceBudgets);
  const record = session.finalize(
    { kind: 'request-failed', code },
    {
      upstream: { outcome: 'not-started' },
      clientResponse: { outcome: outcome === 'flushed' ? 'local-error-flushed' : outcome },
      remainder: { knowledge: 'not-applicable' },
    },
    { ...BASE_STREAMING_LOSSES, requestBody, messageContent },
  );
  persistEvidenceRecord(runtime, record, pending.traceId);
}

async function respondRequestFailure(
  runtime: StreamingRuntimeOptions,
  res: ServerResponse,
  pending: PendingRequest,
  code: 'unroutable' | 'missing-api-key' | 'key-unavailable',
  message: string,
): Promise<void> {
  const status = code === 'unroutable' ? 400 : 500;
  const outcome = await sendJsonAndWait(res, status, {
    error: { message, type: code === 'unroutable' ? 'invalid_request_error' : 'server_error' },
  }, { 'x-signalglass-trace-id': pending.traceId });
  const losses = observedRequestLosses(pending);
  const session = nonSseEvidenceSession(runtime, pending, losses);
  const record = session.finalize(
    { kind: 'request-failed', code },
    {
      upstream: { outcome: 'not-started' },
      clientResponse: { outcome: outcome === 'flushed' ? 'local-error-flushed' : outcome },
      remainder: { knowledge: 'not-applicable' },
    },
    losses,
  );
  persistEvidenceRecord(runtime, record, pending.traceId);
}

function observedRequestLosses(pending: PendingRequest): StreamingLossFacts {
  return {
    ...BASE_STREAMING_LOSSES,
    requestBody: 'fully-observed-not-retained',
    messageContent: pending.requestMessages.length > 0 ? 'omitted' : 'not-observed',
  };
}

function nonSseEvidenceSession(
  runtime: StreamingRuntimeOptions,
  pending: PendingRequest,
  losses: StreamingLossFacts,
  responseMeta?: ResponseMetadata,
): StreamingEvidenceSession {
  return new StreamingEvidenceSession({
    ...pending,
    ...(responseMeta === undefined ? {} : { responseMeta }),
    losses,
    decoderDisposition: 'not-applicable',
  }, runtime.evidenceBudgets);
}

export async function handleStreamingChatCompletion(
  runtime: StreamingRuntimeOptions,
  providers: ProviderConfig[],
  req: IncomingMessage,
  res: ServerResponse,
  requestBody: unknown,
  reqRecord: Record<string, unknown>,
  traceId: string,
): Promise<void> {
  const model = typeof reqRecord.model === 'string' ? reqRecord.model : undefined;
  const requestMessages = Array.isArray(reqRecord.messages) ? reqRecord.messages : [];
  const provider = selectProvider(providers, model);
  const pending = {
    traceId,
    provider: provider?.id ?? 'unknown',
    model: model ?? provider?.defaultModel ?? 'unknown',
    requestMessages,
  };
  if (!provider) {
    await respondRequestFailure(runtime, res, pending, 'unroutable', 'No provider available for the requested model');
    return;
  }
  const apiKey = resolveProviderApiKey(provider);
  if (provider.apiKeyEnv && !apiKey) {
    await respondRequestFailure(
      runtime,
      res,
      pending,
      'missing-api-key',
      `Provider API key environment variable ${provider.apiKeyEnv} is not set`,
    );
    return;
  }

  const lifecycle = createCancellationLifecycle(req, res, runtime.shutdownSignal);
  let dispatched: DispatchedResponse;
  try {
    dispatched = await dispatchStreamingUpstream(provider, apiKey, requestBody, lifecycle);
  } catch (error) {
    await finalizeDispatchFailure(runtime, res, pending, lifecycle, error);
    lifecycle.dispose();
    return;
  }

  try {
    await handleUpstreamResponse(runtime, res, pending, dispatched, lifecycle);
  } finally {
    lifecycle.dispose();
  }
}

type DispatchedResponse = { upstreamRes: IncomingMessage; upstreamReq: ClientRequest };

async function dispatchStreamingUpstream(
  provider: ProviderConfig,
  apiKey: string | undefined,
  requestBody: unknown,
  lifecycle: CancellationLifecycle,
): Promise<DispatchedResponse> {
  const url = new URL(`${provider.baseUrl}/chat/completions`);
  const makeRequest = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const body = JSON.stringify(requestBody);
  const headers = buildUpstreamRequestHeaders(provider, apiKey, body, { 'accept-encoding': 'identity' });

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      action();
    };
    const upstreamReq = makeRequest({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers,
    }, (upstreamRes) => finish(() => resolve({ upstreamRes, upstreamReq })));
    lifecycle.attachRequest(upstreamReq);
    const timeoutId = setTimeout(() => {
      upstreamReq.destroy();
      finish(() => reject(Object.assign(new Error('upstream connect timeout'), { code: 'upstream-timeout' })));
    }, UPSTREAM_CONNECT_TIMEOUT_MS);
    upstreamReq.once('error', (error) => finish(() => reject(error)));
    upstreamReq.end(body);
  });
}

async function finalizeDispatchFailure(
  runtime: StreamingRuntimeOptions,
  res: ServerResponse,
  pending: PendingRequest,
  lifecycle: CancellationLifecycle,
  error: unknown,
): Promise<void> {
  const cancellation = lifecycle.cause;
  if (cancellation !== undefined && !res.destroyed) res.destroy();
  const responseOutcome = cancellation === undefined
    ? await sendJsonAndWait(res, 502, { error: { message: 'Upstream request failed', type: 'api_error' } }, {
      'x-signalglass-trace-id': pending.traceId,
    })
    : await waitForClientResponseEnd(res);
  const losses = observedRequestLosses(pending);
  const session = nonSseEvidenceSession(runtime, pending, losses);
  const record = session.finalize(dispatchFailureTerminal(cancellation, error), {
    upstream: cancellationUpstream(cancellation),
    clientResponse: { outcome: localErrorOutcome(cancellation, responseOutcome) },
    remainder: cancellation === undefined
      ? { knowledge: 'not-applicable' }
      : { knowledge: 'unknown' },
  }, losses);
  persistEvidenceRecord(runtime, record, pending.traceId);
}

function dispatchFailureTerminal(cancellation: CancelCause | undefined, error: unknown): AssemblyTerminal {
  if (cancellation === 'client-disconnect') return { kind: 'client-cancelled' };
  if (cancellation !== undefined) return { kind: 'ingress-cancelled' };
  return {
    kind: 'upstream-failed',
    code: (error as { code?: string }).code === 'upstream-timeout' ? 'upstream-timeout' : 'connection-error',
  };
}

function cancellationUpstream(cancellation: CancelCause | undefined) {
  return cancellation === undefined
    ? { outcome: 'connection-failed' as const }
    : { outcome: 'cancelled-by-ingress' as const, cause: cancellation };
}

function localErrorOutcome(
  cancellation: CancelCause | undefined,
  outcome: 'flushed' | 'closed-before-completion' | 'not-started',
) {
  return cancellation === undefined && outcome === 'flushed' ? 'local-error-flushed' as const : outcome;
}

async function handleUpstreamResponse(
  runtime: StreamingRuntimeOptions,
  res: ServerResponse,
  pending: PendingRequest,
  dispatched: DispatchedResponse,
  lifecycle: CancellationLifecycle,
): Promise<void> {
  const { upstreamRes } = dispatched;
  lifecycle.attachResponse(upstreamRes);
  const status = upstreamRes.statusCode ?? 0;
  const contentType = normalizeContentType(upstreamRes.headers['content-type']);
  const contentEncoding = normalizeContentEncoding(upstreamRes.headers['content-encoding']);
  const responseMeta: ResponseMetadata = {
    statusCode: status,
    ...(contentType.mediaType === undefined ? {} : { contentType: contentType.mediaType }),
    ...(contentEncoding === undefined ? {} : { contentEncoding }),
  };
  const losses: StreamingLossFacts = {
    ...BASE_STREAMING_LOSSES,
    requestBody: 'fully-observed-not-retained',
    messageContent: 'fully-retained',
    contentTypeParametersDropped: contentType.hadParameters,
  };

  if (status < 200 || status >= 300) {
    await handleHttpError(runtime, res, pending, upstreamRes, responseMeta, losses, status);
    return;
  }
  if (contentType.mediaType !== 'text/event-stream') {
    await handleNonSse(runtime, res, pending, upstreamRes, responseMeta, losses, status, contentType.mediaType);
    return;
  }
  await handleSse(runtime, res, pending, upstreamRes, responseMeta, losses, contentEncoding, lifecycle);
}

async function handleHttpError(
  runtime: StreamingRuntimeOptions,
  res: ServerResponse,
  pending: PendingRequest,
  upstreamRes: IncomingMessage,
  responseMeta: ResponseMetadata,
  losses: StreamingLossFacts,
  status: number,
): Promise<void> {
  await drainBounded(upstreamRes);
  const outcome = await sendJsonAndWait(res, status >= 400 && status < 600 ? status : 502, {
    error: { message: 'Upstream request failed', type: 'api_error', upstreamStatus: status },
  }, { 'x-signalglass-trace-id': pending.traceId });
  const finalLosses = { ...losses, providerErrorBody: 'not-retained' as const };
  const session = nonSseEvidenceSession(runtime, pending, finalLosses, responseMeta);
  persistEvidenceRecord(runtime, session.finalize(
    { kind: 'upstream-failed', code: 'http-error-status' },
    {
      upstream: { outcome: 'response-completed' },
      clientResponse: { outcome: outcome === 'flushed' ? 'local-error-flushed' : outcome },
      remainder: { knowledge: 'transport-eof-observed' },
    },
    finalLosses,
  ), pending.traceId);
}

async function handleNonSse(
  runtime: StreamingRuntimeOptions,
  res: ServerResponse,
  pending: PendingRequest,
  upstreamRes: IncomingMessage,
  responseMeta: ResponseMetadata,
  losses: StreamingLossFacts,
  status: number,
  mediaType: string | undefined,
): Promise<void> {
  const body = await drainBounded(upstreamRes);
  let validObject = false;
  try {
    const parsed = JSON.parse(body.toString('utf8')) as unknown;
    validObject = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    validObject = false;
  }
  let responseOutcome: 'flushed' | 'closed-before-completion' | 'not-started';
  if (validObject) {
    const headers: Record<string, string> = { 'x-signalglass-trace-id': pending.traceId };
    if (mediaType !== undefined) headers['content-type'] = mediaType;
    if (responseMeta.contentEncoding !== undefined) headers['content-encoding'] = responseMeta.contentEncoding;
    res.writeHead(status, headers);
    res.end(body);
    responseOutcome = await waitForClientResponseEnd(res);
  } else {
    responseOutcome = await sendJsonAndWait(res, 502, {
      error: { message: 'Upstream returned an invalid response body', type: 'api_error' },
    }, { 'x-signalglass-trace-id': pending.traceId });
  }
  const session = nonSseEvidenceSession(runtime, pending, losses, responseMeta);
  persistEvidenceRecord(runtime, session.finalize(
    { kind: 'upstream-failed', code: 'non-sse-response' },
    {
      upstream: { outcome: 'response-completed' },
      clientResponse: {
        outcome: validObject
          ? responseOutcome
          : responseOutcome === 'flushed' ? 'local-error-flushed' : responseOutcome,
      },
      remainder: { knowledge: 'transport-eof-observed' },
    },
    losses,
  ), pending.traceId);
}

async function handleSse(
  runtime: StreamingRuntimeOptions,
  res: ServerResponse,
  pending: PendingRequest,
  upstreamRes: IncomingMessage,
  responseMeta: ResponseMetadata,
  losses: StreamingLossFacts,
  contentEncoding: string | undefined,
  lifecycle: CancellationLifecycle,
): Promise<void> {
  const disposition = decoderDisposition(contentEncoding);
  res.writeHead(responseMeta.statusCode, sseResponseHeaders(pending.traceId, contentEncoding));
  const finalLosses = sseInitialLosses(losses, disposition);
  const evidence = new StreamingEvidenceSession({
    ...pending, responseMeta, losses: finalLosses, decoderDisposition: disposition,
  }, runtime.evidenceBudgets);
  const observer = disposition === 'openai-sse' ? createSseObserver(evidence) : undefined;
  const decoderTee = createDecoderTee(contentEncoding, observer);
  const transport = await pumpSseTransport(
    upstreamRes,
    res,
    decoderTee,
    lifecycle,
    runtime.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  );

  const terminal = observer?.terminal(lifecycle.cause, transport.upstreamCompleted) ?? {
    kind: 'observation-detached', code: 'observation-encoding-unsupported',
  } as const;
  const parserFacts = observer?.facts();
  const lossesAtEnd = mergeSseParserFacts(finalLosses, parserFacts);
  const record = evidence.finalize(terminal, {
    upstream: sseUpstreamOutcome(lifecycle.cause, transport.upstreamFailed),
    clientResponse: { outcome: transport.clientOutcome },
    remainder: {
      knowledge: sseRemainderKnowledge(terminal, observer?.doneObserved === true),
      ...(observer !== undefined && observer.framePosition > 0
        ? { lastObservedFramePosition: observer.framePosition }
        : {}),
      rawForwardedBytes: transport.rawForwardedBytes,
    },
  }, lossesAtEnd);
  persistEvidenceRecord(runtime, record, pending.traceId);
}

function decoderDisposition(contentEncoding: string | undefined): 'openai-sse' | 'unsupported-encoding' {
  return contentEncoding === undefined || contentEncoding === 'identity'
    || contentEncoding === 'gzip' || contentEncoding === 'deflate'
    ? 'openai-sse'
    : 'unsupported-encoding';
}

function sseResponseHeaders(traceId: string, contentEncoding: string | undefined): Record<string, string> {
  return {
    'content-type': 'text/event-stream',
    'x-signalglass-trace-id': traceId,
    ...(contentEncoding === undefined ? {} : { 'content-encoding': contentEncoding }),
  };
}

function sseInitialLosses(
  losses: StreamingLossFacts,
  disposition: 'openai-sse' | 'unsupported-encoding',
): StreamingLossFacts {
  return {
    ...losses,
    wireBytes: 'not-retained',
    contentEncodingUnsupported: disposition === 'unsupported-encoding',
  };
}

function mergeSseParserFacts(
  losses: StreamingLossFacts,
  facts: SseObserverFacts | undefined,
): StreamingLossFacts {
  if (facts === undefined) return losses;
  return {
    ...losses,
    postTerminalContent: facts.postTerminal,
    sseMetadataObservedButNotRetained: facts.sseMetadataObservedButNotRetained,
    unrecognizedExtensionFrameObserved: facts.unrecognizedExtensionFrameObserved,
    unmappedDeltaFields: facts.unmappedDeltaFields,
  };
}

function sseUpstreamOutcome(cause: CancelCause | undefined, upstreamFailed: boolean) {
  if (cause !== undefined) return { outcome: 'cancelled-by-ingress' as const, cause };
  return upstreamFailed
    ? { outcome: 'stream-ended-prematurely' as const }
    : { outcome: 'response-completed' as const };
}

function sseRemainderKnowledge(
  terminal: AssemblyTerminal,
  doneObserved: boolean,
): 'unknown' | 'protocol-terminal-observed' | 'transport-eof-observed' {
  if (terminal.kind === 'observation-detached'
    || terminal.kind === 'client-cancelled'
    || terminal.kind === 'ingress-cancelled') return 'unknown';
  return doneObserved ? 'protocol-terminal-observed' : 'transport-eof-observed';
}

type SseTransportResult = {
  rawForwardedBytes: number;
  upstreamCompleted: boolean;
  upstreamFailed: boolean;
  clientOutcome: 'flushed' | 'closed-before-completion' | 'not-started';
};

async function pumpSseTransport(
  upstreamRes: IncomingMessage,
  res: ServerResponse,
  decoderTee: DecoderTee | undefined,
  lifecycle: CancellationLifecycle,
  idleTimeoutMs: number,
): Promise<SseTransportResult> {
  const idle = createIdleLimit(idleTimeoutMs, lifecycle);
  let rawForwardedBytes = 0;
  let upstreamCompleted = false;
  let upstreamFailed = false;
  try {
    for await (const value of upstreamRes) {
      if (lifecycle.cause !== undefined) break;
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      rawForwardedBytes += chunk.byteLength;
      const writable = res.write(chunk);
      idle.progress();
      await decoderTee?.write(chunk);
      if (!writable) await waitForDrainOrClose(res);
    }
    if (lifecycle.cause === undefined) {
      upstreamCompleted = upstreamRes.complete;
      upstreamFailed = !upstreamCompleted;
    }
  } catch {
    upstreamFailed = lifecycle.cause === undefined;
  } finally {
    idle.dispose();
    await decoderTee?.finish(lifecycle.cause === undefined && !upstreamFailed);
  }
  const clientOutcome = await finishClientStream(res, lifecycle.cause !== undefined || upstreamFailed);
  return { rawForwardedBytes, upstreamCompleted, upstreamFailed, clientOutcome };
}

async function finishClientStream(
  res: ServerResponse,
  interrupted: boolean,
): Promise<SseTransportResult['clientOutcome']> {
  if (interrupted) {
    if (!res.destroyed) res.destroy();
  } else {
    res.end();
  }
  return waitForClientResponseEnd(res);
}

type SseObserverFacts = {
  postTerminal: StreamingLossFacts['postTerminalContent'];
  sseMetadataObservedButNotRetained: boolean;
  unrecognizedExtensionFrameObserved: boolean;
  unmappedDeltaFields: readonly UnmappedDeltaFieldCategory[];
};

type SseObserver = {
  push(chunk: Uint8Array): void;
  finish(): void;
  terminal(cause: CancelCause | undefined, upstreamCompleted: boolean): AssemblyTerminal;
  facts(): SseObserverFacts;
  readonly framePosition: number;
  readonly doneObserved: boolean;
  detachDecodeFailure(): void;
};

function createSseObserver(evidence: StreamingEvidenceSession): SseObserver {
  const parser = createSseParser();
  const decoder = createOpenAiSseDecoder();
  let framePosition = 0;
  let doneObserved = false;
  let malformed: Extract<AssemblyTerminal, { kind: 'malformed-stream' }>['code'] | undefined;
  let detached: Extract<AssemblyTerminal, { kind: 'observation-detached' }>['code'] | undefined;
  let providerError = false;
  let unrecognizedExtensionFrameObserved = false;
  const categories = new Set<UnmappedDeltaFieldCategory>();

  const observeDecoded = (events: readonly AssemblerDecodedEvent[]): void => {
    for (const event of events) {
      evidence.observe(event);
      if (event.kind === 'provider-error') providerError = true;
      if (event.kind === 'chunk') {
        for (const category of event.unmappedDeltaFields ?? []) categories.add(category);
      }
    }
  };

  const consumeNonFrame = (result: ReturnType<typeof parser.push>[number]): boolean => {
    if (result.kind === 'post-terminal-content') return true;
    if (result.kind === 'observation-failure') {
      if (!result.afterTerminal) detached ??= result.code;
      return true;
    }
    if (result.kind === 'malformed') {
      if (!result.afterTerminal) malformed ??= result.code;
      return true;
    }
    return false;
  };

  const consumeDecoded = (decoded: ReturnType<typeof decoder.decode>): void => {
    if (decoded.kind === 'events') observeDecoded(decoded.events as readonly AssemblerDecodedEvent[]);
    else if (decoded.kind === 'unrecognized') unrecognizedExtensionFrameObserved = true;
    else if (decoded.kind === 'malformed') malformed ??= decoded.code;
    else if (decoded.kind === 'decode-error') detached ??= decoded.code;
  };

  const consumeFrame = (result: ReturnType<typeof parser.push>[number]): void => {
    if (consumeNonFrame(result)) return;
    if (result.kind !== 'frame') return;
    framePosition += 1;
    if (result.terminal) {
      doneObserved = true;
      return;
    }
    if (malformed !== undefined || detached !== undefined || doneObserved || evidence.detached) return;
    consumeDecoded(decoder.decode(result));
  };

  const consume = (results: ReturnType<typeof parser.push>): void => {
    for (const result of results) consumeFrame(result);
  };

  const safelyConsume = (operation: () => ReturnType<typeof parser.push>): void => {
    try {
      consume(operation());
    } catch {
      detached ??= 'internal-capture-error';
      evidence.detach('internal-capture-error');
    }
  };

  return {
    push: (chunk) => safelyConsume(() => parser.push(chunk)),
    finish: () => safelyConsume(() => parser.finish()),
    terminal: (cause, upstreamCompleted) => selectSseTerminal({
      detached: detached ?? (evidence.detached ? 'record-budget-exceeded' : undefined),
      malformed,
      providerError,
      doneObserved,
      cause,
      upstreamCompleted,
    }),
    facts: () => {
      const facts = parser.facts('openai-sse');
      return {
        postTerminal: facts.postTerminal,
        sseMetadataObservedButNotRetained: facts.sseMetadataObservedButNotRetained,
        unrecognizedExtensionFrameObserved,
        unmappedDeltaFields: [...categories],
      };
    },
    get framePosition() { return framePosition; },
    get doneObserved() { return doneObserved; },
    detachDecodeFailure: () => {
      detached ??= 'observation-decode-failure';
      evidence.detach('observation-decode-failure');
    },
  };
}

type SseTerminalState = {
  detached?: Extract<AssemblyTerminal, { kind: 'observation-detached' }>['code'];
  malformed?: Extract<AssemblyTerminal, { kind: 'malformed-stream' }>['code'];
  providerError: boolean;
  doneObserved: boolean;
  cause: CancelCause | undefined;
  upstreamCompleted: boolean;
};

function selectSseTerminal(state: SseTerminalState): AssemblyTerminal {
  if (state.detached !== undefined) return { kind: 'observation-detached', code: state.detached };
  if (state.malformed !== undefined) return { kind: 'malformed-stream', code: state.malformed };
  if (state.providerError) return { kind: 'upstream-failed', code: 'provider-error-frame' };
  if (state.doneObserved) return { kind: 'completed' };
  if (state.cause === 'client-disconnect') return { kind: 'client-cancelled' };
  if (state.cause !== undefined) return { kind: 'ingress-cancelled' };
  return state.upstreamCompleted
    ? { kind: 'malformed-stream', code: 'sse-eof-without-done' }
    : { kind: 'upstream-failed', code: 'connection-error' };
}

type DecoderTee = { write(chunk: Buffer): Promise<void>; finish(observationEof: boolean): Promise<void> };

function createDecoderTee(contentEncoding: string | undefined, observer: SseObserver | undefined): DecoderTee | undefined {
  if (observer === undefined) return undefined;
  if (contentEncoding === undefined || contentEncoding === 'identity') {
    return {
      write: async (chunk) => observer.push(chunk),
      finish: async (observationEof) => { if (observationEof) observer.finish(); },
    };
  }
  const transform = contentEncoding === 'gzip' ? createGunzip() : createInflate();
  return zlibDecoderTee(transform, observer);
}

function zlibDecoderTee(transform: Transform, observer: SseObserver): DecoderTee {
  let failed = false;
  transform.on('data', (chunk: Buffer) => observer.push(chunk));
  transform.on('error', () => {
    failed = true;
    observer.detachDecodeFailure();
  });
  return {
    write: async (chunk) => {
      if (failed) return;
      if (!transform.write(chunk)) await once(transform, 'drain').catch(() => undefined);
    },
    finish: async (observationEof) => {
      if (failed || transform.destroyed) return;
      if (!observationEof) {
        transform.destroy();
        return;
      }
      transform.end();
      await Promise.race([once(transform, 'end'), once(transform, 'error')]).catch(() => undefined);
    },
  };
}

type CancellationLifecycle = {
  readonly cause: CancelCause | undefined;
  cancel(cause: CancelCause): void;
  attachRequest(request: ClientRequest): void;
  attachResponse(response: IncomingMessage): void;
  dispose(): void;
};

function createCancellationLifecycle(
  req: IncomingMessage,
  res: ServerResponse,
  shutdownSignal?: AbortSignal,
): CancellationLifecycle {
  let cause: CancelCause | undefined;
  let request: ClientRequest | undefined;
  let response: IncomingMessage | undefined;
  const cancel = (nextCause: CancelCause): void => {
    cause ??= nextCause;
    request?.destroy();
    response?.destroy();
  };
  const onClientClose = (): void => {
    if (!res.writableFinished) cancel('client-disconnect');
  };
  const onShutdown = (): void => cancel('ingress-shutdown');
  res.on('close', onClientClose);
  req.socket.on('close', onClientClose);
  shutdownSignal?.addEventListener('abort', onShutdown, { once: true });
  if (req.socket.destroyed || res.destroyed) onClientClose();
  if (shutdownSignal?.aborted === true) onShutdown();
  return {
    get cause() { return cause; },
    cancel,
    attachRequest: (next) => {
      request = next;
      if (cause !== undefined) next.destroy();
    },
    attachResponse: (next) => {
      response = next;
      if (cause !== undefined) next.destroy();
    },
    dispose: () => {
      res.off('close', onClientClose);
      req.socket.off('close', onClientClose);
      shutdownSignal?.removeEventListener('abort', onShutdown);
    },
  };
}

function createIdleLimit(timeoutMs: number, lifecycle: CancellationLifecycle): { progress(): void; dispose(): void } {
  let timer: NodeJS.Timeout;
  const reset = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => lifecycle.cancel('configured-limit'), timeoutMs);
  };
  reset();
  return { progress: reset, dispose: () => clearTimeout(timer) };
}

async function waitForDrainOrClose(res: ServerResponse): Promise<void> {
  if (res.destroyed) return;
  await Promise.race([once(res, 'drain'), once(res, 'close')]).catch(() => undefined);
}

async function drainBounded(stream: IncomingMessage, limit = 16 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    length += chunk.byteLength;
    if (length > limit) throw new RangeError('upstream response body exceeds bounded drain limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

function normalizeContentType(value: string | string[] | undefined): { mediaType?: string; hadParameters: boolean } {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || raw.length === 0) return { hadParameters: false };
  const [mediaType, ...parameters] = raw.split(';');
  const normalized = mediaType.trim().toLowerCase();
  return {
    ...(normalized.length === 0 ? {} : { mediaType: normalized }),
    hadParameters: parameters.length > 0,
  };
}

function normalizeContentEncoding(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 255 && /^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(normalized)
    ? normalized
    : undefined;
}
