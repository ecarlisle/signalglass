import type { AgentRun, ContextBlock } from './types.js';
import type { AnalysisResult } from './analysis.js';
import type { ContentPhase, SavingsOpportunity } from './traces.js';
import { estimateTokens } from './tokenEstimator.js';
import {
  REPEATED_LOG_SOURCE_TYPES,
  TOOL_OUTPUT_SOURCE_TYPES,
  type SourceType,
} from './sourceTypes.js';

export type Severity = 'info' | 'warning' | 'high';

/**
 * A context smell is an educational observation about a run.
 *
 * Each smell answers:
 * - What happened?
 * - Why does it matter?
 * - What evidence supports it?
 * - What could the user inspect or try next?
 */
export interface ContextSmell {
  id: string;
  title: string;
  severity: Severity;
  whatHappened: string;
  whyItMatters: string;
  evidenceSummary: string;
  recommendation: string;
  suggestedNextSteps: string[];
  estimatedTokensInvolved: number;
  relatedTurnIds: string[];
  relatedBlockIds: string[];
  /**
   * True when the smell is based on a heuristic rather than a direct measurement.
   * Heuristic smells should be labeled as such in reports and the UI.
   */
  isHeuristic?: boolean;
  /**
   * The content phase this smell relates to, if known.
   */
  contentPhase?: ContentPhase;
  /**
   * Trace event ids that support this smell in live-mode captures.
   */
  traceEventIds?: string[];
  /**
   * Estimated savings opportunity associated with this smell.
   */
  savingsOpportunity?: SavingsOpportunity;
}

type PartialAnalysis = Omit<AnalysisResult, 'smells' | 'recommendations' | 'generatedAt'>;

interface DetectionContext {
  run: AgentRun;
  analysis: PartialAnalysis;
}

const OVERSIZED_TOOL_OUTPUT_TOKENS = 1000;
const LARGE_BLOCK_TOKENS = 2000;
const HIGH_DUPLICATE_RATIO = 0.25;
const TOOL_DOMINANCE_RATIO = 0.5;
const LATE_RELEVANT_TURN_RATIO = 0.5;

const RELEVANT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.md',
]);

