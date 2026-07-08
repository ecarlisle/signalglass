import type { ProviderAdapter } from './types.js';

/**
 * Placeholder for the Anthropic provider adapter.
 *
 * Anthropic-compatible ingress is planned for a later milestone.
 */
export const anthropicAdapter: ProviderAdapter = {
  kind: 'anthropic',
  name: 'Anthropic adapter (placeholder)',
  normalizeRequest(): never {
    throw new Error('Anthropic adapter is not implemented yet');
  },
  normalizeResponse(): never {
    throw new Error('Anthropic adapter is not implemented yet');
  },
};
