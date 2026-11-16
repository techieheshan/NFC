"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/authz";
import { colomboDateValue, colomboNow } from "@/lib/colombo-time";
import { db } from "@/lib/db";
import { centsToDecimalString, columnToCents } from "@/lib/saved-day/money";
import {
  buildLines, parseAdjustmentInput, parseCancelReason, parsePayrollMonth, payrollMonthState, personKey,
  MONTH_LOCKED, type AdjustmentKind, type SplitModeValue,
} from "@/lib/salary-adjustments";

/**
 * Salary adjustments are ADMIN only, reads included: the list holds people's pay, so every function here checks the role itself (AGENTS 10:
 * a server action is its own endpoint). The page guard protects the render, not these.
 */
const requireAdmin = () => requireRole(["ADMIN"]);

export type ActionState = { ok: boolean; error?: string; values?: Record<string, string> };
export type CreateResult = { ok: true; id: number } | { ok: false; error: string };

export type AdjustmentRow = {
  id: number;
  kind: AdjustmentKind;
  title: string;
  year: number;
  month: number;
  total: string;
  shared: string;
  institute: string;
  splitMode: SplitModeValue;
  /** What it was made from: "Expense: <reason>" or "Income: <category>". */
  source: string;
  people: { key: string; kind: "teacher" | "staff"; name: string; amount: string }[];
  consentNote: string;
  consentOn: string;
  createdBy: string;
  cancelled: boolean;
  cancelReason: string | null;
  cancelledBy: string | null;
  /** The payroll month is over: nothing about it can change any more. */
  locked: boolean;
};

export type SourceOption = { id: number; label: string; total: string; date: string; taken: boolean };
export type PersonOption = { key: string; kind: "teacher" | "staff"; name: string };

const personName = (u: { username: string; staff: { name: string } | null }) => u.staff?.name ?? u.username;
const currentMonth = () => {
  const [y, m] = colomboNow().date.split("-").map(Number);
  return { year: y, month: m };
};

const adjustmentInclude = {
  expense: { select: { reason: true, date: true } },
  otherIncome: { select: { category: { select: { label: true } }, source: true } },
  createdBy: { select: { username: true, staff: { select: { name: true } } } },
  cancelledBy: { select: { username: true, staff: { select: { name: true } } } },
  lines: { include: { teacher: { select: { id: true, name: true } }, staff: { select: { id: true, name: true } } }, orderBy: { id: "asc" as const } },
} as const;
type Row = Awaited<ReturnType<typeof findRows>>[number];
const findRows = (where: object) => db.salaryAdjustment.findMany({ where, include: adjustmentInclude, orderBy: [{ id: "desc" }] });

function toRow(r: Row): AdjustmentRow {
  const shared = r.lines.reduce((s, l) => s + columnToCents(l.amount), 0);
  const cur = currentMonth();
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    year: r.applyYear,
    month: r.applyMonth,
    total: centsToDecimalString(columnToCents(r.totalAmount)),
    shared: centsToDecimalString(shared),
    institute: centsToDecimalString(columnToCents(r.instituteAmount)),
    splitMode: r.splitMode,
    source: r.expense ? `Expense: ${r.expense.reason}` : `Income: ${r.otherIncome?.category.label ?? "other income"}${r.otherIncome?.source ? ` (${r.otherIncome.source})` : ""}`,
    people: r.lines.map((l) => ({
      key: l.teacher ? personKey({ kind: "teacher", id: l.teacher.id }) : personKey({ kind: "staff", id: l.staff!.id }),
      kind: l.teacher ? ("teacher" as const) : ("staff" as const),
      name: l.teacher?.name ?? l.staff!.name,
      amount: centsToDecimalString(columnToCents(l.amount)),
    })),
    consentNote: r.consentNote,
    consentOn: r.consentOn.toISOString().slice(0, 10),
    createdBy: personName(r.createdBy),
    cancelled: r.cancelled,
    cancelReason: r.cancelReason,
    cancelledBy: r.cancelledBy ? personName(r.cancelledBy) : null,
    locked: payrollMonthState({ year: r.applyYear, month: r.applyMonth }, cur) === "past",
  };
}

// ---------------------------------------------------------------------------
// Reads (ADMIN)
// ---------------------------------------------------------------------------

export async function listAdjustments(year: number, month: number): Promise<AdjustmentRow[]> {
  await requireAdmin();
  if (!parsePayrollMonth(`${year}-${String(month).padStart(2, "0")}`)) return [];
  return (await findRows({ applyYear: year, applyMonth: month })).map(toRow);
}

