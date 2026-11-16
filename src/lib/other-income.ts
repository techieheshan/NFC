import { amountErrorText, parseTypedAmount } from "@/lib/cents";
import { parseRealDate } from "@/lib/daily-summary-dates";

/**
 * Other incomes: money that came in with no bill (a donation, rent, a supplier refund). Pure rules, no database,
 * so the screen, the server action and the tests all read the same text.
 *
 * Money is integer cents here and `Decimal(12,2)` in the table (AGENTS 4). A cancelled row is never deleted and
 * never counted. The amount of a saved income is never edited: cancel it and enter it again, so a printed voucher
 * can never be silently wrong.
 */

export const INCOME_METHODS = ["CASH", "BANK"] as const;
export type IncomeMethodValue = (typeof INCOME_METHODS)[number];

export const SOURCE_MAX = 120;
export const NOTE_MAX = 300;
export const CANCEL_REASON_MIN = 3;
export const CANCEL_REASON_MAX = 300;

/** The human number on a voucher: "IN-42". Its own series; it can never be mistaken for a receipt ("XN-"). */
export const incomeVoucherRef = (id: number) => `IN-${id}`;

export type IncomeInput = {
  categoryId: number;
  cents: number;
  /** "YYYY-MM-DD", a real Colombo calendar day, never in the future. */
  date: string;
  source: string | null;
  note: string;
  method: IncomeMethodValue;
  receivedById: string;
};

export type IncomeParse = { ok: true; value: IncomeInput } | { ok: false; error: string };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Reads what the form sent. Nothing here trusts the browser: the category and the receiver are only ids, and the action
 * re-checks that they exist and are active. `today` is the Colombo day (rule 15), passed in so a test can freeze it.
 */
export function parseIncomeInput(raw: Record<string, unknown>, today: string): IncomeParse {
  const categoryId = Number(text(raw.categoryId));
  if (!Number.isInteger(categoryId) || categoryId <= 0) return { ok: false, error: "Pick a category." };

  const amount = parseTypedAmount(text(raw.amount));
  if (!amount.ok) return { ok: false, error: amountErrorText(amount.reason) };
  if (amount.cents <= 0) return { ok: false, error: "Amount must be greater than zero." };

  const date = parseRealDate(text(raw.date));
  if (!date) return { ok: false, error: "Pick a valid date." };
  if (date > today) return { ok: false, error: "The date cannot be in the future." };

  const method = text(raw.method) === "" ? "CASH" : text(raw.method);
  if (!(INCOME_METHODS as readonly string[]).includes(method)) return { ok: false, error: "Pick cash or bank." };

  const source = text(raw.source);
  if (source.length > SOURCE_MAX) return { ok: false, error: `Who gave it is too long (most ${SOURCE_MAX} characters).` };
  const note = text(raw.note);
  if (note.length > NOTE_MAX) return { ok: false, error: `The note is too long (most ${NOTE_MAX} characters).` };

  const receivedById = text(raw.receivedById);
  if (receivedById === "") return { ok: false, error: "Pick who received the money." };

  return {
    ok: true,
    value: {
      categoryId,
      cents: amount.cents,
      date,
      source: source === "" ? null : source,
      note,
      method: method as IncomeMethodValue,
      receivedById,
    },
  };
}

export type CancelParse = { ok: true; reason: string } | { ok: false; error: string };

export function parseCancelReason(raw: unknown): CancelParse {
  const reason = text(raw);
  if (reason.length < CANCEL_REASON_MIN) return { ok: false, error: `Give a reason (at least ${CANCEL_REASON_MIN} characters).` };
  if (reason.length > CANCEL_REASON_MAX) return { ok: false, error: `The reason is too long (most ${CANCEL_REASON_MAX} characters).` };
  return { ok: true, reason };
}

/** A category code: capital letters, digits and underscores, typed once and then never changed. */
export function codeFromLabel(label: string): string {
  return label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export type IncomeMoneyRow = { cents: number; method: IncomeMethodValue; cancelled: boolean };

/**
 * What a set of incomes adds to the day. ONLY cash reaches the drawer; bank rows are listed apart, and a cancelled row is in
 * neither. The Daily Summary's "Other cash in" is exactly `cash`.
 */
export function splitIncomeTotals(rows: readonly IncomeMoneyRow[]): { cash: number; bank: number; cashRows: number; bankRows: number } {
  let cash = 0;
  let bank = 0;
  let cashRows = 0;
  let bankRows = 0;
  for (const r of rows) {
    if (r.cancelled) continue;
    if (r.method === "CASH") {
      cash += r.cents;
      cashRows += 1;
    } else {
      bank += r.cents;
      bankRows += 1;
    }
  }
  return { cash, bank, cashRows, bankRows };
}
