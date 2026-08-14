/** Closed classification of magnitude-only evidence-budget validation issues.
 *
 * These codes report that an otherwise structurally valid record exceeds a
 * declared evidence budget. Spec 016 S4 preview measurement may ignore only
 * this class while constructing and measuring a hypothetical record; ordinary
 * parsing and persistence serialization remain strict.
 */
import type { ValidationIssue } from './types-analysis.js';

export const EVIDENCE_BUDGET_VALIDATION_CODES = [
  'canonical_event_budget_exceeded',
  'raw_observation_budget_exceeded',
  'raw_payload_budget_exceeded',
  'retained_content_budget_exceeded',
  'serialized_evidence_budget_exceeded',
  'evidence_id_budget_exceeded',
] as const;

const EVIDENCE_BUDGET_VALIDATION_CODE_SET: ReadonlySet<string> =
  new Set(EVIDENCE_BUDGET_VALIDATION_CODES);

export function isEvidenceBudgetValidationIssue(issueValue: ValidationIssue): boolean {
  return EVIDENCE_BUDGET_VALIDATION_CODE_SET.has(issueValue.code);
}