export async function getAdjustment(id: number): Promise<AdjustmentRow | null> {
  await requireAdmin();
  if (!Number.isInteger(id) || id <= 0) return null;
  const rows = await findRows({ id });
  return rows[0] ? toRow(rows[0]) : null;
}

/** Recent XENON expenses that can be shared. A teacher advance and a staff advance are not (they are already someone's own money). */
export async function listShareableExpenses(): Promise<SourceOption[]> {
  await requireAdmin();
  const rows = await db.expense.findMany({
    where: { type: { code: "XENON" }, isStaffAdvance: false },
    select: { id: true, reason: true, amount: true, date: true, salaryAdjustments: { where: { cancelled: false }, select: { id: true } } },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: 60,
  });
  return rows.map((e) => ({ id: e.id, label: e.reason, total: centsToDecimalString(columnToCents(e.amount)), date: e.date.toISOString().slice(0, 10), taken: e.salaryAdjustments.length > 0 }));
}

export async function listShareableIncomes(): Promise<SourceOption[]> {
  await requireAdmin();
  const rows = await db.otherIncome.findMany({
    where: { cancelled: false },
    select: { id: true, source: true, amount: true, date: true, category: { select: { label: true } }, salaryAdjustments: { where: { cancelled: false }, select: { id: true } } },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: 60,
  });
  return rows.map((i) => ({ id: i.id, label: `${i.category.label}${i.source ? ` (${i.source})` : ""}`, total: centsToDecimalString(columnToCents(i.amount)), date: i.date.toISOString().slice(0, 10), taken: i.salaryAdjustments.length > 0 }));
}

