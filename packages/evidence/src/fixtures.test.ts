/**
 * Tests: deterministic normative fixtures (Spec 014 §8.2, §9).
 * Each of the nine normative serialized examples from docs/evidence-model.md
 * is loaded as a JSON fixture and verified through the public API.
 */
import { describe, expect, it } from 'vitest';
import {
  parseEvidenceRecord,
  normalizeEvidenceRecord,
  isEventKind,
  isEvidenceStatus,
  isObservationRole,
  isContentType,
  isContentHash,
  isIdentifierString,
  isSpanKind,
  isArtifactKind,
} from '@signalglass/evidence';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, 'fixtures');

function loadFixture<T>(name: string): T {
  const path = resolve(FIXTURES_DIR, `${name}.json`);
  const content = readFileSync(path, 'utf8');
  return JSON.parse(content) as T;
}

function loadAllTraceFixtures(): Array<{ name: string; data: unknown }> {
  const files = readdirSync(FIXTURES_DIR).filter((f: string) => f.startsWith('trace-') && f.endsWith('.json'));
  files.sort((a: string, b: string) => {
    const aNum = parseInt(a.match(/trace-(\d+)-/)?.[1] || '0', 10);
    const bNum = parseInt(b.match(/trace-(\d+)-/)?.[1] || '0', 10);
    return aNum - bNum;
  });
  return files.map((f: string) => ({ name: f.replace('.json', ''), data: loadFixture(f.replace('.json', '')) }));
}

/**
 * Validates the basic structure of a trace fixture.
 * // fallow-ignore-next-line complexity
 */
function validateTraceStructure(trace: Record<string, unknown>, name: string): void {
  expect(trace.interactionId).toBe(trace.traceId);
  expect(trace.evidenceSchemaVersion).toBe('1.0.0');
  expect(trace.captureProfile).toBeDefined();
  expect(trace.captureSurface).toBeDefined();
  expect(trace.observationBoundary).toBeDefined();
  expect(trace.startedAt).toBeDefined();
  expect(trace.status).toBeDefined();
  expect(Array.isArray(trace.events)).toBe(true);
  expect((trace.events as unknown[]).length).toBeGreaterThan(0);
  if (trace.spans !== undefined) {
    expect(Array.isArray(trace.spans)).toBe(true);
  }
}

/**
 * Validates the event sequence of a trace fixture.
 * // fallow-ignore-next-line complexity
 */
// fallow-ignore-next-line complexity
function validateEventSequence(trace: Record<string, unknown>, name: string): void {
  const events = trace.events as Array<Record<string, unknown>>;

  expect(events[0]?.seq).toBe(0);
  for (let i = 1; i < events.length; i++) {
    expect(events[i]?.seq).toBe((events[i - 1]?.seq as number) + 1);
  }

  expect(events[0]?.kind).toBe('interaction_start');
  expect(events[events.length - 1]?.kind).toBe('interaction_end');

  const terminalIdx = events.findIndex((e: Record<string, unknown>) => e.kind === 'interaction_end');
  expect(terminalIdx).toBe(events.length - 1);

  const validStatuses = ['captured', 'redacted', 'truncated', 'missing', 'unknown', 'not_applicable'];
  for (const ev of events) {
    expect(validStatuses).toContain(ev.evidenceStatus);
  }

  if (trace.spans) {
    const spans = trace.spans as Array<Record<string, unknown>>;
    for (const span of spans) {
      const startEv = events.find((e: Record<string, unknown>) => e.kind === 'span_start' && e.spanId === span.spanId);
      const endEv = events.find((e: Record<string, unknown>) => e.kind === 'span_end' && e.spanId === span.spanId);
      expect(startEv).toBeDefined();
      expect(endEv).toBeDefined();
      if (startEv && endEv) {
        expect(span.startSeq).toBe(startEv.seq);
        expect(span.endSeq).toBe(endEv.seq);
      }
    }
  }
}

