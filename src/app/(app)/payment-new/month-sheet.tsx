"use client";

import { useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Info, X } from "lucide-react";

import type { PaymentMode } from "@/app/(app)/payment/actions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { monthKey } from "@/lib/payment-charge";
import type { CourseCardData, ViewMonth } from "@/lib/payment-view";

/**
 * Board 4 — which months of one course are being paid.
 *
 * A year at a time, twelve tiles:
 *   paid      green, a tick and the DAY it was paid (Colombo) — shown, not selectable;
 *   unpaid    orange, the days attended that month — tap to select;
 *   selected  purple;
 *   ahead     dashed, the word "ahead" — payable early, up to the same limit as before;
 *   not offered (before enrolment, or past the ahead limit)  dashed grey, a dash.
 *
 * Press and hold a month (or tap its ⓘ) to see that month's attendance. Nothing is
 * pre-selected here: the selection belongs to the screen, this only edits it.
 */

const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOLD_MS = 500;

const TILE = "relative flex h-[76px] w-full flex-col gap-1 rounded-[14px] border";

/**
 * One month tile: a stretched button behind the content (so the tile is one tap
 * target) and the info button beside it — never a button inside a button.
 */
function Tile({
  className,
  label,
  pressed,
  hold,
  onClick,
  info,
  children,
}: {
  className: string;
  label: string;
  pressed?: boolean;
  hold: Record<string, unknown>;
  onClick: () => void;
  info: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`${TILE} ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        className="focus-visible:ring-ring absolute top-0 right-0 bottom-0 left-0 rounded-[14px] focus-visible:ring-4 focus-visible:outline-none"
        {...hold}
      />
      <div className="pointer-events-none flex h-full flex-col items-center justify-center gap-1">{children}</div>
      {info}
    </div>
  );
}

function InfoButton({
  month,
  tone,
  onInfo,
}: {
  month: ViewMonth;
  tone: string;
  onInfo: (month: ViewMonth) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Attendance for ${month.label}`}
      onClick={() => onInfo(month)}
      className={`absolute top-0 right-0 grid size-11 place-items-center ${tone}`}
    >
      <Info className="size-4" aria-hidden />
    </button>
  );
}

