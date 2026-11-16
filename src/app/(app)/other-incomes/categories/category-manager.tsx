"use client";

import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { createCategory, renameCategory, setCategoryActive, type ActionState, type CategoryRow } from "../actions";

const EMPTY: ActionState = { ok: false };

export function CategoryManager({ categories }: { categories: CategoryRow[] }) {
  return (
    <div className="space-y-4">
      <AddForm />
      <ul className="space-y-2">
        {categories.map((c) => (
          <li key={c.id} className={`rounded-xl border p-3 ${c.active ? "" : "bg-muted"}`}>
            <RenameForm row={c} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddForm() {
  const [state, action, pending] = useActionState(createCategory, EMPTY);
  return (
    <form action={action} className="space-y-2 rounded-xl border p-3">
      <Label htmlFor="new-label">New category</Label>
      <div className="flex gap-2">
        <Input id="new-label" name="label" autoComplete="off" defaultValue={state.values?.label ?? ""} className="h-11" required />
        <Button type="submit" className="min-h-11" disabled={pending}>Add</Button>
      </div>
      {state.error && <p role="alert" className="text-destructive text-sm">{state.error}</p>}
    </form>
  );
}

function RenameForm({ row }: { row: CategoryRow }) {
  const [rename, renameAction, renaming] = useActionState(renameCategory, EMPTY);
  const [toggle, toggleAction, toggling] = useActionState(setCategoryActive, EMPTY);
  return (
    <div className="space-y-2">
      <form action={renameAction} className="flex gap-2">
        <input type="hidden" name="id" value={row.id} />
        <Input name="label" aria-label={`Name of ${row.label}`} autoComplete="off" defaultValue={rename.values?.label ?? row.label} className="h-11" required />
        <Button type="submit" variant="outline" className="min-h-11" disabled={renaming}>Rename</Button>
      </form>
      <form action={toggleAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={row.id} />
        <input type="hidden" name="active" value={row.active ? "false" : "true"} />
        <Badge variant={row.active ? "outline" : "secondary"}>{row.active ? "In use" : "Retired"}</Badge>
        <span className="text-muted-foreground text-xs">{row.uses} {row.uses === 1 ? "income" : "incomes"}</span>
        <Button type="submit" variant="outline" className="ml-auto min-h-11" disabled={toggling}>{row.active ? "Retire" : "Bring back"}</Button>
      </form>
      {(rename.error || toggle.error) && <p role="alert" className="text-destructive text-sm">{rename.error ?? toggle.error}</p>}
    </div>
  );
}
