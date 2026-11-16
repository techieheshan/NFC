"use server";

import { revalidatePath } from "next/cache";

import { requireOperationalAccess, requireRole } from "@/lib/authz";
import { colomboDateValue, colomboNow } from "@/lib/colombo-time";
import { centsToDecimalString, columnToCents } from "@/lib/saved-day/money";
import { parseRealDate, shiftDay } from "@/lib/daily-summary-dates";
import { db } from "@/lib/db";
import { codeFromLabel, parseCancelReason, parseIncomeInput, type IncomeMethodValue } from "@/lib/other-income";

const PATH = "/other-incomes";

/** Cancelling an income and managing its categories change the institute's money record: ADMIN only (AGENTS 29). */
const requireAdmin = () => requireRole(["ADMIN"]);

/** `values` echoes a rejected submission back so React's post-action form reset does not wipe it (AGENTS 14). */
export type ActionState = { ok: boolean; error?: string; values?: Record<string, string> };

function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
const fail = (formData: FormData, error: string): ActionState => ({ ok: false, error, values: echo(formData) });

export type IncomeRow = {
  id: number;
  categoryId: number;
  categoryLabel: string;
  /** "123.45" — the stored Decimal's exact text. */
  amount: string;
  /** "YYYY-MM-DD", the Colombo calendar day. */
  date: string;
  source: string | null;
  note: string;
  method: IncomeMethodValue;
  receivedBy: string;
  recordedBy: string;
  cancelled: boolean;
  cancelReason: string | null;
  cancelledBy: string | null;
};

export type CategoryRow = { id: number; code: string; label: string; active: boolean; uses: number };
export type Receiver = { id: string; name: string; role: "ADMIN" | "STAFF" };
export type IncomeFilters = { from?: string; to?: string; category?: string };

const personName = (u: { username: string; staff: { name: string } | null }) => u.staff?.name ?? u.username;

const rowInclude = {
  category: { select: { id: true, label: true } },
  receivedBy: { select: { username: true, staff: { select: { name: true } } } },
  recordedBy: { select: { username: true, staff: { select: { name: true } } } },
  cancelledBy: { select: { username: true, staff: { select: { name: true } } } },
} as const;

/** The incomes of a range of days (default: this month), newest first. A real date or nothing: junk in the URL is ignored. */
export async function listIncomes(filters: IncomeFilters = {}): Promise<IncomeRow[]> {
  await requireOperationalAccess();
  const today = colomboNow().date;
  const from = parseRealDate(filters.from) ?? `${today.slice(0, 8)}01`;
  const to = parseRealDate(filters.to) ?? today;
  const categoryId = Number(filters.category);

  const rows = await db.otherIncome.findMany({
    where: {
      date: { gte: colomboDateValue(from <= to ? from : to), lt: colomboDateValue(shiftDay(from <= to ? to : from, 1)) },
      ...(Number.isInteger(categoryId) && categoryId > 0 ? { categoryId } : {}),
    },
    include: rowInclude,
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: 500,
  });

  return rows.map((r) => ({
    id: r.id,
    categoryId: r.category.id,
    categoryLabel: r.category.label,
    amount: centsToDecimalString(columnToCents(r.amount)),
    date: r.date.toISOString().slice(0, 10),
    source: r.source,
    note: r.note,
    method: r.method,
    receivedBy: personName(r.receivedBy),
    recordedBy: personName(r.recordedBy),
    cancelled: r.cancelled,
    cancelReason: r.cancelReason,
    cancelledBy: r.cancelledBy ? personName(r.cancelledBy) : null,
  }));
}

/** One income for its voucher. Reads like the list: any ADMIN or STAFF account. */
export async function getIncome(id: number): Promise<IncomeRow | null> {
  await requireOperationalAccess();
  if (!Number.isInteger(id) || id <= 0) return null;
  const r = await db.otherIncome.findUnique({ where: { id }, include: rowInclude });
  if (!r) return null;
  return {
    id: r.id,
    categoryId: r.category.id,
    categoryLabel: r.category.label,
    amount: centsToDecimalString(columnToCents(r.amount)),
    date: r.date.toISOString().slice(0, 10),
    source: r.source,
    note: r.note,
    method: r.method,
    receivedBy: personName(r.receivedBy),
    recordedBy: personName(r.recordedBy),
    cancelled: r.cancelled,
    cancelReason: r.cancelReason,
    cancelledBy: r.cancelledBy ? personName(r.cancelledBy) : null,
  };
}

/** The categories staff may pick (active only). */
export async function listActiveCategories(): Promise<{ id: number; label: string }[]> {
  await requireOperationalAccess();
  return db.incomeCategory.findMany({ where: { active: true }, select: { id: true, label: true }, orderBy: { label: "asc" } });
}

