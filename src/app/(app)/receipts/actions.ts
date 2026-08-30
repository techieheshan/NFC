"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOperationalAccess, requireRole } from "@/lib/authz";
import { db } from "@/lib/db";
import {
  loadTransaction,
  type TransactionSummary,
} from "@/lib/receipts";

const PATH = "/receipts";

export type ActionState = {
  ok: boolean;
  error?: string;
  values?: Record<string, string>;
};

/** `ref:<uuid>` for a grouped receipt, `pay:<id>` for a ref-less legacy row. */
const keySchema = z
  .string()
  .trim()
  .regex(/^(ref:[0-9a-fA-F-]{10,64}|pay:[1-9][0-9]{0,9})$/, "Unknown transaction.");

/**
 * Reprint. ADMIN + STAFF — a reprint changes nothing, but it does expose what a
 * student paid, so it is guarded like every other read here.
 */
export async function reprintTransaction(key: string): Promise<TransactionSummary | null> {
  await requireOperationalAccess();

  const parsed = keySchema.safeParse(key);
  if (!parsed.success) return null;

  return loadTransaction(parsed.data);
}

/**
 * Void a whole transaction. ADMIN only — `requireRole` here, not the operational
 * guard, because a server action is its own HTTP endpoint and hiding the button
 * from staff protects nothing.
 *
 * Nothing is deleted and no money is recomputed: the rows keep their amounts and
 * gain the audit fields, and every report already excludes cancelled rows.
 */
export async function cancelTransaction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireRole(["ADMIN"]);

  const values = { reason: String(formData.get("reason") ?? "") };

  const key = keySchema.safeParse(formData.get("key"));
  if (!key.success) return { ok: false, error: key.error.issues[0].message, values };

  const reason = z
    .string()
    .trim()
    .min(3, "A reason is required to cancel a receipt.")
    .max(300)
    .safeParse(values.reason);
  if (!reason.success) return { ok: false, error: reason.error.issues[0].message, values };

  const transaction = await loadTransaction(key.data);
  if (!transaction) return { ok: false, error: "That transaction no longer exists.", values };
  if (transaction.cancelled) {
    return { ok: false, error: "This receipt is already cancelled.", values };
  }

  await db.$transaction(async (tx) => {
    await tx.payment.updateMany({
      // By id, not by ref: a ref-less legacy row must void itself alone, and
      // `transactionRef: null` as a filter would match every un-backfilled row.
      where: { id: { in: transaction.paymentIds }, cancelled: false },
      data: {
        cancelled: true,
        cancelledById: user.id,
        cancelledAt: new Date(),
        cancelReason: reason.data,
      },
    });

    // The only side effect: admission is a one-time flag that moved with the
    // payment, so voiding the payment must move it back. A cancelled smart card
    // leaves cardUid alone — the physical card was already handed over.
    if (transaction.hasAdmission) {
      await tx.student.update({
        where: { id: transaction.studentId },
        data: { admissionPaid: false },
      });
    }
  });

  revalidatePath(PATH);
  return { ok: true };
}
