"use client";

import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { createExtraItem, setExtraItemActive, updateExtraItem, type ActionState, type ItemRow } from "../actions";

const EMPTY: ActionState = { ok: false };

export function ItemManager({ items }: { items: ItemRow[] }) {
  return (
    <div className="space-y-4">
      <AddForm />
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={`${i.id}-${i.label}-${i.price}`} className={`rounded-xl border p-3 ${i.active ? "" : "bg-muted"}`}><ItemForm item={i} /></li>
        ))}
      </ul>
    </div>
  );
}

function AddForm() {
  const [state, action, pending] = useActionState(createExtraItem, EMPTY);
  return (
    <form action={action} className="space-y-2 rounded-xl border p-3">
      <p className="text-sm font-medium">New item</p>
      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <div>
          <Label htmlFor="new-label">Name</Label>
          <Input id="new-label" name="label" autoComplete="off" defaultValue={state.values?.label ?? ""} className="h-11" required />
        </div>
        <div>
          <Label htmlFor="new-price">Price</Label>
          <Input id="new-price" name="price" inputMode="decimal" autoComplete="off" defaultValue={state.values?.price ?? ""} className="h-11" required />
        </div>
      </div>
      <Button type="submit" className="min-h-11" disabled={pending}>Add item</Button>
      {state.error && <p role="alert" className="text-destructive text-sm">{state.error}</p>}
    </form>
  );
}

function ItemForm({ item }: { item: ItemRow }) {
  const [save, saveAction, saving] = useActionState(updateExtraItem, EMPTY);
  const [toggle, toggleAction, toggling] = useActionState(setExtraItemActive, EMPTY);
  return (
    <div className="space-y-2">
      <form action={saveAction} className="grid grid-cols-[1fr_7rem] gap-2">
        <input type="hidden" name="id" value={item.id} />
        <Input name="label" aria-label={`Name of ${item.label}`} autoComplete="off" defaultValue={save.values?.label ?? item.label} className="h-11" required />
        <Input name="price" aria-label={`Price of ${item.label}`} inputMode="decimal" autoComplete="off" defaultValue={save.values?.price ?? item.price} className="h-11" required />
        <Button type="submit" variant="outline" className="col-span-2 min-h-11" disabled={saving}>Save changes</Button>
      </form>
      <form action={toggleAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="active" value={item.active ? "false" : "true"} />
        <Badge variant={item.active ? "outline" : "secondary"}>{item.active ? "On the list" : "Retired"}</Badge>
        <span className="text-muted-foreground text-xs">sold {item.uses} {item.uses === 1 ? "time" : "times"}</span>
        <Button type="submit" variant="outline" className="ml-auto min-h-11" disabled={toggling}>{item.active ? "Retire" : "Bring back"}</Button>
      </form>
      {(save.error || toggle.error) && <p role="alert" className="text-destructive text-sm">{save.error ?? toggle.error}</p>}
    </div>
  );
}
