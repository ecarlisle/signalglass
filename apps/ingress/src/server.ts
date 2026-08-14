import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { openaiAdapter, resolveProviderApiKey, type ProviderConfig } from '@signalglass/providers';
import {
  createDefaultCapturePolicy,
  createTraceEvent,
  redactAndTruncateSensitiveText,
  type Trace,
  type TraceEvent,
} from '@signalglass/core';
import { validateEvidenceBudgets, type EvidenceBudgets } from '@signalglass/streaming';
import type { EvidenceRecord } from '@signalglass/evidence';
import type { EvidenceStorage, SaveOutcome } from '@signalglass/storage';
import type { IngressConfig } from './config.js';
import { selectProvider } from './routing.js';
import { forwardToUpstream } from './forward.js';
import {
  handleStreamingChatCompletion,
  handleStreamingRequestFailure,
} from './streaming.js';
import type { PersistenceFailureCode } from './streamingEvidence.js';
import { sendJson } from './httpResponses.js';

const DEFAULT_PORT = 8080;
export const DEFAULT_BODY_SIZE_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ERROR_SUMMARY_LENGTH = 240;

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function setTraceId(events: TraceEvent[], traceId: string): TraceEvent[] {
  return events.map((event) => ({ ...event, traceId }));
}

async function readJsonBody(
  req: IncomingMessage,
  limitBytes: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let limitExceeded = false;
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk, 'utf8');
      if (size > limitBytes) {
        if (!limitExceeded) {
          limitExceeded = true;
          body = '';
          reject(new RequestBodyError('over-limit', size, `Request body exceeds ${limitBytes} byte limit`));
        }
        req.resume();
        return;
      }
      if (!limitExceeded) {
        body += chunk;
      }
    });
    req.on('end', () => {
      if (limitExceeded) return;
      try {
        resolve(body ? JSON.parse(body) : undefined);
      } catch (error) {
        reject(new RequestBodyError('malformed', size, error instanceof Error ? error.message : 'Invalid JSON'));
      }
    });
    req.on('error', () => reject(new RequestBodyError('read-failure', size, 'Request body read failed')));
  });
}

class RequestBodyError extends Error {
  constructor(
    readonly kind: 'over-limit' | 'malformed' | 'read-failure',
    readonly bytesRead: number,
    message: string,
  ) {
    super(message);
  }
}

function handleHealth(res: ServerResponse): void {
  sendJson(res, 200, { status: 'ok' });
}

function handleModels(providers: ProviderConfig[], res: ServerResponse): void {
  const models = providers.flatMap((provider) =>
    (provider.models ?? []).map((model) => ({
      id: model.id,
      object: 'model',
      owned_by: provider.id,
    })),
  );
  sendJson(res, 200, { object: 'list', data: models });
}

export interface IngressServerOptions {
  config: IngressConfig;
  port?: number;
  bodySizeLimitBytes?: number;
  onTrace?: (trace: Trace) => void | Promise<void>;
  /** Spec 016 S5: persistence for streaming interactions' canonical
   * EvidenceRecord. Optional, mirroring the existing legacy `onTrace`
   * pattern — when absent, streaming still runs but nothing is persisted. */
  evidenceStorage?: EvidenceStorage;
  evidenceBudgets?: EvidenceBudgets;
  onEvidenceRecord?: (record: EvidenceRecord, traceId: string) => void;
  onSaveOutcome?: (outcome: SaveOutcome, traceId: string) => void;
  onEvidenceSaveError?: (code: PersistenceFailureCode, traceId: string) => void;
  streamIdleTimeoutMs?: number;
}

function sanitizeErrorSummary(value: string): string {
  return redactAndTruncateSensitiveText(value, MAX_ERROR_SUMMARY_LENGTH);
}

function makeProviderErrorEvent(
  traceId: string,
  provider: ProviderConfig,
  model: string | undefined,
  message: string,
  metadata: Record<string, unknown> = {},
): TraceEvent {
  return createTraceEvent({
    traceId,
    type: 'provider_error',
    contentPhase: 'observed',
    actor: { role: 'provider' },
    model,
    provider: provider.id,
    metadata: {
      ...metadata,
      message: sanitizeErrorSummary(message),
    },
  });
}

