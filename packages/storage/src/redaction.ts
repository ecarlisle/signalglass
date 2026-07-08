import type { Trace, TraceEvent, CapturePolicy } from '@signalglass/core';

const SENSITIVE_HEADERS = [
  'authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'proxy-authorization',
];

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

  // Always strip sensitive data from metadata
  if (event.metadata) {
    sanitized.metadata = sanitizeMetadata(event.metadata, policy);
  }

  // Handle payload references based on capture policy
  if (event.payloadRef) {
    if (policy.storeFullRawPayloads && policy.mode === 'debug') {
      // Debug mode with explicit opt-in: keep full payload reference including storageKey
      sanitized.payloadRef = { ...event.payloadRef };
    } else if (policy.storeShortRedactedExcerpts && event.payloadRef.excerpt && event.payloadRef.redacted) {
      // Standard/minimal mode: only keep already-redacted excerpt
      sanitized.payloadRef = {
        id: event.payloadRef.id,
        redacted: true,
        excerpt: event.payloadRef.excerpt,
      };
    } else {
      // Remove payload reference entirely
      delete sanitized.payloadRef;
    }
  }

  return sanitized;
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
  policy: CapturePolicy,
): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();

    // Always strip sensitive headers
    if (SENSITIVE_HEADERS.includes(lowerKey)) {
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
      sanitized[key] = value;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function isApiKeyLike(key: string, value: unknown): boolean {
  const lowerKey = key.toLowerCase();
  if (lowerKey.includes('api') && lowerKey.includes('key')) {
    return true;
  }
  if (typeof value === 'string' && value.startsWith('sk-')) {
    return true;
  }
  return false;
}

function isSecretLike(key: string, value: unknown): boolean {
  const lowerKey = key.toLowerCase();
  if (lowerKey.includes('secret') || lowerKey.includes('password')) {
    return true;
  }
  return false;
}
