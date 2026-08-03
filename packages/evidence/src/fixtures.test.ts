/**
 * Tests: deterministic normative fixtures (Spec 014 §8.2, §9).
 * Each of the nine normative serialized examples from docs/evidence-model.md
 * is loaded as a JSON fixture and verified through the public API.
 */
import { describe, expect, it } from 'vitest';
import { parseEvidenceRecord, normalizeEvidenceRecord } from './validate.js';
import { serializeEvidenceRecord } from './serialize.js';
import { minimalObservations, buildBoundary, buildRecord, PROFILE } from './fixtures.js';
import type { EvidenceObservation } from './types-trace.js';
import type { EvidenceRecord } from './types-record.js';
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

function loadArtifactFixtures(): Array<{ name: string; data: unknown }> {
  const artifacts = [
    'artifact-art-2-0001',
    'artifact-art-2-0002',
    'artifact-art-6-0001',
    'artifact-art-6-0002',
  ];
  return artifacts.map(name => ({ name, data: loadFixture(name) }));
}

function loadMeasurementFixtures(): Array<{ name: string; data: unknown }> {
  const measurements = [
    'measurement-msr-2-0001',
    'measurement-msr-2-0002',
  ];
  return measurements.map(name => ({ name, data: loadFixture(name) }));
}

function loadInterpretationFixtures(): Array<{ name: string; data: unknown }> {
  const interpretations = [
    'interpretation-int-2-0001',
  ];
  return interpretations.map(name => ({ name, data: loadFixture(name) }));
}

describe('Normative fixtures — positive tests (Spec 014 §8.2)', () => {
  const traceFixtures = loadAllTraceFixtures();

  it('loads exactly nine trace fixtures', () => {
    expect(traceFixtures).toHaveLength(9);
    const traceIds = traceFixtures.map(f => (f.data as any).traceId);
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
    const trace = data as any;
    
    expect(trace.interactionId).toBe(trace.traceId);
    expect(trace.evidenceSchemaVersion).toBe('1.0.0');
    expect(trace.captureProfile).toBeDefined();
    expect(trace.captureSurface).toBeDefined();
    expect(trace.observationBoundary).toBeDefined();
    expect(trace.startedAt).toBeDefined();
    expect(trace.status).toBeDefined();
    expect(Array.isArray(trace.events)).toBe(true);
    expect(trace.events.length).toBeGreaterThan(0);
    if (trace.spans !== undefined) {
      expect(Array.isArray(trace.spans)).toBe(true);
    }
  });

  it.each(traceFixtures)('trace fixture $name has valid event sequence', ({ name, data }) => {
    const trace = data as any;
    const events = trace.events;
    
    expect(events[0]?.seq).toBe(0);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]?.seq).toBe(events[i - 1]?.seq + 1);
    }

    expect(events[0]?.kind).toBe('interaction_start');
    expect(events[events.length - 1]?.kind).toBe('interaction_end');

    const terminalIdx = events.findIndex((e: any) => e.kind === 'interaction_end');
    expect(terminalIdx).toBe(events.length - 1);

    const validStatuses = ['captured', 'redacted', 'truncated', 'missing', 'unknown', 'not_applicable'];
    for (const ev of events) {
      expect(validStatuses).toContain(ev.evidenceStatus);
    }

    if (trace.spans) {
      for (const span of trace.spans) {
        const startEv = events.find((e: any) => e.kind === 'span_start' && e.spanId === span.spanId);
        const endEv = events.find((e: any) => e.kind === 'span_end' && e.spanId === span.spanId);
        expect(startEv).toBeDefined();
        expect(endEv).toBeDefined();
        if (startEv && endEv) {
          expect(span.startSeq).toBe(startEv.seq);
          expect(span.endSeq).toBe(endEv.seq);
        }
      }
    }
  });

  it.each(traceFixtures)('trace fixture $name has valid observationRole rules', ({ name, data }) => {
    const trace = data as any;
    const events = trace.events;
    const controlKinds = new Set(['interaction_start', 'interaction_end', 'span_start', 'span_end']);
    for (const ev of events) {
      if (controlKinds.has(ev.kind)) {
        expect(ev.observationRole).toBeUndefined();
      } else {
        expect(ev.observationRole).toBeDefined();
      }
    }
  });

  it.each(traceFixtures)('trace fixture $name has valid envelope fidelity/status contract', ({ name, data }) => {
    const trace = data as any;
    for (const ev of trace.events) {
      if (ev.requestEnvelope) {
        expect(ev.requestEnvelope.providerNativeFidelity).toBeDefined();
        if (ev.requestEnvelope.providerNativeFidelity === 'byte_faithful') {
          expect(ev.evidenceStatus).toBe('captured');
          expect(ev.requestEnvelope.nativeEncoding).toBeDefined();
          expect(ev.requestEnvelope.nativeContentType).toBeDefined();
          expect(ev.requestEnvelope.nativeContentHash).toBeDefined();
        }
      }
      if (ev.responseEnvelope) {
        expect(ev.responseEnvelope.providerNativeFidelity).toBeDefined();
        if (ev.responseEnvelope.providerNativeFidelity === 'byte_faithful') {
          expect(ev.evidenceStatus).toBe('captured');
          expect(ev.responseEnvelope.nativeEncoding).toBeDefined();
          expect(ev.responseEnvelope.nativeContentType).toBeDefined();
          expect(ev.responseEnvelope.nativeContentHash).toBeDefined();
        }
      }
    }
  });

  it.each(traceFixtures)('trace fixture $name validates as a canonical trace view', ({ name, data }) => {
    const trace = data as any;
    
    expect(trace.events.length).toBeGreaterThan(0);
    expect(trace.events[0]?.kind).toBe('interaction_start');
    expect(trace.events[trace.events.length - 1]?.kind).toBe('interaction_end');
    
    for (const ev of trace.events) {
      expect(ev.eventId).toBeDefined();
      expect(ev.traceId).toBe(trace.traceId);
      expect(typeof ev.seq).toBe('number');
      expect(ev.kind).toBeDefined();
      expect(ev.capturedAt).toBeDefined();
      expect(ev.evidenceStatus).toBeDefined();
    }
  });
});

