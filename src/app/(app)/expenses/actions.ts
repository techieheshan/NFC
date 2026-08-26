"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOperationalAccess, requireRole } from "@/lib/authz";
import { colomboDateValue, colomboNow } from "@/lib/colombo-time";
import { db } from "@/lib/db";

const PATH = "/expenses";

/** Editing money records is ADMIN-only; staff record but never silently alter. */
const requireAdmin = () => requireRole(["ADMIN"]);

/**
 * `values` echoes a rejected submission back so React's post-action form reset
 * doesn't wipe what the user typed. See AGENTS.md rule 14.
 */
export type ActionState = {
  ok: boolean;
  error?: string;
  values?: Record<string, string>;
};

function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
const fail = (formData: FormData, error: string): ActionState => ({
  ok: false,
  error,
  values: echo(formData),
});

export type PersonRef = { kind: "teacher" | "staff"; id: number; name: string } | null;

export type ExpenseRow = {
  id: number;
  typeCode: string;
  typeLabel: string;
  affectsTeacherPayslip: boolean;
  amount: string;
  reason: string;
  /** "YYYY-MM-DD", the Colombo calendar day. */
  date: string;
  person: PersonRef;
  isStaffAdvance: boolean;
  recordedBy: string;
};

export type StaffAdvanceRow = {
  id: number;
  staffId: number;
  staff: string;
  amount: string;
  date: string;
  reason: string;
};

export type StaffAdvanceReport = {
  rows: StaffAdvanceRow[];
  /** Per-staff totals — what the separate payroll system deducts manually. */
  totals: { staffId: number; staff: string; total: string; count: number }[];
  grandTotal: string;
};

export type ExpenseFilters = {
  type?: string;
  from?: string;
  to?: string;
  person?: string;
};

export type DateRange = { from?: string; to?: string };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const id = z.coerce.number().int().positive();

const amountSchema = z.coerce
  .number()
  .refine(Number.isFinite, "Enter a valid amount.")
  .positive("Amount must be greater than zero.")
  .max(99_999_999, "Amount is too large.");

const reasonSchema = z
  .string()
  .trim()
  .min(1, "A reason is required.")
  .max(300, "Reason is too long.");

const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date.");

const money = (n: number) => n.toFixed(2);
const isDate = (v?: string) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

/** Expense types are looked up by their stable `code`; ids are never inlined. */
async function typeByCode(code: "TEACHER_ADVANCE" | "XENON") {
  return db.expenseType.findUniqueOrThrow({ where: { code } });
}

/** Half-open upper bound so a `to` date includes that whole day. */
function dateWhere(from?: string, to?: string) {
  if (!isDate(from) && !isDate(to)) return {};
  const next = (d: string) => {
    const x = new Date(`${d}T00:00:00.000Z`);
    x.setUTCDate(x.getUTCDate() + 1);
    return x;
  };
  return {
    date: {
      ...(isDate(from) ? { gte: colomboDateValue(from!) } : {}),
      ...(isDate(to) ? { lt: next(to!) } : {}),
    },
  };
}

const expenseInclude = {
  type: { select: { code: true, label: true, affectsTeacherPayslip: true } },
  teacher: { select: { id: true, name: true } },
  staff: { select: { id: true, name: true } },
  recordedBy: { select: { username: true } },
} as const;

// ---------------------------------------------------------------------------
// Reads — guarded like the writes. An expense list is the institute's cost
// book; it must not be readable by a role that can't record one.
// ---------------------------------------------------------------------------

