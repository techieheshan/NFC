import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";
import { db } from "@/lib/db";

import {
  createTeacherAdvance,
  createXenonExpense,
  deleteExpense,
  listExpenses,
  listStaffAdvances,
  updateExpense,
  type DateRange,
  type ExpenseFilters,
} from "./actions";
import { ExpensesScreen } from "./expenses-screen";

export const metadata = { title: "Expenses" };

const FIELD =
  "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-xs";

function toStr(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw !== "" ? raw : undefined;
}

export default async function ExpensesPage({
  searchParams,
}: PageProps<"/expenses">) {
  // Viewing is ADMIN + STAFF; the nav config is the single source for that.
  const user = await requireNavAccess("/expenses");

  const params = await searchParams;
  const typeParam = toStr(params.type);
  const filters: ExpenseFilters = {
    type: typeParam === "TEACHER_ADVANCE" || typeParam === "XENON" ? typeParam : undefined,
    from: toStr(params.from),
    to: toStr(params.to),
    person: toStr(params.person),
  };
  const range: DateRange = { from: toStr(params.rfrom), to: toStr(params.rto) };
  const tab = toStr(params.tab) === "staff" ? "staff" : "all";

  const [expenses, report, teachers, staff] = await Promise.all([
    listExpenses(filters),
    listStaffAdvances(range),
    db.teacher.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.staff.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const anyFilter =
    filters.type !== undefined ||
    filters.from !== undefined ||
    filters.to !== undefined ||
    filters.person !== undefined;

  /* Plain GET forms — filtering needs no client JS and stays shareable. */
  const expenseFilterUi = (
    <form method="get" className="bg-muted/40 flex flex-wrap items-end gap-3 rounded-xl border p-4">
      <input type="hidden" name="tab" value="all" />
      <div className="space-y-1.5">
        <label htmlFor="type" className="block text-sm font-medium">Type</label>
        <select id="type" name="type" className={FIELD} defaultValue={filters.type ?? ""}>
          <option value="">All types</option>
          <option value="TEACHER_ADVANCE">Teacher Advance</option>
          <option value="XENON">Xenon Expense</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="person" className="block text-sm font-medium">Person</label>
        <select id="person" name="person" className={FIELD} defaultValue={filters.person ?? ""}>
          <option value="">Anyone</option>
          <optgroup label="Teachers">
            {teachers.map((t) => (
              <option key={`t${t.id}`} value={`t${t.id}`}>{t.name}</option>
            ))}
          </optgroup>
          <optgroup label="Staff">
            {staff.map((s) => (
              <option key={`s${s.id}`} value={`s${s.id}`}>{s.name}</option>
            ))}
          </optgroup>
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="from" className="block text-sm font-medium">From</label>
        <input id="from" name="from" type="date" className={FIELD} defaultValue={filters.from ?? ""} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="to" className="block text-sm font-medium">To</label>
        <input id="to" name="to" type="date" className={FIELD} defaultValue={filters.to ?? ""} />
      </div>

      <Button type="submit" variant="secondary">Filter</Button>
      {anyFilter && (
        <Button asChild variant="ghost">
          <Link href="/expenses?tab=all">Clear</Link>
        </Button>
      )}
    </form>
  );

  const reportFilterUi = (
    <form method="get" className="bg-muted/40 flex flex-wrap items-end gap-3 rounded-xl border p-4">
      <input type="hidden" name="tab" value="staff" />
      <div className="space-y-1.5">
        <label htmlFor="rfrom" className="block text-sm font-medium">From</label>
        <input id="rfrom" name="rfrom" type="date" className={FIELD} defaultValue={range.from ?? ""} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="rto" className="block text-sm font-medium">To</label>
        <input id="rto" name="rto" type="date" className={FIELD} defaultValue={range.to ?? ""} />
      </div>
      <Button type="submit" variant="secondary">Filter</Button>
      {(range.from || range.to) && (
        <Button asChild variant="ghost">
          <Link href="/expenses?tab=staff">Clear</Link>
        </Button>
      )}
    </form>
  );

  return (
    <ExpensesScreen
      initialExpenses={expenses}
      initialReport={report}
      teachers={teachers}
      staff={staff}
      today={colomboNow().date}
      tab={tab}
      canEdit={user.role === "ADMIN"}
      filters={filters}
      range={range}
      expenseFilterUi={expenseFilterUi}
      reportFilterUi={reportFilterUi}
      listExpenses={listExpenses}
      listStaffAdvances={listStaffAdvances}
      createTeacherAdvance={createTeacherAdvance}
      createXenonExpense={createXenonExpense}
      updateExpense={updateExpense}
      deleteExpense={deleteExpense}
    />
  );
}
