/**
 * Canonical event projection (Spec 014 §5.2). `projectCanonicalEvent` is the
 * sole replay/content-conflict comparison: it excludes `observationId`,
 * `rawCapturedAt`, and all other observation-container provenance, retains
 * every canonical `EventRecord` field plus any kind-specific payload fields
 * (and unknown additive fields preserved inside the payload), and is used for
 * exact-replay classification, same-ID/content-conflict detection, and parser
 * verification. It never alters, redacts, or discards canonical event evidence.
 */
import type { EventRecord } from './types-event.js';
import type { EvidenceObservation } from './types-trace.js';
import { CONTROL_EVENT_KINDS, EVENT_KINDS } from './vocabulary.js';
import { isRecord } from './internal/guards.js';

/** Resulting projected event; an `EventRecord`. */
export type ProjectedEvent = EventRecord;

/**
 * Projects one raw observation to its canonical event. Control-event payloads
 * are dropped (they carry no canonical payload fields); payload-bearing kinds
 * merge the kind-specific payload fields onto the event top level, preserving
 * every kind-specific field including unknown additive ones.
 */
export function projectCanonicalEvent(observation: EvidenceObservation): ProjectedEvent {
  const isControl = CONTROL_EVENT_KINDS.includes(
    observation.kind as (typeof CONTROL_EVENT_KINDS)[number],
  );
  const baseEvent = {
    eventId: observation.eventId,
    traceId: observation.traceId,
    spanId: observation.spanId,
    seq: observation.seq,
    kind: observation.kind as EventRecord['kind'],
    capturedAt: observation.capturedAt,
    evidenceStatus: observation.evidenceStatus,
    ...(isControl ? {} : { observationRole: observation.observationRole ?? undefined }),
  } as EventRecord;
  if (isControl) return baseEvent;
  // Payload-bearing kind: merge the kind-specific payload fields, preserving
  // every kind-specific field including unknown additive ones. Container
  // metadata always wins: a malformed or hostile payload cannot overwrite
  // eventId/traceId/spanId/seq/kind/capturedAt/evidenceStatus. Prototype
  // keys are never copied.
  const payload = observation.payload;
  if (!isRecord(payload)) return baseEvent;
  const merged: Record<string, unknown> = {};
  for (const k of Object.keys(payload)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    merged[k] = (payload as Record<string, unknown>)[k];
  }
  return Object.assign({}, baseEvent, merged) as EventRecord;
}

/** True when `kind` is a member of the closed event-kind vocabulary. */
export function isKnownEventKind(kind: unknown): boolean {
  return typeof kind === 'string' && (EVENT_KINDS as readonly string[]).includes(kind);
}