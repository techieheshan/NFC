"use server";

import { requireRole } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";
import { resolveRange } from "@/lib/daily-summary-dates";
import { db } from "@/lib/db";
import { dailySummary, type DailySummary } from "@/lib/reports";

import { splitSigners, type Signer } from "./signer-lists";

export type { Signer };

/**
 * ADMIN + STAFF only. This report exposes institute-wide deductions, net
 * profit and every teacher's collections, so TEACHER is refused outright —
 * their own money view is the Payslip.
 */
const OPERATIONAL = ["ADMIN", "STAFF"] as const;

export async function loadDailySummary(
  from: string,
  to: string,
): Promise<DailySummary> {
  await requireRole([...OPERATIONAL]);

  // A REAL calendar day in 2000..2100 or today (the old regex let "2026-13-45" through and crashed the
  // page); a reversed range is swapped and one longer than a year is cut.
  const range = resolveRange(from, to, colomboNow().date);
  return dailySummary(range.from, range.to);
}


/**
 * The accounts offered as "Prepared by" / "Checked by" (rule 24):
 * preparing is any active ADMIN or STAFF account, checking is an active ADMIN only. The split is
 * `splitSigners` (pure, tested); this action only reads the active accounts and is guarded — a read is
 * still its own HTTP endpoint. Deactivated logins are excluded: a report must not be signed off by an
 * account nobody can use any more.
 */
export async function listSigners(): Promise<{
  prepared: Signer[];
  checked: Signer[];
}> {
  await requireRole([...OPERATIONAL]);

  const users = await db.user.findMany({
    where: { active: true, role: { in: ["ADMIN", "STAFF"] } },
    select: { id: true, username: true, role: true, staff: { select: { name: true } } },
    orderBy: [{ role: "asc" }, { username: "asc" }],
  });

  return splitSigners(users);
}
