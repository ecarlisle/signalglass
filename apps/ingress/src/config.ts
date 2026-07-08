import { readFile } from 'node:fs/promises';
import type { ProviderConfig } from '@signalglass/providers';

export interface IngressConfig {
  providers: ProviderConfig[];
}

export async function loadConfig(path: string): Promise<IngressConfig> {
  const content = await readFile(path, 'utf-8');
  const parsed = JSON.parse(content) as unknown;

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Ingress config must be a JSON object');
  }

  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.providers)) {
    throw new Error('Ingress config must include a "providers" array');
  }

  return record as unknown as IngressConfig;
}
