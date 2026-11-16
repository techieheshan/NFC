import { amountErrorText, formatCents, parseTypedAmount } from "@/lib/cents";
import { centsToDecimalString } from "@/lib/saved-day/money";

/**
 * Extra payments: a bill for things that are not class fees (a t-shirt, a book, an exam fee). Pure rules, no database, so the
 * screen, the server action and the tests read the same text. Money is integer cents here and `Decimal` in the tables (AGENTS 4).
 *
 * AGENTS 16: the client says WHICH item and HOW MANY; it never sends the price of a catalogue item. The server reads the price from
 * the admin's list. The one exception is a one-off line, where staff type a label and a price, capped by a Setting.
 */

export const MAX_LINES = 20;
export const MAX_QUANTITY = 999;
export const LABEL_MAX = 80;
export const NOTE_MAX = 200;
export const CANCEL_REASON_MIN = 3;
export const CANCEL_REASON_MAX = 300;
/** The most one bill may total, in cents (99,999,999.99, the same ceiling as every typed amount in the app). */
export const MAX_TOTAL_CENTS = 9_999_999_999;

/** The human number on a receipt: "XA-42". Its own series; it can never be mistaken for a class receipt ("XN-"). */
export const extraReceiptRef = (id: number) => `XA-${id}`;

/** "XA-42" or "42" or "xa 42" → 42; anything else null. */
export function parseExtraReceiptRef(raw: string): number | null {
  const m = /^\s*(?:xa[-\s]?)?(\d{1,9})\s*$/i.exec(raw);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

export type RawLine = { itemId?: unknown; quantity?: unknown; label?: unknown; price?: unknown };
export type CatalogueLine = { kind: "item"; itemId: number; quantity: number };
export type OneOffLine = { kind: "one-off"; label: string; unitCents: number; quantity: number };
export type ParsedLine = CatalogueLine | OneOffLine;

export type ParsedExtra = {
  clientRef: string;
  studentId: number | null;
  courseId: number | null;
  note: string | null;
  lines: ParsedLine[];
};
export type ExtraParse = { ok: true; value: ParsedExtra } | { ok: false; error: string };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const positiveInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(text(v));
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Reads what the browser sent. Nothing here is trusted: ids are only keys the action looks up, a one-off price is only a typed
 * amount the action checks against the Setting, and no total or unit price of a catalogue item is ever read from the client.
 */
export function parseExtraInput(raw: unknown): ExtraParse {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "That could not be read. Reload the page and try again." };
  const r = raw as Record<string, unknown>;

  const clientRef = text(r.clientRef);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientRef)) return { ok: false, error: "That could not be read. Reload the page and try again." };

  const studentId = r.studentId === undefined || r.studentId === null || r.studentId === "" ? null : positiveInt(r.studentId);
  if (r.studentId !== undefined && r.studentId !== null && r.studentId !== "" && studentId === null) return { ok: false, error: "Pick the student again." };
  const courseId = r.courseId === undefined || r.courseId === null || r.courseId === "" ? null : positiveInt(r.courseId);
  if (r.courseId !== undefined && r.courseId !== null && r.courseId !== "" && courseId === null) return { ok: false, error: "Pick the class again." };

  const note = text(r.note);
  if (note.length > NOTE_MAX) return { ok: false, error: `The note is too long (most ${NOTE_MAX} characters).` };

  if (!Array.isArray(r.lines) || r.lines.length === 0) return { ok: false, error: "Add at least one item." };
  if (r.lines.length > MAX_LINES) return { ok: false, error: `A bill holds up to ${MAX_LINES} lines.` };

  const lines: ParsedLine[] = [];
  const seenItems = new Set<number>();
  for (const l of r.lines as RawLine[]) {
    if (typeof l !== "object" || l === null) return { ok: false, error: "That could not be read. Reload the page and try again." };
    const quantity = positiveInt(l.quantity);
    if (quantity === null || quantity > MAX_QUANTITY) return { ok: false, error: `Each quantity must be a whole number from 1 to ${MAX_QUANTITY}.` };
    if (l.itemId !== undefined && l.itemId !== null && l.itemId !== "") {
      const itemId = positiveInt(l.itemId);
      if (itemId === null) return { ok: false, error: "That item could not be found. Reload the page." };
      // The same item twice is one line with the summed quantity would hide a typing slip: ask for one line instead.
      if (seenItems.has(itemId)) return { ok: false, error: "The same item is on the bill twice. Change its quantity instead." };
      seenItems.add(itemId);
      lines.push({ kind: "item", itemId, quantity });
    } else {
      const label = text(l.label);
      if (label.length < 2 || label.length > LABEL_MAX) return { ok: false, error: `Name the one-off item (2 to ${LABEL_MAX} characters).` };
      const price = parseTypedAmount(text(l.price));
      if (!price.ok) return { ok: false, error: amountErrorText(price.reason) };
      if (price.cents <= 0) return { ok: false, error: "A one-off item needs a price above zero." };
      lines.push({ kind: "one-off", label, unitCents: price.cents, quantity });
    }
  }
  return { ok: true, value: { clientRef, studentId, courseId, note: note === "" ? null : note, lines } };
}

