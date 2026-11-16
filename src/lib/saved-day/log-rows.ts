import { to12Hour, colomboNow } from "@/lib/colombo-time";
import { friendlyDate } from "@/lib/friendly-date";

import { describeChange } from "./changes";
import type { LogEntry } from "./store";

/**
 * The change log of a saved day as rows of words, for the screen (newest first) and for the A4 document (oldest first).
 *
 * One row per version (who did it, when, what changed: its stored items through `describeChange`), and one extra row for every check
 * that was actually RECORDED ("Checked by X, recorded by Y"). A check that a later edit merely carried over is not a new event: the
 * edit's own "check kept" line already says so.
 */

export type LogRow = { version: number; whenIso: string; when: string; by: string; what: string };

/** "14 Oct 2026, 4:32 PM" in Colombo time, from an instant. */
export function formatWhen(iso: string): string {
  const now = colomboNow(new Date(iso));
  return `${friendlyDate(now.date)}, ${to12Hour(now.time)}`;
}

/** Just the clock time, "4:32 PM". */
export function formatClock(iso: string): string {
  return to12Hour(colomboNow(new Date(iso)).time);
}

export function changeLogRows(log: readonly LogEntry[]): LogRow[] {
  const rows: LogRow[] = [];
  for (const v of log) {
    rows.push({ version: v.version, whenIso: v.savedAt, when: formatWhen(v.savedAt), by: v.doneByName, what: v.items.map(describeChange).join("; ") });
    if (v.check && v.check.carriedFromVersion === null) {
      rows.push({
        version: v.version,
        whenIso: v.check.checkedAt,
        when: formatWhen(v.check.checkedAt),
        by: v.check.markedByName,
        what: `Checked by ${v.check.checkedByName}, recorded by ${v.check.markedByName}`,
      });
    }
  }
  // a stable order by time (a version and its own check keep their order when they share a second)
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.whenIso < b.r.whenIso ? -1 : a.r.whenIso > b.r.whenIso ? 1 : a.i - b.i))
    .map((x) => x.r);
}

export const changeLogNewestFirst = (log: readonly LogEntry[]): LogRow[] => changeLogRows(log).reverse();
