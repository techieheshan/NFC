/**
 * The Daily Summary's cash flow, all in integer cents:
 *
 *   Bring-forward + Collected − Deductions = Should be in the drawer
 *   Should be in the drawer − Money taken to the bank = Left in the drawer (tomorrow's bring-forward)
 *
 * Every collected rupee is cash. The person who prepares the summary is the one who banks the money,
 * so a bank line has no "taken by". Typed values are NOT stored (Release 1): they live in the URL.
 */

export const MAX_BANK_LINES = 10;

export type BankLine = {
  cents: number;
  /** "HH:MM", 24 hours, Colombo. */
  time: string;
  slip: string;
  note: string;
};

export type CashFlow = {
  bringForward: number;
  collected: number;
  deductions: number;
  shouldBe: number;
  bankTotal: number;
  left: number;
  /**
   * Money WAS banked and it is more than the drawer should hold: an error the screen shows, never hides.
   * A day whose deductions exceed its cash, with nothing banked, is not this: its Left is negative and shows as such,
   * but nothing was over-banked and the document can still be printed.
   */
  overdrawn: boolean;
};

export function computeCashFlow(input: {
  bringForward: number;
  collected: number;
  deductions: number;
  bank: readonly Pick<BankLine, "cents">[];
}): CashFlow {
  const shouldBe = input.bringForward + input.collected - input.deductions;
  const bankTotal = input.bank.reduce((s, l) => s + l.cents, 0);
  const left = shouldBe - bankTotal;
  return {
    bringForward: input.bringForward,
    collected: input.collected,
    deductions: input.deductions,
    shouldBe,
    bankTotal,
    left,
    overdrawn: bankTotal > 0 && left < 0,
  };
}

/** "HH:MM" with a real hour and minute. */
export const isClockTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
