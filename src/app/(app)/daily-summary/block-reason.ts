/**
 * Why Save day / Save changes / Print / Download PDF are switched off, as the sentence shown NEXT TO the buttons (a disabled button with no
 * reason beside it is a dead end on a phone). The first reason that applies wins; `null` means the buttons are on.
 */
export const BLOCK_BF = "Fix the bring-forward amount first.";
export const BLOCK_OVER = "Money taken to the bank is more than the drawer holds.";
export const BLOCK_DONE_BY = "Choose who did this (Done by).";

export function blockReason(o: { bringForwardOk: boolean; overdrawn: boolean; needsDoneBy?: boolean }): string | null {
  if (!o.bringForwardOk) return BLOCK_BF;
  if (o.overdrawn) return BLOCK_OVER;
  if (o.needsDoneBy) return BLOCK_DONE_BY;
  return null;
}
