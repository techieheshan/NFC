import { daysBetween, shiftDay } from "@/lib/daily-summary-dates";

/**
 * The bring-forward hint: "Yesterday closed with X. Use this". It is the Left in drawer of the newest SAVED day before this one, no
 * older than 7 days (so a weekend or a holiday does not hide it), with that day's date named. It is only a hint: nothing here fills
 * the field.
 */

export const HINT_DAYS = 7;

export type HintCandidate = { date: string; leftCents: number; checked: boolean };
export type Hint = HintCandidate & { daysAgo: number };

/** The dates worth looking up: the 7 days before `forDate`. */
export function hintWindow(forDate: string): { from: string; to: string } {
  return { from: shiftDay(forDate, -HINT_DAYS), to: shiftDay(forDate, -1) };
}

export function chooseHint(forDate: string, candidates: readonly HintCandidate[]): Hint | null {
  const { from, to } = hintWindow(forDate);
  const inWindow = candidates.filter((c) => c.date >= from && c.date <= to).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const best = inWindow[0];
  return best ? { ...best, daysAgo: daysBetween(best.date, forDate) } : null;
}
