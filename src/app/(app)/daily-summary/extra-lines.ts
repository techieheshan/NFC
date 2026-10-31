import type { DailySummary } from "@/lib/reports";

/**
 * The two optional "Other income" lines — Half months and No charge months — shared by the screen
 * and the PDF so they cannot disagree. Returns NOTHING when the report has neither, which is what
 * keeps the screen and the PDF for today's data exactly as they were.
 *
 * Both are counts of MONTHS (one course-month each), not extra money: a Half month's amount is
 * already inside "Class fees", and a No-charge month is 0.00.
 */
export type ExtraIncomeLine = { label: string; count: number; total: string };

export function halfAndNoChargeLines(report: Pick<DailySummary, "halfMonths" | "noChargeMonths">): ExtraIncomeLine[] {
  return [
    ...(report.halfMonths ? [{ label: "Half months", count: report.halfMonths.count, total: report.halfMonths.total }] : []),
    ...(report.noChargeMonths ? [{ label: "No charge months", count: report.noChargeMonths.count, total: "0.00" }] : []),
  ];
}