export async function listPeople(): Promise<PersonOption[]> {
  await requireAdmin();
  const [teachers, staff] = await Promise.all([
    db.teacher.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.staff.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return [
    ...teachers.map((t) => ({ key: personKey({ kind: "teacher", id: t.id }), kind: "teacher" as const, name: t.name })),
    ...staff.map((s) => ({ key: personKey({ kind: "staff", id: s.id }), kind: "staff" as const, name: s.name })),
  ];
}

export type StaffMonthRow = { staffId: number; name: string; lines: { adjustmentId: number; title: string; amount: string; sign: "-" | "+" }[]; net: string };

/** The staff list of a payroll month: one row per staff member with their lines and the net. For whoever pays staff (there is no staff salary here). */
export async function staffMonthList(year: number, month: number): Promise<StaffMonthRow[]> {
  await requireAdmin();
  if (!parsePayrollMonth(`${year}-${String(month).padStart(2, "0")}`)) return [];
  const rows = await db.salaryAdjustmentLine.findMany({
    where: { staffId: { not: null }, adjustment: { cancelled: false, applyYear: year, applyMonth: month } },
    select: { staffId: true, amount: true, staff: { select: { name: true } }, adjustment: { select: { id: true, kind: true, title: true } } },
    orderBy: [{ adjustmentId: "asc" }, { id: "asc" }],
  });
  const by = new Map<number, StaffMonthRow & { cents: number }>();
  for (const r of rows) {
    const cents = columnToCents(r.amount);
    const signed = r.adjustment.kind === "SHARED_EXPENSE" ? -cents : cents;
    const cur = by.get(r.staffId!) ?? { staffId: r.staffId!, name: r.staff!.name, lines: [], net: "", cents: 0 };
    cur.lines.push({ adjustmentId: r.adjustment.id, title: r.adjustment.title, amount: centsToDecimalString(cents), sign: r.adjustment.kind === "SHARED_EXPENSE" ? "-" : "+" });
    cur.cents += signed;
    by.set(r.staffId!, cur);
  }
  return [...by.values()].map(({ cents, ...rest }) => ({ ...rest, net: centsToDecimalString(cents) })).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Writes (ADMIN)
// ---------------------------------------------------------------------------

/**
 * Creates one adjustment. The browser sends WHICH expense or income, the people and (equal split) the amount to share; the total comes from
 * the source row and every per-person amount is recomputed here in cents. All guards run before the first write, inside one transaction
 * that holds an advisory lock on the source, so two admins cannot both share the same expense.
 */
export async function createSalaryAdjustment(input: unknown): Promise<CreateResult> {
  const admin = await requireAdmin();
  const now = colomboNow();
  const [cy, cm] = now.date.split("-").map(Number);

  const parsed = parseAdjustmentInput(input, { year: cy, month: cm }, now.date);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.value;

  const teacherIds = v.people.filter((p) => p.person.kind === "teacher").map((p) => p.person.id);
  const staffIds = v.people.filter((p) => p.person.kind === "staff").map((p) => p.person.id);

  try {
    const id = await db.$transaction(
      async (tx): Promise<number | string> => {
        // One lock per source: the namespace keeps it apart from the saved-day locks.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${7301}::int, ${v.sourceId * 2 + (v.kind === "BONUS" ? 1 : 0)}::int)`;

        let totalCents: number;
        if (v.kind === "SHARED_EXPENSE") {
          const e = await tx.expense.findFirst({ where: { id: v.sourceId, type: { code: "XENON" }, isStaffAdvance: false }, select: { amount: true } });
          if (!e) return "That expense cannot be shared. Pick a Xenon expense (not an advance).";
          totalCents = columnToCents(e.amount);
          if (await tx.salaryAdjustment.findFirst({ where: { expenseId: v.sourceId, cancelled: false }, select: { id: true } })) return "That expense is already shared. Cancel the earlier adjustment first.";
        } else {
          const i = await tx.otherIncome.findFirst({ where: { id: v.sourceId, cancelled: false }, select: { amount: true } });
          if (!i) return "That income cannot be used. Pick an income that is not cancelled.";
          totalCents = columnToCents(i.amount);
          if (await tx.salaryAdjustment.findFirst({ where: { otherIncomeId: v.sourceId, cancelled: false }, select: { id: true } })) return "That income already has a bonus. Cancel the earlier adjustment first.";
        }

        const [teachers, staff] = await Promise.all([
          teacherIds.length ? tx.teacher.findMany({ where: { id: { in: teacherIds }, active: true }, select: { id: true } }) : [],
          staffIds.length ? tx.staff.findMany({ where: { id: { in: staffIds }, active: true }, select: { id: true } }) : [],
        ]);
        if (teachers.length !== teacherIds.length || staff.length !== staffIds.length) return "Every person must be an active teacher or staff member. Reload the page.";

        const built = buildLines(totalCents, v);
        if (!built.ok) return built.error;

        // ---- guards done: writes only below this line ----
        const created = await tx.salaryAdjustment.create({
          data: {
            kind: v.kind,
            title: v.title,
            applyYear: v.year,
            applyMonth: v.month,
            totalAmount: centsToDecimalString(totalCents),
            instituteAmount: centsToDecimalString(built.instituteCents),
            splitMode: v.splitMode,
            expenseId: v.kind === "SHARED_EXPENSE" ? v.sourceId : null,
            otherIncomeId: v.kind === "BONUS" ? v.sourceId : null,
            consentNote: v.consentNote,
            consentOn: colomboDateValue(v.consentOn),
            createdById: admin.id,
            lines: {
              create: built.lines.map((l) => ({
                teacherId: l.person.kind === "teacher" ? l.person.id : null,
                staffId: l.person.kind === "staff" ? l.person.id : null,
                amount: centsToDecimalString(l.cents),
              })),
            },
          },
          select: { id: true },
        });
        return created.id;
      },
      { maxWait: 2000, timeout: 8000 },
    );
    if (typeof id === "string") return { ok: false, error: id };
    revalidatePath("/salary-adjustments");
    revalidatePath("/payslips");
    return { ok: true, id };
  } catch (e) {
    // The transaction could not finish in time, or a database rule (a CHECK) refused it: nothing was written.
    console.error("createSalaryAdjustment failed", e instanceof Error ? e.message : e);
    return { ok: false, error: "It did not go through and nothing was saved. Try again." };
  }
}

/**
 * Cancels an adjustment (never an edit, never a delete): ADMIN only, with a reason. Allowed only while its payroll month is the current one or
 * later; once the month is over the payslip it sits on is closed and cannot change. Cancelling twice says so.
 */
export async function cancelSalaryAdjustment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const fail = (error: string): ActionState => ({ ok: false, error, values: Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string> });

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return fail("That adjustment could not be found.");
  const reason = parseCancelReason(formData.get("reason"));
  if (!reason.ok) return fail(reason.error);

  const row = await db.salaryAdjustment.findUnique({ where: { id }, select: { cancelled: true, applyYear: true, applyMonth: true } });
  if (!row) return fail("That adjustment could not be found.");
  if (row.cancelled) return fail("That adjustment is already cancelled.");
  if (payrollMonthState({ year: row.applyYear, month: row.applyMonth }, currentMonth()) === "past") return fail(MONTH_LOCKED.replace("An adjustment can be placed in this month or a later one.", "It can no longer be cancelled."));

  const done = await db.salaryAdjustment.updateMany({
    where: { id, cancelled: false },
    data: { cancelled: true, cancelledById: admin.id, cancelledAt: new Date(), cancelReason: reason.reason },
  });
  if (done.count === 0) return fail("That adjustment is already cancelled.");
  revalidatePath("/salary-adjustments");
  revalidatePath("/payslips");
  return { ok: true };
}
