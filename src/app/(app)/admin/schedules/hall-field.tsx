"use client";

import { Label } from "@/components/ui/label";
import { HallIcon } from "@/lib/hall-icons";

import type { HallOption } from "./actions";

const SELECT_CLASS =
  "border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs";

/**
 * The room a class meets in by default.
 *
 * Optional on purpose — a class with no hall resolves to "unassigned" rather
 * than blocking the form — and keyed on the echoed value for the same reason
 * every other select here is: React resets the form after the action resolves,
 * and `defaultValue` alone would drop the choice on a validation error.
 */
export function HallField({
  name,
  label,
  value,
  halls,
  current,
}: {
  name: string;
  label: string;
  /** The echoed/stored id as a string, "" for unassigned. */
  value: string;
  halls: HallOption[];
  /** A hall already set on the row but now deactivated — still shown. */
  current?: HallOption | null;
}) {
  const missing = current && !halls.some((h) => h.id === current.id) ? current : null;
  const icon = halls.find((h) => String(h.id) === value)?.icon ?? missing?.icon ?? null;

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <div className="flex items-center gap-2">
        <span className="bg-secondary text-secondary-foreground grid size-9 shrink-0 place-items-center rounded-md">
          <HallIcon icon={icon} className="size-4" />
        </span>
        <select
          key={`${name}-${value}`}
          id={name}
          name={name}
          className={SELECT_CLASS}
          defaultValue={value}
        >
          <option value="">No hall yet</option>
          {halls.map((h) => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
          {/* A deactivated hall stays selectable on the row that already uses
              it, so editing the time cannot silently move the class. */}
          {missing && <option value={missing.id}>{missing.name} (inactive)</option>}
        </select>
      </div>
    </div>
  );
}
