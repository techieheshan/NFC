/**
 * Dates for the Daily Summary, as plain "YYYY-MM-DD" strings (no `Date` parts, so no timezone moves the
 * day — rule 15). Used by the day screen, the range screen, the document and the server action.
 *
 * Before this, `isDate` was only a regex: "2026-13-45" and "0001-01-01…9999-12-31" passed it and crashed
 * the page. A date now has to be a REAL calendar day in 2000..2100; anything else falls back to today.
 */

export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;
/** A range longer than this is cut to this many days (the screens say so). */
export const MAX_RANGE_DAYS = 366;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The same day back if it is a real calendar date in 2000..2100, else null. Never throws. */
export function parseRealDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < MIN_YEAR || y > MAX_YEAR || mo < 1 || mo > 12 || d < 1) return null;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= daysInMonth ? value : null;
}

/** The calendar day `delta` days from `date` (a real date, already validated). */
export function shiftDay(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a), both real dates. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86_400_000);
}

/** A real date in range, else `today`. */
export const dateOrToday = (value: unknown, today: string) => parseRealDate(value) ?? today;

/** A single day: invalid → today, and never later than today (there is nothing to sum yet). */
export function resolveDay(value: unknown, today: string): string {
  const d = dateOrToday(value, today);
  return d > today ? today : d;
}

/** Two dates → an ordered, bounded range. Invalid ends fall back to today; reversed ends are swapped. */
export function resolveRange(from: unknown, to: unknown, today: string): { from: string; to: string; clamped: boolean } {
  const a = dateOrToday(from, today);
  const b = dateOrToday(to, today);
  const lo = a <= b ? a : b;
  const hi = a <= b ? b : a;
  const last = shiftDay(lo, MAX_RANGE_DAYS - 1);
  return hi > last ? { from: lo, to: last, clamped: true } : { from: lo, to: hi, clamped: false };
}

const weekdayOf = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();

/** "2026-10-14" → "Wed 14 Oct 2026". */
export function dayLabelShort(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${WEEKDAYS[weekdayOf(date)].slice(0, 3)} ${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
}

/** "2026-10-14" → "Wednesday, 14 October 2026". */
export function dayLabelLong(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${WEEKDAYS[weekdayOf(date)]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

/** "2026-10-14" → "DS-20261014"; a range → "DS-20261012-20261014". */
export function documentNumber(from: string, to: string): string {
  const c = (s: string) => s.replace(/-/g, "");
  return from === to ? `DS-${c(from)}` : `DS-${c(from)}-${c(to)}`;
}
