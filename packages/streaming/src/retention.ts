import type {
  ContentLeaf,
  LeafOwnerStatus,
  NormalizedContentPart,
  NormalizedRole,
  RequestMessage,
} from '@signalglass/evidence';

export const RETAINED_CONTENT_CODE_POINT_LIMIT = 240;
export const CAPTURE_PROFILE_NAME = 'signalglass.collection.ingress-metadata-safe' as const;
export const CAPTURE_PROFILE_VERSION = '1.0.0' as const;
export const DETECTOR_NAME = 'signalglass.collection.sensitive-detector' as const;
export const DETECTOR_VERSION = '1.0.0' as const;

const MASK = '[REDACTED]';
const LABEL_LIMIT = 128;
const KNOWN_ROLES = new Set([
  'system', 'user', 'assistant', 'tool', 'developer', 'function',
]);

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\b(?:authorization|proxy-authorization|x-api-key)\s*[:=]\s*(?:Bearer\s+[^\s,;\r\n]+|[^\s,;\r\n]+)/giu,
  /\b(?:cookie|set-cookie)\s*[:=]\s*[^\r\n]+/giu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gu,
  /sk-[A-Za-z0-9][A-Za-z0-9_-]{6,}\b/gu,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth(?:orization)?|secret|password|credential|storageKey|storage_key)\b\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/giu,
  /\b[A-Z_][A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|COOKIE)[A-Z0-9_]*\s*=\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s\r\n]+)/gu,
];

export type RetainedText = {
  leaf: ContentLeaf;
  masked: boolean;
  truncated: boolean;
};

export type NormalizeMessagesResult = {
  messages: readonly RequestMessage[];
  status: LeafOwnerStatus;
  retainedCodePoints: number;
  retainedLeafCount: number;
  truncatedContent: boolean;
  maskedContent: boolean;
  multimodalContentObserved: boolean;
  requestMessageUnknownKeysObserved: boolean;
  unrecognizedRoleObserved: boolean;
};

/** Full-value detection followed by masking and the fixed 240-code-point cap. */
export function retainText(value: string): RetainedText {
  const matches = collectSensitiveSpans(value);
  const maskedCodePoints = matches.reduce((sum, span) => sum + countCodePoints(value.slice(span.start, span.end)), 0);
  const masked = replaceSpans(value, matches);
  const maskedLength = countCodePoints(masked);
  const retained = [...masked].slice(0, RETAINED_CONTENT_CODE_POINT_LIMIT).join('');
  const truncated = countCodePoints(retained) < maskedLength;
  const status: LeafOwnerStatus = matches.length > 0 ? 'redacted' : truncated ? 'truncated' : 'captured';
  return {
    leaf: {
      text: retained,
      evidenceStatus: status,
      ...(matches.length > 0 ? {
        redaction: {
          policy: `${DETECTOR_NAME}@${DETECTOR_VERSION}`,
          reasons: ['credential-shaped-content'],
          spanCount: matches.length,
          maskedCodePoints,
        },
      } : {}),
      ...(truncated ? {
        truncation: {
          maxLength: RETAINED_CONTENT_CODE_POINT_LIMIT,
          originalLength: maskedLength,
          retainedLength: countCodePoints(retained),
        },
      } : {}),
    },
    masked: matches.length > 0,
    truncated,
  };
}

// fallow-ignore-next-line complexity -- aggregate leaf/fact precedence is explicit
export function normalizeRequestMessages(input: readonly unknown[]): NormalizeMessagesResult {
  const messages: RequestMessage[] = [];
  const statuses: LeafOwnerStatus[] = [];
  let retainedCodePoints = 0;
  let retainedLeafCount = 0;
  let truncatedContent = false;
  let maskedContent = false;
  let multimodalContentObserved = false;
  let requestMessageUnknownKeysObserved = false;
  let unrecognizedRoleObserved = false;

  for (const raw of input) {
    if (!isObject(raw)) {
      requestMessageUnknownKeysObserved = true;
      continue;
    }
    const allowed = new Set(['role', 'content', 'name']);
    if (Object.keys(raw).some((key) => !allowed.has(key))) requestMessageUnknownKeysObserved = true;
    const rawRole = raw['role'];
    if (typeof rawRole !== 'string') {
      requestMessageUnknownKeysObserved = true;
      continue;
    }
    const role: NormalizedRole = KNOWN_ROLES.has(rawRole)
      ? rawRole as NormalizedRole
      : 'unrecognized';
    if (role === 'unrecognized') unrecognizedRoleObserved = true;
    const content = normalizeContent(raw['content']);
    requestMessageUnknownKeysObserved ||= content.unknown;
    multimodalContentObserved ||= content.multimodal;
    for (const retained of content.retained) {
      statuses.push(retained.leaf.evidenceStatus);
      retainedCodePoints += countCodePoints(retained.leaf.text);
      retainedLeafCount += 1;
      truncatedContent ||= retained.truncated;
      maskedContent ||= retained.masked;
    }
    messages.push({
      role,
      content: content.content,
      ...(typeof raw['name'] === 'string'
        ? { name: [...raw['name']].slice(0, LABEL_LIMIT).join('') }
        : {}),
    });
  }

  return {
    messages,
    status: aggregateStatus(statuses),
    retainedCodePoints,
    retainedLeafCount,
    truncatedContent,
    maskedContent,
    multimodalContentObserved,
    requestMessageUnknownKeysObserved,
    unrecognizedRoleObserved,
  };
}

