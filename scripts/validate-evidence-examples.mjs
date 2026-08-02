#!/usr/bin/env node
// Semantic validator for the serialized evidence examples in
// docs/evidence-model.md (Spec 013 contract). Dependency-free.
// Run: node scripts/validate-evidence-examples.mjs
//
// Checks, per trace example:
//   - interactionId === traceId (both serialized; equality invariant)
//   - unique event ids within the trace; unique span ids within the trace
//   - contiguous seq starting at 0; no duplicate seq values
//   - every event carries traceId matching the trace
//   - valid span references (spanId / parentSpanId) and span lifecycle
//     (span_start/span_end present; span startSeq/endSeq match their events)
//   - valid lifecycle ordering; interaction_start first; interaction_end
//     terminal; no events after the terminal event
//   - valid evidenceStatus values; `null` only for structural absence
//     (parentSpanId / spanId)
//   - retry events reference the original request eventId (plus optional
//     errorEventId referencing an error event)
//   - missing status carries an explicit `missing` declaration
//   - request/response envelopes declare providerNativeFidelity, and the
//     declared fidelity matches the stored representation
//   - declared completeness counts match the events
//   - cross-record references resolve (traceId, eventId, measurementId,
//     artifactId)

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function jsonBlocks(file) {
  const text = readFileSync(resolve(root, file), "utf8");
  return [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
}

const errors = [];
const STATUSES = new Set([
  "captured", "redacted", "truncated", "missing", "unknown", "not_applicable",
]);
const FIDELITIES = new Set(["structurally_faithful", "byte_faithful"]);
const OBSERVATION_ROLES = new Set([
  "application_constructed", "client_sent", "provider_reported", "returned",
  "unobservable",
]);
// Lifecycle control events carry no payload and inherit the capture surface's
// declared boundary; they are the only kinds that need no observationRole.
const CONTROL_KINDS = new Set([
  "interaction_start", "interaction_end", "span_start", "span_end",
]);
// Keys that belong on storage/export metadata, never on canonical evidence
// records (Spec 013 §9.2).
const ADMIN_POLICY_KEY_RE = /^(persistence|export)(Policy|Version)/i;
const EVENT_KINDS = new Set([
  "interaction_start", "interaction_end", "span_start", "span_end",
  "model_request", "model_response", "model_response_chunk", "model_usage",
  "tool_call", "tool_result", "mcp_request", "mcp_result",
  "retrieval_request", "retrieval_result",
  "context_provider_request", "context_provider_result", "context_assembled",
  "error", "cancelled", "retry",
]);
const REQUEST_KIND_RE = /_(request|call)$/;

function walk(obj, fn) {
  if (Array.isArray(obj)) { for (const v of obj) walk(v, fn); return; }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) { fn(k, v); walk(v, fn); }
  }
}

// ---- Parse ----
const rawBlocks = jsonBlocks("docs/evidence-model.md");
const parsed = rawBlocks.map((b, i) => {
  try { return JSON.parse(b); }
  catch (e) { errors.push(`[block ${i}] invalid JSON: ${e.message}`); return null; }
});

// ---- Build the cross-block id index ----
const index = {
  traces: new Set(),
  events: new Map(), // eventId -> { traceId, kind }
  spans: new Set(),
  artifacts: new Set(),
  measurements: new Set(),
  interpretations: new Set(),
};
const traces = [];
parsed.forEach((b, i) => {
  if (!b) return;
  if (b.interactionId !== undefined && Array.isArray(b.events)) {
    traces.push({ i, b });
    index.traces.add(b.traceId);
    for (const ev of b.events) index.events.set(ev.eventId, { traceId: b.traceId, kind: ev.kind });
    for (const s of b.spans || []) index.spans.add(s.spanId);
  } else if (b.artifactId !== undefined) index.artifacts.add(b.artifactId);
  else if (b.measurementId !== undefined) index.measurements.add(b.measurementId);
  else if (b.interpretationId !== undefined) index.interpretations.add(b.interpretationId);
});

function checkTraceRef(ref, label) {
  if (!ref.traceId) return;
  if (!index.traces.has(ref.traceId)) {
    errors.push(`${label}: references unknown traceId ${ref.traceId}`); return;
  }
  if (ref.eventId !== undefined) {
    const ev = index.events.get(ref.eventId);
    if (!ev) { errors.push(`${label}: references unknown eventId ${ref.eventId}`); return; }
    if (ev.traceId !== ref.traceId) {
      errors.push(`${label}: eventId ${ref.eventId} belongs to trace ${ev.traceId}, not ${ref.traceId}`);
    }
  }
  if (ref.artifactId !== undefined && !index.artifacts.has(ref.artifactId)) {
    errors.push(`${label}: references unknown artifactId ${ref.artifactId}`);
  }
}

