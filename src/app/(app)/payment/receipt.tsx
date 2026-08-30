"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { to12Hour } from "@/lib/colombo-time";

import type { Receipt } from "./actions";

/**
 * 58mm thermal receipt (~384px at 203dpi), rendered from the rows just written.
 *
 * The same component prints the original and every reprint: `Payment.transactionRef`
 * groups the rows one checkout wrote, so the Receipts screen can rebuild this
 * exact document later. A voided transaction reprints with a CANCELLED band
 * across it — it must never come off the printer looking valid.
 *
 * Printing goes through the browser: `@page` is pinned to 58mm and everything
 * outside the receipt is hidden, so the same markup works on a thermal printer
 * driver today and a POS bridge later. Kept black-on-white — thermal paper has
 * no colour, and purple would render as mud.
 */
export function ReceiptView({
  receipt,
  onDone,
  doneLabel = "Next student",
}: {
  receipt: Receipt;
  onDone: () => void;
  doneLabel?: string;
}) {
  const voided = receipt.cancelled ?? null;

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          @page { size: 58mm auto; margin: 0; }
          body * { visibility: hidden !important; }
          #receipt, #receipt * { visibility: visible !important; }
          #receipt {
            position: absolute; left: 0; top: 0;
            width: 58mm; padding: 3mm 2mm;
            font-size: 10pt; color: #000; background: #fff;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="flex justify-center">
        <div
          id="receipt"
          className="w-[384px] max-w-full border bg-white p-4 font-mono text-[13px] leading-snug text-black"
        >
          <div className="text-center">
            <p className="text-base font-bold tracking-widest">XENON</p>
            <p className="text-[11px]">Institute</p>
          </div>

          {voided && (
            <>
              <Rule />
              <div className="border-y-2 border-black py-1 text-center">
                <p className="text-[15px] font-bold tracking-widest">*** CANCELLED ***</p>
                <p className="text-[11px]">
                  {voided.date} {to12Hour(voided.at)} by {voided.by}
                </p>
                <p className="text-[11px] break-words">{voided.reason}</p>
              </div>
            </>
          )}

          <Rule />

          <Row left={receipt.date} right={to12Hour(receipt.at)} />
          <Row left="Receipt" right={receipt.reference} />

          <Rule />

          <p className="font-bold">{receipt.student.name}</p>
          <p className="text-[11px]">{receipt.student.cardNumber ?? "no card number"}</p>

          <Rule />

          {receipt.lines.map((l, i) => (
            <div key={i} className="mb-1">
              {/* Long course names wrap above their amount rather than
                  truncating — the amount must always be readable. */}
              <p className="break-words">{l.label}</p>
              <p className="text-right tabular-nums">{l.amount}</p>
            </div>
          ))}

          <Rule />

          <div className="flex justify-between text-[15px] font-bold">
            <span>TOTAL</span>
            <span className="tabular-nums">{receipt.total}</span>
          </div>

          <Rule />

          <Row left="Taken by" right={receipt.takenBy} />
          <p className="mt-3 text-center text-[11px]">
            {voided ? "This receipt has been cancelled." : "Thank you"}
          </p>
        </div>
      </div>

      <div className="no-print mx-auto flex max-w-md gap-2">
        <Button variant="outline" className="flex-1 gap-2" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          Print
        </Button>
        <Button className="flex-1" onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
    </div>
  );
}

function Rule() {
  return <p className="my-2 overflow-hidden text-[11px] whitespace-nowrap">{"-".repeat(48)}</p>;
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{left}</span>
      <span className="tabular-nums">{right}</span>
    </div>
  );
}
