"use client";

import { useCallback, useState, useTransition } from "react";
import { Pencil, Plus, Receipt, Trash2, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type {
  ActionState,
  DateRange,
  ExpenseFilters,
  ExpenseRow,
  StaffAdvanceReport,
} from "./actions";
import {
  DeleteExpenseDialog,
  EditExpenseDialog,
  TeacherAdvanceDialog,
  XenonExpenseDialog,
  type Option,
} from "./expense-dialogs";

type Props = {
  initialExpenses: ExpenseRow[];
  initialReport: StaffAdvanceReport;
  teachers: Option[];
  staff: Option[];
  today: string;
  tab: string;
  /** Edit and delete are ADMIN-only; STAFF never sees the controls. */
  canEdit: boolean;
  filters: ExpenseFilters;
  range: DateRange;
  expenseFilterUi: React.ReactNode;
  reportFilterUi: React.ReactNode;
  listExpenses: (f: ExpenseFilters) => Promise<ExpenseRow[]>;
  listStaffAdvances: (r: DateRange) => Promise<StaffAdvanceReport>;
  createTeacherAdvance: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  createXenonExpense: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  updateExpense: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  deleteExpense: (prev: ActionState, fd: FormData) => Promise<ActionState>;
};

export function ExpensesScreen({
  initialExpenses,
  initialReport,
  teachers,
  staff,
  today,
  tab,
  canEdit,
  filters,
  range,
  expenseFilterUi,
  reportFilterUi,
  listExpenses,
  listStaffAdvances,
  createTeacherAdvance,
  createXenonExpense,
  updateExpense,
  deleteExpense,
}: Props) {
  const [rows, setRows] = useState(initialExpenses);
  const [report, setReport] = useState(initialReport);
  const [, startTransition] = useTransition();

  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [xenonOpen, setXenonOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [deleting, setDeleting] = useState<ExpenseRow | null>(null);

  // Re-read through the guarded actions after a write, rather than waiting on
  // revalidation to reach a remote database.
  const refresh = useCallback(() => {
    startTransition(async () => {
      setRows(await listExpenses(filters));
      setReport(await listStaffAdvances(range));
    });
  }, [listExpenses, listStaffAdvances, filters, range]);

  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Teacher advances and institute costs.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="gap-2" onClick={() => setAdvanceOpen(true)}>
            <Plus className="size-4" aria-hidden />
            Teacher advance
          </Button>
          <Button className="gap-2" onClick={() => setXenonOpen(true)}>
            <Plus className="size-4" aria-hidden />
            Xenon expense
          </Button>
        </div>
      </div>

      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="all">All expenses</TabsTrigger>
          <TabsTrigger value="staff">Staff advances</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4 space-y-4">
          {expenseFilterUi}

          {rows.length === 0 ? (
            <Empty icon={Receipt} title="No expenses match" hint="Adjust the filters, or record one." />
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Person</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>By</TableHead>
                      {canEdit && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap font-medium tabular-nums">
                          {r.date}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.typeCode === "TEACHER_ADVANCE" ? "default" : "secondary"}>
                            {r.typeLabel}
                          </Badge>
                          {r.isStaffAdvance && (
                            <Badge variant="outline" className="ml-1.5">
                              Staff advance
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.person?.name ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-56 truncate">{r.reason}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.amount}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {r.recordedBy}
                        </TableCell>
                        {canEdit && (
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1.5"
                                onClick={() => setEditing(r)}
                              >
                                <Pencil className="size-3.5" aria-hidden />
                                Edit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                onClick={() => setDeleting(r)}
                              >
                                <Trash2 className="size-3.5" aria-hidden />
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-between rounded-xl border px-4 py-3 text-sm font-medium">
                <span>{rows.length} expenses shown</span>
                <span className="tabular-nums">{total.toFixed(2)}</span>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="staff" className="mt-4 space-y-4">
          {reportFilterUi}

          <p className="text-muted-foreground text-sm">
            Xenon expenses flagged as staff advances. They are already counted once
            as ordinary Xenon costs — this view exists so the separate payroll
            system can deduct them manually.
          </p>

          {report.rows.length === 0 ? (
            <Empty icon={Wallet} title="No staff advances" hint="None in this date range." />
          ) : (
            <>
              <div className="rounded-xl border p-4">
                <p className="mb-2 text-sm font-medium">Per staff member</p>
                <ul className="divide-y text-sm">
                  {report.totals.map((t) => (
                    <li key={t.staffId} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="min-w-0 truncate">
                        {t.staff}
                        <span className="text-muted-foreground ml-2 text-xs">
                          {t.count} {t.count === 1 ? "advance" : "advances"}
                        </span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">{t.total}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex justify-between border-t pt-2 text-sm font-medium">
                  <span>Total</span>
                  <span className="tabular-nums">{report.grandTotal}</span>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Date</TableHead>
                      <TableHead>Staff</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap tabular-nums">{r.date}</TableCell>
                        <TableCell className="font-medium">{r.staff}</TableCell>
                        <TableCell className="max-w-64 truncate">{r.reason}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.amount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <TeacherAdvanceDialog
        key={advanceOpen ? "adv" : "adv-closed"}
        open={advanceOpen}
        onOpenChange={setAdvanceOpen}
        onDone={refresh}
        action={createTeacherAdvance}
        teachers={teachers}
        today={today}
      />

      <XenonExpenseDialog
        key={xenonOpen ? "xen" : "xen-closed"}
        open={xenonOpen}
        onOpenChange={setXenonOpen}
        onDone={refresh}
        action={createXenonExpense}
        staff={staff}
        today={today}
      />

      {canEdit && (
        <>
          <EditExpenseDialog
            key={editing ? `edit-${editing.id}` : "edit-closed"}
            row={editing}
            onOpenChange={(o) => !o && setEditing(null)}
            onDone={refresh}
            action={updateExpense}
            teachers={teachers}
            staff={staff}
          />
          <DeleteExpenseDialog
            key={deleting ? `del-${deleting.id}` : "del-closed"}
            row={deleting}
            onOpenChange={(o) => !o && setDeleting(null)}
            onDone={refresh}
            action={deleteExpense}
          />
        </>
      )}
    </div>
  );
}

function Empty({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Receipt;
  title: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center">
      <Icon className="text-muted-foreground mx-auto size-8" aria-hidden />
      <p className="mt-3 font-medium">{title}</p>
      <p className="text-muted-foreground mt-1 text-sm">{hint}</p>
    </div>
  );
}
