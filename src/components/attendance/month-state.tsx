import { AlertTriangle, Check, CreditCard, Gift, type LucideIcon } from "lucide-react";

import { MONTH_STATES, type MonthCounts, type MonthState } from "@/lib/month-status";

/**
 * The four payment states, drawn once.
 *
 * Used by the Daily Attendance cards (counts) and the class list (a chip per
 * student), so a colour or an icon cannot mean one thing on one screen and
 * another on the next. Every state carries an ICON and a WORD as well as a
 * colour — never colour alone — and nothing here needs JavaScript, so it is as
 * cheap as the terminals need it to be.
 *
 * No `:has()`, container queries or newer units: this runs on Chrome 102.
 */
const LOOK: Record<
  MonthState,
  { label: string; icon: LucideIcon; box: string; chip: string; number: string }
> = {
  paid: {
    label: "Paid",
    icon: Check,
    box: "border-emerald-300 bg-emerald-50",
    chip: "bg-emerald-600 text-white",
    number: "text-emerald-900",
  },
  notPaid: {
    label: "Not paid",
    icon: CreditCard,
    box: "border-orange-300 bg-orange-50",
    chip: "bg-orange-600 text-white",
    number: "text-orange-900",
  },
  overdue: {
    label: "Overdue",
    icon: AlertTriangle,
    box: "border-red-300 bg-red-50",
    chip: "bg-red-600 text-white",
    number: "text-red-900",
  },
  // Blue, so it never sits next to Paid as two greens. There is no design token
  // for it: the app's other status colours are plain palette classes too.
  free: {
    label: "Free",
    icon: Gift,
    box: "border-sky-300 bg-sky-50",
    chip: "bg-sky-600 text-white",
    number: "text-sky-900",
  },
};

export const MONTH_STATE_LABEL: Record<MonthState, string> = {
  paid: LOOK.paid.label,
  notPaid: LOOK.notPaid.label,
  overdue: LOOK.overdue.label,
  free: LOOK.free.label,
};

/** One student's state, as a small solid chip. */
export function MonthStateChip({ state }: { state: MonthState }) {
  const look = LOOK[state];
  const Icon = look.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold ${look.chip}`}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {look.label}
    </span>
  );
}

/**
 * The four counts in a row of boxes. Colour lives on the boxes and numbers only;
 * a box holding zero is greyed, so the eye lands on the ones that matter without
 * the row going quiet or changing shape.
 */
export function MonthStateBoxes({ counts }: { counts: MonthCounts }) {
  return (
    <ul className="grid grid-cols-4 gap-1.5">
      {MONTH_STATES.map((state) => {
        const look = LOOK[state];
        const Icon = look.icon;
        const n = counts[state];
        return (
          <li
            key={state}
            className={`flex min-w-0 flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-center ${
              n > 0 ? look.box : "border-border bg-muted/40 text-muted-foreground"
            }`}
          >
            <span className={`text-lg leading-none font-bold tabular-nums ${n > 0 ? look.number : ""}`}>
              {n}
            </span>
            <span className="flex max-w-full items-center gap-0.5 text-[11px] leading-tight font-medium">
              <Icon className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{look.label}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
