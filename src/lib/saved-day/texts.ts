/**
 * The exact sentences of the saved-day screens and the document, in ONE place so a screen, the document and a test cannot drift apart.
 */

export const NOT_SAVED_CHIP = "Not saved";
export const NOT_CHECKED_CHIP = "Not checked";
export const UNREADABLE_DAY = "This saved day can't be read. Showing the live numbers.";
export const LIVE_DIFFERS = "The live numbers are different from the saved ones";
export const CHECK_CONFLICT = "The day changed after you opened it. Look at the new numbers and check again.";
export const NO_ADMIN = "No active admin account. Ask an owner to activate one.";
export const SAVE_FROZEN = "These numbers are frozen as of now.";
export const NOTHING_CHANGED = "Nothing changed.";

/** What the Admin check sheet says for a refusal: the day moving on has its own sentence, everything else is the server's own words. */
export const checkRefusalMessage = (r: { reason: string; message: string }): string => (r.reason === "conflict" ? CHECK_CONFLICT : r.message);

export const HISTORY_NOTE =
  "Days with no saved summary are not listed. Details are kept for 3 months after the date. A PDF is made from the saved details whenever you print or download.";

/** "Saved · version 2 · Sadun · 4:32 PM" */
export const savedChip = (version: number, doneBy: string, time: string) => `Saved · version ${version} · ${doneBy} · ${time}`;
/** "Edited · version 3" */
export const editedChip = (version: number) => `Edited · version ${version}`;
/** "Checked by Nadeesha, recorded by Sadun" */
export const checkedChip = (checkedBy: string, recordedBy: string) => `Checked by ${checkedBy}, recorded by ${recordedBy}`;
/** "Check cleared: the money changed after Nadeesha checked it. An admin must check again." */
export const checkClearedChip = (by: string) => `Check cleared: the money changed after ${by} checked it. An admin must check again.`;
/** "Yesterday closed with 12,000.00. Use this" or "Sat 10 Oct closed with 12,000.00. Use this" (+ " (not checked yet)") */
export const hintLabel = (when: string, amount: string, checked: boolean) => `${when} closed with ${amount}${checked ? "" : " (not checked yet)"}. Use this`;
/** "Save Wed 14 Oct 2026?" */
export const saveTitle = (dateText: string) => `Save ${dateText}?`;
/** "<Name> saved this day at <time> (version N) while you were working. Your changes were NOT saved." */
export const conflictText = (name: string, time: string, version: number) => `${name} saved this day at ${time} (version ${version}) while you were working. Your changes were NOT saved.`;
