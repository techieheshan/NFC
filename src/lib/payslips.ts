import "server-only";

import { colomboDateValue, colomboDayStartUtc, colomboNow } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";

/**
 * Payroll.
 *
 * Three deliberate choices, all flagged for confirmation:
 *
 *  1. MONTH BASIS = `paidAt` (cash basis). A payment belongs to the month the
 *     money arrived, so a closed month never changes retroactively and this
 *     agrees with Daily Summary. Billing month would let a late payment reopen
 *     an already-paid-out slip.
 *  2. INSTITUTE % comes from the CURRENT `Course.instituteSharePercent`. It is
 *     not snapshotted on the payment, so editing a course's % re-prices every
 *     historical slip for that course.
 *  3. Teacher advances reduce the TEACHER's salary only. They are never part of
 *     institute profit — two independent tracks.
 */

const money = (n: number) => n.toFixed(2);
const num = (v: unknown) => Number(String(v));
const pad = (n: number) => String(n).padStart(2, "0");

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const monthLabel = (y: number, m: number) => `${MONTHS[m - 1]} ${y}`;

/** The last *completed* Colombo month — what a teacher is allowed to see. */
export function lastCompletedMonth(at: Date = new Date()): { year: number; month: number } {
  const [y, m] = colomboNow(at).date.split("-").map(Number);
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}

/** Half-open [month start, next month start) as real UTC instants, for `paidAt`. */
function monthInstants(year: number, month: number) {
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  return {
    gte: colomboDayStartUtc(`${year}-${pad(month)}-01`),
    lt: colomboDayStartUtc(`${nextY}-${pad(nextM)}-01`),
  };
}

/** Same window over a `@db.Date` column (expenses). */
function monthDates(year: number, month: number) {
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  return {
    gte: colomboDateValue(`${year}-${pad(month)}-01`),
    lt: colomboDateValue(`${nextY}-${pad(nextM)}-01`),
  };
}

export type PayslipCourseRow = {
  courseId: number;
  course: string;
  sharePercent: string;
  payingStudents: number;
  collected: string;
  instituteShare: string;
  teacherShare: string;
};

export type Payslip = {
  teacherId: number;
  teacher: string;
  courses: PayslipCourseRow[];
  totalCollected: string;
  totalInstituteShare: string;
  totalTeacherShare: string;
  advances: string;
  finalSalary: string;
};

export type InstituteSummary = {
  /** CLASS money only — the pot that gets split with teachers. */
  totalCollected: string;
  totalInstituteShare: string;
  totalTeacherShare: string;
  /** Kept whole by the institute; feeds profit directly. */
  admissionIncome: string;
  smartCardIncome: string;
  teacherAdvances: string;
  xenonExpenses: string;
  instituteProfit: string;
};

export type PayslipReport = {
  year: number;
  month: number;
  label: string;
  slips: Payslip[];
  /** ADMIN only — omitted entirely for STAFF and TEACHER. */
  institute?: InstituteSummary;
};

/**
 * Builds slips for the given month.
 *
 * `teacherIds` narrows the report; omitting it covers every teacher. Callers are
 * responsible for the access decision — this only computes.
 */