export async function listExpenses(
  filters: ExpenseFilters = {},
): Promise<ExpenseRow[]> {
  await requireOperationalAccess();

  // "t6" / "s17" — one control in the UI, either kind of person.
  const person = filters.person ?? "";
  const personId = Number(person.slice(1));
  const personWhere =
    person.startsWith("t") && Number.isInteger(personId)
      ? { teacherId: personId }
      : person.startsWith("s") && Number.isInteger(personId)
        ? { staffId: personId }
        : {};

  const rows = await db.expense.findMany({
    where: {
      ...(filters.type === "TEACHER_ADVANCE" || filters.type === "XENON"
        ? { type: { code: filters.type } }
        : {}),
      ...dateWhere(filters.from, filters.to),
      ...personWhere,
    },
    include: expenseInclude,
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });

  return rows.map((e) => ({
    id: e.id,
    typeCode: e.type.code,
    typeLabel: e.type.label,
    affectsTeacherPayslip: e.type.affectsTeacherPayslip,
    amount: money(Number(String(e.amount))),
    reason: e.reason,
    date: e.date.toISOString().slice(0, 10),
    person: e.teacher
      ? { kind: "teacher" as const, id: e.teacher.id, name: e.teacher.name }
      : e.staff
        ? { kind: "staff" as const, id: e.staff.id, name: e.staff.name }
        : null,
    isStaffAdvance: e.isStaffAdvance,
    recordedBy: e.recordedBy.username,
  }));
}

/**
 * Staff advances only — XENON rows carrying the flag.
 *
 * These are NOT a separate expense category: they are ordinary Xenon expenses
 * and are counted once in every total. This report exists purely so the separate
 * staff-payroll system can deduct them manually.
 */
