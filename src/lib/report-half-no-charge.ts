import "server-only";

import { colomboNow } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { monthInstants, monthLabel } from "@/lib/payslips";
import { chargeModeSuffix, transactionKey } from "@/lib/receipts";

/**
 * "Half and No-charge months", for the ADMIN who reviews what staff recorded. Staff may record Half and
 * No charge freely (decided); this is where an admin sees who recorded what.
 *
 * READ-ONLY, and a CASH question — "what was recorded during this month?" — so the month is `paidAt`,
 * cut at the same Colombo midnight as the payslips and the month-end roll-up (`monthInstants`).
 *
 * The rules, each of which has a test:
 *   - The per-staff counts and totals are computed over EVERY row in the filter (a groupBy), never from
 *     the detail list, which is capped to the newest DETAIL_CAP rows.
 *   - Cancelled rows are listed (greyed, with a chip) but are in no count and no total.
 *   - A row is Half or No charge by a POSITIVE match (`chargeMode in (HALF, NO_CHARGE)`): NULL — a
 *     full-fee row — never matches, and is never filtered with `not`.
 *   - "Share of their months": the staff member's non-cancelled class-month rows in the same month and
 *     the same staff filter (NULL chargeMode counted as normal), whatever mode is being viewed.
 *   - The receipt number is the lowest payment id of the row's transaction, exactly as the receipts
 *     show it; a legacy row with no ref is its own receipt and is never matched on `transactionRef: null`.
 */

export const DETAIL_CAP = 300;

export type ModeFilter = "HALF" | "NO_CHARGE" | null;

/** What a `?mode=` value means. Anything else is "both" — junk is ignored, not an empty report. */
export const parseModeFilter = (raw: string | undefined): ModeFilter =>
  raw === "half" ? "HALF" : raw === "nocharge" ? "NO_CHARGE" : null;

export type StaffRow = {
  userId: string;
  name: string;
  half: number;
  halfAmount: string;
  noCharge: number;
  /** Half + No-charge months (for the mode being viewed) out of all of this person's months. */
  share: { months: number; all: number; percent: number };
};

export type DetailRow = {
  id: number;
  receipt: string;
  receiptKey: string;
  date: string;
  at: string;
  student: string;
  studentId: number;
  cardNumber: string | null;
  course: string;
  billing: string | null;
  mode: "HALF" | "NO_CHARGE";
  amount: string;
  takenBy: string;
  cancelled: boolean;
};

export type HalfNoChargeReport = {
  year: number;
  month: number;
  label: string;
  mode: ModeFilter;
  staffId: string | null;
  /** Who can be picked in the filter. */
  staffOptions: { id: string; name: string }[];
  staff: StaffRow[];
  totals: { half: number; halfAmount: string; noCharge: number; all: number };
  rows: DetailRow[];
  /** Every row in the filter, cancelled ones included — what the capped list is a part of. */
  rowCount: number;
  capped: boolean;
  /** Rows shown greyed that are in no count and no total. */
  cancelledCount: number;
};

const money = (n: number) => n.toFixed(2);
const num = (v: unknown) => Number(String(v ?? 0));