// ---- Trace invariants ----
for (const { i, b } of traces) {
  const label = `[trace ${i}] ${b.traceId}`;
  if (b.interactionId !== b.traceId) errors.push(`${label}: interactionId !== traceId`);
  for (const key of Object.keys(b)) {
    if (ADMIN_POLICY_KEY_RE.test(key)) errors.push(`${label}: disallowed administrative policy field '${key}' on a canonical evidence record (Spec 013 §9.2)`);
  }

  const events = b.events;
  const eventIds = new Set();
  const spanIds = new Set((b.spans || []).map((s) => s.spanId));
  const kinds = {};
  let prevSeq = -1;
  let terminalSeen = false;

  for (const ev of events) {
    const el = `${label} event ${ev.eventId}`;
    if (!Number.isInteger(ev.seq) || ev.seq < 0) { errors.push(`${el}: invalid seq ${ev.seq}`); continue; }
    if (ev.seq !== prevSeq + 1) errors.push(`${el}: seq ${ev.seq} — expected ${prevSeq + 1} (gap or duplicate)`);
    prevSeq = ev.seq;
    if (eventIds.has(ev.eventId)) errors.push(`${el}: duplicate eventId`);
    eventIds.add(ev.eventId);
    if (ev.traceId !== b.traceId) errors.push(`${el}: traceId ${ev.traceId} does not match trace`);
    if (!STATUSES.has(ev.evidenceStatus)) errors.push(`${el}: invalid evidenceStatus ${ev.evidenceStatus}`);
    if (!EVENT_KINDS.has(ev.kind)) errors.push(`${el}: unknown kind ${ev.kind}`);
    if (ev.spanId != null && !spanIds.has(ev.spanId)) errors.push(`${el}: references unknown span ${ev.spanId}`);
    if (terminalSeen) errors.push(`${el}: appears after interaction_end (terminal event)`);
    if (ev.kind === "interaction_end") terminalSeen = true;
    if (ev.kind === "interaction_start" && ev.seq !== 0) errors.push(`${el}: interaction_start must be seq 0`);
    kinds[ev.kind] = (kinds[ev.kind] || 0) + 1;

    // observationRole (Spec 013 §5.1): every payload-bearing event declares it;
    // lifecycle control events are exempt. `observedAt` is not a defined field
    // (Spec 013 §5.2).
    if (CONTROL_KINDS.has(ev.kind)) {
      if (ev.observationRole !== undefined) {
        errors.push(`${el}: control event kind '${ev.kind}' must not carry observationRole (it inherits the capture surface boundary)`);
      }
    } else if (!ev.observationRole) {
      errors.push(`${el}: payload-bearing event (kind '${ev.kind}') missing required observationRole (Spec 013 §5.1)`);
    } else if (!OBSERVATION_ROLES.has(ev.observationRole)) {
      errors.push(`${el}: invalid observationRole '${ev.observationRole}' (valid: ${[...OBSERVATION_ROLES].join(", ")})`);
    }
    if (ev.observedAt !== undefined) errors.push(`${el}: 'observedAt' is not a defined observation field; use observationRole + evidenceStatus + captureSurface/observationBoundary (Spec 013 §5.2)`);
    for (const key of Object.keys(ev)) {
      if (ADMIN_POLICY_KEY_RE.test(key)) errors.push(`${el}: disallowed administrative policy field '${key}' on a canonical evidence record (Spec 013 §9.2)`);
    }

    for (const envKey of ["requestEnvelope", "responseEnvelope"]) {
      const env = ev[envKey];
      if (!env) continue;
      if (!env.providerNativeFidelity) {
        errors.push(`${el}: ${envKey} missing required providerNativeFidelity`);
      } else if (!FIDELITIES.has(env.providerNativeFidelity)) {
        errors.push(`${el}: ${envKey} invalid providerNativeFidelity ${env.providerNativeFidelity}`);
      } else if (env.providerNativeFidelity === "byte_faithful") {
        if (!env.nativeEncoding || !env.nativeContentType) {
          errors.push(`${el}: ${envKey} byte_faithful requires nativeEncoding and nativeContentType`);
        }
      }
    }

    if (ev.kind === "retry") {
      const r = ev.retry || {};
      if (!r.originalRequestEventId) {
        errors.push(`${el}: retry missing originalRequestEventId`);
      } else {
        const orig = index.events.get(r.originalRequestEventId);
        if (!orig) errors.push(`${el}: retry references unknown originalRequestEventId ${r.originalRequestEventId}`);
        else if (orig.traceId !== b.traceId) errors.push(`${el}: retry originalRequestEventId is in another trace`);
        else if (!REQUEST_KIND_RE.test(orig.kind)) errors.push(`${el}: retry originalRequestEventId ${r.originalRequestEventId} is not a request event (kind ${orig.kind})`);
      }
      if (r.errorEventId) {
        const err = index.events.get(r.errorEventId);
        if (!err) errors.push(`${el}: retry references unknown errorEventId ${r.errorEventId}`);
        else if (err.kind !== "error") errors.push(`${el}: retry errorEventId ${r.errorEventId} is not an error event (kind ${err.kind})`);
      }
    }

    if (ev.evidenceStatus === "missing" && !ev.missing) {
      errors.push(`${el}: evidenceStatus missing but no 'missing' declaration`);
    }

    if (ev.redaction) {
      const secretReason = (ev.redaction.reasons || []).some((r) =>
        /authorization[- ]?header|api[- ]?key|secret|token/i.test(String(r)));
      if (secretReason && ev.redaction.originalHash !== undefined) {
        errors.push(`${el}: redaction reason includes a secret but retains originalHash — hashes of secrets must not be retained (Spec 013 §6.1 hash semantics)`);
      }
    }

    for (const c of ev.contextContributions || []) {
      if (c.artifactId && !index.artifacts.has(c.artifactId)) {
        errors.push(`${el}: references unknown artifact ${c.artifactId}`);
      }
    }

    walk(ev, (k, v) => {
      if (v === null && k !== "parentSpanId" && k !== "spanId") {
        errors.push(`${el}: uses null for field ${k} (evidence states/values must not be null)`);
      }
    });
  }

  if (prevSeq !== events.length - 1) {
    errors.push(`${label}: seq must start at 0 and be contiguous (last seq ${prevSeq}, ${events.length} events)`);
  }
  if (!kinds.interaction_start) errors.push(`${label}: missing interaction_start`);
  if (!kinds.interaction_end) errors.push(`${label}: missing interaction_end`);
  if (kinds.interaction_end && events[events.length - 1].kind !== "interaction_end") {
    errors.push(`${label}: interaction_end is not the terminal event`);
  }

  // span lifecycle
  const startBySpan = {}, endBySpan = {};
  for (const ev of events) {
    if (ev.kind === "span_start") startBySpan[ev.spanId] = ev.seq;
    if (ev.kind === "span_end") endBySpan[ev.spanId] = ev.seq;
  }
  for (const s of b.spans || []) {
    const ss = startBySpan[s.spanId], se = endBySpan[s.spanId];
    if (ss === undefined || se === undefined) {
      errors.push(`${label}: span ${s.spanId} has no span_start/span_end events`);
      continue;
    }
    if (s.startSeq !== ss || s.endSeq !== se) {
      errors.push(`${label}: span ${s.spanId} startSeq/endSeq (${s.startSeq}/${s.endSeq}) do not match span_start/span_end seqs (${ss}/${se})`);
    }
    if (s.startSeq > s.endSeq) errors.push(`${label}: span ${s.spanId} startSeq > endSeq`);
    if (s.parentSpanId != null && !spanIds.has(s.parentSpanId)) {
      errors.push(`${label}: span ${s.spanId} references unknown parentSpanId ${s.parentSpanId}`);
    }
  }

  // completeness
  if (b.completeness) {
    const declared = b.completeness.eventsByStatus || {};
    const actual = {};
    for (const ev of events) actual[ev.evidenceStatus] = (actual[ev.evidenceStatus] || 0) + 1;
    for (const k of new Set([...Object.keys(declared), ...Object.keys(actual)])) {
      if ((declared[k] || 0) !== (actual[k] || 0)) {
        errors.push(`${label}: completeness eventsByStatus mismatch for '${k}' (declared ${declared[k] ?? 0}, actual ${actual[k] ?? 0})`);
      }
    }
    if (Array.isArray(b.completeness.seqGaps) && b.completeness.seqGaps.length > 0) {
      const seqs = events.map((e) => e.seq).sort((a, z) => a - z);
      const realGap = seqs.some((s, idx) => idx > 0 && s - seqs[idx - 1] > 1);
      if (!realGap) {
        errors.push(`${label}: declares seqGaps but observed event seqs are contiguous — a trailing discontinuity after the final event is not an observable gap`);
      }
    }
  }
}

