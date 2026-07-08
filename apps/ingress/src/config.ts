import { readFile } from 'node:fs/promises';
import type { ProviderConfig, ProviderKind } from '@signalglass/providers';

export interface IngressConfig {
  providers: ProviderConfig[];
}

const PROVIDER_KINDS = new Set<ProviderKind>([
  'openai-compatible',
  'anthropic',
  'gemini',
  'ollama',
  'custom',
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function assertValidProvider(entry: unknown, index: number): ProviderConfig {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`Provider at index ${index} must be an object`);
  }

  const provider = entry as Record<string, unknown>;

  if (!isNonEmptyString(provider.id)) {
    throw new Error(`Provider at index ${index} must have a non-empty string "id"`);
  }

  if (!isNonEmptyString(provider.baseUrl)) {
    throw new Error(`Provider at index ${index} must have a non-empty string "baseUrl"`);
  }

  if (!isNonEmptyString(provider.kind) || !PROVIDER_KINDS.has(provider.kind as ProviderKind)) {
    throw new Error(
      `Provider at index ${index} must have a valid "kind" (one of: ${Array.from(PROVIDER_KINDS).join(', ')})`,
    );
  }

  return {
    id: provider.id,
    label: typeof provider.label === 'string' ? provider.label : provider.id,
    kind: provider.kind as ProviderKind,
    baseUrl: provider.baseUrl,
    apiKeyEnv: typeof provider.apiKeyEnv === 'string' ? provider.apiKeyEnv : undefined,
    defaultModel: typeof provider.defaultModel === 'string' ? provider.defaultModel : undefined,
    models: Array.isArray(provider.models) ? (provider.models as ProviderConfig['models']) : undefined,
    capabilities: typeof provider.capabilities === 'object' && provider.capabilities !== null
      ? (provider.capabilities as ProviderConfig['capabilities'])
      : undefined,
    headers: typeof provider.headers === 'object' && provider.headers !== null
      ? (provider.headers as ProviderConfig['headers'])
      : undefined,
  };
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

  const providers = record.providers.map(assertValidProvider);

  return { providers };
}
