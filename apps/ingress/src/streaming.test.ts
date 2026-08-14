import { describe, it, expect, afterEach } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync, gzipSync } from 'node:zlib';
import { EvidenceStorage, createMetadataSafePolicy } from '@signalglass/storage';
import type { SaveOutcome } from '@signalglass/storage';
import type { EvidenceRecord } from '@signalglass/evidence';
import { createIngressServer, type IngressConfig } from './index.js';

const TEST_API_KEY = 'test-api-key';
const ENV_VAR_NAME = 'TEST_STREAMING_API_KEY';

function withEnv<T>(name: string, value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return fn().finally(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

function getPort(server: Server): number {
  const address = server.address();
  if (address && typeof address === 'object') return address.port;
  throw new Error('Server is not listening on a port');
}

/** Serve one SSE response, split into the caller's exact chunk partition —
 * used to prove byte transparency and partition-independent assembly. */
function mockSseUpstream(
  rawBody: string,
  chunkPartition: readonly number[],
  extraHeaders: Record<string, string> = {},
): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'x-upstream-secret-header': 'should-not-be-forwarded',
          ...extraHeaders,
        });
        const bytes = Buffer.from(rawBody, 'utf8');
        let offset = 0;
        const writeNext = (): void => {
          if (offset >= bytes.length) {
            res.end();
            return;
          }
          const size = chunkPartition[Math.min(offset, chunkPartition.length - 1)] ?? bytes.length - offset;
          const chunk = bytes.subarray(offset, offset + size);
          offset += chunk.length;
          res.write(chunk);
          setImmediate(writeNext);
        };
        writeNext();
      });
    });
    server.listen(0, () => resolve(server));
  });
}

function mockByteUpstream(
  bytes: Buffer,
  chunkSize: number,
  extraHeaders: Record<string, string> = {},
  stallAfterHeaders = false,
): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream', ...extraHeaders });
        if (stallAfterHeaders) {
          res.flushHeaders();
          return;
        }
        let offset = 0;
        const writeNext = (): void => {
          if (offset >= bytes.length) {
            res.end();
            return;
          }
          const chunk = bytes.subarray(offset, offset + chunkSize);
          offset += chunk.length;
          res.write(chunk);
          setImmediate(writeNext);
        };
        writeNext();
      });
    });
    server.listen(0, () => resolve(server));
  });
}

function mockStatusUpstream(status: number, body: unknown): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) });
      res.end(payload);
    });
    server.listen(0, () => resolve(server));
  });
}

function mockDelayedHeaderUpstream(delayMs: number): Promise<{ server: Server; received: Promise<void> }> {
  return new Promise((resolve) => {
    let markReceived!: () => void;
    const received = new Promise<void>((done) => { markReceived = done; });
    const server = createServer((req, res) => {
      markReceived();
      req.resume();
      req.on('end', () => setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(SSE_BODY);
      }, delayMs));
    });
    server.listen(0, () => resolve({ server, received }));
  });
}

type RawResponse = { status: number; headers: Record<string, string | string[] | undefined>; buffer: Buffer };

function rawStreamRequest(port: number, body: unknown): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const reqBody = JSON.stringify(body);
    const req = httpRequest(
      {
        hostname: 'localhost', port, path: '/v1/chat/completions', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(reqBody)) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, buffer: Buffer.concat(chunks) }));
        res.on('aborted', () => reject(new Error('response aborted')));
      },
    );
    req.on('error', reject);
    req.write(reqBody);
    req.end();
  });
}

