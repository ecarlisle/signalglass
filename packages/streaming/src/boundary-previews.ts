/**
 * Exhaustive terminal/boundary-fact previews for the assembler's exact
 * budget-reservation contract (Spec 016 S4 §3.5, S5 §11).
 *
 * `assembleTrace` (assembler.ts) requires its caller to supply
 * `terminalBoundaryPreviews`: one boundary-fact candidate per closed
 * terminal-suffix alternative, so the byte budget can be measured as the
 * maximum over every valid alternative from the applicable state (§3.5).
 * This module is the production implementation of that enumeration — pure,
 * network-free, and driven entirely by the closed code unions
 * `@signalglass/evidence` exports, so it can never drift out of sync with
 * the terminal classification matrix (§9.3).
 */
import {
  MALFORMED_STREAM_CODES,
  UPSTREAM_FAILURE_CODES,
  CLIENT_REQUEST_FAILURE_CODES,
  OBSERVATION_FAILURE_CODES,
  INTERNAL_DECODER_FAILURE_CODES,
  type StreamingLossFacts,
} from '@signalglass/evidence';
import type { AssemblerOptions, AssemblyTerminal, TerminalBoundaryPreview } from './assembler.js';

type BoundaryFacts = AssemblerOptions['boundaryFacts'];

function previewFacts(
  losses: StreamingLossFacts,
  overrides: Partial<BoundaryFacts>,
): BoundaryFacts {
  return {
    upstream: { outcome: 'response-completed' },
    clientResponse: { outcome: 'flushed' },
    decoderDisposition: 'openai-sse',
    remainder: { knowledge: 'protocol-terminal-observed', lastObservedFramePosition: 1, rawForwardedBytes: 1 },
    losses,
    ...overrides,
  };
}

/**
 * Enumerate every closed terminal-suffix alternative (§3.5, §10.4, §10.5):
 * `completed` (span_end + interaction_end), the causal `error` for
 * upstream/malformed/request failures, `cancelled` for client/ingress
 * cancellation, and the informational `error` for observation detachment.
 * Each alternative is produced under both a flushed and a
 * closed-before-completion client outcome so the maximum reflects the
 * worst-case client-response state too.
 */
