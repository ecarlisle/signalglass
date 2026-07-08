import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createIngressServer, type IngressConfig, loadConfig, DEFAULT_BODY_SIZE_LIMIT_BYTES } from './index.js';
import { traceToAgentRun } from '@signalglass/core';
import type { Trace } from '@signalglass/core';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_API_KEY = 'test-api-key';
const ENV_VAR_NAME = 'TEST_OPENAI_API_KEY';

function withEnv<T>(name: string, value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  return fn().finally(() => {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  });
}

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

function mockUpstreamProviderWithText(text: string): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-length': String(Buffer.byteLength(text)),
      });
      res.end(text);
    });
    server.listen(0, () => resolve(server));
  });
}

function mockUpstreamProviderWithStatus(status: number, responseBody: unknown): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      const payload = JSON.stringify(responseBody);
      res.writeHead(status, {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payload)),
      });
      res.end(payload);
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
          models: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }],
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
          apiKeyEnv: ENV_VAR_NAME,
          defaultModel: 'gpt-4o',
          models: [{ id: 'gpt-4o' }],
        },
      ],
    };

    await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
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

      server.close();
    });

    upstream.close();
  });

  it('emits TraceEvent objects for the full lifecycle and exposes them via onTrace', async () => {
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
          apiKeyEnv: ENV_VAR_NAME,
          defaultModel: 'gpt-4o',
          models: [{ id: 'gpt-4o' }],
        },
      ],
    };

    let capturedTrace: Trace | undefined;

    await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
      const server = createIngressServer({
        config,
        port: 0,
        onTrace: (trace) => {
          capturedTrace = trace;
        },
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = getPort(server);

      const res = await httpRequest(port, '/v1/chat/completions', 'POST', {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hi' },
        ],
      });

      expect(res.status).toBe(200);
      expect(res.headers['x-signalglass-trace-id']).toBeDefined();

      expect(capturedTrace).toBeDefined();
      expect(capturedTrace!.events.length).toBeGreaterThan(0);
      expect(capturedTrace!.events.every((e) => e.traceId === capturedTrace!.id)).toBe(true);

      const eventTypes = capturedTrace!.events.map((e) => e.type);
      expect(eventTypes).toContain('instruction');
      expect(eventTypes).toContain('message');
      expect(eventTypes).toContain('provider_request');
      expect(eventTypes).toContain('provider_response');
      expect(eventTypes).toContain('inference');
      expect(eventTypes).toContain('egress_response');

      server.close();
    });

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
          apiKeyEnv: ENV_VAR_NAME,
          defaultModel: 'gpt-4o',
          models: [{ id: 'gpt-4o' }],
        },
      ],
    };

    await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
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

      server.close();
    });

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
          apiKeyEnv: ENV_VAR_NAME,
          defaultModel: 'gpt-4o',
          models: [{ id: 'gpt-4o' }],
        },
      ],
    };

    let capturedTrace: Trace | undefined;

    await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
      const server = createIngressServer({
        config,
        port: 0,
        onTrace: (trace) => {
          capturedTrace = trace;
        },
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = getPort(server);

      await httpRequest(port, '/v1/chat/completions', 'POST', {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(capturedTrace).toBeDefined();
      const run = traceToAgentRun(capturedTrace!);

      expect(run.provider).toBe('openai');
      expect(run.model).toBe('gpt-4o');
      expect(run.turns.length).toBeGreaterThan(0);
      expect(run.turns[0].contextBlocks.some((b) => b.sourceType === 'user_message')).toBe(true);
      expect(run.turns[0].contextBlocks.some((b) => b.sourceType === 'assistant_message')).toBe(true);

      server.close();
    });

    upstream.close();
  });

  it('rejects oversized request bodies', async () => {
    const config: IngressConfig = { providers: [] };
    const server = createIngressServer({ config, port: 0 });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = getPort(server);

    const hugeBody = { messages: [{ role: 'user', content: 'x'.repeat(DEFAULT_BODY_SIZE_LIMIT_BYTES + 100) }] };

    const res = await httpRequest(port, '/v1/chat/completions', 'POST', hugeBody);

    expect(res.status).toBe(413);
    expect((res.body as Record<string, unknown>).error).toBeDefined();

    server.close();
  });

  it('returns body limit errors without parsing later oversized content', async () => {
    const config: IngressConfig = { providers: [] };
    const server = createIngressServer({ config, port: 0, bodySizeLimitBytes: 16 });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = getPort(server);

    const http = await import('node:http');
    const res = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const req = http.default.request(
        {
          hostname: 'localhost',
          port,
          path: '/v1/chat/completions',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
        (response) => {
          let data = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            data += chunk;
          });
          response.on('end', () => {
            resolve({
              status: response.statusCode ?? 0,
              body: data ? JSON.parse(data) : undefined,
            });
          });
        },
      );
      req.on('error', reject);
      req.write('{"model":"gpt-4o",');
      req.write('"messages":');
      req.write('this is intentionally invalid json after the limit');
      req.end();
    });

    expect(res.status).toBe(413);
    expect(JSON.stringify(res.body)).toContain('byte limit');

    server.close();
  });

  it('records provider_error when upstream returns non-2xx', async () => {
    const upstream = await mockUpstreamProviderWithStatus(503, {
      error: { message: 'temporarily unavailable', type: 'api_error' },
    });
    const upstreamPort = getPort(upstream);

    const config: IngressConfig = {
      providers: [
        {
          id: 'openai',
          label: 'OpenAI',
          kind: 'openai-compatible',
          baseUrl: `http://localhost:${upstreamPort}/v1`,
          apiKeyEnv: ENV_VAR_NAME,
          defaultModel: 'gpt-4o',
          models: [{ id: 'gpt-4o' }],
        },
      ],
    };

    let capturedTrace: Trace | undefined;

    await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
      const server = createIngressServer({
        config,
        port: 0,
        onTrace: (trace) => {
          capturedTrace = trace;
        },
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = getPort(server);

      const res = await httpRequest(port, '/v1/chat/completions', 'POST', {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(res.status).toBe(503);
      expect(capturedTrace).toBeDefined();
      expect(capturedTrace!.status).toBe('error');
      const providerError = capturedTrace!.events.find((event) => event.type === 'provider_error');
      expect(providerError).toBeDefined();
      expect(providerError!.metadata).toMatchObject({
        status: 503,
        errorType: 'upstream_non_2xx',
      });
      expect(JSON.stringify(providerError)).not.toContain('test-api-key');

      server.close();
    });

    upstream.close();
  });

  it('records provider_error when upstream forwarding fails', async () => {
    const config: IngressConfig = {
      providers: [
        {
          id: 'openai',
          label: 'OpenAI',
          kind: 'openai-compatible',
          baseUrl: 'http://localhost:1/v1',
          apiKeyEnv: ENV_VAR_NAME,
          defaultModel: 'gpt-4o',
          models: [{ id: 'gpt-4o' }],
        },
      ],
    };

    let capturedTrace: Trace | undefined;

    await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
      const server = createIngressServer({
        config,
        port: 0,
        onTrace: (trace) => {
          capturedTrace = trace;
        },
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = getPort(server);

      const res = await httpRequest(port, '/v1/chat/completions', 'POST', {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(res.status).toBe(502);
      expect(capturedTrace).toBeDefined();
      expect(capturedTrace!.status).toBe('error');
      const providerError = capturedTrace!.events.find((event) => event.type === 'provider_error');
      expect(providerError).toBeDefined();
      expect(providerError!.metadata).toMatchObject({
        errorType: 'upstream_request_error',
      });
      expect(JSON.stringify(providerError)).not.toContain('test-api-key');

      server.close();
    });
  });

  it('returns 502 when upstream returns a non-object body', async () => {
    const upstream = await mockUpstreamProviderWithText('not-json-object');
    const upstreamPort = getPort(upstream);

    const config: IngressConfig = {
      providers: [
        {
          id: 'openai',
          label: 'OpenAI',
          kind: 'openai-compatible',
          baseUrl: `http://localhost:${upstreamPort}/v1`,
          apiKeyEnv: ENV_VAR_NAME,
          defaultModel: 'gpt-4o',
          models: [{ id: 'gpt-4o' }],
        },
      ],
    };

    await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
      const server = createIngressServer({ config, port: 0 });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = getPort(server);

      const res = await httpRequest(port, '/v1/chat/completions', 'POST', {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(res.status).toBe(502);
      expect((res.body as Record<string, unknown>).error).toBeDefined();

      server.close();
    });

    upstream.close();
  });

  it('passes assembled trace to onTrace callback and storage can persist it', async () => {
    const upstreamResponse = {
      id: 'chatcmpl-storage',
      object: 'chat.completion',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Storage test response' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 },
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
          apiKeyEnv: ENV_VAR_NAME,
          defaultModel: 'gpt-4o',
          models: [{ id: 'gpt-4o' }],
        },
      ],
    };

    let capturedTrace: Trace | undefined;

    await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
      const server = createIngressServer({
        config,
        port: 0,
        onTrace: async (trace) => {
          capturedTrace = trace;
        },
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = getPort(server);

      const res = await httpRequest(port, '/v1/chat/completions', 'POST', {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a helpful assistant' },
          { role: 'user', content: 'Test storage integration' },
        ],
      });

      expect(res.status).toBe(200);
      expect(res.headers['x-signalglass-trace-id']).toBeDefined();

      // Verify the trace was captured
      expect(capturedTrace).toBeDefined();
      expect(capturedTrace!.id).toBe(res.headers['x-signalglass-trace-id']);
      expect(capturedTrace!.provider).toBe('openai');
      expect(capturedTrace!.model).toBe('gpt-4o');
      expect(capturedTrace!.events.length).toBeGreaterThan(0);

      // Verify trace has expected event types
      const eventTypes = capturedTrace!.events.map((e) => e.type);
      expect(eventTypes).toContain('message');
      expect(eventTypes).toContain('provider_request');
      expect(eventTypes).toContain('provider_response');

      // Verify storage can save and retrieve the trace
      const { TraceStorage } = await import('@signalglass/storage');
      const storagePath = join(tmpdir(), `signalglass-ingress-storage-test-${Date.now()}.db`);
      const storage = new TraceStorage({ databasePath: storagePath });

      try {
        storage.saveTrace(capturedTrace!);
        const retrieved = storage.getTrace(capturedTrace!.id);

        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(capturedTrace!.id);
        expect(retrieved!.provider).toBe('openai');
        expect(retrieved!.events.length).toBe(capturedTrace!.events.length);
      } finally {
        storage.close();
        await unlink(storagePath);
      }

      server.close();
    });

    upstream.close();
  });
});

