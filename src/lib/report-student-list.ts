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
  status: "paid" | "not-paid" | "free";
};

export type StudentListReport = {
  course: { id: number; name: string; teacher: string } | null;
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
  input: { courseId: number; year: number; month: number },
): Promise<StudentListReport> {
  const { year, month } = input;
  const label = `${MONTHS[month - 1]} ${year}`;
  const empty = {
    course: null, year, month, label, rows: [],
    totals: { registered: 0, paid: 0, notPaid: 0, free: 0, reconciles: true },
  };

  const scope = await courseScopeFor(user);
  if (scope === null) return { ...empty, blocked: true };

  // The scope is part of the WHERE, not a check afterwards: a course the viewer
  // may not see is simply not found.
  const course = await db.course.findFirst({
    where: { id: input.courseId, ...scope },
    select: {
      id: true, name: true,
      grade: { select: { label: true } },
      subject: { select: { label: true } },
      classType: { select: { label: true } },
      teacher: { select: { name: true } },
    },
  });
  if (!course) return { ...empty, blocked: false };

  const [enrolments, paid] = await Promise.all([
    db.enrollment.findMany({
      where: { courseId: course.id, status: "ACTIVE" },
      select: {
        feeTier: { select: { multiplier: true } },
        student: { select: { id: true, name: true, cardNumber: true } },
      },
    }),
    paidStudentsForCourseMonth(course.id, year, month),
  ]);

  const rows: StudentListRow[] = enrolments
    .map((e) => ({
      studentId: e.student.id,
      name: e.student.name,
      cardNumber: e.student.cardNumber,
      // A free-tier student generates no payment row, so calling them
      // "not paid" would be an accusation rather than a fact.
      status: (Number(String(e.feeTier.multiplier)) === 0
        ? "free"
        : paid.has(e.student.id)
          ? "paid"
          : "not-paid") as StudentListRow["status"],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const totals = {
    registered: rows.length,
    paid: rows.filter((r) => r.status === "paid").length,
    notPaid: rows.filter((r) => r.status === "not-paid").length,
    free: rows.filter((r) => r.status === "free").length,
    reconciles: false,
  };
  totals.reconciles = totals.registered === totals.paid + totals.notPaid + totals.free;

  return {
    course: { id: course.id, name: courseDisplayName(course), teacher: course.teacher.name },
    year, month, label, rows, totals, blocked: false,
  };
}

/** Default month: the current Colombo one. */
export function currentColomboMonth() {
  const [y, m] = colomboNow().date.split("-").map(Number);
  return { year: y, month: m };
}
