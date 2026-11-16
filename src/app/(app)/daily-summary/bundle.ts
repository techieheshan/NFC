import "server-only";

import { auth } from "@/auth";
import { requireRole } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";
import { resolveDay, resolveRange } from "@/lib/daily-summary-dates";
import {
  cancelledReceipts, collectedByStaff, dayByDay,
  type CancelledSummary, type DayFigures, type StaffCollected,
} from "@/lib/daily-summary-extras";
import { otherInByDay, otherInFor } from "@/lib/daily-summary-other-in";
import { db } from "@/lib/db";
import { displayName } from "@/lib/display-name";
import { otherInSnap, type OtherInSnap } from "@/lib/other-in-snap";
import { centsToDecimalString } from "@/lib/saved-day/money";
import { dailySummary, type DailySummary } from "@/lib/reports";

import { splitSigners, type Signer } from "./signer-lists";

/**
 * The guarded loaders behind the Daily Summary screens and the A4 document.
 *
 * Every figure is READ: `dailySummary()` untouched, plus the read-only helpers in
 * `lib/daily-summary-extras.ts`. Nothing here writes. Each loader checks the role first — the page guard
 * protects the render, but these are what reach the data (rule 10) — and validates its dates itself
 * (a real calendar day in 2000..2100, else today), so a hostile query string never reaches a query.
 */

const OPERATIONAL = ["ADMIN", "STAFF"] as const;

export type DayBundle = {
  date: string;
  today: string;
  report: DailySummary;
  cancelled: CancelledSummary;
  staff: StaffCollected[];
  /** Other income of the day. ABSENT on a day with none, so such a day is exactly what it was. */
  otherIn?: OtherInSnap;
  signers: { prepared: Signer[]; checked: Signer[] };
  /** Who is signed in, named as staff know them — printed in the document footer. */
  generatedBy: string;
};

export type RangeBundle = {
  from: string;
  to: string;
  today: string;
  /** The range was longer than a year and was cut. */
  clamped: boolean;
  report: DailySummary;
  cancelled: CancelledSummary;
  byDay: { days: DayFigures[]; total: DayFigures };
  /** Other income of the range, ABSENT when there is none. Cash and bank per day only appear then. */
  otherIn?: OtherInSnap;
  otherByDay?: Record<string, { cash: string; bank: string }>;
  generatedBy: string;
};

async function signedInName(): Promise<string> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return "unknown";
  const u = await db.user.findUnique({ where: { id }, select: { username: true, staff: { select: { name: true } } } });
  return u ? displayName(u) : session!.user.username;
}

async function activeSigners() {
  const users = await db.user.findMany({
    where: { active: true, role: { in: ["ADMIN", "STAFF"] } },
    select: { id: true, username: true, role: true, staff: { select: { name: true } } },
    orderBy: [{ role: "asc" }, { username: "asc" }],
  });
  return splitSigners(users);
}

export async function loadDayBundle(rawDate: unknown): Promise<DayBundle> {
  await requireRole([...OPERATIONAL]);
  const today = colomboNow().date;
  const date = resolveDay(rawDate, today);
  const [report, cancelled, staff, other, signers, generatedBy] = await Promise.all([
    dailySummary(date, date),
    cancelledReceipts(date, date),
    collectedByStaff(date, date),
    otherInFor(date, date),
    activeSigners(),
    signedInName(),
  ]);
  const otherIn = otherInSnap(other);
  return { date, today, report, cancelled, staff, ...(otherIn ? { otherIn } : {}), signers, generatedBy };
}

export async function loadRangeBundle(rawFrom: unknown, rawTo: unknown): Promise<RangeBundle> {
  await requireRole([...OPERATIONAL]);
  const today = colomboNow().date;
  const { from, to, clamped } = resolveRange(rawFrom, rawTo, today);
  const [report, cancelled, byDay, other, generatedBy] = await Promise.all([
    dailySummary(from, to),
    cancelledReceipts(from, to),
    dayByDay(from, to),
    otherInFor(from, to),
    signedInName(),
  ]);
  const otherIn = otherInSnap(other);
  const otherByDay = otherIn
    ? Object.fromEntries([...otherInByDay(other)].map(([d, v]) => [d, { cash: centsToDecimalString(v.cash), bank: centsToDecimalString(v.bank) }]))
    : undefined;
  return { from, to, today, clamped, report, cancelled, byDay, ...(otherIn ? { otherIn, otherByDay } : {}), generatedBy };
}