export async function listStaffAdvances(
  range: DateRange = {},
): Promise<StaffAdvanceReport> {
  await requireOperationalAccess();

  const rows = await db.expense.findMany({
    where: {
      isStaffAdvance: true,
      type: { code: "XENON" },
      staffId: { not: null },
      ...dateWhere(range.from, range.to),
    },
    include: { staff: { select: { id: true, name: true } } },
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });

  const mapped: StaffAdvanceRow[] = rows.map((e) => ({
    id: e.id,
    staffId: e.staff!.id,
    staff: e.staff!.name,
    amount: money(Number(String(e.amount))),
    date: e.date.toISOString().slice(0, 10),
    reason: e.reason,
  }));

  const byStaff = new Map<number, { staff: string; total: number; count: number }>();
  for (const r of mapped) {
    const current = byStaff.get(r.staffId) ?? { staff: r.staff, total: 0, count: 0 };
    current.total += Number(r.amount);
    current.count += 1;
    byStaff.set(r.staffId, current);
  }

  return {
    rows: mapped,
    totals: [...byStaff.entries()]
      .map(([staffId, v]) => ({
        staffId,
        staff: v.staff,
        total: money(v.total),
        count: v.count,
      }))
      .sort((a, b) => Number(b.total) - Number(a.total)),
    grandTotal: money(mapped.reduce((s, r) => s + Number(r.amount), 0)),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createTeacherAdvance(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperationalAccess();

  const parsed = z
    .object({
      teacherId: id,
      date: dateSchema,
      reason: reasonSchema,
      amount: amountSchema,
    })
    .safeParse({
      teacherId: formData.get("teacherId"),
      date: formData.get("date"),
      reason: formData.get("reason"),
      amount: formData.get("amount"),
    });

  if (!parsed.success) {
    // A missing teacher surfaces as a coercion failure; say so plainly.
    const issue = parsed.error.issues[0];
    return fail(
      formData,
      issue.path[0] === "teacherId" ? "Select a teacher." : issue.message,
    );
  }

  const teacher = await db.teacher.findFirst({
    where: { id: parsed.data.teacherId, active: true },
    select: { id: true },
  });
  if (!teacher) return fail(formData, "Select an active teacher.");

  const type = await typeByCode("TEACHER_ADVANCE");

  await db.expense.create({
    data: {
      expenseTypeId: type.id,
      amount: money(parsed.data.amount),
      reason: parsed.data.reason,
      date: colomboDateValue(parsed.data.date),
      teacherId: teacher.id,
      // A teacher advance is never a staff advance.
      isStaffAdvance: false,
      staffId: null,
      recordedById: user.id,
    },
  });

  revalidatePath(PATH);
  return { ok: true };
}

export async function createXenonExpense(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireOperationalAccess();

  const isStaffAdvance =
    formData.get("isStaffAdvance") === "on" ||
    formData.get("isStaffAdvance") === "true";

  const parsed = z
    .object({ date: dateSchema, reason: reasonSchema, amount: amountSchema })
    .safeParse({
      date: formData.get("date"),
      reason: formData.get("reason"),
      amount: formData.get("amount"),
    });

  if (!parsed.success) return fail(formData, parsed.error.issues[0].message);

  let staffId: number | null = null;
  if (isStaffAdvance) {
    const parsedStaff = id.safeParse(formData.get("staffId"));
    if (!parsedStaff.success) {
      return fail(formData, "Select the staff member this advance is for.");
    }
    const staff = await db.staff.findFirst({
      where: { id: parsedStaff.data, active: true },
      select: { id: true },
    });
    if (!staff) return fail(formData, "Select an active staff member.");
    staffId = staff.id;
  }

  const type = await typeByCode("XENON");

  await db.expense.create({
    data: {
      expenseTypeId: type.id,
      amount: money(parsed.data.amount),
      reason: parsed.data.reason,
      date: colomboDateValue(parsed.data.date),
      teacherId: null,
      isStaffAdvance,
      staffId,
      recordedById: user.id,
    },
  });

  revalidatePath(PATH);
  return { ok: true };
}

/** ADMIN only — correcting a recorded expense changes the books. */
export async function updateExpense(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const expenseId = id.safeParse(formData.get("id"));
  if (!expenseId.success) return fail(formData, "Invalid expense.");

  const parsed = z
    .object({ date: dateSchema, reason: reasonSchema, amount: amountSchema })
    .safeParse({
      date: formData.get("date"),
      reason: formData.get("reason"),
      amount: formData.get("amount"),
    });
  if (!parsed.success) return fail(formData, parsed.error.issues[0].message);

  const existing = await db.expense.findUnique({
    where: { id: expenseId.data },
    include: { type: { select: { code: true } } },
  });
  if (!existing) return fail(formData, "That expense no longer exists.");

  // The person can be corrected, but only within the shape the type allows.
  const data: {
    amount: string;
    reason: string;
    date: Date;
    teacherId?: number | null;
    staffId?: number | null;
    isStaffAdvance?: boolean;
  } = {
    amount: money(parsed.data.amount),
    reason: parsed.data.reason,
    date: colomboDateValue(parsed.data.date),
  };

  if (existing.type.code === "TEACHER_ADVANCE") {
    const teacherId = id.safeParse(formData.get("teacherId"));
    if (!teacherId.success) return fail(formData, "Select a teacher.");
    const teacher = await db.teacher.findFirst({
      where: { id: teacherId.data, active: true },
      select: { id: true },
    });
    if (!teacher) return fail(formData, "Select an active teacher.");
    data.teacherId = teacher.id;
  } else if (existing.isStaffAdvance) {
    const staffId = id.safeParse(formData.get("staffId"));
    if (!staffId.success) return fail(formData, "Select a staff member.");
    const staff = await db.staff.findFirst({
      where: { id: staffId.data, active: true },
      select: { id: true },
    });
    if (!staff) return fail(formData, "Select an active staff member.");
    data.staffId = staff.id;
  }

  await db.expense.update({ where: { id: expenseId.data }, data });

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * ADMIN only. A real delete, for a mistaken entry — the schema carries no
 * cancellation columns for Expense, and the brief explicitly rules out adding
 * any. Cancel-with-audit arrives with the Cancel Payment tag.
 */
export async function deleteExpense(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const expenseId = id.safeParse(formData.get("id"));
  if (!expenseId.success) return fail(formData, "Invalid expense.");

  const existing = await db.expense.findUnique({
    where: { id: expenseId.data },
    select: { id: true },
  });
  if (!existing) return fail(formData, "That expense no longer exists.");

  await db.expense.delete({ where: { id: expenseId.data } });

  revalidatePath(PATH);
  return { ok: true };
}

/** Today in Colombo — the date both forms default to. */
export async function todayInColombo(): Promise<string> {
  await requireOperationalAccess();
  return colomboNow().date;
}
