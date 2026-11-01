import { decimalToCents, formatCents, formatDeduction, formatMoney } from "@/lib/cents";
import { computeCashFlow, type BankLine } from "@/lib/cash-flow";
import { dayLabelLong, dayLabelShort, documentNumber } from "@/lib/daily-summary-dates";
import type { DayFigures, CancelledSummary, StaffCollected } from "@/lib/daily-summary-extras";
import { friendlyDate } from "@/lib/friendly-date";
import { to12Hour } from "@/lib/colombo-time";
import type { DailySummary } from "@/lib/reports";

import { includedMonthsNote, ofWhichLines, type OfWhichLine } from "../extra-lines";

/**
 * The A4 document, as plain data: everything the sheets print, already formatted. Pure — it reads the
 * data object and the typed values and writes nothing, so what a sheet shows can be tested without a browser.
 * No figure is computed here except the cash flow (integer cents) and column totals; every other number is the
 * data object's own string with thousands separators added.
 */

export type DocCourseRow = { course: string; teacher: string; paid: number; full: number; half: number; quarter: number; free: number; amount: string };

export type DocModel = {
  kind: "day" | "range";
  from: string;
  to: string;
  docNo: string;
  /** Long date for a day ("Wednesday, 14 October 2026"); "from → to" for a range. */
  dateText: string;
  generatedText: string;
  generatedBy: string;
  preparedBy: string | null;
  checkedBy: string | null;
  courses: DocCourseRow[];
  noPaymentCourses: string[];
  classFees: string;
  ofWhich: OfWhichLine[];
  includedNote: string | null;
  admission: { count: number; total: string };
  smartCard: { count: number; total: string };
  totalCollected: string;
  teacherAdvances: string;
  xenonExpenses: string;
  net: string;
  flow: null | {
    bringForward: string;
    collected: string;
    deductions: string;
    shouldBe: string;
    bankCount: number;
    bankTotal: string;
    left: string;
    overdrawn: boolean;
  };
  deductions: { date: string; kind: string; person: string; reason: string; authorizedBy: string; amount: string }[];
  bank: { time: string; slip: string; note: string; amount: string }[];
  bankTotal: string;
  staff: { name: string; receipts: number; collected: string }[];
  staffTotal: { receipts: number; collected: string };
  cancelledLine: string | null;
  dayByDay: { date: string; collected: string; deductions: string; net: string }[];
  dayByDayTotal: { collected: string; deductions: string; net: string } | null;
};

export function cancelledLine(c: CancelledSummary): string | null {
  return c.receipts === 0 ? null : `Cancelled: ${c.receipts} receipt${c.receipts === 1 ? "" : "s"}, ${formatMoney(c.total)} (not counted)`;
}

export function deductionKind(d: { kind: "TEACHER_ADVANCE" | "XENON"; isStaffAdvance: boolean }): string {
  return d.kind === "TEACHER_ADVANCE" ? "Teacher advance" : d.isStaffAdvance ? "Staff advance" : "Xenon";
}

export function generatedStamp(now: { date: string; time: string }): string {
  return `${friendlyDate(now.date)}, ${to12Hour(now.time)}`;
}

export function buildDocModel(input: {
  report: DailySummary;
  cancelled: CancelledSummary;
  generated: { date: string; time: string };
  generatedBy: string;
  /** Single day only. */
  day?: { staff: readonly StaffCollected[]; bringForwardCents: number; bank: readonly BankLine[]; preparedBy: string | null; checkedBy: string | null };
  /** Range only. */
  byDay?: { days: readonly DayFigures[]; total: DayFigures };
}): DocModel {
  const { report } = input;
  const isDay = input.day !== undefined;

  const hasPayments = (c: DailySummary["courses"][number]) => c.paidFull + c.paidHalf + c.paidQuarter > 0 || decimalToCents(c.amount) > 0;
  const courses: DocCourseRow[] = report.courses.filter(hasPayments).map((c) => ({
    course: c.course, teacher: c.teacher, paid: c.paidFull + c.paidHalf + c.paidQuarter,
    full: c.paidFull, half: c.paidHalf, quarter: c.paidQuarter, free: c.free, amount: formatMoney(c.amount),
  }));

  const bank = input.day?.bank ?? [];
  const flow = input.day
    ? computeCashFlow({
        bringForward: input.day.bringForwardCents,
        collected: decimalToCents(report.totalCollected),
        deductions: decimalToCents(report.deductions.total),
        bank,
      })
    : null;

  const staff = input.day?.staff ?? [];
  const staffReceipts = staff.reduce((s, r) => s + r.receipts, 0);
  const staffCents = staff.reduce((s, r) => s + decimalToCents(r.collected), 0);

  return {
    kind: isDay ? "day" : "range",
    from: report.from,
    to: report.to,
    docNo: documentNumber(report.from, report.to),
    dateText: isDay ? dayLabelLong(report.from) : `${friendlyDate(report.from)} → ${friendlyDate(report.to)}`,
    generatedText: generatedStamp(input.generated),
    generatedBy: input.generatedBy,
    preparedBy: input.day?.preparedBy ?? null,
    checkedBy: input.day?.checkedBy ?? null,
    courses,
    noPaymentCourses: report.courses.filter((c) => !hasPayments(c)).map((c) => c.course),
    classFees: formatMoney(report.classTotal),
    ofWhich: ofWhichLines(report),
    includedNote: includedMonthsNote(report),
    admission: { count: report.admission.count, total: formatMoney(report.admission.total) },
    smartCard: { count: report.smartCard.count, total: formatMoney(report.smartCard.total) },
    totalCollected: formatMoney(report.totalCollected),
    teacherAdvances: formatDeduction(report.deductions.teacherAdvances),
    xenonExpenses: formatDeduction(report.deductions.xenonExpenses),
    net: formatMoney(report.net),
    flow: flow && {
      bringForward: formatCents(flow.bringForward),
      collected: formatCents(flow.collected),
      deductions: formatCents(-flow.deductions),
      shouldBe: formatCents(flow.shouldBe),
      bankCount: bank.length,
      bankTotal: formatCents(-flow.bankTotal),
      left: formatCents(flow.left),
      overdrawn: flow.overdrawn,
    },
    deductions: report.deductionLines.map((d) => ({
      date: d.date, kind: deductionKind(d), person: d.person ?? "—", reason: d.reason, authorizedBy: d.authorizedBy, amount: formatMoney(d.amount),
    })),
    bank: bank.map((l) => ({ time: to12Hour(l.time), slip: l.slip || "—", note: l.note || "—", amount: formatCents(l.cents) })),
    bankTotal: formatCents(bank.reduce((s, l) => s + l.cents, 0)),
    staff: staff.map((r) => ({ name: r.name, receipts: r.receipts, collected: formatMoney(r.collected) })),
    staffTotal: { receipts: staffReceipts, collected: formatCents(staffCents) },
    cancelledLine: cancelledLine(input.cancelled),
    dayByDay: (input.byDay?.days ?? []).map((d) => ({ date: dayLabelShort(d.date), collected: formatMoney(d.collected), deductions: formatDeduction(d.deductions), net: formatMoney(d.net) })),
    dayByDayTotal: input.byDay
      ? { collected: formatMoney(input.byDay.total.collected), deductions: formatDeduction(input.byDay.total.deductions), net: formatMoney(input.byDay.total.net) }
      : null,
  };
}
