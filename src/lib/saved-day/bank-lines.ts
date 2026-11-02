import type { BankLine } from "@/lib/cash-flow";

/**
 * Which stored bank deposit is which, when a day is edited.
 *
 * A bank line has no id of its own that survives an edit (the form sends the whole list), so the lines of the new version are
 * matched to the lines of the previous one:
 *   1. a line identical in time, amount, slip and note is the SAME deposit: it keeps who recorded it and when;
 *   2. a leftover line with the SAME AMOUNT as a leftover old line is that deposit EDITED (other time, slip or note): it keeps them too;
 *   3. any other new line is ADDED: it is recorded by this version's Done by, now;
 *   4. an old line nobody matched is REMOVED.
 * Pure, so the rule is tested without a database.
 */

export type Recorded = { recordedById: string; recordedAt: Date };
export type StoredBankLine = BankLine & Recorded;

export type BankMatch = {
  /** The new version's lines, in order, each with who recorded it and when. */
  lines: StoredBankLine[];
  added: BankLine[];
  removed: BankLine[];
  edited: { from: BankLine; to: BankLine }[];
};

const same = (a: BankLine, b: BankLine) => a.time === b.time && a.cents === b.cents && a.slip === b.slip && a.note === b.note;
const plain = (l: BankLine): BankLine => ({ cents: l.cents, time: l.time, slip: l.slip, note: l.note });

export function matchBankLines(prev: readonly StoredBankLine[], next: readonly BankLine[], doneById: string, now: Date): BankMatch {
  const used = new Set<number>();
  const meta = new Array<Recorded | null>(next.length).fill(null);
  const edited: BankMatch["edited"] = [];

  next.forEach((line, i) => {
    const j = prev.findIndex((p, k) => !used.has(k) && same(p, line));
    if (j >= 0) {
      used.add(j);
      meta[i] = { recordedById: prev[j].recordedById, recordedAt: prev[j].recordedAt };
    }
  });
  next.forEach((line, i) => {
    if (meta[i]) return;
    const j = prev.findIndex((p, k) => !used.has(k) && p.cents === line.cents);
    if (j >= 0) {
      used.add(j);
      meta[i] = { recordedById: prev[j].recordedById, recordedAt: prev[j].recordedAt };
      edited.push({ from: plain(prev[j]), to: plain(line) });
    }
  });

  const added: BankLine[] = [];
  const lines = next.map((line, i): StoredBankLine => {
    let m = meta[i];
    if (!m) {
      m = { recordedById: doneById, recordedAt: now };
      added.push(plain(line));
    }
    return { ...plain(line), ...m };
  });
  const removed = prev.filter((_, k) => !used.has(k)).map(plain);
  return { lines, added, removed, edited };
}
