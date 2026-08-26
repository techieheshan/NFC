"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { attendanceWindow, formatTime } from "@/lib/schedule-time";

import type { ActionState, AdditionalRow, DateRange } from "./actions";
import { CoursePicker, type CourseOption } from "./course-picker";
import { WindowFields } from "./window-fields";

const EMPTY: ActionState = { ok: false };

type Props = {
  initialRows: AdditionalRow[];
  filterArgs: DateRange;
  courses: CourseOption[];
  filters: React.ReactNode;
  today: string;
  listAction: (range: DateRange) => Promise<AdditionalRow[]>;
  createAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  updateAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  deleteAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
};

export function AdditionalManager({
  initialRows,
  filterArgs,
  courses,
  filters,
  today,
  listAction,
  createAction,
  updateAction,
  deleteAction,
}: Props) {
  // Seeded from the server render; the parent remounts this on filter change.
  const [rows, setRows] = useState(initialRows);
  const [, startTransition] = useTransition();

  // Re-read through the guarded list action after a write. This also refreshes
  // attendanceCount, which is what gates the delete button.
  const onChanged = useCallback(() => {
    startTransition(async () => setRows(await listAction(filterArgs)));
  }, [listAction, filterArgs]);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdditionalRow | null>(null);
  const [deleting, setDeleting] = useState<AdditionalRow | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm">
          {rows.length} one-off {rows.length === 1 ? "class" : "classes"}
        </p>
        <Button
          onClick={() => setCreating(true)}
          className="gap-2"
          disabled={courses.length === 0}
        >
          <Plus className="size-4" aria-hidden />
          Add class
        </Button>
      </div>

      {filters}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">No additional classes</p>
          <p className="text-muted-foreground mt-1 text-sm">
            One-off dated sessions (a Poya-day class, say) appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Date</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Teacher</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const w = attendanceWindow(row);
                const used = row.attendanceCount > 0;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap font-medium tabular-nums">
                      {row.date}
                      {row.date < today && (
                        <Badge variant="secondary" className="ml-1.5">
                          Past
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{row.course}</TableCell>
                    <TableCell className="text-muted-foreground">{row.teacher}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="tabular-nums">
                        {formatTime(row.startTime)} – {formatTime(row.endTime)}
                      </div>
                      <div className="text-muted-foreground text-xs tabular-nums">
                        marks {w.opens}–{w.closes}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-40 truncate">
                      {row.note ?? "—"}
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
                        {used ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            disabled
                            title={`${row.attendanceCount} attendance record(s) — kept as history`}
                          >
                            <Lock className="size-3.5" aria-hidden />
                            Used
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => setDeleting(row)}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                            Delete
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AdditionalDialog
        key={creating ? "create" : "create-closed"}
        open={creating}
        onOpenChange={setCreating}
        onDone={onChanged}
        action={createAction}
        courses={courses}
        mode="create"
        today={today}
      />

      <AdditionalDialog
        key={editing ? `edit-${editing.id}` : "edit-closed"}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        onDone={onChanged}
        action={updateAction}
        courses={courses}
        mode="edit"
        row={editing}
        today={today}
      />

      <DeleteDialog
        key={deleting ? `del-${deleting.id}` : "del-closed"}
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        onDone={onChanged}
        action={deleteAction}
        row={deleting}
      />
    </div>
  );
}

function AdditionalDialog({
  open,
  onOpenChange,
  onDone,
  action,
  courses,
  mode,
  row,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  courses: CourseOption[];
  mode: "create" | "edit";
  row?: AdditionalRow | null;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY);

  useEffect(() => {
    if (state.ok) {
      onOpenChange(false);
      onDone();
    }
  }, [state.ok, onOpenChange, onDone]);

  const isCreate = mode === "create";
  // See the note in actions.ts: React resets the form once the action resolves.
  const v = state.values;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>
              {isCreate ? "Add additional class" : "Edit additional class"}
            </DialogTitle>
            <DialogDescription>
              A one-off dated session. It inherits the course roster and is never
              billed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {row && <input type="hidden" name="id" value={row.id} />}

            <CoursePicker
              courses={courses}
              defaultValue={v?.courseId ? Number(v.courseId) : row?.courseId}
            />

            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                name="date"
                type="date"
                defaultValue={v?.date ?? row?.date ?? today}
                required
              />
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

            <div className="space-y-2">
              <Label htmlFor="note">Note (optional)</Label>
              <Input
                id="note"
                name="note"
                defaultValue={v?.note ?? row?.note ?? ""}
                placeholder="e.g. Poya day extra class"
                autoComplete="off"
              />
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

function DeleteDialog({
  open,
  onOpenChange,
  onDone,
  action,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  row?: AdditionalRow | null;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY);

  useEffect(() => {
    if (state.ok) {
      onOpenChange(false);
      onDone();
    }
  }, [state.ok, onOpenChange, onDone]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>Delete additional class?</DialogTitle>
            <DialogDescription>
              {row
                ? `${row.date} · ${row.course}. This cannot be undone.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {row && <input type="hidden" name="id" value={row.id} />}
            <p className="text-muted-foreground text-sm">
              Deletion is only possible while no attendance has been marked
              against this session. The server checks again before removing it.
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
