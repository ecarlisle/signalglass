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
 *    checked against the report, and `viewAbsence` markers must stay out of
 *    both the projected view and the projection report — as strings, as raw
 *    `Uint8Array` bytes, or as numeric arrays (byte-aware walk, never a
 *    `JSON.stringify` heuristic). ALL supplied constraints are asserted
 *    together — a passing `viewAbsence`/`reportField` check never substitutes
 *    for an absent mapping entry. A claim can no longer hide behind a check
 *    it does not perform — the check fails when the expected report entry is
 *    absent.
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
 * therefore sits directly after it; E2L-069..E2L-080 are the field-level
 * rows appended after E2L-067 (envelope fields, usage-record fields, and
 * missing/redaction/truncation declaration rows).
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
  'E2L-069', 'E2L-070', 'E2L-071', 'E2L-072', 'E2L-073', 'E2L-074',
  'E2L-075', 'E2L-076', 'E2L-077', 'E2L-078', 'E2L-079', 'E2L-080',
  'E2L-081', 'E2L-082', 'E2L-083', 'E2L-084', 'E2L-085', 'E2L-086',
  'E2L-087',
];

/**
 * Real byte-faithful native content hashes over the retained native bytes
 * (computed through the public `@signalglass/evidence` surface — never
 * fabricated). The request hash is over exactly the bytes stored as the
 * request `providerNative` — a byte-faithful request capture includes the
 * authorization header — and the response hash over exactly the response
 * bytes, so both fidelity contracts are self-consistent.
 */
const REQUEST_BYTES = utf8Encode(`${SENTINEL_AUTH}:${SENTINEL_REQ}`);
const REQUEST_HASH = `sha256:${sha256Hex(REQUEST_BYTES)}`;
const RESPONSE_BYTES = utf8Encode(SENTINEL_RESP);
const RESPONSE_HASH = `sha256:${sha256Hex(RESPONSE_BYTES)}`;

