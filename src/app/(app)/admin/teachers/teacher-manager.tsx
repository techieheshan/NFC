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

export type TeacherRow = {
  id: number;
  name: string;
  nic: string | null;
  phone: string | null;
  /** "YYYY-MM-DD" or null — pre-formatted server-side for the date input. */
  joinDate: string | null;
  active: boolean;
  username: string | null;
};

const EMPTY: ActionState = { ok: false };

type Props = {
  rows: TeacherRow[];
  createAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  updateAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  toggleAction: (formData: FormData) => Promise<void>;
};

export function TeacherManager({
  rows,
  createAction,
  updateAction,
  toggleAction,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TeacherRow | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Teachers</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {rows.filter((r) => r.active).length} active of {rows.length}
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="size-4" aria-hidden />
          Add teacher
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">No teachers yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Add a teacher and their login to start creating courses.
          </p>
          <Button onClick={() => setCreating(true)} className="mt-4 gap-2">
            <Plus className="size-4" aria-hidden />
            Add teacher
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>NIC</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Login</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-56 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className={row.active ? "" : "opacity-60"}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.nic ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.phone ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.joinDate ?? "—"}
                  </TableCell>
                  <TableCell>
                    {row.username ? (
                      <span className="font-mono text-xs">{row.username}</span>
                    ) : (
                      <Badge variant="outline">No login</Badge>
                    )}
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

      <TeacherDialog
        key={creating ? "create" : "create-closed"}
        open={creating}
        onOpenChange={setCreating}
        action={createAction}
        mode="create"
      />

      <TeacherDialog
        key={editing ? `edit-${editing.id}` : "edit-closed"}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        action={updateAction}
        mode="edit"
        row={editing}
      />
    </div>
  );
}

function TeacherDialog({
  open,
  onOpenChange,
  action,
  mode,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  mode: "create" | "edit";
  row?: TeacherRow | null;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY);

  useEffect(() => {
    if (state.ok) onOpenChange(false);
  }, [state.ok, onOpenChange]);

  const isCreate = mode === "create";
  // An existing teacher without a login can't have one renamed here — creating
  // one needs a password, which belongs to the User/Roles tag.
  const showUsername = isCreate || Boolean(row?.username);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form action={formAction}>
          <DialogHeader>
            <DialogTitle>{isCreate ? "Add teacher" : "Edit teacher"}</DialogTitle>
            <DialogDescription>
              {isCreate
                ? "Creates the teacher and their login together."
                : "Update details. Password changes live in User Roles."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {row && <input type="hidden" name="id" value={row.id} />}

            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={row?.name ?? ""}
                autoComplete="off"
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="nic">NIC</Label>
                <Input
                  id="nic"
                  name="nic"
                  defaultValue={row?.nic ?? ""}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  name="phone"
                  defaultValue={row?.phone ?? ""}
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="joinDate">Join date</Label>
              <Input
                id="joinDate"
                name="joinDate"
                type="date"
                defaultValue={row?.joinDate ?? ""}
              />
            </div>

            {showUsername && (
              <div className="space-y-4 rounded-lg border p-4">
                <p className="text-sm font-medium">Login</p>

                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    name="username"
                    defaultValue={row?.username ?? ""}
                    autoComplete="off"
                    autoCapitalize="none"
                    required={isCreate}
                  />
                </div>

                {isCreate && (
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      required
                    />
                    <p className="text-muted-foreground text-xs">
                      At least 8 characters. The teacher signs in with this.
                    </p>
                  </div>
                )}
              </div>
            )}

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
