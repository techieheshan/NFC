import type { BankLine } from "@/lib/cash-flow";

/**
 * What a new version does to the admin check (owner's rule C3).
 *
 * MONEY CHANGE = the bring-forward, any bank amount, the number of bank lines, or a re-save with new live numbers.
 * A money change gives a version with NO check (an admin must check again).
 * An edit that changes only slip, note, time (or the order of the lines) KEEPS the check (it is carried over).
 * A save that changes nothing at all is refused ("Nothing changed").
 * Done by is who did the work; on its own it is not a change.
 */

export type EditShape = { bringForwardCents: number; bank: readonly BankLine[] };

export type EditKind = { nothingChanged: boolean; moneyChanged: boolean };

const lineEqual = (a: BankLine, b: BankLine) => a.time === b.time && a.cents === b.cents && a.slip === b.slip && a.note === b.note;

export function classifyEdit(prev: EditShape, next: EditShape): EditKind {
  const nothingChanged =
    prev.bringForwardCents === next.bringForwardCents &&
    prev.bank.length === next.bank.length &&
    prev.bank.every((l, i) => lineEqual(l, next.bank[i]));
  const amounts = (b: readonly BankLine[]) => b.map((l) => l.cents).sort((x, y) => x - y);
  const a = amounts(prev.bank);
  const b = amounts(next.bank);
  const moneyChanged =
    prev.bringForwardCents !== next.bringForwardCents || a.length !== b.length || a.some((c, i) => c !== b[i]);
  return { nothingChanged, moneyChanged };
}

export type SaveKind = "SAVE" | "EDIT" | "RESAVE_LIVE";

export type CheckDecision =
  | { refuse: "nothing-changed" }
  | { refuse?: undefined; carryCheck: boolean; checkCleared: boolean };

/**
 * `hadCheck`: the version being replaced was checked. `edit` is required for an EDIT, `liveDiffers` for a RESAVE_LIVE.
 */
export function decideCheck(a: { kind: SaveKind; hadCheck: boolean; edit?: EditKind; liveDiffers?: boolean }): CheckDecision {
  switch (a.kind) {
    case "SAVE":
      return { carryCheck: false, checkCleared: false };
    case "EDIT": {
      if (!a.edit) throw new Error("an EDIT needs its classification");
      if (a.edit.nothingChanged) return { refuse: "nothing-changed" };
      if (a.edit.moneyChanged) return { carryCheck: false, checkCleared: a.hadCheck };
      return { carryCheck: a.hadCheck, checkCleared: false };
    }
    case "RESAVE_LIVE":
      if (!a.liveDiffers) return { refuse: "nothing-changed" };
      return { carryCheck: false, checkCleared: a.hadCheck };
  }
}
