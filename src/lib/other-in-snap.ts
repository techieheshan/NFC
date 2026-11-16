import { decimalToCents } from "@/lib/cents";
import type { OtherIn } from "@/lib/daily-summary-other-in";
import { centsToDecimalString } from "@/lib/saved-day/money";

/**
 * Other income as the screens, the A4 document and the saved-day snapshot carry it: money as the data object's own 2-decimal text.
 * It exists ONLY for a day that has other income; `otherInSnap` returns `undefined` for a day with none, so every consumer
 * omits the lines and a day without other income is byte for byte what it was before. Pure: safe in client components.
 */
export type OtherInSnapRow = {
  id: number;
  date: string;
  category: string;
  source: string | null;
  receivedBy: string;
  amount: string;
  method: "CASH" | "BANK";
};
export type OtherInSnap = { cash: string; bank: string; rows: OtherInSnapRow[] };

export function otherInSnap(o: OtherIn | null | undefined): OtherInSnap | undefined {
  if (!o || o.rows.length === 0) return undefined;
  return {
    cash: centsToDecimalString(o.cash),
    bank: centsToDecimalString(o.bank),
    rows: o.rows.map((r) => ({ id: r.id, date: r.date, category: r.category, source: r.source, receivedBy: r.receivedBy, amount: centsToDecimalString(r.cents), method: r.method })),
  };
}

/** Cash other income in cents (0 for a day with none). */
export const otherCashCents = (s: OtherInSnap | undefined): number => (s ? decimalToCents(s.cash) : 0);
/** Bank-transfer other income in cents (0 for a day with none). */
export const otherBankCents = (s: OtherInSnap | undefined): number => (s ? decimalToCents(s.bank) : 0);
