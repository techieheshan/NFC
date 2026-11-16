import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { formatMoney } from "@/lib/cents";
import { colomboNow } from "@/lib/colombo-time";
import { monthLabel } from "@/lib/receipts";
import { parsePayrollMonth } from "@/lib/salary-adjustments";

import { staffMonthList } from "../actions";
import { PrintButton } from "../print-button";

export const metadata = { title: "Staff deductions and bonuses" };

const toStr = (v: string | string[] | undefined) => {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw !== "" ? raw : undefined;
};

/**
 * The staff list of a payroll month: staff shares of shared expenses (deductions) and bonuses, for whoever pays staff (this system holds no
 * staff salary). ADMIN only. One validated month drives the query and the heading (rule 23).
 */
export default async function StaffListPage({ searchParams }: PageProps<"/salary-adjustments/staff">) {
  const user = await requireNavAccess("/salary-adjustments");
  if (user.role !== "ADMIN") notFound();
  const asked = parsePayrollMonth(toStr((await searchParams).month));
  const [cy, cm] = colomboNow().date.split("-").map(Number);
  const { year, month } = asked ?? { year: cy, month: cm };
  const rows = await staffMonthList(year, month);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 15mm; }
          body > *:not(#xenon-print) { display: revert !important; }
          #xenon-print { display: none !important; }
          body * { visibility: hidden !important; }
          #staff-sheet, #staff-sheet * { visibility: visible !important; }
          #staff-sheet { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" className="min-h-11"><Link href={`/salary-adjustments?month=${year}-${String(month).padStart(2, "0")}`}>← Back</Link></Button>
        <PrintButton />
      </div>
      <div id="staff-sheet" className="space-y-4 rounded-xl border bg-white p-6 text-black">
        <div className="border-b pb-3">
          <p className="text-lg font-semibold">Staff deductions and bonuses</p>
          <p className="text-sm">Payroll month {monthLabel(year, month)}</p>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm">No staff deductions or bonuses in this month.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-black text-left"><th className="py-1">Staff</th><th className="py-1">What</th><th className="py-1 text-right">Amount</th></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <>
                  {s.lines.map((l, i) => (
                    <tr key={`${s.staffId}-${l.adjustmentId}`} className="border-b border-neutral-300">
                      <td className="py-1.5 font-medium">{i === 0 ? s.name : ""}</td>
                      <td className="py-1.5">{l.title} <span className="text-xs">({l.sign === "-" ? "deduction" : "bonus"})</span></td>
                      <td className="py-1.5 text-right tabular-nums">{l.sign}{formatMoney(l.amount)}</td>
                    </tr>
                  ))}
                  <tr key={`${s.staffId}-net`} className="border-b-2 border-black font-semibold">
                    <td className="py-1.5" colSpan={2}>{s.name}: net for the month</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(s.net)}</td>
                  </tr>
                </>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs">A minus is taken from the staff member&apos;s pay; a plus is added to it.</p>
        <div className="grid grid-cols-2 gap-10 pt-8 text-xs">
          <p className="border-t border-black pt-1">Prepared by</p>
          <p className="border-t border-black pt-1">Checked by (admin)</p>
        </div>
      </div>
    </div>
  );
}