export type PricedLine = {
  itemId: number | null;
  label: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
  custom: boolean;
};

export type CatalogueItem = { id: number; label: string; priceCents: number };
export type PriceResult = { ok: true; lines: PricedLine[]; totalCents: number } | { ok: false; error: string };

/**
 * Prices a parsed bill from the SERVER's catalogue. `oneOffMaxCents` is the Setting's cap (0 = one-off items not allowed). The total is
 * the sum of the stored line amounts, so cards x rate = total is true on every receipt.
 */
export function priceBill(lines: readonly ParsedLine[], catalogue: ReadonlyMap<number, CatalogueItem>, oneOffMaxCents: number): PriceResult {
  const out: PricedLine[] = [];
  for (const l of lines) {
    if (l.kind === "item") {
      const item = catalogue.get(l.itemId);
      if (!item) return { ok: false, error: "An item on the bill is no longer on the list. Reload the page." };
      out.push({ itemId: item.id, label: item.label, quantity: l.quantity, unitCents: item.priceCents, amountCents: item.priceCents * l.quantity, custom: false });
    } else {
      if (oneOffMaxCents <= 0) return { ok: false, error: "One-off items are not allowed. Ask an admin to set the limit in Settings." };
      if (l.unitCents > oneOffMaxCents) return { ok: false, error: `A one-off item can cost at most ${formatCents(oneOffMaxCents)}.` };
      out.push({ itemId: null, label: l.label, quantity: l.quantity, unitCents: l.unitCents, amountCents: l.unitCents * l.quantity, custom: true });
    }
  }
  const totalCents = out.reduce((s, l) => s + l.amountCents, 0);
  if (totalCents <= 0) return { ok: false, error: "The bill total must be above zero." };
  if (totalCents > MAX_TOTAL_CENTS) return { ok: false, error: "That bill is too large." };
  return { ok: true, lines: out, totalCents };
}

/** Decimal text for a stored column. */
export const money = centsToDecimalString;

export type CancelParse = { ok: true; reason: string } | { ok: false; error: string };
export function parseCancelReason(raw: unknown): CancelParse {
  const reason = text(raw);
  if (reason.length < CANCEL_REASON_MIN) return { ok: false, error: `Give a reason (at least ${CANCEL_REASON_MIN} characters).` };
  if (reason.length > CANCEL_REASON_MAX) return { ok: false, error: `The reason is too long (most ${CANCEL_REASON_MAX} characters).` };
  return { ok: true, reason };
}

/** A price typed for the ADMIN's list: > 0, up to the usual ceiling. */
export function parsePrice(raw: unknown): { ok: true; cents: number } | { ok: false; error: string } {
  const p = parseTypedAmount(text(raw));
  if (!p.ok) return { ok: false, error: amountErrorText(p.reason) };
  if (p.cents <= 0) return { ok: false, error: "A price must be above zero." };
  return { ok: true, cents: p.cents };
}
