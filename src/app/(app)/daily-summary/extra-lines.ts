import { formatMoney } from "@/lib/cents";
import type { DailySummary } from "@/lib/reports";

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

// ---------------------------------------------------------------------------------------------------------------
// Wording for the Admission and Smart card lines (day screen, range screen, A4 document): ONE source, so they
// cannot disagree. Wording only — the data object and its field names (admission, smartCard) are untouched.
// ---------------------------------------------------------------------------------------------------------------

/** The SMART_CARD line. */
export const smartCardLabel = (count: number) => `Smart card replacement (${count})`;

/** Shown under the Admission line. */
export const ADMISSION_NOTE = "Admission includes the first smart card";