export function detectSmells(ctx: DetectionContext): ContextSmell[] {
  const smells: ContextSmell[] = [];

  repeatedProjectInstruction(ctx, smells);
  repeatedFileTree(ctx, smells);
  oversizedToolOutput(ctx, smells);
  repeatedLogOutput(ctx, smells);
  lockfileInContext(ctx, smells);
  generatedArtifactInContext(ctx, smells);
  largeSingleContextBlock(ctx, smells);
  highDuplicateContextRatio(ctx, smells);
  toolOutputDominatesContext(ctx, smells);
  lateRelevantFileHeuristic(ctx, smells);

  return smells.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

function severityRank(s: Severity): number {
  return s === 'high' ? 0 : s === 'warning' ? 1 : 2;
}

function smell(partial: Omit<ContextSmell, 'relatedTurnIds' | 'relatedBlockIds'> & {
  relatedTurnIds?: string[];
  relatedBlockIds?: string[];
}): ContextSmell {
  return {
    relatedTurnIds: partial.relatedTurnIds ?? [],
    relatedBlockIds: partial.relatedBlockIds ?? [],
    isHeuristic: partial.isHeuristic ?? false,
    ...partial,
  };
}

function repeatedProjectInstruction(
  { analysis }: DetectionContext,
  smells: ContextSmell[],
) {
  const group = analysis.repeatedBlockGroups.find((g) => g.sourceType === 'project_instruction');
  if (!group) return;

  smells.push(
    smell({
      id: 'repeated_project_instruction',
      title: 'Repeated project instruction',
      severity: 'info',
      whatHappened: `The same project instruction (for example AGENTS.md) was sent ${group.occurrences} times.`,
      whyItMatters:
        'Project instructions rarely change during a run. Resending them inflates the context window and crowds out task-specific information.',
      evidenceSummary: `${group.totalTokens} tokens across ${group.occurrences} identical blocks in turns ${unique(group.turnIds).join(', ')}.`,
      recommendation:
        'Move persistent instructions into a system prompt or cache them rather than repeating them every turn.',
      suggestedNextSteps: [
        'Compare the repeated blocks in the Context Timeline to confirm they are identical.',
        'Check whether your agent framework supports a persistent system or project instruction.',
      ],
      estimatedTokensInvolved: group.totalTokens,
      relatedTurnIds: unique(group.turnIds),
      relatedBlockIds: group.blockIds,
    }),
  );
}

function repeatedFileTree({ analysis }: DetectionContext, smells: ContextSmell[]) {
  const group = analysis.repeatedBlockGroups.find((g) => g.sourceType === 'file_tree');
  if (!group) return;

  smells.push(
    smell({
      id: 'repeated_file_tree',
      title: 'Repeated file tree',
      severity: 'info',
      whatHappened: `The same file tree was sent ${group.occurrences} times.`,
      whyItMatters:
        'File trees are often large and change infrequently during a run. Repeating the full tree wastes tokens that could describe the actual problem.',
      evidenceSummary: `${group.totalTokens} tokens across ${group.occurrences} identical file-tree blocks.`,
      recommendation:
        'Send file-tree diffs or omit the tree when it has not changed since the previous turn.',
      suggestedNextSteps: [
        'Inspect the file-tree blocks to see how much of the tree is generated or irrelevant.',
        'Try sending only files that changed or a compact diff.',
      ],
      estimatedTokensInvolved: group.totalTokens,
      relatedTurnIds: unique(group.turnIds),
      relatedBlockIds: group.blockIds,
    }),
  );
}

function oversizedToolOutput({ run, analysis }: DetectionContext, smells: ContextSmell[]) {
  const blocks = analysis.largestBlocks.filter(
    (b) => TOOL_OUTPUT_SOURCE_TYPES.includes(b.sourceType) && b.tokens >= OVERSIZED_TOOL_OUTPUT_TOKENS,
  );
  if (blocks.length === 0) return;
  const total = blocks.reduce((sum, b) => sum + b.tokens, 0);

  smells.push(
    smell({
      id: 'oversized_tool_output',
      title: 'Oversized tool output',
      severity: 'warning',
      whatHappened: `${blocks.length} tool/log output block(s) exceeded ${OVERSIZED_TOOL_OUTPUT_TOKENS} tokens.`,
      whyItMatters:
        'Very long tool output can dominate the context window and drown out source files, instructions, and prior reasoning.',
      evidenceSummary: `Roughly ${total} tokens in blocks such as ${blocks.map((b) => b.name ?? b.blockId).join(', ')}.`,
      recommendation:
        'Trim verbose command output, collapse repeated stack traces, or summarize long logs before sending them to the model.',
      suggestedNextSteps: [
        'Open the largest blocks in the Evidence Drawer to see what is actually actionable.',
        'Experiment with truncation or summary of the tool output.',
      ],
      estimatedTokensInvolved: total,
      relatedTurnIds: unique(blocks.map((b) => findTurnId(run, b.blockId))),
      relatedBlockIds: blocks.map((b) => b.blockId),
    }),
  );
}

function repeatedLogOutput({ analysis }: DetectionContext, smells: ContextSmell[]) {
  const groups = analysis.repeatedBlockGroups.filter((g) =>
    REPEATED_LOG_SOURCE_TYPES.includes(g.sourceType),
  );
  if (groups.length === 0) return;
  const total = groups.reduce((sum, g) => sum + g.totalTokens, 0);
  const occurrences = groups.reduce((sum, g) => sum + g.occurrences, 0);

  smells.push(
    smell({
      id: 'repeated_log_output',
      title: 'Repeated log output',
      severity: 'warning',
      whatHappened: `The same log/test/build output was repeated ${occurrences} times across the run.`,
      whyItMatters:
        'Repeated diagnostics do not add new information after the first occurrence. They are a common source of hidden token waste.',
      evidenceSummary: `Roughly ${total} tokens in repeated log/test/build blocks.`,
      recommendation:
        'Collapse repeated log sections into a summary rather than resending the full output each turn.',
      suggestedNextSteps: [
        'Use the Context Timeline to see which turns repeated the same output.',
        'Try replacing repeated diagnostics with a count and the first few lines.',
      ],
      estimatedTokensInvolved: total,
      relatedTurnIds: unique(groups.flatMap((g) => g.turnIds)),
      relatedBlockIds: groups.flatMap((g) => g.blockIds),
    }),
  );
}

function lockfileInContext({ run }: DetectionContext, smells: ContextSmell[]) {
  const lockfileBlocks = flatten(run).filter(
    (b) =>
      b.sourceType === 'dependency_lockfile' ||
      /(pnpm-lock|package-lock|yarn\.lock|composer\.lock|Cargo\.lock)/i.test(b.name ?? ''),
  );
  if (lockfileBlocks.length === 0) return;
  const total = lockfileBlocks.reduce((sum, b) => sum + blockTokens(b), 0);

  smells.push(
    smell({
      id: 'lockfile_in_context',
      title: 'Lockfile included in context',
      severity: 'info',
      whatHappened: 'A dependency lockfile was included in the context window.',
      whyItMatters:
        'Lockfiles can be large and are only useful when dependency resolution is the active task. Otherwise they consume budget without improving the response.',
      evidenceSummary: `Roughly ${total} tokens in lockfile blocks.`,
      recommendation:
        'Only include lockfiles when dependency changes are being discussed; otherwise omit them.',
      suggestedNextSteps: [
        'Check whether the lockfile was included intentionally or by a broad file-collection rule.',
        'Remove the lockfile from the context and compare token usage.',
      ],
      estimatedTokensInvolved: total,
      relatedTurnIds: unique(lockfileBlocks.map((b) => b.turnId)),
      relatedBlockIds: lockfileBlocks.map((b) => b.id),
    }),
  );
}

function generatedArtifactInContext({ run }: DetectionContext, smells: ContextSmell[]) {
  const blocks = flatten(run).filter(
    (b) =>
      b.sourceType === 'generated_artifact' ||
      /(?:^|\/)(dist|build|coverage|out|\.next)\//i.test(b.name ?? '') ||
      /\.min\.(js|css)$/i.test(b.name ?? ''),
  );
  if (blocks.length === 0) return;
  const total = blocks.reduce((sum, b) => sum + blockTokens(b), 0);

  smells.push(
    smell({
      id: 'generated_artifact_in_context',
      title: 'Generated artifact in context',
      severity: 'warning',
      whatHappened: `${blocks.length} block(s) look like generated or build output.`,
      whyItMatters:
        'Generated files (dist, build, coverage, minified bundles) are usually not helpful for reasoning about source code and can be large.',
      evidenceSummary: `Roughly ${total} tokens in blocks such as ${blocks.map((b) => b.name ?? b.id).join(', ')}.`,
      recommendation:
        'Exclude generated directories (dist, build, coverage) and minified bundles from the context window.',
      suggestedNextSteps: [
        'Review your file-inclusion rules for generated directories.',
        'Add dist, build, and coverage to an ignore list and re-analyze the run.',
      ],
      estimatedTokensInvolved: total,
      relatedTurnIds: unique(blocks.map((b) => b.turnId)),
      relatedBlockIds: blocks.map((b) => b.id),
    }),
  );
}

function largeSingleContextBlock(
  { run, analysis }: DetectionContext,
  smells: ContextSmell[],
) {
  const blocks = analysis.largestBlocks.filter((b) => b.tokens >= LARGE_BLOCK_TOKENS);
  if (blocks.length === 0) return;
  const total = blocks.reduce((sum, b) => sum + b.tokens, 0);

  smells.push(
    smell({
      id: 'large_single_context_block',
      title: 'Large single context block',
      severity: 'warning',
      whatHappened: `${blocks.length} block(s) exceeded ${LARGE_BLOCK_TOKENS} tokens.`,
      whyItMatters:
        'A single huge block can crowd out everything else in the context window, reducing the model\'s ability to see instructions and related files.',
      evidenceSummary: `Roughly ${total} tokens in the largest blocks.`,
      recommendation:
        'Break very large blocks into smaller chunks, summarize them, or omit sections the model does not need right now.',
      suggestedNextSteps: [
        'Inspect the largest block in the Evidence Drawer to find skippable sections.',
        'Try summarizing the block or loading only the relevant portion.',
      ],
      estimatedTokensInvolved: total,
      relatedTurnIds: unique(blocks.map((b) => findTurnId(run, b.blockId))),
      relatedBlockIds: blocks.map((b) => b.blockId),
    }),
  );
}

function highDuplicateContextRatio(
  { analysis }: DetectionContext,
  smells: ContextSmell[],
) {
  if (analysis.duplicateRatio <= HIGH_DUPLICATE_RATIO) return;

  smells.push(
    smell({
      id: 'high_duplicate_context_ratio',
      title: 'High duplicate context ratio',
      severity: 'high',
      whatHappened: `Roughly ${Math.round(analysis.duplicateRatio * 100)}% of the input tokens were repeated content.`,
      whyItMatters:
        'High duplication means the model is spending a large share of the context budget on information it has already seen.',
      evidenceSummary: `${analysis.duplicateTokenCount} duplicate tokens across ${analysis.repeatedBlockGroups.length} repeated groups.`,
      recommendation:
        'Deduplicate repeated instructions, file trees, and logs across turns to reclaim context budget.',
      suggestedNextSteps: [
        'Open the Context Timeline to see which blocks repeat across turns.',
        'Identify the top repeated groups and remove or cache them.',
      ],
      estimatedTokensInvolved: analysis.duplicateTokenCount,
      relatedTurnIds: unique(analysis.repeatedBlockGroups.flatMap((g) => g.turnIds)),
      relatedBlockIds: analysis.repeatedBlockGroups.flatMap((g) => g.blockIds),
    }),
  );
}

function toolOutputDominatesContext(
  { analysis }: DetectionContext,
  smells: ContextSmell[],
) {
  if (analysis.totalInputTokens === 0) return;
  const toolTokens = TOOL_OUTPUT_SOURCE_TYPES.reduce(
    (sum, sourceType) =>
      sum + (analysis.tokensBySourceType.find((b) => b.sourceType === sourceType)?.tokens ?? 0),
    0,
  );
  if (toolTokens / analysis.totalInputTokens < TOOL_DOMINANCE_RATIO) return;

  smells.push(
    smell({
      id: 'tool_output_dominates_context',
      title: 'Tool output dominates context',
      severity: 'high',
      whatHappened: `Tool/log/test/build output makes up roughly ${Math.round((toolTokens / analysis.totalInputTokens) * 100)}% of the input tokens.`,
      whyItMatters:
        'When tool output dominates, source files and instructions can become harder for the model to attend to.',
      evidenceSummary: `${toolTokens} of ${analysis.totalInputTokens} input tokens came from tool/log/test/build sources.`,
      recommendation:
        'Trim, summarize, or selectively include tool output so source files and instructions remain visible.',
      suggestedNextSteps: [
        'Review the Token Breakdown to see which tool output sources are largest.',
        'Try trimming logs or replacing them with a short summary.',
      ],
      estimatedTokensInvolved: toolTokens,
      relatedTurnIds: analysis.tokensByTurn.filter((t) => t.inputTokens > 0).map((t) => t.turnId),
      relatedBlockIds: [],
    }),
  );
}

function lateRelevantFileHeuristic({ run }: DetectionContext, smells: ContextSmell[]) {
  if (run.turns.length < 3) return;
  const thresholdTurn = Math.ceil(run.turns.length * LATE_RELEVANT_TURN_RATIO);
  const relevantFiles = flatten(run).filter(
    (b) =>
      b.sourceType === 'file_content' &&
      hasRelevantExtension(b.name) &&
      !/(test|spec|\.d\.ts|dist|build|coverage)/i.test(b.name ?? ''),
  );
  if (relevantFiles.length === 0) return;
  const firstLate = relevantFiles
    .filter((b) => b.turnNumber > thresholdTurn)
    .sort((a, b) => a.turnNumber - b.turnNumber)[0];
  if (!firstLate) return;

  smells.push(
    smell({
      id: 'late_relevant_file_heuristic',
      title: 'Likely relevant file appeared late',
      severity: 'info',
      whatHappened: `A source file (${firstLate.name}) first appeared in turn ${firstLate.turnNumber}, after the midpoint of the run.`,
      whyItMatters:
        'Relevant source files that appear late may be crowded out by earlier noise, or the agent may have wasted turns before surfacing them.',
      evidenceSummary: `File ${firstLate.name} appeared in turn ${firstLate.turnNumber} of ${run.turns.length}.`,
      recommendation:
        'Try to surface files most relevant to the current task earlier in the run, before noisy tool output accumulates.',
      suggestedNextSteps: [
        'Verify that the file is actually relevant to the task.',
        'Check whether the agent could have included this file in an earlier turn.',
      ],
      estimatedTokensInvolved: blockTokens(firstLate),
      relatedTurnIds: [firstLate.turnId],
      relatedBlockIds: [firstLate.id],
      isHeuristic: true,
    }),
  );
}

function flatten(run: AgentRun): Array<ContextBlock & { turnNumber: number }> {
  const out: Array<ContextBlock & { turnNumber: number }> = [];
  for (const turn of run.turns) {
    for (const block of turn.contextBlocks ?? []) {
      out.push({ ...block, turnNumber: turn.turnNumber });
    }
  }
  return out;
}

function blockTokens(block: ContextBlock): number {
  return block.estimatedTokens ?? estimateTokens(block.content);
}

function findTurnId(run: AgentRun, blockId: string): string {
  for (const turn of run.turns) {
    for (const block of turn.contextBlocks ?? []) {
      if (block.id === blockId) return turn.id;
    }
  }
  return '';
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function hasRelevantExtension(name?: string): boolean {
  if (!name) return false;
  return [...RELEVANT_EXTENSIONS].some((ext) => name.endsWith(ext));
}