// fallow-ignore-next-line complexity -- closed normalized content-part union
function normalizeContent(value: unknown): {
  content: ContentLeaf | readonly NormalizedContentPart[];
  retained: readonly RetainedText[];
  unknown: boolean;
  multimodal: boolean;
} {
  if (typeof value === 'string') {
    const retained = retainText(value);
    return { content: retained.leaf, retained: [retained], unknown: false, multimodal: false };
  }
  if (!Array.isArray(value)) {
    return {
      content: [],
      retained: [],
      unknown: value !== undefined && value !== null,
      multimodal: false,
    };
  }
  const parts: NormalizedContentPart[] = [];
  const retained: RetainedText[] = [];
  let unknown = false;
  let multimodal = false;
  for (const rawPart of value) {
    if (!isObject(rawPart) || typeof rawPart['type'] !== 'string') {
      unknown = true;
      continue;
    }
    const type = rawPart['type'];
    if (type === 'text' && typeof rawPart['text'] === 'string') {
      unknown ||= hasUnknownKeys(rawPart, ['type', 'text']);
      const leaf = retainText(rawPart['text']); retained.push(leaf);
      parts.push({ kind: 'text', text: leaf.leaf });
    } else if (type === 'image_url') {
      unknown ||= hasUnknownKeys(rawPart, ['type', 'image_url']);
      const image = rawPart['image_url'];
      if (isObject(image)) unknown ||= hasUnknownKeys(image, ['url']);
      const url = typeof image === 'string' ? image : isObject(image) && typeof image['url'] === 'string' ? image['url'] : undefined;
      multimodal = true;
      if (url === undefined) { unknown = true; continue; }
      const leaf = retainText(url); retained.push(leaf);
      parts.push({ kind: 'image_url', url: leaf.leaf });
    } else if (type === 'tool_call' && typeof rawPart['id'] === 'string' && typeof rawPart['name'] === 'string' && typeof rawPart['arguments'] === 'string') {
      unknown ||= hasUnknownKeys(rawPart, ['type', 'id', 'name', 'arguments']);
      const leaf = retainText(rawPart['arguments']); retained.push(leaf);
      parts.push({ kind: 'tool_call', id: boundedLabel(rawPart['id']), name: boundedLabel(rawPart['name']), arguments: leaf.leaf });
    } else if (type === 'tool_result' && typeof rawPart['tool_call_id'] === 'string' && typeof rawPart['content'] === 'string') {
      unknown ||= hasUnknownKeys(rawPart, ['type', 'tool_call_id', 'content']);
      const leaf = retainText(rawPart['content']); retained.push(leaf);
      parts.push({ kind: 'tool_result', toolCallId: boundedLabel(rawPart['tool_call_id']), content: leaf.leaf });
    } else {
      unknown = true;
    }
  }
  return { content: parts, retained, unknown, multimodal };
}

export function countCodePoints(value: string): number {
  return [...value].length;
}

function aggregateStatus(statuses: readonly LeafOwnerStatus[]): LeafOwnerStatus {
  if (statuses.includes('redacted')) return 'redacted';
  if (statuses.includes('truncated')) return 'truncated';
  return 'captured';
}

function boundedLabel(value: string): string {
  return [...value].slice(0, LABEL_LIMIT).join('');
}

function collectSensitiveSpans(value: string): readonly { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(value)) !== null) {
      spans.push({ start: match.index, end: match.index + match[0].length });
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: { start: number; end: number }[] = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

function replaceSpans(value: string, spans: readonly { start: number; end: number }[]): string {
  let cursor = 0;
  let output = '';
  for (const span of spans) {
    output += value.slice(cursor, span.start) + MASK;
    cursor = span.end;
  }
  return output + value.slice(cursor);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const permitted = new Set(allowed);
  return Object.keys(value).some((key) => !permitted.has(key));
}
