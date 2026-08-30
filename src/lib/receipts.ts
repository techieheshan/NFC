import "server-only";

import { colomboNow, colomboRangeUtc } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";

/**
 * Receipts, shared by the counter (which prints one) and the Receipts screen
 * (which reprints and voids one).
 *
 * A receipt is a TRANSACTION, not a payment row: `Payment.transactionRef` groups
 * everything one checkout wrote, so a combo across three courses and a
 * three-month catch-up are each a single document. Every read here is a plain
 * query — callers apply their own role guard.
 */

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export const monthLabel = (year: number, month: number) =>
  `${MONTH_NAMES[month - 1]} ${year}`;

/**
 * The human-facing reference: the lowest payment id in the transaction.
 *
 * Short enough for 58mm paper, unique (ids are), and stable — a reprint shows
 * the same string the original print did, whatever order the rows come back in.
 * The machine-facing grouping is `transactionRef`; this is what staff read out.
 */
export const receiptReference = (paymentIds: number[]) =>
  `XN-${Math.min(...paymentIds)}`;

export type ReceiptLine = { label: string; amount: string };

export type Receipt = {
  reference: string;
  at: string;
  date: string;
  student: { name: string; cardNumber: string | null };
  takenBy: string;
  lines: ReceiptLine[];
  total: string;
  /**
   * Set only on a voided transaction. The reprint stamps it across the paper —
   * a cancelled receipt must never come off the printer looking valid.
   */
  cancelled?: { date: string; at: string; by: string; reason: string } | null;
};

/** A transaction as the Receipts screen lists it. */
export type TransactionSummary = Receipt & {
  /** Null for a legacy row the backfill has not reached; it stands alone. */
  transactionRef: string | null;
  /** Identifies the transaction in a form, whether or not it has a ref. */
  key: string;
  paymentIds: number[];
  studentId: number;
  /** Reverting `admissionPaid` is the one side effect a cancel has. */
  hasAdmission: boolean;
};

const paymentSelect = {
  id: true,
  kind: true,
  amount: true,
  paidAt: true,
  billingYear: true,
  billingMonth: true,
  transactionRef: true,
  cancelled: true,
  cancelledAt: true,
  cancelReason: true,
  cancelledBy: { select: { username: true } },
  takenBy: { select: { username: true } },
  student: { select: { id: true, name: true, cardNumber: true } },
  course: {
    select: {
      name: true,
      grade: { select: { label: true } },
      subject: { select: { label: true } },
      classType: { select: { label: true } },
      teacher: { select: { name: true } },
    },
  },
} as const;

type PaymentRow = Awaited<ReturnType<typeof db.payment.findMany<{ select: typeof paymentSelect }>>>[number];

/** One printed line. CLASS rows name the course and the month they settle. */
function lineFor(row: PaymentRow): ReceiptLine {
  const amount = Number(String(row.amount)).toFixed(2);

  if (row.kind === "ADMISSION") return { label: "Admission fee", amount };
  if (row.kind === "SMART_CARD") return { label: "Smart card", amount };

  const course = row.course ? courseDisplayName(row.course) : "Class fee";
  const when =
    row.billingYear !== null && row.billingMonth !== null
      ? ` — ${monthLabel(row.billingYear, row.billingMonth)}`
      : "";
  return { label: `${course}${when}`, amount };
}

/**
 * A legacy row with no ref is a transaction of one. Keyed by id so it can never
 * collide with — or be swept up by — the other nulls: `transactionRef: null`
 * as a WHERE clause would match every un-backfilled row in the table.
 */
export const transactionKey = (row: { id: number; transactionRef: string | null }) =>
  row.transactionRef ? `ref:${row.transactionRef}` : `pay:${row.id}`;

function toTransaction(rows: PaymentRow[]): TransactionSummary {
  const first = rows[0];
  const paid = colomboNow(first.paidAt);
  // ANY cancelled row voids the whole document. Cancelling always takes the
  // transaction as a unit, so this only bites on legacy rows voided one at a
  // time — and there, a clean-looking reprint of "the rest" would be a lie.
  const voided = rows.find((r) => r.cancelled && r.cancelledAt);

  return {
    key: transactionKey(first),
    transactionRef: first.transactionRef,
    paymentIds: rows.map((r) => r.id),
    reference: receiptReference(rows.map((r) => r.id)),
    date: paid.date,
    at: paid.time,
    studentId: first.student.id,
    student: { name: first.student.name, cardNumber: first.student.cardNumber },
    takenBy: first.takenBy.username,
    lines: rows.map(lineFor),
    total: rows.reduce((sum, r) => sum + Number(String(r.amount)), 0).toFixed(2),
    hasAdmission: rows.some((r) => r.kind === "ADMISSION"),
    cancelled:
      voided && voided.cancelledAt
        ? {
            date: colomboNow(voided.cancelledAt).date,
            at: colomboNow(voided.cancelledAt).time,
            by: voided.cancelledBy?.username ?? "—",
            reason: voided.cancelReason ?? "",
          }
        : null,
  };
}

/** Newest first, and within a receipt the rows keep the order they were written. */
function group(rows: PaymentRow[]): TransactionSummary[] {
  const buckets = new Map<string, PaymentRow[]>();
  for (const row of rows) {
    const key = transactionKey(row);
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }
  return [...buckets.values()]
    .map((list) => toTransaction([...list].sort((a, b) => a.id - b.id)))
    .sort((a, b) => (a.date === b.date ? b.at.localeCompare(a.at) : b.date.localeCompare(a.date)));
}

/**
 * Every row of one transaction, cancelled rows included — the reprint needs
 * them to know it must stamp CANCELLED, and the cancel needs them to void the
 * receipt as a unit.
 */
export async function loadTransaction(key: string): Promise<TransactionSummary | null> {
  const [kind, value] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];

  const rows =
    kind === "ref"
      ? await db.payment.findMany({ where: { transactionRef: value }, select: paymentSelect })
      : await db.payment.findMany({
          // A ref-less legacy row: itself only, never every other null row.
          where: { id: Number(value), transactionRef: null },
          select: paymentSelect,
        });

  if (rows.length === 0) return null;
  return toTransaction([...rows].sort((a, b) => a.id - b.id));
}

export type TransactionFilters = {
  /** Card number, name or school fragment. */
  q?: string;
  from?: string;
  to?: string;
  /** Cancelled receipts are hidden unless asked for. */
  includeCancelled?: boolean;
};

/**
 * Find transactions to reprint or void. Deliberately requires a filter: this is
 * a scoped payment lookup, not the Search tag, and an unfiltered dump of every
 * payment ever taken is neither useful at a counter nor cheap.
 */
export async function findTransactions(
  filters: TransactionFilters,
): Promise<TransactionSummary[]> {
  const q = filters.q?.trim() ?? "";
  const hasRange = Boolean(filters.from && filters.to);
  if (q.length < 2 && !hasRange) return [];

  const rows = await db.payment.findMany({
    where: {
      ...(filters.includeCancelled ? {} : { cancelled: false }),
      ...(q.length >= 2
        ? {
            student: {
              OR: [
                { cardNumber: { contains: q, mode: "insensitive" as const } },
                { name: { contains: q, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
      ...(hasRange
        ? {
            paidAt: colomboRangeUtc(filters.from!, filters.to!),
          }
        : {}),
    },
    select: paymentSelect,
    orderBy: { paidAt: "desc" },
    // A counter lookup, not a report: enough rows to find the receipt in hand.
    take: 300,
  });

  return group(rows);
}
