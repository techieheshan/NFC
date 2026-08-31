import "server-only";

import { colomboNow } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";

/**
 * Who is behind on fees — the single source of truth for the paid/not-paid
 * colour, imported by the Student Profile and by the attendance counter.
 *
 * Arrears is BILLING-MONTH based, not cash-date based: "owes August" means no
 * payment is stamped for August, whoever paid it and whenever. That is a
 * different question from Daily Summary's "what came in today", and the two are
 * meant to disagree — a July fee paid in August clears July here and appears in
 * August's takings there.
 *
 * Months are counted from the ENROLMENT's own start month (its `createdAt`,
 * Colombo) through the current month. A student enrolled in March is not in
 * arrears for February.
 */

export type ArrearsStatus = "green" | "amber" | "red" | "grey";

export type OwedMonth = { year: number; month: number; label: string };

export type CourseArrears = {
  courseId: number;
  course: string;
  feeTier: string;
  /** Free-tier enrolments generate no payment row, so they are never "owed". */
  free: boolean;
  owed: OwedMonth[];
};

export type StudentArrears = {
  studentId: number;
  status: ArrearsStatus;
  /** Distinct months owed across every course, oldest first. */
  owedMonths: OwedMonth[];
  /** "Jul, Aug" · "Aug" · "Up to date" · "Free tier" — ready to render. */
  label: string;
  courses: CourseArrears[];
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const monthLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;
const monthIndex = (year: number, month: number) => year * 12 + month;

/**
 * Batched on purpose. The attendance working set precomputes this for every
 * student at once, and a per-student query there would be 120 round trips on
 * every cache refresh.
 */
export async function studentArrearsMany(
  studentIds: number[],
): Promise<Map<number, StudentArrears>> {
  const out = new Map<number, StudentArrears>();
  if (studentIds.length === 0) return out;

  const now = colomboNow();
  const [nowYear, nowMonth] = now.date.split("-").map(Number);
  const currentIndex = monthIndex(nowYear, nowMonth);

  const [enrolments, payments] = await Promise.all([
    db.enrollment.findMany({
      where: { studentId: { in: studentIds }, status: "ACTIVE" },
      select: {
        studentId: true,
        courseId: true,
        createdAt: true,
        feeTier: { select: { label: true, multiplier: true } },
        course: {
          select: {
            id: true,
            name: true,
            grade: { select: { label: true } },
            subject: { select: { label: true } },
            classType: { select: { label: true } },
            teacher: { select: { name: true } },
          },
        },
      },
    }),
    db.payment.findMany({
      where: {
        studentId: { in: studentIds },
        kind: "CLASS",
        cancelled: false,
        courseId: { not: null },
      },
      select: { studentId: true, courseId: true, billingYear: true, billingMonth: true },
    }),
  ]);

  // (student, course, billing month) -> settled.
  const settled = new Set(
    payments
      .filter((p) => p.billingYear !== null && p.billingMonth !== null)
      .map((p) => `${p.studentId}:${p.courseId}:${p.billingYear}:${p.billingMonth}`),
  );

  const byStudent = new Map<number, typeof enrolments>();
  for (const e of enrolments) {
    const list = byStudent.get(e.studentId) ?? [];
    list.push(e);
    byStudent.set(e.studentId, list);
  }

  for (const studentId of studentIds) {
    const mine = byStudent.get(studentId) ?? [];
    const courses: CourseArrears[] = [];
    const owedAll = new Map<string, OwedMonth>();

    for (const e of mine) {
      const free = Number(String(e.feeTier.multiplier)) === 0;
      const owed: OwedMonth[] = [];

      if (!free) {
        const from = colomboNow(e.createdAt).date.split("-").map(Number);
        let index = monthIndex(from[0], from[1]);
        let [y, m] = [from[0], from[1]];

        while (index <= currentIndex) {
          if (!settled.has(`${studentId}:${e.courseId}:${y}:${m}`)) {
            const month = { year: y, month: m, label: monthLabel(y, m) };
            owed.push(month);
            owedAll.set(`${y}-${m}`, month);
          }
          m += 1;
          if (m === 13) { m = 1; y += 1; }
          index += 1;
        }
      }

      courses.push({
        courseId: e.courseId,
        course: courseDisplayName(e.course),
        feeTier: e.feeTier.label,
        free,
        owed,
      });
    }

    const owedMonths = [...owedAll.values()].sort(
      (a, b) => monthIndex(a.year, a.month) - monthIndex(b.year, b.month),
    );
    const hasChargeable = courses.some((c) => !c.free);
    const owesPast = owedMonths.some((o) => monthIndex(o.year, o.month) < currentIndex);

    // Grey is "there is nothing to owe", which is not the same as being paid up:
    // a free-tier student never generates a payment row at all.
    const status: ArrearsStatus = !hasChargeable
      ? "grey"
      : owesPast
        ? "red"
        : owedMonths.length > 0
          ? "amber"
          : "green";

    out.set(studentId, {
      studentId,
      status,
      owedMonths,
      label:
        status === "grey"
          ? "Free tier"
          : owedMonths.length === 0
            ? "Up to date"
            : owedMonths.map((o) => MONTHS[o.month - 1]).join(", "),
      courses,
    });
  }

  return out;
}

/** One student. Callers apply their own role guard — this is a plain query. */
export async function studentArrears(studentId: number): Promise<StudentArrears> {
  const many = await studentArrearsMany([studentId]);
  return (
    many.get(studentId) ?? {
      studentId,
      status: "grey",
      owedMonths: [],
      label: "Free tier",
      courses: [],
    }
  );
}
