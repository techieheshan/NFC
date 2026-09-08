"use client";

import { useActionState, useState } from "react";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HALL_ICON_KEYS, HallIcon } from "@/lib/hall-icons";

import { createHall, setHallActive, updateHall, type ActionState } from "./actions";

const EMPTY: ActionState = { ok: false };

export type HallRow = { id: number; name: string; icon: string; active: boolean };

/**
 * Halls are reference data with a picture. The icon is what staff actually
 * navigate by on the allocation grid, so choosing one is part of creating the
 * room, not a later edit.
 */
export function HallsScreen({ rows }: { rows: HallRow[] }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Halls</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The rooms classes are allocated to. Renaming one renames it everywhere;
          a hall is deactivated rather than deleted, because schedules and past
          allocations point at it.
        </p>
      </div>

      <CreateForm />

      <ul className="divide-y rounded-xl border">
        {rows.map((row) => (
          <HallRowForm key={row.id} row={row} />
        ))}
        {rows.length === 0 && (
          <li className="text-muted-foreground p-4 text-sm">No halls yet.</li>
        )}
      </ul>
    </div>
  );
}

function CreateForm() {
  const [state, action, pending] = useActionState(createHall, EMPTY);
  const [icon, setIcon] = useState(HALL_ICON_KEYS[0]);

  return (
    <form action={action} className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 space-y-1.5">
          <label htmlFor="new-hall" className="block text-sm font-medium">New hall</label>
          <Input id="new-hall" name="name" placeholder="e.g. Blue Sky" required />
        </div>
        <Button type="submit" disabled={pending} className="gap-2">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
          Add
        </Button>
      </div>
      <IconPicker name="icon" value={icon} onChange={setIcon} />
      {state.error && <p className="text-destructive text-sm">{state.error}</p>}
    </form>
  );
}

function HallRowForm({ row }: { row: HallRow }) {
  const [state, action, pending] = useActionState(updateHall, EMPTY);
  const [icon, setIcon] = useState(row.icon);

  return (
    <li className={`space-y-3 p-4 ${row.active ? "" : "bg-muted/40"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="bg-secondary text-secondary-foreground grid size-10 shrink-0 place-items-center rounded-lg">
          <HallIcon icon={icon} className="size-5" />
        </span>
        <form action={action} className="flex min-w-48 flex-1 items-center gap-2">
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="icon" value={icon} />
          <Input name="name" defaultValue={row.name} className="max-w-64" />
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
        <form action={setHallActive}>
          <input type="hidden" name="id" value={row.id} />
          <input type="hidden" name="active" value={row.active ? "false" : "true"} />
          <Button type="submit" size="sm" variant={row.active ? "outline" : "default"}>
            {row.active ? "Deactivate" : "Reactivate"}
          </Button>
        </form>
      </div>
      <IconPicker name={`icon-${row.id}`} value={icon} onChange={setIcon} />
      {state.error && <p className="text-destructive text-sm">{state.error}</p>}
    </li>
  );
}

/**
 * The icon travels in a hidden field rather than a radio group: the visible
 * control is a row of pictures, and a picture is what staff are choosing.
 */
function IconPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Icon">
      {HALL_ICON_KEYS.map((key) => {
        const selected = key === value;
        return (
          <button
            key={`${name}-${key}`}
            type="button"
            aria-label={key}
            aria-pressed={selected}
            onClick={() => onChange(key)}
            className={`grid size-8 place-items-center rounded-md border ${
              selected ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            <HallIcon icon={key} className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