function rawBodyRequest(port: number, body: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: 'localhost', port, path: '/v1/chat/completions', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, buffer: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function withTempEvidenceStorage<T>(fn: (storage: EvidenceStorage, path: string) => Promise<T>): Promise<T> {
  const path = join(tmpdir(), `signalglass-streaming-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const storage = new EvidenceStorage({ databasePath: path, persistencePolicy: createMetadataSafePolicy('1.1.0') });
  try {
    return await fn(storage, path);
  } finally {
    storage.close();
    await unlink(path).catch(() => undefined);
    await unlink(`${path}-wal`).catch(() => undefined);
    await unlink(`${path}-shm`).catch(() => undefined);
  }
}

async function waitFor<T>(read: () => T | undefined, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for test observation');
}

const openServers: Server[] = [];
afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function providerConfig(upstreamPort: number): IngressConfig {
  return {
    providers: [{
      id: 'openai', label: 'OpenAI', kind: 'openai-compatible',
      baseUrl: `http://localhost:${upstreamPort}/v1`, apiKeyEnv: ENV_VAR_NAME, defaultModel: 'gpt-4o',
      models: [{ id: 'gpt-4o' }],
    }],
  };
}

const SSE_BODY =
  'data: {"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n' +
  'data: {"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n' +
  'data: {"choices":[{"index":0,"delta":{"content":", world"},"finish_reason":null}]}\n\n' +
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}\n\n' +
  'data: [DONE]\n\n';

