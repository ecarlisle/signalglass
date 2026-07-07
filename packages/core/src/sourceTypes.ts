export const SOURCE_TYPES = [
  'system_instruction',
  'project_instruction',
  'user_message',
  'assistant_message',
  'tool_call',
  'tool_output',
  'file_tree',
  'file_content',
  'diff',
  'log_output',
  'test_output',
  'build_output',
  'dependency_lockfile',
  'generated_artifact',
  'unknown',
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export function isKnownSourceType(value: string): value is SourceType {
  return SOURCE_TYPES.includes(value as SourceType);
}

export const TOOL_OUTPUT_SOURCE_TYPES: SourceType[] = [
  'tool_output',
  'log_output',
  'test_output',
  'build_output',
];

export const REPEATED_LOG_SOURCE_TYPES: SourceType[] = [
  'log_output',
  'test_output',
  'build_output',
];
