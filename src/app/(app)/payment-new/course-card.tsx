"use client";

import { CalendarDays, Check, Clock, TriangleAlert } from "lucide-react";

import type { PaymentMode } from "@/app/(app)/payment/actions";
import { shortMoney } from "@/lib/payment-charge";
import type { CourseCardData, ViewMonth } from "@/lib/payment-view";

/**
 * Board 7 and 8 — one course. Every state the screen builds:
 *   normal · combo price · selected · owed earlier month · already paid · free tier ·
 *   Half chosen · No charge chosen · the 0-day notice · the combo switch (auto, off,
 *   new student, free class, check needed).
 *
 * The whole card is the button (a stretched button behind the content), so a tap anywhere
 * selects it; the calendar button, the combo switch and the notice buttons sit above it.
 * The month line shows the month this card will charge — the oldest unpaid one — and that
 * line is NOT the selection: the tick is.
 *
 * Every price here is a string the server built, and which one shows is decided by the
 * same pure helper the Total uses — this component does no money arithmetic.
 *
 * Colour is never the only signal: owed has the word "Owed", paid has a tick and "Paid 03 Nov",
 * free has "Free · no charge", a check is "Check needed", a new class is "New", half is
 * "Half month", and no charge says "No charge".
 */

const CHIP = "rounded-full px-2 py-0.5 text-[11px] leading-4 font-semibold";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const attendedText = (n: number) => `Attended ${plural(n, "day", "days")}`;

export type PickedMonth = { month: ViewMonth; mode: PaymentMode };

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

