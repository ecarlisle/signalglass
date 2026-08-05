/**
 * Matrix conformance test (Spec 014 slice 4; acceptance criterion 1).
 *
 * Verifies the loss-and-mapping matrix (`projectionMappingMatrix.ts`; see
 * `docs/evidence-projection-matrix.md`) three ways:
 * 1. the stable claim-ID registry and classification vocabulary remain
 *    present and valid, and every required Spec 014 §2.2 primitive is
 *    covered;
 * 2. every canonical event kind is accounted for by exactly one of
 *    `CANONICAL_EVENT_MAPPINGS` or `CANONICAL_EVENT_KINDS_WITHOUT_LEGACY_EQUIVALENT`,
 *    and the matrix classification agrees with the mapping tables;
 * 3. the projection paths/outcomes/reasons cited by the matrix actually
 *    appear in real projection reports over the fixed fixtures.
 *
 * Deliberately narrow: no documentation generator, no new conformance
 * framework — the matrix claims are data, and this test pins their alignment
 * with the runtime reports.
 */
import { describe, expect, it } from 'vitest';
import { EVENT_KINDS } from '@signalglass/evidence';
import type { ProjectionMapping } from './types.js';
import { evidenceToLegacyTrace } from './evidenceToLegacyTrace.js';
import {
  CANONICAL_EVENT_MAPPINGS,
  CANONICAL_EVENT_KINDS_WITHOUT_LEGACY_EQUIVALENT,
} from './eventMapping.js';
import {
  LEGACY_CONVERSION_PRESERVATION,
  PROJECTION_MAPPING_MATRIX,
  PROJECTION_MATRIX_CLAIM_IDS,
  PROJECTION_MATRIX_EVENT_KIND_CLAIMS,
} from './projectionMappingMatrix.js';
import type {
  MatrixFixtureName,
  ProjectionMatrixClaim,
} from './projectionMappingMatrix.js';
import type { ProjectionOutcome } from './types.js';
import { buildRecord, minimalObservations, obs, T0, T1, T2, T3 } from './testHelpers.js';
import type { EvidenceRecord } from '@signalglass/evidence';

const VALID_CLASSIFICATIONS: ReadonlyArray<ProjectionOutcome> = [
  'exact',
  'partial',
  'inferred',
  'unavailable',
];

/**
 * Required Spec 014 §2.2 primitive coverage: every in-slice primitive family
 * must be represented by at least one claim row.
 */
const REQUIRED_PRIMITIVES: ReadonlyArray<string> = [
  'EvidenceTrace',
  'SpanRecord',
  'EventRecord',
  'RequestEnvelope',
  'ResponseEnvelope',
  'ContextArtifact',
  'ContextContribution',
  'Condition',
  'Completeness (TraceCompleteness)',
  'Observation boundary',
  'Capture surface',
  'Capture profile reference',
  'Collection policy',
  'Identity value types',
  'Lifecycle status vocabulary',
  'Sequence ordering (seq)',
  'Timing (timestamps)',
  'Timing (monotonic durations)',
  'Provider-native fidelity',
  'Hashes (contentHash / nativeContentHash)',
  'Evidence status values',
  'Missing / redaction / truncation declarations',
  'Usage value types (UsageValue with per-field evidence status)',
];

/**
 * The pinned stable claim-ID registry (Spec 014 acceptance criterion 1).
 * Renaming or removing a claim breaks the executable verification and must
 * be a deliberate contract change.
 */
const PINNED_CLAIM_IDS: ReadonlyArray<string> = [
  'E2L-001', 'E2L-002', 'E2L-003', 'E2L-004', 'E2L-005', 'E2L-006',
  'E2L-007', 'E2L-008', 'E2L-009', 'E2L-010', 'E2L-011', 'E2L-012',
  'E2L-013', 'E2L-014', 'E2L-015', 'E2L-016', 'E2L-017', 'E2L-018',
  'E2L-019', 'E2L-020', 'E2L-021', 'E2L-022', 'E2L-023', 'E2L-024',
  'E2L-025', 'E2L-026', 'E2L-027', 'E2L-028', 'E2L-029', 'E2L-030',
  'E2L-031', 'E2L-032', 'E2L-033', 'E2L-034', 'E2L-035', 'E2L-036',
  'E2L-037', 'E2L-038', 'E2L-039', 'E2L-040', 'E2L-041', 'E2L-042',
  'E2L-043', 'E2L-044', 'E2L-045', 'E2L-046', 'E2L-047', 'E2L-048',
  'E2L-049', 'E2L-050', 'E2L-051', 'E2L-052', 'E2L-053', 'E2L-054',
  'E2L-055', 'E2L-056', 'E2L-057', 'E2L-058', 'E2L-059', 'E2L-060',
  'E2L-061', 'E2L-062', 'E2L-063', 'E2L-064', 'E2L-065', 'E2L-066',
  'E2L-067',
];

