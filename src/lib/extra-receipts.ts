import "server-only";

import { colomboNow } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { columnToCents, centsToDecimalString } from "@/lib/saved-day/money";
import { extraReceiptRef, parseExtraReceiptRef } from "@/lib/extra-payments";
import { formatMoney } from "@/lib/cents";

/*
 * Reading an extra payment back as a receipt. Not a server action: the guarded actions in `extra-payments/actions.ts` call these
 * after `requireOperationalAccess`, so a reprint and the receipts list rebuild the SAME document the sale printed. Amounts are the
 * stored snapshots; nothing is recomputed here.
 */

export type ExtraReceipt = {
  id: number;
  reference: string;
  /** "YYYY-MM-DD" (Colombo) and "HH:mm". */
  date: string;
  at: string;
  student: { id: number; name: string; cardNumber: string | null } | null;
  course: string | null;
  note: string | null;
  lines: { label: string; quantity: number; unit: string; amount: string; custom: boolean }[];
  total: string;
  takenBy: string;
  cancelled: null | { date: string; at: string; by: string; reason: string };
};

const include = {
  student: { select: { id: true, name: true, cardNumber: true } },
  course: { select: { name: true, grade: { select: { label: true } }, subject: { select: { label: true } }, classType: { select: { label: true } }, teacher: { select: { name: true } } } },
  lines: { orderBy: { position: "asc" as const } },
  takenBy: { select: { username: true, staff: { select: { name: true } } } },
  cancelledBy: { select: { username: true, staff: { select: { name: true } } } },
} as const;

type Row = NonNullable<Awaited<ReturnType<typeof findRow>>>;
const findRow = (where: { id: number } | { clientRef: string }) => db.extraPayment.findUnique({ where, include });

const personName = (u: { username: string; staff: { name: string } | null }) => u.staff?.name ?? u.username;

function toReceipt(r: Row): ExtraReceipt {
  const when = colomboNow(r.paidAt);
  const voided = r.cancelled && r.cancelledAt && r.cancelledBy ? colomboNow(r.cancelledAt) : null;
  return {
    id: r.id,
    reference: extraReceiptRef(r.id),
    date: when.date,
    at: when.time,
    student: r.student,
    course: r.course ? courseDisplayName(r.course) : null,
    note: r.note,
    lines: r.lines.map((l) => ({
      label: l.label,
      quantity: l.quantity,
      unit: formatMoney(centsToDecimalString(columnToCents(l.unitPrice))),
      amount: formatMoney(centsToDecimalString(columnToCents(l.amount))),
      custom: l.custom,
    })),
    total: formatMoney(centsToDecimalString(columnToCents(r.total))),
    takenBy: personName(r.takenBy),
    cancelled: voided && r.cancelledBy ? { date: voided.date, at: voided.time, by: personName(r.cancelledBy), reason: r.cancelReason ?? "" } : null,
  };
}

export async function loadExtraReceipt(id: number): Promise<ExtraReceipt | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const r = await findRow({ id });
  return r ? toReceipt(r) : null;
}

export async function loadExtraReceiptByRef(clientRef: string): Promise<{ receipt: ExtraReceipt; takenById: string } | null> {
  const r = await findRow({ clientRef });
  return r ? { receipt: toReceipt(r), takenById: r.takenById } : null;
}

/** The newest receipts (10), or a search by `XA-` number, or by 2+ characters of a student's name or card number (up to 20). */
export async function findExtraReceipts(q: string): Promise<ExtraReceipt[]> {
  const term = q.trim();
  let where: Record<string, unknown> = {};
  let take = 10;
  if (term !== "") {
    take = 20;
    const id = parseExtraReceiptRef(term);
    if (id !== null) where = { id };
    else if (term.length >= 2) where = { student: { OR: [{ name: { contains: term, mode: "insensitive" } }, { cardNumber: { contains: term, mode: "insensitive" } }] } };
    else return [];
  }
  const rows = await db.extraPayment.findMany({ where, include, orderBy: { id: "desc" }, take });
  return rows.map(toReceipt);
}
