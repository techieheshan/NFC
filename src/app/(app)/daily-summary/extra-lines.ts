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