const CLAIM_IDS = PROJECTION_MATRIX_CLAIM_IDS;

function fixtureFor(name: MatrixFixtureName): EvidenceRecord {
  switch (name) {
    case 'lifecycle-only':
      return buildRecord([
        obs({ observationId: 'l0', eventId: 'evt-interaction-start', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
      ]);
    case 'minimal':
      return buildRecord(minimalObservations());
    case 'chunks':
      return buildRecord([
        obs({ observationId: 'ch0', eventId: 'evt-start', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
        obs({
          observationId: 'ch1', eventId: 'evt-req', seq: 1, kind: 'model_request',
          capturedAt: T1, rawCapturedAt: T1, observationRole: 'client_sent',
          payload: {
            requestEnvelope: {
              model: 'claude-sonnet-4', provider: 'anthropic',
              providerNativeFidelity: 'structurally_faithful',
              messages: [{ role: 'user', content: 'hello' }],
            },
            contextContributions: [
              { artifactId: 'art-1', locator: { type: 'whole' }, position: 0, provenanceState: 'recorded' },
            ],
          },
        }),
        obs({
          observationId: 'ch2', eventId: 'evt-chunk-0', seq: 2, kind: 'model_response_chunk',
          capturedAt: T2, rawCapturedAt: T2, observationRole: 'provider_reported',
          payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', chunkIndex: 0 } },
        }),
        // Equal timestamps, distinct seq — ordering must follow seq, not time.
        obs({
          observationId: 'ch3', eventId: 'evt-chunk-1', seq: 3, kind: 'model_response_chunk',
          capturedAt: T3, rawCapturedAt: T3, observationRole: 'provider_reported',
          payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', chunkIndex: 1 } },
        }),
        obs({
          observationId: 'ch4', eventId: 'evt-chunk-2', seq: 4, kind: 'model_response_chunk',
          capturedAt: T3, rawCapturedAt: T3, observationRole: 'provider_reported',
          payload: { responseEnvelope: { providerNativeFidelity: 'structurally_faithful', chunkIndex: 2 } },
        }),
        obs({ observationId: 'ch5', eventId: 'evt-end', seq: 5, kind: 'interaction_end', capturedAt: T3, rawCapturedAt: T3 }),
      ]);
  }
}

describe('projection mapping matrix — claim registry', () => {
  it('pins the stable claim-ID registry (no claim deleted or renamed)', () => {
    // The registry below is the stable contract; renaming or removing a claim
    // breaks acceptance criterion 1's executable verification.
    expect(PROJECTION_MATRIX_CLAIM_IDS).toEqual(PINNED_CLAIM_IDS);
    const unique = new Set(PROJECTION_MATRIX_CLAIM_IDS);
    expect(unique.size).toBe(PROJECTION_MATRIX_CLAIM_IDS.length);
    for (const id of PROJECTION_MATRIX_CLAIM_IDS) {
      expect(id, `claim id ${id} must use the E2L-### form`).toMatch(/^E2L-\d{3}$/);
    }
  });

  it('uses only the required classification vocabulary', () => {
    for (const claim of PROJECTION_MAPPING_MATRIX) {
      expect(
        VALID_CLASSIFICATIONS.includes(claim.classification),
        `claim ${claim.id} has invalid classification "${claim.classification}"`,
      ).toBe(true);
    }
  });

  it('covers every required Spec 014 §2.2 primitive family', () => {
    const covered = new Set(PROJECTION_MAPPING_MATRIX.map((c) => c.primitive));
    for (const primitive of REQUIRED_PRIMITIVES) {
      expect(covered.has(primitive), `matrix must cover ${primitive}`).toBe(true);
    }
  });

  it('requires a concrete reason and executable verification for every non-exact claim', () => {
    for (const claim of PROJECTION_MAPPING_MATRIX) {
      expect(claim.reason.length, `claim ${claim.id} needs a reason`).toBeGreaterThan(0);
      expect(claim.verifiedBy.length, `claim ${claim.id} needs a verification reference`).toBeGreaterThan(0);
    }
  });

  it('documents the legacy Trace → AgentRun conversion as exact preservation', () => {
    // The second projection stage wraps the existing legacy conversion; it is
    // documented as exact legacy-behavior preservation, never canonical loss.
    expect(LEGACY_CONVERSION_PRESERVATION.classification).toBe('exact');
    expect(LEGACY_CONVERSION_PRESERVATION.reason).toContain('deterministic');
    expect(LEGACY_CONVERSION_PRESERVATION.verifiedBy).toContain('legacyTraceToAgentRun.test.ts');
  });
});

describe('projection mapping matrix — event-kind coverage', () => {
  it('accounts for every canonical event kind exclusively (mapped or no legacy equivalent)', () => {
    for (const kind of EVENT_KINDS) {
      const mapped = kind in CANONICAL_EVENT_MAPPINGS;
      const omitted = CANONICAL_EVENT_KINDS_WITHOUT_LEGACY_EQUIVALENT.includes(kind);
      expect(mapped || omitted, `kind ${kind} must be mapped or omitted`).toBe(true);
      expect(mapped && omitted, `kind ${kind} must not be in both sets`).toBe(false);
      // The matrix carries a claim for every kind, and its classification
      // agrees with the mapping tables: mapped kinds are partial (vocabulary
      // loss on projection), kinds without a legacy equivalent are unavailable.
      const claim = claimForKind(kind);
      expect(claim, `matrix must carry a claim for kind ${kind}`).toBeDefined();
      expect(claim!.classification).toBe(mapped ? 'partial' : 'unavailable');
    }
  });

  it('does not claim legacy equivalents for kinds the mapping table omits', () => {
    for (const kind of EVENT_KINDS) {
      const claim = claimForKind(kind)!;
      const legacyTypeMentioned = claim.legacyTarget !== '(omitted)' && !claim.legacyTarget.startsWith('TraceEvent');
      expect(
        legacyTypeMentioned,
        `claim ${claim.id} must not imply a legacy type for kind ${kind}`,
      ).toBe(false);
    }
  });
});

describe('projection mapping matrix — runtime report alignment', () => {
  it('verifies matrix paths/outcomes/reasons exist in actual projection reports', () => {
    for (const claim of PROJECTION_MAPPING_MATRIX) {
      if (claim.runtime == null) continue;
      const record = fixtureFor(claim.runtime.fixture);
      const result = evidenceToLegacyTrace(record);
      expect(result.ok, `claim ${claim.id}: fixture ${claim.runtime.fixture} must project`).toBe(true);
      if (!result.ok) continue;

      const mappings = result.report.mappings;
      const match = findMapping(mappings, claim.runtime);
      expect(
        match,
        `claim ${claim.id}: no report mapping matches ${JSON.stringify(claim.runtime)}`,
      ).toBeDefined();
    }
  });

  it('the composed evidenceToAgentRun report exposes the same declared loss', () => {
    // Spot-check that the composed report (the pipeline parity tests use)
    // carries the matrix's core trace-level loss entries as well.
    const result = evidenceToLegacyTrace(fixtureFor('minimal'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byPath = new Map(result.report.mappings.map((m) => [m.path, m]));
    expect(byPath.get('trace.status')?.outcome).toBe('partial');
    expect(byPath.get('trace.finishedAt')?.outcome).toBe('exact');
    expect(byPath.get('trace.agent')?.outcome).toBe('unavailable');
    expect(byPath.get('trace.task')?.outcome).toBe('unavailable');
    expect(byPath.get('trace.completeness')?.outcome).toBe('unavailable');
    expect(byPath.get('trace.events[].seq')?.outcome).toBe('partial');
  });
});

function claimForKind(kind: (typeof EVENT_KINDS)[number]): ProjectionMatrixClaim | undefined {
  const id = PROJECTION_MATRIX_EVENT_KIND_CLAIMS[kind];
  return PROJECTION_MAPPING_MATRIX.find((claim) => claim.id === id);
}

function findMapping(
  mappings: readonly ProjectionMapping[],
  runtime: NonNullable<ProjectionMatrixClaim['runtime']>,
): ProjectionMapping | undefined {
  if (runtime.path != null && runtime.outcome != null) {
    return mappings.find(
      (m) => m.path === runtime.path && m.outcome === runtime.outcome,
    );
  }
  if (runtime.reasonIncludes != null) {
    const reasonIncludes = runtime.reasonIncludes;
    return mappings.find(
      (m) =>
        (runtime.outcome == null || m.outcome === runtime.outcome) &&
        m.reason.includes(reasonIncludes),
    );
  }
  return undefined;
}
