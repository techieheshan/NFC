"use client";

import { useEffect, useRef } from "react";
import { CalendarPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { to12Hour } from "@/lib/colombo-time";
import { HallIcon } from "@/lib/hall-icons";
import type { AgendaDay } from "@/lib/timetable-agenda";

/**
 * The week as a vertical agenda: one section per day, classes in time order.
 *
 * This is what a phone shows instead of the hall × day grid, which is 896px wide
 * and made the page scroll sideways. It is the same data — the grid's cells,
 * regrouped by day — so a class moved to another hall for one day shows that
 * hall here too, marked "moved here for the day", and an extra class is marked
 * Additional so it is never mistaken for the recurring timetable.
 *
 * Today, in Colombo time (the server decides it, never this device's clock), is
 * highlighted and scrolled into view when the page opens.
 */
export function TimetableAgenda({
  days,
  today,
  className = "",
}: {
  days: AgendaDay[];
  /** "YYYY-MM-DD", Colombo. */
  today: string;
  className?: string;
}) {
  const todayRef = useRef<HTMLElement | null>(null);

  // A DOM side effect, not state: bring today's section to the top once, on
  // arrival. If the week on screen does not contain today there is nothing to do.
  useEffect(() => {
    todayRef.current?.scrollIntoView({ block: "start" });
  }, []);

  return (
    <div className={`space-y-4 ${className}`}>
      {days.map((day) => {
        const isToday = day.date === today;
        return (
          <section
            key={day.date}
            ref={isToday ? todayRef : undefined}
            // Clear of the sticky 64px header when scrolled to.
            className="scroll-mt-20"
            aria-label={`${day.label} ${day.date}`}
          >
            <h2
              className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
                isToday ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
              }`}
            >
              <span>
                {day.label}
                <span className={`ml-2 font-normal ${isToday ? "opacity-90" : "text-muted-foreground"}`}>
                  {day.date}
                </span>
              </span>
              {isToday && <span className="rounded bg-white/20 px-2 py-0.5 text-xs">Today</span>}
            </h2>

            {day.entries.length === 0 ? (
              <p className="text-muted-foreground px-3 py-3 text-sm">No classes.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {day.entries.map((e) => (
                  <li
                    key={e.key}
                    className={`bg-card rounded-xl border p-3 ${e.additional ? "border-l-primary border-l-4" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-base font-semibold tabular-nums">
                        {to12Hour(e.startTime)} – {to12Hour(e.endTime)}
                      </p>
                      {e.additional && (
                        <Badge variant="outline" className="shrink-0 gap-1">
                          <CalendarPlus className="size-3" aria-hidden />
                          Additional
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 leading-snug font-medium break-words">{e.course}</p>
                    <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                      <span>{e.teacher}</span>
                      <span className="inline-flex items-center gap-1">
                        {e.hall ? <HallIcon icon={e.hall.icon} className="size-3.5" /> : null}
                        {e.hall?.name ?? "No hall"}
                      </span>
                    </p>
                    {e.overridden && (
                      <p className="text-primary mt-1 text-xs">Moved here for the day</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
