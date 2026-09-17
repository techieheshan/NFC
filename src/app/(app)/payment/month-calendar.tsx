"use client";

import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { MonthOption } from "./actions";

/**
 * Which months of this course are being paid for.
 *
 * A row of twelve chips does not fit a terminal, so the months live behind a
 * calendar: a year at a time, twelve cells, tap the ones being paid.
 *
 * NOTHING IS EVER PRE-SELECTED. A month that arrives already ticked is a charge
 * nobody chose — a student in for a smart card would leave having paid a
 * month's fee because a screen decided it for them. The oldest owed month is
 * MARKED so staff can see where the arrears start, and marking is all it does:
 * the total stays at zero until a finger lands on a month.
 *
 * Paid months are shown but not selectable — staff need to see that August is
 * settled, and they must not be able to charge it twice.
 */

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function MonthCalendar({
  months,
  selectedKeys,
  onToggle,
  keyFor,
  disabled,
}: {
  /** The months this enrolment may be charged for, as the server allows them. */
  months: MonthOption[];
  selectedKeys: Set<string>;
  onToggle: (year: number, month: number) => void;
  keyFor: (year: number, month: number) => string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const byKey = new Map(months.map((m) => [`${m.year}-${m.month}`, m]));
  const years = [...new Set(months.map((m) => m.year))].sort();
  const current = months.find((m) => m.kind === "current");
  const [year, setYear] = useState(
    () => current?.year ?? years[0] ?? new Date().getFullYear(),
  );

  // The earliest month still owed: a marker so staff can see where the arrears
  // begin. It is never selected, and nothing about the total depends on it.
  const oldestOwed = months.find((m) => !m.paid && m.kind !== "future");

  const chosen = months.filter((m) => selectedKeys.has(keyFor(m.year, m.month)));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="border-input bg-background flex min-h-12 w-full items-center gap-3 rounded-md border px-3 py-2 text-left disabled:opacity-50"
      >
        <CalendarDays className="text-muted-foreground size-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          {chosen.length === 0 ? (
            <span className="text-muted-foreground text-sm">
              Choose month{oldestOwed ? ` — owes from ${oldestOwed.label}` : ""}
            </span>
          ) : (
            <span className="block truncate text-sm font-medium">
              {chosen.map((m) => m.label).join(", ")}
            </span>
          )}
        </span>
        {chosen.length > 0 && (
          <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs font-semibold">
            {chosen.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="bg-background max-h-[85svh] overflow-y-auto rounded-t-2xl border-t p-4 shadow-lg">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-base font-semibold">Which months?</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="hover:bg-secondary grid size-10 place-items-center rounded-md"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <div className="mb-3 flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11"
                disabled={year <= (years[0] ?? year)}
                onClick={() => setYear((y) => y - 1)}
                aria-label="Previous year"
              >
                <ChevronLeft className="size-5" aria-hidden />
              </Button>
              <span className="text-lg font-semibold tabular-nums">{year}</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11"
                disabled={year >= (years[years.length - 1] ?? year)}
                onClick={() => setYear((y) => y + 1)}
                aria-label="Next year"
              >
                <ChevronRight className="size-5" aria-hidden />
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {MONTH_NAMES.map((name, i) => {
                const m = byKey.get(`${year}-${i + 1}`);
                const selectable = Boolean(m) && !m!.paid;
                const on = m ? selectedKeys.has(keyFor(m.year, m.month)) : false;
                const isOldestOwed =
                  m && oldestOwed && m.year === oldestOwed.year && m.month === oldestOwed.month;

                return (
                  <button
                    key={name}
                    type="button"
                    disabled={!selectable}
                    onClick={() => m && onToggle(m.year, m.month)}
                    className={[
                      "relative flex min-h-14 flex-col items-center justify-center rounded-lg border text-sm font-medium transition-colors",
                      !m
                        ? // Not offered for this enrolment at all.
                          "text-muted-foreground/40 border-dashed"
                        : m.paid
                          ? // Paid: visible, so staff can see it is settled —
                            // blurred and inert, so it cannot be charged twice.
                            "text-muted-foreground bg-muted cursor-not-allowed opacity-50 blur-[0.4px]"
                          : on
                            ? "border-primary bg-primary text-primary-foreground"
                            : m.kind === "past"
                              ? "border-amber-300 bg-amber-50 text-amber-900"
                              : m.kind === "future"
                                ? "border-dashed"
                                : "hover:bg-accent",
                    ].join(" ")}
                  >
                    {name}
                    {m?.paid && <span className="text-[10px]">paid ✓</span>}
                    {m && !m.paid && m.kind === "future" && (
                      <span className="text-muted-foreground text-[10px]">ahead</span>
                    )}
                    {/* Marker only — it selects nothing. */}
                    {isOldestOwed && !on && (
                      <span
                        aria-label="oldest month owed"
                        className="bg-destructive absolute top-1.5 right-1.5 size-2 rounded-full"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="bg-destructive size-2 rounded-full" /> oldest owed (not selected)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="bg-muted size-3 rounded border opacity-50 blur-[0.4px]" /> already paid
              </span>
            </div>

            <Button type="button" className="mt-4 h-12 w-full" onClick={() => setOpen(false)}>
              {chosen.length === 0 ? "Done — no month selected" : `Done — ${chosen.length} month(s)`}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
