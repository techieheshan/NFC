import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { formatMoney } from "@/lib/cents";
import { friendlyDate } from "@/lib/friendly-date";
import { incomeVoucherRef } from "@/lib/other-income";

import { getIncome } from "../../actions";
import { PrintButton } from "./print-button";

export const metadata = { title: "Income voucher" };

/** One A5-sized voucher for one income. ADMIN + STAFF; a TEACHER, a junk id or a missing income is not-found. */
export default async function IncomeVoucherPage({ params }: PageProps<"/other-incomes/[id]/voucher">) {
  await requireNavAccess("/other-incomes");
  const { id } = await params;
  const income = await getIncome(Number(id));
  if (!income) notFound();

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <style>{`
        @media print {
          @page { size: A5 landscape; margin: 10mm; }
          /* globals.css hides everything but the receipt's #xenon-print while printing: give the voucher back. */
          body > *:not(#xenon-print) { display: revert !important; }
          #xenon-print { display: none !important; }
          body * { visibility: hidden !important; }
          #voucher, #voucher * { visibility: visible !important; }
          #voucher { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" className="min-h-11"><Link href="/other-incomes">← Back to other incomes</Link></Button>
        <PrintButton />
      </div>

      <div id="voucher" className="space-y-4 rounded-xl border bg-white p-6 text-black">
        <div className="flex items-start justify-between gap-4 border-b pb-3">
          <div>
            <p className="text-lg font-semibold">Income voucher</p>
            <p className="text-sm">{income.cancelled ? "CANCELLED" : "Money received"}</p>
          </div>
          <p className="text-lg font-semibold tabular-nums">{incomeVoucherRef(income.id)}</p>
        </div>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="font-medium">Date</dt><dd>{friendlyDate(income.date)}</dd>
          <dt className="font-medium">Category</dt><dd>{income.categoryLabel}</dd>
          <dt className="font-medium">From</dt><dd>{income.source ?? "—"}</dd>
          <dt className="font-medium">How</dt><dd>{income.method === "CASH" ? "Cash" : "Bank transfer"}</dd>
          <dt className="font-medium">Received by</dt><dd>{income.receivedBy}</dd>
          <dt className="font-medium">Entered by</dt><dd>{income.recordedBy}</dd>
          {income.note && (<><dt className="font-medium">Note</dt><dd>{income.note}</dd></>)}
          <dt className="font-medium">Amount</dt><dd className="text-base font-semibold tabular-nums">{formatMoney(income.amount)}</dd>
          {income.cancelled && (<><dt className="font-medium">Cancelled</dt><dd>{income.cancelledBy ?? "an admin"}: {income.cancelReason}</dd></>)}
        </dl>
        <div className="grid grid-cols-2 gap-8 pt-8 text-xs">
          <p className="border-t pt-1">Received by (signature)</p>
          <p className="border-t pt-1">Checked by (signature)</p>
        </div>
      </div>
    </div>
  );
}
