import type { TimetableReport } from "@/lib/report-timetable";

/**
 * The hall × day grid, turned on its side: one entry per class, grouped by day.
 *
 * The grid answers "what runs in this room"; a phone needs "what is on today".
 * Both come from the SAME `TimetableReport` — the per-date hall resolver's
 * output — so a class moved for one day shows its temporary hall here exactly
 * as the grid does. Nothing is recomputed; this only regroups and sorts.
 *
 * Pure (type-only imports) so it can be tested without a database.
 */
export type AgendaEntry = {
  key: string;
  course: string;
  teacher: string;
  /** "HH:mm", 24-hour, as stored. */
  startTime: string;
  endTime: string;
  hall: { id: number; name: string; icon: string } | null;
  /** A one-off extra class, as opposed to the recurring weekly timetable. */
  additional: boolean;
  /** Its hall today comes from a one-day reassignment, not its own default. */
  overridden: boolean;
};

export type AgendaDay = {
  date: string;
  label: string;
  entries: AgendaEntry[];
};

export function agendaFor(report: TimetableReport): AgendaDay[] {
  const rows = [...report.rows, ...(report.unassigned ? [report.unassigned] : [])];

  return report.days.map((day, index) => {
    const entries: AgendaEntry[] = [];
    for (const row of rows) {
      for (const c of row.cells[index] ?? []) {
        entries.push({
          key: c.key,
          course: c.course,
          teacher: c.teacher,
          startTime: c.startTime,
          endTime: c.endTime,
          hall: c.hall,
          additional: c.kind === "ADDITIONAL",
          overridden: c.overridden,
        });
      }
    }
    // Zero-padded 24-hour strings sort correctly as text; ties by course name.
    entries.sort(
      (a, b) =>
        a.startTime.localeCompare(b.startTime) ||
        a.endTime.localeCompare(b.endTime) ||
        a.course.localeCompare(b.course),
    );
    return { date: day.date, label: day.label, entries };
  });
}
