"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Ban, Banknote, Building2, Plus, Printer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Picker } from "@/components/ui/picker";
import { formatMoney } from "@/lib/cents";
import { friendlyDate } from "@/lib/friendly-date";
import { incomeVoucherRef, NOTE_MAX, SOURCE_MAX } from "@/lib/other-income";

import { cancelIncome, createIncome, type ActionState, type IncomeRow, type Receiver } from "./actions";

const EMPTY: ActionState = { ok: false };

/** Cash and bank are told apart by an icon AND a word, never by colour alone. */
function MethodChip({ method }: { method: "CASH" | "BANK" }) {
  const Icon = method === "CASH" ? Banknote : Building2;
  return (
    <Badge variant="outline" className="gap-1">
      <Icon className="size-3.5" aria-hidden />
      {method === "CASH" ? "Cash" : "Bank"}
    </Badge>
  );
}

export function IncomeScreen({
  rows, categories, receivers, canCancel, today, defaultReceiverId, totals, filterUi,
}: {
  rows: IncomeRow[];
  categories: { id: number; label: string }[];
  receivers: Receiver[];
  canCancel: boolean;
  today: string;
  defaultReceiverId: string;
  /** Already formatted: cash in the drawer, bank, and how many rows are live. */
  totals: { cash: string; bank: string; live: number };
  filterUi: React.ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<IncomeRow | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Other incomes</h1>
          <p className="text-muted-foreground text-sm">Money that came in with no bill: a donation, rent, a supplier refund.</p>
        </div>
        <Button className="min-h-11 gap-2" onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden />
          Add income
        </Button>
      </div>

      {filterUi}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl border p-3">
          <p className="text-muted-foreground flex items-center gap-1.5"><Banknote className="size-4" aria-hidden />Cash in the drawer</p>
          <p className="text-lg font-semibold tabular-nums">{totals.cash}</p>
        </div>
        <div className="rounded-xl border p-3">
          <p className="text-muted-foreground flex items-center gap-1.5"><Building2 className="size-4" aria-hidden />Bank (not in the drawer)</p>
          <p className="text-lg font-semibold tabular-nums">{totals.bank}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm">No other income in this period.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className={`rounded-xl border p-3 ${r.cancelled ? "bg-muted" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`font-medium ${r.cancelled ? "line-through" : ""}`}>{r.categoryLabel}</p>
                  <p className="text-muted-foreground text-xs">
                    {friendlyDate(r.date)} · {incomeVoucherRef(r.id)}
                  </p>
                </div>
                <p className={`shrink-0 text-lg font-semibold tabular-nums ${r.cancelled ? "line-through" : ""}`}>{formatMoney(r.amount)}</p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <MethodChip method={r.method} />
                {r.cancelled && (
                  <Badge variant="secondary" className="gap-1"><Ban className="size-3.5" aria-hidden />Cancelled</Badge>
                )}
                {r.source && <span>from {r.source}</span>}
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                Received by {r.receivedBy}
                {r.recordedBy !== r.receivedBy ? ` · entered by ${r.recordedBy}` : ""}
              </p>
              {r.note && <p className="mt-1 text-sm">{r.note}</p>}
              {r.cancelled && (
                <p className="text-muted-foreground mt-1 text-xs">Cancelled by {r.cancelledBy ?? "an admin"}: {r.cancelReason}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button asChild variant="outline" className="min-h-11 gap-1.5">
                  <Link href={`/other-incomes/${r.id}/voucher`}><Printer className="size-4" aria-hidden />Voucher</Link>
                </Button>
                {canCancel && !r.cancelled && (
                  <Button variant="outline" className="min-h-11 gap-1.5" onClick={() => setCancelling(r)}>
                    <Ban className="size-4" aria-hidden />Cancel
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <AddDialog
          onClose={() => setAdding(false)}
          categories={categories}
          receivers={receivers}
          today={today}
          defaultReceiverId={defaultReceiverId}
        />
      )}
      {cancelling && <CancelDialog row={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}

function AddDialog({
  onClose, categories, receivers, today, defaultReceiverId,
}: {
  onClose: () => void;
  categories: { id: number; label: string }[];
  receivers: Receiver[];
  today: string;
  defaultReceiverId: string;
}) {
  const [state, formAction, pending] = useActionState(createIncome, EMPTY);
  const v = state.values;
  // The pickers are controlled, so React's post-action form reset cannot blank them (AGENTS 14).
  const [categoryId, setCategoryId] = useState(v?.categoryId ?? "");
  const [receivedById, setReceivedById] = useState(v?.receivedById ?? defaultReceiverId);
  const [method, setMethod] = useState<"CASH" | "BANK">(v?.method === "BANK" ? "BANK" : "CASH");

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <form action={formAction} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add other income</DialogTitle>
            <DialogDescription>An income cannot be edited afterwards: an admin cancels it and you enter it again.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>Category</Label>
            <Picker name="categoryId" value={categoryId} onChange={setCategoryId} title="Category" required placeholder="Pick a category…"
              options={categories.map((c) => ({ value: String(c.id), label: c.label }))} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <Input id="amount" name="amount" inputMode="decimal" autoComplete="off" defaultValue={v?.amount ?? ""} placeholder="0.00" required className="h-11" />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">How it came in</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["CASH", "BANK"] as const).map((m) => (
                <label key={m} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${method === m ? "border-primary border-2 font-medium" : ""}`}>
                  <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} className="sr-only" />
                  {m === "CASH" ? <Banknote className="size-4" aria-hidden /> : <Building2 className="size-4" aria-hidden />}
                  {m === "CASH" ? "Cash" : "Bank transfer"}
                </label>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">Only cash goes into the Daily Summary drawer.</p>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input id="date" name="date" type="date" max={today} defaultValue={v?.date ?? today} required className="h-11" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="source">Who gave it (optional)</Label>
            <Input id="source" name="source" maxLength={SOURCE_MAX} autoComplete="off" defaultValue={v?.source ?? ""} className="h-11" />
          </div>

          <div className="space-y-2">
            <Label>Received by</Label>
            <Picker name="receivedById" value={receivedById} onChange={setReceivedById} title="Received by" required placeholder="Pick who received it…"
              options={receivers.map((r) => ({ value: r.id, label: r.name, hint: r.role === "ADMIN" ? "Admin" : "Staff" }))} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Note (optional)</Label>
            <Input id="note" name="note" maxLength={NOTE_MAX} autoComplete="off" defaultValue={v?.note ?? ""} className="h-11" />
          </div>

          {state.error && <p role="alert" className="text-destructive text-sm">{state.error}</p>}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>Close</Button>
            <Button type="submit" className="min-h-11" disabled={pending}>{pending ? "Saving…" : "Save income"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ row, onClose }: { row: IncomeRow; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(cancelIncome, EMPTY);
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="id" value={row.id} />
          <DialogHeader>
            <DialogTitle>Cancel {incomeVoucherRef(row.id)}?</DialogTitle>
            <DialogDescription>
              {row.categoryLabel}, {formatMoney(row.amount)} on {friendlyDate(row.date)}. It stays in the list as cancelled and no report counts it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Input id="reason" name="reason" autoComplete="off" defaultValue={state.values?.reason ?? ""} required className="h-11" />
          </div>
          {state.error && <p role="alert" className="text-destructive text-sm">{state.error}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>Keep it</Button>
            <Button type="submit" variant="destructive" className="min-h-11" disabled={pending}>{pending ? "Cancelling…" : "Cancel income"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
