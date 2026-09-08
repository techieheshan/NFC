import "server-only";

import type { DayOfWeek } from "@prisma/client";

import { colomboDateValue, colomboNow } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { formatTime } from "@/lib/schedule-time";

/**
 * Where a class meets on a given day — the ONLY answer to that question.
 *
 * The rule is one line: an override for this class on this date, else the
 * class's own default hall, else unassigned. Every screen and report reads it
 * from here, so "today's allocation", the timetable and the class-schedule
 * column can never disagree, and a reassignment never has to be copied into a
 * second place.
 *
 * A reassignment writes an override row and NOTHING else: `Schedule.defaultHallId`
 * is left exactly as it was, which is what makes it a one-day change rather
 * than an edit to the timetable.
 */

export type HallRef = { id: number; name: string; icon: string };

export type AllocatedClass = {
  /** Stable across the two kinds of class, for React keys and form fields. */
  key: string;
  kind: "SCHEDULE" | "ADDITIONAL";
  id: number;
  courseId: number;
  course: string;
  teacher: string;
  teacherId: number;
  startTime: string;
  endTime: string;
  /** Where it meets on the date asked about. */
  hall: HallRef | null;
  /** The class's own default, shown so staff can see what they are overriding. */
  defaultHall: HallRef | null;
  /** True when today's hall comes from an override rather than the default. */
  overridden: boolean;
};

const hallSelect = { id: true, name: true, icon: true } as const;

/** Today in Colombo, as the app means it everywhere else. */
export function colomboToday(): { date: string; dayOfWeek: DayOfWeek } {
  const now = colomboNow();
  return { date: now.date, dayOfWeek: now.dayOfWeek };
}

/**
 * Every class meeting on `date` (a Colombo YYYY-MM-DD), with its resolved hall.
 *
 * Recurring classes are matched on the weekday of that date, one-off classes on
 * the date itself — the same two sources the counter's matcher uses.
 */
export async function classesForDate(date: string): Promise<AllocatedClass[]> {
  const day = colomboNow(colomboDateValue(date)).dayOfWeek;
  const dateValue = colomboDateValue(date);

  const courseSelect = {
    select: {
      id: true,
      name: true,
      grade: { select: { label: true } },
      subject: { select: { label: true } },
      classType: { select: { label: true } },
      teacher: { select: { id: true, name: true } },
    },
  } as const;

  const [schedules, additional, overrides] = await Promise.all([
    db.schedule.findMany({
      where: { active: true, dayOfWeek: day, course: { active: true } },
      select: {
        id: true, startTime: true, endTime: true, courseId: true,
        defaultHall: { select: hallSelect },
        course: courseSelect,
      },
    }),
    db.additionalClass.findMany({
      where: { date: dateValue, course: { active: true } },
      select: {
        id: true, startTime: true, endTime: true, courseId: true,
        hall: { select: hallSelect },
        course: courseSelect,
      },
    }),
    db.hallAllocationOverride.findMany({
      where: { date: dateValue },
      select: { scheduleId: true, additionalClassId: true, hall: { select: hallSelect } },
    }),
  ]);

  const bySchedule = new Map(
    overrides.filter((o) => o.scheduleId !== null).map((o) => [o.scheduleId!, o.hall]),
  );
  const byAdditional = new Map(
    overrides.filter((o) => o.additionalClassId !== null).map((o) => [o.additionalClassId!, o.hall]),
  );

  const rows: AllocatedClass[] = [
    ...schedules.map((s) => {
      const override = bySchedule.get(s.id) ?? null;
      return {
        key: `SCHEDULE:${s.id}`,
        kind: "SCHEDULE" as const,
        id: s.id,
        courseId: s.courseId,
        course: courseDisplayName(s.course),
        teacher: s.course.teacher.name,
        teacherId: s.course.teacher.id,
        startTime: s.startTime,
        endTime: s.endTime,
        hall: override ?? s.defaultHall,
        defaultHall: s.defaultHall,
        overridden: override !== null,
      };
    }),
    ...additional.map((a) => {
      const override = byAdditional.get(a.id) ?? null;
      return {
        key: `ADDITIONAL:${a.id}`,
        kind: "ADDITIONAL" as const,
        id: a.id,
        courseId: a.courseId,
        course: courseDisplayName(a.course),
        teacher: a.course.teacher.name,
        teacherId: a.course.teacher.id,
        startTime: a.startTime,
        endTime: a.endTime,
        hall: override ?? a.hall,
        defaultHall: a.hall,
        overridden: override !== null,
      };
    }),
  ];

  return rows.sort(
    (a, b) => a.startTime.localeCompare(b.startTime) || a.course.localeCompare(b.course),
  );
}

/** The resolved hall for ONE class on one date, through the same rule. */
export async function hallForClassOnDate(
  klass: { kind: "SCHEDULE" | "ADDITIONAL"; id: number },
  date: string,
): Promise<HallRef | null> {
  const dateValue = colomboDateValue(date);
  const override = await db.hallAllocationOverride.findFirst({
    where:
      klass.kind === "SCHEDULE"
        ? { date: dateValue, scheduleId: klass.id }
        : { date: dateValue, additionalClassId: klass.id },
    select: { hall: { select: hallSelect } },
  });
  if (override) return override.hall;

  if (klass.kind === "SCHEDULE") {
    const s = await db.schedule.findUnique({
      where: { id: klass.id },
      select: { defaultHall: { select: hallSelect } },
    });
    return s?.defaultHall ?? null;
  }
  const a = await db.additionalClass.findUnique({
    where: { id: klass.id },
    select: { hall: { select: hallSelect } },
  });
  return a?.hall ?? null;
}

/** Two classes clash when they share a hall and their times overlap at all. */
export function overlaps(a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }): boolean {
  return a.startTime < b.endTime && b.startTime < a.endTime;
}

/**
 * Who else is already in this hall at this time on this date.
 *
 * Deliberately a WARNING and not a rule: two classes really do share a room
 * sometimes, and a system that refuses the save just gets worked around. The
 * caller shows the clash and saves anyway.
 */
export function clashesFor(
  target: { key: string; startTime: string; endTime: string },
  hallId: number,
  classes: AllocatedClass[],
): AllocatedClass[] {
  return classes.filter(
    (c) => c.key !== target.key && c.hall?.id === hallId && overlaps(c, target),
  );
}

export function timeRange(c: { startTime: string; endTime: string }): string {
  return `${formatTime(c.startTime)}–${formatTime(c.endTime)}`;
}

export function listHalls(activeOnly = true) {
  return db.hall.findMany({
    where: activeOnly ? { active: true } : {},
    select: { ...hallSelect, active: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}
