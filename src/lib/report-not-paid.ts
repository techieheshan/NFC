import "server-only";

import { colomboNow } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { SETTLED_PAYMENT_WHERE } from "@/lib/student-arrears";

/**
 * The collections work-list: who owes a given month, and how to reach them.
 *
 * Billing-month based, through the SAME predicate the arrears colour and the
 * Student List report use (`SETTLED_PAYMENT_WHERE`) — so a student cannot be
 * "not paid" here and paid-up on the counter. A cancelled payment never clears
 * a month; a free-tier student never appears, because they generate no payment
 * row and owing nothing is not the same as not having paid.
 */

export type NotPaidRow = {
  studentId: number;
  student: string;
  cardNumber: string | null;
  phone: string | null;
  courseId: number;
  course: string;
  teacher: string;
};

export type NotPaidReport = {
  year: number;
  month: number;
  label: string;
  rows: NotPaidRow[];
  /** Non-payers per course, in the same order the rows are grouped. */
  perCourse: { courseId: number; course: string; teacher: string; count: number }[];
  total: number;
};

export type NotPaidFilters = { courseId?: number; teacherId?: number };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function currentColomboMonth() {
  const [year, month] = colomboNow().date.split("-").map(Number);
  return { year, month };
}

export async function buildNotPaid(
  year: number,
  month: number,
  filters: NotPaidFilters = {},
): Promise<NotPaidReport> {
  const courses = await db.course.findMany({
    where: {
      active: true,
      ...(filters.courseId ? { id: filters.courseId } : {}),
      ...(filters.teacherId ? { teacherId: filters.teacherId } : {}),
    },
    select: {
      id: true, name: true,
      grade: { select: { label: true } },
      subject: { select: { label: true } },
      classType: { select: { label: true } },
      teacher: { select: { name: true } },
    },
    orderBy: { id: "asc" },
  });
  const courseIds = courses.map((c) => c.id);

  if (courseIds.length === 0) {
    return { year, month, label: `${MONTHS[month - 1]} ${year}`, rows: [], perCourse: [], total: 0 };
  }

  const [enrolments, paid] = await Promise.all([
    db.enrollment.findMany({
      where: { status: "ACTIVE", courseId: { in: courseIds } },
      select: {
        courseId: true,
        feeTier: { select: { multiplier: true } },
        student: { select: { id: true, name: true, cardNumber: true, phone: true } },
      },
    }),
    db.payment.findMany({
      where: { ...SETTLED_PAYMENT_WHERE, courseId: { in: courseIds }, billingYear: year, billingMonth: month },
      select: { studentId: true, courseId: true },
    }),
  ]);

  const settled = new Set(paid.map((p) => `${p.studentId}:${p.courseId}`));
  const byCourse = new Map(courses.map((c) => [c.id, c]));

  const rows: NotPaidRow[] = enrolments
    // Free tier owes nothing, ever — listing them would be an accusation.
    .filter((e) => Number(String(e.feeTier.multiplier)) !== 0)
    .filter((e) => !settled.has(`${e.student.id}:${e.courseId}`))
    .map((e) => {
      const c = byCourse.get(e.courseId)!;
      return {
        studentId: e.student.id,
        student: e.student.name,
        cardNumber: e.student.cardNumber,
        phone: e.student.phone,
        courseId: e.courseId,
        course: courseDisplayName(c),
        teacher: c.teacher.name,
      };
    })
    .sort((a, b) => a.course.localeCompare(b.course) || a.student.localeCompare(b.student));

  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.courseId, (counts.get(r.courseId) ?? 0) + 1);

  return {
    year, month,
    label: `${MONTHS[month - 1]} ${year}`,
    rows,
    perCourse: [...counts]
      .map(([courseId, count]) => {
        const c = byCourse.get(courseId)!;
        return { courseId, course: courseDisplayName(c), teacher: c.teacher.name, count };
      })
      .sort((a, b) => b.count - a.count),
    total: rows.length,
  };
}