/** Every category with how many incomes use it, for the ADMIN screen. */
export async function listAllCategories(): Promise<CategoryRow[]> {
  await requireAdmin();
  const rows = await db.incomeCategory.findMany({ include: { _count: { select: { incomes: true } } }, orderBy: { label: "asc" } });
  return rows.map((c) => ({ id: c.id, code: c.code, label: c.label, active: c.active, uses: c._count.incomes }));
}

/** Active ADMIN / STAFF accounts that may be named as having received the money (like the expense authorisers). */
export async function listReceivers(): Promise<Receiver[]> {
  await requireOperationalAccess();
  const users = await db.user.findMany({
    where: { active: true, role: { in: ["ADMIN", "STAFF"] } },
    select: { id: true, username: true, role: true, staff: { select: { name: true } } },
    orderBy: [{ role: "asc" }, { username: "asc" }],
  });
  return users.map((u) => ({ id: u.id, name: personName(u), role: u.role as "ADMIN" | "STAFF" }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createIncome(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireOperationalAccess();

  const parsed = parseIncomeInput(Object.fromEntries(formData.entries()), colomboNow().date);
  if (!parsed.ok) return fail(formData, parsed.error);
  const v = parsed.value;

  // The browser sent two ids. Both must be real and usable NOW: a retired category or a deactivated login is refused.
  const [category, receiver] = await Promise.all([
    db.incomeCategory.findFirst({ where: { id: v.categoryId, active: true }, select: { id: true } }),
    db.user.findFirst({ where: { id: v.receivedById, active: true, role: { in: ["ADMIN", "STAFF"] } }, select: { id: true } }),
  ]);
  if (!category) return fail(formData, "Pick an active category.");
  if (!receiver) return fail(formData, "Pick who received the money from the list.");

  await db.otherIncome.create({
    data: {
      categoryId: category.id,
      amount: centsToDecimalString(v.cents),
      date: colomboDateValue(v.date),
      source: v.source,
      note: v.note,
      method: v.method,
      receivedById: receiver.id,
      recordedById: user.id,
    },
  });

  revalidatePath(PATH);
  revalidatePath("/daily-summary");
  return { ok: true };
}

/**
 * Cancels an income: sets the flag, never deletes, never touches the amount. ADMIN only. Cancelling twice is a no-op that says so
 * (the update only matches a row that is still live, so two admins tapping at once cancel it once).
 */
export async function cancelIncome(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return fail(formData, "That income could not be found.");
  const reason = parseCancelReason(formData.get("reason"));
  if (!reason.ok) return fail(formData, reason.error);

  const done = await db.otherIncome.updateMany({
    where: { id, cancelled: false },
    data: { cancelled: true, cancelledById: admin.id, cancelledAt: new Date(), cancelReason: reason.reason },
  });
  if (done.count === 0) {
    const exists = await db.otherIncome.findUnique({ where: { id }, select: { cancelled: true } });
    return fail(formData, exists ? "That income is already cancelled." : "That income could not be found.");
  }

  revalidatePath(PATH);
  revalidatePath("/daily-summary");
  return { ok: true };
}

export async function createCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const label = String(formData.get("label") ?? "").trim();
  if (label.length < 2 || label.length > 60) return fail(formData, "Give the category a name (2 to 60 characters).");
  const code = codeFromLabel(label);
  if (code === "") return fail(formData, "Use letters or digits in the name.");
  if (await db.incomeCategory.findFirst({ where: { OR: [{ code }, { label: { equals: label, mode: "insensitive" } }] }, select: { id: true } })) {
    return fail(formData, "A category with that name already exists.");
  }
  await db.incomeCategory.create({ data: { code, label } });
  revalidatePath(PATH);
  return { ok: true };
}

export async function renameCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const label = String(formData.get("label") ?? "").trim();
  if (!Number.isInteger(id) || id <= 0) return fail(formData, "That category could not be found.");
  if (label.length < 2 || label.length > 60) return fail(formData, "Give the category a name (2 to 60 characters).");
  const clash = await db.incomeCategory.findFirst({ where: { id: { not: id }, label: { equals: label, mode: "insensitive" } }, select: { id: true } });
  if (clash) return fail(formData, "A category with that name already exists.");
  // The code never changes: old rows and any future report keep pointing at the same thing.
  const done = await db.incomeCategory.updateMany({ where: { id }, data: { label } });
  if (done.count === 0) return fail(formData, "That category could not be found.");
  revalidatePath(PATH);
  return { ok: true };
}

/** Retire or bring back a category (AGENTS 9: soft delete, never a delete — old incomes point at it). */
export async function setCategoryActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const active = formData.get("active") === "true";
  if (!Number.isInteger(id) || id <= 0) return fail(formData, "That category could not be found.");
  const done = await db.incomeCategory.updateMany({ where: { id }, data: { active } });
  if (done.count === 0) return fail(formData, "That category could not be found.");
  revalidatePath(PATH);
  return { ok: true };
}
