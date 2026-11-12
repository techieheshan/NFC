import { MAX_CENTS, formatCents, parseTypedAmount } from "@/lib/cents";
import { MAX_BANK_LINES, isClockTime, type BankLine } from "@/lib/cash-flow";

import { pickSigner, type Signer } from "./signer-lists";

/**
 * The values a person TYPES on the Daily Summary — bring-forward, bank lines, Prepared by, Checked by —
 * live in the URL, not in the database (Release 1 stores nothing). The URL is what lets them survive
 * "open the document and come back" and a page reload, and what hands them to the document route.
 *
 * It is also hostile input: anyone can type any query string. So nothing here trusts it —
 *   - a repeated parameter takes its FIRST value; a missing or malformed one means "not set";
 *   - an amount is re-parsed as cents (never a negative, never above 99,999,999.99);
 *   - a bank line needs a real HH:MM, a positive amount, and at most 10 lines are read;
 *   - text is trimmed, stripped of control characters and cut to a length;
 *   - a signer id is only a LOOKUP KEY into the offered list (`pickSigner`): an id that is not offered is nobody.
 */

type Query = Record<string, string | string[] | undefined>;

import { NOTE_MAX, SLIP_MAX } from "@/lib/bank-limits";

export { NOTE_MAX, SLIP_MAX };

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

const enc = (s: string) => encodeURIComponent(s).replace(/~/g, "%7E");

/** One bank line ⇄ "HH:MM~cents~slip~note" (slip and note percent-encoded, "~" included). */
export function serializeBankLine(l: BankLine): string {
  return `${l.time}~${l.cents}~${enc(l.slip)}~${enc(l.note)}`;
}

export function parseBankLine(raw: string): BankLine | null {
  if (raw.length > 1500) return null; // 110 Sinhala characters percent-encode to under 1000
  const parts = raw.split("~");
  if (parts.length !== 4) return null;
  const [time, centsText, slipRaw, noteRaw] = parts;
  if (!isClockTime(time)) return null;
  if (!/^\d{1,10}$/.test(centsText)) return null;
  const cents = Number(centsText);
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > MAX_CENTS) return null;
  let slip: string;
  let note: string;
  try {
    slip = decodeURIComponent(slipRaw);
    note = decodeURIComponent(noteRaw);
  } catch {
    return null;
  }
  return { cents, time, slip: clean(slip, SLIP_MAX), note: clean(note, NOTE_MAX) };
}

export type TypedState = {
  bringForwardCents: number;
  /**
   * A `bf` was given and is not a valid amount (unparseable, negative, above 99,999,999.99, or longer than 20
   * characters). It is NOT turned into 0.00 quietly: the document refuses it and sends the user back to the day screen.
   */
  bringForwardInvalid: boolean;
  bank: BankLine[];
  /**
   * A bank line was given that is not usable (junk, wrong shape, bad time or amount), or there were more than 10 lines.
   * The usable lines (at most 10) are kept in `bank`; the document route never prints a smaller "Taken to bank" without
   * saying so: it sends the user back to the day screen with a notice.
   */
  bankLinesInvalid: boolean;
  prepared: Signer | null;
  checked: Signer | null;
};

export function parseTypedState(
  q: Query,
  lists: { prepared: readonly Signer[]; checked: readonly Signer[] },
): TypedState {
  const bfRaw = first(q.bf);
  // Never truncated before parsing: a 21-character value is refused, not read as a different number.
  const bfGiven = bfRaw !== undefined && bfRaw.trim() !== "";
  const bf = bfGiven && bfRaw.length <= 20 ? parseTypedAmount(bfRaw) : null;
  const given = Array.isArray(q.b) ? q.b : q.b === undefined ? [] : [q.b];
  // Bounded work: at most 50 entries are even looked at; more than 10 is itself a refusal, whatever they hold.
  const parsed = given.slice(0, 50).map((raw) => (typeof raw === "string" ? parseBankLine(raw) : null));
  const lines = parsed.filter((l): l is BankLine => l !== null).slice(0, MAX_BANK_LINES);
  return {
    bringForwardCents: bf && bf.ok ? bf.cents : 0,
    bringForwardInvalid: bfGiven && !(bf && bf.ok),
    bank: lines,
    bankLinesInvalid: given.length > MAX_BANK_LINES || parsed.some((l) => l === null),
    prepared: pickSigner(lists.prepared, first(q.prep)),
    checked: pickSigner(lists.checked, first(q.chk)),
  };
}

/** The query string that carries a typed state (empty values are left out). */
export function typedQuery(s: { bringForwardCents: number; bank: readonly BankLine[]; preparedId?: string; checkedId?: string }): URLSearchParams {
  const p = new URLSearchParams();
  if (s.bringForwardCents > 0) p.set("bf", formatCents(s.bringForwardCents).replace(/,/g, ""));
  for (const l of s.bank.slice(0, MAX_BANK_LINES)) p.append("b", serializeBankLine(l));
  if (s.preparedId) p.set("prep", s.preparedId);
  if (s.checkedId) p.set("chk", s.checkedId);
  return p;
}
