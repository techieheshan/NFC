"use client";

import { useEffect, useRef } from "react";
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { to12Hour } from "@/lib/colombo-time";
import { friendlyDate } from "@/lib/friendly-date";

import type { ExtraReceipt } from "./actions";

/**
 * The 58 mm receipt of an extra payment ("XA-<id>"). It uses the same paper classes and the same `#xenon-print` technique as the class
 * receipt (`payment/receipt.tsx`, which is NOT touched: its Paper and PrintCopy are private, so the ~40 lines are copied here). A
 * cancelled bill reprints with a CANCELLED band, so it can never come off the printer looking valid. Black on white: thermal paper has no colour.
 */
export function ExtraReceiptView({
  receipt, onDone, doneLabel = "New sale", autoPrint = false,
}: {
  receipt: ExtraReceipt;
  onDone: () => void;
  doneLabel?: string;
  /** Open the browser's print dialog once, when the receipt appears (a sale at the counter). A reprint leaves it to the Print button. */
  autoPrint?: boolean;
}) {
  const paperRef = useRef<HTMLDivElement>(null);
  const printed = useRef(false);

  // Copies the paper into #xenon-print (a direct child of <body>); globals.css hides everything else while printing.
  useEffect(() => {
    const paper = paperRef.current;
    if (!paper) return;
    let host = document.getElementById("xenon-print");
    if (!host) {
      host = document.createElement("div");
      host.id = "xenon-print";
      document.body.appendChild(host);
    }
    host.dataset.reference = receipt.reference;
    host.innerHTML = paper.outerHTML;
  }, [receipt]);

  useEffect(() => {
    if (!autoPrint || printed.current) return;
    printed.current = true;
    const t = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(t);
  }, [autoPrint]);

  const voided = receipt.cancelled;
  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <div ref={paperRef} data-receipt className="receipt-paper w-[384px] max-w-full border bg-white px-3 py-2 font-mono text-[13px] leading-tight text-black">
          <div className="text-center">
            <p className="text-base font-bold tracking-widest">XENON</p>
            <p className="text-[11px]">Institute</p>
          </div>
          {voided && (
            <>
              <Rule />
              <div className="border-y-2 border-black py-0.5 text-center">
                <p className="text-[15px] font-bold tracking-widest">*** CANCELLED ***</p>
                <p className="text-[11px]">{friendlyDate(voided.date)} {to12Hour(voided.at)} by {voided.by}</p>
                <p className="text-[11px] break-words">{voided.reason}</p>
              </div>
            </>
          )}
          <Rule />
          <Row left={friendlyDate(receipt.date)} right={to12Hour(receipt.at)} />
          <Row left="Receipt" right={receipt.reference} />
          {receipt.student && (
            <>
              <Rule />
              <p className="font-bold">{receipt.student.name}</p>
              <p className="text-[11px]">{receipt.student.cardNumber ?? "no card number"}</p>
            </>
          )}
          {receipt.course && <p className="text-[11px] break-words">Class: {receipt.course}</p>}
          <Rule />
          {receipt.lines.map((l, i) => (
            <div key={i}>
              <p className="break-words">{l.label}{l.custom ? " (one-off)" : ""}</p>
              <p className="text-right tabular-nums">{l.quantity} x {l.unit} = {l.amount}</p>
            </div>
          ))}
          {receipt.note && <p className="mt-1 text-[11px] break-words">{receipt.note}</p>}
          <Rule />
          <div className="flex justify-between text-[15px] font-bold">
            <span>TOTAL</span>
            <span className="tabular-nums">{receipt.total}</span>
          </div>
          <Rule />
          <Row left="Taken by" right={receipt.takenBy} />
          <p className="mt-1 text-center text-[11px]">{voided ? "This receipt has been cancelled." : "Thank you"}</p>
        </div>
      </div>
      <div className="no-print mx-auto flex max-w-md gap-2">
        <Button variant="outline" className="min-h-11 flex-1 gap-2" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          Print
        </Button>
        <Button className="min-h-11 flex-1" onClick={onDone}>{doneLabel}</Button>
      </div>
    </div>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{left}</span>
      <span className="text-right">{right}</span>
    </div>
  );
}

function Rule() {
  return <div className="my-1 border-t border-dashed border-black" />;
}
