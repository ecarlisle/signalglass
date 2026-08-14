import { describe, expect, it } from 'vitest';
import {
  CLIENT_REQUEST_FAILURE_CODES,
  INTERNAL_DECODER_FAILURE_CODES,
  MALFORMED_STREAM_CODES,
  OBSERVATION_FAILURE_CODES,
  UPSTREAM_FAILURE_CODES,
  type StreamingLossFacts,
} from '@signalglass/evidence';
import { buildTerminalBoundaryPreviews } from './boundary-previews.js';
import { DEFAULT_EVIDENCE_BUDGETS, assembleTrace, type AssemblerOptions } from './assembler.js';

const BASE_LOSSES: StreamingLossFacts = {
  requestBody: 'fully-observed-not-retained',
  messageContent: 'fully-retained',
  deltaContent: 'not-observed',
  providerNative: 'not-retained',
  providerErrorBody: 'not-applicable',
  wireBytes: 'not-retained',
  postTerminalContent: 'none-observed',
  unmappedDeltaFields: [],
  unrecognizedExtensionFrameObserved: false,
  headerValuesBeyondAllowlist: false,
  contentTypeParametersDropped: false,
  maskedContent: false,
  contentEncodingUnsupported: false,
  multimodalContentObserved: false,
  requestMessageUnknownKeysObserved: false,
  unrecognizedRoleObserved: false,
  sseMetadataObservedButNotRetained: false,
};

describe('buildTerminalBoundaryPreviews', () => {
  it('covers every closed failure code exactly once per applicable terminal kind', () => {
    const previews = buildTerminalBoundaryPreviews(BASE_LOSSES);

    const upstreamCodes = previews
      .filter((p) => p.terminal.kind === 'upstream-failed')
      .map((p) => (p.terminal as { code: string }).code);
    for (const code of UPSTREAM_FAILURE_CODES) expect(upstreamCodes).toContain(code);

    const malformedCodes = previews
      .filter((p) => p.terminal.kind === 'malformed-stream')
      .map((p) => (p.terminal as { code: string }).code);
    for (const code of MALFORMED_STREAM_CODES) expect(malformedCodes).toContain(code);

    const requestFailedCodes = previews
      .filter((p) => p.terminal.kind === 'request-failed')
      .map((p) => (p.terminal as { code: string }).code);
    for (const code of CLIENT_REQUEST_FAILURE_CODES) expect(requestFailedCodes).toContain(code);

    const detachedCodes = previews
      .filter((p) => p.terminal.kind === 'observation-detached')
      .map((p) => (p.terminal as { code: string }).code);
    for (const code of [...OBSERVATION_FAILURE_CODES, ...INTERNAL_DECODER_FAILURE_CODES]) {
      expect(detachedCodes).toContain(code);
    }

    expect(previews.some((p) => p.terminal.kind === 'completed')).toBe(true);
    expect(previews.some((p) => p.terminal.kind === 'client-cancelled')).toBe(true);
    expect(previews.some((p) => p.terminal.kind === 'ingress-cancelled')).toBe(true);
  });

  it('is accepted by assembleTrace as a real terminalBoundaryPreviews input', () => {
    const previews = buildTerminalBoundaryPreviews(BASE_LOSSES);
    const values = Array.from({ length: 8 }, (_, index) => index);
    const options: AssemblerOptions = {
      traceId: 'trace-boundary-previews', interactionId: 'trace-boundary-previews', modelSpanId: 'span-model',
      provider: 'openai', model: 'gpt-test', requestMessages: [{ role: 'user', content: 'hello' }],
      responseMeta: { statusCode: 200, contentType: 'text/event-stream' },
      decodedEvents: [
        { kind: 'chunk', choiceIndex: 0, chunkIndex: 0, delta: 'world', finishReason: 'stop' },
      ],
      terminal: { kind: 'completed' },
      boundaryFacts: {
        upstream: { outcome: 'response-completed' }, clientResponse: { outcome: 'flushed' },
        decoderDisposition: 'openai-sse',
        remainder: { knowledge: 'protocol-terminal-observed', lastObservedFramePosition: 1, rawForwardedBytes: 32 },
        losses: { ...BASE_LOSSES, deltaContent: 'fully-retained' },
      },
      ids: { eventIds: values.map((n) => `event-${n}`), observationIds: values.map((n) => `observation-${n}`) },
      capturedAtBySeq: values.map((n) => `2026-08-14T12:00:${String(n).padStart(2, '0')}.000Z`),
      finalizationBundle: [
        { eventId: 'terminal-event-1', observationId: 'terminal-observation-1', capturedAt: '2026-08-14T12:01:00.000Z' },
        { eventId: 'terminal-event-2', observationId: 'terminal-observation-2', capturedAt: '2026-08-14T12:01:01.000Z' },
      ],
      evidenceBudgets: DEFAULT_EVIDENCE_BUDGETS,
      terminalBoundaryPreviews: previews,
    };

    const result = assembleTrace(options);
    expect(result.record.trace.status).toBe('completed');
    const unsupported = previews.find((preview) =>
      preview.terminal.kind === 'observation-detached'
      && preview.terminal.code === 'observation-encoding-unsupported');
    expect(unsupported?.boundaryFacts).toMatchObject({
      decoderDisposition: 'unsupported-encoding',
      losses: {
        contentEncodingUnsupported: true,
        sseMetadataObservedButNotRetained: false,
      },
    });
  });
});