export async function buildPayslips(options: {
  year: number;
  month: number;
  teacherIds?: number[];
  includeInstitute: boolean;
}): Promise<PayslipReport> {
  const { year, month, teacherIds, includeInstitute } = options;
  const paidWindow = monthInstants(year, month);
  const dateWindow = monthDates(year, month);

  const teachers = await db.teacher.findMany({
    where: teacherIds ? { id: { in: teacherIds } } : {},
    select: {
      id: true,
      name: true,
      courses: {
        select: {
          id: true,
          name: true,
          instituteSharePercent: true,
          teacher: { select: { name: true } },
          subject: { select: { label: true } },
          grade: { select: { label: true } },
          classType: { select: { label: true } },
        },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  const allCourseIds = teachers.flatMap((t) => t.courses.map((c) => c.id));

  // `Payment.amount` is the snapshot of what was actually charged — it already
  // carries the fee tier and any combo discount, so it is summed as-is.
  const payments = allCourseIds.length
    ? await db.payment.findMany({
        where: {
          kind: "CLASS",
          cancelled: false,
          courseId: { in: allCourseIds },
          paidAt: paidWindow,
        },
        select: {
          courseId: true,
          studentId: true,
          amount: true,
          instituteSharePercentApplied: true,
        },
      })
    : [];

  const advances = await db.expense.findMany({
    where: {
      type: { code: "TEACHER_ADVANCE" },
      teacherId: teacherIds ? { in: teacherIds } : { not: null },
      date: dateWindow,
    },
    select: { teacherId: true, amount: true },
  });

  const slips: Payslip[] = teachers.map((teacher) => {
    const rows: PayslipCourseRow[] = teacher.courses.map((course) => {
      const mine = payments.filter((p) => p.courseId === course.id);
      const collected = mine.reduce((s, p) => s + num(p.amount), 0);

      // Each payment carries the % frozen at the moment it was taken, so a
      // later edit to the course cannot rewrite a paid slip. Legacy rows
      // predating that column fall back to the course's current %.
      const livePercent = num(course.instituteSharePercent);
      const instituteShare = mine.reduce(
        (sum, p) =>
          sum +
          (num(p.amount) *
            (p.instituteSharePercentApplied !== null
              ? num(p.instituteSharePercentApplied)
              : livePercent)) /
            100,
        0,
      );
      // Display the effective rate actually applied across this course's money.
      const percent = collected > 0 ? (instituteShare / collected) * 100 : livePercent;

      return {
        courseId: course.id,
        course: courseDisplayName(course),
        sharePercent: percent.toFixed(2),
        payingStudents: new Set(mine.map((p) => p.studentId)).size,
        collected: money(collected),
        instituteShare: money(instituteShare),
        teacherShare: money(collected - instituteShare),
      };
    });

    const totalCollected = rows.reduce((s, r) => s + Number(r.collected), 0);
    const totalInstituteShare = rows.reduce((s, r) => s + Number(r.instituteShare), 0);
    const totalTeacherShare = rows.reduce((s, r) => s + Number(r.teacherShare), 0);
    const advance = advances
      .filter((a) => a.teacherId === teacher.id)
      .reduce((s, a) => s + num(a.amount), 0);

    return {
      teacherId: teacher.id,
      teacher: teacher.name,
      // Courses with no money this month are dropped — an empty slip is noise.
      courses: rows.filter((r) => Number(r.collected) > 0),
      totalCollected: money(totalCollected),
      totalInstituteShare: money(totalInstituteShare),
      totalTeacherShare: money(totalTeacherShare),
      advances: money(advance),
      finalSalary: money(totalTeacherShare - advance),
    };
  });

  const report: PayslipReport = {
    year,
    month,
    label: monthLabel(year, month),
    slips,
  };

  if (includeInstitute) {
    // Institute-wide: every course, not just the teachers in scope.
    const everyCourse = await db.course.findMany({
      select: { id: true, instituteSharePercent: true },
    });
    const allPayments = await db.payment.findMany({
      where: { cancelled: false, paidAt: paidWindow },
      select: {
        kind: true,
        courseId: true,
        amount: true,
        instituteSharePercentApplied: true,
      },
    });
    const percentOf = new Map(everyCourse.map((c) => [c.id, num(c.instituteSharePercent)]));

    let collected = 0;
    let institute = 0;
    let admissionIncome = 0;
    let smartCardIncome = 0;

    for (const p of allPayments) {
      const amount = num(p.amount);
      if (p.kind === "CLASS") {
        collected += amount;
        const percent =
          p.instituteSharePercentApplied !== null
            ? num(p.instituteSharePercentApplied)
            : (percentOf.get(p.courseId ?? -1) ?? 0);
        institute += (amount * percent) / 100;
      } else if (p.kind === "ADMISSION") {
        // The institute keeps admission and smart-card income in full — no
        // teacher split — so both feed profit directly.
        admissionIncome += amount;
      } else if (p.kind === "SMART_CARD") {
        smartCardIncome += amount;
      }
    }

    const expenses = await db.expense.findMany({
      where: { date: dateWindow },
      select: { amount: true, type: { select: { code: true } } },
    });
    const teacherAdvances = expenses
      .filter((e) => e.type.code === "TEACHER_ADVANCE")
      .reduce((s, e) => s + num(e.amount), 0);
    // Staff advances are XENON rows and are already inside this sum.
    const xenon = expenses
      .filter((e) => e.type.code === "XENON")
      .reduce((s, e) => s + num(e.amount), 0);

    report.institute = {
      totalCollected: money(collected),
      totalInstituteShare: money(institute),
      totalTeacherShare: money(collected - institute),
      admissionIncome: money(admissionIncome),
      smartCardIncome: money(smartCardIncome),
      teacherAdvances: money(teacherAdvances),
      xenonExpenses: money(xenon),
      // Course share + income the institute keeps whole, less Xenon costs.
      // Teacher advances are deliberately NOT subtracted — they reduce a
      // teacher's own salary, not institute profit.
      instituteProfit: money(institute + admissionIncome + smartCardIncome - xenon),
    };
  }

  return report;
}
