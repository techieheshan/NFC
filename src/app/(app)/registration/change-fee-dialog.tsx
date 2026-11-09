"use client";

import { useState, useTransition } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Picker } from "@/components/ui/picker";

import type { ChangeFeeResult, EnrolmentView } from "./actions";
import type { FeeTierOption } from "./enrolment-picker";

/**
 * "Change fee": move one enrolment between Full, Half and 25%. ADMIN only (the button is only
 * drawn for admins, and `changeFeeTier` refuses anyone else on its own). Free tiers are neither
 * offered nor changeable here. It decides nothing about money: the server re-reads both tiers,
 * and no payment is created or edited — months already paid keep their amount.
 */

/** A tier that charges something. Free (multiplier 0) is left out, as the server does. */
export const isChargeableTier = (t: Pick<FeeTierOption, "multiplier">) => Number(t.multiplier) !== 0;

export function ChangeFeeDialog({
  enrolment,
  feeTiers,
  changeFeeTier,
  onChanged,
  onClose,
}: {
  enrolment: EnrolmentView;
  feeTiers: FeeTierOption[];
  changeFeeTier: (enrolmentId: number, feeTierId: number) => Promise<ChangeFeeResult>;
  onChanged: () => void;
  onClose: () => void;
}) {
  const options = feeTiers.filter(isChargeableTier);
  const [tierId, setTierId] = useState(String(enrolment.feeTierId));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const chosen = options.find((t) => String(t.id) === tierId);
  const unchanged = tierId === String(enrolment.feeTierId);

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await changeFeeTier(enrolment.id, Number(tierId));
      if (res.ok) {
        onChanged();
        onClose();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent showCloseButton={false} className="gap-4 p-5 sm:max-w-md">
        <div>
          <DialogTitle className="text-lg leading-tight font-bold">Change fee</DialogTitle>
          <DialogDescription className="mt-1 text-sm break-words">
            {enrolment.course} is on <strong>{enrolment.feeTier}</strong>.
          </DialogDescription>
        </div>

        <Picker
          title="Fee"
          value={tierId}
          onChange={(v) => {
            setTierId(v);
            setError(null);
          }}
          options={options.map((t) => ({ value: String(t.id), label: t.label }))}
        />

        {chosen && !unchanged && (
          <p className="text-sm">
            New months will be charged at {chosen.label}. Months already paid keep their amount.
          </p>
        )}

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending || unchanged || !chosen}
            className="h-12 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Saving…" : "Change fee"}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-12 w-full rounded-xl border border-border bg-white text-base font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
