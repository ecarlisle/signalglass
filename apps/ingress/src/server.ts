import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { openaiAdapter, resolveProviderApiKey, type ProviderConfig } from '@signalglass/providers';
import {
  createDefaultCapturePolicy,
  type Trace,
  type TraceEvent,
} from '@signalglass/core';
import type { IngressConfig } from './config.js';
import { selectProvider } from './routing.js';
import { forwardToUpstream } from './forward.js';

const DEFAULT_PORT = 8080;
export const DEFAULT_BODY_SIZE_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB

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
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk, 'utf8');
      if (size > limitBytes) {
        reject(new Error(`Request body exceeds ${limitBytes} byte limit`));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : undefined);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
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

  const upstream = await forwardToUpstream(provider, apiKey, requestBody);

  if (upstream.status < 200 || upstream.status >= 300) {
    const errorBody =
      typeof upstream.body === 'object' && upstream.body !== null
        ? upstream.body
        : { error: { message: 'Upstream request failed', type: 'api_error' } };
    sendJson(res, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, errorBody);
    return;
  }

  if (typeof upstream.body !== 'object' || upstream.body === null) {
    sendJson(res, 502, {
      error: {
        message: 'Upstream returned an invalid response body for /v1/chat/completions',
        type: 'api_error',
      },
    });
    return;
  }

  const responseEvents = setTraceId(openaiAdapter.normalizeResponse(upstream.body, provider), traceId);

  const allEvents = [...requestEvents, ...responseEvents];

  const trace: Trace = {
    id: traceId,
    startedAt,
    endedAt: new Date().toISOString(),
    provider: provider.id,
    model: model ?? provider.defaultModel,
    mode: 'standard',
    capturePolicy: createDefaultCapturePolicy('standard'),
    status: 'success',
    events: allEvents,
    metadata: {
      baseUrl: provider.baseUrl,
    },
  };

  // The trace is assembled but not persisted; storage is Spec 007.
  // The optional onTrace seam lets callers observe the trace without persistence.
  if (onTrace) {
    await Promise.resolve(onTrace(trace));
  }

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
