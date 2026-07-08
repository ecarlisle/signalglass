import type { ContextSmell } from './smells.js';

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  /**
   * Why acting on this recommendation matters for the run.
   */
  whyItMatters: string;
  /**
   * Something the user can inspect to verify the finding.
   */
  inspectSuggestion: string;
  /**
   * Something the user can try to improve the run.
   */
  trySuggestion: string;
  smellIds: string[];
  /**
   * Estimated token savings if the recommendation is applied.
   */
  potentialSavings?: number;
  /**
   * How automated this recommendation is.
   */
  automationStatus?: 'manual' | 'preview' | 'assisted';
  /**
   * Trace event ids that support this recommendation in live-mode captures.
   */
  traceEventIds?: string[];
}

const RECOMMENDATION_MAP: Record<string, Recommendation> = {
  repeated_project_instruction: {
    id: 'deduplicate-instructions',
    title: 'Deduplicate instructions',
    description:
      'Avoid resending the same project instructions every turn. Put them in a system prompt or cache them.',
    whyItMatters:
      'Repeated instructions inflate the context window without adding new information, leaving less room for the task at hand.',
    inspectSuggestion:
      'Open the Context Timeline and compare the project-instruction blocks across turns.',
    trySuggestion:
      'Move the instruction to a system prompt or configure your agent to send it only once.',
    smellIds: ['repeated_project_instruction'],
  },
  repeated_file_tree: {
    id: 'compress-file-tree',
    title: 'Compress or diff file trees',
    description:
      'Only send the file tree when it changes, or send a compact diff instead of the full listing.',
    whyItMatters:
      'File trees are often large and stable; repeating the full tree wastes tokens on redundant structure.',
    inspectSuggestion:
      'Look at the file-tree blocks in the Context Timeline to see how much is repeated.',
    trySuggestion:
      'Send a diff of changed files, or omit the tree when no files were added or removed.',
    smellIds: ['repeated_file_tree'],
  },
  oversized_tool_output: {
    id: 'trim-tool-output',
    title: 'Trim verbose tool output',
    description:
      'Truncate or summarize long command output before including it in the context window.',
    whyItMatters:
      'Oversized tool output can dominate the context window and reduce the model\'s attention to source files.',
    inspectSuggestion:
      'Open the largest tool-output blocks in the Evidence Drawer and identify the actionable lines.',
    trySuggestion:
      'Set a max line count, collapse repeated stack traces, or replace the log with a summary.',
    smellIds: ['oversized_tool_output'],
  },
  repeated_log_output: {
    id: 'collapse-logs',
    title: 'Collapse repeated logs',
    description:
      'Replace repeated log sections with a short summary rather than resending the full output each turn.',
    whyItMatters:
      'Repeated diagnostics do not add new information; they are a hidden source of token waste.',
    inspectSuggestion:
      'Use the Context Timeline to see which turns repeated the same log output.',
    trySuggestion:
      'Keep the first occurrence and replace later ones with "same diagnostic repeated N times".',
    smellIds: ['repeated_log_output'],
  },
  lockfile_in_context: {
    id: 'lockfile-caution',
    title: 'Be cautious with lockfiles',
    description:
      'Include lockfiles only when dependency resolution is the active topic; they are expensive otherwise.',
    whyItMatters:
      'Lockfiles can be large and are usually irrelevant unless the task involves changing dependencies.',
    inspectSuggestion:
      'Check why the lockfile was included and whether dependency resolution is part of the task.',
    trySuggestion:
      'Remove the lockfile from the context and re-run to see if the response quality changes.',
    smellIds: ['lockfile_in_context'],
  },
  generated_artifact_in_context: {
    id: 'exclude-generated-artifacts',
    title: 'Exclude generated artifacts',
    description:
      'Keep generated directories and minified bundles out of the context window.',
    whyItMatters:
      'Generated files rarely help the model reason about source code and can consume significant budget.',
    inspectSuggestion:
      'Look at the generated-artifact blocks to confirm they are build output.',
    trySuggestion:
      'Add dist, build, coverage, and *.min.js to your file-collection ignore list.',
    smellIds: ['generated_artifact_in_context'],
  },
  large_single_context_block: {
    id: 'split-large-blocks',
    title: 'Split or summarize large blocks',
    description:
      'Break huge blocks into smaller pieces or summarize them so they do not crowd out other context.',
    whyItMatters:
      'One enormous block can push instructions and related files out of the effective context window.',
    inspectSuggestion:
      'Open the largest block in the Evidence Drawer and look for skippable sections.',
    trySuggestion:
      'Split the block by topic, summarize it, or load only the portion relevant to the current turn.',
    smellIds: ['large_single_context_block'],
  },
  high_duplicate_context_ratio: {
    id: 'deduplicate-context',
    title: 'Deduplicate repeated context',
    description:
      'Review repeated context across turns and remove or cache duplicates to reclaim budget.',
    whyItMatters:
      'High duplication means a large share of the budget is spent on information the model has already seen.',
    inspectSuggestion:
      'Open the Context Timeline and sort blocks by source type to find the biggest repeated groups.',
    trySuggestion:
      'Remove repeated instructions, file trees, and logs; keep one canonical copy where needed.',
    smellIds: ['high_duplicate_context_ratio'],
  },
  tool_output_dominates_context: {
    id: 'reduce-tool-noise',
    title: 'Reduce tool-output noise',
    description:
      'Make tool output shorter or more selective so source files and instructions remain visible.',
    whyItMatters:
      'When tool output dominates, the model may miss instructions and relevant source context.',
    inspectSuggestion:
      'Review the Token Breakdown to see which tool output sources consume the most tokens.',
    trySuggestion:
      'Trim logs, summarize test output, or only include the first and last lines of long commands.',
    smellIds: ['tool_output_dominates_context'],
  },
  late_relevant_file_heuristic: {
    id: 'prioritize-relevant-files',
    title: 'Prioritize relevant files earlier',
    description:
      'Surface files likely to matter for the current task before noisy output accumulates.',
    whyItMatters:
      'Files that appear late may be crowded out by earlier tool output or repeated context.',
    inspectSuggestion:
      'Verify in the Context Timeline that the file is relevant and could have appeared earlier.',
    trySuggestion:
      'Adjust your agent\'s retrieval logic to rank task-relevant files higher in early turns.',
    smellIds: ['late_relevant_file_heuristic'],
  },
};

export function generateRecommendations(smells: ContextSmell[]): Recommendation[] {
  const seen = new Set<string>();
  const recommendations: Recommendation[] = [];

  for (const smell of smells) {
    const rec = RECOMMENDATION_MAP[smell.id];
    if (rec && !seen.has(rec.id)) {
      seen.add(rec.id);
      recommendations.push(rec);
    }
  }

  return recommendations;
}