export function buildTerminalBoundaryPreviews(
  losses: StreamingLossFacts,
): readonly TerminalBoundaryPreview[] {
  const sse = (
    terminal: AssemblyTerminal,
    overrides: Partial<BoundaryFacts> = {},
  ): TerminalBoundaryPreview => ({ terminal, boundaryFacts: previewFacts(losses, overrides) });

  const detached = (
    code: (typeof OBSERVATION_FAILURE_CODES)[number] | (typeof INTERNAL_DECODER_FAILURE_CODES)[number],
  ): TerminalBoundaryPreview => {
    const encodingUnsupported = code === 'observation-encoding-unsupported';
    return sse(
      { kind: 'observation-detached', code },
      {
        decoderDisposition: encodingUnsupported ? 'unsupported-encoding' : 'openai-sse',
        remainder: { knowledge: 'unknown', lastObservedFramePosition: 1, rawForwardedBytes: 1 },
        losses: encodingUnsupported
          ? { ...losses, contentEncodingUnsupported: true, sseMetadataObservedButNotRetained: false }
          : losses,
      },
    );
  };

  return [
    sse({ kind: 'completed' }),
    sse({ kind: 'completed' }, { clientResponse: { outcome: 'closed-before-completion' } }),

    ...UPSTREAM_FAILURE_CODES.flatMap((code): TerminalBoundaryPreview[] => {
      if (code === 'http-error-status') {
        return [sse({ kind: 'upstream-failed', code }, {
          clientResponse: { outcome: 'local-error-flushed' }, decoderDisposition: 'not-applicable',
          remainder: { knowledge: 'transport-eof-observed' },
          losses: { ...losses, providerErrorBody: 'not-retained' },
        })];
      }
      if (code === 'non-sse-response') {
        return [sse({ kind: 'upstream-failed', code }, {
          decoderDisposition: 'not-applicable', remainder: { knowledge: 'transport-eof-observed' },
        })];
      }
      if (code === 'provider-error-frame') {
        return [sse({ kind: 'upstream-failed', code }, {
          losses: { ...losses, providerErrorBody: 'not-retained' },
        })];
      }
      return [
        sse({ kind: 'upstream-failed', code }, {
          upstream: { outcome: 'connection-failed' }, clientResponse: { outcome: 'local-error-flushed' },
          decoderDisposition: 'not-applicable', remainder: { knowledge: 'unknown' },
        }),
        sse({ kind: 'upstream-failed', code }, {
          upstream: { outcome: 'stream-ended-prematurely' }, clientResponse: { outcome: 'closed-before-completion' },
          remainder: { knowledge: 'unknown', lastObservedFramePosition: 1, rawForwardedBytes: 1 },
        }),
      ];
    }),

    ...MALFORMED_STREAM_CODES.flatMap((code): TerminalBoundaryPreview[] => {
      const remainderKnowledge = code === 'sse-partial-frame-at-eof' || code === 'sse-eof-without-done'
        ? 'transport-eof-observed' as const
        : 'protocol-terminal-observed' as const;
      return [
        sse({ kind: 'malformed-stream', code }, { remainder: { knowledge: remainderKnowledge } }),
        sse({ kind: 'malformed-stream', code }, {
          clientResponse: { outcome: 'closed-before-completion' },
          remainder: { knowledge: remainderKnowledge },
        }),
      ];
    }),

    ...CLIENT_REQUEST_FAILURE_CODES.flatMap((code): TerminalBoundaryPreview[] => {
      const requestFailedLosses: StreamingLossFacts = {
        ...losses,
        messageContent: 'omitted',
        deltaContent: 'not-observed',
        providerNative: 'not-applicable',
        providerErrorBody: 'not-applicable',
        wireBytes: 'not-applicable',
        unmappedDeltaFields: [],
        sseMetadataObservedButNotRetained: false,
        contentTypeParametersDropped: false,
      };
      return [
        sse({ kind: 'request-failed', code }, {
          upstream: { outcome: 'not-started' }, clientResponse: { outcome: 'not-started' },
          decoderDisposition: 'not-applicable', remainder: { knowledge: 'not-applicable' },
          losses: requestFailedLosses,
        }),
        sse({ kind: 'request-failed', code }, {
          upstream: { outcome: 'not-started' }, clientResponse: { outcome: 'local-error-flushed' },
          decoderDisposition: 'not-applicable', remainder: { knowledge: 'not-applicable' },
          losses: requestFailedLosses,
        }),
      ];
    }),

    sse({ kind: 'client-cancelled' }, {
      upstream: { outcome: 'cancelled-by-ingress', cause: 'client-disconnect' },
      clientResponse: { outcome: 'not-started' }, decoderDisposition: 'not-applicable',
      remainder: { knowledge: 'unknown' },
    }),
    sse({ kind: 'client-cancelled' }, {
      upstream: { outcome: 'cancelled-by-ingress', cause: 'client-disconnect' },
      clientResponse: { outcome: 'closed-before-completion' },
      remainder: { knowledge: 'unknown', lastObservedFramePosition: 1, rawForwardedBytes: 1 },
    }),

    ...(['ingress-shutdown', 'configured-limit'] as const).flatMap((cause): TerminalBoundaryPreview[] => [
      sse({ kind: 'ingress-cancelled' }, {
        upstream: { outcome: 'cancelled-by-ingress', cause }, clientResponse: { outcome: 'not-started' },
        decoderDisposition: 'not-applicable', remainder: { knowledge: 'unknown' },
      }),
      sse({ kind: 'ingress-cancelled' }, {
        upstream: { outcome: 'cancelled-by-ingress', cause }, clientResponse: { outcome: 'closed-before-completion' },
        remainder: { knowledge: 'unknown', lastObservedFramePosition: 1, rawForwardedBytes: 1 },
      }),
    ]),

    ...OBSERVATION_FAILURE_CODES.map(detached),
    ...INTERNAL_DECODER_FAILURE_CODES.map(detached),
  ];
}
