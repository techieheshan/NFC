import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { buildMonthlyIncome, currentColomboMonth } from "@/lib/report-monthly-income";

import { IncomeScreen } from "./income-report";

export const metadata = { title: "Month-end roll-up" };

const FIELD = "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-xs";

export default async function MonthlyIncomePage({
  searchParams,
}: PageProps<"/reports/monthly-income">) {
  const user = await requireNavAccess("/reports");
  // Institute income — not a teacher's view.
  if (user.role === "TEACHER") notFound();

  const params = await searchParams;
  const raw = Array.isArray(params.month) ? params.month[0] : params.month;
  const now = currentColomboMonth();
  const [year, month] =
    raw && /^\d{4}-\d{2}$/.test(raw) ? raw.split("-").map(Number) : [now.year, now.month];

  const report = await buildMonthlyIncome(year, month);
  const monthValue = `${year}-${String(month).padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Month-end roll-up</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The month closed off: each teacher&rsquo;s share, what the institute kept,
          and every advance and expense with the person who authorised it. By the
          date money was received — the same basis as the payslips.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <div className="space-y-2">
          <label htmlFor="month" className="block text-sm font-medium">Month</label>
          <input id="month" name="month" type="month" className={FIELD} defaultValue={monthValue} />
        </div>
        <Button type="submit">Show</Button>
        <Button asChild variant="ghost"><Link href="/reports/monthly-income">This month</Link></Button>
      </form>

      <IncomeScreen key={monthValue} report={report} />
    </div>
  );
}
