import type { RedactSensitiveTextOptions } from '@signalglass/core';
import { redactSensitiveText } from '@signalglass/core';

export function sanitizeReportString(
  value: string,
  options?: RedactSensitiveTextOptions,
): string {
  return redactSensitiveText(value, options);
}

export function sanitizeReportValue<T>(
  value: T,
  options?: RedactSensitiveTextOptions,
): T {
  if (typeof value === 'string') {
    return sanitizeReportString(value, options) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeReportValue(item, options)) as T;
  }

  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] =
        normalizeKey(key) === 'storagekey'
          ? '[REDACTED_STORAGE_KEY]'
          : sanitizeReportValue(nestedValue, options);
    }
    return sanitized as T;
  }

  return value;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}
