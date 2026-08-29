"use server";

import { requireRole } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";
import { dailySummary, type DailySummary } from "@/lib/reports";

/**
 * ADMIN + STAFF only. This report exposes institute-wide deductions, net
 * profit and every teacher's collections, so TEACHER is refused outright —
 * their own money view is the Payslip.
 */
const OPERATIONAL = ["ADMIN", "STAFF"] as const;

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function loadDailySummary(
  from: string,
  to: string,
): Promise<DailySummary> {
  await requireRole([...OPERATIONAL]);

  const today = colomboNow().date;
  const start = isDate(from) ? from : today;
  const end = isDate(to) ? to : today;

  // Tolerate a reversed range rather than returning a confusing empty report.
  return dailySummary(start <= end ? start : end, start <= end ? end : start);
}
