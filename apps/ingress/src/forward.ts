import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { ProviderConfig } from '@signalglass/providers';

export interface UpstreamResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: unknown;
}

export async function forwardToUpstream(
  provider: ProviderConfig,
  apiKey: string | undefined,
  requestBody: unknown,
): Promise<UpstreamResponse> {
  const url = new URL(`${provider.baseUrl}/chat/completions`);
  const makeRequest = url.protocol === 'https:' ? httpsRequest : httpRequest;

  const body = JSON.stringify(requestBody);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
    ...provider.headers,
  };

  if (apiKey) {
    headers['authorization'] = `Bearer ${apiKey}`;
  }

  return new Promise((resolve, reject) => {
    const req = makeRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed: unknown;
          try {
            parsed = data ? JSON.parse(data) : undefined;
          } catch {
            parsed = data;
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[]>,
            body: parsed,
          });
        });
      },
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
