"use server";

import { requireRole } from "@/lib/authz";
import {
  loadHistoryAs, loadSavedDayAs, markCheckedAs, saveDayAs,
  type CheckOutcome, type HistoryRead, type SavedDayRead, type SaveOutcome,
} from "@/lib/saved-day/store";

/**
 * The saved-day server actions (Daily Summary Release 2). Every one is its own HTTP endpoint, so every one checks the role FIRST
 * (rule 10): reads included. ADMIN and STAFF may call all of them; a TEACHER or nobody gets "Not authorised", whatever the page
 * guard says. What the actions do with the input is in `lib/saved-day/store.ts`: the client's ids are only keys into a lookup, the
 * numbers that are frozen are the server's own, and a refusal writes nothing.
 */
const OPERATIONAL = ["ADMIN", "STAFF"] as const;

export type { CheckOutcome, HistoryRead, SavedDayRead, SaveOutcome };

/** First save, edit and re-save with live numbers (`mode`). */
export async function saveDay(input: unknown): Promise<SaveOutcome> {
  const user = await requireRole([...OPERATIONAL]);
  return saveDayAs(user, input);
}

/** "Mark as checked": ADMIN or STAFF may tap it; the admin it names must be an active ADMIN. */
export async function markChecked(input: unknown): Promise<CheckOutcome> {
  const user = await requireRole([...OPERATIONAL]);
  return markCheckedAs(user, input);
}

/** The saved day (if any) with how the live figures compare, and the bring-forward hint. */
export async function loadSavedDay(date: unknown): Promise<SavedDayRead> {
  await requireRole([...OPERATIONAL]);
  return loadSavedDayAs(date);
}

/** Saved days of one month. Opening History also runs the lazy purge. */
export async function loadHistory(month: unknown): Promise<HistoryRead> {
  await requireRole([...OPERATIONAL]);
  return loadHistoryAs(month);
}
