"use client";

import { useActionState, useEffect, useState } from "react";
import { Ban, Printer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyDate } from "@/lib/friendly-date";
import { to12Hour } from "@/lib/colombo-time";

import { cancelExtraPayment, type ActionState, type ExtraReceipt } from "../actions";
import { ExtraReceiptView } from "../extra-receipt";

const EMPTY: ActionState = { ok: false };

export function ReceiptList({ receipts, canCancel, searched }: { receipts: ExtraReceipt[]; canCancel: boolean; searched: boolean }) {
  const [printing, setPrinting] = useState<ExtraReceipt | null>(null);
  const [cancelling, setCancelling] = useState<ExtraReceipt | null>(null);

  if (printing) return <ExtraReceiptView receipt={printing} onDone={() => setPrinting(null)} doneLabel="Back to the list" />;

  return (
    <>
      {receipts.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm">{searched ? "No receipt matches that." : "No extra payments yet."}</p>
      ) : (
        <ul className="space-y-2">
          {receipts.map((r) => (
            <li key={r.id} className={`rounded-xl border p-3 ${r.cancelled ? "bg-muted" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{r.reference}</p>
                  <p className="text-muted-foreground text-xs">{friendlyDate(r.date)}, {to12Hour(r.at)} · {r.takenBy}</p>
                </div>
                <p className={`shrink-0 text-lg font-semibold tabular-nums ${r.cancelled ? "line-through" : ""}`}>{r.total}</p>
              </div>
              {r.student && <p className="mt-1 text-sm">{r.student.name}</p>}
              <p className="text-muted-foreground mt-1 text-xs">{r.lines.map((l) => `${l.quantity} x ${l.label}`).join(", ")}</p>
              {r.cancelled && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs"><Badge variant="secondary" className="gap-1"><Ban className="size-3.5" aria-hidden />Cancelled</Badge>by {r.cancelled.by}: {r.cancelled.reason}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="outline" className="min-h-11 gap-1.5" onClick={() => setPrinting(r)}><Printer className="size-4" aria-hidden />Reprint</Button>
                {canCancel && !r.cancelled && <Button variant="outline" className="min-h-11 gap-1.5" onClick={() => setCancelling(r)}><Ban className="size-4" aria-hidden />Cancel</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {cancelling && <CancelDialog receipt={cancelling} onClose={() => setCancelling(null)} />}
    </>
  );
}

function CancelDialog({ receipt, onClose }: { receipt: ExtraReceipt; onClose: () => void }) {
  const [state, action, pending] = useActionState(cancelExtraPayment, EMPTY);
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form action={action} className="space-y-4">
          <input type="hidden" name="id" value={receipt.id} />
          <DialogHeader>
            <DialogTitle>Cancel {receipt.reference}?</DialogTitle>
            <DialogDescription>{receipt.total} on {friendlyDate(receipt.date)}. It stays in the list as cancelled and no report counts it. A reprint says CANCELLED.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Input id="reason" name="reason" autoComplete="off" defaultValue={state.values?.reason ?? ""} required className="h-11" />
          </div>
          {state.error && <p role="alert" className="text-destructive text-sm">{state.error}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>Keep it</Button>
            <Button type="submit" variant="destructive" className="min-h-11" disabled={pending}>{pending ? "Cancelling…" : "Cancel receipt"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
