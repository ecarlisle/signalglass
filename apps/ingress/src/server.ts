import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { openaiAdapter, resolveProviderApiKey, type ProviderConfig } from '@signalglass/providers';
import {
  createDefaultCapturePolicy,
  createTraceEvent,
  redactAndTruncateSensitiveText,
  type Trace,
  type TraceEvent,
} from '@signalglass/core';
import type { IngressConfig } from './config.js';
import { selectProvider } from './routing.js';
import { forwardToUpstream } from './forward.js';

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
          reject(new Error(`Request body exceeds ${limitBytes} byte limit`));
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
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
    ...extraHeaders,
  });
  res.end(body);
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

async function handleChatCompletion(
  options: IngressServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { config, bodySizeLimitBytes = DEFAULT_BODY_SIZE_LIMIT_BYTES, onTrace } = options;

  let requestBody: unknown;
  try {
    requestBody = await readJsonBody(req, bodySizeLimitBytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request body';
    const status = message.includes('limit') ? 413 : 400;
    sendJson(res, status, { error: { message, type: 'invalid_request_error' } });
    return;
  }

  const reqRecord = (requestBody ?? {}) as Record<string, unknown>;
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
    const errorBody =
      typeof upstream.body === 'object' && upstream.body !== null
        ? upstream.body
        : { error: { message: 'Upstream request failed', type: 'api_error' } };
    sendJson(
      res,
      upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
      errorBody,
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

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    try {
      if (url === '/health' && method === 'GET') {
        handleHealth(res);
      } else if (url === '/v1/models' && method === 'GET') {
        handleModels(config.providers, res);
      } else if (url === '/v1/chat/completions' && method === 'POST') {
        await handleChatCompletion(options, req, res);
      } else {
        sendJson(res, 404, { error: { message: 'Not found', type: 'invalid_request_error' } });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      sendJson(res, 500, { error: { message, type: 'server_error' } });
    }
  });

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
