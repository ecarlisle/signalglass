import { readFile } from 'node:fs/promises';
import type {
  ProviderCapabilities,
  ProviderConfig,
  ProviderKind,
  ProviderModelConfig,
} from '@signalglass/providers';

export interface IngressConfig {
  providers: ProviderConfig[];
}

const INGRESS_PROVIDER_KINDS = new Set<ProviderKind>(['openai-compatible']);

const CAPABILITY_KEYS = new Set<keyof ProviderCapabilities>([
  'streaming',
  'tools',
  'vision',
  'jsonMode',
  'reasoning',
]);

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateBaseUrl(value: string, index: number): string {
  const normalizedValue = value.trim();
  let url: URL;
  try {
    url = new URL(normalizedValue);
  } catch {
    throw new Error(`Provider at index ${index} must have a valid http/https "baseUrl"`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Provider at index ${index} must have an http/https "baseUrl"`);
  }

  if (url.username || url.password) {
    throw new Error(`Provider at index ${index} must not include credentials in "baseUrl"`);
  }

  return normalizedValue;
}

function validateCapabilities(
  value: unknown,
  path: string,
): ProviderCapabilities | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new Error(`${path} must be an object with boolean capability flags`);
  }

  const capabilities: ProviderCapabilities = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (!CAPABILITY_KEYS.has(key as keyof ProviderCapabilities)) {
      throw new Error(`${path}.${key} is not a supported capability`);
    }
    if (typeof nestedValue !== 'boolean') {
      throw new Error(`${path}.${key} must be a boolean`);
    }
    capabilities[key as keyof ProviderCapabilities] = nestedValue;
  }

  return capabilities;
}

function validateModels(value: unknown, index: number): ProviderModelConfig[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`Provider at index ${index} "models" must be an array`);
  }

  return value.map((model, modelIndex) => {
    const path = `Provider at index ${index} model at index ${modelIndex}`;
    if (!isPlainObject(model)) {
      throw new Error(`${path} must be an object`);
    }
    if (!isNonEmptyString(model.id)) {
      throw new Error(`${path} must have a non-empty string "id"`);
    }

    const normalized: ProviderModelConfig = { id: model.id.trim() };

    if (model.label !== undefined) {
      if (!isNonEmptyString(model.label)) {
        throw new Error(`${path} "label" must be a non-empty string`);
      }
      normalized.label = model.label.trim();
    }

    if (model.aliases !== undefined) {
      if (!Array.isArray(model.aliases) || !model.aliases.every(isNonEmptyString)) {
        throw new Error(`${path} "aliases" must be an array of non-empty strings`);
      }
      normalized.aliases = model.aliases.map((alias) => alias.trim());
    }

    normalized.capabilities = validateCapabilities(model.capabilities, `${path} "capabilities"`);

    if (model.limits !== undefined) {
      if (!isPlainObject(model.limits)) {
        throw new Error(`${path} "limits" must be an object`);
      }
      const limits: ProviderModelConfig['limits'] = {};
      for (const key of ['contextWindow', 'maxOutputTokens'] as const) {
        const nestedValue = model.limits[key];
        if (nestedValue !== undefined) {
          if (
            typeof nestedValue !== 'number'
            || !Number.isInteger(nestedValue)
            || nestedValue <= 0
          ) {
            throw new Error(`${path} "limits.${key}" must be a positive integer`);
          }
          limits[key] = nestedValue;
        }
      }
      normalized.limits = limits;
    }

    if (model.pricing !== undefined) {
      if (!isPlainObject(model.pricing)) {
        throw new Error(`${path} "pricing" must be an object`);
      }
      const pricing: ProviderModelConfig['pricing'] = {};
      for (const key of ['inputPerMillion', 'outputPerMillion'] as const) {
        const nestedValue = model.pricing[key];
        if (nestedValue !== undefined) {
          if (typeof nestedValue !== 'number' || !Number.isFinite(nestedValue) || nestedValue < 0) {
            throw new Error(`${path} "pricing.${key}" must be a non-negative number`);
          }
          pricing[key] = nestedValue;
        }
      }
      normalized.pricing = pricing;
    }

    return normalized;
  });
}

function validateHeaders(value: unknown, index: number): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new Error(`Provider at index ${index} "headers" must be an object`);
  }

  const headers: Record<string, string> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (!isNonEmptyString(key)) {
      throw new Error(`Provider at index ${index} header names must be non-empty strings`);
    }
    const trimmedKey = key.trim();
    const normalizedHeader = trimmedKey.toLowerCase();
    if (SENSITIVE_HEADERS.has(normalizedHeader)) {
      throw new Error(`Provider at index ${index} must not configure sensitive header "${key}"`);
    }
    if (typeof nestedValue !== 'string') {
      throw new Error(`Provider at index ${index} header "${key}" must have a string value`);
    }
    headers[trimmedKey] = nestedValue;
  }

  return headers;
}

function assertValidProvider(entry: unknown, index: number): ProviderConfig {
  if (!isPlainObject(entry)) {
    throw new Error(`Provider at index ${index} must be an object`);
  }

  const provider = entry as Record<string, unknown>;

  if (!isNonEmptyString(provider.id)) {
    throw new Error(`Provider at index ${index} must have a non-empty string "id"`);
  }

  if (!isNonEmptyString(provider.baseUrl)) {
    throw new Error(`Provider at index ${index} must have a non-empty string "baseUrl"`);
  }

  if (
    !isNonEmptyString(provider.kind)
    || !INGRESS_PROVIDER_KINDS.has(provider.kind as ProviderKind)
  ) {
    throw new Error(
      `Provider at index ${index} must have a supported ingress "kind" (one of: ${Array.from(INGRESS_PROVIDER_KINDS).join(', ')})`,
    );
  }

  if (provider.label !== undefined && !isNonEmptyString(provider.label)) {
    throw new Error(`Provider at index ${index} "label" must be a non-empty string`);
  }

  if (provider.apiKeyEnv !== undefined && !isNonEmptyString(provider.apiKeyEnv)) {
    throw new Error(`Provider at index ${index} "apiKeyEnv" must be a non-empty string`);
  }

  if (provider.defaultModel !== undefined && !isNonEmptyString(provider.defaultModel)) {
    throw new Error(`Provider at index ${index} "defaultModel" must be a non-empty string`);
  }

  return {
    id: provider.id.trim(),
    label: typeof provider.label === 'string' ? provider.label.trim() : provider.id.trim(),
    kind: provider.kind as ProviderKind,
    baseUrl: validateBaseUrl(provider.baseUrl, index),
    apiKeyEnv: typeof provider.apiKeyEnv === 'string' ? provider.apiKeyEnv.trim() : undefined,
    defaultModel: typeof provider.defaultModel === 'string' ? provider.defaultModel.trim() : undefined,
    models: validateModels(provider.models, index),
    capabilities: validateCapabilities(provider.capabilities, `Provider at index ${index} "capabilities"`),
    headers: validateHeaders(provider.headers, index),
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
