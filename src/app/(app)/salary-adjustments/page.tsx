import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";
import { monthLabel } from "@/lib/receipts";
import { parsePayrollMonth } from "@/lib/salary-adjustments";

import { listAdjustments } from "./actions";
import { AdjustmentList } from "./adjustment-list";

export const metadata = { title: "Salary adjustments" };

const FIELD = "border-input bg-background h-11 rounded-md border px-3 py-1 text-sm shadow-xs";
const toStr = (v: string | string[] | undefined) => {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw !== "" ? raw : undefined;
};

/** ADMIN only. The nav guard first, then not-found for anyone else (rule 30). One validated month drives the query AND the form (rule 23). */
export default async function SalaryAdjustmentsPage({ searchParams }: PageProps<"/salary-adjustments">) {
  const user = await requireNavAccess("/salary-adjustments");
  if (user.role !== "ADMIN") notFound();

  const asked = parsePayrollMonth(toStr((await searchParams).month));
  const [cy, cm] = colomboNow().date.split("-").map(Number);
  const { year, month } = asked ?? { year: cy, month: cm };
  const value = `${year}-${String(month).padStart(2, "0")}`;
  const rows = await listAdjustments(year, month);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Salary adjustments</h1>
        <Button asChild className="min-h-11"><Link href="/salary-adjustments/new">New adjustment</Link></Button>
      </div>
      <p className="text-muted-foreground text-sm">Share an expense with teachers or staff, or pay them part of an income as a bonus. Teachers see it as a line on their payslip; staff are on the monthly list.</p>
      <form method="get" className="bg-muted flex flex-wrap items-end gap-3 rounded-xl border p-3">
        <div className="space-y-1">
          <label htmlFor="month" className="block text-sm font-medium">Payroll month</label>
          <input id="month" name="month" type="month" className={FIELD} defaultValue={value} />
        </div>
        <Button type="submit" variant="secondary" className="min-h-11">Show</Button>
        <Button asChild variant="outline" className="min-h-11"><Link href={`/salary-adjustments/staff?month=${value}`}>Staff list for {monthLabel(year, month)}</Link></Button>
      </form>
      {/* Keyed on the month (rule 17): another month is a fresh render, never props synced into state. */}
      <AdjustmentList key={value} rows={rows} label={monthLabel(year, month)} />
    </div>
  );
}
