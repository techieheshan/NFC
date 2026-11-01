import "server-only";

import { colomboDateValue, colomboNextDay, colomboNow, colomboRangeUtc } from "@/lib/colombo-time";
import { db } from "@/lib/db";
import { decimalToCents, formatCents } from "@/lib/cents";
import { shiftDay } from "@/lib/daily-summary-dates";

/*
 * Daily Summary R1: the three READ-ONLY figures the new screens need that `dailySummary()` does not give.
 * They live in their own file on purpose — `dailySummary()` and its data object are pinned byte for byte by
 * the golden masters and are not edited. Each helper reads with the SAME filters `dailySummary()` uses
 * (paidAt in the half-open Colombo range, cancelled excluded, a CLASS row only when it has a course), sums
 * in integer cents, and never writes. They are not server actions: the guarded loaders in `bundle.ts`
 * (which call `requireRole` first) are the only way the screens reach them.
 */

const asCents = (d: { toFixed(n: number): string }) => decimalToCents(d.toFixed(2));
/** The data object's own string form: "76375.00", an ASCII "-" for a loss, never a thousands comma. */
const money = (cents: number) => `${cents < 0 ? "-" : ""}${formatCents(Math.abs(cents)).replace(/,/g, "")}`;

/** The rows `dailySummary()` counts as collected money: admission, smart card, and a CLASS row that has a course. */
const COUNTED = (p: { kind: string; courseId: number | null }) => (p.kind === "CLASS" ? p.courseId !== null : true);

// ---- cancelled receipts (not counted anywhere else) ------------------------------------------------------------

export type CancelledSummary = { receipts: number; total: string };

/**
 * Receipts cancelled out of this range (by when the money was taken, `paidAt`, like the summary itself).
 * A receipt is a transaction (rule 18): rows sharing a `transactionRef` are one; a legacy row with a null
 * ref stands alone. The total is what they WOULD have added — shown as "not counted".
 */
export async function cancelledReceipts(from: string, to: string): Promise<CancelledSummary> {
  const rows = await db.payment.findMany({
    where: { cancelled: true, paidAt: colomboRangeUtc(from, to) },
    select: { id: true, amount: true, transactionRef: true },
  });
  const keys = new Set(rows.map((r) => r.transactionRef ?? `legacy:${r.id}`));
  return { receipts: keys.size, total: money(rows.reduce((s, r) => s + asCents(r.amount), 0)) };
}

// ---- collected by staff -----------------------------------------------------------------------------------------

export type StaffCollected = { userId: string; name: string; receipts: number; collected: string };

/** Receipts and money per `takenById`. The sum of `collected` is exactly the summary's Total collected. */
export async function collectedByStaff(from: string, to: string): Promise<StaffCollected[]> {
  const rows = await db.payment.findMany({
    where: { cancelled: false, paidAt: colomboRangeUtc(from, to) },
    select: {
      id: true, kind: true, courseId: true, amount: true, transactionRef: true, takenById: true,
      takenBy: { select: { username: true, staff: { select: { name: true } } } },
    },
  });
  const by = new Map<string, { name: string; keys: Set<string>; cents: number }>();
  for (const p of rows.filter(COUNTED)) {
    const e = by.get(p.takenById) ?? { name: p.takenBy.staff?.name ?? p.takenBy.username, keys: new Set<string>(), cents: 0 };
    e.keys.add(p.transactionRef ?? `legacy:${p.id}`);
    e.cents += asCents(p.amount);
    by.set(p.takenById, e);
  }
  return [...by.entries()]
    .map(([userId, e]) => ({ userId, name: e.name, receipts: e.keys.size, cents: e.cents }))
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name))
    .map(({ cents, ...rest }) => ({ ...rest, collected: money(cents) }));
}

// ---- day by day ------------------------------------------------------------------------------------------------

export type DayFigures = { date: string; collected: string; deductions: string; net: string };

/**
 * One figure set per calendar day in the range, from TWO queries (payments, expenses) however long the range
 * is — never one call per day. A payment belongs to the Colombo day of its `paidAt`; an expense to its own
 * date (the same two clocks `dailySummary()` uses). Days with nothing are listed with zeros.
 */
export async function dayByDay(from: string, to: string): Promise<{ days: DayFigures[]; total: DayFigures }> {
  const [payments, expenses] = await Promise.all([
    db.payment.findMany({
      where: { cancelled: false, paidAt: colomboRangeUtc(from, to) },
      select: { kind: true, courseId: true, amount: true, paidAt: true },
    }),
    db.expense.findMany({
      where: { date: { gte: colomboDateValue(from), lt: colomboDateValue(colomboNextDay(to)) } },
      select: { amount: true, date: true },
    }),
  ]);

  const collected = new Map<string, number>();
  for (const p of payments.filter(COUNTED)) {
    const day = colomboNow(p.paidAt).date;
    collected.set(day, (collected.get(day) ?? 0) + asCents(p.amount));
  }
  const deducted = new Map<string, number>();
  for (const e of expenses) {
    const day = e.date.toISOString().slice(0, 10);
    deducted.set(day, (deducted.get(day) ?? 0) + asCents(e.amount));
  }

  const days: DayFigures[] = [];
  let c = 0;
  let d = 0;
  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    const dc = collected.get(day) ?? 0;
    const dd = deducted.get(day) ?? 0;
    c += dc;
    d += dd;
    days.push({ date: day, collected: money(dc), deductions: money(dd), net: money(dc - dd) });
  }
  return { days, total: { date: "total", collected: money(c), deductions: money(d), net: money(c - d) } };
}