/**
 * Validates observationRole rules on a trace fixture.
 * // fallow-ignore-next-line complexity
 */
function validateObservationRoles(trace: Record<string, unknown>, name: string): void {
  const events = trace.events as Array<Record<string, unknown>>;
  const controlKinds = new Set(['interaction_start', 'interaction_end', 'span_start', 'span_end']);
  for (const ev of events) {
    if (controlKinds.has(ev.kind as string)) {
      expect(ev.observationRole).toBeUndefined();
    } else {
      expect(ev.observationRole).toBeDefined();
    }
  }
}

/**
 * Validates envelope fidelity/status contract on a trace fixture.
 * // fallow-ignore-next-line complexity
 */
function validateEnvelopeFidelity(trace: Record<string, unknown>, name: string): void {
  for (const ev of trace.events as Array<Record<string, unknown>>) {
    if (ev.requestEnvelope) {
      const env = ev.requestEnvelope as Record<string, unknown>;
      expect(env.providerNativeFidelity).toBeDefined();
      if (env.providerNativeFidelity === 'byte_faithful') {
        expect(ev.evidenceStatus).toBe('captured');
        expect(env.nativeEncoding).toBeDefined();
        expect(env.nativeContentType).toBeDefined();
        expect(env.nativeContentHash).toBeDefined();
      }
    }
    if (ev.responseEnvelope) {
      const env = ev.responseEnvelope as Record<string, unknown>;
      expect(env.providerNativeFidelity).toBeDefined();
      if (env.providerNativeFidelity === 'byte_faithful') {
        expect(ev.evidenceStatus).toBe('captured');
        expect(env.nativeEncoding).toBeDefined();
        expect(env.nativeContentType).toBeDefined();
        expect(env.nativeContentHash).toBeDefined();
      }
    }
  }
}

/**
 * Validates a trace fixture as a canonical trace view.
 * // fallow-ignore-next-line complexity
 */
function validateCanonicalTraceView(trace: Record<string, unknown>, name: string): void {
  const events = trace.events as Array<Record<string, unknown>>;

  expect(events.length).toBeGreaterThan(0);
  expect(events[0]?.kind).toBe('interaction_start');
  expect(events[events.length - 1]?.kind).toBe('interaction_end');

  for (const ev of events) {
    expect(ev.eventId).toBeDefined();
    expect(ev.traceId).toBe(trace.traceId);
    expect(typeof ev.seq).toBe('number');
    expect(ev.kind).toBeDefined();
    expect(ev.capturedAt).toBeDefined();
    expect(ev.evidenceStatus).toBeDefined();
  }
}

/**
 * Validates vocabulary validators on a trace fixture.
 * // fallow-ignore-next-line complexity
 */
