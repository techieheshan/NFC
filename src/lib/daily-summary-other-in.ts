import "server-only";

import { colomboDateValue, colomboNextDay } from "@/lib/colombo-time";
import { db } from "@/lib/db";
import { columnToCents } from "@/lib/saved-day/money";
import type { IncomeMethodValue } from "@/lib/other-income";

/*
 * Other incomes on the Daily Summary: a READ-ONLY helper in the style of `daily-summary-extras.ts`. `dailySummary()` and its
 * data object are not edited (the golden masters pin them byte for byte); the day's other income is read here, with its own
 * query, and handed to the cash flow as an optional extra. A day with no other income returns nothing at all, so every
 * screen and the A4 document stay exactly as they were.
 *
 * Not a server action: the guarded loaders in `daily-summary/bundle.ts` (which call `requireRole` first) are the only way in.
 */

export type OtherInRow = {
  id: number;
  /** "YYYY-MM-DD". */
  date: string;
  category: string;
  source: string | null;
  receivedBy: string;
  /** Integer cents. */
  cents: number;
  method: IncomeMethodValue;
};

export type OtherIn = {
  /** Cash taken into the drawer, in cents. ONLY this reaches "Should be in the drawer". */
  cash: number;
  /** Bank transfers, in cents: listed, never added to the drawer. */
  bank: number;
  rows: OtherInRow[];
};

export const NO_OTHER_IN: OtherIn = { cash: 0, bank: 0, rows: [] };

/** Every live (not cancelled) other income dated within `from`..`to` (Colombo days, inclusive). */
export async function otherInFor(from: string, to: string): Promise<OtherIn> {
  const rows = await db.otherIncome.findMany({
    where: { cancelled: false, date: { gte: colomboDateValue(from), lt: colomboDateValue(colomboNextDay(to)) } },
    select: {
      id: true, date: true, amount: true, source: true, method: true,
      category: { select: { label: true } },
      receivedBy: { select: { username: true, staff: { select: { name: true } } } },
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  const out: OtherInRow[] = rows.map((r) => ({
    id: r.id,
    date: r.date.toISOString().slice(0, 10),
    category: r.category.label,
    source: r.source,
    receivedBy: r.receivedBy.staff?.name ?? r.receivedBy.username,
    cents: columnToCents(r.amount),
    method: r.method,
  }));
  return {
    cash: out.filter((r) => r.method === "CASH").reduce((s, r) => s + r.cents, 0),
    bank: out.filter((r) => r.method === "BANK").reduce((s, r) => s + r.cents, 0),
    rows: out,
  };
}

/** Cash and bank per calendar day, for the "Several days" table (one query for the whole range). */
export function otherInByDay(other: OtherIn): Map<string, { cash: number; bank: number }> {
  const m = new Map<string, { cash: number; bank: number }>();
  for (const r of other.rows) {
    const d = m.get(r.date) ?? { cash: 0, bank: 0 };
    if (r.method === "CASH") d.cash += r.cents;
    else d.bank += r.cents;
    m.set(r.date, d);
  }
  return m;
}
