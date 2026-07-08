import type { Trace, TraceEvent } from '@signalglass/core';

export interface TraceEventGroup {
  type: string;
  count: number;
}

export interface TracePhaseGroup {
  phase: string;
  count: number;
}

export function renderTraceTerminal(trace: Trace): string {
  const lines: string[] = [];

  lines.push('Signalglass trace report');
  lines.push('');
  lines.push(`  Trace ID:    ${trace.id}`);
  lines.push(`  Status:      ${trace.status}`);
  lines.push(`  Provider:    ${trace.provider ?? 'unknown'}`);
  lines.push(`  Model:       ${trace.model ?? 'unknown'}`);
  lines.push(`  Mode:        ${trace.mode}`);
  lines.push(`  Started:     ${trace.startedAt}`);
  if (trace.endedAt) {
    lines.push(`  Ended:       ${trace.endedAt}`);
  }
  if (trace.agent) {
    lines.push(`  Agent:       ${trace.agent}`);
  }
  if (trace.task) {
    lines.push(`  Task:        ${trace.task}`);
  }

  const events = trace.events ?? [];
  const totalInput = sumTokensByPhase(events, 'sent', 'requested', 'observed');
  const totalOutput = sumTokensByPhase(events, 'generated', 'returned');

  lines.push(`  Events:      ${events.length}`);

  if (totalInput > 0) {
    lines.push(`  Input tokens:  ${totalInput} (approximate)`);
  }
  if (totalOutput > 0) {
    lines.push(`  Output tokens: ${totalOutput} (approximate)`);
  }

  // Token total from inference events
  const inferenceTokens = sumInferenceTokens(events);
  if (inferenceTokens > 0) {
    lines.push(`  Inference tokens: ${inferenceTokens} (approximate)`);
  }

  // Event type breakdown
  const typeGroups = groupByType(events);
  if (typeGroups.length > 0) {
    lines.push('');
    lines.push('Events by type');
    for (const g of typeGroups) {
      lines.push(`  ${pad(g.type, 24)} ${g.count}`);
    }
  }

  // Content phase breakdown
  const phaseGroups = groupByContentPhase(events);
  if (phaseGroups.length > 0) {
    lines.push('');
    lines.push('Events by content phase');
    for (const g of phaseGroups) {
      lines.push(`  ${pad(g.phase, 24)} ${g.count}`);
    }
  }

  // Routing decisions
  const routingDecisions = collectRoutingDecisions(events);
  if (routingDecisions.length > 0) {
    lines.push('');
    lines.push('Routing decisions');
    for (const rd of routingDecisions) {
      lines.push(`  ${rd}`);
    }
  }

  // Transformation summaries
  const transformations = collectTransformations(events);
  if (transformations.length > 0) {
    lines.push('');
    lines.push('Transformation summaries');
    for (const t of transformations) {
      lines.push(`  ${t}`);
    }
  }

  // Redacted excerpts (only when present)
  const excerpts = collectExcerpts(events);
  if (excerpts.length > 0) {
    lines.push('');
    lines.push('Content excerpts (redacted)');
    for (const excerpt of excerpts) {
      lines.push(`  [${excerpt.type}] ${excerpt.text}`);
    }
  }

  lines.push('');
  lines.push('Token counts are approximate estimates.');
  lines.push('Full raw payloads are not included in this report.');
  lines.push('API keys, secrets, and authorization headers are never stored or reported.');

  return lines.join('\n');
}

function sumTokensByPhase(events: TraceEvent[], ...phases: string[]): number {
  return events
    .filter((e) => e.contentPhase != null && phases.includes(e.contentPhase))
    .reduce((sum, e) => sum + (e.tokens ?? 0), 0);
}

function sumInferenceTokens(events: TraceEvent[]): number {
  return events
    .filter((e) => e.type === 'inference')
    .reduce((sum, e) => sum + (e.tokens ?? 0), 0);
}

function groupByType(events: TraceEvent[]): TraceEventGroup[] {
  const map = new Map<string, number>();
  for (const e of events) {
    map.set(e.type, (map.get(e.type) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

function groupByContentPhase(events: TraceEvent[]): TracePhaseGroup[] {
  const map = new Map<string, number>();
  for (const e of events) {
    if (e.contentPhase) {
      map.set(e.contentPhase, (map.get(e.contentPhase) ?? 0) + 1);
    }
  }
  return Array.from(map.entries())
    .map(([phase, count]) => ({ phase, count }))
    .sort((a, b) => b.count - a.count);
}

function collectRoutingDecisions(events: TraceEvent[]): string[] {
  const decisions: string[] = [];
  for (const e of events) {
    if (e.routingDecision) {
      decisions.push(e.routingDecision);
    }
  }
  return decisions;
}

function collectTransformations(events: TraceEvent[]): string[] {
  const summaries: string[] = [];
  for (const e of events) {
    if (e.transformationSummary) {
      summaries.push(e.transformationSummary);
    }
  }
  return summaries;
}

interface ExcerptEntry {
  type: string;
  text: string;
}

function collectExcerpts(events: TraceEvent[]): ExcerptEntry[] {
  const excerpts: ExcerptEntry[] = [];
  for (const e of events) {
    if (e.payloadRef?.excerpt && e.payloadRef.redacted) {
      excerpts.push({
        type: e.type,
        text: e.payloadRef.excerpt,
      });
    }
  }
  return excerpts;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}
