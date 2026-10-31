"use client";

import { CalendarDays, Check } from "lucide-react";

import { shortMoney } from "@/lib/payment-charge";
import type { CourseCardData, ViewMonth } from "@/lib/payment-view";

/**
 * Board 7 — one course. Every state the screen builds now:
 *   normal · combo price · selected · owed earlier month · already paid · free tier.
 *
 * The whole card is the button (a stretched button behind the content), so a tap
 * anywhere selects it; the calendar button sits above it and opens the months.
 * The month line shows the month this card will charge — the oldest unpaid one —
 * and that line is NOT the selection: the tick is.
 *
 * Colour is never the only signal: owed has the word "Owed", paid has a tick and
 * "Paid 03 Nov", free has "Free · no charge".
 */

const CHIP = "rounded-full px-2 py-0.5 text-[11px] leading-4 font-semibold";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const attendedText = (n: number) => `Attended ${plural(n, "day", "days")}`;

function TierChip({ label, selected }: { label: string; selected: boolean }) {
  return (
    <span
      className={`${CHIP} shrink-0 border ${
        selected ? "border-white text-white" : "border-[#CFC6E6] bg-white text-[#3B2A6B]"
      }`}
    >
      {label}
    </span>
  );
}

function CalendarButton({
  course,
  selected,
  onOpen,
}: {
  course: string;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Choose months for ${course}`}
      className={`pointer-events-auto relative grid size-11 shrink-0 place-items-center rounded-xl border ${
        selected
          ? "border-white/60 bg-white/15 text-white"
          : "border-[#CFC6E6] bg-[#F7F3FF] text-[#4C1D95]"
      }`}
    >
      <CalendarDays className="size-[22px]" aria-hidden />
    </button>
  );
}

export function CourseCard({
  course,
  selectedMonths,
  disabled,
  onToggle,
  onOpenCalendar,
}: {
  course: CourseCardData;
  /** The months picked for this course, oldest first (from the card tap or the calendar). */
  selectedMonths: ViewMonth[];
  disabled: boolean;
  onToggle: () => void;
  onOpenCalendar: () => void;
}) {
  const header = (selected: boolean) => (
    <div className="flex items-start gap-2.5">
      {selected && (
        <span className="mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-full bg-white text-primary">
          <Check className="size-3.5" strokeWidth={3.2} aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {/* Names wrap, never truncate: "Theory" and "Paper" must be tellable apart. */}
        <p className="text-base leading-tight font-semibold break-words">{course.course}</p>
        <p className={`mt-0.5 text-[12.5px] break-words ${selected ? "text-[#E9DDFF]" : "text-[#5B5670]"}`}>
          {course.teacher}
        </p>
      </div>
      {!course.free && <TierChip label={course.tierLabel} selected={selected} />}
    </div>
  );

  // --- free tier: nothing to charge, nothing to tap ---------------------------------
  if (course.free) {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-[#E6E1F2] bg-[#F4F2F8] p-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-base leading-tight font-semibold break-words text-[#5B5670]">{course.course}</p>
          <p className="mt-0.5 text-[12.5px] break-words text-[#5B5670]">{course.teacher}</p>
        </div>
        <span className={`${CHIP} shrink-0 border border-[#3B82F6] bg-[#DCE9FF] text-[#0F3A82]`}>
          Free · no charge
        </span>
      </div>
    );
  }

  const selected = selectedMonths.length > 0;

  // --- already paid up to now: settled, not selectable by a tap -----------------------
  if (!selected && !course.cardMonth) {
    return (
      <div className="flex flex-col gap-2.5 rounded-2xl border border-[#E6E1F2] bg-[#F4F2F8] p-3.5">
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-base leading-tight font-semibold break-words text-[#5B5670]">{course.course}</p>
            <p className="mt-0.5 text-[12.5px] break-words text-[#5B5670]">{course.teacher}</p>
          </div>
          <TierChip label={course.tierLabel} selected={false} />
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenCalendar}
            disabled={disabled}
            aria-label={`Choose months for ${course.course}`}
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-[#CFC6E6] bg-white text-[#4C1D95]"
          >
            <CalendarDays className="size-[22px]" aria-hidden />
          </button>
          <p className="min-w-0 flex-1 text-sm font-semibold text-[#5B5670]">
            {course.paidThisMonth?.label ?? ""}
          </p>
          <span className={`${CHIP} flex shrink-0 items-center gap-1 border border-[#2E9E5B] bg-[#D6F2DF] text-[#0B4A24]`}>
            <Check className="size-3" strokeWidth={3} aria-hidden />
            {course.paidThisMonth?.paidLabel ? `Paid ${course.paidThisMonth.paidLabel}` : "Paid"}
          </span>
        </div>
      </div>
    );
  }

  // --- normal / combo / owed / selected -----------------------------------------------
  const shown = selected ? selectedMonths : course.cardMonth ? [course.cardMonth] : [];
  const first = shown[0];
  const anyOwed = shown.some((m) => m.owed);
  const monthLine =
    shown.length > 1 ? `${first.label} +${shown.length - 1} more` : (first?.label ?? "");
  const subLine =
    shown.length > 1
      ? `${shown.length} months selected`
      : first?.state === "ahead"
        ? "Paying ahead"
        : attendedText(first?.attended ?? 0);

  const onCombo = course.comboMonthly !== null;
  const summary = [
    course.course,
    course.teacher,
    `${course.tierLabel} tier`,
    onCombo ? `combo price ${shortMoney(course.comboMonthly)}, normal ${shortMoney(course.monthly)}` : `price ${shortMoney(course.monthly)}`,
    first ? `${monthLine}${anyOwed ? ", owed" : ""}` : "",
    selected ? "selected" : "not selected",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      className={`relative rounded-2xl border-2 ${
        selected ? "border-primary bg-primary text-primary-foreground" : "border-[#E1DAF0] bg-white"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={selected}
        aria-label={summary}
        className="focus-visible:ring-ring absolute top-0 right-0 bottom-0 left-0 rounded-2xl focus-visible:ring-4 focus-visible:outline-none"
      />
      <div className="pointer-events-none relative flex flex-col gap-2.5 p-3">
        {header(selected)}

        <div className="flex items-baseline justify-end gap-2">
          {onCombo && (
            <span
              className={`text-sm line-through ${selected ? "text-[#D9C8FF]" : "text-[#6B6680]"}`}
            >
              {shortMoney(course.monthly)}
            </span>
          )}
          <span className="text-[26px] leading-none font-bold tabular-nums">
            {shortMoney(onCombo ? course.comboMonthly : course.monthly)}
          </span>
        </div>

        <div
          className={`flex items-center gap-2.5 border-t pt-2.5 ${
            selected ? "border-white/35" : "border-dashed border-[#DDD5EE]"
          }`}
        >
          <CalendarButton course={course.course} selected={selected} onOpen={onOpenCalendar} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{monthLine}</p>
            <p className={`text-xs ${selected ? "text-[#E9DDFF]" : "text-[#5B5670]"}`}>{subLine}</p>
          </div>
          {anyOwed && (
            <span
              className={`${CHIP} shrink-0 border ${
                selected
                  ? "border-white bg-white text-[#6B3200]"
                  : "border-[#E8851C] bg-[#FFE9CF] text-[#6B3200]"
              }`}
            >
              Owed
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
