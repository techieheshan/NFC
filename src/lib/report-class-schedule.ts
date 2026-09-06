import "server-only";

import type { UserRole } from "@prisma/client";

import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { courseScopeFor } from "@/lib/reports";
import { DAYS, DAY_LABEL, attendanceWindow, formatTime } from "@/lib/schedule-time";

/**
 * The weekly class schedule, grouped by day.
 *
 * Only ACTIVE schedules: a deactivated one is not a class anyone should turn up
 * to. A TEACHER is narrowed to their own courses through `courseScopeFor`, the
 * same helper the roster and the student list use, so their view of the
 * timetable cannot disagree with their view of anything else.
 */

export type ScheduleEntry = {
  id: number;
  courseId: number;
  course: string;
  teacher: string;
  startTime: string;
  endTime: string;
  /** When attendance opens and closes for this slot, for the counter's benefit. */
  opens: string;
  closes: string;
};

export type ScheduleDay = { day: string; label: string; entries: ScheduleEntry[] };

export type ScheduleReport = {
  days: ScheduleDay[];
  total: number;
  /** True when a TEACHER login has no Teacher row — nothing is shown. */
  blocked: boolean;
  scopedToTeacher: number | null;
};

export async function buildClassSchedule(
  user: { id: string; role: UserRole },
  filters: { teacherId?: number; day?: string } = {},
): Promise<ScheduleReport> {
  const scope = await courseScopeFor(user);
  if (scope === null) {
    return { days: [], total: 0, blocked: true, scopedToTeacher: null };
  }
  const teacherScoped = "teacherId" in scope ? scope.teacherId : null;

  // Validate the day ONCE: a junk value must be ignored by the query and by the
  // grouping alike, or ?day=MONDAY silently renders an empty week.
  const day = filters.day && DAYS.includes(filters.day as never) ? (filters.day as (typeof DAYS)[number]) : undefined;

  const rows = await db.schedule.findMany({
    where: {
      active: true,
      ...(day ? { dayOfWeek: day } : {}),
      course: {
        active: true,
        // The teacher's own scope goes last so a filter can only narrow it.
        ...(filters.teacherId && teacherScoped === null ? { teacherId: filters.teacherId } : {}),
        ...scope,
      },
    },
    select: {
      id: true, courseId: true, dayOfWeek: true, startTime: true, endTime: true,
      attendanceOpensBeforeMin: true, attendanceClosesBeforeMin: true,
      course: {
        select: {
          name: true,
          grade: { select: { label: true } },
          subject: { select: { label: true } },
          classType: { select: { label: true } },
          teacher: { select: { name: true } },
        },
      },
    },
  });

  const byDay = new Map<string, ScheduleEntry[]>();
  for (const r of rows) {
    const w = attendanceWindow(r);
    const list = byDay.get(r.dayOfWeek) ?? [];
    list.push({
      id: r.id,
      courseId: r.courseId,
      course: courseDisplayName(r.course),
      teacher: r.course.teacher.name,
      startTime: r.startTime,
      endTime: r.endTime,
      opens: w.opens,
      closes: w.closes,
    });
    byDay.set(r.dayOfWeek, list);
  }

  const days: ScheduleDay[] = DAYS.filter((d) => !day || d === day).map((d) => ({
    day: d,
    label: DAY_LABEL[d],
    // Chronological within the day — the order staff actually read it in.
    entries: (byDay.get(d) ?? []).sort(
      (a, b) => a.startTime.localeCompare(b.startTime) || a.course.localeCompare(b.course),
    ),
  }));

  return { days, total: rows.length, blocked: false, scopedToTeacher: teacherScoped };
}

export { formatTime };
