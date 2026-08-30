"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Ban, Printer, Receipt as ReceiptIcon } from "lucide-react";

import { ReceiptView } from "@/app/(app)/payment/receipt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { to12Hour } from "@/lib/colombo-time";
import type { TransactionSummary } from "@/lib/receipts";

import { cancelTransaction, reprintTransaction, type ActionState } from "./actions";

const EMPTY: ActionState = { ok: false };

export function ReceiptsScreen({
  transactions,
  canCancel,
  searched,
}: {
  transactions: TransactionSummary[];
  /** ADMIN only. The action re-checks; this just keeps the button off staff screens. */
  canCancel: boolean;
  /** False before any filter is applied, so "no results" isn't shown on arrival. */
  searched: boolean;
}) {
  // Re-read from the server rather than printing the list row: the row may be
  // seconds old, and a receipt that was voided in the meantime must print with
  // its CANCELLED band.
  const [printing, setPrinting] = useState<TransactionSummary | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<TransactionSummary | null>(null);
  const [pending, startTransition] = useTransition();

  function openReprint(key: string) {
    setLoadingKey(key);
    startTransition(async () => {
      const fresh = await reprintTransaction(key);
      setLoadingKey(null);
      if (fresh) setPrinting(fresh);
    });
  }

  return (
    <div className="space-y-4">
      {transactions.length === 0 ? (
        <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
          {searched
            ? "No receipts match that search."
            : "Search by card number or name, or pick a date range, to find a receipt."}
        </p>
      ) : (
        <ul className="space-y-3">
          {transactions.map((t) => (
            <li key={t.key} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="font-mono">{t.reference}</span>
                    {t.cancelled && <Badge variant="destructive">Cancelled</Badge>}
                    {t.lines.length > 1 && (
                      <Badge variant="outline">{t.lines.length} lines</Badge>
                    )}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {t.student.name}
                    {t.student.cardNumber ? ` · ${t.student.cardNumber}` : ""}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {t.date} {to12Hour(t.at)} · taken by {t.takenBy}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-lg font-semibold tabular-nums">{t.total}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={pending && loadingKey === t.key}
                    onClick={() => openReprint(t.key)}
                  >
                    <Printer className="size-3.5" aria-hidden />
                    {pending && loadingKey === t.key ? "Loading…" : "Reprint"}
                  </Button>
                  {canCancel && !t.cancelled && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-1.5"
                      onClick={() => setCancelling(t)}
                    >
                      <Ban className="size-3.5" aria-hidden />
                      Cancel
                    </Button>
                  )}
                </div>
              </div>

              <ul className="text-muted-foreground mt-3 space-y-1 border-t pt-3 text-sm">
                {t.lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-4">
                    <span className="break-words">{l.label}</span>
                    <span className="shrink-0 tabular-nums">{l.amount}</span>
                  </li>
                ))}
              </ul>

              {t.cancelled && (
                <p className="text-destructive mt-3 text-sm">
                  Cancelled {t.cancelled.date} {to12Hour(t.cancelled.at)} by{" "}
                  {t.cancelled.by} — {t.cancelled.reason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={printing !== null} onOpenChange={(o) => !o && setPrinting(null)}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
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
          {printing && (
            <ReceiptView
              receipt={printing}
              doneLabel="Close"
              onDone={() => setPrinting(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {cancelling && (
        <CancelDialog
          key={cancelling.key}
          transaction={cancelling}
          onClose={() => setCancelling(null)}
        />
      )}
    </div>
  );
}

function CancelDialog({
  transaction,
  onClose,
}: {
  transaction: TransactionSummary;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(cancelTransaction, EMPTY);

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Cancel receipt {transaction.reference}?</DialogTitle>
            <DialogDescription>
              This voids all {transaction.lines.length}{" "}
              {transaction.lines.length === 1 ? "line" : "lines"} of{" "}
              {transaction.student.name}&apos;s receipt, totalling {transaction.total}.
              Nothing is deleted — the rows stay on record as cancelled and drop out
              of every report.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {transaction.hasAdmission && (
              <p className="bg-secondary text-secondary-foreground rounded-lg px-3 py-2 text-sm">
                This receipt includes the admission fee, so the student will be
                marked as owing admission again.
              </p>
            )}

            <input type="hidden" name="key" value={transaction.key} />
            <div className="space-y-2">
              <Label htmlFor="reason">Reason</Label>
              <Input
                id="reason"
                name="reason"
                defaultValue={state.values?.reason ?? ""}
                placeholder="Collected twice at the counter"
                autoComplete="off"
                required
              />
            </div>

            {state.error && (
              <p role="alert" className="text-destructive text-sm">
                {state.error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Keep it
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Cancelling…" : "Cancel receipt"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
