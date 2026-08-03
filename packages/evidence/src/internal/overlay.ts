/**
 * Owned-field overlay primitives (Spec 014 §5.3). `stripUnknowns` produces the
 * known-only view of a serialized structure for owned-field agreement checks;
 * `preserveUnknowns` carries JSON-safe unknown additive fields from the
 * serialized structure onto the derived (canonical) structure at equivalent
 * structural paths, after agreement is established. Unknown fields never
 * influence ordering, collision resolution, status, completeness, hashing, or
 * provenance — they are applied after all deterministic derivation. Internal
 * helpers, never re-exported (§1.3).
 */

export type ChildSpec =
  | { kind: 'object'; spec: NodeSpec }
  | { kind: 'array'; spec: NodeSpec }
  | { kind: 'arrayById'; idKey: string; spec: NodeSpec }
  | { kind: 'arrayByKey'; keyOf: (item: Record<string, unknown>) => string; spec: NodeSpec };

export type NodeSpec = {
  /** Schema-owned keys at this node. */
  keys: readonly string[];
  /** Known nested children (optional). */
  children?: Record<string, ChildSpec>;
};

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isUnsafeKey(key: string): boolean {
  return UNSAFE_KEYS.has(key);
}

/** Recursively clone a JSON-safe value (Uint8Array copied by content).
 * Unsafe prototype keys (`__proto__`, `constructor`, `prototype`) are
 * excluded at every depth, never merely at the overlaid structural node. */
export function cloneJsonSafe(value: unknown): unknown {
  if (value instanceof Uint8Array) return value.slice();
  if (Array.isArray(value)) return value.map(cloneJsonSafe);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) {
      if (UNSAFE_KEYS.has(k)) continue;
      out[k] = cloneJsonSafe(value[k]);
    }
    return out;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Known-only view of `value`: every schema-owned key is retained (recursing
 * into declared children), every unknown additive key is dropped, and unsafe
 * prototype keys are never emitted. Values at owned leaf keys are kept whole
 * (opaque), so the resulting view is directly comparable to the derivation.
 */
export function stripUnknowns(value: unknown, spec: NodeSpec): unknown {
  if (Array.isArray(value)) return value.map((v) => stripUnknowns(v, spec));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value)) {
    if (UNSAFE_KEYS.has(k)) continue;
    if (!spec.keys.includes(k)) continue; // unknown additive field — dropped
    const child = spec.children && spec.children[k];
    if (child && (child.kind === 'object' || child.kind === 'array')) {
      const v = value[k];
      if (child.kind === 'object' && isRecord(v)) {
        out[k] = stripUnknowns(v, child.spec);
      } else if (child.kind === 'array' && Array.isArray(v)) {
        out[k] = v.map((item) => stripUnknowns(item, child.spec));
      } else {
        out[k] = v;
      }
    } else {
      out[k] = value[k];
    }
  }
  return out;
}

/**
 * Carry unknown additive fields from `source` (serialized) onto `template`
 * (derived) at equivalent paths, recursing into declared children. Owned leaf
 * values are never replaced by the source; unknown fields are appended only
 * when absent from the template. `arrayById` children align template items to
 * source items by `idKey`; other arrays align by position (agreement already
 * guarantees equal lengths).
 */
export function preserveUnknowns(
  template: unknown,
  source: unknown,
  spec: NodeSpec,
): unknown {
  const t = isRecord(template) ? template : {};
  if (!isRecord(source)) return t;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(t)) out[k] = t[k];
  for (const k of Object.keys(source)) {
    if (UNSAFE_KEYS.has(k)) continue;
    const child = spec.children && spec.children[k];
    if (!spec.keys.includes(k)) {
      // Unknown additive field at this node: preserve at the equivalent path.
      if (!(k in out)) out[k] = cloneJsonSafe(source[k]);
      continue;
    }
    if (!child) continue; // owned leaf — template value already carried
    if (child.kind === 'object') {
      const tv = out[k];
      const sv = source[k];
      if (isRecord(sv)) {
        out[k] = preserveUnknowns(isRecord(tv) ? tv : {}, sv, child.spec);
      }
    } else if (child.kind === 'array') {
      const sv = source[k];
      if (!Array.isArray(sv)) continue;
      const tv = out[k];
      out[k] = Array.isArray(tv)
        ? sv.map((item, i) => preserveUnknowns(tv[i], item, child.spec))
        : sv.map((item) => cloneJsonSafe(item));
    } else if (child.kind === 'arrayById') {
      const sv = source[k];
      const tv = out[k];
      if (!Array.isArray(sv)) continue;
      const tvArr = Array.isArray(tv) ? tv : [];
      out[k] = tvArr.map((titem) => {
        const sitem = isRecord(titem)
          ? sv.find(
              (x): boolean =>
                isRecord(x) &&
                x[child.idKey] === titem[child.idKey],
            )
          : undefined;
        return preserveUnknowns(titem, sitem ?? titem, child.spec);
      });
    } else if (child.kind === 'arrayByKey') {
      const sv = source[k];
      const tv = out[k];
      if (!Array.isArray(sv)) continue;
      const tvArr = Array.isArray(tv) ? tv : [];
      const byKey = new Map(
        sv.filter(isRecord).map((x) => [child.keyOf(x), x]),
      );
      out[k] = tvArr.map((titem) => {
        const src =
          isRecord(titem) && byKey.has(child.keyOf(titem))
            ? byKey.get(child.keyOf(titem))
            : titem;
        return preserveUnknowns(titem, src ?? titem, child.spec);
      });
    }
  }
  return out;
}
