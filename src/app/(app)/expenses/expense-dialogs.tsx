"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { ActionState, ExpenseRow } from "./actions";

const EMPTY: ActionState = { ok: false };

export const SELECT_CLASS =
  "border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-none";

export type Option = { id: number; name: string };

function AmountAndReason({
  values,
  amount,
  reason,
}: {
  values?: Record<string, string>;
  amount?: string;
  reason?: string;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="amount">Amount</Label>
        <Input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          defaultValue={values?.amount ?? amount ?? ""}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="reason">Reason</Label>
        <Input
          id="reason"
          name="reason"
          defaultValue={values?.reason ?? reason ?? ""}
          placeholder="What was it for?"
          autoComplete="off"
          required
        />
      </div>
    </>
  );
}

/** Record a teacher advance — always tied to a teacher. */
export function TeacherAdvanceDialog({
  open,
  onOpenChange,
  onDone,
  action,
  teachers,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  teachers: Option[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY);
  const v = state.values;

  useEffect(() => {
    if (state.ok) {
      onOpenChange(false);
      onDone();
    }
  }, [state.ok, onOpenChange, onDone]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Teacher advance</DialogTitle>
            <DialogDescription>
              Deducted from that teacher&apos;s payslip for the month of this date.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="teacherId">Teacher</Label>
              {/* Keyed on the echoed value: a <select>'s defaultValue only
                  applies at mount, and React resets the form after the action. */}
              <select
                key={`t-${v?.teacherId ?? ""}`}
                id="teacherId"
                name="teacherId"
                className={SELECT_CLASS}
                defaultValue={v?.teacherId ?? ""}
                required
              >
                <option value="" disabled>
                  Select teacher…
                </option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" defaultValue={v?.date ?? today} required />
            </div>

            <AmountAndReason values={v} />

            {state.error && (
              <p role="alert" className="text-destructive text-sm">
                {state.error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Record advance"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Record a Xenon expense, optionally flagged as a staff advance. */
export function XenonExpenseDialog({
  open,
  onOpenChange,
  onDone,
  action,
  staff,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  staff: Option[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY);
  const v = state.values;
  const [staffAdvance, setStaffAdvance] = useState(false);

  useEffect(() => {
    if (state.ok) {
      onOpenChange(false);
      onDone();
    }
  }, [state.ok, onOpenChange, onDone]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Xenon expense</DialogTitle>
            <DialogDescription>
              An institute cost. A staff advance is still one of these — the flag
              only drives the staff-advance report.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" defaultValue={v?.date ?? today} required />
            </div>

            <AmountAndReason values={v} />

            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="isStaffAdvance"
                  name="isStaffAdvance"
                  checked={staffAdvance}
                  onCheckedChange={(c) => setStaffAdvance(c === true)}
                />
                <Label htmlFor="isStaffAdvance" className="font-normal">
                  This is a staff advance
                </Label>
              </div>

              {staffAdvance && (
                <div className="space-y-2">
                  <Label htmlFor="staffId">Staff member</Label>
                  <select
                    key={`s-${v?.staffId ?? ""}`}
                    id="staffId"
                    name="staffId"
                    className={SELECT_CLASS}
                    defaultValue={v?.staffId ?? ""}
                    required
                  >
                    <option value="" disabled>
                      Select staff…
                    </option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-muted-foreground text-xs">
                    Counted once, as a normal Xenon expense. The separate payroll
                    system deducts it manually.
                  </p>
                </div>
              )}
            </div>

            {state.error && (
              <p role="alert" className="text-destructive text-sm">
                {state.error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Record expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** ADMIN-only correction of a recorded expense. */
export function EditExpenseDialog({
  row,
  onOpenChange,
  onDone,
  action,
  teachers,
  staff,
}: {
  row: ExpenseRow | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  teachers: Option[];
  staff: Option[];
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY);
  const v = state.values;

  useEffect(() => {
    if (state.ok) {
      onOpenChange(false);
      onDone();
    }
  }, [state.ok, onOpenChange, onDone]);

  if (!row) return null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Edit expense</DialogTitle>
            <DialogDescription>{row.typeLabel}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <input type="hidden" name="id" value={row.id} />

            {row.typeCode === "TEACHER_ADVANCE" && (
              <div className="space-y-2">
                <Label htmlFor="edit-teacher">Teacher</Label>
                <select
                  key={`et-${v?.teacherId ?? row.person?.id ?? ""}`}
                  id="edit-teacher"
                  name="teacherId"
                  className={SELECT_CLASS}
                  defaultValue={v?.teacherId ?? row.person?.id ?? ""}
                  required
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {row.isStaffAdvance && (
              <div className="space-y-2">
                <Label htmlFor="edit-staff">Staff member</Label>
                <select
                  key={`es-${v?.staffId ?? row.person?.id ?? ""}`}
                  id="edit-staff"
                  name="staffId"
                  className={SELECT_CLASS}
                  defaultValue={v?.staffId ?? row.person?.id ?? ""}
                  required
                >
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="edit-date">Date</Label>
              <Input
                id="edit-date"
                name="date"
                type="date"
                defaultValue={v?.date ?? row.date}
                required
              />
            </div>

            <AmountAndReason values={v} amount={row.amount} reason={row.reason} />

            {state.error && (
              <p role="alert" className="text-destructive text-sm">
                {state.error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** ADMIN-only delete of a mistaken entry. */
export function DeleteExpenseDialog({
  row,
  onOpenChange,
  onDone,
  action,
}: {
  row: ExpenseRow | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY);

  useEffect(() => {
    if (state.ok) {
      onOpenChange(false);
      onDone();
    }
  }, [state.ok, onOpenChange, onDone]);

  if (!row) return null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Delete this expense?</DialogTitle>
            <DialogDescription>
              {row.date} · {row.typeLabel} · {row.amount}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <input type="hidden" name="id" value={row.id} />
            <p className="text-muted-foreground text-sm">
              {row.reason}
            </p>
            {state.error && (
              <p role="alert" className="text-destructive mt-3 text-sm">
                {state.error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