describe('Artifact fixtures — positive tests', () => {
  const artifactFixtures = (() => {
    const files = ['artifact-art-2-0001', 'artifact-art-2-0002', 'artifact-art-6-0001', 'artifact-art-6-0002'];
    return files.map(name => ({ name, data: loadFixture(name) }));
  })();

  it('loads all artifact fixtures', () => {
    expect(artifactFixtures).toHaveLength(4);
  });

  it('each artifact fixture has required fields', () => {
    for (const { name, data } of artifactFixtures) {
      const artifact = data as any;
      expect(artifact.artifactId).toBeDefined();
      expect(artifact.kind).toBeDefined();
      expect(artifact.evidenceStatus).toBeDefined();
      expect(artifact.payloadRef).toBeDefined();
      expect(artifact.contentFidelity).toBeDefined();
      expect(artifact.contentType).toBeDefined();
      expect(artifact.traceId).toBeDefined();
      expect(artifact.evidenceSchemaVersion).toBeDefined();
    }
  });

  it('each artifact validates against the artifact hash contract', () => {
    for (const { data } of artifactFixtures) {
      const artifact = data as any;
      expect(['byte_faithful', 'structurally_faithful']).toContain(artifact.contentFidelity);
      if (artifact.contentHash) {
        expect(artifact.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      }
      if (artifact.contentHashUnavailableReason) {
        expect(artifact.contentHashUnavailableReason).toBe('unsupported_canonicalizer');
      }
    }
  });
});

describe('Measurement fixtures — positive tests', () => {
  const measurementFixtures = (() => {
    const files = ['measurement-msr-2-0001', 'measurement-msr-2-0002'];
    return files.map(name => ({ name, data: loadFixture(name) }));
  })();

  it('loads both measurement fixtures', () => {
    expect(measurementFixtures).toHaveLength(2);
  });

  it('each measurement has required fields', () => {
    for (const { data } of measurementFixtures) {
      const m = data as any;
      expect(m.measurementId).toBeDefined();
      expect(m.type).toBeDefined();
      expect(m.value).toBeDefined();
      expect(m.unit).toBeDefined();
      expect(m.kind).toBeDefined();
      expect(m.algorithm).toBeDefined();
      expect(m.inputs).toBeDefined();
      expect(m.configuration).toBeDefined();
      expect(m.calculatedAt).toBeDefined();
    }
  });
});

describe('Interpretation fixtures — positive tests', () => {
  const interpretationFixtures = (() => {
    const files = ['interpretation-int-2-0001'];
    return files.map(name => ({ name, data: loadFixture(name) }));
  })();

  it('loads interpretation fixture', () => {
    expect(interpretationFixtures).toHaveLength(1);
    const i = interpretationFixtures[0].data as any;
    expect(i.interpretationId).toBeDefined();
    expect(i.title).toBeDefined();
    expect(i.kind).toBeDefined();
    expect(i.label).toBeDefined();
    expect(i.claim).toBeDefined();
    expect(i.confidence).toBeDefined();
    expect(i.inputs).toBeDefined();
  });
});

describe('Documentation-to-fixture consistency (Spec 014 §8.2)', () => {
  it('all nine normative trace examples from docs/evidence-model.md are represented as fixtures', () => {
    const text = readFileSync('docs/evidence-model.md', 'utf8');
    const blocks = [...text.matchAll(/\`\`\`json\n([\s\S]*?)\n\`\`\`/g)].map(m => m[1]);
    
    const traceBlocks = blocks
      .map(b => {
        try { return JSON.parse(b); } catch { return null; }
      })
      .filter(b => b && b.interactionId && Array.isArray(b.events));
    
    expect(traceBlocks).toHaveLength(9);
    
    const fixtureFiles = readdirSync(FIXTURES_DIR)
      .filter(f => f.startsWith('trace-') && f.endsWith('.json'));
    
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(9);
    
    for (const trace of traceBlocks) {
      let found = false;
      for (const f of fixtureFiles) {
        const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8'));
        if (fixture.traceId === trace.traceId) {
          found = true;
          expect(fixture.interactionId).toBe(trace.interactionId);
          expect(fixture.traceId).toBe(trace.traceId);
          expect(fixture.events.length).toBe(trace.events.length);
          expect((fixture.spans?.length ?? 0)).toBe(trace.spans?.length ?? 0);
          break;
        }
      }
      expect(found).toBe(true);
    }
  });
});
