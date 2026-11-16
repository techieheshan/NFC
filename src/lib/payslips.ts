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

/**
 * Half-open [month start, next month start) as real UTC instants, for `paidAt`. Exported so the other
 * cash-basis reports (the Half and No-charge view) cut the month at exactly the same Colombo midnight.
 */
export function monthInstants(year: number, month: number) {
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

/** One fee tier's share of a slip, labelled from the reference table. */
export type PayslipTierCount = { code: string; label: string; students: number };

/**
 * One line of a payslip sheet: a course, a billing month, and one rate.
 *
 * Payments are grouped by the amount actually charged, so a course where some
 * students pay full and some pay half becomes two lines — which is what makes
 * "cards × rate = gross" true on every line instead of an average that matches
 * nothing. The institute cut is summed from each payment's own snapshot
 * percentage, so a line's split is exact even if the course's % was edited
 * between two payments.
 */
export type PayslipLineRow = {
  courseId: number;
  course: string;
  /** "Aug 2026", or "—" for a legacy row with no billing month. */
  billingLabel: string;
  /** Sort key: billingYear * 12 + billingMonth, 0 when unknown. */
  billingOrder: number;
  cards: number;
  rate: string;
  gross: string;
  sharePercent: string;
  instituteShare: string;
  teacherShare: string;
  /**
   * True on a line of months paid at HALF the fee (`chargeMode = HALF`), whatever tier the
   * student is on: it keeps them off a same-priced line of ordinary payers, and the sheet adds
   * "(Half month)" to the course cell. ABSENT on every other line, so a slip for today's data
   * has exactly the keys it always had.
   */
  halfMonth?: true;
};

/** One advance, itemised — the deduction has to be explainable to the teacher. */
export type PayslipAdvanceRow = {
  date: string;
  reason: string;
  amount: string;
  authorizedBy: string;
};

/**
 * One Salary adjustment on a slip: a shared expense is MINUS (the teacher paid part of it), a bonus is PLUS. `amount` is the positive
 * figure; `sign` says which way it moved the pay. Read from the adjustment's own stored line: nothing is recomputed here.
 */
export type PayslipAdjustmentRow = {
  adjustmentId: number;
  kind: "SHARED_EXPENSE" | "BONUS";
  title: string;
  amount: string;
  sign: "-" | "+";
  consentNote: string;
  /** "YYYY-MM-DD", the day they agreed. */
  consentOn: string;
};

export type Payslip = {
  teacherId: number;
  teacher: string;
  courses: PayslipCourseRow[];
  /**
   * Distinct students who paid this teacher this month — "how many cards came
   * through", counted once even when one student pays for two of their courses.
   */
  payingStudents: number;
  /** The same students split by the tier they were charged at, biggest first. */
  tierCounts: PayslipTierCount[];
  /** The sheet's body: one line per course × billing month × rate. */
  lines: PayslipLineRow[];
  /** Cards counted line by line — a student paying two months counts twice. */
  lineCards: number;
  /**
   * The Half months inside this slip — already part of every figure, shown as a note on the
   * Payslips screen only. ABSENT when there are none.
   */
  halfMonths?: { cards: number; gross: string };
  /** The advances behind the `advances` total. */
  advanceLines: PayslipAdvanceRow[];
  /**
   * Salary adjustments placed in THIS payroll month (teachers only; staff have a monthly list instead). ABSENT when there are none, so a
   * slip for a month without any has exactly the keys it always had. `finalSalary` already includes them.
   */
  adjustmentLines?: PayslipAdjustmentRow[];
  /** The signed total of `adjustmentLines` ("-25000.00" or "5000.00"). ABSENT with them. */
  adjustmentsNet?: string;
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
  /**
   * Salary adjustments placed in this payroll month, for ALL teachers and staff: what Xenon recovered from people (a shared expense: it
   * ADDS to profit, so Xenon's true cost of a 100,000 expense shared 50,000 is 50,000) and the bonuses it paid out (they REDUCE profit).
   * ABSENT for a month with none, so that month's roll-up is exactly what it was.
   */
  adjustments?: { recovered: string; bonuses: string };
  /**
   * Other incomes dated in this month (cash AND bank transfer — it is the institute's income either way; cancelled ones are not read).
   * ABSENT for a month with none, so that month's roll-up is exactly what it was. Adds to profit.
   */
  otherIncome?: string;
  /** Extra payments (bills for things that are not class fees) taken in this month by `paidAt`, cancelled ones excluded. ABSENT when none. Adds to profit. */
  extraPayments?: string;
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
  const everyPayment = allCourseIds.length
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
          // The billing month is what puts a payment on the right LINE of the
          // sheet; the month the slip covers is still `paidAt` (cash basis).
          billingYear: true,
          billingMonth: true,
          // The tier is read for the voucher's "3 full, 25 half" line. Labels
          // come from the reference table — never a hardcoded list of tiers.
          feeTier: { select: { code: true, label: true } },
          // NULL = the full fee. Compared in code below, never filtered in SQL: `<> 'NO_CHARGE'`
          // would drop the NULL rows, which are almost every row there is.
          chargeMode: true,
        },
      })
    : [];

  // A month recorded with NO CHARGE is settled and 0.00 but is not cash and not a payer: it is no
  // paying student, no card, no tier count and no sheet line. (Its amount is 0.00, so no money figure
  // below moves.) A HALF month stays — it is a real payment of half the fee.
  const payments = everyPayment.filter((p) => p.chargeMode !== "NO_CHARGE");

  const advances = await db.expense.findMany({
    where: {
      type: { code: "TEACHER_ADVANCE" },
      teacherId: teacherIds ? { in: teacherIds } : { not: null },
      date: dateWindow,
    },
    select: {
      teacherId: true,
      amount: true,
      date: true,
      reason: true,
      authorizedBy: { select: { username: true, staff: { select: { name: true } } } },
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  // Salary adjustments placed in this PAYROLL month for the teachers in scope (cancelled ones are not read). One extra query; for a month
  // without any it returns nothing and no slip changes.
  const adjustmentRows = await db.salaryAdjustmentLine.findMany({
    where: {
      teacherId: teacherIds ? { in: teacherIds } : { not: null },
      adjustment: { cancelled: false, applyYear: year, applyMonth: month },
    },
    select: {
      teacherId: true,
      amount: true,
      adjustment: { select: { id: true, kind: true, title: true, consentNote: true, consentOn: true } },
    },
    orderBy: [{ adjustmentId: "asc" }, { id: "asc" }],
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

    // Counted across the teacher's courses, so a student who pays for two of
    // them is one card, not two.
    const mineAll = payments.filter((p) =>
      teacher.courses.some((c) => c.id === p.courseId),
    );
    const perTier = new Map<string, { label: string; students: Set<number> }>();
    for (const p of mineAll) {
      if (!p.feeTier) continue;
      const entry = perTier.get(p.feeTier.code) ?? { label: p.feeTier.label, students: new Set<number>() };
      entry.students.add(p.studentId);
      perTier.set(p.feeTier.code, entry);
    }

    // --- the sheet's lines: course × billing month × rate ------------------
    const lineMap = new Map<
      string,
      { courseId: number; course: string; billingLabel: string; billingOrder: number;
        rate: number; cards: number; gross: number; institute: number; half: boolean }
    >();
    for (const p of mineAll) {
      const course = teacher.courses.find((c) => c.id === p.courseId);
      if (!course) continue;
      const amount = num(p.amount);
      const pct =
        p.instituteSharePercentApplied !== null
          ? num(p.instituteSharePercentApplied)
          : num(course.instituteSharePercent);
      const hasMonth = p.billingYear !== null && p.billingMonth !== null;
      const half = p.chargeMode === "HALF";
      // A Half month is its own line even when its price equals a Half-TIER student's rate. The key
      // is unchanged for every other row, so today's lines are grouped exactly as before.
      const key = `${p.courseId}:${p.billingYear ?? 0}:${p.billingMonth ?? 0}:${amount.toFixed(2)}${half ? ":half" : ""}`;
      const entry =
        lineMap.get(key) ??
        {
          courseId: course.id,
          course: courseDisplayName(course),
          billingLabel: hasMonth ? monthLabel(p.billingYear!, p.billingMonth!) : "—",
          billingOrder: hasMonth ? p.billingYear! * 12 + p.billingMonth! : 0,
          rate: amount,
          cards: 0,
          gross: 0,
          institute: 0,
          half,
        };
      entry.cards += 1;
      entry.gross += amount;
      entry.institute += (amount * pct) / 100;
      lineMap.set(key, entry);
    }

    const lines: PayslipLineRow[] = [...lineMap.values()]
      .map((l) => ({
        courseId: l.courseId,
        course: l.course,
        billingLabel: l.billingLabel,
        billingOrder: l.billingOrder,
        cards: l.cards,
        rate: money(l.rate),
        gross: money(l.gross),
        // The effective rate actually applied across this line's money.
        sharePercent: (l.gross > 0 ? (l.institute / l.gross) * 100 : 0).toFixed(2),
        instituteShare: money(l.institute),
        teacherShare: money(l.gross - l.institute),
        ...(l.half ? { halfMonth: true as const } : {}),
      }))
      .sort(
        (a, b) =>
          a.course.localeCompare(b.course) ||
          a.billingOrder - b.billingOrder ||
          Number(b.rate) - Number(a.rate) ||
          // same price: ordinary payers first, the Half-month line after them
          Number(a.halfMonth === true) - Number(b.halfMonth === true),
      );
    const halfLines = lines.filter((l) => l.halfMonth);

    const totalCollected = rows.reduce((s, r) => s + Number(r.collected), 0);
    const totalInstituteShare = rows.reduce((s, r) => s + Number(r.instituteShare), 0);
    const totalTeacherShare = rows.reduce((s, r) => s + Number(r.teacherShare), 0);
    const advance = advances
      .filter((a) => a.teacherId === teacher.id)
      .reduce((s, a) => s + num(a.amount), 0);
    // In cents so the sum is exact: minus for a shared expense, plus for a bonus.
    const mineAdjusted = adjustmentRows.filter((a) => a.teacherId === teacher.id);
    const adjustedCents = mineAdjusted.reduce((s, a) => {
      const cents = Math.round(num(a.amount) * 100);
      return s + (a.adjustment.kind === "SHARED_EXPENSE" ? -cents : cents);
    }, 0);

    return {
      teacherId: teacher.id,
      teacher: teacher.name,
      // Courses with no money this month are dropped — an empty slip is noise.
      courses: rows.filter((r) => Number(r.collected) > 0),
      payingStudents: new Set(mineAll.map((p) => p.studentId)).size,
      lines,
      lineCards: lines.reduce((s, l) => s + l.cards, 0),
      ...(halfLines.length > 0
        ? { halfMonths: { cards: halfLines.reduce((s, l) => s + l.cards, 0), gross: money(halfLines.reduce((s, l) => s + Number(l.gross), 0)) } }
        : {}),
      advanceLines: advances
        .filter((a) => a.teacherId === teacher.id)
        .map((a) => ({
          date: colomboNow(a.date).date,
          reason: a.reason,
          amount: money(num(a.amount)),
          authorizedBy: a.authorizedBy.staff?.name ?? a.authorizedBy.username,
        })),
      ...(mineAdjusted.length > 0
        ? {
            adjustmentLines: mineAdjusted.map((a) => ({
              adjustmentId: a.adjustment.id,
              kind: a.adjustment.kind,
              title: a.adjustment.title,
              amount: money(num(a.amount)),
              sign: a.adjustment.kind === "SHARED_EXPENSE" ? ("-" as const) : ("+" as const),
              consentNote: a.adjustment.consentNote,
              consentOn: a.adjustment.consentOn.toISOString().slice(0, 10),
            })),
            adjustmentsNet: money(adjustedCents / 100),
          }
        : {}),
      tierCounts: [...perTier]
        .map(([code, v]) => ({ code, label: v.label, students: v.students.size }))
        .sort((a, b) => b.students - a.students || a.label.localeCompare(b.label)),
      totalCollected: money(totalCollected),
      totalInstituteShare: money(totalInstituteShare),
      totalTeacherShare: money(totalTeacherShare),
      advances: money(advance),
      finalSalary: money(totalTeacherShare - advance + adjustedCents / 100),
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

    // Salary adjustments of this payroll month, teachers AND staff (a staff share is still money Xenon recovers or pays out).
    const adjusted = await db.salaryAdjustmentLine.findMany({
      where: { adjustment: { cancelled: false, applyYear: year, applyMonth: month } },
      select: { amount: true, adjustment: { select: { kind: true } } },
    });
    const recoveredCents = adjusted.filter((a) => a.adjustment.kind === "SHARED_EXPENSE").reduce((sum, a) => sum + Math.round(num(a.amount) * 100), 0);
    const bonusCents = adjusted.filter((a) => a.adjustment.kind === "BONUS").reduce((sum, a) => sum + Math.round(num(a.amount) * 100), 0);

    // Other incomes (by their own calendar day) and extra payments (by `paidAt`), read only here, only for the institute summary.
    const [otherRows, extraRows] = await Promise.all([
      db.otherIncome.findMany({ where: { cancelled: false, date: dateWindow }, select: { amount: true } }),
      db.extraPayment.findMany({ where: { cancelled: false, paidAt: paidWindow }, select: { total: true } }),
    ]);
    const otherCents = otherRows.reduce((sum, r) => sum + Math.round(num(r.amount) * 100), 0);
    const extraCents = extraRows.reduce((sum, r) => sum + Math.round(num(r.total) * 100), 0);

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
      ...(adjusted.length > 0 ? { adjustments: { recovered: money(recoveredCents / 100), bonuses: money(bonusCents / 100) } } : {}),
      ...(otherRows.length > 0 ? { otherIncome: money(otherCents / 100) } : {}),
      ...(extraRows.length > 0 ? { extraPayments: money(extraCents / 100) } : {}),
      instituteProfit: money(institute + admissionIncome + smartCardIncome - xenon + recoveredCents / 100 - bonusCents / 100 + otherCents / 100 + extraCents / 100),
    };
  }

  return report;
}
