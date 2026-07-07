import type { AgentRun } from '@signalglass/core';

/**
 * Placeholder for an OpenCode run parser.
 *
 * OpenCode support is planned for phase 2 of the MVP.
 * This module exists to keep the parser architecture explicit.
 */
export const opencodeParser = {
  name: 'OpenCode',
  canParse(_input: unknown): boolean {
    return false;
  },
  parse(_input: unknown): AgentRun {
    throw new Error('OpenCode parser is not implemented yet');
  },
};
