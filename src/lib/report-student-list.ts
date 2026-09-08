import "server-only";

import type { UserRole } from "@prisma/client";

import { colomboNow } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { courseScopeFor } from "@/lib/reports";
import { paidStudentsForCourseMonth } from "@/lib/student-arrears";

/**
 * The teacher-facing student list: for one course and one month, who has paid.
 *
 * Read-only. "Paid" is decided by `paidStudentsForCourseMonth`, the same
 * billing-month check the arrears colour uses — a July-stamped payment counts
 * for July however late the cash arrived, and this report can never disagree
 * with the badge on the counter.
 *
 * Scope comes from `courseScopeFor`, resolved from `User.teacherId` in the
 * database. A TEACHER cannot widen it by asking for someone else's course:
 * their clause is applied last, so a forged courseId simply matches nothing.
 */

export type StudentListRow = {
  studentId: number;
  name: string;
  cardNumber: string | null;
  /** Which course this row is about — the same student can appear per course. */
  courseId: number;
  course: string;
  status: "paid" | "not-paid" | "free";
};

export type StudentListReport = {
  /** The single course asked for; null when the report covers several. */
  course: { id: number; name: string; teacher: string } | null;
  /** What the report is actually showing — one course, or the whole scope. */
  heading: string | null;
  /** True when "all courses" was asked for, so the screen shows a course column. */
  allCourses: boolean;
  year: number;
  month: number;
  label: string;
  rows: StudentListRow[];
  totals: { registered: number; paid: number; notPaid: number; free: number; reconciles: boolean };
  /** True when a TEACHER login has no Teacher row — fails closed, shows nothing. */
  blocked: boolean;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Courses this viewer may report on, already narrowed to their own if a teacher. */
export async function reportableCourses(user: { id: string; role: UserRole }, teacherId?: number) {
  const scope = await courseScopeFor(user);
  if (scope === null) return { courses: [], blocked: true as const };

  const teacherScoped = "teacherId" in scope ? scope.teacherId : null;
  const courses = await db.course.findMany({
    where: {
      active: true,
      ...(teacherId && teacherScoped === null ? { teacherId } : {}),
      ...scope,
    },
    select: {
      id: true, name: true,
      grade: { select: { label: true } },
      subject: { select: { label: true } },
      classType: { select: { label: true } },
      teacher: { select: { id: true, name: true } },
    },
    orderBy: { id: "asc" },
  });
  return { courses, blocked: false as const, teacherScoped };
}

export async function buildStudentList(
  user: { id: string; role: UserRole },
  input: {
    /** Omitted or null = every course this viewer may see (a teacher's "all"
     *  is their own courses, because the scope is applied to the query). */
    courseId?: number | null;
    /** Narrows "all courses" to one teacher's; ignored for a TEACHER login. */
    teacherId?: number;
    year: number;
    month: number;
  },
): Promise<StudentListReport> {
  const { year, month } = input;
  const label = `${MONTHS[month - 1]} ${year}`;
  const empty = {
    course: null, heading: null, allCourses: false, year, month, label, rows: [],
    totals: { registered: 0, paid: 0, notPaid: 0, free: 0, reconciles: true },
  };

  const scope = await courseScopeFor(user);
  if (scope === null) return { ...empty, blocked: true };
  const teacherScoped = "teacherId" in scope ? scope.teacherId : null;

  const courseSelect = {
    id: true, name: true,
    grade: { select: { label: true } },
    subject: { select: { label: true } },
    classType: { select: { label: true } },
    teacher: { select: { name: true } },
  } as const;

  // The scope is part of the WHERE, not a check afterwards: a course the viewer
  // may not see is simply not found — and for "all courses" it is never even
  // listed, so a teacher's "all" can only ever be their own.
  const courses = await db.course.findMany({
    where: {
      active: true,
      ...(input.courseId ? { id: input.courseId } : {}),
      ...(!input.courseId && input.teacherId && teacherScoped === null
        ? { teacherId: input.teacherId }
        : {}),
      ...scope,
    },
    select: courseSelect,
    orderBy: { id: "asc" },
  });
  if (courses.length === 0) return { ...empty, blocked: false };

  const allCourses = !input.courseId;
  const courseIds = courses.map((c) => c.id);

  const [enrolments, paidPerCourse] = await Promise.all([
    db.enrollment.findMany({
      where: { courseId: { in: courseIds }, status: "ACTIVE" },
      select: {
        courseId: true,
        feeTier: { select: { multiplier: true } },
        student: { select: { id: true, name: true, cardNumber: true } },
      },
    }),
    // One paid-set per course, through the same billing-month check as always.
    Promise.all(courseIds.map((id) => paidStudentsForCourseMonth(id, year, month))),
  ]);

  const paidByCourse = new Map(courseIds.map((id, i) => [id, paidPerCourse[i]]));
  const nameByCourse = new Map(courses.map((c) => [c.id, courseDisplayName(c)]));

  const rows: StudentListRow[] = enrolments
    .map((e) => ({
      studentId: e.student.id,
      name: e.student.name,
      cardNumber: e.student.cardNumber,
      courseId: e.courseId,
      course: nameByCourse.get(e.courseId) ?? "",
      // A free-tier student generates no payment row, so calling them
      // "not paid" would be an accusation rather than a fact.
      status: (Number(String(e.feeTier.multiplier)) === 0
        ? "free"
        : paidByCourse.get(e.courseId)?.has(e.student.id)
          ? "paid"
          : "not-paid") as StudentListRow["status"],
    }))
    .sort(
      (a, b) => a.course.localeCompare(b.course) || a.name.localeCompare(b.name),
    );

  const totals = {
    registered: rows.length,
    paid: rows.filter((r) => r.status === "paid").length,
    notPaid: rows.filter((r) => r.status === "not-paid").length,
    free: rows.filter((r) => r.status === "free").length,
    reconciles: false,
  };
  totals.reconciles = totals.registered === totals.paid + totals.notPaid + totals.free;

  const single = courses.length === 1 && !allCourses ? courses[0] : null;

  return {
    course: single
      ? { id: single.id, name: courseDisplayName(single), teacher: single.teacher.name }
      : null,
    heading: single
      ? `${courseDisplayName(single)} · ${single.teacher.name}`
      : `All courses (${courses.length})`,
    allCourses,
    year, month, label, rows, totals, blocked: false,
  };
}

/** Default month: the current Colombo one. */
export function currentColomboMonth() {
  const [y, m] = colomboNow().date.split("-").map(Number);
  return { year: y, month: m };
}
