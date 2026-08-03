/**
 * Time helpers (Spec 014 §2.2.12, §4.2). Timestamps are ISO 8601 UTC with
 * millisecond precision — always a 3-digit fractional second and the `Z`
 * suffix. Internal-only.
 */

const TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;

/**
 * Strict ISO 8601 UTC millisecond-precision timestamp check. Rejects
 * out-of-range dates, non-UTC offsets, and any fractional precision other
 * than exactly three digits.
 */
export function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = TIMESTAMP_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  // Validate the calendar date without rollover (e.g. 2025-02-30).
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day &&
    d.getUTCHours() === hour &&
    d.getUTCMinutes() === minute &&
    d.getUTCSeconds() === second
  );
}