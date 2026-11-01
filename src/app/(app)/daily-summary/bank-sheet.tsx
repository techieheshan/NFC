"use client";

import { useEffect, useState } from "react";

import { amountErrorText, formatCents, parseTypedAmount } from "@/lib/cents";
import { isClockTime, type BankLine } from "@/lib/cash-flow";
import { colomboNow } from "@/lib/colombo-time";

import { NOTE_MAX, SLIP_MAX } from "./typed-state";

const FIELD = "border-input bg-background h-11 w-full rounded-md border px-3 text-base shadow-xs";

/**
 * "Take money to bank": a bottom sheet that adds ONE line to the day's bank list. Nothing is saved — the line
 * goes back to the screen, which keeps it in the URL. The amount cannot be more than what the drawer holds
 * right now (that would be a negative "Left in drawer"), and it needs a real clock time.
 */
export function BankSheet({
  inDrawerCents, onAdd, onClose,
}: {
  inDrawerCents: number;
  onAdd: (line: BankLine) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [time, setTime] = useState(() => colomboNow().time);
  const [slip, setSlip] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parsed = parseTypedAmount(amount);
  const cents = parsed.ok ? parsed.cents : 0;
  let error: string | null = null;
  if (!parsed.ok) error = parsed.reason === "empty" ? "Type the amount to bank." : amountErrorText(parsed.reason);
  else if (cents === 0) error = "The amount must be more than 0.00.";
  else if (cents > inDrawerCents) error = "That is more than is in the drawer.";
  const timeError = isClockTime(time) ? null : "Choose a time.";
  const left = inDrawerCents - cents;
  const canAdd = !error && !timeError;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Take money to bank" className="bg-background mx-auto max-h-[90vh] w-full max-w-[720px] overflow-y-auto rounded-t-2xl p-4 shadow-xl">
        <h2 className="text-lg font-semibold">Take money to bank</h2>

        <label htmlFor="bank-amount" className="mt-4 block text-sm font-medium">Amount</label>
        <input
          id="bank-amount" autoFocus inputMode="decimal" autoComplete="off" placeholder="0.00"
          className="border-input bg-background mt-1 h-14 w-full rounded-md border px-3 text-3xl font-semibold tabular-nums shadow-xs"
          value={amount} onChange={(e) => { setAmount(e.target.value); setTouched(true); }}
          aria-invalid={touched && !!error} aria-describedby="bank-amount-error"
        />
        <p id="bank-amount-error" role={touched && error ? "alert" : undefined} className="text-destructive mt-1 min-h-5 text-sm">{touched && error ? error : ""}</p>

        <div className="mt-2 grid grid-cols-2 gap-3">
          <div className="bg-muted rounded-lg p-3">
            <p className="text-muted-foreground text-xs">In drawer now</p>
            <p className="text-base font-semibold tabular-nums">{formatCents(inDrawerCents)}</p>
          </div>
          <div className="bg-muted rounded-lg p-3">
            <p className="text-muted-foreground text-xs">Left after</p>
            <p className={`text-base font-semibold tabular-nums ${parsed.ok && left < 0 ? "text-destructive" : ""}`}>{parsed.ok ? formatCents(left) : "—"}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="bank-time" className="block text-sm font-medium">Time</label>
            <input id="bank-time" type="time" className={`${FIELD} mt-1`} value={time} onChange={(e) => setTime(e.target.value)} />
            {timeError && <p role="alert" className="text-destructive mt-1 text-sm">{timeError}</p>}
          </div>
          <div>
            <label htmlFor="bank-slip" className="block text-sm font-medium">Bank slip no. <span className="text-muted-foreground font-normal">(optional)</span></label>
            <input id="bank-slip" maxLength={SLIP_MAX} autoComplete="off" className={`${FIELD} mt-1`} value={slip} onChange={(e) => setSlip(e.target.value)} />
          </div>
        </div>
        <label htmlFor="bank-note" className="mt-4 block text-sm font-medium">Note <span className="text-muted-foreground font-normal">(optional)</span></label>
        <input id="bank-note" maxLength={NOTE_MAX} autoComplete="off" className={`${FIELD} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} />

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={onClose} className="border-input bg-background h-12 rounded-md border text-base font-medium">Cancel</button>
          <button
            type="button" disabled={!canAdd && touched}
            onClick={() => {
              setTouched(true);
              if (!canAdd) return;
              onAdd({ cents, time, slip: slip.trim(), note: note.trim() });
            }}
            className="bg-primary text-primary-foreground h-12 rounded-md text-base font-medium disabled:opacity-50"
          >
            Add to bank list
          </button>
        </div>
      </div>
    </div>
  );
}
