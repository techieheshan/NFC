"use server";

import { revalidatePath } from "next/cache";

import { requireOperationalAccess, requireRole } from "@/lib/authz";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { extraReceiptRef, parseCancelReason, parseExtraInput, parsePrice, priceBill, type CatalogueItem, LABEL_MAX } from "@/lib/extra-payments";
import { findExtraReceipts, loadExtraReceipt, loadExtraReceiptByRef, type ExtraReceipt } from "@/lib/extra-receipts";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { centsToDecimalString, columnToCents } from "@/lib/saved-day/money";
import { getSetting } from "@/lib/settings";
import { decimalToCents } from "@/lib/cents";

/** The price list and cancelling a bill change the institute's money record: ADMIN only (AGENTS 29). */
const requireAdmin = () => requireRole(["ADMIN"]);

export type { ExtraReceipt };
export type ActionState = { ok: boolean; error?: string; values?: Record<string, string> };

function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
const fail = (formData: FormData, error: string): ActionState => ({ ok: false, error, values: echo(formData) });

export type ItemRow = { id: number; label: string; price: string; active: boolean; uses: number };
export type ClassOption = { id: number; label: string };
export type TakeResult = { ok: true; receipt: ExtraReceipt; duplicate: boolean } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Reads (guarded like the writes)
// ---------------------------------------------------------------------------

/** The items staff can sell: active ones, in the admin's order. The price is DISPLAY only: the server prices the bill again. */
export async function listSellableItems(): Promise<{ id: number; label: string; price: string }[]> {
  await requireOperationalAccess();
  const rows = await db.extraItem.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
  return rows.map((r) => ({ id: r.id, label: r.label, price: centsToDecimalString(columnToCents(r.defaultPrice)) }));
}

/** The highest one-off price in cents (0 = one-off items are not allowed): shown so the screen can hide the button. */
export async function getOneOffMaxCents(): Promise<number> {
  await requireOperationalAccess();
  return oneOffMax();
}

async function oneOffMax(): Promise<number> {
  const raw = await getSetting("extra_one_off_max_price");
  if (!raw) return 0;
  const cents = decimalToCents(raw.trim().replace(/,/g, ""));
  return cents > 0 ? cents : 0;
}

export async function listClassOptions(): Promise<ClassOption[]> {
  await requireOperationalAccess();
  const rows = await db.course.findMany({
    where: { active: true },
    select: { id: true, name: true, grade: { select: { label: true } }, subject: { select: { label: true } }, classType: { select: { label: true } }, teacher: { select: { name: true } } },
    orderBy: { id: "asc" },
  });
  return rows.map((c) => ({ id: c.id, label: courseDisplayName(c) }));
}