function CalendarButton({ course, selected, onOpen }: { course: string; selected: boolean; onOpen: () => void }) {
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

/** The combo switch (board 8): a 52 x 30 track in a 44 px tall tap target. No transforms: the knob moves by `left`. */
function Switch({ on, selected, onToggle }: { on: boolean; selected: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Combo price"
      onClick={onToggle}
      className="pointer-events-auto relative flex h-11 w-[60px] shrink-0 items-center justify-center"
    >
      <span
        className={`relative block h-[30px] w-[52px] rounded-full ${
          on ? (selected ? "bg-white/45" : "bg-primary") : selected ? "bg-white/20" : "bg-[#8A849C]"
        }`}
      >
        <span
          className={`absolute top-[3px] block size-6 rounded-full bg-white shadow-sm ${on ? "left-[25px]" : "left-[3px]"}`}
        />
      </span>
    </button>
  );
}

export function CourseCard({
  course,
  picked,
  comboOn,
  comboApplied,
  notice,
  disabled,
  onToggle,
  onOpenCalendar,
  onSwitch,
  onIgnore,
  onCharge,
}: {
  course: CourseCardData;
  /** The months picked for this course (from the card tap or the calendar), oldest first, each with its mode. */
  picked: PickedMonth[];
  /** The combo switch: true unless staff turned it off. */
  comboOn: boolean;
  /** Does the combo price apply right now (state x switch x answers)? Decided by the shared helper, not here. */
  comboApplied: boolean;
  /** Show the 0-day "Ignore this month?" notice. */
  notice: boolean;
  disabled: boolean;
  onToggle: () => void;
  onOpenCalendar: () => void;
  onSwitch: () => void;
  onIgnore: () => void;
  onCharge: () => void;
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

  const selected = picked.length > 0;

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

  // --- normal / combo / owed / selected / half / no charge ---------------------------------
  const shown: PickedMonth[] = selected
    ? picked
    : course.cardMonth
      ? [{ month: course.cardMonth, mode: "FULL" }]
      : [];
  const first = shown[0];
  const modes = new Set(shown.map((p) => p.mode));
  const single: PaymentMode | null = selected && modes.size === 1 ? shown[0].mode : null;
  const anyOwed = shown.some((p) => p.month.owed);

  const combo = course.combo;
  const comboState = combo?.state;
  const asking = Boolean(combo && comboOn && comboState === "needs-confirmation");
  const effFull = comboApplied && course.comboMonthly ? course.comboMonthly : course.monthly;
  const effHalf = comboApplied && course.halfComboMonthly ? course.halfComboMonthly : course.halfMonthly;

  const monthLine = shown.length > 1 ? `${first.month.label} +${shown.length - 1} more` : (first?.month.label ?? "");
  const newClass = Boolean(combo?.thisClassIsNew && comboOn);
  const subLine =
    shown.length > 1
      ? `${shown.length} months selected${modes.size > 1 ? " · mixed" : ""}`
      : first?.month.state === "ahead"
        ? "Paying ahead"
        : newClass && (first?.month.attended ?? 0) === 0
          ? "No attendance yet"
          : attendedText(first?.month.attended ?? 0);

  const comboSub = !combo
    ? ""
    : !comboOn
      ? "Off: normal rate"
      : comboState === "auto"
        ? combo.classCount === 2
          ? `Attended both classes in ${combo.monthWord}`
          : `Attended all classes in ${combo.monthWord}`
        : comboState === "exempt-free"
          ? "The other class is a free card"
          : comboState === "exempt-new"
            ? "First month, not checked"
            : `Combo ${shortMoney(course.comboMonthly)} if confirmed`;

  const modeWord = single === "HALF" ? "Half month" : single === "NO_CHARGE" ? "No charge" : null;

  const summary = [
    course.course,
    course.teacher,
    `${course.tierLabel} tier`,
    single === "NO_CHARGE"
      ? "no charge"
      : single === "HALF"
        ? `half month ${shortMoney(effHalf)}`
        : comboApplied
          ? `combo price ${shortMoney(course.comboMonthly)}, normal ${shortMoney(course.monthly)}`
          : `price ${shortMoney(course.monthly)}`,
    first ? `${monthLine}${anyOwed ? ", owed" : ""}` : "",
    asking ? "combo check needed" : "",
    selected ? "selected" : "not selected",
  ]
    .filter(Boolean)
    .join(", ");

  const sub = selected ? "text-[#E9DDFF]" : "text-[#5B5670]";

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

        {/* The price: what this month will be charged, in the mode chosen. */}
        <div className="flex items-baseline justify-end gap-2">
          {single === "NO_CHARGE" ? (
            <span className="text-[26px] leading-none font-bold tabular-nums">0</span>
          ) : single === "HALF" ? (
            <>
              <span className={`text-sm line-through ${selected ? "text-[#D9C8FF]" : "text-[#6B6680]"}`}>{shortMoney(effFull)}</span>
              <span className="text-[26px] leading-none font-bold tabular-nums">{shortMoney(effHalf)}</span>
            </>
          ) : (
            <>
              {comboApplied && (
                <span className={`text-sm line-through ${selected ? "text-[#D9C8FF]" : "text-[#6B6680]"}`}>
                  {shortMoney(course.monthly)}
                </span>
              )}
              <span className="text-[26px] leading-none font-bold tabular-nums">{shortMoney(effFull)}</span>
            </>
          )}
        </div>

        {/* Board 8: the combo, a switch. The state is the server's; the switch is staff's. */}
        {combo && (
          <div className={`flex items-center gap-2.5 border-t pt-2 ${selected ? "border-white/35" : "border-dashed border-[#DDD5EE]"}`}>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                Combo price
                {asking && (
                  <span className={`${CHIP} inline-flex items-center gap-1 border border-[#E8851C] bg-[#FFE9CF] text-[#6B3200]`}>
                    <TriangleAlert className="size-3" aria-hidden />
                    Check needed
                  </span>
                )}
              </p>
              <p className={`text-xs ${sub}`}>{comboSub}</p>
            </div>
            <Switch on={comboOn} selected={selected} onToggle={onSwitch} />
          </div>
        )}

        <div className={`flex items-center gap-2.5 border-t pt-2.5 ${selected ? "border-white/35" : "border-dashed border-[#DDD5EE]"}`}>
          <CalendarButton course={course.course} selected={selected} onOpen={onOpenCalendar} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{monthLine}</p>
            <p className={`text-xs ${sub}`}>{subLine}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {modeWord && (
              <span className={`${CHIP} border border-white bg-white text-[#3B1A8F]`}>{modeWord}</span>
            )}
            {newClass && (
              <span className={`${CHIP} inline-flex items-center gap-1 border border-[#E8851C] bg-[#FFE9CF] text-[#6B3200]`}>
                <Clock className="size-3" aria-hidden />
                New
              </span>
            )}
            {anyOwed && (
              <span
                className={`${CHIP} border ${
                  selected ? "border-white bg-white text-[#6B3200]" : "border-[#E8851C] bg-[#FFE9CF] text-[#6B3200]"
                }`}
              >
                Owed
              </span>
            )}
          </div>
        </div>

        {/* Board 7, state 5: an unpaid, completed month with 0 days attended — ask once. */}
        {notice && first && (
          <div className="flex flex-col gap-2.5 rounded-xl border border-[#E8851C] bg-[#FFF4E5] p-3 text-[#4A2600]">
            <p className="text-[13px] leading-snug">
              <span className="font-bold">No classes attended in {first.month.label.split(" ")[0]}.</span> Ignore this month?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onIgnore}
                disabled={disabled}
                className="pointer-events-auto relative h-11 flex-1 rounded-xl border border-primary bg-white text-sm font-semibold text-[#4C1D95]"
              >
                Ignore
              </button>
              <button
                type="button"
                onClick={onCharge}
                disabled={disabled}
                className="pointer-events-auto relative h-11 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
              >
                Charge
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
