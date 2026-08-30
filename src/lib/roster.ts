import "server-only";

import type { UserRole } from "@prisma/client";

import { courseScopeFor } from "@/lib/reports";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";

/**
 * "My Students" — who is enrolled in a course.
 *
 * Read-only. Scope is resolved from the DATABASE (`User.teacherId`), never from
 * a claim on the request: `courseScopeFor` is the same helper Daily Attendance
 * uses, so the two screens can never disagree about what a teacher may see, and
 * a teacher login with no Teacher row attached sees nothing rather than
 * everything.
 */

export type RosterStudent = {
  id: number;
  name: string;
  cardNumber: string | null;
  grade: string;
  school: string | null;
  feeTier: string;
  /**
   * Included so a teacher can reach a student or parent about their own class.
   * It is the one piece of contact data on this screen; removing it is a single
   * field here and one column in the PDF.
   */
  phone: string | null;
  /** Dropped rows are excluded by default; shown only when asked for. */
  dropped: boolean;
};

export type RosterCourse = {
  courseId: number;
  course: string;
  teacher: string;
  grade: string;
  students: RosterStudent[];
};

export type RosterFilters = {
  /** ADMIN/STAFF only — a TEACHER's own scope always wins over these. */
  teacherId?: number;
  courseId?: number;
  /** Name or card-number fragment, applied within the scoped courses. */
  q?: string;
  includeDropped?: boolean;
};

export type RosterResult = {
  courses: RosterCourse[];
  /** Null when a TEACHER login has no Teacher attached — the fail-closed case. */
  scopedToTeacher: number | null;
  blocked: boolean;
};

export async function buildRoster(
  user: { id: string; role: UserRole },
  filters: RosterFilters = {},
): Promise<RosterResult> {
  const scope = await courseScopeFor(user);

  // A TEACHER with no Teacher row: no courses are theirs, so nothing is shown.
  if (scope === null) return { courses: [], scopedToTeacher: null, blocked: true };

  const teacherScoped = "teacherId" in scope ? scope.teacherId : null;

  const courses = await db.course.findMany({
    where: {
      active: true,
      // The teacher's own scope is spread LAST so an ADMIN-style teacherId
      // filter in the query string can never widen it.
      ...(filters.teacherId && teacherScoped === null ? { teacherId: filters.teacherId } : {}),
      ...(filters.courseId ? { id: filters.courseId } : {}),
      ...scope,
    },
    select: {
      id: true,
      name: true,
      grade: { select: { label: true } },
      subject: { select: { label: true } },
      classType: { select: { label: true } },
      teacher: { select: { name: true } },
      enrollments: {
        where: {
          ...(filters.includeDropped ? {} : { status: "ACTIVE" }),
          ...(filters.q
            ? {
                student: {
                  OR: [
                    { name: { contains: filters.q, mode: "insensitive" as const } },
                    { cardNumber: { contains: filters.q, mode: "insensitive" as const } },
                  ],
                },
              }
            : {}),
        },
        select: {
          status: true,
          feeTier: { select: { label: true } },
          student: {
            select: { id: true, name: true, cardNumber: true, school: true, phone: true },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  });

  return {
    scopedToTeacher: teacherScoped,
    blocked: false,
    courses: courses.map((c) => ({
      courseId: c.id,
      course: courseDisplayName(c),
      teacher: c.teacher.name,
      grade: c.grade.label,
      students: c.enrollments
        .map((e) => ({
          id: e.student.id,
          name: e.student.name,
          cardNumber: e.student.cardNumber,
          // The grade of the CLASS they are sitting in, so a printed row stands
          // on its own — a student may sit in classes of different grades.
          grade: c.grade.label,
          school: e.student.school,
          feeTier: e.feeTier.label,
          phone: e.student.phone,
          dropped: e.status === "DROPPED",
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })),
  };
}