describe('streaming ingress (Spec 016 S5)', () => {
  it('forwards SSE body bytes to the client byte-for-byte, for arbitrary transport chunk partitions', async () => {
    const upstream = await mockSseUpstream(SSE_BODY, [7]);
    openServers.push(upstream);

    await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
      const server = createIngressServer({ config: providerConfig(getPort(upstream)), port: 0 });
      openServers.push(server);
      await new Promise<void>((resolve) => server.listen(0, resolve));

      const res = await rawStreamRequest(getPort(server), { model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] });

      expect(res.status).toBe(200);
      expect(res.buffer.toString('utf8')).toBe(SSE_BODY);
    });
  });

  it('constructs response headers from the validated allowlist only', async () => {
    const upstream = await mockSseUpstream(SSE_BODY, [1024]);
    openServers.push(upstream);

    await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
      const server = createIngressServer({ config: providerConfig(getPort(upstream)), port: 0 });
      openServers.push(server);
      await new Promise<void>((resolve) => server.listen(0, resolve));

      const res = await rawStreamRequest(getPort(server), { model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] });

      expect(res.headers['content-type']).toBe('text/event-stream');
      expect(res.headers['x-signalglass-trace-id']).toBeDefined();
      expect(res.headers['content-length']).toBeUndefined();
      expect(res.headers['x-upstream-secret-header']).toBeUndefined();
    });
  });

  it('propagates slow-client backpressure while preserving the complete encoded byte stream', async () => {
    const body = Buffer.alloc(4 * 1024 * 1024, 0x5a);
    let upstreamFinished = false;
    let backpressureObserved = false;
    const upstream = await new Promise<Server>((resolve) => {
      const server = createServer((req, res) => {
        req.resume();
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'content-encoding': 'br' });
          let offset = 0;
          const write = (): void => {
            while (offset < body.length) {
              const next = body.subarray(offset, offset + 16 * 1024);
              offset += next.length;
              if (!res.write(next)) {
                res.once('drain', write);
                return;
              }
            }
            res.end(() => { upstreamFinished = true; });
          };
          write();
        });
      });
      server.listen(0, () => resolve(server));
    });
    openServers.push(upstream);
    await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
      const server = createIngressServer({ config: providerConfig(getPort(upstream)), port: 0 });
      openServers.push(server);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const reqBody = JSON.stringify({
        model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }],
      });
      const response = await new Promise<Buffer>((resolve, reject) => {
        const request = httpRequest({
          hostname: 'localhost', port: getPort(server), path: '/v1/chat/completions', method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(reqBody)) },
        }, (incoming) => {
          const chunks: Buffer[] = [];
          incoming.pause();
          setTimeout(() => {
            backpressureObserved = !upstreamFinished;
            incoming.resume();
          }, 50);
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => resolve(Buffer.concat(chunks)));
          incoming.on('error', reject);
        });
        request.on('error', reject);
        request.end(reqBody);
      });
      expect(response).toEqual(body);
      expect(backpressureObserved).toBe(true);
      expect(upstreamFinished).toBe(true);
    });
  }, 15_000);

  it('saves exactly one completed EvidenceRecord after the client response ends', async () => {
    const upstream = await mockSseUpstream(SSE_BODY, [1024]);
    openServers.push(upstream);

    await withTempEvidenceStorage(async (evidenceStorage) => {
      await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
        const savedTraceIds: string[] = [];
        const outcomes: unknown[] = [];
        const server = createIngressServer({
          config: providerConfig(getPort(upstream)), port: 0, evidenceStorage,
          onEvidenceRecord: (_record, traceId) => savedTraceIds.push(traceId),
          onSaveOutcome: (outcome: SaveOutcome) => outcomes.push(outcome),
          onEvidenceSaveError: (error) => outcomes.push({ error: String(error) }),
        });
        openServers.push(server);
        await new Promise<void>((resolve) => server.listen(0, resolve));

        const res = await rawStreamRequest(getPort(server), { model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] });
        expect(res.status).toBe(200);

        expect(savedTraceIds).toHaveLength(1);
        expect(outcomes).toEqual([{ status: 'stored', identity: savedTraceIds[0], digest: expect.any(String), manifest: expect.any(Object) }]);
        const traceId = savedTraceIds[0]!;
        const read = evidenceStorage.getEvidenceRecord(traceId);
        expect(read.ok).toBe(true);
        const record = (read as { ok: true; record: EvidenceRecord }).record;
        expect(record.trace.status).toBe('completed');
        expect(record.trace.traceId).toBe(traceId);

        const chunkEvents = record.trace.events.filter((event) => event.kind === 'model_response_chunk');
        expect(chunkEvents.length).toBeGreaterThan(0);
        const usageEvent = record.trace.events.find((event) => event.kind === 'model_usage');
        expect(usageEvent).toBeDefined();
      });
    });
  });

  it('assembles equivalent evidence regardless of transport chunk partitioning', async () => {
    const partitions: (readonly number[])[] = [[1], [3, 11, 40], [1024]];
    const records: EvidenceRecord[] = [];

    for (const partition of partitions) {
      const upstream = await mockSseUpstream(SSE_BODY, partition);
      openServers.push(upstream);

      // eslint-disable-next-line no-await-in-loop
      await withTempEvidenceStorage(async (evidenceStorage) => {
        // eslint-disable-next-line no-await-in-loop
        await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
          let saved: EvidenceRecord | undefined;
          const server = createIngressServer({
            config: providerConfig(getPort(upstream)), port: 0, evidenceStorage,
            onEvidenceRecord: (record) => { saved = record; },
          });
          openServers.push(server);
          await new Promise<void>((resolve) => server.listen(0, resolve));
          await rawStreamRequest(getPort(server), { model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] });
          expect(saved).toBeDefined();
          records.push(saved!);
        });
      });
    }

    const projectDeterministic = (record: EvidenceRecord) => ({
      status: record.trace.status,
      chunks: record.trace.events
        .filter((event) => event.kind === 'model_response_chunk')
        .map((event) => (event as { responseEnvelope: { choiceIndex: number; chunkIndex: number; deltaText?: string; finishReason?: string } }).responseEnvelope)
        .map(({ choiceIndex, chunkIndex, deltaText, finishReason }) => ({ choiceIndex, chunkIndex, deltaText, finishReason })),
      usage: record.trace.events
        .filter((event) => event.kind === 'model_usage')
        .map((event) => (event as { usage: unknown }).usage),
    });

    const [first, ...rest] = records.map(projectDeterministic);
    for (const other of rest) {
      expect(other).toEqual(first);
    }
  });

  it('normalizes a non-2xx upstream streaming response into the Spec 006 error envelope', async () => {
    const upstream = await mockStatusUpstream(500, { error: 'boom' });
    openServers.push(upstream);

    await withTempEvidenceStorage(async (evidenceStorage) => {
      await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
        let saved: EvidenceRecord | undefined;
        const server = createIngressServer({
          config: providerConfig(getPort(upstream)), port: 0, evidenceStorage,
          onEvidenceRecord: (record) => { saved = record; },
        });
        openServers.push(server);
        await new Promise<void>((resolve) => server.listen(0, resolve));

        const res = await rawStreamRequest(getPort(server), { model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] });

        expect(res.status).toBe(500);
        const body = JSON.parse(res.buffer.toString('utf8'));
        expect(body.error.type).toBe('api_error');

        expect(saved).toBeDefined();
        expect(saved!.trace.status).toBe('failed');
      });
    });
  });

  it('records a request-failed EvidenceRecord for an unroutable streaming request, without dispatching upstream', async () => {
    await withTempEvidenceStorage(async (evidenceStorage) => {
      let saved: EvidenceRecord | undefined;
      const server = createIngressServer({
        config: { providers: [] }, port: 0, evidenceStorage,
        onEvidenceRecord: (record) => { saved = record; },
      });
      openServers.push(server);
      await new Promise<void>((resolve) => server.listen(0, resolve));

      const res = await rawStreamRequest(getPort(server), { model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] });

      expect(res.status).toBe(400);
      expect(saved).toBeDefined();
      expect(saved!.trace.status).toBe('failed');
      const modelRequestEvent = saved!.trace.events.find((event) => event.kind === 'model_request');
      expect(modelRequestEvent).toBeUndefined();
    });
  });

  it('records a phase-accurate request-failed record for a fully read malformed body', async () => {
    await withTempEvidenceStorage(async (evidenceStorage) => {
      let saved: EvidenceRecord | undefined;
      const server = createIngressServer({
        config: { providers: [] }, port: 0, evidenceStorage,
        onEvidenceRecord: (record) => { saved = record; },
      });
      openServers.push(server);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const response = await rawBodyRequest(getPort(server), '{"stream":true,');
      expect(response.status).toBe(400);
      expect(saved?.trace.status).toBe('failed');
      expect(saved?.captureBoundary.streaming?.losses.requestBody).toBe('fully-observed-not-retained');
      expect(saved?.captureBoundary.streaming?.losses.messageContent).toBe('not-observed');
    });
  });

  it('records an over-limit body as partially observed and not retained', async () => {
    await withTempEvidenceStorage(async (evidenceStorage) => {
      let saved: EvidenceRecord | undefined;
      const server = createIngressServer({
        config: { providers: [] }, port: 0, evidenceStorage, bodySizeLimitBytes: 32,
        onEvidenceRecord: (record) => { saved = record; },
      });
      openServers.push(server);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const response = await rawBodyRequest(getPort(server), JSON.stringify({ stream: true, padding: 'x'.repeat(100) }));
      expect(response.status).toBe(413);
      expect(saved?.captureBoundary.streaming?.losses.requestBody).toBe('partially-observed-not-retained');
      expect(saved?.captureBoundary.streaming?.losses.messageContent).toBe('not-observed');
    });
  });

  it.each([
    ['present invalid messages', { stream: true, model: 'gpt-4o', messages: 'observed-but-invalid' }, 'omitted'],
    ['missing messages', { stream: true, model: 'gpt-4o' }, 'not-observed'],
  ] as const)('records a fully read structurally invalid request with %s phase facts', async (_case, body, messageContent) => {
    await withTempEvidenceStorage(async (evidenceStorage) => {
      let saved: EvidenceRecord | undefined;
      const server = createIngressServer({
        config: { providers: [] }, port: 0, evidenceStorage,
        onEvidenceRecord: (record) => { saved = record; },
      });
      openServers.push(server);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const response = await rawStreamRequest(getPort(server), body);
      expect(response.status).toBe(400);
      expect(saved?.trace.events.map((event) => event.kind)).toEqual(['interaction_start', 'error']);
      expect(saved?.captureBoundary.streaming?.losses).toMatchObject({
        requestBody: 'fully-observed-not-retained',
        messageContent,
      });
    });
  });

  it('records a mid-body disconnect as a partial body-read failure', async () => {
    await withTempEvidenceStorage(async (evidenceStorage) => {
      let saved: EvidenceRecord | undefined;
      const server = createIngressServer({
        config: { providers: [] }, port: 0, evidenceStorage,
        onEvidenceRecord: (record) => { saved = record; },
      });
      openServers.push(server);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const request = httpRequest({
        hostname: 'localhost', port: getPort(server), path: '/v1/chat/completions', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': '100' },
      });
      request.on('error', () => undefined);
      request.write('{"stream":true,');
      await new Promise((resolve) => setTimeout(resolve, 20));
      request.socket?.destroy();
      const record = await waitFor(() => saved, 10_000);
      expect(record.trace.events.at(-1)).toMatchObject({
        kind: 'error', error: { type: 'body-read-failure' },
      });
      expect(record.captureBoundary.streaming?.losses).toMatchObject({
        requestBody: 'partially-observed-not-retained',
        messageContent: 'not-observed',
      });
    });
  }, 15_000);

  it('rejects an invalid evidence-budget configuration at server construction', async () => {
    expect(() => createIngressServer({
      config: { providers: [] },
      port: 0,
      evidenceBudgets: {
        maxCanonicalEvents: 1_000_000,
        maxRawObservations: 2_000, // violates maxRawObservations >= maxCanonicalEvents
        maxRawObservationPayloadBytes: 4 * 1024 * 1024,
        maxRetainedContentCodePoints: 262_144,
        maxSerializedEvidenceBytes: 16 * 1024 * 1024,
        maxIdLengthBytes: 128,
      },
    })).toThrow();
  });

  it.each([
    ['gzip', gzipSync(Buffer.from(SSE_BODY))],
    ['deflate', deflateSync(Buffer.from(SSE_BODY))],
  ])('forwards %s bytes unchanged while observing the decoded SSE copy', async (encoding, encoded) => {
    const upstream = await mockByteUpstream(encoded, 7, { 'content-encoding': encoding });
    openServers.push(upstream);
    await withTempEvidenceStorage(async (evidenceStorage) => {
      await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
        let saved: EvidenceRecord | undefined;
        const server = createIngressServer({
          config: providerConfig(getPort(upstream)), port: 0, evidenceStorage,
          onEvidenceRecord: (record) => { saved = record; },
        });
        openServers.push(server);
        await new Promise<void>((resolve) => server.listen(0, resolve));
        const response = await rawStreamRequest(getPort(server), {
          model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }],
        });
        expect(response.buffer).toEqual(encoded);
        expect(response.headers['content-encoding']).toBe(encoding);
        expect(saved?.trace.status).toBe('completed');
        expect(saved?.captureBoundary.streaming?.decoderDisposition).toBe('openai-sse');
      });
    });
  });

  it('detaches observation on a corrupt gzip copy without changing forwarded bytes', async () => {
    const encoded = Buffer.from('not-a-gzip-stream');
    const upstream = await mockByteUpstream(encoded, 3, { 'content-encoding': 'gzip' });
    openServers.push(upstream);
    await withTempEvidenceStorage(async (evidenceStorage) => {
      await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
        let saved: EvidenceRecord | undefined;
        const server = createIngressServer({
          config: providerConfig(getPort(upstream)), port: 0, evidenceStorage,
          onEvidenceRecord: (record) => { saved = record; },
        });
        openServers.push(server);
        await new Promise<void>((resolve) => server.listen(0, resolve));
        const response = await rawStreamRequest(getPort(server), {
          model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }],
        });
        expect(response.buffer).toEqual(encoded);
        expect(saved?.trace.status).toBe('unknown');
        expect(saved?.trace.events.at(-1)).toMatchObject({ kind: 'error', error: { type: 'observation-decode-failure' } });
      });
    });
  });

  it('forwards an unsupported encoded stream unchanged and declares observation detachment', async () => {
    const encoded = Buffer.from('opaque-brotli-like-bytes');
    const upstream = await mockByteUpstream(encoded, 4, { 'content-encoding': 'br' });
    openServers.push(upstream);
    await withTempEvidenceStorage(async (evidenceStorage) => {
      await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
        let saved: EvidenceRecord | undefined;
        const server = createIngressServer({
          config: providerConfig(getPort(upstream)), port: 0, evidenceStorage,
          onEvidenceRecord: (record) => { saved = record; },
        });
        openServers.push(server);
        await new Promise<void>((resolve) => server.listen(0, resolve));
        const response = await rawStreamRequest(getPort(server), {
          model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }],
        });
        expect(response.buffer).toEqual(encoded);
        expect(response.headers['content-encoding']).toBe('br');
        expect(saved?.trace.events.at(-1)).toMatchObject({
          kind: 'error', error: { type: 'observation-encoding-unsupported' },
        });
        expect(saved?.captureBoundary.streaming).toMatchObject({
          decoderDisposition: 'unsupported-encoding',
          losses: { contentEncodingUnsupported: true, deltaContent: 'not-observed' },
        });
      });
    });
  });

  it('accounts for content forwarded after [DONE] without retaining it', async () => {
    const body = `${SSE_BODY}data: {"trailing":true}\n\n`;
    const upstream = await mockSseUpstream(body, [5]);
    openServers.push(upstream);
    await withTempEvidenceStorage(async (evidenceStorage) => {
      await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
        let saved: EvidenceRecord | undefined;
        const server = createIngressServer({
          config: providerConfig(getPort(upstream)), port: 0, evidenceStorage,
          onEvidenceRecord: (record) => { saved = record; },
        });
        openServers.push(server);
        await new Promise<void>((resolve) => server.listen(0, resolve));
        const response = await rawStreamRequest(getPort(server), {
          model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }],
        });
        expect(response.buffer.toString()).toBe(body);
        expect(saved?.captureBoundary.streaming?.losses.postTerminalContent).toBe('observed-not-retained');
      });
    });
  });

  it('isolates a throwing evidence observer from the authoritative save', async () => {
    const upstream = await mockSseUpstream(SSE_BODY, [1024]);
    openServers.push(upstream);
    await withTempEvidenceStorage(async (evidenceStorage) => {
      await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
        let outcome: SaveOutcome | undefined;
        const server = createIngressServer({
          config: providerConfig(getPort(upstream)), port: 0, evidenceStorage,
          onEvidenceRecord: () => { throw new Error('observer failure'); },
          onSaveOutcome: (value) => { outcome = value; },
        });
        openServers.push(server);
        await new Promise<void>((resolve) => server.listen(0, resolve));
        await rawStreamRequest(getPort(server), {
          model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }],
        });
        expect(outcome?.status).toBe('stored');
      });
    });
  });

  it('enforces the forward-progress idle limit as ingress cancellation', async () => {
    const upstream = await mockByteUpstream(Buffer.alloc(0), 1, {}, true);
    openServers.push(upstream);
    await withTempEvidenceStorage(async (evidenceStorage) => {
      await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
        let saved: EvidenceRecord | undefined;
        const server = createIngressServer({
          config: providerConfig(getPort(upstream)), port: 0, evidenceStorage, streamIdleTimeoutMs: 25,
          onEvidenceRecord: (record) => { saved = record; },
        });
        openServers.push(server);
        await new Promise<void>((resolve) => server.listen(0, resolve));
        await rawStreamRequest(getPort(server), {
          model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }],
        }).catch(() => undefined);
        const record = await waitFor(() => saved);
        expect(record.trace.status).toBe('cancelled');
        expect(record.captureBoundary.streaming?.upstream).toEqual({
          outcome: 'cancelled-by-ingress', cause: 'configured-limit',
        });
      });
    });
  });

  it('cancels an awaiting upstream request when the client disconnects before headers', async () => {
    const delayed = await mockDelayedHeaderUpstream(250);
    const upstream = delayed.server;
    openServers.push(upstream);
    await withTempEvidenceStorage(async (evidenceStorage) => {
      await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
        let saved: EvidenceRecord | undefined;
        const server = createIngressServer({
          config: providerConfig(getPort(upstream)), port: 0, evidenceStorage,
          onEvidenceRecord: (record) => { saved = record; },
        });
        openServers.push(server);
        await new Promise<void>((resolve) => server.listen(0, resolve));
        const payload = JSON.stringify({
          model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }],
        });
        const request = httpRequest({
          hostname: 'localhost', port: getPort(server), path: '/v1/chat/completions', method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) },
        });
        request.on('error', () => undefined);
        request.end(payload);
        await delayed.received;
        request.socket?.destroy();
        const record = await waitFor(() => saved, 10_000);
        expect(record.trace.status).toBe('cancelled');
        expect(record.captureBoundary.streaming?.upstream).toEqual({
          outcome: 'cancelled-by-ingress', cause: 'client-disconnect',
        });
        expect(record.captureBoundary.streaming?.clientResponse.outcome).toBe('not-started');
      });
    });
  }, 15_000);

  it('cancels an awaiting upstream request when ingress shuts down', async () => {
    const delayed = await mockDelayedHeaderUpstream(250);
    const upstream = delayed.server;
    openServers.push(upstream);
    await withTempEvidenceStorage(async (evidenceStorage) => {
      await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
        let saved: EvidenceRecord | undefined;
        const server = createIngressServer({
          config: providerConfig(getPort(upstream)), port: 0, evidenceStorage,
          onEvidenceRecord: (record) => { saved = record; },
        });
        await new Promise<void>((resolve) => server.listen(0, resolve));
        const pendingResponse = rawStreamRequest(getPort(server), {
          model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }],
        }).catch(() => undefined);
        await delayed.received;
        const closed = new Promise<void>((resolve, reject) => server.close((error) =>
          error === undefined ? resolve() : reject(error)));
        const record = await waitFor(() => saved, 10_000);
        await Promise.all([closed, pendingResponse]);
        expect(record.trace.status).toBe('cancelled');
        expect(record.captureBoundary.streaming?.upstream).toEqual({
          outcome: 'cancelled-by-ingress', cause: 'ingress-shutdown',
        });
        expect(record.captureBoundary.streaming?.clientResponse.outcome).toBe('not-started');
      });
    });
  }, 15_000);

  it('detaches live observation at the retained-content budget while forwarding the full stream', async () => {
    const frames = Array.from({ length: 70 }, (_, index) =>
      `data: {"choices":[{"index":0,"delta":{"content":"${'x'.repeat(240)}"},"finish_reason":${index === 69 ? '"stop"' : 'null'}}]}\n\n`).join('');
    const body = frames;
    const upstream = await mockSseUpstream(body, [4096]);
    openServers.push(upstream);
    await withTempEvidenceStorage(async (evidenceStorage) => {
      await withEnv(ENV_VAR_NAME, TEST_API_KEY, async () => {
        let saved: EvidenceRecord | undefined;
        const server = createIngressServer({
          config: providerConfig(getPort(upstream)), port: 0, evidenceStorage,
          evidenceBudgets: {
            maxCanonicalEvents: 1_000, maxRawObservations: 2_000,
            maxRawObservationPayloadBytes: 4 * 1024 * 1024,
            maxRetainedContentCodePoints: 16_384,
            maxSerializedEvidenceBytes: 16 * 1024 * 1024,
            maxIdLengthBytes: 128,
          },
          onEvidenceRecord: (record) => { saved = record; },
        });
        openServers.push(server);
        await new Promise<void>((resolve) => server.listen(0, resolve));
        const response = await rawStreamRequest(getPort(server), {
          model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }],
        });
        expect(response.buffer.toString()).toBe(body);
        expect(saved?.trace.status).toBe('unknown');
        expect(saved?.trace.events.at(-1)).toMatchObject({ kind: 'error', error: { type: 'record-budget-exceeded' } });
        expect(saved?.trace.events.filter((event) =>
          event.kind === 'model_response_chunk')).toHaveLength(68);
      });
    });
  }, 60_000);
});
