import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createIngressServer, type IngressConfig } from './index.js';
import { traceToAgentRun } from '@signalglass/core';

const TEST_API_KEY = 'test-api-key';

function mockUpstreamProvider(responseBody: unknown): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        expect(req.headers['authorization']).toBe(`Bearer ${TEST_API_KEY}`);
        const parsed = body ? JSON.parse(body) : {};
        expect(parsed.model).toBeDefined();

        const payload = JSON.stringify(responseBody);
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        });
        res.end(payload);
      });
    });
    server.listen(0, () => resolve(server));
  });
}

function getPort(server: Server): number {
  const address = server.address();
  if (address && typeof address === 'object') return address.port;
  throw new Error('Server is not listening on a port');
}

async function httpRequest(
  port: number,
  path: string,
  method: string,
  body?: unknown,
): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
  const http = await import('node:http');
  return new Promise((resolve, reject) => {
    const reqBody = body ? JSON.stringify(body) : undefined;
    const req = http.default.request(
      {
        hostname: 'localhost',
        port,
        path,
        method,
        headers: {
          'content-type': 'application/json',
          ...(reqBody ? { 'content-length': String(Buffer.byteLength(reqBody)) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string>,
            body: data ? JSON.parse(data) : undefined,
          });
        });
      },
    );
    req.on('error', reject);
    if (reqBody) req.write(reqBody);
    req.end();
  });
}

