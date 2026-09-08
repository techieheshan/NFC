import "server-only";

import { colomboDateValue, colomboNow } from "@/lib/colombo-time";
import { classesForDate, type AllocatedClass, type HallRef } from "@/lib/halls";

/**
 * The room-centric view of the week: for each hall, what runs in it each day.
 *
 * Every cell comes from `classesForDate`, the same resolver the allocation grid
 * and the class-schedule column read, so a one-day reassignment shows up here
 * on that day and nowhere else. That is also why this report is built over a
 * WEEK OF DATES rather than over weekdays in the abstract — an override belongs
 * to a date, and a timetable that ignored them would be a different timetable
 * from the one staff are working to.
 */

export type TimetableDay = { date: string; day: string; label: string };

export type TimetableRow = {
  hall: HallRef | null;
  /** One list per day, in the same order as `days`. */
  cells: AllocatedClass[][];
  total: number;
};

export type TimetableReport = {
  from: string;
  to: string;
  days: TimetableDay[];
  rows: TimetableRow[];
  /** Classes with no hall at all, kept visible instead of quietly dropped. */
  unassigned: TimetableRow | null;
  total: number;
};

const DAY_LABEL: Record<string, string> = {
  SUN: "Sunday", MON: "Monday", TUE: "Tuesday", WED: "Wednesday",
  THU: "Thursday", FRI: "Friday", SAT: "Saturday",
};

/** The Sunday-to-Saturday week containing `date`, as Colombo calendar days. */
export function weekOf(date: string): TimetableDay[] {
  const start = colomboDateValue(date);
  // getUTCDay is safe here: colomboDateValue pins the calendar day at UTC midnight.
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const day = colomboNow(colomboDateValue(iso)).dayOfWeek;
    return { date: iso, day, label: DAY_LABEL[day] };
  });
}

export function currentColomboDate(): string {
  return colomboNow().date;
}

export async function buildTimetable(
  anchorDate: string,
  filters: { teacherId?: number } = {},
): Promise<TimetableReport> {
  const days = weekOf(anchorDate);

  // One resolver call per day — deliberately not a second query of its own.
  const perDay = await Promise.all(days.map((d) => classesForDate(d.date)));

  const byHall = new Map<number, { hall: HallRef; cells: AllocatedClass[][] }>();
  const none: AllocatedClass[][] = days.map(() => []);
  let total = 0;

  perDay.forEach((classes, index) => {
    for (const c of classes) {
      if (filters.teacherId !== undefined && c.teacherId !== filters.teacherId) continue;
      total++;
      if (!c.hall) {
        none[index].push(c);
        continue;
      }
      const entry =
        byHall.get(c.hall.id) ?? { hall: c.hall, cells: days.map(() => [] as AllocatedClass[]) };
      entry.cells[index].push(c);
      byHall.set(c.hall.id, entry);
    }
  });

  const rows: TimetableRow[] = [...byHall.values()]
    .map((e) => ({
      hall: e.hall,
      cells: e.cells,
      total: e.cells.reduce((s, list) => s + list.length, 0),
    }))
    .sort((a, b) => a.hall!.name.localeCompare(b.hall!.name));

  const unassignedTotal = none.reduce((s, list) => s + list.length, 0);

  return {
    from: days[0].date,
    to: days[6].date,
    days,
    rows,
    unassigned: unassignedTotal > 0 ? { hall: null, cells: none, total: unassignedTotal } : null,
    total,
  };
}
