"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";

import type { ActionState, LabelRow } from "@/app/(app)/admin/_lib/label-crud";
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

const EMPTY: ActionState = { ok: false };

type Props = {
  /** Singular noun, e.g. "Subject". */
  noun: string;
  rows: LabelRow[];
  placeholder: string;
  createAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  updateAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  toggleAction: (formData: FormData) => Promise<void>;
};

/**
 * Shared list + create/edit UI for the two label-only reference tables.
 * Subjects and Grades differ by noun and by which actions they're handed.
 */
export function LabelManager({
  noun,
  rows,
  placeholder,
  createAction,
  updateAction,
  toggleAction,
}: Props) {
  const [editing, setEditing] = useState<LabelRow | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{noun}s</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {rows.filter((r) => r.active).length} active of {rows.length}
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="size-4" aria-hidden />
          Add {noun.toLowerCase()}
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">No {noun.toLowerCase()}s yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Create one to start building courses.
          </p>
          <Button onClick={() => setCreating(true)} className="mt-4 gap-2">
            <Plus className="size-4" aria-hidden />
            Add {noun.toLowerCase()}
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{noun}</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-56 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className={row.active ? "" : "opacity-60"}>
                  <TableCell className="font-medium">{row.label}</TableCell>
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

      <LabelDialog
        key={creating ? "create" : "create-closed"}
        open={creating}
        onOpenChange={setCreating}
        title={`Add ${noun.toLowerCase()}`}
        description={`Create a new ${noun.toLowerCase()}.`}
        placeholder={placeholder}
        action={createAction}
        submitLabel="Create"
      />

      <LabelDialog
        key={editing ? `edit-${editing.id}` : "edit-closed"}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={`Edit ${noun.toLowerCase()}`}
        description={`Rename this ${noun.toLowerCase()}.`}
        placeholder={placeholder}
        action={updateAction}
        submitLabel="Save"
        row={editing}
      />
    </div>
  );
}

function LabelDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  action,
  submitLabel,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  placeholder: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  row?: LabelRow | null;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY);

  // Close only once the server confirms the write succeeded, so validation and
  // duplicate-label errors stay visible in the dialog that caused them.
  useEffect(() => {
    if (state.ok) onOpenChange(false);
  }, [state.ok, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-4">
            {row && <input type="hidden" name="id" value={row.id} />}
            <Label htmlFor="label">Name</Label>
            <Input
              id="label"
              name="label"
              defaultValue={row?.label ?? ""}
              placeholder={placeholder}
              autoComplete="off"
              required
            />
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
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
