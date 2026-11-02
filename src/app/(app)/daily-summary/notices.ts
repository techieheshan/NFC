/**
 * The notices the day screen can show after the address held something it could not use.
 *
 * `bf`   — the bring-forward was not a valid amount (it is cleared).
 * `bank` — a bank line was junk, or there were more than 10 (the unusable lines are removed; the valid ones are kept).
 *
 * They arrive two ways: as `notice=bf` / `notice=bank` from the document route's redirect, and straight from parsing a
 * hand-edited day-screen address. Only these two keys mean anything; any other `notice` value is ignored.
 */
export type NoticeKey = "bf" | "bank";

export const NOTICE_TEXT: Record<NoticeKey, string> = {
  bf: "The bring-forward in the address was not a valid amount, so it was cleared. Type it again.",
  bank: "Some bank lines in the address were not valid (or there were more than 10), so they were removed. Check the bank list and add any missing line again.",
};

const KEYS = Object.keys(NOTICE_TEXT) as NoticeKey[];

/** The notice keys to show: what parsing found, plus any `notice` parameters, each once, in a fixed order. */
export function noticeKeys(found: { bringForwardInvalid: boolean; bankLinesInvalid: boolean }, notice: string | string[] | undefined): NoticeKey[] {
  const given = (Array.isArray(notice) ? notice : notice === undefined ? [] : [notice]).slice(0, 10);
  const want = new Set<string>(given);
  if (found.bringForwardInvalid) want.add("bf");
  if (found.bankLinesInvalid) want.add("bank");
  return KEYS.filter((k) => want.has(k));
}
