"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Ban, Lock, Printer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/cents";
import { friendlyDate } from "@/lib/friendly-date";

import { cancelSalaryAdjustment, type ActionState, type AdjustmentRow } from "./actions";

const EMPTY: ActionState = { ok: false };

export function AdjustmentList({ rows, label }: { rows: AdjustmentRow[]; label: string }) {
  const [cancelling, setCancelling] = useState<AdjustmentRow | null>(null);
  if (rows.length === 0) return <p className="rounded-xl border border-dashed p-6 text-center text-sm">No salary adjustments in {label}.</p>;
  return (
    <>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className={`rounded-xl border p-3 ${r.cancelled ? "bg-muted" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={`font-medium ${r.cancelled ? "line-through" : ""}`}>{r.title}</p>
                <p className="text-muted-foreground text-xs break-words">{r.source}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge variant="outline">{r.kind === "SHARED_EXPENSE" ? "Shared expense" : "Bonus"}</Badge>
                {r.cancelled && <Badge variant="secondary" className="gap-1"><Ban className="size-3.5" aria-hidden />Cancelled</Badge>}
                {!r.cancelled && r.locked && <Badge variant="secondary" className="gap-1"><Lock className="size-3.5" aria-hidden />Month closed</Badge>}
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
              <div><dt className="text-muted-foreground text-xs">Total</dt><dd className="tabular-nums">{formatMoney(r.total)}</dd></div>
              <div><dt className="text-muted-foreground text-xs">{r.kind === "SHARED_EXPENSE" ? "People pay" : "People get"}</dt><dd className="tabular-nums">{formatMoney(r.shared)}</dd></div>
              <div><dt className="text-muted-foreground text-xs">Xenon {r.kind === "SHARED_EXPENSE" ? "bears" : "keeps"}</dt><dd className="font-semibold tabular-nums">{formatMoney(r.institute)}</dd></div>
            </dl>
            <ul className="mt-2 divide-y text-sm">
              {r.people.map((p) => (
                <li key={p.key} className="flex justify-between gap-3 py-1">
                  <span className="min-w-0 break-words">{p.name} <span className="text-muted-foreground text-xs">{p.kind === "teacher" ? "teacher" : "staff"}</span></span>
                  <span className="shrink-0 tabular-nums">{r.kind === "SHARED_EXPENSE" ? "-" : "+"}{formatMoney(p.amount)}</span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-2 text-xs">Agreed {friendlyDate(r.consentOn)}: {r.consentNote} · entered by {r.createdBy}</p>
            {r.cancelled && <p className="text-muted-foreground mt-1 text-xs">Cancelled by {r.cancelledBy ?? "an admin"}: {r.cancelReason}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button asChild variant="outline" className="min-h-11 gap-1.5"><Link href={`/salary-adjustments/${r.id}/notice`}><Printer className="size-4" aria-hidden />Notice</Link></Button>
              {!r.cancelled && !r.locked && <Button variant="outline" className="min-h-11 gap-1.5" onClick={() => setCancelling(r)}><Ban className="size-4" aria-hidden />Cancel</Button>}
            </div>
          </li>
        ))}
      </ul>
      {cancelling && <CancelDialog row={cancelling} onClose={() => setCancelling(null)} />}
    </>
  );
}

function CancelDialog({ row, onClose }: { row: AdjustmentRow; onClose: () => void }) {
  const [state, action, pending] = useActionState(cancelSalaryAdjustment, EMPTY);
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form action={action} className="space-y-4">
          <input type="hidden" name="id" value={row.id} />
          <DialogHeader>
            <DialogTitle>Cancel “{row.title}”?</DialogTitle>
            <DialogDescription>The pay lines are removed from the payslips and the staff list. The record stays here as cancelled. To change an amount, cancel it and make a new one.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Input id="reason" name="reason" autoComplete="off" defaultValue={state.values?.reason ?? ""} required className="h-11" />
          </div>
          {state.error && <p role="alert" className="text-destructive text-sm">{state.error}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>Keep it</Button>
            <Button type="submit" variant="destructive" className="min-h-11" disabled={pending}>{pending ? "Cancelling…" : "Cancel adjustment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
