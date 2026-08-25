"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";

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

import type { ActionState } from "./actions";

export type Option = { id: number; label: string };

export type CourseRow = {
  id: number;
  /** Typed name, or null when the display name is derived. */
  name: string | null;
  displayName: string;
  teacherId: number;
  subjectId: number;
  gradeId: number;
  streamId: number;
  classTypeId: number;
  teacher: string;
  subject: string;
  grade: string;
  stream: string;
  classType: string;
  defaultFee: string;
  instituteSharePercent: string;
  instituteFee: string;
  active: boolean;
};

export type CourseOptions = {
  teachers: Option[];
  subjects: Option[];
  grades: Option[];
  streams: Option[];
  classTypes: Option[];
};

const EMPTY: ActionState = { ok: false };

const SELECT_CLASS =
  "border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50";

type Props = {
  rows: CourseRow[];
  options: CourseOptions;
  /** Parsed from the `institute_share_presets` Setting — never hardcoded. */
  sharePresets: number[];
  /** Server-rendered filter form, slotted under the heading. */
  filters?: React.ReactNode;
  createAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  updateAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  toggleAction: (formData: FormData) => Promise<void>;
};

export function CourseManager({
  rows,
  options,
  sharePresets,
  filters,
  createAction,
  updateAction,
  toggleAction,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CourseRow | null>(null);

  const canCreate =
    options.teachers.length > 0 &&
    options.subjects.length > 0 &&
    options.grades.length > 0 &&
    options.streams.length > 0 &&
    options.classTypes.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Classes / Courses
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {rows.filter((r) => r.active).length} active of {rows.length}
          </p>
        </div>
        <Button
          onClick={() => setCreating(true)}
          className="gap-2"
          disabled={!canCreate}
        >
          <Plus className="size-4" aria-hidden />
          Add course
        </Button>
      </div>

      {!canCreate && (
        <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
          A course needs at least one active teacher, subject, grade, stream and
          class type. Add the missing ones first.
        </p>
      )}

      {filters}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">No courses yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Create one so students have something to enrol into.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Course</TableHead>
                <TableHead>Teacher</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Fee</TableHead>
                <TableHead className="text-right">Share %</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-56 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className={row.active ? "" : "opacity-60"}>
                  <TableCell>
                    <div className="font-medium">{row.displayName}</div>
                    <div className="text-muted-foreground text-xs">
                      {row.subject} · {row.stream}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.teacher}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.grade}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.classType}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.defaultFee}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.instituteSharePercent}
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
                      <form action={toggleAction}>
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
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CourseDialog
        key={creating ? "create" : "create-closed"}
        open={creating}
        onOpenChange={setCreating}
        action={createAction}
        options={options}
        sharePresets={sharePresets}
        mode="create"
      />

      <CourseDialog
        key={editing ? `edit-${editing.id}` : "edit-closed"}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        action={updateAction}
        options={options}
        sharePresets={sharePresets}
        mode="edit"
        row={editing}
      />
    </div>
  );
}

function CourseDialog({
  open,
  onOpenChange,
  action,
  options,
  sharePresets,
  mode,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  options: CourseOptions;
  sharePresets: number[];
  mode: "create" | "edit";
  row?: CourseRow | null;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY);

  // An existing course whose share isn't one of the presets opens in custom
  // mode, so editing it never silently snaps the value to a preset.
  const existingShare = row ? Number(row.instituteSharePercent) : null;
  const startsCustom =
    existingShare !== null && !sharePresets.includes(existingShare);

  const [custom, setCustom] = useState(startsCustom || sharePresets.length === 0);
  const [preset, setPreset] = useState(
    existingShare !== null && !startsCustom
      ? String(existingShare)
      : sharePresets.length > 0
        ? String(sharePresets[0])
        : "",
  );

  useEffect(() => {
    if (state.ok) onOpenChange(false);
  }, [state.ok, onOpenChange]);

  const isCreate = mode === "create";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>{isCreate ? "Add course" : "Edit course"}</DialogTitle>
            <DialogDescription>
              A course is one teacher, subject, grade and class type — the unit
              students enrol into.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {row && <input type="hidden" name="id" value={row.id} />}

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                name="teacherId"
                label="Teacher"
                options={options.teachers}
                defaultValue={row?.teacherId}
              />
              <SelectField
                name="subjectId"
                label="Subject"
                options={options.subjects}
                defaultValue={row?.subjectId}
              />
              <SelectField
                name="gradeId"
                label="Grade"
                options={options.grades}
                defaultValue={row?.gradeId}
              />
              <SelectField
                name="streamId"
                label="Stream"
                options={options.streams}
                defaultValue={row?.streamId}
              />
              <SelectField
                name="classTypeId"
                label="Class type"
                options={options.classTypes}
                defaultValue={row?.classTypeId}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="defaultFee">Default fee</Label>
                <Input
                  id="defaultFee"
                  name="defaultFee"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={row?.defaultFee ?? "0.00"}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="instituteFee">Institute fee</Label>
                <Input
                  id="instituteFee"
                  name="instituteFee"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={row?.instituteFee ?? "0.00"}
                />
                <p className="text-muted-foreground text-xs">
                  Usually 0. Flat charge on top of the share.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sharePreset">Institute share %</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  id="sharePreset"
                  className={SELECT_CLASS}
                  value={custom ? "custom" : preset}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === "custom") {
                      setCustom(true);
                    } else {
                      setCustom(false);
                      setPreset(next);
                    }
                  }}
                >
                  {sharePresets.map((p) => (
                    <option key={p} value={String(p)}>
                      {p}%
                    </option>
                  ))}
                  <option value="custom">Custom…</option>
                </select>

                {custom ? (
                  <Input
                    name="instituteSharePercent"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder="0 – 100"
                    defaultValue={startsCustom ? row?.instituteSharePercent : ""}
                    aria-label="Custom institute share percentage"
                    required
                  />
                ) : (
                  <input
                    type="hidden"
                    name="instituteSharePercent"
                    value={preset}
                  />
                )}
              </div>
              {sharePresets.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  No presets configured in Settings — enter a value.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Display name (optional)</Label>
              <Input
                id="name"
                name="name"
                defaultValue={row?.name ?? ""}
                placeholder={row?.displayName ?? "Composed automatically if blank"}
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
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
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

function SelectField({
  name,
  label,
  options,
  defaultValue,
}: {
  name: string;
  label: string;
  options: Option[];
  defaultValue?: number;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        className={SELECT_CLASS}
        defaultValue={defaultValue ?? ""}
        required
      >
        <option value="" disabled>
          Select {label.toLowerCase()}…
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
