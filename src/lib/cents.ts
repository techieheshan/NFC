/**
 * Money for the Daily Summary's typed cash flow, in INTEGER CENTS (AGENTS rule 4: never Float).
 *
 * Two jobs: read what a person typed ("1,250.50") into cents, and write cents (or a figure that
 * already came out of the data object as "76375.00") back as "76,375.00". Nothing here touches
 * `dailySummary()`; its strings go IN through `decimalToCents` and are never changed.
 */

/** 99,999,999.99 — the largest amount a person may type. */
export const MAX_CENTS = 9_999_999_999;

export type AmountParse =
  | { ok: true; cents: number }
  | { ok: false; reason: "empty" | "format" | "negative" | "too-big" };

// Optional thousands commas (correctly grouped) and at most two decimals.
const TYPED = /^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d{1,2})?$/;

/** "1,250.5" → 125050. Digits, optional commas, up to 2 decimals; never negative, never above MAX_CENTS. */
export function parseTypedAmount(raw: string): AmountParse {
  const text = raw.trim();
  if (text === "") return { ok: false, reason: "empty" };
  if (text.startsWith("-") || text.startsWith("−")) return { ok: false, reason: "negative" };
  if (!TYPED.test(text) || !/\d/.test(text)) return { ok: false, reason: "format" };
  const [whole = "", frac = ""] = text.replace(/,/g, "").split(".");
  // Digits only, so Number() is exact up to 2^53: far above MAX_CENTS.
  const cents = Number(whole === "" ? "0" : whole) * 100 + Number(frac.padEnd(2, "0") || "0");
  if (cents > MAX_CENTS) return { ok: false, reason: "too-big" };
  return { ok: true, cents };
}

export function amountErrorText(reason: "empty" | "format" | "negative" | "too-big"): string {
  switch (reason) {
    case "empty":
      return "Type an amount.";
    case "negative":
      return "An amount cannot be negative.";
    case "too-big":
      return "That is more than 99,999,999.99.";
    default:
      return "Use digits only, like 1,250.00 (up to 2 decimals).";
  }
}

/** A figure from the data object ("76375.00", "-0.00", "12") → cents. Anything unreadable is 0. */
export function decimalToCents(value: string): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?\d*$/.exec(value.trim());
  if (!m) return 0;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  return m[1] === "-" && cents !== 0 ? -cents : cents;
}

/** 7637500 → "76,375.00"; −845000 → "−8,450.00"; 0 → "0.00" (never a minus sign on zero). */
export function formatCents(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = String(abs % 100).padStart(2, "0");
  return `${cents < 0 && abs !== 0 ? "−" : ""}${whole}.${frac}`;
}

/** A data-object figure, shown with thousands separators: "76375.00" → "76,375.00". */
export const formatMoney = (value: string) => formatCents(decimalToCents(value));

/** A data-object figure that is a DEDUCTION ("8450.00"), shown negative: "−8,450.00"; zero shows "0.00". */
export const formatDeduction = (value: string) => formatCents(-Math.abs(decimalToCents(value)));
