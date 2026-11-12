import type { BankLine } from "@/lib/cash-flow";

/**
 * Which stored bank deposit is which, when a day is edited.
 *
 * A bank line has no id of its own that survives an edit (the form sends the whole list), so the lines of the new version are matched
 * to the lines of the previous one, GLOBALLY: every (new line, old line) pair with the SAME AMOUNT is scored by how many of time, slip and
 * note are equal (3 = the very same deposit, fewer = that deposit edited), and the best pairs are assigned first (ties go to the earlier
 * old line, then the earlier new line). So one line can never take the old line that another line matches better, and two deposits of
 * one amount cannot swap their recorders.
 *   - a new line paired with an old one keeps who recorded it and when (and the frozen name);
 *   - a new line nobody pairs with is ADDED: it is recorded by this version's Done by, now;
 *   - an old line nobody paired with is REMOVED.
 * Pure, so the rule is tested without a database.
 */

export type Recorded = { recordedById: string; recordedByName: string; recordedAt: Date };
export type StoredBankLine = BankLine & Recorded;

export type BankMatch = {
  /** The new version's lines, in order, each with who recorded it and when. */
  lines: StoredBankLine[];
  added: BankLine[];
  removed: BankLine[];
  edited: { from: BankLine; to: BankLine }[];
};

const plain = (l: BankLine): BankLine => ({ cents: l.cents, time: l.time, slip: l.slip, note: l.note });
const score = (p: BankLine, n: BankLine) => (p.time === n.time ? 1 : 0) + (p.slip === n.slip ? 1 : 0) + (p.note === n.note ? 1 : 0);

export function matchBankLines(
  prev: readonly StoredBankLine[],
  next: readonly BankLine[],
  doneBy: { id: string; name: string },
  now: Date,
): BankMatch {
  const pairs: { n: number; p: number; score: number }[] = [];
  next.forEach((line, n) => prev.forEach((old, p) => { if (old.cents === line.cents) pairs.push({ n, p, score: score(old, line) }); }));
  pairs.sort((a, b) => b.score - a.score || a.p - b.p || a.n - b.n);

  const usedOld = new Set<number>();
  const pairedWith = new Array<number>(next.length).fill(-1);
  for (const x of pairs) {
    if (pairedWith[x.n] !== -1 || usedOld.has(x.p)) continue;
    pairedWith[x.n] = x.p;
    usedOld.add(x.p);
  }

  const added: BankLine[] = [];
  const edited: BankMatch["edited"] = [];
  const lines = next.map((line, n): StoredBankLine => {
    const p = pairedWith[n];
    if (p === -1) {
      added.push(plain(line));
      return { ...plain(line), recordedById: doneBy.id, recordedByName: doneBy.name, recordedAt: now };
    }
    const old = prev[p];
    if (score(old, line) < 3) edited.push({ from: plain(old), to: plain(line) });
    return { ...plain(line), recordedById: old.recordedById, recordedByName: old.recordedByName, recordedAt: old.recordedAt };
  });
  const removed = prev.filter((_, p) => !usedOld.has(p)).map(plain);
  return { lines, added, removed, edited };
}