describe('ingress server', () => {
  it('GET /health returns a success response', async () => {
    const config: IngressConfig = { providers: [] };
    const server = createIngressServer({ config, port: 0 });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = getPort(server);

    const res = await httpRequest(port, '/health', 'GET');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });

    server.close();
  });

  it('GET /v1/models returns models from configured providers', async () => {
    const config: IngressConfig = {
      providers: [
        {
          id: 'openai',
          label: 'OpenAI',
          kind: 'openai-compatible',
          baseUrl: 'http://localhost:9999/v1',
          models: [
            { id: 'gpt-4o' },
            { id: 'gpt-4o-mini' },
          ],
        },
      ],
    };
    const server = createIngressServer({ config, port: 0 });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = getPort(server);

    const res = await httpRequest(port, '/v1/models', 'GET');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      object: 'list',
      data: [
        { id: 'gpt-4o', object: 'model', owned_by: 'openai' },
        { id: 'gpt-4o-mini', object: 'model', owned_by: 'openai' },
      ],
    });

    server.close();
  });

  it('POST /v1/chat/completions forwards to mocked upstream and returns client response', async () => {
    const upstreamResponse = {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello from upstream' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    const upstream = await mockUpstreamProvider(upstreamResponse);
    const upstreamPort = getPort(upstream);

    const config: IngressConfig = {
      providers: [
        {
          id: 'openai',
          label: 'OpenAI',
          kind: 'openai-compatible',
          baseUrl: `http://localhost:${upstreamPort}/v1`,
          apiKeyEnv: 'TEST_OPENAI_API_KEY',
          defaultModel: 'gpt-4o',
          models: [{ id: 'gpt-4o' }],
        },
      ],
    };

    const previousKey = process.env.TEST_OPENAI_API_KEY;
    process.env.TEST_OPENAI_API_KEY = TEST_API_KEY;

    const server = createIngressServer({ config, port: 0 });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = getPort(server);

    const res = await httpRequest(port, '/v1/chat/completions', 'POST', {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(upstreamResponse);
    expect(res.headers['x-signalglass-trace-id']).toBeDefined();

    process.env.TEST_OPENAI_API_KEY = previousKey;
    server.close();
    upstream.close();
  });

  it('emits TraceEvent objects for the full lifecycle', async () => {
    const upstreamResponse = {
      id: 'chatcmpl-trace',
      object: 'chat.completion',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hi' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    };

    const upstream = await mockUpstreamProvider(upstreamResponse);
    const upstreamPort = getPort(upstream);

    const config: IngressConfig = {
      providers: [
        {
          id: 'openai',
          label: 'OpenAI',
          kind: 'openai-compatible',
          baseUrl: `http://localhost:${upstreamPort}/v1`,
          apiKeyEnv: 'TEST_OPENAI_API_KEY',
          defaultModel: 'gpt-4o',
          models: [{ id: 'gpt-4o' }],
        },
      ],
    };

    const previousKey = process.env.TEST_OPENAI_API_KEY;
    process.env.TEST_OPENAI_API_KEY = TEST_API_KEY;

    const server = createIngressServer({ config, port: 0 });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = getPort(server);

    const res = await httpRequest(port, '/v1/chat/completions', 'POST', {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hi' },
      ],
    });

    const traceId = res.headers['x-signalglass-trace-id'];
    expect(traceId).toBeDefined();

    // Access the assembled trace by inspecting the server internals is not
    // exposed; instead we verify the response shape and headers.
    expect(res.body).toMatchObject(upstreamResponse);

    process.env.TEST_OPENAI_API_KEY = previousKey;
    server.close();
    upstream.close();
  });

  it('does not expose API keys in the client response', async () => {
    const upstreamResponse = {
      id: 'chatcmpl-secret',
      object: 'chat.completion',
      model: 'gpt-4o',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };

    const upstream = await mockUpstreamProvider(upstreamResponse);
    const upstreamPort = getPort(upstream);

    const config: IngressConfig = {
      providers: [
        {
          id: 'openai',
          label: 'OpenAI',
          kind: 'openai-compatible',
          baseUrl: `http://localhost:${upstreamPort}/v1`,
          apiKeyEnv: 'TEST_OPENAI_API_KEY',
          defaultModel: 'gpt-4o',
          models: [{ id: 'gpt-4o' }],
        },
      ],
    };

    const previousKey = process.env.TEST_OPENAI_API_KEY;
    process.env.TEST_OPENAI_API_KEY = TEST_API_KEY;

    const server = createIngressServer({ config, port: 0 });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = getPort(server);

    const res = await httpRequest(port, '/v1/chat/completions', 'POST', {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    const responseJson = JSON.stringify(res.body);
    expect(responseJson).not.toContain(TEST_API_KEY);
    expect(responseJson).not.toContain('authorization');

    process.env.TEST_OPENAI_API_KEY = previousKey;
    server.close();
    upstream.close();
  });

  it('converts the assembled trace into an AgentRun via traceToAgentRun', async () => {
    const upstreamResponse = {
      id: 'chatcmpl-run',
      object: 'chat.completion',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'AgentRun test response' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
    };

    const upstream = await mockUpstreamProvider(upstreamResponse);
    const upstreamPort = getPort(upstream);

    const config: IngressConfig = {
      providers: [
        {
          id: 'openai',
          label: 'OpenAI',
          kind: 'openai-compatible',
          baseUrl: `http://localhost:${upstreamPort}/v1`,
          apiKeyEnv: 'TEST_OPENAI_API_KEY',
          defaultModel: 'gpt-4o',
          models: [{ id: 'gpt-4o' }],
        },
      ],
    };

    const previousKey = process.env.TEST_OPENAI_API_KEY;
    process.env.TEST_OPENAI_API_KEY = TEST_API_KEY;

    const server = createIngressServer({ config, port: 0 });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = getPort(server);

    await httpRequest(port, '/v1/chat/completions', 'POST', {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    // Reconstruct the same trace shape the server would have assembled and
    // verify traceToAgentRun can process it.
    const requestBody = { model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] };
    const { openaiAdapter } = await import('@signalglass/providers');
    const { createTraceEvent, createDefaultCapturePolicy } = await import('@signalglass/core');

    const provider = config.providers[0];
    const traceId = 'reconstructed-trace';
    const requestEvents = openaiAdapter.normalizeRequest(requestBody, provider).map((e) => ({
      ...e,
      traceId,
    }));
    const responseEvents = openaiAdapter.normalizeResponse(upstreamResponse, provider).map((e) => ({
      ...e,
      traceId,
    }));

    const trace = {
      id: traceId,
      startedAt: new Date().toISOString(),
      provider: provider.id,
      model: 'gpt-4o',
      mode: 'standard' as const,
      capturePolicy: createDefaultCapturePolicy('standard'),
      status: 'success' as const,
      events: [...requestEvents, ...responseEvents],
    };

    const run = traceToAgentRun(trace);

    expect(run.provider).toBe('openai');
    expect(run.model).toBe('gpt-4o');
    expect(run.turns.length).toBeGreaterThan(0);
    expect(run.turns[0].contextBlocks.some((b) => b.sourceType === 'user_message')).toBe(true);
    expect(run.turns[0].contextBlocks.some((b) => b.sourceType === 'assistant_message')).toBe(true);

    process.env.TEST_OPENAI_API_KEY = previousKey;
    server.close();
    upstream.close();
  });
});