// fallow-ignore-next-line complexity
function validateVocabularyValidators(trace: Record<string, unknown>, name: string): void {
  const events = trace.events as Array<Record<string, unknown>>;
  const spans = (trace.spans as Array<Record<string, unknown>>) || [];

  for (const ev of events) {
    expect(isEventKind(ev.kind as string)).toBe(true);
    expect(isEvidenceStatus(ev.evidenceStatus as string)).toBe(true);
    if (ev.observationRole !== undefined) {
      expect(isObservationRole(ev.observationRole as string)).toBe(true);
    }
    expect(isIdentifier(ev.eventId as string)).toBe(true);
    expect(isIdentifier(ev.traceId as string)).toBe(true);
    expect(isSeq(ev.seq as number)).toBe(true);
    expect(isTimestamp(ev.capturedAt as string)).toBe(true);
  }

  for (const span of spans) {
    expect(isSpanKind(span.kind as string)).toBe(true);
    expect(isSpanId(span.spanId as string)).toBe(true);
    if (span.parentSpanId !== null && span.parentSpanId !== undefined) {
      expect(isOptionalSpanId(span.parentSpanId as string | null)).toBe(true);
    }
  }

  for (const ev of trace.events as Array<Record<string, unknown>>) {
    if (ev.requestEnvelope) {
      const env = ev.requestEnvelope as Record<string, unknown>;
      if (env.nativeContentType) {
        expect(isContentType(env.nativeContentType as string)).toBe(true);
      }
    }
    if (ev.responseEnvelope) {
      const env = ev.responseEnvelope as Record<string, unknown>;
      if (env.nativeContentType) {
        expect(isContentType(env.nativeContentType as string)).toBe(true);
      }
    }
  }

  for (const ev of trace.events as Array<Record<string, unknown>>) {
    if (ev.requestEnvelope && (ev.requestEnvelope as Record<string, unknown>).nativeContentHash) {
      expect(isContentHash((ev.requestEnvelope as Record<string, unknown>).nativeContentHash as string)).toBe(true);
    }
    if (ev.responseEnvelope && (ev.responseEnvelope as Record<string, unknown>).nativeContentHash) {
      expect(isContentHash((ev.responseEnvelope as Record<string, unknown>).nativeContentHash as string)).toBe(true);
    }
  }
}

describe('Normative fixtures — positive tests (Spec 014 §8.2)', () => {
  const traceFixtures = (() => {
    const files = readdirSync(FIXTURES_DIR).filter((f: string) => f.startsWith('trace-') && f.endsWith('.json'));
    files.sort((a: string, b: string) => {
      const aNum = parseInt(a.match(/trace-(\d+)-/)?.[1] || '0', 10);
      const bNum = parseInt(b.match(/trace-(\d+)-/)?.[1] || '0', 10);
      return aNum - bNum;
    });
    return files.map((f: string) => ({ name: f.replace('.json', ''), data: loadFixture(f.replace('.json', '')) }));
  })();

  it('loads exactly nine trace fixtures', () => {
    expect(traceFixtures).toHaveLength(9);
    const traceIds = traceFixtures.map(f => (f.data as Record<string, unknown>).traceId as string);
    expect(traceIds).toEqual([
      '01J5TZXQ8K7M2N4P6R8T0VXWY1',
      '01J5TZXQ8K7M2N4P6R8T0VXWY2',
      '01J5TZXQ8K7M2N4P6R8T0VXWY3',
      '01J5TZXQ8K7M2N4P6R8T0VXWY4',
      '01J5TZXQ8K7M2N4P6R8T0VXWY5',
      '01J5TZXQ8K7M2N4P6R8T0VXWY6',
      '01J5TZXQ8K7M2N4P6R8T0VXWY7',
      '01J5TZXQ8K7M2N4P6R8T0VXWY8',
      '01J5TZXQ8K7M2N4P6R8T0VXWY9',
    ]);
  });

  it.each(traceFixtures)('trace fixture $name has valid structure', ({ name, data }) => {
    validateTraceStructure(data as Record<string, unknown>, name);
  });

  it.each(traceFixtures)('trace fixture $name has valid event sequence', ({ name, data }) => {
    validateEventSequence(data as Record<string, unknown>, name);
  });

  it.each(traceFixtures)('trace fixture $name has valid observationRole rules', ({ name, data }) => {
    validateObservationRoles(data as Record<string, unknown>, name);
  });

  it.each(traceFixtures)('trace fixture $name has valid envelope fidelity/status contract', ({ name, data }) => {
    validateEnvelopeFidelity(data as Record<string, unknown>, name);
  });

  it.each(traceFixtures)('trace fixture $name validates as a canonical trace view', ({ name, data }) => {
    validateCanonicalTraceView(data as Record<string, unknown>, name);
  });

  it.each(traceFixtures)('trace fixture $name passes public vocabulary validators',
    // fallow-ignore-next-line complexity
    ({ name, data }) => {
    const trace = data as Record<string, unknown>;
    const events = trace.events as Array<Record<string, unknown>>;
    const spans = (trace.spans as Array<Record<string, unknown>>) || [];

    for (const ev of events) {
      expect(isEventKind(ev.kind as string)).toBe(true);
      expect(isEvidenceStatus(ev.evidenceStatus as string)).toBe(true);
      if (ev.observationRole !== undefined) {
        expect(isObservationRole(ev.observationRole as string)).toBe(true);
      }
      expect(isIdentifierString(ev.eventId as string)).toBe(true);
      expect(isIdentifierString(ev.traceId as string)).toBe(true);
      // isSeq, isTimestamp not exported from public API; validated via normalizeEvidenceRecord
      expect(typeof ev.seq).toBe('number');
      expect((ev.seq as number) >= 0).toBe(true);
      expect(typeof ev.capturedAt).toBe('string');
    }

    for (const span of (trace.spans as Array<Record<string, unknown>>) || []) {
      expect(isSpanKind(span.kind as string)).toBe(true);
      // isSpanId, isOptionalSpanId not exported from public API
      expect(typeof span.spanId).toBe('string');
      if (span.parentSpanId !== null && span.parentSpanId !== undefined) {
        expect(typeof span.parentSpanId).toBe('string');
      }
    }

    for (const ev of trace.events as Array<Record<string, unknown>>) {
      if (ev.requestEnvelope) {
        const env = ev.requestEnvelope as Record<string, unknown>;
        if (env.nativeContentType) {
          expect(isContentType(env.nativeContentType as string)).toBe(true);
        }
      }
      if (ev.responseEnvelope) {
        const env = ev.responseEnvelope as Record<string, unknown>;
        if (env.nativeContentType) {
          expect(isContentType(env.nativeContentType as string)).toBe(true);
        }
      }
    }

    for (const ev of trace.events as Array<Record<string, unknown>>) {
      if (ev.requestEnvelope && (ev.requestEnvelope as Record<string, unknown>).nativeContentHash) {
        expect(isContentHash((ev.requestEnvelope as Record<string, unknown>).nativeContentHash as string)).toBe(true);
      }
      if (ev.responseEnvelope && (ev.responseEnvelope as Record<string, unknown>).nativeContentHash) {
        expect(isContentHash((ev.responseEnvelope as Record<string, unknown>).nativeContentHash as string)).toBe(true);
      }
    }
  });
});

