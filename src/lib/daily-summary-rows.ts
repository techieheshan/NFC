import { decimalToCents, formatCents } from "@/lib/cents";
import { displayName } from "@/lib/display-name";

/*
 * The pure steps of the read-only helpers in daily-summary-extras.ts, so they can be tested without a database (and so the
 * name each row gets is decided in ONE visible place). Behaviour is exactly what the helpers did inline before.
 */

export type StaffCollected = { userId: string; name: string; receipts: number; collected: string };

type MoneyLike = { toFixed(digits: number): string };

export const asCents = (d: MoneyLike) => decimalToCents(d.toFixed(2));

/** The data object's own string form: "76375.00", an ASCII "-" for a loss, never a thousands comma. */
export const money = (cents: number) => `${cents < 0 ? "-" : ""}${formatCents(Math.abs(cents)).replace(/,/g, "")}`;

/** The rows `dailySummary()` counts as collected money: admission, smart card, and a CLASS row that has a course. */
export const COUNTED = (p: { kind: string; courseId: number | null }) => (p.kind === "CLASS" ? p.courseId !== null : true);

export type StaffPaymentRow = {
  id: number;
  kind: string;
  courseId: number | null;
  amount: MoneyLike;
  transactionRef: string | null;
  takenById: string;
  takenBy: { username: string; staff?: { name: string } | null };
};

/** Receipts and money per taker. A receipt is a transaction (rule 18): a shared ref is one, a null ref stands alone. */
export function aggregateStaff(rows: readonly StaffPaymentRow[]): StaffCollected[] {
  const by = new Map<string, { name: string; keys: Set<string>; cents: number }>();
  for (const p of rows.filter(COUNTED)) {
    const e = by.get(p.takenById) ?? { name: displayName(p.takenBy), keys: new Set<string>(), cents: 0 };
    e.keys.add(p.transactionRef ?? `legacy:${p.id}`);
    e.cents += asCents(p.amount);
    by.set(p.takenById, e);
  }
  return [...by.entries()]
    .map(([userId, e]) => ({ userId, name: e.name, receipts: e.keys.size, cents: e.cents }))
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name))
    .map(({ cents, ...rest }) => ({ ...rest, collected: money(cents) }));
}