export function MonthSheet({
  course,
  today,
  selected,
  onToggle,
  onInfo,
  onClose,
}: {
  course: CourseCardData;
  today: { year: number; month: number };
  /** The months picked for this payment, and how each is charged. */
  selected: { get: (key: string) => PaymentMode | undefined };
  onToggle: (month: ViewMonth) => void;
  /** Open the month-detail pop-up for this month. */
  onInfo: (month: ViewMonth) => void;
  onClose: () => void;
}) {
  const byYm = new Map(course.months.map((m) => [`${m.year}-${m.month}`, m]));
  const years = [...new Set(course.months.map((m) => m.year))];
  const minYear = Math.min(...years, today.year);
  const maxYear = Math.max(...years, today.year);

  const firstPick = course.cardMonth ?? course.months.find((m) => m.state !== "paid");
  const [year, setYear] = useState(firstPick?.year ?? today.year);

  const chosen = course.months.filter((m) => selected.get(monthKey(course.courseId, m.year, m.month)) !== undefined);

  // Press and hold: a timer that opens the detail; the click that follows the
  // release is swallowed so holding a tile does not also select it.
  const timer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const startHold = (m: ViewMonth) => {
    held.current = false;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      held.current = true;
      onInfo(m);
    }, HOLD_MS);
  };
  const endHold = () => window.clearTimeout(timer.current);
  const holdProps = (m: ViewMonth) => ({
    onPointerDown: () => startHold(m),
    onPointerUp: endHold,
    onPointerLeave: endHold,
    onPointerCancel: endHold,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} className="gap-3 p-4 sm:max-w-md">
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg leading-tight font-bold break-words">{course.course}</DialogTitle>
            <DialogDescription className="mt-0.5 text-[13px] text-[#5B5670]">Which months?</DialogDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-[#E1DAF0] bg-white"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            aria-label="Previous year"
            disabled={year <= minYear}
            onClick={() => setYear((y) => y - 1)}
            className="grid size-11 place-items-center rounded-xl border border-[#E1DAF0] bg-white disabled:opacity-40"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <p className="w-[90px] text-center text-xl font-bold tabular-nums" aria-live="polite">
            {year}
          </p>
          <button
            type="button"
            aria-label="Next year"
            disabled={year >= maxYear}
            onClick={() => setYear((y) => y + 1)}
            className="grid size-11 place-items-center rounded-xl border border-[#E1DAF0] bg-white disabled:opacity-40"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {NAMES.map((name, i) => {
            const m = byYm.get(`${year}-${i + 1}`);

            // Not offered: before the enrolment started, or past the ahead limit.
            if (!m) {
              return (
                <div
                  key={name}
                  className={`${TILE} items-center justify-center border-dashed border-[#D8D2E6] bg-[#FAF8FF] text-[#8A849C]`}
                >
                  <span className="text-[13px] font-semibold">{name}</span>
                  <span className="text-sm" aria-hidden>–</span>
                  <span className="sr-only">not offered</span>
                </div>
              );
            }

            const pickedMode = selected.get(monthKey(course.courseId, m.year, m.month));
            const picked = pickedMode !== undefined;

            if (m.state === "paid") {
              return (
                <Tile
                  key={name}
                  className="border-[#2E9E5B] bg-[#D6F2DF] text-[#0B4A24]"
                  label={`${m.label}, paid${m.paidMode === "NO_CHARGE" ? ", no charge" : m.paidDay !== null ? ` on day ${m.paidDay}` : ""}${m.paidMode === "HALF" ? ", half month" : ""}`}
                  hold={holdProps(m)}
                  onClick={() => {
                    // A paid month cannot be charged again; a tap does nothing.
                    held.current = false;
                  }}
                  info={<InfoButton month={m} tone="text-[#0B4A24]" onInfo={onInfo} />}
                >
                  <span className="text-[13px] font-semibold">{name}</span>
                  <span className={`flex items-center gap-1 font-bold ${m.paidMode === "NO_CHARGE" ? "text-[13px]" : "text-[17px]"}`}>
                    <Check className="size-3.5" strokeWidth={3} aria-hidden />
                    {m.paidMode === "NO_CHARGE" ? "No charge" : (m.paidDay ?? "")}
                  </span>
                  {m.paidMode === "HALF" && <span className="rounded-full bg-white/80 px-1.5 text-[10px] leading-4 font-bold whitespace-nowrap">½ month</span>}
                </Tile>
              );
            }

            const days = m.state === "ahead" ? "ahead" : `${m.attended} ${m.attended === 1 ? "day" : "days"}`;
            const word = pickedMode === "HALF" ? "½ month" : pickedMode === "NO_CHARGE" ? "No charge" : days;
            const tone = picked ? "text-white" : m.state === "ahead" ? "text-[#5B5670]" : "text-[#6B3200]";

            return (
              <Tile
                key={name}
                pressed={picked}
                className={
                  picked
                    ? "border-2 border-primary bg-primary text-primary-foreground"
                    : m.state === "ahead"
                      ? "border-dashed border-[#A99BD0] bg-white text-[#5B5670]"
                      : "border-[#E8851C] bg-[#FFE9CF] text-[#6B3200]"
                }
                label={`${m.label}, ${m.state === "ahead" ? "ahead" : `not paid, ${days} attended`}${picked ? `, selected${pickedMode === "HALF" ? " as half month" : pickedMode === "NO_CHARGE" ? " as no charge" : ""}` : ""}`}
                hold={holdProps(m)}
                onClick={() => {
                  if (held.current) {
                    held.current = false;
                    return;
                  }
                  onToggle(m);
                }}
                info={<InfoButton month={m} tone={tone} onInfo={onInfo} />}
              >
                <span className="text-[13px] font-semibold">{name}</span>
                <span className={m.state === "ahead" && !picked ? "text-xs" : pickedMode === "NO_CHARGE" ? "text-[13px] font-bold" : "text-[15px] font-bold"}>{word}</span>
              </Tile>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5 text-xs text-[#3F3A55]">
          <p className="flex items-center gap-2">
            <span className="flex h-5 w-11 items-center justify-center rounded-md border border-[#2E9E5B] bg-[#D6F2DF] font-bold text-[#0B4A24]">
              12
            </span>
            Paid, the number is the day paid
          </p>
          <p className="flex items-center gap-2">
            <span className="flex h-5 w-auto min-w-11 shrink-0 items-center justify-center rounded-md border border-[#2E9E5B] bg-[#D6F2DF] px-1 text-[10px] font-bold whitespace-nowrap text-[#0B4A24]">
              ½ month
            </span>
            Paid as a half month; a tile reads No charge if nothing was charged
          </p>
          <p className="flex items-center gap-2">
            <span className="flex h-5 w-11 items-center justify-center rounded-md border border-[#E8851C] bg-[#FFE9CF] font-bold text-[#6B3200]">
              1 day
            </span>
            Not paid, days attended that month
          </p>
          <p className="flex items-center gap-2">
            <span className="h-5 w-11 rounded-md bg-primary" aria-hidden />
            Selected for this payment
          </p>
          <p className="mt-1 text-[#5B5670]">Press and hold a month, or tap its info icon, to see its attendance.</p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="h-[52px] w-full rounded-[14px] bg-primary text-base font-semibold text-primary-foreground"
        >
          {chosen.length === 0 ? "Done" : `Done · ${chosen.length} ${chosen.length === 1 ? "month" : "months"}`}
        </button>
      </DialogContent>
    </Dialog>
  );
}
