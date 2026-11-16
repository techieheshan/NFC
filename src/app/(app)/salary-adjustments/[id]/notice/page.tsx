import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { formatMoney } from "@/lib/cents";
import { friendlyDate } from "@/lib/friendly-date";
import { monthLabel } from "@/lib/receipts";

import { getAdjustment } from "../../actions";
import { PrintButton } from "../../print-button";

export const metadata = { title: "Salary adjustment notice" };

/** A one-page notice for the people named, to sign. ADMIN only; a junk id or a missing adjustment is not-found. */
export default async function NoticePage({ params }: PageProps<"/salary-adjustments/[id]/notice">) {
  const user = await requireNavAccess("/salary-adjustments");
  if (user.role !== "ADMIN") notFound();
  const a = await getAdjustment(Number((await params).id));
  if (!a) notFound();
  const expense = a.kind === "SHARED_EXPENSE";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 15mm; }
          body > *:not(#xenon-print) { display: revert !important; }
          #xenon-print { display: none !important; }
          body * { visibility: hidden !important; }
          #notice, #notice * { visibility: visible !important; }
          #notice { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" className="min-h-11"><Link href={`/salary-adjustments?month=${a.year}-${String(a.month).padStart(2, "0")}`}>← Back</Link></Button>
        <PrintButton />
      </div>
      <div id="notice" className="space-y-4 rounded-xl border bg-white p-6 text-black">
        <div className="border-b pb-3">
          <p className="text-lg font-semibold">Notice of salary adjustment {a.cancelled ? "(CANCELLED)" : ""}</p>
          <p className="text-sm">{a.title} · payroll month {monthLabel(a.year, a.month)}</p>
        </div>
        <p className="text-sm">
          {expense
            ? `Xenon paid ${formatMoney(a.total)} for: ${a.source.replace(/^Expense: /, "")}. ${formatMoney(a.shared)} of it is shared with the people below and will be taken from their pay for ${monthLabel(a.year, a.month)}. Xenon bears ${formatMoney(a.institute)}.`
            : `Xenon received ${formatMoney(a.total)} (${a.source.replace(/^Income: /, "")}). ${formatMoney(a.shared)} of it will be paid to the people below as a bonus with their pay for ${monthLabel(a.year, a.month)}. Xenon keeps ${formatMoney(a.institute)}.`}
        </p>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-black text-left"><th className="py-1">Name</th><th className="py-1">Is</th><th className="py-1 text-right">{expense ? "Pays" : "Receives"}</th><th className="py-1 pl-6">Signature</th></tr>
          </thead>
          <tbody>
            {a.people.map((p) => (
              <tr key={p.key} className="border-b border-neutral-400"><td className="py-3">{p.name}</td><td className="py-3">{p.kind === "teacher" ? "Teacher" : "Staff"}</td><td className="py-3 text-right tabular-nums">{formatMoney(p.amount)}</td><td className="py-3 pl-6" /></tr>
            ))}
          </tbody>
        </table>
        <p className="text-sm">Agreed on {friendlyDate(a.consentOn)}: {a.consentNote}</p>
        <p className="text-xs">Entered by {a.createdBy}.</p>
        <div className="grid grid-cols-2 gap-10 pt-8 text-xs">
          <p className="border-t border-black pt-1">Approved by (admin)</p>
          <p className="border-t border-black pt-1">Date</p>
        </div>
      </div>
    </div>
  );
}
