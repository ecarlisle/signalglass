import { redactSensitiveText } from '@signalglass/core';

export function sanitizeReportString(value: string): string {
  return redactSensitiveText(value);
}

export function sanitizeReportValue<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeReportString(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeReportValue(item)) as T;
  }

  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] =
        normalizeKey(key) === 'storagekey'
          ? '[REDACTED_STORAGE_KEY]'
          : sanitizeReportValue(nestedValue);
    }
    return sanitized as T;
  }

  return value;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}
