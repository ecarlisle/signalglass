import type { Trace, TraceEvent, CapturePolicy, PayloadReference } from '@signalglass/core';
import {
  isCredentialLikeText,
  redactAndTruncateSensitiveText,
  redactSensitiveText,
} from '@signalglass/core';

const SENSITIVE_HEADERS = [
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'proxy-authorization',
];

const DEFAULT_MAX_EXCERPT_LENGTH = 240;

const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /auth/i,
  /token/i,
  /secret/i,
  /password/i,
  /credential/i,
];

export function sanitizeTraceForStorage(trace: Trace): Trace {
  const sanitizedEvents = trace.events.map(event => sanitizeEvent(event, trace.capturePolicy));

  return {
    ...trace,
    metadata: sanitizeMetadata(trace.metadata, trace.capturePolicy),
    events: sanitizedEvents,
  };
}

function sanitizeEvent(event: TraceEvent, policy: CapturePolicy): TraceEvent {
  const sanitized: TraceEvent = { ...event };
  const opts = redactionOptions(policy);

  // Sanitize top-level string fields that may contain secrets
  if (sanitized.routingDecision) {
    sanitized.routingDecision = redactSensitiveText(sanitized.routingDecision, opts);
  }
  if (sanitized.transformationSummary) {
    sanitized.transformationSummary = redactSensitiveText(sanitized.transformationSummary, opts);
  }

  // Always strip sensitive data from metadata
  if (event.metadata) {
    sanitized.metadata = sanitizeMetadata(event.metadata, policy);
  }

  // Handle payload references based on capture policy
  if (event.payloadRef) {
    if (policy.storeFullRawPayloads && policy.mode === 'debug') {
      // Debug mode with explicit opt-in may keep payload references, but only
      // after sensitive fields and excerpts have been sanitized.
      sanitized.payloadRef = sanitizeDebugPayloadRef(event.payloadRef, policy);
    } else if (
      policy.storeShortRedactedExcerpts &&
      event.payloadRef.excerpt
    ) {
      // Standard/minimal mode: keep only a sanitized, bounded excerpt.
      // We never trust the caller-provided redacted flag as proof of safety;
      // sanitizeExcerptOnlyPayloadRef re-sanitizes and forces redacted: true.
      sanitized.payloadRef = sanitizeExcerptOnlyPayloadRef(event.payloadRef, policy);
    } else {
      // Remove payload reference entirely
      delete sanitized.payloadRef;
    }
  }

  return sanitized;
}

function sanitizeDebugPayloadRef(
  payloadRef: PayloadReference,
  policy: CapturePolicy,
): PayloadReference {
  const sanitized: PayloadReference = {
    ...payloadRef,
  };

  if (payloadRef.excerpt != null) {
    sanitized.excerpt = sanitizeExcerpt(payloadRef.excerpt, policy);
  }

  if (
    payloadRef.storageKey != null &&
    isCredentialLikeText(payloadRef.storageKey, redactionOptions(policy))
  ) {
    delete sanitized.storageKey;
  }

  return sanitized;
}

function sanitizeExcerptOnlyPayloadRef(
  payloadRef: PayloadReference,
  policy: CapturePolicy,
): PayloadReference {
  return {
    id: payloadRef.id,
    redacted: true,
    excerpt: sanitizeExcerpt(payloadRef.excerpt ?? '', policy),
  };
}

function sanitizeExcerpt(excerpt: string, policy: CapturePolicy): string {
  return redactAndTruncateSensitiveText(
    excerpt,
    policy.redaction?.maxExcerptLength ?? DEFAULT_MAX_EXCERPT_LENGTH,
    redactionOptions(policy),
  );
}

function redactionOptions(policy: CapturePolicy): { secretPatterns?: string[] } {
  return {
    secretPatterns: policy.redaction?.secretPatterns ?? [],
  };
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
  policy: CapturePolicy,
): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  const stripHeaders = new Set([
    ...SENSITIVE_HEADERS,
    ...(policy.redaction?.stripHeaders ?? []).map((header) => header.toLowerCase()),
  ]);

  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();

    // Always strip sensitive headers
    if (stripHeaders.has(lowerKey)) {
      continue;
    }

    // Strip keys matching sensitive patterns
    if (SENSITIVE_PATTERNS.some(pattern => pattern.test(key))) {
      continue;
    }

    // Never store API keys regardless of policy
    if (policy.storeApiKeys === false && isApiKeyLike(key, value)) {
      continue;
    }

    // Never store secrets
    if (policy.storeSecrets === false && isSecretLike(key, value)) {
      continue;
    }

    // Recursively sanitize nested objects and arrays
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        const sanitizedArray = value
          .map((item: unknown) => {
            if (item && typeof item === 'object') {
              return sanitizeMetadata(item as Record<string, unknown>, policy);
            }
            if (typeof item === 'string') {
              return redactSensitiveText(item, redactionOptions(policy));
            }
            return item;
          })
          .filter((item: unknown) => item !== undefined);
        if (sanitizedArray.length > 0) {
          sanitized[key] = sanitizedArray;
        }
      } else {
        const nested = sanitizeMetadata(value as Record<string, unknown>, policy);
        if (nested && Object.keys(nested).length > 0) {
          sanitized[key] = nested;
        }
      }
    } else {
      sanitized[key] =
        typeof value === 'string'
          ? redactSensitiveText(value, redactionOptions(policy))
          : value;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function isApiKeyLike(key: string, value: unknown): boolean {
  const lowerKey = key.toLowerCase();
  if (lowerKey.includes('api') && lowerKey.includes('key')) {
    return true;
  }
  if (typeof value === 'string' && isCredentialLikeText(value)) {
    return true;
  }
  return false;
}

function isSecretLike(key: string, value: unknown): boolean {
  const lowerKey = key.toLowerCase();
  if (lowerKey.includes('secret') || lowerKey.includes('password')) {
    return true;
  }
  if (typeof value === 'string' && isCredentialLikeText(value)) {
    return true;
  }
  return false;
}
