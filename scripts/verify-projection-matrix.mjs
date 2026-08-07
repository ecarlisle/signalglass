#!/usr/bin/env node
/**
 * Durable Markdown ↔ executable matrix alignment check (Spec 014 slice 4).
 *
 * Verifies that `docs/evidence-projection-matrix.md` mirrors the executable
 * claim table in
 * `packages/core/src/evidenceProjections/projectionMappingMatrix.ts`:
 *
 * - identical claim IDs in the same order;
 * - identical classifications per claim;
 * - identical reasons per claim (each doc reason cell is the executable
 *   reason with cosmetic backticks stripped and escaped pipes unescaped).
 *
 * This is the committed, narrow replacement for the old uncommitted
 * comparison script: no generator and no conformance framework — the matrix
 * claims are data, and this script keeps the human-facing table honest.
 *
 * Usage: node scripts/verify-projection-matrix.mjs
 * Exits 0 when aligned, 1 (with a per-claim report) when not.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_PATH = join(ROOT, 'docs', 'evidence-projection-matrix.md');
const TS_PATH = join(
  ROOT,
  'packages',
  'core',
  'src',
  'evidenceProjections',
  'projectionMappingMatrix.ts',
);

/** Normalization applied to both sides: strip backticks, unescape pipes. */
const normalize = (value) => value.replace(/`/g, '').replace(/\\\|/g, '|');

/** Parse one executable claim block; null when the block is not a claim. */
function parseExecutableClaim(block) {
  const idMatch = /^'(E2L-\d{3})'/.exec(block);
  const classificationMatch = /classification:\s*'([a-z]+)'/.exec(block);
  const reasonMatch = /reason:\s*'([^']*)'/.exec(block);
  if (idMatch == null || classificationMatch == null || reasonMatch == null) return null;
  return {
    id: idMatch[1],
    classification: classificationMatch[1],
    reason: reasonMatch[1],
  };
}

/** Parse the executable claims: id → { classification, reason }. */
function parseExecutable() {
  const source = readFileSync(TS_PATH, 'utf8');
  const claims = new Map();
  for (const block of source.split(/\n\s*\{\n\s*id: /).slice(1)) {
    const claim = parseExecutableClaim(block);
    if (claim != null) claims.set(claim.id, claim);
  }
  return claims;
}

/** Parse one doc row; null when the line is not a claim row. */
function parseDocRow(line) {
  const idMatch = /^\|\s*(E2L-\d{3})\s*\|/.exec(line);
  if (idMatch == null) return null;
  const cells = line.split(/(?<!\\)\|/).map((cell) => cell.trim());
  // Five-column rows: ['', Claim, Legacy target, Classification, Reason,
  // Verified by, '']; the kind table adds a Kind column after Claim, so the
  // classification/reason indices shift by one.
  const kindRow = cells.length >= 8;
  return {
    id: idMatch[1],
    classification: cells[kindRow ? 4 : 3],
    reason: normalize(cells[kindRow ? 5 : 4]),
  };
}

/** Parse the doc claim rows: id → { classification, reason }. */
function parseDocument() {
  const doc = readFileSync(DOC_PATH, 'utf8');
  const rows = new Map();
  for (const line of doc.split('\n')) {
    const row = parseDocRow(line);
    if (row != null) rows.set(row.id, row);
  }
  return rows;
}

/** Mismatches for one claim row; empty when the row is fully aligned. */
function diffRow(id, claim, row) {
  if (row == null) return [`${id}: missing from the doc table`];
  const problems = [];
  if (row.classification !== claim.classification) {
    problems.push(
      `${id}: classification differs (doc "${row.classification}", executable "${claim.classification}")`,
    );
  }
  if (row.reason !== claim.reason) {
    problems.push(`${id}: reason differs\n  doc:  ${row.reason}\n  exec: ${claim.reason}`);
  }
  return problems;
}

/** Collect every misalignment as a human-readable problem string. */
function collectProblems(executable, doc) {
  const problems = [];
  const docIds = [...doc.keys()];
  const execIds = [...executable.keys()];
  if (JSON.stringify(docIds) !== JSON.stringify(execIds)) {
    problems.push(
      `claim ID order differs (doc ${docIds.length} rows, executable ${execIds.length} claims)`,
    );
  }
  for (const [id, claim] of executable) {
    problems.push(...diffRow(id, claim, doc.get(id)));
  }
  return problems;
}

const executable = parseExecutable();
const problems = collectProblems(executable, parseDocument());
if (problems.length > 0) {
  console.error(
    `projection matrix doc/executable alignment failed (${problems.length} problem(s)):`,
  );
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(
  `projection matrix aligned: ${executable.size} claims — identical IDs, order, classifications, and reasons (${DOC_PATH})`,
);
