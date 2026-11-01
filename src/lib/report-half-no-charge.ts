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

/**
 * What a `?month=` value means. Only YYYY-MM with a real month and a year in 2000-2100; anything else —
 * including well-formed years like 0999 or 9999 that the date maths cannot build — is junk and means the
 * fallback (the current month), never an error page. (Rule 23: junk in the URL is ignored, not rendered.)
 */
export function parseMonthParam(raw: string | undefined, fallback: { year: number; month: number }): { year: number; month: number } {
  const m = raw ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw) : null;
  if (!m) return fallback;
  const year = Number(m[1]);
  if (year < 2000 || year > 2100) return fallback;
  return { year, month: Number(m[2]) };
}

/** The roles whose people are "current staff" here; anyone else who took a payment is a FORMER taker. */
const CURRENT_ROLES = ["ADMIN", "STAFF"];

/**
 * How a person who took payments is named: their Staff record's name or their username; with "(former role)" when
 * they no longer hold an ADMIN or STAFF login (their old rows still need a name); and "Unknown user (#id)" when the
 * user cannot be found at all. NEVER a dash — a review screen must say who recorded what.
 */
export function takerName(
  id: string,
  user: { username: string; role: string; staff: { name: string } | null } | null | undefined,
): string {
  if (!user) return `Unknown user (#${id})`;
  const name = user.staff?.name ?? user.username;
  return CURRENT_ROLES.includes(user.role) ? name : `${name} (former role)`;
}

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

  // Everyone who can be NAMED: every current ADMIN / STAFF login, plus anyone who took one of these months in this
  // month but no longer holds such a login. The person filter accepts exactly the people it OFFERS: any other id
  // (no such user, a teacher, a former taker with nothing this month) is junk and is ignored (rule 23), so the
  // select and the report can never disagree.
  const userSelect = { id: true, username: true, role: true, staff: { select: { name: true } } } as const;
  const [users, monthTakers] = await Promise.all([
    db.user.findMany({
      where: { role: { in: CURRENT_ROLES as ("ADMIN" | "STAFF")[] } },
      select: userSelect,
      orderBy: { username: "asc" },
    }),
    // Everyone who recorded a Half or No-charge month in this month (any person, any kind): the names the
    // report and its person filter may need, whatever role they hold today.
    db.payment.groupBy({
      by: ["takenById"],
      where: { kind: "CLASS", paidAt: window, chargeMode: { in: ["HALF", "NO_CHARGE"] } },
    }),
  ]);
  const known = new Map<string, (typeof users)[number] | null>(users.map((u) => [u.id, u]));
  const asked = options.staffId ?? null;
  const offered = new Set([...users.map((u) => u.id), ...monthTakers.map((t) => t.takenById)]);
  const staffId = asked && offered.has(asked) ? asked : null;

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
        takenById: true,
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

  // Look up the takers who are not current ADMIN / STAFF (a changed role), once.
  const missing = [...new Set([...monthTakers.map((t) => t.takenById), ...grouped.map((g) => g.takenById), ...listed.map((r) => r.takenById)])].filter((id) => !known.has(id));
  if (missing.length > 0) {
    for (const u of await db.user.findMany({ where: { id: { in: missing } }, select: userSelect })) known.set(u.id, u);
    for (const id of missing) if (!known.has(id)) known.set(id, null);
  }
  const nameOf = (id: string) => takerName(id, known.get(id));

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
        name: nameOf(userId),
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
      takenBy: nameOf(r.takenById),
      cancelled: r.cancelled,
    };
  });

  return {
    year,
    month,
    label: monthLabel(year, month),
    mode,
    staffId,
    // current ADMIN / STAFF first (by username), then anyone who took one of these months but no longer qualifies
    staffOptions: [
      ...users.map((u) => ({ id: u.id, name: nameOf(u.id) })),
      ...monthTakers
        .map((t) => t.takenById)
        .filter((id) => !users.some((u) => u.id === id))
        .map((id) => ({ id, name: nameOf(id) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ],
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