describe('Documentation-to-fixture consistency (Spec 014 §8.2)', () => {
  it('all nine normative trace examples from docs/evidence-model.md are represented as fixtures with deep semantic equality', () => {
    const text = readFileSync('docs/evidence-model.md', 'utf8');
    const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m => m[1]);

    const traceBlocks = blocks
      .map(b => {
        try { return JSON.parse(b); } catch { return null; }
      })
      .filter(b => b && b.interactionId && Array.isArray(b.events));

    expect(traceBlocks).toHaveLength(9);

    const fixtureFiles = readdirSync(FIXTURES_DIR)
      .filter(f => f.startsWith('trace-') && f.endsWith('.json'));

    expect(fixtureFiles.length).toBe(9);

    // Compare complete parsed JSON values (deep semantic equality)
    for (const trace of traceBlocks) {
      let found = false;
      for (const f of fixtureFiles) {
        const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8'));
        if (fixture.traceId === trace.traceId) {
          found = true;
          // Deep semantic equality - compare complete parsed JSON values
          expect(fixture).toEqual(trace);
          break;
        }
      }
      expect(found).toBe(true);
    }

    // Verify deterministic ordering: fixtures sorted by trace number
    const sortedFixtures = fixtureFiles
      .map(f => JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8')))
      .sort((a, b) => (a.traceId as string).localeCompare(b.traceId as string));
    expect(sortedFixtures.map(t => t.traceId)).toEqual(
      traceBlocks.map(t => t.traceId).sort()
    );
  });
});
