"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { Layers, Pencil, Plus } from "lucide-react";

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

import type {
  ActionState,
  ComboRow,
  CourseOption,
  TeacherOption,
} from "./actions";

const EMPTY: ActionState = { ok: false };

const SELECT_CLASS =
  "border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-none";

type Props = {
  initialRows: ComboRow[];
  teachers: TeacherOption[];
  listAction: () => Promise<ComboRow[]>;
  coursesForTeacher: (teacherId: number) => Promise<CourseOption[]>;
  createAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  updateAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  toggleAction: (formData: FormData) => Promise<void>;
};

export function ComboManager({
  initialRows,
  teachers,
  listAction,
  coursesForTeacher,
  createAction,
  updateAction,
  toggleAction,
}: Props) {
  const [rows, setRows] = useState(initialRows);
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ComboRow | null>(null);

  const refresh = useCallback(() => {
    startTransition(async () => setRows(await listAction()));
  }, [listAction]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Combine Payment</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Discounted bundles. A student qualifies by being enrolled in every
            course of a combo.
          </p>
        </div>
        <Button
          onClick={() => setCreating(true)}
          className="gap-2"
          disabled={teachers.length === 0}
        >
          <Plus className="size-4" aria-hidden />
          Add combo
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <Layers className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 font-medium">No combos yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Build one per combination you want to offer — Theory+Paper,
            Theory+Paper+Revision, and so on.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((c) => (
            <li
              key={c.id}
              className={`rounded-xl border p-4 ${c.active ? "" : "opacity-60"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{c.name}</p>
                  <p className="text-muted-foreground text-xs">{c.teacher}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={c.active ? "default" : "secondary"}>
                    {c.active ? "Active" : "Inactive"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setEditing(c)}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    Edit
                  </Button>
                  <form action={async (fd) => { await toggleAction(fd); refresh(); }}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="active" value={c.active ? "false" : "true"} />
                    <Button variant="outline" size="sm" type="submit">
                      {c.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </form>
                </div>
              </div>

              <ul className="mt-3 divide-y text-sm">
                {c.items.map((i) => (
                  <li key={i.courseId} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate">{i.course}</span>
                    <span className="flex shrink-0 items-center gap-2 tabular-nums">
                      <span className="text-muted-foreground line-through">
                        {i.defaultFee}
                      </span>
                      <span className="font-medium">{i.comboFee}</span>
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-2 flex justify-between border-t pt-2 text-sm font-medium">
                <span>Combined total</span>
                <span className="tabular-nums">
                  <span className="text-muted-foreground mr-2 font-normal line-through">
                    {c.defaultTotal}
                  </span>
                  {c.comboTotal}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ComboDialog
        key={creating ? "create" : "create-closed"}
        open={creating}
        onOpenChange={setCreating}
        onDone={refresh}
        action={createAction}
        teachers={teachers}
        coursesForTeacher={coursesForTeacher}
        mode="create"
      />

      <ComboDialog
        key={editing ? `edit-${editing.id}` : "edit-closed"}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        onDone={refresh}
        action={updateAction}
        teachers={teachers}
        coursesForTeacher={coursesForTeacher}
        mode="edit"
        row={editing}
      />
    </div>
  );
}

function ComboDialog({
  open,
  onOpenChange,
  onDone,
  action,
  teachers,
  coursesForTeacher,
  mode,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  teachers: TeacherOption[];
  coursesForTeacher: (teacherId: number) => Promise<CourseOption[]>;
  mode: "create" | "edit";
  row?: ComboRow | null;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY);
  const [teacherId, setTeacherId] = useState<number | null>(row?.teacherId ?? null);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [picked, setPicked] = useState<Map<number, string>>(
    new Map(row?.items.map((i) => [i.courseId, i.comboFee]) ?? []),
  );
  const [, startTransition] = useTransition();

  // Courses depend on the chosen teacher, which is a user action rather than
  // a render input, so this loads in the handler — not an effect.
  const chooseTeacher = useCallback(
    (value: number | null) => {
      setTeacherId(value);
      setPicked(new Map());
      if (value === null) {
        setCourses([]);
        return;
      }
      startTransition(async () => setCourses(await coursesForTeacher(value)));
    },
    [coursesForTeacher],
  );

  // On open, load the teacher's courses for the row being edited.
  useEffect(() => {
    if (!open || row?.teacherId === undefined) return;
    let cancelled = false;
    void coursesForTeacher(row.teacherId).then((c) => {
      if (!cancelled) setCourses(c);
    });
    return () => {
      cancelled = true;
    };
  }, [open, row?.teacherId, coursesForTeacher]);

  useEffect(() => {
    if (state.ok) {
      onOpenChange(false);
      onDone();
    }
  }, [state.ok, onOpenChange, onDone]);

  const toggle = (course: CourseOption) => {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(course.id)) next.delete(course.id);
      // Seed the combo fee with the normal fee so staff edit down from it.
      else next.set(course.id, course.defaultFee);
      return next;
    });
  };

  const total = [...picked.values()].reduce((s, v) => s + (Number(v) || 0), 0);
  const isCreate = mode === "create";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>{isCreate ? "Add combo" : "Edit combo"}</DialogTitle>
            <DialogDescription>
              Two or more courses from one teacher, each at a discounted fee.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {row && <input type="hidden" name="id" value={row.id} />}
            <input type="hidden" name="teacherId" value={teacherId ?? ""} />

            <div className="space-y-2">
              <Label htmlFor="teacher">Teacher</Label>
              <select
                id="teacher"
                className={SELECT_CLASS}
                value={teacherId ?? ""}
                onChange={(e) =>
                  chooseTeacher(e.target.value === "" ? null : Number(e.target.value))
                }
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

            {teacherId !== null && (
              <div className="space-y-2">
                <Label>Courses (pick at least two)</Label>
                {courses.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    This teacher has no active courses.
                  </p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {courses.map((c) => {
                      const on = picked.has(c.id);
                      return (
                        <li key={c.id} className="flex items-center gap-3 p-3">
                          <Checkbox checked={on} onCheckedChange={() => toggle(c)} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {c.label}
                            </span>
                            <span className="text-muted-foreground block text-xs">
                              normal {c.defaultFee}
                            </span>
                          </span>
                          {on && (
                            <>
                              <input type="hidden" name="courseId" value={c.id} />
                              <Input
                                name="comboFee"
                                type="number"
                                step="0.01"
                                min="0"
                                value={picked.get(c.id) ?? ""}
                                onChange={(e) =>
                                  setPicked((prev) =>
                                    new Map(prev).set(c.id, e.target.value),
                                  )
                                }
                                className="w-28 shrink-0"
                                aria-label={`Combo fee for ${c.label}`}
                                required
                              />
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {picked.size > 0 && (
              <div className="bg-muted/40 flex justify-between rounded-lg border p-3 text-sm font-medium">
                <span>Combined total ({picked.size} courses)</span>
                <span className="tabular-nums">{total.toFixed(2)}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">Combo name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={row?.name ?? ""}
                placeholder="2027 Chemistry Theory+Paper"
                autoComplete="off"
                required
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