/**
 * Deterministic enriched fixture: conditions, a span with lifecycle fields
 * (status, endSeq, finishedAt) plus durationMs and participants, a
 * byte_faithful request envelope whose retained native bytes carry the
 * authorization and request-body sentinels and whose nativeContentHash is
 * computed over exactly those bytes, an unobservable model_usage event, and
 * a byte_faithful response envelope carrying the response-body bytes, the
 * native byte metadata (encoding/content type/content hash), finishReason,
 * and usage.
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
            messages: [{ role: 'user', content: 'hello' }],
            nativeEncoding: 'utf-8', nativeContentType: 'application/json',
            nativeContentHash: REQUEST_HASH,
            providerNative: REQUEST_BYTES,
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
            providerNativeFidelity: 'byte_faithful',
            finishReason: 'end_turn',
            providerNative: RESPONSE_BYTES,
            nativeEncoding: 'utf-8', nativeContentType: 'application/json',
            nativeContentHash: RESPONSE_HASH,
            usage: { evidenceStatus: 'captured' },
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
    case 'redacted':
      // Declarations live on the raw observation payloads (Spec 014 §5.8);
      // redacted/missing/truncated evidence must project without fabricating
      // content and without echoing declaration values.
      return buildRecord([
        obs({ observationId: 'rd0', eventId: 'evt-start', seq: 0, kind: 'interaction_start', capturedAt: T0, rawCapturedAt: T0 }),
        obs({
          observationId: 'rd1', eventId: 'evt-redacted', seq: 1, kind: 'model_request',
          capturedAt: T1, rawCapturedAt: T1, observationRole: 'client_sent', evidenceStatus: 'redacted',
          payload: {
            redaction: { policy: 'secrets-v1', reasons: ['authorization-header'] },
            requestEnvelope: { model: 'm', provider: 'p', providerNativeFidelity: 'structurally_faithful' },
          },
        }),
        obs({
          observationId: 'rd2', eventId: 'evt-missing', seq: 2, kind: 'model_response',
          capturedAt: T2, rawCapturedAt: T2, observationRole: 'returned', evidenceStatus: 'missing',
          payload: {
            missing: { reason: 'capture_failed', reportedBy: { captureSurface: 'ingress_proxy', observationBoundary: 'returned' } },
            responseEnvelope: { providerNativeFidelity: 'structurally_faithful' },
          },
        }),
        obs({
          observationId: 'rd3', eventId: 'evt-truncated', seq: 3, kind: 'tool_result',
          capturedAt: T2, rawCapturedAt: T2, observationRole: 'returned', evidenceStatus: 'truncated',
          payload: { truncation: { maxLength: 100, originalLength: 5000 }, toolResult: { stdout: 'x' } },
        }),
        obs({ observationId: 'rd4', eventId: 'evt-end', seq: 4, kind: 'interaction_end', capturedAt: T3, rawCapturedAt: T3 }),
      ]);
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

  it('derives omitted-kind expectations from the mapping table (no drifted second truth)', () => {
    // The gate derives which kinds are omitted from `CANONICAL_EVENT_MAPPINGS`
    // (plus the explicit omission list) and requires the claim to name no
    // legacy type at all: a hypothetical `TraceEvent tool_call` target would
    // be a contradiction the old string heuristic could not catch.
    for (const kind of EVENT_KINDS) {
      if (kind in CANONICAL_EVENT_MAPPINGS) continue;
      const claim = claimForKind(kind)!;
      expect(
        isOmittedKindTargetConsistent(claim),
        `claim ${claim.id}: kind ${kind} is absent from CANONICAL_EVENT_MAPPINGS, so its legacyTarget must be "(omitted)" (got "${claim.legacyTarget}")`,
      ).toBe(true);
    }
  });

  it('gate rejects a contradictory omitted-kind claim (negative self-test)', () => {
    // A claim that names a legacy type for an omitted kind must fail the
    // gate even though the old heuristic (`!startsWith('TraceEvent')`) would
    // have let it through.
    const contradictory: ProjectionMatrixClaim = {
      id: 'REG-1',
      primitive: 'regression',
      spec013: 'regression',
      legacyTarget: 'TraceEvent tool_call',
      classification: 'unavailable',
      reason: 'regression',
      verifiedBy: 'regression',
    };
    expect(isOmittedKindTargetConsistent(contradictory)).toBe(false);
  });
});

describe('projection mapping matrix — runtime report alignment', () => {
  it('enforces every runtime claim against the actual projection report', () => {
    for (const claim of PROJECTION_MAPPING_MATRIX) {
      if (claim.runtime == null) continue;
      runRuntimeClaim(claim);
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

describe('projection mapping matrix — gate strictness (regressions)', () => {
  /** Synthetic claim carrying only the runtime descriptor under test. */
  function syntheticClaim(
    runtime: NonNullable<ProjectionMatrixClaim['runtime']>,
  ): ProjectionMatrixClaim {
    return {
      id: 'REG-0',
      primitive: 'regression',
      spec013: 'regression',
      legacyTarget: 'regression',
      classification: 'unavailable',
      reason: 'regression',
      verifiedBy: 'regression',
      runtime,
    };
  }

  it('rejects a claim with the correct path/outcome but a reason fragment that matches nothing', () => {
    // trace.status IS partial and its reason DOES contain "\"completed\"",
    // but the fragment below appears in no mapping reason, so the gate must
    // fail even though path and outcome are correct.
    const wrongReason = syntheticClaim({
      fixture: 'minimal',
      path: 'trace.status',
      outcome: 'partial',
      reasonIncludes: 'zzz-reason-fragment-that-matches-nothing-zzz',
    });
    expect(() => runRuntimeClaim(wrongReason)).toThrow();
  });

  it('rejects a claim with the correct reason but the wrong outcome', () => {
    // The trace.status mapping reason contains "\"completed\"" but the
    // mapping outcome is partial, never exact: the gate must fail.
    const wrongOutcome = syntheticClaim({
      fixture: 'minimal',
      path: 'trace.status',
      outcome: 'exact',
      reasonIncludes: '"completed"',
    });
    expect(() => runRuntimeClaim(wrongOutcome)).toThrow();
  });

  it('rejects a claim whose sentinel-absence check passes but whose mapping entry is absent', () => {
    // The view really is free of the request-body sentinel, so a viewAbsence-
    // only gate would pass; the mapping for a fabricated path does not exist,
    // so the conjunctive gate must fail (no early return after viewAbsence).
    const absentMapping = syntheticClaim({
      fixture: 'enriched',
      path: 'events[2].requestEnvelope.fabricatedField',
      outcome: 'unavailable',
      viewAbsence: ['enriched-native-request-body'],
    });
    expect(() => runRuntimeClaim(absentMapping)).toThrow();
  });

  it('byte-aware absence check rejects a leaked Uint8Array the string check would miss', () => {
    // A leaked `Uint8Array` serializes (JSON.stringify) as an index object
    // ({ "0": 101, ... }), so the old `.includes(marker)` check could pass
    // even though the raw bytes are present. The byte-aware walk must fail.
    const claim = syntheticClaim({
      fixture: 'enriched',
      path: 'events[2].requestEnvelope.providerNative',
      outcome: 'unavailable',
      viewAbsence: ['enriched-native-request-body'],
    });
    expect(() =>
      assertViewAbsenceFree(claim, {
        ok: true,
        view: { events: [{ payload: { bytes: utf8Encode(SENTINEL_REQ) } }] },
        report: emptyReport(),
      }),
    ).toThrow(/must not contain marker/);
  });

  it('byte-aware absence check rejects a leaked numeric byte array', () => {
    // The same sentinel leaked as a plain numeric array (Array.from over the
    // bytes) must also fail — the numeric-array branch is exercised.
    const claim = syntheticClaim({
      fixture: 'enriched',
      path: 'events[2].requestEnvelope.providerNative',
      outcome: 'unavailable',
      viewAbsence: ['sk-enriched-sentinel-auth'],
    });
    expect(() =>
      assertViewAbsenceFree(claim, {
        ok: true,
        view: { nested: [{ bytes: Array.from(utf8Encode(SENTINEL_AUTH)) }] },
        report: emptyReport(),
      }),
    ).toThrow(/must not contain marker/);
  });

  it('byte-aware absence check inspects object property names as well as values', () => {
    // A marker leaked as an object KEY (values are clean) must fail: the
    // walk descends through `Object.entries`, not just `Object.values`.
    const claim = syntheticClaim({
      fixture: 'enriched',
      path: 'events[2].requestEnvelope.providerNative',
      outcome: 'unavailable',
      viewAbsence: ['enriched-native-request-body'],
    });
    expect(() =>
      assertViewAbsenceFree(claim, {
        ok: true,
        view: { [SENTINEL_REQ]: true },
        report: emptyReport(),
      }),
    ).toThrow(/must not contain marker/);
  });

  it('byte-aware absence check inspects the projection report too', () => {
    // A marker embedded in a mapping reason (e.g. an accidentally echoed
    // secret) must fail even when the view is clean.
    const claim = syntheticClaim({
      fixture: 'enriched',
      path: 'events[2].requestEnvelope.providerNative',
      outcome: 'unavailable',
      viewAbsence: ['enriched-native-response-body'],
    });
    expect(() =>
      assertViewAbsenceFree(claim, {
        ok: true,
        view: { events: [] },
        report: {
          projectionVersion: 'p',
          sourceSchemaVersion: '1.0.0',
          mappings: [{ path: 'events[4]', stage: 'evidence_to_legacy_trace', outcome: 'unavailable', reason: SENTINEL_RESP }],
        },
      }),
    ).toThrow(/must not contain marker/);
  });
});

