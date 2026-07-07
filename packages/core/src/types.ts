import type { SourceType } from './sourceTypes.js';

/**
 * A normalized chunk of context sent to the model during a turn.
 */
export interface ContextBlock {
  id: string;
  turnId: string;
  sourceType: SourceType;
  content: string;
  name?: string;
  estimatedTokens?: number;
  metadata?: Record<string, unknown>;
}

/**
 * One back-and-forth step in an agent run.
 */
export interface Turn {
  id: string;
  turnNumber: number;
  contextBlocks: ContextBlock[];
  outputTokens?: number;
  metadata?: Record<string, unknown>;
}

/**
 * A complete AI-agent run.
 */
export interface AgentRun {
  id: string;
  name: string;
  model?: string;
  provider?: string;
  agent?: string;
  task?: string;
  turns: Turn[];
  outputTokens?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Raw message shape often found in run dumps.
 * Parsers convert messages into ContextBlocks.
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Raw tool-call shape often found in run dumps.
 */
export interface ToolCall {
  id?: string;
  name: string;
  arguments?: string | Record<string, unknown>;
  output?: string;
}