function assembleTrace(
  traceId: string,
  startedAt: string,
  provider: ProviderConfig,
  model: string | undefined,
  status: Trace['status'],
  events: TraceEvent[],
): Trace {
  return {
    id: traceId,
    startedAt,
    endedAt: new Date().toISOString(),
    provider: provider.id,
    model: model ?? provider.defaultModel,
    mode: 'standard',
    capturePolicy: createDefaultCapturePolicy('standard'),
    status,
    events,
    metadata: {
      baseUrl: provider.baseUrl,
    },
  };
}

async function emitTrace(
  onTrace: IngressServerOptions['onTrace'],
  trace: Trace,
): Promise<void> {
  if (onTrace) {
    await Promise.resolve(onTrace(trace));
  }
}

type ReadChatBodyResult = { ok: true; body: unknown } | { ok: false };

async function readChatBody(
  options: IngressServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<ReadChatBodyResult> {
  try {
    return { ok: true, body: await readJsonBody(req, options.bodySizeLimitBytes ?? DEFAULT_BODY_SIZE_LIMIT_BYTES) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request body';
    const bodyError = error instanceof RequestBodyError
      ? error
      : new RequestBodyError('read-failure', 0, message);
    await handleStreamingRequestFailure(
      streamingRuntime(options),
      res,
      { traceId: generateId(), provider: 'unknown', model: 'unknown', requestMessages: [] },
      bodyError.kind === 'read-failure' ? 'body-read-failure' : 'invalid-request',
      bodyError.kind === 'over-limit' ? 413 : 400,
      message,
      requestBodyLoss(bodyError),
      'not-observed',
    );
    return { ok: false };
  }
}

function requestBodyLoss(error: RequestBodyError) {
  if (error.kind === 'malformed') return 'fully-observed-not-retained' as const;
  return error.bytesRead === 0 ? 'no-bytes-observed' as const : 'partially-observed-not-retained' as const;
}

function streamingRuntime(options: IngressServerOptions, shutdownSignal?: AbortSignal) {
  return {
    evidenceStorage: options.evidenceStorage,
    evidenceBudgets: options.evidenceBudgets,
    onEvidenceRecord: options.onEvidenceRecord,
    onSaveOutcome: options.onSaveOutcome,
    onEvidenceSaveError: options.onEvidenceSaveError,
    streamIdleTimeoutMs: options.streamIdleTimeoutMs,
    shutdownSignal,
  };
}

async function handleStreamingBody(
  options: IngressServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
  requestBody: unknown,
  reqRecord: Record<string, unknown>,
  shutdownSignal?: AbortSignal,
): Promise<boolean> {
  if (reqRecord.stream !== true) return false;
  if (!validStreamingRequest(reqRecord)) {
    await handleStreamingRequestFailure(
      streamingRuntime(options),
      res,
      {
        traceId: generateId(),
        provider: 'unknown',
        model: typeof reqRecord.model === 'string' ? reqRecord.model : 'unknown',
        requestMessages: [],
      },
      'invalid-request',
      400,
      'Streaming chat completion requires a messages array and a string model when model is present',
      'fully-observed-not-retained',
      Object.hasOwn(reqRecord, 'messages') ? 'omitted' : 'not-observed',
    );
    return true;
  }
  await handleStreamingChatCompletion(
    streamingRuntime(options, shutdownSignal),
    options.config.providers,
    req,
    res,
    requestBody,
    reqRecord,
    generateId(),
  );
  return true;
}

function validStreamingRequest(request: Record<string, unknown>): boolean {
  if (!Array.isArray(request.messages)) return false;
  if (request.model !== undefined && typeof request.model !== 'string') return false;
  return request.messages.every((message) =>
    typeof message === 'object' && message !== null && !Array.isArray(message));
}

async function handleChatCompletion(
  options: IngressServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
  shutdownSignal?: AbortSignal,
): Promise<void> {
  const { config, onTrace } = options;
  const read = await readChatBody(options, req, res);
  if (!read.ok) return;
  const requestBody = read.body;
  const reqRecord = (requestBody ?? {}) as Record<string, unknown>;
  if (await handleStreamingBody(options, req, res, requestBody, reqRecord, shutdownSignal)) return;

  const model = typeof reqRecord.model === 'string' ? reqRecord.model : undefined;
  const provider = selectProvider(config.providers, model);

  if (!provider) {
    sendJson(res, 400, {
      error: { message: 'No provider available for the requested model', type: 'invalid_request_error' },
    });
    return;
  }

  const apiKey = resolveProviderApiKey(provider);
  if (provider.apiKeyEnv && !apiKey) {
    sendJson(res, 500, {
      error: {
        message: `Provider API key environment variable ${provider.apiKeyEnv} is not set`,
        type: 'server_error',
      },
    });
    return;
  }

  const traceId = generateId();
  const startedAt = new Date().toISOString();

  const requestEvents = setTraceId(openaiAdapter.normalizeRequest(requestBody, provider), traceId);

  let upstream;
  try {
    upstream = await forwardToUpstream(provider, apiKey, requestBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upstream request failed';
    const errorEvent = makeProviderErrorEvent(traceId, provider, model, message, {
      errorType: 'upstream_request_error',
    });
    const trace = assembleTrace(traceId, startedAt, provider, model, 'error', [
      ...requestEvents,
      errorEvent,
    ]);
    await emitTrace(onTrace, trace);
    sendJson(res, 502, {
      error: {
        message: 'Upstream request failed',
        type: 'api_error',
      },
    }, { 'x-signalglass-trace-id': traceId });
    return;
  }

  if (upstream.status < 200 || upstream.status >= 300) {
    const errorEvent = makeProviderErrorEvent(
      traceId,
      provider,
      model,
      `Upstream returned HTTP ${upstream.status}`,
      {
        status: upstream.status,
        errorType: 'upstream_non_2xx',
      },
    );
    const trace = assembleTrace(traceId, startedAt, provider, model, 'error', [
      ...requestEvents,
      errorEvent,
    ]);
    await emitTrace(onTrace, trace);
    sendJson(
      res,
      upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
      {
        error: {
          message: 'Upstream request failed',
          type: 'api_error',
          upstreamStatus: upstream.status,
        },
      },
      { 'x-signalglass-trace-id': traceId },
    );
    return;
  }

  if (typeof upstream.body !== 'object' || upstream.body === null) {
    const errorEvent = makeProviderErrorEvent(
      traceId,
      provider,
      model,
      'Upstream returned an invalid response body for /v1/chat/completions',
      {
        status: upstream.status,
        errorType: 'upstream_invalid_body',
      },
    );
    const trace = assembleTrace(traceId, startedAt, provider, model, 'error', [
      ...requestEvents,
      errorEvent,
    ]);
    await emitTrace(onTrace, trace);
    sendJson(res, 502, {
      error: {
        message: 'Upstream returned an invalid response body for /v1/chat/completions',
        type: 'api_error',
      },
    }, { 'x-signalglass-trace-id': traceId });
    return;
  }

  const responseEvents = setTraceId(openaiAdapter.normalizeResponse(upstream.body, provider), traceId);

  const allEvents = [...requestEvents, ...responseEvents];

  const trace = assembleTrace(traceId, startedAt, provider, model, 'success', allEvents);

  await emitTrace(onTrace, trace);

  const clientResponse = upstream.body;
  const body = JSON.stringify(clientResponse);
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
    'x-signalglass-trace-id': traceId,
  });
  res.end(body);
}

export function createIngressServer(options: IngressServerOptions): Server {
  const { config, port = DEFAULT_PORT } = options;

  // Spec 016 §3.5: evidence budgets are refused at startup when invalid or
  // an impossible combination — never silently clamped.
  if (options.evidenceBudgets !== undefined) {
    validateEvidenceBudgets(options.evidenceBudgets);
  }

  const shutdownController = new AbortController();
  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    try {
      if (url === '/health' && method === 'GET') {
        handleHealth(res);
      } else if (url === '/v1/models' && method === 'GET') {
        handleModels(config.providers, res);
      } else if (url === '/v1/chat/completions' && method === 'POST') {
        await handleChatCompletion(options, req, res, shutdownController.signal);
      } else {
        sendJson(res, 404, { error: { message: 'Not found', type: 'invalid_request_error' } });
      }
    } catch (error) {
      if (res.headersSent || res.destroyed) {
        res.destroy();
        return;
      }
      const message = error instanceof Error ? error.message : 'Internal server error';
      sendJson(res, 500, { error: { message, type: 'server_error' } });
    }
  });

  const close = server.close.bind(server);
  server.close = ((callback?: (error?: Error) => void) => {
    shutdownController.abort();
    return close(callback);
  }) as Server['close'];

  return server;
}

export function startIngressServer(options: IngressServerOptions): Promise<Server> {
  const server = createIngressServer(options);
  return new Promise((resolve) => {
    server.listen(options.port ?? DEFAULT_PORT, () => {
      resolve(server);
    });
  });
}
