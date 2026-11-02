import { z } from "zod";

import { computeCashFlow, type BankLine } from "@/lib/cash-flow";
import { decimalToCents } from "@/lib/cents";
import type { CancelledSummary } from "@/lib/daily-summary-extras";
import type { StaffCollected } from "@/lib/daily-summary-rows";
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

const snapshotSchema = z.object({
  report: reportSchema,
  cancelled: z.object({ receipts: count, total: money }),
  staff: z.array(staffRow),
});

export type Snapshot = { report: DailySummary; cancelled: CancelledSummary; staff: StaffCollected[] };

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
export function buildSnapshot(input: { report: DailySummary; cancelled: CancelledSummary; staff: readonly StaffCollected[] }): Snapshot {
  const r = snapshotSchema.safeParse({ report: input.report, cancelled: input.cancelled, staff: input.staff });
  if (!r.success) throw new SnapshotError(`not a valid daily summary snapshot: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`);
  return r.data as Snapshot;
}

/** Reads a stored snapshot. A schema number this code does not know, or a shape that does not fit, is refused. */
export function parseSnapshot(raw: unknown, schema: number): Snapshot {
  if (schema !== SNAPSHOT_SCHEMA) throw new SnapshotError(`unknown snapshot schema ${schema}`);
  const r = snapshotSchema.safeParse(raw);
  if (!r.success) throw new SnapshotError(`stored snapshot does not fit schema ${schema}: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`);
  return r.data as Snapshot;
}

// ---- the cash book of a version ----

export type CashBook = {
  bringForward: number;
  collected: number;
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
    bank,
  });
  return {
    bringForward: flow.bringForward,
    collected: flow.collected,
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
