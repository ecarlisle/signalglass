/**
 * Compatibility projections (Spec 014 §6; Spec 013 §11.2).
 *
 * Three required directions, implemented beside the legacy types:
 * 1. canonical `EvidenceRecord` → legacy `Trace`/`TraceEvent` view;
 * 2. legacy `Trace`/`TraceEvent` → legacy `AgentRun` view;
 * 3. canonical `EvidenceRecord` → legacy `AgentRun` view (explicit
 *    composition of (1) then (2)).
 *
 * Projections are pure, deterministic, versioned, and create ephemeral
 * non-authoritative views with explicit loss reports. They import only the
 * public `@signalglass/evidence` surface — never its internals.
 */
export * from './types.js';
export * from './eventMapping.js';
export * from './evidenceToLegacyTrace.js';
export * from './legacyTraceToAgentRun.js';
export * from './evidenceToAgentRun.js';
