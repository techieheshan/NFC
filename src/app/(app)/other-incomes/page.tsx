import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { formatCents } from "@/lib/cents";
import { colomboNow } from "@/lib/colombo-time";
import { parseRealDate } from "@/lib/daily-summary-dates";
import { splitIncomeTotals } from "@/lib/other-income";
import { columnToCents } from "@/lib/saved-day/money";

import { listActiveCategories, listIncomes, listReceivers } from "./actions";
import { IncomeScreen } from "./income-screen";

export const metadata = { title: "Other incomes" };

const FIELD = "border-input bg-background h-11 rounded-md border px-3 py-1 text-sm shadow-xs";

const toStr = (v: string | string[] | undefined) => {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw !== "" ? raw : undefined;
};

export default async function OtherIncomesPage({ searchParams }: PageProps<"/other-incomes">) {
  // Viewing and adding are ADMIN + STAFF; the nav config is the one source for that (rule 7).
  const user = await requireNavAccess("/other-incomes");
  const params = await searchParams;
  const today = colomboNow().date;

  // Junk in the URL is ignored, never an empty page or a crash (rule 23): one validated value drives the query AND the form.
  const from = parseRealDate(toStr(params.from)) ?? `${today.slice(0, 8)}01`;
  const to = parseRealDate(toStr(params.to)) ?? today;
  const category = toStr(params.category);

  const [rows, categories, receivers] = await Promise.all([
    listIncomes({ from, to, category }),
    listActiveCategories(),
    listReceivers(),
  ]);
  const t = splitIncomeTotals(rows.map((r) => ({ cents: columnToCents(r.amount), method: r.method, cancelled: r.cancelled })));

  const filterUi = (
    <form method="get" className="bg-muted flex flex-wrap items-end gap-3 rounded-xl border p-3">
      <div className="space-y-1">
        <label htmlFor="from" className="block text-sm font-medium">From</label>
        <input id="from" name="from" type="date" className={FIELD} defaultValue={from} />
      </div>
      <div className="space-y-1">
        <label htmlFor="to" className="block text-sm font-medium">To</label>
        <input id="to" name="to" type="date" className={FIELD} defaultValue={to} />
      </div>
      <div className="space-y-1">
        <label htmlFor="category" className="block text-sm font-medium">Category</label>
        <select id="category" name="category" className={FIELD} defaultValue={category ?? ""}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="secondary" className="min-h-11">Filter</Button>
      {user.role === "ADMIN" && (
        <Button asChild variant="ghost" className="min-h-11">
          <Link href="/other-incomes/categories">Categories</Link>
        </Button>
      )}
    </form>
  );

  return (
    <IncomeScreen
      // A filter change is a fresh server render; keying on it remounts the screen instead of syncing props into state (rule 17).
      key={`${from}|${to}|${category ?? ""}`}
      rows={rows}
      categories={categories}
      receivers={receivers}
      canCancel={user.role === "ADMIN"}
      today={today}
      defaultReceiverId={receivers.some((r) => r.id === user.id) ? user.id : ""}
      totals={{ cash: formatCents(t.cash), bank: formatCents(t.bank), live: t.cashRows + t.bankRows }}
      filterUi={filterUi}
    />
  );
}
