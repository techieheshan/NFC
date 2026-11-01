import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { loadTransaction, transactionKey, type TransactionSummary } from "@/lib/receipts";

/**
 * "Last 10 receipts" and the receipt search for the new payment screens. READ-ONLY: every
 * statement here is a SELECT, and nothing here prices, groups or prints anything itself.
 *
 * A receipt is a TRANSACTION (see receipts.ts), and one receipt may be many rows — an
 * admission, a smart card and a three-month catch-up are one document. So "the latest 10" can
 * never be "the latest 10 rows". The rule here:
 *
 *   1. Walk the payments newest first, in pages, collecting the distinct transaction KEYS
 *      (`transactionKey`: `ref:<uuid>`, or `pay:<id>` for a legacy row with no ref) until
 *      there are enough. Only ids and refs are read at this step, and the walk never filters
 *      on `transactionRef: null` — that would match every un-backfilled row (AGENTS rule 18).
 *   2. Hand each key to the existing `loadTransaction`, which reads EVERY row of that
 *      transaction (cancelled ones too) and builds the same TransactionSummary the Receipts
 *      page lists and the reprint prints. Nothing is re-derived here, so the list, the
 *      Receipts page and a reprint cannot disagree about a total, a line or a number.
 *
 * Callers apply their own role guard (the page does, with `requirePaymentNewPage`).
 */

export const LAST_RECEIPTS = 10;
export const SEARCH_RECEIPTS = 20;
/** Rows read per step of the newest-first walk. */
const PAGE = 200;

export type ReceiptList = {
  receipts: TransactionSummary[];
  /** True when more receipts exist than were returned — the page says so. */
  more: boolean;
};

/**
 * The receipt number a query asks for: `XN-1493`, `xn1493`, `xn 1493` or `1493`. Anything else
 * (a name, a card number such as `0186-0002-2000`) is not a receipt number.
 */
export function parseReceiptNumber(raw: string): number | null {
  const m = /^\s*(?:xn\s*-?\s*)?(\d{1,9})\s*$/i.exec(raw);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Distinct transaction keys, newest first, up to `limit`. */
async function newestKeys(where: Prisma.PaymentWhereInput, limit: number): Promise<string[]> {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let skip = 0; keys.length < limit; skip += PAGE) {
    const rows = await db.payment.findMany({
      where,
      select: { id: true, transactionRef: true },
      // paidAt is one instant per checkout, so a receipt sits together; id breaks ties.
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      skip,
      take: PAGE,
    });
    for (const row of rows) {
      const key = transactionKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
      if (keys.length === limit) break;
    }
    if (rows.length < PAGE) break;
  }
  return keys;
}

/** The complete receipts for these keys, in the same order. */
async function loadAll(keys: string[], preloaded: Map<string, TransactionSummary> = new Map()) {
  const loaded = await Promise.all(keys.map((key) => preloaded.get(key) ?? loadTransaction(key)));
  return loaded.filter((t): t is TransactionSummary => t !== null);
}

/** The 10 most recent receipts, newest first — cancelled ones included, with their chip. */
export async function lastReceipts(): Promise<ReceiptList> {
  const keys = await newestKeys({}, LAST_RECEIPTS + 1);
  return { receipts: await loadAll(keys.slice(0, LAST_RECEIPTS)), more: keys.length > LAST_RECEIPTS };
}

/**
 * The receipt whose NUMBER is `n`. `XN-n` names a receipt only when `n` is the LOWEST payment id
 * of its transaction: the id of a middle row is a payment, not a receipt number, and matches
 * nothing. A legacy row with no ref is a transaction of one, so it is its own lowest id.
 */
export async function receiptByNumber(n: number): Promise<TransactionSummary | null> {
  const row = await db.payment.findUnique({ where: { id: n }, select: { id: true, transactionRef: true } });
  if (!row) return null;
  const transaction = await loadTransaction(transactionKey(row));
  return transaction && Math.min(...transaction.paymentIds) === n ? transaction : null;
}

export type ReceiptSearch = ReceiptList & {
  /** The query was too short to search with; nothing was read. */
  tooShort: boolean;
};

/**
 * Search by student name, card number or receipt number, newest first, at most SEARCH_RECEIPTS.
 * A name or card fragment needs 2 characters (as the Receipts page does); a receipt number may
 * be a single digit, because `XN-5` is exact rather than a scan. A receipt-number match comes
 * first, then the student matches.
 */
export async function searchReceipts(raw: string): Promise<ReceiptSearch> {
  const q = raw.trim();
  const number = parseReceiptNumber(q);
  if (q.length < 2 && number === null) return { receipts: [], more: false, tooShort: true };

  const preloaded = new Map<string, TransactionSummary>();
  const keys: string[] = [];
  if (number !== null) {
    const hit = await receiptByNumber(number);
    if (hit) {
      preloaded.set(hit.key, hit);
      keys.push(hit.key);
    }
  }
  if (q.length >= 2) {
    const found = await newestKeys(
      {
        student: {
          OR: [
            { cardNumber: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
          ],
        },
      },
      SEARCH_RECEIPTS + 1,
    );
    for (const key of found) if (!keys.includes(key)) keys.push(key);
  }

  return {
    receipts: await loadAll(keys.slice(0, SEARCH_RECEIPTS), preloaded),
    more: keys.length > SEARCH_RECEIPTS,
    tooShort: false,
  };
}
