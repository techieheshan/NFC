"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { formatCents } from "@/lib/cents";
import type { BankLine } from "@/lib/cash-flow";
import { formatClock } from "@/lib/saved-day/log-rows";
import { conflictText, saveTitle, SAVE_FROZEN } from "@/lib/saved-day/texts";
import type { SaveOutcome } from "@/lib/saved-day/store";

import { saveDay } from "./saved-actions";
import { BottomSheet, SheetRow } from "./bottom-sheet";
import { SELECT } from "./day-parts";
import type { Signer } from "./signer-lists";

export type SheetNumbers = { collected: number; deductions: number; shouldBe: number; bankTotal: number; left: number };

/**
 * "Save day" and "Re-save with live numbers": the bottom sheet that freezes the numbers. Everything on it is DISPLAY: the server takes its
 * own snapshot and only compares the two figures in `seen` with it (a receipt that arrived while the sheet was open is refused, with the
 * new figures offered). Done by is required and looked up on the server. The fields are controlled, so a refusal never wipes what was
 * chosen or typed (rule 14).
 */
export function SaveSheet({
  mode, date, dateText, baseVersion, numbers, bankCount, doners, bringForward, bank, onClose,
}: {
  mode: "save" | "resave";
  date: string;
  dateText: string;
  baseVersion: number;
  numbers: SheetNumbers;
  bankCount: number;
  doners: readonly Signer[];
  /** The bring-forward as typed ("5000.00" or ""), and the bank lines: sent with a first save; a re-save keeps the stored ones. */
  bringForward: string;
  bank: readonly BankLine[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [doneById, setDoneById] = useState("");
  const [refusal, setRefusal] = useState<Extract<SaveOutcome, { ok: false }> | null>(null);
  const [pending, start] = useTransition();

  const send = () => {
    start(async () => {
      const r = await saveDay({
        date,
        mode,
        baseVersion,
        doneById,
        bringForward,
        bank: bank.map((l) => ({ time: l.time, amount: (l.cents / 100).toFixed(2), slip: l.slip, note: l.note })),
        seen: { collected: numbers.collected, deductions: numbers.deductions },
      });
      if (r.ok) {
        router.refresh();
        onClose();
      } else {
        setRefusal(r);
        setDoneById(r.values.doneById); // the echoed choice (the select stays where it was)
      }
    });
  };
  const reload = () => {
    router.refresh();
    onClose();
  };

  return (
    <BottomSheet label={mode === "save" ? "Save day" : "Re-save with live numbers"} onClose={onClose}>
      <h2 className="text-lg font-semibold">{mode === "save" ? saveTitle(dateText) : `Re-save ${dateText} with the live numbers?`}</h2>
      <p className="text-muted-foreground mt-1 text-sm">{SAVE_FROZEN}</p>

      <div className="mt-3 divide-y rounded-lg border px-3">
        <SheetRow label="Collected" value={formatCents(numbers.collected)} />
        <SheetRow label="Deductions" value={formatCents(numbers.deductions)} />
        <SheetRow label="Should be in the drawer" value={formatCents(numbers.shouldBe)} strong />
        <SheetRow label={`Taken to bank (${bankCount})`} value={formatCents(numbers.bankTotal)} />
        <SheetRow label="Left in drawer" value={formatCents(numbers.left)} strong />
      </div>

      <label htmlFor="done-by" className="mt-4 block text-sm font-medium">Done by <span className="text-destructive">*</span></label>
      <select
        id="done-by" className={`${SELECT} mt-1`} value={doneById} onChange={(e) => setDoneById(e.target.value)}
        aria-invalid={refusal?.reason === "done-by" || undefined}
      >
        <option value="" disabled>Select who did this…</option>
        {doners.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role === "ADMIN" ? "Admin" : "Staff"})</option>)}
      </select>

      {refusal && refusal.reason === "conflict" && refusal.current && (
        <div role="alert" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>{conflictText(refusal.current.doneByName, formatClock(refusal.current.savedAt), refusal.current.version)}</p>
          <button type="button" onClick={reload} className="bg-primary text-primary-foreground mt-2 h-11 w-full rounded-md text-base font-medium">Show the day as saved</button>
        </div>
      )}
      {refusal && refusal.reason === "numbers-moved" && (
        <div role="alert" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>{refusal.message}</p>
          <button type="button" onClick={reload} className="bg-primary text-primary-foreground mt-2 h-11 w-full rounded-md text-base font-medium">Show the new numbers</button>
        </div>
      )}
      {refusal && refusal.reason !== "numbers-moved" && !(refusal.reason === "conflict" && refusal.current) && (
        <p role="alert" className="text-destructive mt-3 text-sm">{refusal.message}</p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button type="button" onClick={onClose} className="border-input bg-background h-12 rounded-md border text-base font-medium">Cancel</button>
        <button
          type="button" onClick={send} disabled={pending || doneById === ""}
          className="bg-primary text-primary-foreground h-12 rounded-md text-base font-medium disabled:opacity-50"
        >
          {pending ? "Saving…" : mode === "save" ? "Save day" : "Re-save"}
        </button>
      </div>
    </BottomSheet>
  );
}
