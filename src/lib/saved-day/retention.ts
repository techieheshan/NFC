import { parseRealDate } from "@/lib/daily-summary-dates";

/**
 * Saved days are kept for 3 months after the DATE of the day, then deleted (lazily: after a save and when History opens).
 *
 * `cutoff` is the same day of the month three calendar months before today (Colombo), clamped to that month's last day:
 * 2 Nov 2026 -> 2 Aug 2026; 31 Dec -> 30 Sep; 31 May -> 28 Feb. A day is deleted when its date is EARLIER than the cutoff, so a day is
 * kept through its date + 3 months and goes the day after.
 */

export const RETENTION_MONTHS = 3;

export function retentionCutoff(today: string): string {
  const real = parseRealDate(today);
  if (real === null) throw new RangeError(`not a real date: ${String(today)}`);
  const [y, m, d] = real.split("-").map(Number);
  const index = y * 12 + (m - 1) - RETENTION_MONTHS;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, last);
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** True when a saved day with this date must be deleted today. */
export const isExpired = (date: string, today: string): boolean => date < retentionCutoff(today);
