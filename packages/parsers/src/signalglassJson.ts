import type {
  AgentRun,
  ContextBlock,
  Message,
  ToolCall,
} from '@signalglass/core';
import { isKnownSourceType } from '@signalglass/core';

/**
 * Parse a Signalglass sample run JSON object into a normalized AgentRun.
 */
export function parseSignalglassJson(input: unknown): AgentRun {
  if (!input || typeof input !== 'object') {
    throw new Error('Expected a JSON object');
  }
  const raw = input as Record<string, unknown>;

  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    throw new Error('Run must have string id and name');
  }
  if (!Array.isArray(raw.turns)) {
    throw new Error('Run must have a turns array');
  }

  const turns = raw.turns.map((turn, idx) => parseTurn(turn, idx));

  return {
    id: raw.id,
    name: raw.name,
    model: typeof raw.model === 'string' ? raw.model : undefined,
    provider: typeof raw.provider === 'string' ? raw.provider : undefined,
    agent: typeof raw.agent === 'string' ? raw.agent : undefined,
    task: typeof raw.task === 'string' ? raw.task : undefined,
    outputTokens: typeof raw.outputTokens === 'number' ? raw.outputTokens : undefined,
    turns,
    metadata: (raw.metadata as Record<string, unknown>) ?? {},
  };
}

function parseTurn(raw: unknown, idx: number) {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Turn ${idx} is not an object`);
  }
  const turn = raw as Record<string, unknown>;
  const turnNumber = typeof turn.turnNumber === 'number' ? turn.turnNumber : idx + 1;
  const turnId = typeof turn.id === 'string' ? turn.id : `turn-${idx + 1}`;

  const blocks: ContextBlock[] = [];

  const messages = Array.isArray(turn.messages) ? turn.messages : [];
  for (const message of messages) {
    blocks.push(...messageToBlocks(asRecord(message), turnId));
  }

  const toolCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
  for (const toolCall of toolCalls) {
    blocks.push(...toolCallToBlocks(asRecord(toolCall), turnId));
  }

  const explicitBlocks = Array.isArray(turn.contextBlocks) ? turn.contextBlocks : [];
  for (const block of explicitBlocks) {
    blocks.push(parseContextBlock(asRecord(block), turnId));
  }

  return {
    id: turnId,
    turnNumber,
    contextBlocks: blocks,
    outputTokens: typeof turn.outputTokens === 'number' ? turn.outputTokens : undefined,
    metadata: (turn.metadata as Record<string, unknown>) ?? {},
  };
}

function messageToBlocks(message: Record<string, unknown>, turnId: string): ContextBlock[] {
  const role = message.role;
  const content = typeof message.content === 'string' ? message.content : '';
  const sourceType =
    role === 'system'
      ? 'system_instruction'
      : role === 'user'
        ? 'user_message'
        : role === 'assistant'
          ? 'assistant_message'
          : 'unknown';

  return [
    {
      id: `msg-${turnId}-${role ?? 'unknown'}`,
      turnId,
      sourceType,
      content,
      name: sourceType,
    },
  ];
}

function toolCallToBlocks(toolCall: Record<string, unknown>, turnId: string): ContextBlock[] {
  const id = typeof toolCall.id === 'string' ? toolCall.id : `tc-${turnId}`;
  const name = typeof toolCall.name === 'string' ? toolCall.name : 'tool';
  const argsText =
    typeof toolCall.arguments === 'string'
      ? toolCall.arguments
      : JSON.stringify(toolCall.arguments ?? {});

  const blocks: ContextBlock[] = [
    {
      id: `${id}-call`,
      turnId,
      sourceType: 'tool_call',
      content: `${name} ${argsText}`,
      name,
    },
  ];

  if (typeof toolCall.output === 'string') {
    blocks.push({
      id: `${id}-output`,
      turnId,
      sourceType: 'tool_output',
      content: toolCall.output,
      name: `${name}-output`,
    });
  }

  return blocks;
}

function parseContextBlock(block: Record<string, unknown>, turnId: string): ContextBlock {
  const sourceTypeRaw = block.sourceType;
  const sourceType =
    typeof sourceTypeRaw === 'string' && isKnownSourceType(sourceTypeRaw)
      ? sourceTypeRaw
      : 'unknown';
  const id = typeof block.id === 'string' ? block.id : `block-${turnId}`;
  const content = typeof block.content === 'string' ? block.content : '';

  return {
    id,
    turnId,
    sourceType,
    content,
    name: typeof block.name === 'string' ? block.name : undefined,
    metadata: (block.metadata as Record<string, unknown>) ?? {},
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