/** An empty report for exercising the byte-aware absence walk directly. */
function emptyReport(): ProjectionReport {
  return { projectionVersion: 'p', sourceSchemaVersion: '1.0.0', mappings: [] };
}

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

/**
 * An omitted kind (absent from `CANONICAL_EVENT_MAPPINGS`) must name no
 * legacy type at all: only the literal `"(omitted)"` target is consistent
 * with the mapping tables.
 */
function isOmittedKindTargetConsistent(claim: ProjectionMatrixClaim): boolean {
  return claim.legacyTarget === '(omitted)';
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
  const r = claim.runtime!;
  const hasCheck =
    r.path != null ||
    r.reasonIncludes != null ||
    r.reportField != null ||
    (r.viewAbsence != null && r.viewAbsence.length > 0);
  expect(
    hasCheck,
    `runtime claim ${claim.id} must carry a check`,
  ).toBe(true);
  // Any mapping-search claim (path or reasonIncludes) must also constrain the
  // outcome so the gate verifies the actual report outcome, never just a
  // kind name or path appearing in a reason.
  if (r.path != null || r.reasonIncludes != null) {
    expect(
      r.outcome != null,
      `runtime claim ${claim.id} with a mapping search must also constrain the outcome`,
    ).toBe(true);
  }
  // A report-field claim must name the expected value it compares against.
  if (r.reportField != null) {
    expect(
      r.expected != null,
      `runtime claim ${claim.id} with reportField must also provide expected`,
    ).toBe(true);
  }
}

/**
 * Run one runtime claim against the actual projection report over its
 * fixture. EVERY supplied constraint is asserted together — the mapping
 * search (stage + path + outcome + reasonIncludes), the `reportField`
 * equality, and every `viewAbsence` marker. There are no early returns: a
 * claim that passes its sentinel-absence check but has no matching report
 * entry fails, and vice versa.
 */
