"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DAYS,
  DAY_LABEL,
  DAY_SHORT,
  attendanceWindow,
  formatTime,
} from "@/lib/schedule-time";

import type { ActionState, ScheduleFilters, ScheduleRow } from "./actions";
import { CoursePicker, type CourseOption } from "./course-picker";
import { WindowFields } from "./window-fields";

const EMPTY: ActionState = { ok: false };

const SELECT_CLASS =
  "border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-none";

type Props = {
  initialRows: ScheduleRow[];
  filterArgs: ScheduleFilters;
  courses: CourseOption[];
  filters: React.ReactNode;
  listAction: (filters: ScheduleFilters) => Promise<ScheduleRow[]>;
  createAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  updateAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  toggleAction: (formData: FormData) => Promise<void>;
};

export function ScheduleManager({
  initialRows,
  filterArgs,
  courses,
  filters,
  listAction,
  createAction,
  updateAction,
  toggleAction,
}: Props) {
  // Seeded from the server render; the parent remounts this on filter change,
  // so no effect is needed to keep it in sync.
  const [rows, setRows] = useState(initialRows);
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ScheduleRow | null>(null);

  // Re-read through the guarded list action after a write, rather than waiting
  // for revalidation to reach a remote database.
  const onChanged = useCallback(() => {
    startTransition(async () => setRows(await listAction(filterArgs)));
  }, [listAction, filterArgs]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm">
          {rows.filter((r) => r.active).length} active of {rows.length}
        </p>
        <Button
          onClick={() => setCreating(true)}
          className="gap-2"
          disabled={courses.length === 0}
        >
          <Plus className="size-4" aria-hidden />
          Add schedule
        </Button>
      </div>

      {courses.length === 0 && (
        <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
          There are no active courses to schedule. Create one under Setup →
          Classes / Courses first.
        </p>
      )}

      {filters}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">No schedules yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Create one so attendance has a timetable to match against.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Day</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Teacher</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const w = attendanceWindow(row);
                return (
                  <TableRow key={row.id} className={row.active ? "" : "opacity-60"}>
                    <TableCell className="font-medium">
                      {DAY_SHORT[row.dayOfWeek]}
                    </TableCell>
                    <TableCell className="max-w-72">
                      {/* Composed names get long; truncate rather than let the
                          Actions column slide off the right edge. */}
                      <div className="truncate font-medium" title={row.course}>
                        {row.course}
                      </div>
                      <div className="text-muted-foreground text-xs">{row.subject}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.teacher}</TableCell>
                    <TableCell className="text-muted-foreground">{row.grade}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="tabular-nums">
                        {formatTime(row.startTime)} – {formatTime(row.endTime)}
                      </div>
                      {/* The attendance window this row implies, so staff can
                          sanity-check the offsets without opening the form. */}
                      <div className="text-muted-foreground text-xs tabular-nums">
                        marks {w.opens}–{w.closes}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.active ? "default" : "secondary"}>
                        {row.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => setEditing(row)}
                        >
                          <Pencil className="size-3.5" aria-hidden />
                          Edit
                        </Button>
                        <form action={async (fd) => { await toggleAction(fd); onChanged(); }}>
                          <input type="hidden" name="id" value={row.id} />
                          <input
                            type="hidden"
                            name="active"
                            value={row.active ? "false" : "true"}
                          />
                          <Button variant="outline" size="sm" type="submit">
                            {row.active ? "Deactivate" : "Reactivate"}
                          </Button>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ScheduleDialog
        key={creating ? "create" : "create-closed"}
        open={creating}
        onOpenChange={setCreating}
        onDone={onChanged}
        action={createAction}
        courses={courses}
        mode="create"
      />

      <ScheduleDialog
        key={editing ? `edit-${editing.id}` : "edit-closed"}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        onDone={onChanged}
        action={updateAction}
        courses={courses}
        mode="edit"
        row={editing}
      />
    </div>
  );
}

function ScheduleDialog({
  open,
  onOpenChange,
  onDone,
  action,
  courses,
  mode,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  courses: CourseOption[];
  mode: "create" | "edit";
  row?: ScheduleRow | null;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY);

  useEffect(() => {
    if (state.ok) {
      onOpenChange(false);
      onDone();
    }
  }, [state.ok, onOpenChange, onDone]);

  const isCreate = mode === "create";
  // React resets the form after the action resolves, so defaults must reflect
  // the rejected submission — otherwise a validation error clears the user's work.
  const v = state.values;

  /**
   * `defaultValue` on a <select> is only honoured at mount, so React's
   * post-action form reset drops the selection back to the placeholder — and
   * because that placeholder is `disabled`, the browser then omits `dayOfWeek`
   * from the submission entirely and every retry fails.
   *
   * Keying these two on the echoed value remounts them with the right default
   * after a rejected submit, which fixes it without making them controlled.
   */
  const dayDefault = v?.dayOfWeek ?? row?.dayOfWeek ?? "";
  const activeDefault = v ? v.active === "on" : row ? row.active : true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>{isCreate ? "Add schedule" : "Edit schedule"}</DialogTitle>
            <DialogDescription>
              A recurring weekly session. The same course can run on several days.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {row && <input type="hidden" name="id" value={row.id} />}

            <CoursePicker
              courses={courses}
              defaultValue={v?.courseId ? Number(v.courseId) : row?.courseId}
            />

            <div className="space-y-2">
              <Label htmlFor="dayOfWeek">Day of week</Label>
              <select
                key={`day-${dayDefault}`}
                id="dayOfWeek"
                name="dayOfWeek"
                className={SELECT_CLASS}
                defaultValue={dayDefault}
                required
              >
                <option value="" disabled>
                  Select day…
                </option>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {DAY_LABEL[d]}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="startTime">Start time</Label>
                <Input
                  id="startTime"
                  name="startTime"
                  type="time"
                  defaultValue={v?.startTime ?? row?.startTime ?? ""}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endTime">End time</Label>
                <Input
                  id="endTime"
                  name="endTime"
                  type="time"
                  defaultValue={v?.endTime ?? row?.endTime ?? ""}
                  required
                />
              </div>
            </div>

            <WindowFields
              opensBefore={Number(v?.attendanceOpensBeforeMin ?? row?.attendanceOpensBeforeMin ?? 30)}
              closesBefore={Number(v?.attendanceClosesBeforeMin ?? row?.attendanceClosesBeforeMin ?? 30)}
            />

            <div className="flex items-center gap-2">
              <Checkbox
                key={`active-${activeDefault}`}
                id="active"
                name="active"
                defaultChecked={activeDefault}
              />
              <Label htmlFor="active" className="font-normal">
                Active
              </Label>
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
              {pending ? "Saving…" : isCreate ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
