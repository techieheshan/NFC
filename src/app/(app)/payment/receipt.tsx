"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
 *
 * Thermal paper is the running cost here, so the layout is deliberately tight:
 * the FONT SIZE is untouched (it has to be read across a counter), but the
 * whitespace between rules, lines and blocks is cut to the minimum that still
 * separates one block from the next. Every mm saved is paper on every receipt.
 */
export function ReceiptView({
  receipt,
  onDone,
  doneLabel = "Next student",
  auto = false,
}: {
  receipt: Receipt;
  onDone: () => void;
  doneLabel?: string;
  /**
   * Counter mode: the terminal's own print dialog is the preview, so this
   * renders the paper and nothing else — no review screen, no buttons to
   * press. The caller drives printing and advances when the dialog closes.
   */
  auto?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <Paper receipt={receipt} />
      </div>

      {/* The same paper again, in the print root — a direct child of <body>,
          outside this dialog. Only this copy goes on paper; globals.css hides
          everything else while printing. */}
      <PrintPortal>
        <Paper receipt={receipt} />
      </PrintPortal>

      {!auto && (
      <div className="no-print mx-auto flex max-w-md gap-2">
        <Button variant="outline" className="flex-1 gap-2" onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          Print
        </Button>
        <Button className="flex-1" onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
      )}
    </div>
  );
}

/**
 * The receipt, as it appears on paper.
 *
 * Rendered twice — once on screen as the preview staff glance at, once inside
 * the print root — so that what prints cannot depend on what is on screen.
 */
function Paper({ receipt }: { receipt: Receipt }) {
  const voided = receipt.cancelled ?? null;
  return (
        <div
          data-receipt
          className="receipt-paper w-[384px] max-w-full border bg-white px-3 py-2 font-mono text-[13px] leading-tight text-black"
        >
          <div className="text-center">
            <p className="text-base font-bold tracking-widest">XENON</p>
            <p className="text-[11px]">Institute</p>
          </div>

          {voided && (
            <>
              <Rule />
              <div className="border-y-2 border-black py-0.5 text-center">
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
            <div key={i}>
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
          <p className="mt-1 text-center text-[11px]">
            {voided ? "This receipt has been cancelled." : "Thank you"}
          </p>
        </div>
  );
}

/**
 * A portal into #xenon-print, created on mount as a direct child of <body>.
 *
 * Being a child of <body> is the point: the payment dialog is transformed
 * (-translate-x-1/2), and a transform makes an ancestor the containing block
 * for absolutely positioned descendants — printing from inside it put the
 * receipt somewhere other than the top of the page.
 */
function PrintPortal({ children }: { children: React.ReactNode }) {
  // Created once, during render, so there is no state to set from an effect —
  // the effect only attaches and detaches it.
  const [host] = useState(() => {
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    el.id = "xenon-print";
    return el;
  });

  useEffect(() => {
    if (!host) return;
    document.body.appendChild(host);
    return () => {
      host.remove();
    };
  }, [host]);

  return host ? createPortal(children, host) : null;
}

/**
 * A separator, drawn as one dashed line rather than a row of hyphens with a
 * blank line either side of it: same visual break, a fraction of the height.
 */
function Rule() {
  return <div className="my-1 border-t border-dashed border-black" />;
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{left}</span>
      <span className="tabular-nums">{right}</span>
    </div>
  );
}