function runRuntimeClaim(claim: ProjectionMatrixClaim): void {
  const runtime = claim.runtime!;
  const record = fixtureFor(runtime.fixture);
  const projection = runtime.projection ?? 'evidence_to_legacy_trace';
  const result =
    projection === 'evidence_to_agent_run'
      ? evidenceToAgentRun(record)
      : evidenceToLegacyTrace(record);
  expect(result.ok, `claim ${claim.id}: fixture ${runtime.fixture} must project`).toBe(true);
  if (!result.ok) return;

  assertReportFieldEquals(claim, result);
  assertViewAbsenceFree(claim, result);

  // Mapping search (conjunctive: stage + path + outcome + reasonIncludes).
  if (runtime.path == null && runtime.reasonIncludes == null) return;
  const match = findMapping(result.report.mappings, runtime);
  expect(
    match,
    `claim ${claim.id}: no report mapping matches ${JSON.stringify(runtime)}`,
  ).toBeDefined();
}

/** Additional assertion: report attribute equals the declared value. */
function assertReportFieldEquals(
  claim: ProjectionMatrixClaim,
  result: { ok: true; report: ProjectionReport } | { ok: false; report: ProjectionReport },
): void {
  const runtime = claim.runtime!;
  if (runtime.reportField == null) return;
  const report = result.report as ProjectionReport & Record<string, unknown>;
  expect(
    report[runtime.reportField] === runtime.expected,
    `claim ${claim.id}: report.${runtime.reportField} must equal "${runtime.expected}"`,
  ).toBe(true);
}

/**
 * Additional assertion: no viewAbsence marker leaks into the projected view
 * OR the projection report, in any representation — as a string, as the raw
 * UTF-8 bytes of a `Uint8Array`/`Buffer` (byte-subsequence search), as a
 * numeric array of byte values, or nested anywhere in the structure. A
 * marker that `JSON.stringify` renders as an index object (a leaked
 * `Uint8Array`) is still a leak and must fail the check.
 */
function assertViewAbsenceFree(
  claim: ProjectionMatrixClaim,
  result: { ok: true; view: unknown; report: ProjectionReport } | { ok: false; report: ProjectionReport },
): void {
  const runtime = claim.runtime!;
  if (runtime.viewAbsence == null || runtime.viewAbsence.length === 0) return;
  for (const marker of runtime.viewAbsence) {
    expect(
      !containsMarker(result, marker),
      `claim ${claim.id}: view and report must not contain marker "${marker}" (string, byte, or numeric-array form)`,
    ).toBe(true);
  }
}

/** True when the marker string or its UTF-8 byte sequence occurs anywhere. */
function containsMarker(
  result: { ok: true; view: unknown; report: ProjectionReport } | { ok: false; report: ProjectionReport },
  marker: string,
): boolean {
  const markerBytes = utf8Encode(marker);
  return [result.ok ? result.view : null, result.report].some((value) =>
    valueContainsMarker(value, marker, markerBytes),
  );
}

/**
 * Recursive marker search: strings by `.includes`, `Uint8Array`/numeric
 * arrays by byte-subsequence, everything else by descent. Small, explicit,
 * and deliberately free of broad serialization tricks (a `JSON.stringify`
 * round-trip would mask a leaked byte array as an index object).
 */
function valueContainsMarker(
  value: unknown,
  marker: string,
  markerBytes: Uint8Array,
): boolean {
  if (value instanceof Uint8Array) {
    return bytesInclude(value, markerBytes);
  }
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'number')) {
      // Numeric-array form of leaked bytes (e.g. `Array.from` over a byte
      // array) is still a leak; subsequence search, same as `Uint8Array`.
      return bytesInclude(Uint8Array.from(value as number[]), markerBytes);
    }
    return value.some((v) => valueContainsMarker(v, marker, markerBytes));
  }
  if (typeof value === 'string') {
    return value.includes(marker);
  }
  if (value != null && typeof value === 'object') {
    // Inspect object property NAMES as well as values: a marker leaked as a
    // key (e.g. `{ [sentinel]: true }`) is still a leak.
    return Object.entries(value).some(
      ([key, v]) => key.includes(marker) || valueContainsMarker(v, marker, markerBytes),
    );
  }
  return false;
}

/** Byte-subsequence search (needle may be any slice of the haystack). */
function bytesInclude(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Conjunctive mapping search: every supplied constraint (stage, path,
 * outcome, reasonIncludes) must hold on one mapping. Constraints are never
 * dropped or short-circuited.
 */
function findMapping(
  mappings: readonly ProjectionMapping[],
  runtime: NonNullable<ProjectionMatrixClaim['runtime']>,
): ProjectionMapping | undefined {
  return mappings.find(
    (m) =>
      (runtime.stage == null || m.stage === runtime.stage) &&
      (runtime.path == null || m.path === runtime.path) &&
      (runtime.outcome == null || m.outcome === runtime.outcome) &&
      (runtime.reasonIncludes == null || m.reason.includes(runtime.reasonIncludes)),
  );
}
