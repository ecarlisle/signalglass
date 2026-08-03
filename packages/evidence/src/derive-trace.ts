/**
 * Canonical trace derivation (Spec 014 §2.2.1–§2.2.2, §4.7). Derives the
 * deterministic normalized trace from retained canonical events and the raw
 * observations (span metadata lives in the `span_start` observation payload;
 * monotonic `durationMs` in the `span_end` observation payload). Status
 * follows §4.7 lifecycle rules exclusively from `lifecycleTarget` /
 * `lifecycleEffect` — never from timestamps, roles, or free-form text.
 */
import type { EvidenceObservation } from './types-trace.js';
import type { SpanRecord, EvidenceTrace } from './types-trace.js';
import type { EventRecord } from './types-event.js';
import type { CaptureBoundary } from './types-record.js';
import type { Condition } from './types-base.js';
import type { ValidationIssue } from './types-analysis.js';
import type { LifecycleEffect, LifecycleTarget, TraceStatus, SpanStatus } from './vocabulary.js';
import { isRecord } from './internal/guards.js';
import { isSpanKind } from './guards.js';

export type TraceMetadata = {
  evidenceSchemaVersion: string;
  captureProfile: { name: string; version: string };
  captureBoundary: CaptureBoundary;
  conditions?: readonly Condition[];
};

export type DeriveTraceResult = { trace: EvidenceTrace; issues: ValidationIssue[] };

const REQUEST_KIND_RE = /_(request|call)$/;

function isTerminalTraceDecl(e: EventRecord): boolean {
  if (e.kind === 'error') {
    return e.lifecycleTarget === 'trace' && e.lifecycleEffect === 'fail';
  }
  if (e.kind === 'cancelled') {
    return e.lifecycleTarget === 'trace' && e.lifecycleEffect === 'cancel';
  }
  return false;
}

function isTerminalSpanDecl(e: EventRecord): boolean {
  if (e.kind === 'error') {
    return e.lifecycleTarget === 'span' && e.lifecycleEffect === 'fail';
  }
  if (e.kind === 'cancelled') {
    return e.lifecycleTarget === 'span' && e.lifecycleEffect === 'cancel';
  }
  return false;
}