export async function buildHalfNoChargeReport(options: {
  year: number;
  month: number;
  mode?: ModeFilter;
  staffId?: string | null;
}): Promise<HalfNoChargeReport> {
  const { year, month } = options;
  const mode = options.mode ?? null;
  const window = monthInstants(year, month);

  // Staff the filter may name: every ADMIN / STAFF login. An unknown id is ignored, not an empty report.
  const users = await db.user.findMany({
    where: { role: { in: ["ADMIN", "STAFF"] } },
    select: { id: true, username: true, staff: { select: { name: true } } },
    orderBy: { username: "asc" },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.staff?.name ?? u.username]));
  const staffId = options.staffId && nameOf.has(options.staffId) ? options.staffId : null;

  const modes = mode ? [mode] : (["HALF", "NO_CHARGE"] as const);
  const base = {
    kind: "CLASS" as const,
    paidAt: window,
    ...(staffId ? { takenById: staffId } : {}),
  };
  const inMode = { ...base, chargeMode: { in: [...modes] } };

  const [grouped, allMonths, listed, rowCount, cancelledCount] = await Promise.all([
    // Counts and totals: EVERY non-cancelled row in the filter, grouped — not the capped list.
    db.payment.groupBy({
      by: ["takenById", "chargeMode"],
      where: { ...inMode, cancelled: false },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    // The denominator: all of each person's non-cancelled class months (NULL counted as normal).
    db.payment.groupBy({
      by: ["takenById"],
      where: { ...base, cancelled: false },
      _count: { _all: true },
    }),
    db.payment.findMany({
      where: inMode,
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      take: DETAIL_CAP,
      select: {
        id: true,
        amount: true,
        paidAt: true,
        billingYear: true,
        billingMonth: true,
        chargeMode: true,
        cancelled: true,
        transactionRef: true,
        takenBy: { select: { username: true, staff: { select: { name: true } } } },
        student: { select: { id: true, name: true, cardNumber: true } },
        course: {
          select: {
            name: true,
            grade: { select: { label: true } },
            subject: { select: { label: true } },
            classType: { select: { label: true } },
            teacher: { select: { name: true } },
          },
        },
      },
    }),
    db.payment.count({ where: inMode }),
    db.payment.count({ where: { ...inMode, cancelled: true } }),
  ]);

  // ---- per staff, over every row in the filter ----
  const perStaff = new Map<string, { half: number; halfAmount: number; noCharge: number }>();
  for (const g of grouped) {
    const entry = perStaff.get(g.takenById) ?? { half: 0, halfAmount: 0, noCharge: 0 };
    if (g.chargeMode === "HALF") {
      entry.half += g._count._all;
      entry.halfAmount += num(g._sum.amount);
    } else if (g.chargeMode === "NO_CHARGE") {
      entry.noCharge += g._count._all;
    }
    perStaff.set(g.takenById, entry);
  }
  const allOf = new Map(allMonths.map((g) => [g.takenById, g._count._all]));
  const staff: StaffRow[] = [...perStaff]
    .map(([userId, v]) => {
      const months = v.half + v.noCharge;
      const all = allOf.get(userId) ?? months;
      return {
        userId,
        name: nameOf.get(userId) ?? "—",
        half: v.half,
        halfAmount: money(v.halfAmount),
        noCharge: v.noCharge,
        share: { months, all, percent: all > 0 ? Math.round((months / all) * 100) : 0 },
      };
    })
    .sort((a, b) => b.half + b.noCharge - (a.half + a.noCharge) || a.name.localeCompare(b.name));

  const totals = {
    half: staff.reduce((s, r) => s + r.half, 0),
    halfAmount: money(staff.reduce((s, r) => s + Number(r.halfAmount), 0)),
    noCharge: staff.reduce((s, r) => s + r.noCharge, 0),
    all: [...allOf.values()].reduce((s, n) => s + n, 0),
  };

  // ---- the receipt number of each listed row: the LOWEST id of its transaction ----
  const refs = [...new Set(listed.flatMap((r) => (r.transactionRef ? [r.transactionRef] : [])))];
  const lowest = new Map<string, number>();
  if (refs.length > 0) {
    const mins = await db.payment.groupBy({ by: ["transactionRef"], where: { transactionRef: { in: refs } }, _min: { id: true } });
    for (const m of mins) if (m.transactionRef && m._min.id !== null) lowest.set(m.transactionRef, m._min.id);
  }

  const rows: DetailRow[] = listed.map((r) => {
    const when = colomboNow(r.paidAt);
    return {
      id: r.id,
      // a legacy row with no ref is a receipt of one: its own id
      receipt: `XN-${r.transactionRef ? (lowest.get(r.transactionRef) ?? r.id) : r.id}`,
      receiptKey: transactionKey(r),
      date: when.date,
      at: when.time,
      student: r.student.name,
      studentId: r.student.id,
      cardNumber: r.student.cardNumber,
      course: r.course ? courseDisplayName(r.course) : "Class fee",
      billing: r.billingYear !== null && r.billingMonth !== null ? monthLabel(r.billingYear, r.billingMonth) : null,
      mode: r.chargeMode as "HALF" | "NO_CHARGE",
      amount: money(num(r.amount)),
      takenBy: r.takenBy.staff?.name ?? r.takenBy.username,
      cancelled: r.cancelled,
    };
  });

  return {
    year,
    month,
    label: monthLabel(year, month),
    mode,
    staffId,
    staffOptions: users.map((u) => ({ id: u.id, name: u.staff?.name ?? u.username })),
    staff,
    totals,
    rows,
    rowCount,
    capped: rowCount > rows.length,
    cancelledCount,
  };
}

/** The label a row's mode reads as: the receipts' own words, without the brackets. */
export const modeLabel = (mode: "HALF" | "NO_CHARGE") => chargeModeSuffix(mode).trim().replace(/^\(|\)$/g, "");
