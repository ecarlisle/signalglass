export interface RedactSensitiveTextOptions {
  secretPatterns?: string[];
}

const REDACTED = '[REDACTED]';
const REDACTED_API_KEY = '[REDACTED_API_KEY]';

const KEY_VALUE_SECRET =
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth(?:orization)?|secret|password|credential|storageKey|storage_key)\b\s*[:=]\s*("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi;

const JSON_SECRET =
  /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth(?:orization)?|secret|password|credential|storageKey|storage_key)["']?\s*:\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi;

const ENV_SECRET =
  /\b([A-Z_][A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|COOKIE)[A-Z0-9_]*)\s*=\s*("[^"\r\n]*"|'[^'\r\n]*'|[^\s\r\n]+)/gi;

const AUTH_HEADER =
  /\b(authorization|proxy-authorization|x-api-key)\s*[:=]\s*(?:Bearer\s+[^\s,;\r\n]+|[^\s,;\r\n]+)/gi;

const COOKIE_HEADER = /\b(cookie|set-cookie)\s*[:=]\s*[^\r\n]+/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PREFIXED_API_KEY = /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{6,}\b/g;

/**
 * Redact credential-like substrings from text that may be stored or reported.
 *
 * This is deliberately conservative and provider-agnostic. It is not intended
 * to prove text is safe; it removes common high-risk secret shapes before the
 * text crosses persistence or reporting boundaries.
 */
export function redactSensitiveText(
  value: string,
  options: RedactSensitiveTextOptions = {},
): string {
  let redacted = value;

  for (const pattern of options.secretPatterns ?? []) {
    const compiled = compilePattern(pattern);
    if (compiled) {
      redacted = redacted.replace(compiled, REDACTED);
    }
  }

  redacted = redacted.replace(AUTH_HEADER, `$1: ${REDACTED}`);
  redacted = redacted.replace(COOKIE_HEADER, `$1: ${REDACTED}`);
  redacted = redacted.replace(BEARER_TOKEN, `Bearer ${REDACTED}`);
  redacted = redacted.replace(PREFIXED_API_KEY, REDACTED_API_KEY);
  redacted = redacted.replace(JSON_SECRET, `$1"${REDACTED}"`);
  redacted = redacted.replace(KEY_VALUE_SECRET, `$1=${REDACTED}`);
  redacted = redacted.replace(ENV_SECRET, `$1=${REDACTED}`);

  return redacted;
}

export function redactAndTruncateSensitiveText(
  value: string,
  maxLength: number,
  options: RedactSensitiveTextOptions = {},
): string {
  const redacted = redactSensitiveText(value, options);
  if (maxLength <= 0) return '';
  if (redacted.length <= maxLength) return redacted;
  if (maxLength === 1) return '…';
  return `${redacted.slice(0, maxLength - 1)}…`;
}

export function isCredentialLikeText(
  value: string,
  options: RedactSensitiveTextOptions = {},
): boolean {
  return redactSensitiveText(value, options) !== value;
}

function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'gi');
  } catch {
    return null;
  }
}