export function deriveTrace(
  events: readonly EventRecord[],
  observations: readonly EvidenceObservation[],
  meta: TraceMetadata,
): DeriveTraceResult {
  const issues: ValidationIssue[] = [];
  const obsByEventId = new Map<string, EvidenceObservation>();
  for (const o of observations) {
    if (!obsByEventId.has(o.eventId)) obsByEventId.set(o.eventId, o);
  }

  // ---- Identity and start event ----
  const startEvt = events.find((e) => e.kind === 'interaction_start');
  if (!startEvt) {
    issues.push({ code: 'missing_interaction_start', path: 'trace.events', message: 'trace has no interaction_start event' });
  } else if (startEvt.seq !== 0) {
    issues.push({ code: 'interaction_start_not_first', path: 'trace.events', message: `interaction_start must be seq 0 (observed at seq ${startEvt.seq})` });
  }
  const traceId = events.length > 0 ? events[0]!.traceId : '';
  const startedAt = startEvt?.capturedAt ?? '';

  // ---- Spans ----
  const spanIdSet = new Set<string>();
  const spans: SpanRecord[] = [];
  const spanStartBySpanId = new Map<string, EventRecord>();
  for (const e of events) {
    if (e.kind === 'span_start') {
      const sid = e.spanId;
      if (sid === null) {
        issues.push({ code: 'span_start_null_span', path: `trace.events[eventId=${e.eventId}]`, message: `span_start '${e.eventId}' has spanId null` });
        continue;
      }
      if (spanIdSet.has(sid)) {
        issues.push({ code: 'duplicate_span_id', path: 'trace.spans', message: `span id '${sid}' started more than once` });
        continue;
      }
      spanIdSet.add(sid);
      spanStartBySpanId.set(sid, e);
    }
  }
  const spanEndBySpanId = new Map<string, EventRecord>();
  const spanEvents = new Map<string, EventRecord[]>();
  for (const e of events) {
    if (e.spanId !== null) {
      const list = spanEvents.get(e.spanId) ?? [];
      list.push(e);
      spanEvents.set(e.spanId, list);
      if (e.kind === 'span_end') spanEndBySpanId.set(e.spanId, e);
    }
  }
  for (const sid of spanIdSet) {
    const start = spanStartBySpanId.get(sid)!;
    const obs = obsByEventId.get(start.eventId);
    const metaSpan = readSpanMetadata(obs);
    if (!metaSpan) {
      issues.push({ code: 'span_start_missing_metadata', path: `rawObservations[eventId=${start.eventId}]`, message: `span_start '${start.eventId}' carries no span metadata; the canonical SpanRecord cannot be derived` });
      continue;
    }
    const list = (spanEvents.get(sid) ?? []).sort((a, b) => a.seq - b.seq);
    const final = list[list.length - 1];
    const priorDecl = list.slice(0, -1).find((e) => isTerminalSpanDecl(e));
    const endEvt = spanEndBySpanId.get(sid);

    let status: SpanStatus;
    let endSeq: number | undefined;
    let finishedAt: string | undefined;
    if (final && final.kind === 'span_end') {
      if (priorDecl) {
        issues.push({ code: 'terminal_declaration_not_final', path: `trace.spans[spanId=${sid}]`, message: `span '${sid}' declares terminal ${priorDecl.kind} before span_end; contradiction` });
      }
      status = 'completed';
      endSeq = final.seq;
      finishedAt = final.capturedAt;
    } else if (final && final.kind === 'error' && final.lifecycleTarget === 'span' && final.lifecycleEffect === 'fail') {
      status = 'failed';
      finishedAt = final.capturedAt;
    } else if (final && final.kind === 'cancelled' && final.lifecycleTarget === 'span' && final.lifecycleEffect === 'cancel') {
      status = 'cancelled';
      finishedAt = final.capturedAt;
    } else {
      status = 'unknown';
      if (endEvt) {
        issues.push({ code: 'span_end_without_completion', path: `trace.spans[spanId=${sid}]`, message: `span '${sid}' has span_end but a terminal declaration contradicts completion` });
      }
    }
    if (priorDecl && status === 'unknown') {
      // Terminal declaration exists for this span but is not the final event.
      issues.push({ code: 'terminal_declaration_not_final', path: `trace.spans[spanId=${sid}]`, message: `span '${sid}' terminal declaration is not its final applicable event` });
    }

    const endObs = endEvt ? obsByEventId.get(endEvt.eventId) : undefined;
    const durationMs = readDurationMs(endObs);
    spans.push({
      spanId: sid,
      kind: metaSpan.kind,
      name: metaSpan.name,
      parentSpanId: metaSpan.parentSpanId ?? null,
      startSeq: start.seq,
      startedAt: start.capturedAt,
      status,
      ...(endSeq !== undefined ? { endSeq } : {}),
      ...(finishedAt !== undefined ? { finishedAt } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(metaSpan.participants ? { participants: metaSpan.participants } : {}),
    });
  }

  // Events referencing unknown spans.
  for (const e of events) {
    if (e.spanId !== null && !spanIdSet.has(e.spanId)) {
      issues.push({ code: 'unknown_span_reference', path: `trace.events[eventId=${e.eventId}]`, message: `event '${e.eventId}' references unknown span '${e.spanId}'` });
    }
    if (e.kind === 'span_end' && e.spanId !== null && !spanStartBySpanId.has(e.spanId)) {
      issues.push({ code: 'orphan_span_end', path: `trace.events[eventId=${e.eventId}]`, message: `span_end '${e.eventId}' has no span_start` });
    }
  }

  // ---- Trace status (§4.7) ----
  const finalEvt = events[events.length - 1];
  const priorTraceDecl = events.slice(0, -1).find((e) => isTerminalTraceDecl(e));
  let status: TraceStatus;
  let finishedAt: string | undefined;
  if (finalEvt && finalEvt.kind === 'interaction_end') {
    if (priorTraceDecl) {
      issues.push({ code: 'terminal_declaration_not_final', path: 'trace', message: `trace declares terminal ${priorTraceDecl.kind} before interaction_end; contradiction` });
    }
    status = 'completed';
    finishedAt = finalEvt.capturedAt;
  } else if (finalEvt && finalEvt.kind === 'error' && finalEvt.lifecycleTarget === 'trace' && finalEvt.lifecycleEffect === 'fail') {
    status = 'failed';
    finishedAt = finalEvt.capturedAt;
  } else if (finalEvt && finalEvt.kind === 'cancelled' && finalEvt.lifecycleTarget === 'trace' && finalEvt.lifecycleEffect === 'cancel') {
    status = 'cancelled';
    finishedAt = finalEvt.capturedAt;
  } else {
    status = 'unknown';
    if (priorTraceDecl) {
      issues.push({ code: 'terminal_declaration_not_final', path: 'trace', message: `trace terminal declaration is not its final applicable event` });
    }
  }
  // Traces with no interaction_end and no terminal declaration stay unknown.
  if (finalEvt && finalEvt.kind === 'interaction_end' && priorTraceDecl) {
    // Contradiction already reported; leave status completed but the record
    // will be rejected on issues.
  }

  // ---- Retry references ----
  const eventById = new Map(events.map((e) => [e.eventId, e]));
  for (const e of events) {
    if (e.kind !== 'retry') continue;
    const r = e.retry;
    const orig = eventById.get(r.originalRequestEventId);
    if (!orig) {
      issues.push({ code: 'retry_unknown_original', path: `trace.events[eventId=${e.eventId}]`, message: `retry '${e.eventId}' references unknown originalRequestEventId '${r.originalRequestEventId}'` });
    } else if (!REQUEST_KIND_RE.test(orig.kind)) {
      issues.push({ code: 'retry_original_not_request', path: `trace.events[eventId=${e.eventId}]`, message: `retry originalRequestEventId '${r.originalRequestEventId}' is not a request event` });
    }
    if (r.errorEventId !== undefined) {
      const err = eventById.get(r.errorEventId);
      if (!err) {
        issues.push({ code: 'retry_unknown_error', path: `trace.events[eventId=${e.eventId}]`, message: `retry '${e.eventId}' references unknown errorEventId '${r.errorEventId}'` });
      } else if (err.kind !== 'error') {
        issues.push({ code: 'retry_error_not_error', path: `trace.events[eventId=${e.eventId}]`, message: `retry errorEventId '${r.errorEventId}' is not an error event` });
      }
    }
  }

  // ---- Parent span references ----
  for (const s of spans) {
    if (s.parentSpanId !== null && !spanIdSet.has(s.parentSpanId)) {
      issues.push({ code: 'unknown_parent_span', path: `trace.spans[spanId=${s.spanId}]`, message: `span '${s.spanId}' references unknown parentSpanId '${s.parentSpanId}'` });
    }
  }

  const trace: EvidenceTrace = {
    interactionId: traceId,
    traceId,
    evidenceSchemaVersion: meta.evidenceSchemaVersion,
    captureProfile: meta.captureProfile,
    captureSurface: meta.captureBoundary.captureSurface,
    observationBoundary: meta.captureBoundary.observationBoundary,
    startedAt,
    status,
    spans: spans.sort((a, b) => a.startSeq - b.startSeq),
    events: [...events].sort((a, b) => a.seq - b.seq),
    ...(finishedAt !== undefined ? { finishedAt } : {}),
    ...(meta.conditions && meta.conditions.length > 0 ? { conditions: meta.conditions } : {}),
  };

  return { trace, issues };
}

type SpanMeta = {
  kind: SpanRecord['kind'];
  name: string;
  parentSpanId: string | null;
  participants?: string[];
};

/** Span declaration metadata from the span_start observation payload. Kind is
 * validated against the closed SPAN_KINDS vocabulary and `parentSpanId` is
 * required to be null or a non-empty opaque string (never coerced), so
 * malformed declarations surface as a `span_start_missing_metadata` issue. */
function readSpanMetadata(obs: EvidenceObservation | undefined): SpanMeta | null {
  if (!obs || !isRecord(obs.payload)) return null;
  const span = obs.payload['span'];
  if (!isRecord(span)) return null;
  const kind = span['kind'];
  const name = span['name'];
  if (typeof kind !== 'string' || !isSpanKind(kind) || typeof name !== 'string') return null;
  const parent = span['parentSpanId'];
  let parentSpanId: string | null;
  if (parent === null || parent === undefined) {
    parentSpanId = null;
  } else if (typeof parent === 'string' && parent.length > 0) {
    parentSpanId = parent;
  } else {
    // Numeric/object parentSpanId is invalid container metadata; reject
    // rather than silently coercing it through String().
    return null;
  }
  const participants = span['participants'];
  return {
    kind: kind as SpanRecord['kind'],
    name,
    parentSpanId,
    ...(Array.isArray(participants) && participants.every((p) => typeof p === 'string')
      ? { participants: participants as string[] }
      : {}),
  };
}

/** Monotonic duration observed at span end (only when the span declared a
 * clock basis — enforced by the per-record validators). */
function readDurationMs(obs: EvidenceObservation | undefined): number | undefined {
  if (!obs || !isRecord(obs.payload)) return undefined;
  const d = obs.payload['durationMs'];
  if (typeof d === 'number' && Number.isFinite(d) && d >= 0) return d;
  return undefined;
}