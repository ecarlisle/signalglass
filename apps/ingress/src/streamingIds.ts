import { randomUUID } from 'node:crypto';
import type { FinalizationBundle, FinalizationValue } from '@signalglass/streaming';

export type StreamingIdAllocator = {
  next(): FinalizationValue;
  readonly eventIds: readonly string[];
  readonly observationIds: readonly string[];
  readonly capturedAtBySeq: readonly string[];
  readonly finalizationBundle: FinalizationBundle;
};

/** Allocate observation identities at observation time while keeping one
 * immutable terminal bundle for every exact admission preview and the final
 * record (Spec 016 §12.6). */
export function createStreamingIdAllocator(traceId: string): StreamingIdAllocator {
  const baseMs = Date.now();
  const eventIds: string[] = [];
  const observationIds: string[] = [];
  const capturedAtBySeq: string[] = [];
  const allocate = (label: string): FinalizationValue => {
    return {
      eventId: `${traceId}-evt-${label}-${randomUUID()}`,
      observationId: `${traceId}-obs-${label}-${randomUUID()}`,
      // One explicit observation-burst timestamp keeps the preallocated
      // terminal bundle stable without inventing a future terminal time.
      capturedAt: new Date(baseMs).toISOString(),
    };
  };
  const finalizationBundle: FinalizationBundle = [allocate('term-0'), allocate('term-1')];
  return {
    next: () => {
      const value = allocate(String(eventIds.length));
      eventIds.push(value.eventId);
      observationIds.push(value.observationId);
      capturedAtBySeq.push(value.capturedAt);
      return value;
    },
    eventIds,
    observationIds,
    capturedAtBySeq,
    finalizationBundle,
  };
}
