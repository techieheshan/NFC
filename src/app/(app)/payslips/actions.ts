"use server";

import { z } from "zod";

import { requireRole } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";
import {
  buildPayslips,
  lastCompletedMonth,
  monthLabel,
  type PayslipReport,
} from "@/lib/payslips";
import { teacherIdForUser } from "@/lib/reports";

export type PayslipView = {
  report: PayslipReport;
  /** What the viewer is allowed to do, so the UI matches the server. */
  canPickMonth: boolean;
  canSeeInstitute: boolean;
  scopedToOwnSlip: boolean;
  /** Only meaningful for a teacher — the single month they may see. */
  lockedMonthLabel: string | null;
};

export type PayslipResult =
  | { ok: true; view: PayslipView }
  | { ok: false; error: string };

const monthSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

/**
 * The one place access is decided.
 *
 *   ADMIN   — any month, every teacher, plus the institute summary.
 *   STAFF   — any month, every teacher, but NO institute summary (DECISION 3).
 *   TEACHER — their own slip only, and only the last completed month
 *             (the one-month arrears rule). Both limits are enforced here, so
 *             replaying this action with another teacher's id or an earlier
 *             month is refused rather than quietly re-scoped.
 */
export async function loadPayslips(input: {
  year?: number;
  month?: number;
  teacherId?: number;
}): Promise<PayslipResult> {
  const user = await requireRole(["ADMIN", "STAFF", "TEACHER"]);

  const now = colomboNow();
  const [nowYear, nowMonth] = now.date.split("-").map(Number);
  const requested = monthSchema.safeParse({
    year: input.year ?? nowYear,
    month: input.month ?? nowMonth,
  });
  if (!requested.success) return { ok: false, error: "Pick a valid month." };

  if (user.role === "TEACHER") {
    const teacherId = await teacherIdForUser(user.id);
    if (teacherId === null) {
      return { ok: false, error: "This login is not linked to a teacher record." };
    }

    // Arrears: only the last completed month is ever visible.
    const allowed = lastCompletedMonth();
    const askedFor = requested.data;
    const askedDefault = input.year === undefined && input.month === undefined;
    if (
      !askedDefault &&
      (askedFor.year !== allowed.year || askedFor.month !== allowed.month)
    ) {
      return {
        ok: false,
        error: `You can only view ${monthLabel(allowed.year, allowed.month)}.`,
      };
    }
    if (input.teacherId !== undefined && input.teacherId !== teacherId) {
      return { ok: false, error: "You can only view your own payslip." };
    }

    return {
      ok: true,
      view: {
        report: await buildPayslips({
          year: allowed.year,
          month: allowed.month,
          teacherIds: [teacherId],
          includeInstitute: false,
        }),
        canPickMonth: false,
        canSeeInstitute: false,
        scopedToOwnSlip: true,
        lockedMonthLabel: monthLabel(allowed.year, allowed.month),
      },
    };
  }

  const isAdmin = user.role === "ADMIN";

  return {
    ok: true,
    view: {
      report: await buildPayslips({
        year: requested.data.year,
        month: requested.data.month,
        teacherIds: input.teacherId ? [input.teacherId] : undefined,
        includeInstitute: isAdmin,
      }),
      canPickMonth: true,
      canSeeInstitute: isAdmin,
      scopedToOwnSlip: false,
      lockedMonthLabel: null,
    },
  };
}
