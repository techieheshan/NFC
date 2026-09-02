"use client";

import { useActionState } from "react";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SettingSpec } from "@/lib/settings";

import { saveSetting, setToggle, type ActionState } from "./actions";

const EMPTY: ActionState = { ok: false };

type Row = SettingSpec & { value: string };

/**
 * One row per configurable value. Each is its own small form so saving one
 * cannot disturb another, and so a validation error stays on the field it
 * belongs to.
 */
export function SettingsScreen({ rows }: { rows: Row[] }) {
  const values = rows.filter((r) => r.kind !== "toggle");
  const toggles = rows.filter((r) => r.kind === "toggle");

  return (
    <div className="space-y-6">
      <section className="rounded-xl border">
        <div className="border-b p-4">
          <h2 className="font-medium">Institute values</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            The app reads these at the moment of each transaction, so a change
            applies to what happens next. Receipts already taken keep the amounts
            they were taken at — history is never rewritten.
          </p>
        </div>
        <ul className="divide-y">
          {values.map((row) => (
            <ValueRow key={row.key} row={row} />
          ))}
        </ul>
      </section>

      <section className="rounded-xl border">
        <div className="border-b p-4">
          <h2 className="font-medium">Features</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Stored as settings, not code — no deploy needed to change them.
          </p>
        </div>
        <ul className="divide-y">
          {toggles.map((row) => (
            <ToggleRow key={row.key} row={row} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function ValueRow({ row }: { row: Row }) {
  const [state, formAction, pending] = useActionState(saveSetting, EMPTY);
  // React 19 resets the form once the action resolves; on a rejected value the
  // echoed input is what keeps the admin's typing on screen.
  const shown = state.values?.[row.key] ?? row.value;

  return (
    <li className="p-4">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="key" value={row.key} />
        <div className="min-w-52 flex-1 space-y-1.5">
          <label htmlFor={`s-${row.key}`} className="block text-sm font-medium">
            {row.label}
          </label>
          <Input
            id={`s-${row.key}`}
            name="value"
            defaultValue={shown}
            inputMode={row.kind === "money" ? "decimal" : "text"}
            autoComplete="off"
          />
          <p className="text-muted-foreground text-xs">{row.help}</p>
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : "Save"}
        </Button>
      </form>
      {state.error && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {state.error}
        </p>
      )}
      {state.ok && state.savedKey === row.key && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700">
          <Check className="size-3.5" aria-hidden />
          Saved. Applies to what happens from now on.
        </p>
      )}
    </li>
  );
}

function ToggleRow({ row }: { row: Row }) {
  const [state, formAction, pending] = useActionState(setToggle, EMPTY);
  const on = row.value === "on";

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-52 flex-1">
        <p className="text-sm font-medium">{row.label}</p>
        <p className="text-muted-foreground text-xs">{row.help}</p>
        {state.error && (
          <p role="alert" className="text-destructive mt-1 text-sm">
            {state.error}
          </p>
        )}
      </div>
      <form action={formAction} className="flex items-center gap-3">
        <input type="hidden" name="key" value={row.key} />
        <input type="hidden" name="on" value={on ? "off" : "on"} />
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
            on
              ? "border-emerald-300 bg-emerald-100 text-emerald-900"
              : "border-border bg-muted text-muted-foreground"
          }`}
        >
          {on ? "On" : "Off"}
        </span>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Saving…" : on ? "Turn off" : "Turn on"}
        </Button>
      </form>
    </li>
  );
}
