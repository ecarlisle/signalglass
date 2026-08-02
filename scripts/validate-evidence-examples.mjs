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
//     declared fidelity matches the stored representation; checkEnvelope
//     enforces one coherent status/fidelity/hash rule set (byte_faithful
//     requires captured, nativeEncoding, nativeContentType, nativeContentHash;
//     byte_faithful with any non-captured status is a single rejection;
//     nativeContentHash forbidden when bytes not observed; sha256:64hex)
//   - declared completeness counts match the events
//   - cross-record references resolve (traceId, eventId, measurementId,
//     artifactId)
//   - administrative policy fields (persistence/export policy versions) are
//     rejected on every canonical record type; standalone artifacts are
//     self-describing (traceId + evidenceSchemaVersion); artifact hash
//     selection is driven by the artifact's own contentFidelity/contentType/
//     contentCanonicalizer/contentHashUnavailableReason fields (Spec 013
//     §6.1 decision table), never an enclosing event or envelope
//   - --self-test runs negative fixtures proving the administrative-policy
//     checks fire for traces, events, artifacts, measurements, and
//     interpretations, that invalid envelope status/fidelity/hash
//     combinations are rejected (with a positive byte_faithful control), and
//     that the artifact-level hash-selection branches fire (with positive
//     controls for every reproducible hashing path and for declared
//     unsupported-canonicalizer unavailability)

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
// Artifact-level content representation (Spec 013 §6.1). The hashing path is
// selected from the artifact's own serialized fields; these values are the
// closed vocabularies the validator accepts.
const ARTIFACT_FIDELITIES = new Set(["byte_faithful", "structurally_faithful"]);
const HASH_UNAVAILABLE_REASONS = new Set(["unsupported_canonicalizer"]);
// RFC 6838 restricted-name syntax for media types: exactly one '/' separating
// type and subtype; each name starts with an ASCII alphanumeric and continues
// with restricted-name characters, max 127 characters per name. Parameters
// (e.g. ;charset=utf-8), whitespace, wildcards, empty components, additional
// slashes, and non-ASCII characters are rejected — contentType is the media
// type only.
const MEDIA_TYPE_RE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/;

function isJsonContentType(ct) {
  if (typeof ct !== "string") return false;
  const base = ct.split(";")[0].trim().toLowerCase();
  return base === "application/json" || base.endsWith("+json");
}

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

// Envelope fidelity / nativeContentHash contract (Spec 013 §3.2). One
// coherent rule set, so an invalid combination produces a single rejection
// rather than simultaneous "required" and "forbidden" errors:
//   - byte_faithful + captured  -> requires nativeEncoding, nativeContentType,
//                                  and nativeContentHash
//   - byte_faithful + missing/unknown/not_applicable -> invalid (bytes not
//                                  observed), single rejection
//   - byte_faithful + redacted/truncated -> invalid as a claim over observed
//                                  bytes (fidelity to discarded originals is
//                                  never implied)
//   - nativeContentHash on a non-captured payload -> forbidden
//   - nativeContentHash representation: 'sha256:' + 64 lowercase hex
function checkEnvelope(env, ev, el, envKey) {
  if (!env.providerNativeFidelity) {
    errors.push(`${el}: ${envKey} missing required providerNativeFidelity`);
    return;
  }
  if (!FIDELITIES.has(env.providerNativeFidelity)) {
    errors.push(`${el}: ${envKey} invalid providerNativeFidelity ${env.providerNativeFidelity}`);
    return;
  }
  if (env.nativeContentHash !== undefined && !/^sha256:[0-9a-f]{64}$/.test(env.nativeContentHash)) {
    errors.push(`${el}: ${envKey} nativeContentHash '${env.nativeContentHash}' is not 'sha256:' + 64 lowercase hex characters (Spec 013 §3.2)`);
  }
  if (env.providerNativeFidelity === "byte_faithful") {
    if (ev.evidenceStatus !== "captured") {
      errors.push(`${el}: ${envKey} declares byte_faithful but event evidenceStatus is ${ev.evidenceStatus} — byte fidelity requires the exact native bytes to have been observed and captured; it cannot be claimed for content that was not observed or that was transformed at capture (Spec 013 §3.2)`);
      return;
    }
    if (!env.nativeEncoding || !env.nativeContentType) {
      errors.push(`${el}: ${envKey} byte_faithful requires nativeEncoding and nativeContentType`);
    }
    if (env.nativeContentHash === undefined) {
      errors.push(`${el}: ${envKey} byte_faithful with captured native bytes requires nativeContentHash over the observed native bytes (Spec 013 §3.2)`);
    }
  } else if (env.nativeContentHash !== undefined && ev.evidenceStatus !== "captured") {
    errors.push(`${el}: ${envKey} carries nativeContentHash but event evidenceStatus is ${ev.evidenceStatus} — a native content hash claims observed, retained bytes (Spec 013 §3.2)`);
  }
}

