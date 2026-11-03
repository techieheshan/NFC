"use client";

import { formatCents } from "@/lib/cents";
import type { FigureDiff } from "@/lib/saved-day/diff";
import { NAMES_DIFFER_NOTE } from "@/lib/saved-day/texts";

import { BottomSheet, SheetRow } from "./bottom-sheet";

/**
 * "See what changed": every figure that differs between the saved day and the live data (label, saved, live) and what that does to
 * Left in drawer. Display only; "Re-save with live numbers" is its own button on the day screen.
 */
export function LiveDiffSheet({
  diffs, savedLeft, liveLeft, onClose,
}: {
  diffs: readonly FigureDiff[];
  savedLeft: number;
  /** Left in drawer if the saved bring-forward and bank lines were kept and the live figures used. */
  liveLeft: number;
  onClose: () => void;
}) {
  return (
    <BottomSheet label="What changed" onClose={onClose}>
      <h2 className="text-lg font-semibold">What changed since it was saved</h2>
      {diffs.length > 0 && diffs.every((d) => d.nameOnly === true) && <p className="text-muted-foreground mt-1 text-sm">{NAMES_DIFFER_NOTE}</p>}
      <ul className="mt-3 divide-y rounded-lg border">
        {diffs.map((d) => (
          <li key={d.key} className="px-3 py-2 text-sm">
            <span className="block break-words font-medium">{d.label}</span>
            <span className="flex justify-between gap-3">
              <span className="text-muted-foreground">Saved</span>
              <span className="tabular-nums">{d.saved}</span>
            </span>
            <span className="flex justify-between gap-3">
              <span className="text-muted-foreground">Live</span>
              <span className="tabular-nums">{d.live}</span>
            </span>
          </li>
        ))}
        {diffs.length === 0 && <li className="text-muted-foreground px-3 py-2 text-sm">Nothing is different.</li>}
      </ul>
      <div className="mt-3 divide-y rounded-lg border px-3">
        <SheetRow label="Left in drawer, as saved" value={formatCents(savedLeft)} />
        <SheetRow label="Left in drawer, with the live numbers" value={formatCents(liveLeft)} strong />
      </div>
      <button type="button" onClick={onClose} className="border-input bg-background mt-5 h-12 w-full rounded-md border text-base font-medium">Close</button>
    </BottomSheet>
  );
}
