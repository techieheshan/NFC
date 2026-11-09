"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * "This month is before registration" — asked ONCE per month, when staff tap a grey "earlier"
 * tile that is not selected yet. Yes selects it as an ordinary Full month; Cancel leaves the tile
 * grey. Un-picking a selected earlier month never asks again (that is the month sheet's rule).
 *
 * Built from the same Dialog as the month sheet. It decides nothing about money: the server
 * re-checks the month (`takePayment`, `backMonth`) and prices it like any other.
 */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function BackMonthConfirm({
  year,
  month,
  onYes,
  onCancel,
}: {
  year: number;
  month: number;
  onYes: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent showCloseButton={false} className="gap-4 p-5 sm:max-w-sm">
        <div>
          <DialogTitle className="text-lg leading-tight font-bold">Earlier month</DialogTitle>
          <DialogDescription className="mt-2 text-base text-[#3F3A55]">
            This month is before registration. Take payment for {MONTH_NAMES[month - 1]} {year}?
          </DialogDescription>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onYes}
            className="h-12 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="h-12 w-full rounded-xl border border-[#E1DAF0] bg-white text-base font-semibold"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
