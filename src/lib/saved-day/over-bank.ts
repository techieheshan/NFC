import { formatCents } from "@/lib/cents";

/**
 * Over-banking, in one place. A version is OVER-BANKED when money was banked and the bank lines add up to more than the drawer should
 * hold: `bankTotal > 0` and Left in drawer is negative. (A day whose deductions exceed its cash with nothing banked is NOT over-banked.)
 *
 * A first save and an edit REFUSE an over-bank. A re-save with live numbers is always allowed (the live numbers moved, not the person's
 * typing) and saves the version FLAGGED; the flag is derived from the stored columns, so there is nothing extra to store. A flagged
 * day cannot be checked until it is put right.
 */

/** How much more than the drawer holds was banked, in cents; 0 when the version is not over-banked. */
export function overBankedBy(bankTotalCents: number, leftCents: number): number {
  return bankTotalCents > 0 && leftCents < 0 ? -leftCents : 0;
}

/** A first save or an edit that would over-bank is refused with this sentence (it names the amount). */
export const overBankRefusal = (overCents: number) => `The money taken to the bank is ${formatCents(overCents)} more than the drawer should hold.`;

/** The banner on a saved day (screen and document) and the reason "Mark as checked" is refused. */
export const overBankedBanner = (overCents: number) =>
  `Bank deposits are ${formatCents(overCents)} more than the drawer should hold. Edit the bank lines or the bring-forward.`;
