import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  createProviderConfig,
  resolveProviderApiKey,
  openaiAdapter,
} from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): unknown {
  const filePath = path.join(__dirname, 'fixtures', name);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

const testProvider = createProviderConfig({
  id: 'openai',
  label: 'OpenAI',
  kind: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  defaultModel: 'gpt-4o',
});

describe('provider config', () => {
  it('creates a provider config with defaults', () => {
    const config = createProviderConfig({
      id: 'openai',
      kind: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
    });

    expect(config.id).toBe('openai');
    expect(config.kind).toBe('openai-compatible');
    expect(config.label).toBe('openai');
    expect(config.models).toEqual([]);
    expect(config.capabilities).toEqual({});
    expect(config.headers).toEqual({});
  });

  it('resolves API keys from environment variable names', () => {
    const env = { OPENAI_API_KEY: 'sk-test-key' };
    const key = resolveProviderApiKey(testProvider, env);
    expect(key).toBe('sk-test-key');
  });

  it('returns undefined when no API key env var is configured', () => {
    const config = createProviderConfig({
      id: 'ollama-local',
      kind: 'ollama',
      baseUrl: 'http://localhost:11434',
    });
    expect(resolveProviderApiKey(config, {})).toBeUndefined();
  });
});

describe('openai adapter', () => {
  it('normalizes system messages into instruction/sent events', () => {
    const request = loadFixture('openai-chat-request.json');
    const events = openaiAdapter.normalizeRequest(request, testProvider);

    const instruction = events.find((e) => e.type === 'instruction');
    expect(instruction).toBeDefined();
    expect(instruction?.contentPhase).toBe('sent');
    expect(instruction?.sourceType).toBe('system_instruction');
    expect(instruction?.payloadRef?.excerpt).toContain('helpful coding assistant');
  });

  it('normalizes user messages into message/said events', () => {
    const request = loadFixture('openai-chat-request.json');
    const events = openaiAdapter.normalizeRequest(request, testProvider);

    const userMessage = events.find(
      (e) => e.type === 'message' && e.contentPhase === 'said',
    );
    expect(userMessage).toBeDefined();
    expect(userMessage?.sourceType).toBe('user_message');
    expect(userMessage?.payloadRef?.excerpt).toContain('Fix the failing TypeScript build');
  });

  it('records tool schemas as context/requested events', () => {
    const request = loadFixture('openai-chat-request.json');
    const events = openaiAdapter.normalizeRequest(request, testProvider);

    const toolEvent = events.find((e) => e.type === 'context');
    expect(toolEvent).toBeDefined();
    expect(toolEvent?.contentPhase).toBe('requested');
    expect(toolEvent?.sourceType).toBe('tool_call');
    expect(toolEvent?.payloadRef?.excerpt).toContain('run_command');
  });

  it('records a provider_request event with routing metadata', () => {
    const request = loadFixture('openai-chat-request.json');
    const events = openaiAdapter.normalizeRequest(request, testProvider);

    const providerRequest = events.find((e) => e.type === 'provider_request');
    expect(providerRequest).toBeDefined();
    expect(providerRequest?.contentPhase).toBe('requested');
    expect(providerRequest?.provider).toBe('openai');
    expect(providerRequest?.routingDecision).toContain('openai');
    expect(providerRequest?.metadata).toMatchObject({
      messageCount: 2,
      toolCount: 1,
    });
  });

  it('normalizes provider response usage metadata', () => {
    const response = loadFixture('openai-chat-response.json');
    const events = openaiAdapter.normalizeResponse(response, testProvider);

    const inference = events.find((e) => e.type === 'inference');
    expect(inference).toBeDefined();
    expect(inference?.tokens).toBe(148);
    expect(inference?.metadata).toMatchObject({
      promptTokens: 120,
      completionTokens: 28,
      totalTokens: 148,
    });
  });

  it('normalizes assistant content as generated message events', () => {
    const response = loadFixture('openai-chat-response.json');
    const events = openaiAdapter.normalizeResponse(response, testProvider);

    const generated = events.find(
      (e) => e.type === 'message' && e.contentPhase === 'generated',
    );
    expect(generated).toBeDefined();
    expect(generated?.sourceType).toBe('assistant_message');
    expect(generated?.payloadRef?.excerpt).toContain('I fixed the type mismatch');
  });

  it('records egress_response as returned', () => {
    const response = loadFixture('openai-chat-response.json');
    const events = openaiAdapter.normalizeResponse(response, testProvider);

    const egress = events.find((e) => e.type === 'egress_response');
    expect(egress).toBeDefined();
    expect(egress?.contentPhase).toBe('returned');
  });

  it('does not expose authorization header or API key values', () => {
    const request = loadFixture('openai-chat-request.json') as Record<string, unknown>;
    const malicious = {
      ...request,
      authorization: 'Bearer sk-secret-key',
      api_key: 'sk-secret-key',
    };

    const events = openaiAdapter.normalizeRequest(malicious, testProvider);
    const json = JSON.stringify(events);

    expect(json).not.toContain('sk-secret-key');
    expect(json).not.toContain('Bearer');
    expect(json).not.toContain('authorization');
    expect(json).not.toContain('api_key');
  });
});
