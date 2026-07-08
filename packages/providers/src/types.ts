import type { TraceEvent } from '@signalglass/core';

export type ProviderKind =
  | 'openai-compatible'
  | 'anthropic'
  | 'gemini'
  | 'ollama'
  | 'custom';

export interface ProviderCapabilities {
  streaming?: boolean;
  tools?: boolean;
  vision?: boolean;
  jsonMode?: boolean;
  reasoning?: boolean;
}

export interface ProviderModelConfig {
  id: string;
  label?: string;
  aliases?: string[];
  capabilities?: ProviderCapabilities;
  limits?: {
    contextWindow?: number;
    maxOutputTokens?: number;
  };
  pricing?: {
    inputPerMillion?: number;
    outputPerMillion?: number;
  };
}

export interface ProviderConfig {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKeyEnv?: string;
  defaultModel?: string;
  models?: ProviderModelConfig[];
  capabilities?: ProviderCapabilities;
  headers?: Record<string, string>;
}

export interface ProviderAdapter {
  kind: ProviderKind;
  name: string;
  normalizeRequest(input: unknown, provider: ProviderConfig): TraceEvent[];
  normalizeResponse(input: unknown, provider: ProviderConfig): TraceEvent[];
  buildUpstreamRequest?(input: unknown, provider: ProviderConfig): unknown;
  buildClientResponse?(input: unknown, provider: ProviderConfig): unknown;
}

/**
 * Create a provider config with sensible defaults.
 */
export function createProviderConfig(
  partial: Partial<Omit<ProviderConfig, 'id' | 'kind' | 'baseUrl'>> &
    Pick<ProviderConfig, 'id' | 'kind' | 'baseUrl'>,
): ProviderConfig {
  return {
    ...partial,
    label: partial.label ?? partial.id,
    models: partial.models ?? [],
    capabilities: partial.capabilities ?? {},
    headers: partial.headers ?? {},
  };
}

/**
 * Resolve the API key for a provider from the environment.
 *
 * The key value is read at runtime and never stored in the config.
 */
export function resolveProviderApiKey(
  provider: ProviderConfig,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (!provider.apiKeyEnv) return undefined;
  return env[provider.apiKeyEnv];
}
