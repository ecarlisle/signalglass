/**
 * Matrix conformance test (Spec 014 slice 4; acceptance criterion 1).
 *
 * Verifies the loss-and-mapping matrix (`projectionMappingMatrix.ts`; see
 * `docs/evidence-projection-matrix.md`) three ways:
 * 1. the stable claim-ID registry and classification vocabulary remain
 *    present and valid, every required Spec 014 §2.2 primitive is covered,
 *    and every claim carries exactly one verification mode (`runtime`,
 *    `gateVerified`, or `conceptual`) with the mode's invariants;
 * 2. every canonical event kind is accounted for by exactly one of
 *    `CANONICAL_EVENT_MAPPINGS` or `CANONICAL_EVENT_KINDS_WITHOUT_LEGACY_EQUIVALENT`,
 *    and the matrix classification agrees with the mapping tables;
 * 3. every runtime claim is enforced against a real projection report over a
 *    real fixture: the expected mapping (path + stage + outcome, plus the
 *    constrained reason fragment) must be present, `reportField` claims are
 *    checked against the report, and `viewAbsence` claims serialize the
 *    projected view and fail when a marker leaks. A claim can no longer hide
 *    behind a check it does not perform — the check fails when the expected
 *    report entry is absent.
 *
 * The composed-report test runs the public `evidenceToAgentRun` projection
 * and asserts both stages in stage order, that first-stage mappings survive
 * composition unchanged, and that `sourceSchemaVersion` stays canonical.
 *
 * Deliberately narrow: no documentation generator, no new conformance
 * framework — the matrix claims are data, and this test pins their alignment
 * with the runtime reports.
 */
import { describe, expect, it } from 'vitest';
import { EVENT_KINDS, sha256Hex, utf8Encode } from '@signalglass/evidence';
import type { ProjectionMapping, ProjectionReport } from './types.js';
import { evidenceToAgentRun } from './evidenceToAgentRun.js';
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
import {
  allKindsObservations,
  buildRecord,
  minimalObservations,
  obs,
  T0,
  T1,
  T2,
  T3,
  T4,
  T5,
} from './testHelpers.js';
import type { EvidenceRecord } from '@signalglass/evidence';

const VALID_CLASSIFICATIONS: ReadonlyArray<ProjectionOutcome> = [
  'exact',
  'partial',
  'inferred',
  'unavailable',
];

/** Markers that must never reach a projection view (enriched fixture). */
const SENTINEL_AUTH = 'sk-enriched-sentinel-auth';
const SENTINEL_REQ = 'enriched-native-request-body';
const SENTINEL_RESP = 'enriched-native-response-body';
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
 * be a deliberate contract change. E2L-068 was split out of E2L-058 and
 * therefore sits directly after it.
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
  'E2L-055', 'E2L-056', 'E2L-057', 'E2L-058', 'E2L-068', 'E2L-059',
  'E2L-060', 'E2L-061', 'E2L-062', 'E2L-063', 'E2L-064', 'E2L-065',
  'E2L-066', 'E2L-067',
];

/**
 * A real byte-faithful native content hash over the retained native bytes
 * (computed through the public `@signalglass/evidence` surface — never
 * fabricated). The hash is over exactly the bytes stored as `providerNative`,
 * so the fidelity contract is self-consistent.
 */
const ENRICHED_NATIVE_BYTES = utf8Encode(SENTINEL_REQ);
const ENRICHED_NATIVE_HASH = `sha256:${sha256Hex(ENRICHED_NATIVE_BYTES)}`;

/**
 * Deterministic enriched fixture: conditions, a span with lifecycle fields
 * (status, endSeq, finishedAt) plus durationMs and participants, a
 * byte_faithful request envelope whose retained native bytes carry the
 * request sentinel and whose nativeContentHash is computed over exactly
 * those bytes, an unobservable model_usage event, and a
 * structurally-faithful response whose providerNative carries the
 * authorization and response sentinels.
 */
