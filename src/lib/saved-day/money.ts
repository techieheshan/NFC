import { decimalToCents } from "@/lib/cents";

/**
 * Money for the saved-day tables, in INTEGER CENTS until the very last step (AGENTS rule 4: never Float).
 *
 * The columns are `Decimal(12,2)`. A value goes in as text ("1250.50") built from integer cents by integer arithmetic only,
 * and comes out as a Prisma Decimal read through its exact 2-decimal text. There is no `cents / 100` anywhere.
 */

/** 125050 -> "1250.50"; -845000 -> "-8450.00"; 0 -> "0.00" (never "-0.00"). The same shape as the data object's own strings. */
export function centsToDecimalString(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError(`cents must be a safe integer, got ${cents}`);
  const abs = Math.abs(cents);
  const whole = (abs - (abs % 100)) / 100; // exact: no float division
  const frac = String(abs % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${whole}.${frac}`;
}

type DecimalLike = { toFixed(digits: number): string };

/** A Prisma Decimal column (or its text) back to integer cents. */
export const columnToCents = (v: DecimalLike | string): number => decimalToCents(typeof v === "string" ? v : v.toFixed(2));
