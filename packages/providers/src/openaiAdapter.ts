import type {
  TraceEvent,
  TraceEventType,
  ContentPhase,
  SourceType,
} from '@signalglass/core';
import {
  createTraceEvent,
  estimateTokens,
  createDefaultCapturePolicy,
  redactAndTruncateSensitiveText,
} from '@signalglass/core';
import type { ProviderAdapter, ProviderConfig } from './types.js';

const MAX_EXCERPT_LENGTH = createDefaultCapturePolicy('standard').redaction.maxExcerptLength;

export const openaiAdapter: ProviderAdapter = {
  kind: 'openai-compatible',
  name: 'OpenAI-compatible adapter',

  normalizeRequest(input: unknown, provider: ProviderConfig): TraceEvent[] {
    const req = asRecord(input);
    const events: TraceEvent[] = [];

    const model = typeof req.model === 'string' ? req.model : provider.defaultModel;

    const messages = Array.isArray(req.messages) ? req.messages : [];
    for (const raw of messages) {
      const message = asRecord(raw);
      const role = message.role;
      const content = typeof message.content === 'string' ? message.content : '';

      if (role === 'system') {
        events.push(
          createTraceEvent({
            traceId: '', // populated by caller if needed
            type: 'instruction',
            contentPhase: 'sent',
            sourceType: 'system_instruction',
            actor: { role: 'system' },
            tokens: estimateTokens(content),
            model,
            provider: provider.id,
            payloadRef: makePayloadRef(content),
          }),
        );
      } else if (role === 'user') {
        events.push(
          createTraceEvent({
            traceId: '',
            type: 'message',
            contentPhase: 'said',
            sourceType: 'user_message',
            actor: { role: 'user' },
            tokens: estimateTokens(content),
            model,
            provider: provider.id,
            payloadRef: makePayloadRef(content),
          }),
        );
      } else if (role === 'assistant') {
        events.push(
          createTraceEvent({
            traceId: '',
            type: 'message',
            contentPhase: 'sent',
            sourceType: 'assistant_message',
            actor: { role: 'model' },
            tokens: estimateTokens(content),
            model,
            provider: provider.id,
            payloadRef: makePayloadRef(content),
          }),
        );
      }
    }

    const tools = Array.isArray(req.tools) ? req.tools : [];
    for (const raw of tools) {
      const tool = asRecord(raw);
      const toolText = JSON.stringify(tool);
      events.push(
        createTraceEvent({
          traceId: '',
          type: 'context',
          contentPhase: 'requested',
          sourceType: 'tool_call',
          actor: { role: 'agent' },
          tokens: estimateTokens(toolText),
          model,
          provider: provider.id,
          payloadRef: makePayloadRef(toolText),
        }),
      );
    }

    events.push(
      createTraceEvent({
        traceId: '',
        type: 'provider_request',
        contentPhase: 'requested',
        actor: { role: 'ingress' },
        model,
        provider: provider.id,
        routingDecision: `routed to ${provider.id} (${provider.kind})`,
        metadata: {
          baseUrl: provider.baseUrl,
          messageCount: messages.length,
          toolCount: tools.length,
        },
      }),
    );

    return events;
  },

  normalizeResponse(input: unknown, provider: ProviderConfig): TraceEvent[] {
    const res = asRecord(input);
    const events: TraceEvent[] = [];

    const model = typeof res.model === 'string' ? res.model : provider.defaultModel;

    events.push(
      createTraceEvent({
        traceId: '',
        type: 'provider_response',
        contentPhase: 'observed',
        actor: { role: 'provider' },
        model,
        provider: provider.id,
        metadata: {
          responseId: typeof res.id === 'string' ? res.id : undefined,
          object: typeof res.object === 'string' ? res.object : undefined,
        },
      }),
    );

    const choices = Array.isArray(res.choices) ? res.choices : [];
    for (const raw of choices) {
      const choice = asRecord(raw);
      const message = asRecord(choice.message);
      const content = typeof message.content === 'string' ? message.content : '';

      events.push(
        createTraceEvent({
          traceId: '',
          type: 'message',
          contentPhase: 'generated',
          sourceType: 'assistant_message',
          actor: { role: 'model' },
          tokens: estimateTokens(content),
          model,
          provider: provider.id,
          payloadRef: makePayloadRef(content),
        }),
      );
    }

    const usage = asRecord(res.usage);
    if (Object.keys(usage).length > 0) {
      events.push(
        createTraceEvent({
          traceId: '',
          type: 'inference',
          contentPhase: 'observed',
          actor: { role: 'provider' },
          tokens:
            typeof usage.total_tokens === 'number'
              ? usage.total_tokens
              : undefined,
          model,
          provider: provider.id,
          metadata: {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          },
        }),
      );
    }

    events.push(
      createTraceEvent({
        traceId: '',
        type: 'egress_response',
        contentPhase: 'returned',
        actor: { role: 'ingress' },
        model,
        provider: provider.id,
        metadata: {
          choiceCount: choices.length,
        },
      }),
    );

    return events;
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function makePayloadRef(content: string): TraceEvent['payloadRef'] {
  const excerpt = redactAndTruncateSensitiveText(content, MAX_EXCERPT_LENGTH);
  return {
    id: generateId(),
    redacted: true,
    excerpt,
    size: content.length,
  };
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
