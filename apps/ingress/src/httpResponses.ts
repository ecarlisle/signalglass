import type { ServerResponse } from 'node:http';

export function sendJson(
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

export function waitForClientResponseEnd(
  res: ServerResponse,
): Promise<'flushed' | 'closed-before-completion' | 'not-started'> {
  if (res.writableFinished) return Promise.resolve('flushed');
  if (res.destroyed || res.socket?.destroyed === true) {
    return Promise.resolve(res.headersSent ? 'closed-before-completion' : 'not-started');
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: 'flushed' | 'closed-before-completion' | 'not-started'): void => {
      if (settled) return;
      settled = true;
      res.off('finish', onFinish);
      res.off('close', onClose);
      resolve(outcome);
    };
    const onFinish = (): void => finish('flushed');
    const onClose = (): void => finish(res.headersSent ? 'closed-before-completion' : 'not-started');
    res.once('finish', onFinish);
    res.once('close', onClose);
  });
}

export async function sendJsonAndWait(
  res: ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<'flushed' | 'closed-before-completion' | 'not-started'> {
  if (!res.destroyed && !res.headersSent) sendJson(res, status, payload, extraHeaders);
  return waitForClientResponseEnd(res);
}
