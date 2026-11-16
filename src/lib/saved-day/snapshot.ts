import { z } from "zod";

import { computeCashFlow, type BankLine } from "@/lib/cash-flow";
import { decimalToCents } from "@/lib/cents";
import type { CancelledSummary } from "@/lib/daily-summary-extras";
import type { StaffCollected } from "@/lib/daily-summary-rows";
import { otherCashCents, type OtherInSnap } from "@/lib/other-in-snap";
import type { DailySummary } from "@/lib/reports";

import { centsToDecimalString } from "./money";

/**
 * The FROZEN inputs of a saved day: the data object `dailySummary()` returned at the moment of saving, the cancelled-receipts
 * line and the collected-by-staff table. This is everything the A4 document and the saved-vs-live comparison need, so a saved
 * day can be printed and compared without asking the live data again.
 *
 * It is stored as JSON next to `snapshotSchema`. The schema number says which shape a stored row has, so a later release can still read
 * this one (and refuses, rather than guesses, a number it does not know). Money in it is the data object's own 2-decimal text.
 */

export const SNAPSHOT_SCHEMA = 1;
/**
 * Schema 2 = schema 1 plus an `otherIn` block (Other incomes: cash and bank-transfer rows of that day). It is written ONLY for a day that
 * has other income; a day without it stays schema 1 and is stored byte for byte as before, and re-saving such a day keeps schema 1.
 * Code from before this schema refuses to read a schema-2 row ("This saved day can't be read"): nothing is lost, the row is untouched.
 */
export const SNAPSHOT_SCHEMA_OTHER_IN = 2;

const money = z.string().regex(/^-?\d+(\.\d{1,2})?$/);
const count = z.number().int().nonnegative();
const countTotal = z.object({ count, total: money });

const courseRow = z.object({
  courseId: z.number().int(),
  course: z.string(),
  teacher: z.string(),
  registered: count,
  paidFull: count,
  paidHalf: count,
  paidQuarter: count,
  notPaid: z.number().int(),
  free: count,
  amount: money,
  reconciles: z.boolean(),
});

const deductionLine = z.object({
  date: z.string(),
  kind: z.enum(["TEACHER_ADVANCE", "XENON"]),
  person: z.string().nullable(),
  reason: z.string(),
  authorizedBy: z.string(),
  isStaffAdvance: z.boolean(),
  amount: money,
});

const reportSchema = z.object({
  from: z.string(),
  to: z.string(),
  courses: z.array(courseRow),
  admission: countTotal,
  smartCard: countTotal,
  classTotal: money,
  halfMonths: countTotal.optional(),
  noChargeMonths: z.object({ count }).optional(),
  totalCollected: money,
  deductions: z.object({ teacherAdvances: money, xenonExpenses: money, total: money }),
  deductionLines: z.array(deductionLine),
  net: money,
});

const staffRow = z.object({ userId: z.string(), name: z.string(), receipts: count, collected: money });

const otherInRow = z.object({
  id: z.number().int().positive(),
  date: z.string(),
  category: z.string(),
  source: z.string().nullable(),
  receivedBy: z.string(),
  amount: money,
  method: z.enum(["CASH", "BANK"]),
});
const otherInSchema = z.object({ cash: money, bank: money, rows: z.array(otherInRow).min(1) });

const snapshotSchema = z.object({
  report: reportSchema,
  cancelled: z.object({ receipts: count, total: money }),
  staff: z.array(staffRow),
});
const snapshotSchemaV2 = snapshotSchema.extend({ otherIn: otherInSchema });

export type Snapshot = { report: DailySummary; cancelled: CancelledSummary; staff: StaffCollected[]; otherIn?: OtherInSnap };

/** The schema number a snapshot is stored under: 2 when it carries other income, else 1. */
export const schemaOf = (s: Snapshot): number => (s.otherIn ? SNAPSHOT_SCHEMA_OTHER_IN : SNAPSHOT_SCHEMA);

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotError";
  }
}

