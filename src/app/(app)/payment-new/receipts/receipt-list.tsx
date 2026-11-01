"use client";

import { useRef, useState } from "react";
import { Ban, CheckCircle2, Printer, Receipt as ReceiptIcon } from "lucide-react";

import { reprintTransaction } from "@/app/(app)/receipts/actions";
import { ReceiptView } from "@/app/(app)/payment/receipt";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { to12Hour } from "@/lib/colombo-time";
import { friendlyDate } from "@/lib/friendly-date";
import type { TransactionSummary } from "@/lib/receipts";

/**
 * Board 6 — the receipt rows, and Reprint.
 *
 * Reprint is the EXISTING `reprintTransaction` (ADMIN + STAFF, read-only) and the EXISTING
 * `ReceiptView` paper in the shared dialog, exactly as /receipts does it: the receipt is
 * re-read from the server when Reprint is tapped, not printed from this list, so one that was
 * cancelled a minute ago comes off the printer with its CANCELLED band. There is no Cancel here.
 *
 * Nothing is computed in the browser: the number, the total and the line count are the
 * server's, and "Today" is decided against the Colombo date the server passes in.
 */
export function ReceiptList({ receipts, today }: { receipts: TransactionSummary[]; today: string }) {
  const [printing, setPrinting] = useState<TransactionSummary | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  // A second tap while the first is being loaded must not start a second request.
  const busy = useRef(false);

  async function reprint(key: string) {
    if (busy.current) return;
    busy.current = true;
    setLoadingKey(key);
    setError(null);
    try {
      const fresh = await reprintTransaction(key);
      if (fresh) setPrinting(fresh);
      else setError({ key, text: "That receipt could not be loaded. Search for it again." });
    } catch {
      setError({ key, text: "Couldn't reach the server. Check the connection and try again." });
    }
    busy.current = false;
    setLoadingKey(null);
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {receipts.map((t) => {
          const when = `${t.date === today ? "Today" : friendlyDate(t.date)} ${to12Hour(t.at)}`;
          const loading = loadingKey === t.key;
          return (
            <li key={t.key} className="flex flex-col gap-1 rounded-2xl border border-[#E1DAF0] bg-white p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">{t.reference}</span>
                {t.lines.length > 1 && (
                  <span className="rounded-full bg-[#F1EBFD] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-[#4C1D95]">
                    {t.lines.length} lines
                  </span>
                )}
                {t.cancelled && (
                  <span className="flex items-center gap-1 rounded-full border border-[#C0362C] bg-[#FDE7E5] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-[#7A1A12]">
                    <Ban className="size-3" aria-hidden />
                    Cancelled
                  </span>
                )}
                {t.noCharge && (
                  <span className="flex items-center gap-1 rounded-full border border-[#2E9E5B] bg-[#D6F2DF] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-[#0B4A24]">
                    <CheckCircle2 className="size-3" aria-hidden />
                    No charge
                  </span>
                )}
                <span className="flex-1" />
                <span className="text-base font-bold tabular-nums">{t.total}</span>
              </div>
              <p className="text-[13px] break-words text-[#3F3A55]">
                {t.student.name}
                {t.student.cardNumber ? ` · ${t.student.cardNumber}` : ""}
              </p>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-xs text-[#5B5670]">
                  {when} · taken by {t.takenBy}
                </span>
                <button
                  type="button"
                  onClick={() => void reprint(t.key)}
                  disabled={loadingKey !== null}
                  className="flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[#6D28D9] bg-white px-4 text-[13px] font-semibold whitespace-nowrap text-[#4C1D95] disabled:opacity-60"
                >
                  <Printer className="size-4" aria-hidden />
                  {loading ? "Loading…" : "Reprint"}
                </button>
              </div>
              {error?.key === t.key && (
                <p role="alert" className="rounded-xl border border-[#E8851C] bg-[#FFF4E5] px-3 py-2 text-[13px] font-medium text-[#4A2600]">
                  {error.text}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog open={printing !== null} onOpenChange={(o) => !o && setPrinting(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ReceiptIcon className="size-4" aria-hidden />
              Receipt {printing?.reference}
            </DialogTitle>
            <DialogDescription>
              {printing?.cancelled
                ? "This transaction was cancelled — the reprint is marked accordingly."
                : "Every line of the original transaction."}
            </DialogDescription>
          </DialogHeader>
          {printing && <ReceiptView receipt={printing} doneLabel="Close" onDone={() => setPrinting(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
