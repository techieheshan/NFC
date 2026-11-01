import { formatMoney } from "@/lib/cents";
import type { DailySummary } from "@/lib/reports";

/**
 * The two optional "Other income" lines — Half months and No charge months — shared by the screen
 * and the PDF so they cannot disagree. Returns NOTHING when the report has neither, which is what
 * keeps the screen and the PDF for today's data exactly as they were.
 *
 * Both are counts of MONTHS (one course-month each), not extra money. A Half month's amount is already
 * inside "Class fees", so the Half line carries its amount in the LABEL ("Half months (N): <amount>,
 * included in Class fees") and a "-" in the Total cell: nobody adding the column up can count it twice.
 * A No-charge month is 0.00, so its Total is simply 0.00.
 *
 * `label` is the PDF row's label; `screenLabel` is the on-screen label (the PDF keeps the count in its own
 * column for No-charge months, so its label has no count).
 */
export type ExtraIncomeLine = { label: string; screenLabel: string; count: number; total: string };

export function halfAndNoChargeLines(report: Pick<DailySummary, "halfMonths" | "noChargeMonths">): ExtraIncomeLine[] {
  const half = report.halfMonths;
  return [
    ...(half
      ? [
          {
            label: `Half months (${half.count}): ${half.total}, included in Class fees`,
            screenLabel: `Half months (${half.count}): ${half.total}, included in Class fees`,
            count: half.count,
            total: "-",
          },
        ]
      : []),
    ...(report.noChargeMonths
      ? [
          {
            label: "No charge months",
            screenLabel: `No charge months (${report.noChargeMonths.count})`,
            count: report.noChargeMonths.count,
            total: "0.00",
          },
        ]
      : []),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Release 1: the indented "of which" lines under Class fees. ONE source for the day screen, the range screen
// and the A4 document, so they cannot disagree. They return NOTHING when the report has neither a Half nor a
// No-charge month, so a day without them looks exactly as before.
//
// A Half month's amount is already INSIDE Class fees, so it is shown as "of which" and never as a figure to add;
// a No-charge month is 0.00 and says nothing was charged.
// ---------------------------------------------------------------------------------------------------------------

export type OfWhichLine = { key: "half" | "noCharge"; label: string; count: number; total: string };

export function ofWhichLines(report: Pick<DailySummary, "halfMonths" | "noChargeMonths">): OfWhichLine[] {
  return [
    ...(report.halfMonths
      ? [{ key: "half" as const, count: report.halfMonths.count, label: `of which Half months (${report.halfMonths.count})`, total: formatMoney(report.halfMonths.total) }]
      : []),
    ...(report.noChargeMonths
      ? [{ key: "noCharge" as const, count: report.noChargeMonths.count, label: `No-charge months (${report.noChargeMonths.count}): nothing charged`, total: "0.00" }]
      : []),
  ];
}

/** The document's footnote about these months, or null when there are none. */
export function includedMonthsNote(report: Pick<DailySummary, "halfMonths" | "noChargeMonths">): string | null {
  const parts = [
    ...(report.halfMonths ? [`Half months (${report.halfMonths.count}: ${formatMoney(report.halfMonths.total)})`] : []),
    ...(report.noChargeMonths ? [`No-charge months (${report.noChargeMonths.count}: 0.00)`] : []),
  ];
  return parts.length === 0 ? null : `${parts.join(" and ")} are included in the amounts.`;
}