/**
 * Validates and copies what the loaders returned into the stored shape. Keys the schema does not know are dropped, so what is
 * frozen is exactly schema 1, whatever the data object grows into later.
 */
export function buildSnapshot(input: { report: DailySummary; cancelled: CancelledSummary; staff: readonly StaffCollected[]; otherIn?: OtherInSnap }): Snapshot {
  // `otherIn` is part of the input ONLY when the day has other income: for a day with none the object is exactly the schema-1 one.
  const withOther = input.otherIn !== undefined && input.otherIn.rows.length > 0;
  const r = withOther
    ? snapshotSchemaV2.safeParse({ report: input.report, cancelled: input.cancelled, staff: input.staff, otherIn: input.otherIn })
    : snapshotSchema.safeParse({ report: input.report, cancelled: input.cancelled, staff: input.staff });
  if (!r.success) throw new SnapshotError(`not a valid daily summary snapshot: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`);
  return r.data as Snapshot;
}

/** Reads a stored snapshot. A schema number this code does not know, or a shape that does not fit, is refused. */
export function parseSnapshot(raw: unknown, schema: number): Snapshot {
  if (schema !== SNAPSHOT_SCHEMA && schema !== SNAPSHOT_SCHEMA_OTHER_IN) throw new SnapshotError(`unknown snapshot schema ${schema}`);
  // A schema-1 row is read exactly as before (an unknown key is dropped); a schema-2 row must carry its other income.
  const r = (schema === SNAPSHOT_SCHEMA_OTHER_IN ? snapshotSchemaV2 : snapshotSchema).safeParse(raw);
  if (!r.success) throw new SnapshotError(`stored snapshot does not fit schema ${schema}: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`);
  return r.data as Snapshot;
}

// ---- the cash book of a version ----

export type CashBook = {
  bringForward: number;
  collected: number;
  /** Cash other income; ABSENT on a day with none. It is part of `shouldBeInDrawer`; there is no column for it. */
  otherCash?: number;
  deductions: number;
  shouldBeInDrawer: number;
  bankTotal: number;
  leftInDrawer: number;
  net: number;
  /** Money was banked and it is more than the drawer should hold: a version like that is never saved. */
  overdrawn: boolean;
};

/** The version's cash book in integer cents: the typed values plus the snapshot's own figures (R1's `computeCashFlow`, unchanged). */
export function cashBookOf(snapshot: Snapshot, bringForwardCents: number, bank: readonly Pick<BankLine, "cents">[]): CashBook {
  const flow = computeCashFlow({
    bringForward: bringForwardCents,
    collected: decimalToCents(snapshot.report.totalCollected),
    deductions: decimalToCents(snapshot.report.deductions.total),
    otherIn: otherCashCents(snapshot.otherIn),
    bank,
  });
  return {
    bringForward: flow.bringForward,
    collected: flow.collected,
    ...(flow.otherIn !== undefined ? { otherCash: flow.otherIn } : {}),
    deductions: flow.deductions,
    shouldBeInDrawer: flow.shouldBe,
    bankTotal: flow.bankTotal,
    leftInDrawer: flow.left,
    net: decimalToCents(snapshot.report.net),
    overdrawn: flow.overdrawn,
  };
}

/** The seven `Decimal(12,2)` columns of a version, as text built from integer cents. */
export function cashBookColumns(b: CashBook) {
  return {
    bringForward: centsToDecimalString(b.bringForward),
    collected: centsToDecimalString(b.collected),
    deductions: centsToDecimalString(b.deductions),
    shouldBeInDrawer: centsToDecimalString(b.shouldBeInDrawer),
    bankTotal: centsToDecimalString(b.bankTotal),
    leftInDrawer: centsToDecimalString(b.leftInDrawer),
    net: centsToDecimalString(b.net),
  };
}
