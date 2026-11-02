import { z } from "zod";

import type { BankLine } from "@/lib/cash-flow";
import { formatCents } from "@/lib/cents";
import { to12Hour } from "@/lib/colombo-time";

import type { BankMatch } from "./bank-lines";
import type { FigureDiff } from "./diff";

/**
 * The change log of a saved day: STRUCTURED items stored with each version, rendered to words only on screen and in the document.
 * Stored, not derived: "re-saved with live numbers" and "check cleared" are intentions a diff of two snapshots cannot recover, and
 * an edited bank line is ambiguous without the matching done at save time. Items, not text, so the wording can change later
 * without a migration.
 */

export type LineJson = { time: string; cents: number; slip: string; note: string };

export type ChangeItem =
  | { t: "saved"; by: string }
  | { t: "edited-by"; name: string }
  | { t: "bf"; from: number; to: number }
  | { t: "bank+"; line: LineJson }
  | { t: "bank-"; line: LineJson }
  | { t: "bank~"; from: LineJson; to: LineJson }
  | { t: "resaved"; by: string; diffs: { label: string; saved: string; live: string }[] }
  | { t: "check-cleared"; by: string; at: string }
  | { t: "check-kept"; by: string }
  /** An item written by a newer release than this code knows. Shown as such, never dropped silently. */
  | { t: "unknown" };

const lineJson = z.object({ time: z.string(), cents: z.number().int(), slip: z.string(), note: z.string() });
const item = z.discriminatedUnion("t", [
  z.object({ t: z.literal("saved"), by: z.string() }),
  z.object({ t: z.literal("edited-by"), name: z.string() }),
  z.object({ t: z.literal("bf"), from: z.number().int(), to: z.number().int() }),
  z.object({ t: z.literal("bank+"), line: lineJson }),
  z.object({ t: z.literal("bank-"), line: lineJson }),
  z.object({ t: z.literal("bank~"), from: lineJson, to: lineJson }),
  z.object({ t: z.literal("resaved"), by: z.string(), diffs: z.array(z.object({ label: z.string(), saved: z.string(), live: z.string() })) }),
  z.object({ t: z.literal("check-cleared"), by: z.string(), at: z.string() }),
  z.object({ t: z.literal("check-kept"), by: z.string() }),
]);

/** Reads stored items. Anything that is not an item this code knows becomes `{ t: "unknown" }`; a non-array is an empty log. */
export function parseChanges(raw: unknown): ChangeItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x): ChangeItem => {
    const r = item.safeParse(x);
    return r.success ? (r.data as ChangeItem) : { t: "unknown" };
  });
}

const plain = (l: BankLine): LineJson => ({ time: l.time, cents: l.cents, slip: l.slip, note: l.note });

export function changesForSave(by: string): ChangeItem[] {
  return [{ t: "saved", by }];
}

export function changesForEdit(a: {
  by: string;
  prevBf: number;
  nextBf: number;
  match: Pick<BankMatch, "added" | "removed" | "edited">;
  /** The check the previous version had, when it was cleared or kept by this edit. */
  check?: { cleared?: { by: string; at: string }; kept?: string };
}): ChangeItem[] {
  const out: ChangeItem[] = [{ t: "edited-by", name: a.by }];
  if (a.prevBf !== a.nextBf) out.push({ t: "bf", from: a.prevBf, to: a.nextBf });
  for (const l of a.match.removed) out.push({ t: "bank-", line: plain(l) });
  for (const e of a.match.edited) out.push({ t: "bank~", from: plain(e.from), to: plain(e.to) });
  for (const l of a.match.added) out.push({ t: "bank+", line: plain(l) });
  if (a.check?.cleared) out.push({ t: "check-cleared", by: a.check.cleared.by, at: a.check.cleared.at });
  if (a.check?.kept) out.push({ t: "check-kept", by: a.check.kept });
  return out;
}

export function changesForResave(a: { by: string; diffs: readonly FigureDiff[]; cleared?: { by: string; at: string } }): ChangeItem[] {
  const out: ChangeItem[] = [{ t: "resaved", by: a.by, diffs: a.diffs.map((d) => ({ label: d.label, saved: d.saved, live: d.live })) }];
  if (a.cleared) out.push({ t: "check-cleared", by: a.cleared.by, at: a.cleared.at });
  return out;
}

const lineText = (l: LineJson) =>
  [to12Hour(l.time), formatCents(l.cents), l.slip ? `slip ${l.slip}` : "", l.note].filter((p) => p !== "").join(", ");

const MAX_DIFFS_SHOWN = 5;

/** The words for one item (English, as staff read it). Money is formatted from integer cents. */
export function describeChange(c: ChangeItem): string {
  switch (c.t) {
    case "saved":
      return `Saved by ${c.by}`;
    case "edited-by":
      return `Edited by ${c.name}`;
    case "bf":
      return `Bring-forward changed from ${formatCents(c.from)} to ${formatCents(c.to)}`;
    case "bank+":
      return `Bank deposit added: ${lineText(c.line)}`;
    case "bank-":
      return `Bank deposit removed: ${lineText(c.line)}`;
    case "bank~":
      return `Bank deposit changed from ${lineText(c.from)} to ${lineText(c.to)}`;
    case "resaved": {
      const shown = c.diffs.slice(0, MAX_DIFFS_SHOWN).map((d) => `${d.label} ${d.saved} → ${d.live}`);
      const more = c.diffs.length > MAX_DIFFS_SHOWN ? `; and ${c.diffs.length - MAX_DIFFS_SHOWN} more` : "";
      return `Re-saved with live numbers by ${c.by}${shown.length ? `: ${shown.join("; ")}${more}` : ""}`;
    }
    case "check-cleared":
      return `Check cleared: the money changed after ${c.by} checked it`;
    case "check-kept":
      return `The check by ${c.by} was kept: only a slip, note or time changed`;
    case "unknown":
      return "A change recorded by a newer version of the app";
  }
}