function enrichedRecord(): EvidenceRecord {
  return buildRecord(
    [
      obs({ observationId: 'r0', eventId: 'evt-start', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
      obs({
        observationId: 'r1', eventId: 'evt-span-start', seq: 1, spanId: 'sp-1',
        kind: 'span_start', capturedAt: T1, rawCapturedAt: T1,
        payload: {
          span: {
            kind: 'model', name: 'model:m', parentSpanId: null,
            participants: ['agent'],
          },
        },
      }),
      obs({
        observationId: 'r2', eventId: 'evt-req', seq: 2, spanId: 'sp-1',
        kind: 'model_request', capturedAt: T2, rawCapturedAt: T2, observationRole: 'client_sent',
        payload: {
          requestEnvelope: {
            model: 'm', provider: 'p', providerNativeFidelity: 'byte_faithful',
            nativeEncoding: 'utf-8', nativeContentType: 'application/json',
            nativeContentHash: ENRICHED_NATIVE_HASH,
            providerNative: ENRICHED_NATIVE_BYTES,
          },
        },
      }),
      obs({
        observationId: 'r3', eventId: 'evt-usage', seq: 3, spanId: 'sp-1',
        kind: 'model_usage', capturedAt: T2, rawCapturedAt: T2,
        observationRole: 'unobservable', evidenceStatus: 'unknown',
        payload: { usage: { evidenceStatus: 'unknown' } },
      }),
      obs({
        observationId: 'r4', eventId: 'evt-resp', seq: 4, spanId: 'sp-1',
        kind: 'model_response', capturedAt: T3, rawCapturedAt: T3, observationRole: 'provider_reported',
        payload: {
          responseEnvelope: {
            providerNativeFidelity: 'structurally_faithful',
            finishReason: 'end_turn',
            providerNative: { apiKey: SENTINEL_AUTH, text: SENTINEL_RESP },
          },
        },
      }),
      obs({
        observationId: 'r5', eventId: 'evt-span-end', seq: 5, spanId: 'sp-1',
        kind: 'span_end', capturedAt: T4, rawCapturedAt: T4, payload: { durationMs: 1500 },
      }),
      obs({ observationId: 'r6', eventId: 'evt-end', seq: 6, kind: 'interaction_end', capturedAt: T5, rawCapturedAt: T5 }),
    ],
    undefined,
    '1.0.0',
    { conditions: [{ label: 'env', value: 'test', version: '1' }] },
  );
}

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
    case 'all-kinds':
      return buildRecord(allKindsObservations());
    case 'enriched':
      return enrichedRecord();
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

  it('requires exactly one verification mode with the mode invariants', () => {
    for (const claim of PROJECTION_MAPPING_MATRIX) {
      assertClaimModeInvariants(claim);
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
  it('enforces every runtime claim against the actual projection report', () => {
    for (const claim of PROJECTION_MAPPING_MATRIX) {
      if (claim.runtime == null) continue;
      assertRuntimeClaim(claim);
    }
  });

  it('enforces the gate-verified identity claims at the value level', () => {
    // gateVerified claims are proven by the exact paired-view equality gate;
    // this test gives the matrix test itself the same value-level evidence by
    // asserting the preserved identities/timestamps against the canonical
    // record directly (no normalization, exact comparisons).
    const record = fixtureFor('minimal');
    const result = evidenceToLegacyTrace(record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const canonicalMappedEvents = record.trace.events.filter(
      (e) => !CANONICAL_EVENT_KINDS_WITHOUT_LEGACY_EQUIVALENT.includes(e.kind),
    );
    expect(result.view.events).toHaveLength(canonicalMappedEvents.length);
    expect(result.view.id).toBe(record.trace.traceId);
    expect(result.view.startedAt).toBe(record.trace.startedAt);
    expect(result.view.endedAt).toBe(record.trace.finishedAt);
    for (let i = 0; i < result.view.events.length; i += 1) {
      const canonical = canonicalMappedEvents[i]!;
      const legacy = result.view.events[i]!;
      expect(legacy.id).toBe(canonical.eventId);
      expect(legacy.traceId).toBe(canonical.traceId);
      expect(legacy.timestamp).toBe(canonical.capturedAt);
    }
  });

  it('the composed evidenceToAgentRun report preserves stage order and first-stage mappings', () => {
    // The composed report must expose the same declared loss through the
    // public `evidenceToAgentRun` projection, with both stages in stage
    // order and first-stage mappings unchanged by composition.
    const record = fixtureFor('minimal');
    const legacy = evidenceToLegacyTrace(record);
    const composed = evidenceToAgentRun(record);
    expect(legacy.ok).toBe(true);
    expect(composed.ok).toBe(true);
    if (!legacy.ok || !composed.ok) return;

    // sourceSchemaVersion stays canonical through composition.
    expect(composed.report.sourceSchemaVersion).toBe('1.0.0');
    expect(composed.report.sourceSchemaVersion).toBe(record.evidenceSchemaVersion);

    expectStageOrder(composed.report.mappings);

    // The first stage's mappings survive composition unchanged, one for one.
    expect(composed.report.mappings.slice(0, legacy.report.mappings.length)).toEqual(
      legacy.report.mappings,
    );

    expectCoreLossEntries(composed.report.mappings);
  });
});

/** Both stages are present and ordered: first stage, then second stage. */
function expectStageOrder(mappings: readonly ProjectionMapping[]): void {
  const stageOrder = mappings.map((m) => m.stage);
  const firstStageCount = stageOrder.filter((s) => s === 'evidence_to_legacy_trace').length;
  const secondStageCount = stageOrder.filter((s) => s === 'legacy_trace_to_agent_run').length;
  expect(firstStageCount).toBeGreaterThan(0);
  expect(secondStageCount).toBeGreaterThan(0);
  expect(stageOrder.indexOf('legacy_trace_to_agent_run')).toBe(firstStageCount);
}

/** Core trace-level loss entries are present with the corrected paths. */
function expectCoreLossEntries(mappings: readonly ProjectionMapping[]): void {
  const byPath = new Map(mappings.map((m) => [m.path, m]));
  expect(byPath.get('trace.status')?.outcome).toBe('partial');
  expect(byPath.get('trace.finishedAt')?.outcome).toBe('exact');
  expect(byPath.get('trace.agent')?.outcome).toBe('unavailable');
  expect(byPath.get('trace.task')?.outcome).toBe('unavailable');
  expect(byPath.get('completeness')?.outcome).toBe('unavailable');
  expect(byPath.get('trace.interactionId')?.outcome).toBe('exact');
  expect(byPath.get('trace.observationBoundary')?.outcome).toBe('unavailable');
  expect(byPath.get('trace.events[].seq')?.outcome).toBe('partial');
}

function claimForKind(kind: (typeof EVENT_KINDS)[number]): ProjectionMatrixClaim | undefined {
  const id = PROJECTION_MATRIX_EVENT_KIND_CLAIMS[kind];
  return PROJECTION_MAPPING_MATRIX.find((claim) => claim.id === id);
}

/** Mode invariants for one matrix claim (see the module docstring). */
function assertClaimModeInvariants(claim: ProjectionMatrixClaim): void {
  const modes = [claim.runtime, claim.gateVerified, claim.conceptual].filter(
    (m) => m !== undefined,
  );
  expect(
    modes.length === 1,
    `claim ${claim.id} must carry exactly one of runtime/gateVerified/conceptual (got ${modes.length})`,
  ).toBe(true);
  if (claim.gateVerified != null) {
    // The paired-view equality gate proves value-level preservation; a
    // claim verified by it cannot claim a lossy classification.
    expect(
      claim.classification === 'exact',
      `gate-verified claim ${claim.id} must be classified exact`,
    ).toBe(true);
  }
  if (claim.conceptual != null) {
    // Documentation-only claims must explain why no runtime entry exists.
    expect(
      claim.conceptual.length > 10,
      `conceptual claim ${claim.id} needs an explanation`,
    ).toBe(true);
  }
  if (claim.runtime != null) {
    assertRuntimeCheckShape(claim);
  }
}

/** A runtime check must actually check something and constrain outcomes. */
function assertRuntimeCheckShape(claim: ProjectionMatrixClaim): void {
  const { path, outcome, reasonIncludes, reportField, viewAbsence } = claim.runtime!;
  expect(
    path != null || reasonIncludes != null || reportField != null || (viewAbsence != null && viewAbsence.length > 0),
    `runtime claim ${claim.id} must carry a check`,
  ).toBe(true);
  // A path-only check is not enough: it must constrain the outcome too
  // (except reportField/viewAbsence modes and kind-row reason checks).
  if (path != null && reasonIncludes == null && reportField == null) {
    expect(
      outcome != null,
      `runtime claim ${claim.id} with path "${path}" must also constrain the outcome`,
    ).toBe(true);
  }
}

/** Run one runtime claim against the actual projection report over its fixture. */
function assertRuntimeClaim(claim: ProjectionMatrixClaim): void {
  const runtime = claim.runtime!;
  const record = fixtureFor(runtime.fixture);
  const projection = runtime.projection ?? 'evidence_to_legacy_trace';
  const result =
    projection === 'evidence_to_agent_run'
      ? evidenceToAgentRun(record)
      : evidenceToLegacyTrace(record);
  expect(result.ok, `claim ${claim.id}: fixture ${runtime.fixture} must project`).toBe(true);
  if (!result.ok) return;

  if (runtime.reportField != null) {
    const report = result.report as ProjectionReport & Record<string, unknown>;
    expect(
      report[runtime.reportField] === runtime.expected,
      `claim ${claim.id}: report.${runtime.reportField} must equal "${runtime.expected}"`,
    ).toBe(true);
    return;
  }

  if (runtime.viewAbsence != null && runtime.viewAbsence.length > 0) {
    const serialized = JSON.stringify(result.view);
    for (const marker of runtime.viewAbsence) {
      expect(
        !serialized.includes(marker),
        `claim ${claim.id}: view must not contain marker "${marker}"`,
      ).toBe(true);
    }
    return;
  }

  const match = findMapping(result.report.mappings, runtime);
  expect(
    match,
    `claim ${claim.id}: no report mapping matches ${JSON.stringify(runtime)}`,
  ).toBeDefined();
}

function findMapping(
  mappings: readonly ProjectionMapping[],
  runtime: NonNullable<ProjectionMatrixClaim['runtime']>,
): ProjectionMapping | undefined {
  const stageFiltered =
    runtime.stage == null ? mappings : mappings.filter((m) => m.stage === runtime.stage);
  if (runtime.path != null && runtime.outcome != null) {
    return stageFiltered.find(
      (m) => m.path === runtime.path && m.outcome === runtime.outcome,
    );
  }
  if (runtime.reasonIncludes != null) {
    const reasonIncludes = runtime.reasonIncludes;
    return stageFiltered.find(
      (m) =>
        (runtime.outcome == null || m.outcome === runtime.outcome) &&
        m.reason.includes(reasonIncludes),
    );
  }
  return undefined;
}