describe('loadConfig', () => {
  async function writeConfig(config: unknown): Promise<string> {
    const path = join(tmpdir(), `signalglass-ingress-config-${Date.now()}-${Math.random()}.json`);
    await writeFile(path, JSON.stringify(config));
    return path;
  }

  it('validates provider entries', async () => {
    const path = join(tmpdir(), `signalglass-ingress-config-${Date.now()}.json`);

    await writeFile(
      path,
      JSON.stringify({
        providers: [
          { id: '', baseUrl: 'http://localhost:9999/v1', kind: 'openai-compatible' },
        ],
      }),
    );

    await expect(loadConfig(path)).rejects.toThrow('non-empty string "id"');

    await unlink(path);
  });

  it('accepts an empty providers array', async () => {
    const path = join(tmpdir(), `signalglass-ingress-config-${Date.now()}.json`);
    await writeFile(path, JSON.stringify({ providers: [] }));

    const config = await loadConfig(path);
    expect(config.providers).toEqual([]);

    await unlink(path);
  });

  it('rejects an invalid provider kind', async () => {
    const path = join(tmpdir(), `signalglass-ingress-config-${Date.now()}.json`);
    await writeFile(
      path,
      JSON.stringify({
        providers: [{ id: 'bad', baseUrl: 'http://localhost:9999/v1', kind: 'unknown-kind' }],
      }),
    );

    await expect(loadConfig(path)).rejects.toThrow('supported ingress "kind"');

    await unlink(path);
  });

  it('accepts a valid provider config with nested models, capabilities, and headers', async () => {
    const path = await writeConfig({
      providers: [
        {
          id: 'openai',
          label: 'OpenAI',
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
          defaultModel: 'gpt-4o',
          models: [
            {
              id: 'gpt-4o',
              label: 'GPT-4o',
              aliases: ['gpt-4o-latest'],
              capabilities: { tools: true, jsonMode: true },
              limits: { contextWindow: 128000, maxOutputTokens: 4096 },
              pricing: { inputPerMillion: 5, outputPerMillion: 15 },
            },
          ],
          capabilities: { streaming: false, tools: true, vision: true },
          headers: { 'openai-organization': 'org-example' },
        },
      ],
    });

    const config = await loadConfig(path);

    expect(config.providers[0]).toMatchObject({
      id: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o',
      capabilities: { streaming: false, tools: true, vision: true },
      headers: { 'openai-organization': 'org-example' },
    });
    expect(config.providers[0].models?.[0]).toMatchObject({
      id: 'gpt-4o',
      aliases: ['gpt-4o-latest'],
      capabilities: { tools: true, jsonMode: true },
    });

    await unlink(path);
  });

  it('rejects malformed nested model and capability shapes', async () => {
    const badModelsPath = await writeConfig({
      providers: [
        {
          id: 'openai',
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          models: ['gpt-4o'],
        },
      ],
    });

    await expect(loadConfig(badModelsPath)).rejects.toThrow('model at index 0 must be an object');
    await unlink(badModelsPath);

    const badCapabilitiesPath = await writeConfig({
      providers: [
        {
          id: 'openai',
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          capabilities: ['streaming'],
        },
      ],
    });

    await expect(loadConfig(badCapabilitiesPath)).rejects.toThrow('capabilities');
    await unlink(badCapabilitiesPath);
  });

  it('rejects provider kinds that the ingress cannot forward', async () => {
    const path = await writeConfig({
      providers: [
        {
          id: 'anthropic',
          kind: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
        },
      ],
    });

    await expect(loadConfig(path)).rejects.toThrow('supported ingress "kind"');

    await unlink(path);
  });

  it('rejects credential-bearing provider base URLs', async () => {
    const path = await writeConfig({
      providers: [
        {
          id: 'openai',
          kind: 'openai-compatible',
          baseUrl: 'https://user:pass@example.com/v1',
        },
      ],
    });

    await expect(loadConfig(path)).rejects.toThrow('must not include credentials');

    await unlink(path);
  });

  it('rejects sensitive configured provider headers', async () => {
    const path = await writeConfig({
      providers: [
        {
          id: 'openai',
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          headers: {
            authorization: 'Bearer should-not-be-configured',
          },
        },
      ],
    });

    await expect(loadConfig(path)).rejects.toThrow('sensitive header');

    await unlink(path);
  });
});

