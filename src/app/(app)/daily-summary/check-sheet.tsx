"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { formatCents } from "@/lib/cents";
import { CHECK_CONFLICT, NO_ADMIN } from "@/lib/saved-day/texts";
import type { CheckOutcome } from "@/lib/saved-day/store";

import { markChecked } from "./saved-actions";
import { BottomSheet, SheetRow } from "./bottom-sheet";
import { SELECT } from "./day-parts";
import type { Signer } from "./signer-lists";

/**
 * "Admin check": shows the three numbers the admin is checking, a select of ACTIVE admins only, and "Mark as checked". It posts the
 * version number it was showing, so a check can never attach to numbers the person did not see. ADMIN and STAFF may both tap it; the
 * admin named is looked up on the server. The select is controlled, so a refusal keeps it (rule 14).
 */
export function CheckSheet({
  date, version, shouldBe, bankTotal, left, admins, onClose,
}: {
  date: string;
  version: number;
  shouldBe: number;
  bankTotal: number;
  left: number;
  admins: readonly Signer[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [checkedById, setCheckedById] = useState("");
  const [refusal, setRefusal] = useState<Extract<CheckOutcome, { ok: false }> | null>(null);
  const [pending, start] = useTransition();
  const noAdmin = admins.length === 0;

  const send = () => {
    start(async () => {
      const r = await markChecked({ date, baseVersion: version, checkedById });
      setCheckedById(r.values.checkedById); // echoed on every outcome
      if (r.ok) {
        router.refresh();
        onClose();
      } else {
        setRefusal(r);
      }
    });
  };

  return (
    <BottomSheet label="Admin check" onClose={onClose}>
      <h2 className="text-lg font-semibold">Admin check</h2>
      <div className="mt-3 divide-y rounded-lg border px-3">
        <SheetRow label="Should be in the drawer" value={formatCents(shouldBe)} />
        <SheetRow label="Taken to bank" value={formatCents(bankTotal)} />
        <SheetRow label="Left in drawer" value={formatCents(left)} strong />
      </div>

      {noAdmin ? (
        <>
          <p id="admin-label" className="mt-4 block text-sm font-medium">Checked by (admin) <span className="text-destructive">*</span></p>
          <p role="alert" aria-labelledby="admin-label" className="mt-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{NO_ADMIN}</p>
        </>
      ) : (
        <>
          <label htmlFor="checked-by" className="mt-4 block text-sm font-medium">Checked by (admin) <span className="text-destructive">*</span></label>
          <select id="checked-by" className={`${SELECT} mt-1`} value={checkedById} onChange={(e) => setCheckedById(e.target.value)}>
            <option value="" disabled>Select an admin…</option>
            {admins.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </>
      )}

      {refusal && (
        <div role="alert" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>{refusal.reason === "conflict" ? CHECK_CONFLICT : refusal.message}</p>
          {(refusal.reason === "conflict" || refusal.reason === "already-checked" || refusal.reason === "not-saved" || refusal.reason === "expired") && (
            <button type="button" onClick={() => { router.refresh(); onClose(); }} className="bg-primary text-primary-foreground mt-2 h-11 w-full rounded-md text-base font-medium">Show the day as saved</button>
          )}
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button type="button" onClick={onClose} className="border-input bg-background h-12 rounded-md border text-base font-medium">Cancel</button>
        <button type="button" onClick={send} disabled={pending || noAdmin || checkedById === ""} className="bg-primary text-primary-foreground h-12 rounded-md text-base font-medium disabled:opacity-50">
          {pending ? "Saving…" : "Mark as checked"}
        </button>
      </div>
    </BottomSheet>
  );
}