// ---- Record references ----
parsed.forEach((b, i) => {
  if (!b || b.interactionId !== undefined) return;
  const label = `[record ${i}]`;
  if (b.measurementId !== undefined) {
    if (!b.kind) errors.push(`${label}: measurement ${b.measurementId} missing kind`);
    for (const inp of b.inputs || []) {
      if (inp.measurementId !== undefined) {
        if (!index.measurements.has(inp.measurementId)) errors.push(`${label}: references unknown measurement ${inp.measurementId}`);
      } else if (inp.traceId !== undefined) checkTraceRef(inp, label);
      else errors.push(`${label}: measurement input has neither measurementId nor traceId`);
    }
  } else if (b.interpretationId !== undefined) {
    for (const inp of b.inputs || []) {
      if (inp.measurementId !== undefined) {
        if (!index.measurements.has(inp.measurementId)) errors.push(`${label}: references unknown measurement ${inp.measurementId}`);
      } else if (inp.traceId !== undefined) checkTraceRef(inp, label);
      else errors.push(`${label}: interpretation input has neither measurementId nor traceId`);
    }
  } else if (b.artifactId !== undefined) {
    if (!STATUSES.has(b.evidenceStatus)) errors.push(`${label}: artifact ${b.artifactId} invalid evidenceStatus ${b.evidenceStatus}`);
    if (!b.payloadRef) errors.push(`${label}: artifact ${b.artifactId} missing payloadRef`);
    // contentHash (Spec 013 §6.1): top-level only; presence depends on status.
    if (b.payloadRef && b.payloadRef.contentHash !== undefined) {
      errors.push(`${label}: artifact ${b.artifactId} has contentHash nested inside payloadRef — it must be a top-level artifact field`);
    }
    if (b.evidenceStatus === "captured" && b.contentHash === undefined) {
      errors.push(`${label}: artifact ${b.artifactId} is captured with inline content but has no top-level contentHash (required, Spec 013 §6.1)`);
    }
    if (["missing", "unknown", "not_applicable"].includes(b.evidenceStatus) && b.contentHash !== undefined) {
      errors.push(`${label}: artifact ${b.artifactId} has contentHash but evidenceStatus is ${b.evidenceStatus} — SignalGlass cannot hash unavailable content (Spec 013 §6.1)`);
    }
    if (b.observedAt !== undefined) errors.push(`${label}: artifact ${b.artifactId} uses 'observedAt', which is not a defined observation field`);
    for (const key of Object.keys(b)) {
      if (ADMIN_POLICY_KEY_RE.test(key)) errors.push(`${label}: disallowed administrative policy field '${key}' on a canonical evidence record (Spec 013 §9.2)`);
    }
  } else if (b.measurementId !== undefined) {
    for (const key of Object.keys(b)) {
      if (ADMIN_POLICY_KEY_RE.test(key)) errors.push(`${label}: disallowed administrative policy field '${key}' on a canonical evidence record (Spec 013 §9.2)`);
    }
  } else if (b.interpretationId !== undefined) {
    for (const key of Object.keys(b)) {
      if (ADMIN_POLICY_KEY_RE.test(key)) errors.push(`${label}: disallowed administrative policy field '${key}' on a canonical evidence record (Spec 013 §9.2)`);
    }
  }
});

// ---- Adjoining docs JSON (parse-only) ----
let extra = 0;
for (const f of ["docs/capture-profiles.md", "docs/model-versioning.md"]) {
  for (const [j, block] of jsonBlocks(f).entries()) {
    extra++;
    try { JSON.parse(block); }
    catch (e) { errors.push(`[${f} block ${j}] invalid JSON: ${e.message}`); }
  }
}

console.log(`\nValidated ${rawBlocks.length} JSON blocks in docs/evidence-model.md (${traces.length} traces) and ${extra} JSON block(s) in capture-profiles/model-versioning docs.\n`);
if (errors.length) {
  console.log(`ERRORS (${errors.length}):`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log("All semantic checks passed.");