describe('ingress + storage integration', () => {
  it('can hand off an assembled trace to storage through the onTrace seam', async () => {
    const upstreamResponse = {
      id: 'chatcmpl-integration',
      object: 'chat.completion',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Integration test response' },
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
          apiKeyEnv: ENV_VAR_NAME,
          defaultModel: 'gpt-4o',
          models: [{ id: 'gpt-4o' }],
        },
      ],
    };

    // Use the onTrace seam to capture the trace
    let capturedTrace: Trace | undefined;
    const onTrace = async (trace: Trace) => {
      capturedTrace = trace;
    };

    await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
      const server = createIngressServer({ config, port: 0, onTrace });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = getPort(server);

      const res = await httpRequest(port, '/v1/chat/completions', 'POST', {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a helpful assistant' },
          { role: 'user', content: 'Hello, integration test!' },
        ],
      });

      expect(res.status).toBe(200);
      expect(capturedTrace).not.toBeNull();
      expect(capturedTrace!.id).toBeDefined();
      expect(capturedTrace!.events.length).toBeGreaterThan(0);
      expect(capturedTrace!.mode).toBe('standard');
      expect(capturedTrace!.capturePolicy).toBeDefined();
      expect(capturedTrace!.capturePolicy.storeFullRawPayloads).toBe(false);

      // Verify trace contains expected event types
      const eventTypes = capturedTrace!.events.map((e) => e.type);
      expect(eventTypes).toContain('instruction');
      expect(eventTypes).toContain('message');
      expect(eventTypes).toContain('provider_request');
      expect(eventTypes).toContain('provider_response');

      server.close();
    });

    upstream.close();
  });

  it('ensures traces passed to storage are sanitized', async () => {
    const upstreamResponse = {
      id: 'chatcmpl-sanitized',
      object: 'chat.completion',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Sanitized response' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
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
          apiKeyEnv: ENV_VAR_NAME,
          defaultModel: 'gpt-4o',
          models: [{ id: 'gpt-4o' }],
        },
      ],
    };

    let capturedTrace: Trace | undefined;
    const onTrace = async (trace: Trace) => {
      capturedTrace = trace;
    };

    await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
      const server = createIngressServer({ config, port: 0, onTrace });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = getPort(server);

      await httpRequest(port, '/v1/chat/completions', 'POST', {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Test sanitization' }],
      });

      expect(capturedTrace).not.toBeNull();

      // Verify the trace is sanitized for standard mode
      expect(capturedTrace!.capturePolicy.storeFullRawPayloads).toBe(false);
      expect(capturedTrace!.capturePolicy.storeSecrets).toBe(false);
      expect(capturedTrace!.capturePolicy.storeApiKeys).toBe(false);

      // Verify no sensitive data in metadata
      if (capturedTrace!.metadata) {
        const metadataStr = JSON.stringify(capturedTrace!.metadata);
        expect(metadataStr).not.toContain('authorization');
        expect(metadataStr).not.toContain('api_key');
      }

      server.close();
    });

    upstream.close();
  });
});