// Administrative policy fields (persistence/export policy versions) belong on
// storage/export metadata, never on canonical evidence records (Spec 013
// §9.2). Runs for every canonical record type — trace, event, artifact,
// measurement, interpretation — independently of record-type classification,
// so no branch can skip it.
function checkAdminPolicyFields(rec, label) {
  for (const key of Object.keys(rec)) {
    if (ADMIN_POLICY_KEY_RE.test(key)) {
      errors.push(`${label}: disallowed administrative policy field '${key}' on a canonical evidence record (Spec 013 §9.2)`);
    }
  }
}

// ---- Trace invariants ----
for (const { i, b } of traces) {
  const label = `[trace ${i}] ${b.traceId}`;
  if (b.interactionId !== b.traceId) errors.push(`${label}: interactionId !== traceId`);
  checkAdminPolicyFields(b, label);

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
    // Provider-reported claims must be actual provider assertions (Spec 013
    // §5.2): role provider_reported contradicts an unknown/missing usage state.
    if (ev.kind === "model_usage" && ev.observationRole === "provider_reported") {
      const u = ev.usage || {};
      if (ev.evidenceStatus !== "captured" || u.evidenceStatus === "unknown" || u.reason === "not_reported_by_provider") {
        errors.push(`${el}: observationRole 'provider_reported' but usage state is ${ev.evidenceStatus}/${u.evidenceStatus ?? "captured"} (${u.reason ?? "values"}) — the provider did not report usage here; use a role that describes what was actually observed (e.g. 'unobservable' or 'returned')`);
      }
    }
    if (ev.kind === "model_usage" && ev.observationRole === "unobservable") {
      const u = ev.usage || {};
      if (u.evidenceStatus === "captured" || (u.inputTokens && u.inputTokens.evidenceStatus === "captured")) {
        errors.push(`${el}: observationRole 'unobservable' but usage declares captured values — unobservable content cannot be captured`);
      }
    }
    checkAdminPolicyFields(ev, el);

    for (const envKey of ["requestEnvelope", "responseEnvelope"]) {
      const env = ev[envKey];
      if (!env) continue;
      checkEnvelope(env, ev, el, envKey);
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

// Artifact-level content hashing contract (Spec 013 §6.1). The hashing path
// is selected from the artifact's own serialized fields — contentFidelity,
// contentType, contentCanonicalizer — never from an enclosing event or
// envelope, so a standalone artifact is self-describing:
//   - byte_faithful bytes are hashed directly (contentHash required when
//     captured; contentCanonicalizer forbidden)
//   - structurally_faithful JSON uses RFC 8785/JCS + UTF-8 (contentHash
//     required when captured; contentCanonicalizer optional pin)
//   - structurally_faithful non-JSON structured content hashes only with a
//     declared contentCanonicalizer { name, version } (required when captured)
//   - structurally_faithful content with no supported canonicalizer declares
//     contentHashUnavailableReason: "unsupported_canonicalizer" and must not
//     carry contentHash
//   - missing/unknown/not_applicable: contentHash, contentFidelity, and
//     contentHashUnavailableReason are all forbidden
function checkArtifact(b, label) {
  if (!STATUSES.has(b.evidenceStatus)) errors.push(`${label}: artifact ${b.artifactId} invalid evidenceStatus ${b.evidenceStatus}`);
  if (!b.payloadRef) errors.push(`${label}: artifact ${b.artifactId} missing payloadRef`);
  // evidenceStatus / contentHash placement (Spec 013 §6.1): top-level only.
  if (b.payloadRef) {
    if (b.payloadRef.evidenceStatus !== undefined) {
      errors.push(`${label}: artifact ${b.artifactId} has evidenceStatus nested inside payloadRef — it must be a top-level artifact field`);
    }
    if (b.payloadRef.contentHash !== undefined) {
      errors.push(`${label}: artifact ${b.artifactId} has contentHash nested inside payloadRef — it must be a top-level artifact field`);
    }
  }

  const retainedExists = ["captured", "redacted", "truncated"].includes(b.evidenceStatus);
  const noRetained = ["missing", "unknown", "not_applicable"].includes(b.evidenceStatus);

  // contentHash representation (Spec 013 §6.1): sha256: + 64 lowercase hex.
  if (b.contentHash !== undefined && !/^sha256:[0-9a-f]{64}$/.test(b.contentHash)) {
    errors.push(`${label}: artifact ${b.artifactId} contentHash '${b.contentHash}' is not 'sha256:' + 64 lowercase hex characters (Spec 013 §6.1)`);
  }

  // contentFidelity: closed vocabulary; required when retained content exists
  // or a hash/unavailability claim is made; forbidden when no retained
  // content exists (fidelity describes retained content, never discarded
  // originals).
  if (b.contentFidelity !== undefined && !ARTIFACT_FIDELITIES.has(b.contentFidelity)) {
    errors.push(`${label}: artifact ${b.artifactId} invalid contentFidelity '${b.contentFidelity}' (valid: ${[...ARTIFACT_FIDELITIES].join(", ")}) (Spec 013 §6.1)`);
  }
  if (noRetained) {
    if (b.contentFidelity !== undefined) {
      errors.push(`${label}: artifact ${b.artifactId} declares contentFidelity ${b.contentFidelity} but evidenceStatus is ${b.evidenceStatus} — fidelity describes retained content, which does not exist here (Spec 013 §6.1)`);
    }
  } else if (b.contentFidelity === undefined) {
    if (b.contentHash !== undefined || b.contentHashUnavailableReason !== undefined) {
      errors.push(`${label}: artifact ${b.artifactId} carries ${b.contentHash !== undefined ? "contentHash" : "contentHashUnavailableReason"} but no contentFidelity — the hashing path cannot be selected (Spec 013 §6.1)`);
    } else {
      errors.push(`${label}: artifact ${b.artifactId} has retained content (evidenceStatus ${b.evidenceStatus}) but no contentFidelity — artifacts must declare the retained representation (Spec 013 §6.1)`);
    }
  }

  // contentType: usable media-type declaration required when retained content
  // exists or a hash/unavailability claim is made.
  if (b.contentType !== undefined && !MEDIA_TYPE_RE.test(b.contentType)) {
    errors.push(`${label}: artifact ${b.artifactId} contentType '${b.contentType}' is not a valid RFC 6838 media type (type/subtype restricted-name syntax, e.g. application/json, application/vnd.example+json; no parameters, whitespace, wildcards, or empty components) (Spec 013 §6.1)`);
  }
  if ((retainedExists || b.contentHash !== undefined || b.contentHashUnavailableReason !== undefined) && b.contentType === undefined) {
    errors.push(`${label}: artifact ${b.artifactId} has retained content / hash claim but no contentType — the hashing path cannot be selected (Spec 013 §6.1)`);
  }

  // contentHashUnavailableReason: closed vocabulary; mutually exclusive with
  // contentHash; impossible when a reproducible hashing path exists.
  if (b.contentHashUnavailableReason !== undefined && !HASH_UNAVAILABLE_REASONS.has(b.contentHashUnavailableReason)) {
    errors.push(`${label}: artifact ${b.artifactId} invalid contentHashUnavailableReason '${b.contentHashUnavailableReason}' (valid: ${[...HASH_UNAVAILABLE_REASONS].join(", ")}) (Spec 013 §6.1)`);
  }
  if (b.contentHash !== undefined && b.contentHashUnavailableReason !== undefined) {
    errors.push(`${label}: artifact ${b.artifactId} carries both contentHash and contentHashUnavailableReason — unavailable hashing and a hash are mutually exclusive (Spec 013 §6.1)`);
  }
  if (noRetained && b.contentHashUnavailableReason !== undefined) {
    errors.push(`${label}: artifact ${b.artifactId} declares contentHashUnavailableReason but evidenceStatus is ${b.evidenceStatus} — no retained content exists to hash (Spec 013 §6.1)`);
  }
  if (b.contentHashUnavailableReason !== undefined &&
      (b.contentFidelity === "byte_faithful" ||
       (b.contentFidelity === "structurally_faithful" &&
        ((b.contentType !== undefined && isJsonContentType(b.contentType)) || b.contentCanonicalizer !== undefined)))) {
    errors.push(`${label}: artifact ${b.artifactId} declares contentHashUnavailableReason but a reproducible hashing path exists (raw bytes hashed directly, JSON via RFC 8785 (JCS), or a declared canonicalizer) (Spec 013 §6.1)`);
  }

  // contentCanonicalizer: { name, version } shape; forbidden for byte_faithful
  // (bytes are hashed directly) and alongside an unavailable-hash reason.
  if (b.contentCanonicalizer !== undefined) {
    if (!b.contentCanonicalizer.name || !b.contentCanonicalizer.version) {
      errors.push(`${label}: artifact ${b.artifactId} contentCanonicalizer must carry { name, version } (Spec 013 §6.1)`);
    }
    if (b.contentFidelity === "byte_faithful") {
      errors.push(`${label}: artifact ${b.artifactId} is byte_faithful but declares contentCanonicalizer — raw retained bytes are hashed directly, a canonicalizer does not apply (Spec 013 §6.1)`);
    }
    if (b.contentHashUnavailableReason !== undefined) {
      errors.push(`${label}: artifact ${b.artifactId} declares contentHashUnavailableReason but also contentCanonicalizer — a declared canonicalizer is a supported deterministic hashing path (Spec 013 §6.1)`);
    }
  }

  // Conditional contentHash selection (Spec 013 §6.1 decision table).
  const jsonType = b.contentType !== undefined && isJsonContentType(b.contentType);
  if (b.contentFidelity === "byte_faithful") {
    if (b.evidenceStatus === "captured" && b.contentHash === undefined) {
      errors.push(`${label}: artifact ${b.artifactId} is captured with byte_faithful retained bytes but has no contentHash — the retained bytes are hashed directly (required, Spec 013 §6.1)`);
    }
  } else if (b.contentFidelity === "structurally_faithful") {
    if (b.contentHash !== undefined && !jsonType && b.contentCanonicalizer === undefined) {
      errors.push(`${label}: artifact ${b.artifactId} is structurally_faithful ${b.contentType ?? "unknown-type"} with contentHash but no contentCanonicalizer — non-JSON structured content hashes only with a declared versioned canonicalizer (Spec 013 §6.1)`);
    }
    if (b.evidenceStatus === "captured" && b.contentHash === undefined && b.contentHashUnavailableReason === undefined) {
      if (jsonType || b.contentCanonicalizer !== undefined) {
        errors.push(`${label}: artifact ${b.artifactId} is captured with a reproducible hashing path (${jsonType ? "JSON via RFC 8785 (JCS)" : `declared canonicalizer ${b.contentCanonicalizer.name}`}) but has no contentHash (required, Spec 013 §6.1)`);
      }
    }
    if (b.contentHash === undefined && b.contentHashUnavailableReason === undefined && b.contentCanonicalizer === undefined && !jsonType && retainedExists) {
      errors.push(`${label}: artifact ${b.artifactId} has structurally_faithful retained ${b.contentType ?? "unknown-type"} content with neither contentHash nor contentHashUnavailableReason — unsupported deterministic hashing must be declared explicitly (Spec 013 §6.1)`);
    }
  }

  // Hash forbidden for unavailable content (Spec 013 §6.1): SignalGlass
  // cannot hash content that does not exist.
  if (noRetained && b.contentHash !== undefined) {
    errors.push(`${label}: artifact ${b.artifactId} has contentHash but evidenceStatus is ${b.evidenceStatus} — SignalGlass cannot hash unavailable content (Spec 013 §6.1)`);
  }

  // Standalone artifacts are self-describing (Spec 013 §6.1): traceId and
  // evidenceSchemaVersion must be explicit, and traceId must resolve.
  if (b.traceId === undefined) {
    errors.push(`${label}: standalone artifact ${b.artifactId} is missing traceId (must serialize it explicitly — validators must not rely on enclosing context)`);
  } else if (!index.traces.has(b.traceId)) {
    errors.push(`${label}: standalone artifact ${b.artifactId} references unknown traceId ${b.traceId}`);
  }
  if (b.evidenceSchemaVersion === undefined) {
    errors.push(`${label}: standalone artifact ${b.artifactId} is missing evidenceSchemaVersion (must serialize it explicitly)`);
  }
  if (b.observedAt !== undefined) errors.push(`${label}: artifact ${b.artifactId} uses 'observedAt', which is not a defined observation field`);
}

// ---- Record references ----
parsed.forEach((b, i) => {
  if (!b || b.interactionId !== undefined) return;
  const label = `[record ${i}]`;
  checkAdminPolicyFields(b, label); // independent pass: runs for artifacts,
                                    // measurements, and interpretations alike
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
    checkArtifact(b, label);
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

// ---- Self-test (--self-test): negative fixtures ----
// Demonstrates that forbidden administrative policy fields are rejected on
// every canonical record type, including standalone measurements and
// interpretations. Runs the same checkAdminPolicyFields used by the real
// pass; fixture errors are discarded so they do not surface as main failures.
function selfTest() {
  const baseline = errors.length;
  const fixtures = [
    ["measurement", { measurementId: "msr-st", kind: "token_count", persistencePolicyVersion: "1.0.0" }],
    ["interpretation", { interpretationId: "int-st", kind: "smell", exportPolicyVersion: "2.0.0" }],
    ["artifact", { artifactId: "art-st", evidenceStatus: "captured", persistencePolicy: "1.0.0" }],
    ["event", { eventId: "evt-st", traceId: "t", spanId: null, seq: 0, kind: "model_request", capturedAt: "2025-01-01T00:00:00.000Z", evidenceStatus: "captured", observationRole: "client_sent", exportPolicyVersion: "1.0.0" }],
    ["trace", { interactionId: "t", traceId: "t", evidenceSchemaVersion: "1.0.0", status: "completed", exportPolicy: "1.0.0", events: [] }],
  ];
  for (const [name, rec] of fixtures) checkAdminPolicyFields(rec, `[self-test ${name}]`);
  const adminRejected = errors.length - baseline;

  // Envelope status/fidelity/hash negative fixtures (Spec 013 §3.2). Each
  // invalid combination must be rejected with a single, coherent error — never
  // simultaneous "required" and "forbidden" messages.
  const envFixtures = [
    ["byte_faithful + captured without nativeContentHash",
      { providerNativeFidelity: "byte_faithful", nativeEncoding: "utf-8", nativeContentType: "application/json" },
      { evidenceStatus: "captured" }],
    ["byte_faithful + missing",
      { providerNativeFidelity: "byte_faithful", nativeEncoding: "utf-8", nativeContentType: "application/json", nativeContentHash: `sha256:${'ab'.repeat(32)}` },
      { evidenceStatus: "missing" }],
    ["byte_faithful + unknown",
      { providerNativeFidelity: "byte_faithful", nativeEncoding: "utf-8", nativeContentType: "application/json", nativeContentHash: `sha256:${'ab'.repeat(32)}` },
      { evidenceStatus: "unknown" }],
    ["byte_faithful + redacted (claims fidelity to discarded originals)",
      { providerNativeFidelity: "byte_faithful", nativeEncoding: "utf-8", nativeContentType: "application/json", nativeContentHash: `sha256:${'ab'.repeat(32)}` },
      { evidenceStatus: "redacted" }],
    ["nativeContentHash where native bytes were not observed",
      { providerNativeFidelity: "structurally_faithful", nativeContentHash: `sha256:${'ab'.repeat(32)}` },
      { evidenceStatus: "missing" }],
    ["incorrectly formatted nativeContentHash",
      { providerNativeFidelity: "byte_faithful", nativeEncoding: "utf-8", nativeContentType: "application/json", nativeContentHash: "sha256:abc123" },
      { evidenceStatus: "captured" }],
  ];
  let envRejected = 0;
  for (const [name, env, ev] of envFixtures) {
    const before = errors.length;
    checkEnvelope(env, ev, "[self-test envelope]", "responseEnvelope");
    if (errors.length > before) envRejected++;
    else console.log(`SELF-TEST FAIL: '${name}' was not rejected`);
  }

  // Positive control: byte_faithful + captured with all required fields is
  // accepted (no error), so the rejections above are not over-strict.
  const posBefore = errors.length;
  checkEnvelope(
    { providerNativeFidelity: "byte_faithful", nativeEncoding: "utf-8", nativeContentType: "application/json", nativeContentHash: `sha256:${'cd'.repeat(32)}` },
    { evidenceStatus: "captured" }, "[self-test envelope]", "responseEnvelope");
  const positiveOK = errors.length === posBefore;
  if (!positiveOK) console.log("SELF-TEST FAIL: valid byte_faithful + captured envelope was rejected");

  // Artifact-level hash-selection fixtures (Spec 013 §6.1). Negative fixtures
  // must each be rejected (proving the new branches fire); positive fixtures
  // must be accepted (proving the rejections are not over-strict). The
  // fixtures exercise the artifact's own serialized fields — contentFidelity,
  // contentType, contentCanonicalizer, contentHashUnavailableReason — with no
  // reliance on an enclosing event or envelope. traceId "t" is registered in
  // the index so the standalone-artifact self-description checks pass.
  index.traces.add("t");
  const artifactNegatives = [
    ["structured JSON missing its required contentHash",
      { artifactId: "art-st-json", kind: "fragment", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "structurally_faithful", contentType: "application/json", payloadRef: { excerpt: "{}" } }],
    ["non-JSON structured content with contentHash but no contentCanonicalizer",
      { artifactId: "art-st-xml", kind: "tool_result", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "structurally_faithful", contentType: "application/xml", contentHash: `sha256:${'ab'.repeat(32)}`, payloadRef: { excerpt: "<x/>" } }],
    ["contentHash without contentFidelity",
      { artifactId: "art-st-nofid", kind: "file", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentType: "text/markdown", contentHash: `sha256:${'ab'.repeat(32)}`, payloadRef: { excerpt: "x" } }],
    ["contentHash without contentType",
      { artifactId: "art-st-noct", kind: "file", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "byte_faithful", contentHash: `sha256:${'ab'.repeat(32)}`, payloadRef: { excerpt: "x" } }],
    ["byte_faithful content with inapplicable contentCanonicalizer",
      { artifactId: "art-st-bfcanon", kind: "file", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "byte_faithful", contentType: "text/markdown", contentCanonicalizer: { name: "rfc8785-jcs", version: "1.0.0" }, contentHash: `sha256:${'ab'.repeat(32)}`, payloadRef: { excerpt: "x" } }],
    ["contentHash combined with contentHashUnavailableReason",
      { artifactId: "art-st-both", kind: "document", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "structurally_faithful", contentType: "text/html", contentHashUnavailableReason: "unsupported_canonicalizer", contentHash: `sha256:${'ab'.repeat(32)}`, payloadRef: { excerpt: "<p>x</p>" } }],
    ["contentHashUnavailableReason where a reproducible path exists (JSON via JCS)",
      { artifactId: "art-st-jsonreason", kind: "fragment", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "structurally_faithful", contentType: "application/json", contentHashUnavailableReason: "unsupported_canonicalizer", payloadRef: { excerpt: "{}" } }],
    ["unsupported contentHashUnavailableReason value",
      { artifactId: "art-st-badreason", kind: "document", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "structurally_faithful", contentType: "text/html", contentHashUnavailableReason: "no_sha256_available", payloadRef: { excerpt: "<p>x</p>" } }],
  ];
  const artifactPositives = [
    ["valid byte_faithful retained bytes with a hash",
      { artifactId: "art-st-bf", kind: "file", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "byte_faithful", contentType: "text/markdown", contentHash: `sha256:${'cd'.repeat(32)}`, payloadRef: { excerpt: "x" } }],
    ["valid structurally_faithful JSON with a hash",
      { artifactId: "art-st-jsonok", kind: "fragment", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "structurally_faithful", contentType: "application/json", contentCanonicalizer: { name: "rfc8785-jcs", version: "1.0.0" }, contentHash: `sha256:${'cd'.repeat(32)}`, payloadRef: { excerpt: "{}" } }],
    ["valid vendor/structured-suffix media type (application/vnd.example+json)",
      { artifactId: "art-st-vendorjson", kind: "fragment", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "structurally_faithful", contentType: "application/vnd.example+json", contentCanonicalizer: { name: "rfc8785-jcs", version: "1.0.0" }, contentHash: `sha256:${'cd'.repeat(32)}`, payloadRef: { excerpt: "{}" } }],
    ["valid non-JSON structured content with a declared canonicalizer",
      { artifactId: "art-st-xmlok", kind: "tool_result", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "structurally_faithful", contentType: "application/xml", contentCanonicalizer: { name: "xml-c14n-1.1", version: "1.0.0" }, contentHash: `sha256:${'cd'.repeat(32)}`, payloadRef: { excerpt: "<x/>" } }],
    ["valid unsupported-canonicalizer unavailability (no contentHash required)",
      { artifactId: "art-st-unavail", kind: "document", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "structurally_faithful", contentType: "text/html", contentHashUnavailableReason: "unsupported_canonicalizer", payloadRef: { excerpt: "<p>x</p>" } }],
  ];
  // contentType domain fixtures (Spec 013 §6.1, RFC 6838 restricted-name
  // syntax). Negatives must each be rejected by the media-type check; the
  // 127-character boundary positives must be accepted.
  const contentTypeNegatives = [
    ["invalid starting characters (@/!)",
      { artifactId: "art-st-ct-at", kind: "file", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "byte_faithful", contentType: "@/!", contentHash: `sha256:${'ab'.repeat(32)}`, payloadRef: { excerpt: "x" } }],
    ["parameterized media type (application/json;charset=utf-8)",
      { artifactId: "art-st-ct-param", kind: "fragment", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "structurally_faithful", contentType: "application/json;charset=utf-8", contentCanonicalizer: { name: "rfc8785-jcs", version: "1.0.0" }, contentHash: `sha256:${'ab'.repeat(32)}`, payloadRef: { excerpt: "{}" } }],
    ["missing subtype (application/)",
      { artifactId: "art-st-ct-nosub", kind: "file", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "byte_faithful", contentType: "application/", contentHash: `sha256:${'ab'.repeat(32)}`, payloadRef: { excerpt: "x" } }],
    ["missing type (/json)",
      { artifactId: "art-st-ct-notype", kind: "file", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "byte_faithful", contentType: "/json", contentHash: `sha256:${'ab'.repeat(32)}`, payloadRef: { excerpt: "x" } }],
    ["extra slash (application/example/json)",
      { artifactId: "art-st-ct-slash", kind: "file", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "byte_faithful", contentType: "application/example/json", contentHash: `sha256:${'ab'.repeat(32)}`, payloadRef: { excerpt: "x" } }],
    ["whitespace (application /json)",
      { artifactId: "art-st-ct-ws", kind: "file", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "byte_faithful", contentType: "application /json", contentHash: `sha256:${'ab'.repeat(32)}`, payloadRef: { excerpt: "x" } }],
    ["wildcard (application/*)",
      { artifactId: "art-st-ct-star", kind: "file", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "byte_faithful", contentType: "application/*", contentHash: `sha256:${'ab'.repeat(32)}`, payloadRef: { excerpt: "x" } }],
    ["type exceeding 127 characters",
      { artifactId: "art-st-ct-longtype", kind: "file", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "byte_faithful", contentType: `${'a'.repeat(128)}/json`, contentHash: `sha256:${'ab'.repeat(32)}`, payloadRef: { excerpt: "x" } }],
    ["subtype exceeding 127 characters",
      { artifactId: "art-st-ct-longsub", kind: "file", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "byte_faithful", contentType: `application/${'b'.repeat(128)}`, contentHash: `sha256:${'ab'.repeat(32)}`, payloadRef: { excerpt: "x" } }],
  ];
  const contentTypePositives = [
    ["127-character type boundary",
      { artifactId: "art-st-ct-bndtype", kind: "file", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "byte_faithful", contentType: `${'a'.repeat(127)}/json`, contentHash: `sha256:${'cd'.repeat(32)}`, payloadRef: { excerpt: "x" } }],
    ["127-character subtype boundary",
      { artifactId: "art-st-ct-bndsub", kind: "file", evidenceStatus: "captured", traceId: "t", evidenceSchemaVersion: "1.0.0", contentFidelity: "byte_faithful", contentType: `application/${'b'.repeat(127)}`, contentHash: `sha256:${'cd'.repeat(32)}`, payloadRef: { excerpt: "x" } }],
  ];
  let artRejected = 0;
  for (const [name, art] of artifactNegatives) {
    const before = errors.length;
    checkArtifact(art, "[self-test artifact]");
    if (errors.length > before) artRejected++;
    else console.log(`SELF-TEST FAIL: '${name}' was not rejected`);
  }
  let artAccepted = 0;
  for (const [name, art] of artifactPositives) {
    const before = errors.length;
    checkArtifact(art, "[self-test artifact]");
    if (errors.length === before) artAccepted++;
    else console.log(`SELF-TEST FAIL: '${name}' was rejected: ${errors.slice(before).join("; ")}`);
  }
  let ctRejected = 0;
  for (const [name, art] of contentTypeNegatives) {
    const before = errors.length;
    checkArtifact(art, "[self-test artifact]");
    if (errors.length > before) ctRejected++;
    else console.log(`SELF-TEST FAIL: '${name}' was not rejected`);
  }
  let ctAccepted = 0;
  for (const [name, art] of contentTypePositives) {
    const before = errors.length;
    checkArtifact(art, "[self-test artifact]");
    if (errors.length === before) ctAccepted++;
    else console.log(`SELF-TEST FAIL: '${name}' was rejected: ${errors.slice(before).join("; ")}`);
  }

  errors.length = baseline;
  console.log(`Self-test: admin-policy ${adminRejected}/${fixtures.length} rejected; envelope status/fidelity ${envRejected}/${envFixtures.length} rejected; artifact hash-selection ${artRejected}/${artifactNegatives.length} rejected, ${artAccepted}/${artifactPositives.length} positive controls accepted; contentType domain ${ctRejected}/${contentTypeNegatives.length} rejected, ${ctAccepted}/${contentTypePositives.length} boundary positives accepted; positive byte_faithful control ${positiveOK ? "accepted" : "FAILED"}.`);
  return adminRejected === fixtures.length && envRejected === envFixtures.length && artRejected === artifactNegatives.length && artAccepted === artifactPositives.length && ctRejected === contentTypeNegatives.length && ctAccepted === contentTypePositives.length && positiveOK;
}

console.log(`\nValidated ${rawBlocks.length} JSON blocks in docs/evidence-model.md (${traces.length} traces) and ${extra} JSON block(s) in capture-profiles/model-versioning docs.\n`);
if (process.argv.includes("--self-test") && !selfTest()) {
  console.log("Self-test failed: at least one forbidden administrative policy field was not rejected.");
  process.exit(1);
}
if (errors.length) {
  console.log(`ERRORS (${errors.length}):`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log("All semantic checks passed.");