export async function listAllItems(): Promise<ItemRow[]> {
  await requireAdmin();
  const rows = await db.extraItem.findMany({ include: { _count: { select: { lines: true } } }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
  return rows.map((r) => ({ id: r.id, label: r.label, price: centsToDecimalString(columnToCents(r.defaultPrice)), active: r.active, uses: r._count.lines }));
}

export async function getExtraReceipt(id: number): Promise<ExtraReceipt | null> {
  await requireOperationalAccess();
  return loadExtraReceipt(id);
}

export async function searchExtraReceipts(q: string): Promise<ExtraReceipt[]> {
  await requireOperationalAccess();
  return findExtraReceipts(String(q ?? "").slice(0, 60));
}

// ---------------------------------------------------------------------------
// The sale
// ---------------------------------------------------------------------------

/**
 * Takes an extra payment: ONE bill, ONE receipt. The browser sends item ids and quantities (and, for a one-off line, the typed
 * label and price); every amount is recomputed here from the admin's list (AGENTS 16). All guards run before the first write (AGENTS
 * 3A rule). A double tap or a retry with the same `clientRef` returns the SAME bill and writes nothing more. No Payment row is ever
 * written and no student is touched (AGENTS 13).
 */
export async function takeExtraPayment(input: unknown): Promise<TakeResult> {
  const user = await requireOperationalAccess();

  const parsed = parseExtraInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.value;

  // A retry of a bill that already went through: the same receipt, nothing new written.
  const again = await loadExtraReceiptByRef(v.clientRef);
  if (again) {
    if (again.takenById !== user.id) return { ok: false, error: "That could not be read. Reload the page and try again." };
    return { ok: true, receipt: again.receipt, duplicate: true };
  }

  if (v.studentId !== null && !(await db.student.findUnique({ where: { id: v.studentId }, select: { id: true } }))) return { ok: false, error: "Pick the student again." };
  if (v.courseId !== null && !(await db.course.findFirst({ where: { id: v.courseId, active: true }, select: { id: true } }))) return { ok: false, error: "Pick an active class." };

  const itemIds = v.lines.flatMap((l) => (l.kind === "item" ? [l.itemId] : []));
  const items = itemIds.length ? await db.extraItem.findMany({ where: { id: { in: itemIds }, active: true } }) : [];
  const catalogue = new Map<number, CatalogueItem>(items.map((i) => [i.id, { id: i.id, label: i.label, priceCents: columnToCents(i.defaultPrice) }]));
  const priced = priceBill(v.lines, catalogue, await oneOffMax());
  if (!priced.ok) return { ok: false, error: priced.error };

  try {
    const created = await db.extraPayment.create({
      data: {
        clientRef: v.clientRef,
        studentId: v.studentId,
        courseId: v.courseId,
        note: v.note,
        total: centsToDecimalString(priced.totalCents),
        takenById: user.id,
        lines: {
          create: priced.lines.map((l, i) => ({
            itemId: l.itemId,
            label: l.label,
            quantity: l.quantity,
            unitPrice: centsToDecimalString(l.unitCents),
            amount: centsToDecimalString(l.amountCents),
            custom: l.custom,
            position: i,
          })),
        },
      },
      select: { id: true },
    });
    revalidatePath("/extra-payments");
    revalidatePath("/daily-summary");
    const receipt = await loadExtraReceipt(created.id);
    return receipt ? { ok: true, receipt, duplicate: false } : { ok: false, error: "The bill was saved. Open Receipts to print it." };
  } catch (e) {
    // Two taps raced past the check above: the unique clientRef let exactly one through. Return that one.
    if (isUniqueViolation(e)) {
      const won = await loadExtraReceiptByRef(v.clientRef);
      if (won && won.takenById === user.id) return { ok: true, receipt: won.receipt, duplicate: true };
    }
    throw e;
  }
}

/** Cancels a bill: ADMIN only, a reason, never a delete, amounts untouched. Cancelling twice says so. */
export async function cancelExtraPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return fail(formData, "That receipt could not be found.");
  const reason = parseCancelReason(formData.get("reason"));
  if (!reason.ok) return fail(formData, reason.error);

  const done = await db.extraPayment.updateMany({
    where: { id, cancelled: false },
    data: { cancelled: true, cancelledById: admin.id, cancelledAt: new Date(), cancelReason: reason.reason },
  });
  if (done.count === 0) {
    const exists = await db.extraPayment.findUnique({ where: { id }, select: { cancelled: true } });
    return fail(formData, exists ? `${extraReceiptRef(id)} is already cancelled.` : "That receipt could not be found.");
  }
  revalidatePath("/extra-payments/receipts");
  revalidatePath("/daily-summary");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The admin's item list
// ---------------------------------------------------------------------------

const labelOf = (v: FormDataEntryValue | null) => String(v ?? "").trim();

export async function createExtraItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const label = labelOf(formData.get("label"));
  if (label.length < 2 || label.length > LABEL_MAX) return fail(formData, `Name the item (2 to ${LABEL_MAX} characters).`);
  const price = parsePrice(formData.get("price"));
  if (!price.ok) return fail(formData, price.error);
  if (await db.extraItem.findFirst({ where: { label: { equals: label, mode: "insensitive" }, active: true }, select: { id: true } })) return fail(formData, "An item with that name is already on the list.");
  const last = await db.extraItem.aggregate({ _max: { sortOrder: true } });
  await db.extraItem.create({ data: { label, defaultPrice: centsToDecimalString(price.cents), sortOrder: (last._max.sortOrder ?? 0) + 1 } });
  revalidatePath("/extra-payments");
  revalidatePath("/extra-payments/items");
  return { ok: true };
}

/** A new price or name applies to FUTURE bills only: every old bill keeps the frozen line it was sold at. */
export async function updateExtraItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return fail(formData, "That item could not be found.");
  const label = labelOf(formData.get("label"));
  if (label.length < 2 || label.length > LABEL_MAX) return fail(formData, `Name the item (2 to ${LABEL_MAX} characters).`);
  const price = parsePrice(formData.get("price"));
  if (!price.ok) return fail(formData, price.error);
  const clash = await db.extraItem.findFirst({ where: { id: { not: id }, active: true, label: { equals: label, mode: "insensitive" } }, select: { id: true } });
  if (clash) return fail(formData, "An item with that name is already on the list.");
  const done = await db.extraItem.updateMany({ where: { id }, data: { label, defaultPrice: centsToDecimalString(price.cents) } });
  if (done.count === 0) return fail(formData, "That item could not be found.");
  revalidatePath("/extra-payments");
  revalidatePath("/extra-payments/items");
  return { ok: true };
}

/** Retire or bring back an item (AGENTS 9: soft delete). */
export async function setExtraItemActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const active = formData.get("active") === "true";
  if (!Number.isInteger(id) || id <= 0) return fail(formData, "That item could not be found.");
  const done = await db.extraItem.updateMany({ where: { id }, data: { active } });
  if (done.count === 0) return fail(formData, "That item could not be found.");
  revalidatePath("/extra-payments");
  revalidatePath("/extra-payments/items");
  return { ok: true };
}
