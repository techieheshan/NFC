"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, DoorOpen, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { HallIcon } from "@/lib/hall-icons";
import type { AllocatedClass } from "@/lib/halls";

import { reassignHall } from "./actions";

const SELECT_CLASS =
  "border-input bg-background h-9 rounded-md border px-2 py-1 text-sm shadow-xs";

export type HallOption = { id: number; name: string; icon: string };

/**
 * Today's rooms, and the one control that changes them.
 *
 * A reassignment here is for THIS DATE only — the schedule's default hall is
 * never written — so the grid shows both: the room the class is in today, and
 * (when they differ) the room it normally uses.
 */
export function AllocationScreen({
  date,
  today,
  classes,
  halls,
  dateFilter,
}: {
  date: string;
  today: string;
  /**
   * Straight from the server render. Deliberately NOT copied into state: the
   * action revalidates this route, so the refreshed props ARE the new grid —
   * a state copy would go stale the moment someone else moved a class.
   */
  classes: AllocatedClass[];
  halls: HallOption[];
  dateFilter: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "warn" | "error"; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function move(klass: AllocatedClass, hallId: string) {
    setBusyKey(klass.key);
    setMessage(null);
    const form = new FormData();
    form.set("date", date);
    form.set("kind", klass.kind);
    form.set("classId", String(klass.id));
    form.set("hallId", hallId);

    startTransition(async () => {
      const res = await reassignHall(form);
      setBusyKey(null);
      if (!res.ok) {
        setMessage({ kind: "error", text: res.error });
        return;
      }
      if (res.warning) setMessage({ kind: "warn", text: res.warning });
      // Pull the re-resolved grid from the server. The action revalidates the
      // route; this is what makes the open page show it without a reload —
      // and it keeps the rows coming from one place instead of a state copy.
      router.refresh();
    });
  }

  const unassigned = classes.filter((c) => !c.hall).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hall Allocation</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Which room each class is in {date === today ? "today" : `on ${date}`}. Moving
          a class here changes that one day only — its usual hall stays as it is.
        </p>
      </div>

      {dateFilter}

      {message && (
        <p
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
            message.kind === "warn"
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-destructive/40 text-destructive"
          }`}
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {message.text}
        </p>
      )}

      {classes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <DoorOpen className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 font-medium">No classes on this day</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Nothing recurring is scheduled and no additional class is set.
          </p>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            {classes.length} {classes.length === 1 ? "class" : "classes"}
            {unassigned > 0 && ` · ${unassigned} with no hall`}
          </p>

          <ul className="divide-y rounded-xl border">
            {classes.map((c) => (
              <li key={c.key} className="flex flex-wrap items-center gap-3 p-3">
                <span
                  className={`grid size-11 shrink-0 place-items-center rounded-lg ${
                    c.hall ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                  title={c.hall?.name ?? "No hall"}
                >
                  {c.hall ? <HallIcon icon={c.hall.icon} className="size-5" /> : <DoorOpen className="size-5" aria-hidden />}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.course}</span>
                  <span className="text-muted-foreground block text-xs">
                    {c.teacher} · {c.startTime}–{c.endTime}
                    {c.kind === "ADDITIONAL" && " · additional class"}
                  </span>
                  <span className="block text-xs">
                    {c.hall ? c.hall.name : <span className="text-muted-foreground">No hall</span>}
                    {c.overridden && (
                      <span className="text-primary ml-1">
                        · moved for this day (usually {c.defaultHall?.name ?? "unassigned"})
                      </span>
                    )}
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-2">
                  <select
                    aria-label={`Hall for ${c.course}`}
                    className={SELECT_CLASS}
                    value={c.hall ? String(c.hall.id) : ""}
                    disabled={pending && busyKey === c.key}
                    onChange={(e) => move(c, e.target.value)}
                  >
                    <option value="">No hall</option>
                    {halls.map((h) => (
                      <option key={h.id} value={h.id}>{h.name}</option>
                    ))}
                    {/* A room that has since been deactivated still names itself
                        on the class that is in it. */}
                    {c.hall && !halls.some((h) => h.id === c.hall!.id) && (
                      <option value={c.hall.id}>{c.hall.name} (inactive)</option>
                    )}
                  </select>
                  {c.overridden && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5"
                      title="Back to its usual hall"
                      disabled={pending && busyKey === c.key}
                      onClick={() => move(c, "")}
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                      Reset
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
