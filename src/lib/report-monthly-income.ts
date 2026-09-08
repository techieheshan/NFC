import "server-only";

import { colomboNow } from "@/lib/colombo-time";
import { db } from "@/lib/db";
import { buildPayslips, monthLabel, type InstituteSummary } from "@/lib/payslips";

/**
 * The month-end roll-up: what came in, whose it is, and what left.
 *
 * Every per-teacher figure comes from `buildPayslips` — the same `paidAt` month
 * basis and the same frozen `instituteSharePercentApplied` the payslips and the
 * printed sheets use. There is deliberately NO money math here: if this report
 * and a teacher's payslip could be computed two different ways, sooner or later
 * they would disagree, and the teacher would be right.
 *
 * The institute block is `buildPayslips`' own admin summary, passed through, so
 * the profit line on this report IS the profit line on Payslips.
 *
 * Note the clock: this is a CASH question ("what came in during August?"), so
 * it is `paidAt` — not the billing-month basis the arrears and not-paid screens
 * answer. Both are right; they answer different questions.
 */

export type TeacherRollup = {
  teacherId: number;
  teacher: string;
  /** Distinct students who paid this teacher this month. */
  students: number;
  collected: string;
  instituteShare: string;
  teacherShare: string;
  advances: string;
  /** Teacher share − advances: what the teacher is actually paid. */
  finalSalary: string;
};

export type AdvanceLine = {
  teacherId: number;
  teacher: string;
  date: string;
  reason: string;
  amount: string;
  authorizedBy: string;
};

export type ExpenseLine = {
  date: string;
  reason: string;
  amount: string;
  authorizedBy: string;
  isStaffAdvance: boolean;
  staff: string | null;
};

export type MonthlyIncome = {
  year: number;
  month: number;
  label: string;
  byTeacher: TeacherRollup[];
  institute: InstituteSummary;
  advances: AdvanceLine[];
  advancesTotal: string;
  expenses: ExpenseLine[];
  expensesTotal: string;
  /**
   * Course collections = teacher shares + institute keep, and the profit line
   * rebuilds from its parts. Shown on the report: a roll-up that cannot prove
   * itself is not worth printing.
   */
  reconciles: { shares: boolean; profit: boolean };
  /**
   * The cents left over when each teacher's two halves are rounded separately.
   * A slip shows 2dp, so a split of an odd amount rounds a half-cent each way;
   * across a dozen teachers that can total a cent or two. It is displayed
   * rather than hidden — an unexplained penny is what makes people distrust a
   * report — and it is bounded at half a cent per teacher, so anything larger
   * is a real disagreement and trips the reconciliation.
   */
  roundingDelta: string;
};

const money = (n: number) => n.toFixed(2);
const num = (v: unknown) => Number(String(v));

export function currentColomboMonth() {
  const [year, month] = colomboNow().date.split("-").map(Number);
  return { year, month };
}

export async function buildMonthlyIncome(year: number, month: number): Promise<MonthlyIncome> {
  const report = await buildPayslips({ year, month, includeInstitute: true });
  const institute = report.institute!;

  const byTeacher: TeacherRollup[] = report.slips
    .filter((s) => Number(s.totalCollected) > 0 || Number(s.advances) > 0)
    .map((s) => ({
      teacherId: s.teacherId,
      teacher: s.teacher,
      students: s.payingStudents,
      collected: s.totalCollected,
      instituteShare: s.totalInstituteShare,
      teacherShare: s.totalTeacherShare,
      advances: s.advances,
      finalSalary: s.finalSalary,
    }))
    .sort((a, b) => Number(b.collected) - Number(a.collected));

  // The advances are already itemised on each slip, with who authorised them.
  const advances: AdvanceLine[] = report.slips.flatMap((s) =>
    s.advanceLines.map((a) => ({
      teacherId: s.teacherId,
      teacher: s.teacher,
      date: a.date,
      reason: a.reason,
      amount: a.amount,
      authorizedBy: a.authorizedBy,
    })),
  ).sort((a, b) => a.date.localeCompare(b.date) || a.teacher.localeCompare(b.teacher));

  // Xenon costs, explained: what it was for and on whose authority. Staff
  // advances are XENON rows carrying a flag — they are counted once, here.
  const rows = await db.expense.findMany({
    where: { type: { code: "XENON" }, date: monthDates(year, month) },
    select: {
      amount: true, reason: true, date: true, isStaffAdvance: true,
      staff: { select: { name: true } },
      authorizedBy: { select: { username: true, staff: { select: { name: true } } } },
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  const expenses: ExpenseLine[] = rows.map((e) => ({
    date: colomboNow(e.date).date,
    reason: e.reason,
    amount: money(num(e.amount)),
    authorizedBy: e.authorizedBy.staff?.name ?? e.authorizedBy.username,
    isStaffAdvance: e.isStaffAdvance,
    staff: e.staff?.name ?? null,
  }));

  const sharesSum = report.slips.reduce(
    (s, t) => s + Number(t.totalTeacherShare) + Number(t.totalInstituteShare),
    0,
  );
  const sharesDelta = sharesSum - Number(institute.totalCollected);
  // Half a cent per slip is the exact worst case of rounding two halves.
  const roundingBound = 0.005 * report.slips.length + 0.0001;
  const profitParts =
    Number(institute.totalInstituteShare) +
    Number(institute.admissionIncome) +
    Number(institute.smartCardIncome) -
    Number(institute.xenonExpenses);

  return {
    year,
    month,
    label: monthLabel(year, month),
    byTeacher,
    institute,
    advances,
    advancesTotal: money(advances.reduce((s, a) => s + Number(a.amount), 0)),
    expenses,
    expensesTotal: money(expenses.reduce((s, e) => s + Number(e.amount), 0)),
    reconciles: {
      shares: Math.abs(sharesDelta) <= roundingBound,
      profit: Math.abs(profitParts - Number(institute.instituteProfit)) < 0.005,
    },
    roundingDelta: money(sharesDelta),
  };
}

/** The Colombo month as a half-open range over a `@db.Date` column. */
function monthDates(year: number, month: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  return {
    gte: new Date(`${year}-${pad(month)}-01T00:00:00.000Z`),
    lt: new Date(`${nextY}-${pad(nextM)}-01T00:00:00.000Z`),
  };
}
