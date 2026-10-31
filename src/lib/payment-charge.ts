import type { PaymentMode } from "@/app/(app)/payment/actions";
import type { ComboState } from "@/lib/combos";

/**
 * What the NEW payment screen sends and shows as its running total — pure, so it
 * can be tested against the old screen and against `takePayment` itself.
 *
 * Nothing here decides money. Every price is a string the server built (the panel's
 * `monthly` / `comboMonthly`, and the view's `halfMonthly` / `halfComboMonthly`); this
 * file only chooses WHICH string applies to a line and adds them up, in the order the
 * server adds its lines, so the Total is the receipt's total:
 *   - Full / Half / No charge is the line's mode (No charge adds nothing);
 *   - a combo applies on the screen exactly when the server will apply it:
 *       switched off                       → never
 *       needs-confirmation                 → only after staff answered "Yes"
 *       auto / exempt-new / exempt-free    → yes, unless a refusal was answered
 *   - the fee tier is already inside every price.
 * The server recomputes all of it at charge time (AGENTS rule 16).
 */

export type ChargeCourse = {
  courseId: number;
  free: boolean;
  monthly: string | null;
  comboMonthly: string | null;
  /** Half of `monthly` / `comboMonthly`, as the server computes a Half month. */
  halfMonthly: string | null;
  halfComboMonthly: string | null;
  comboId: number | null;
  /**
   * The combo's server-side state. Absent means "ask": that is how the old screen treated every
   * combo, and what a caller that knows no state gets.
   */
  comboState?: ComboState | null;
  /** Every month the screen offers for this course, oldest first. */
  months: { year: number; month: number }[];
};

/** `off` = staff switched this combo off: normal rate, no reason (a refusal still needs one). */
export type ChargeDecision = { comboId: number; apply: boolean; reason?: string; off?: boolean };

/** Which months are picked, and in which mode. Absent from the map = not picked. */
export type Selection = ReadonlyMap<string, PaymentMode>;
/** A bare set of keys is a selection of FULL months — the shape jobs 1 and 2 used. */
export type SelectionLike = ReadonlySet<string> | Selection;

export const monthKey = (courseId: number, year: number, month: number) =>
  `${courseId}:${year}:${month}`;

export function asSelection(selected: SelectionLike): Selection {
  return selected instanceof Map
    ? selected
    : new Map([...(selected as ReadonlySet<string>)].map((k) => [k, "FULL" as PaymentMode]));
}

/**
 * The courses the total and the request are built from. A PAID month is left out
 * entirely, so no selection — a stale key, a bug in a pop-up — can ever put an
 * already-settled month into the Total or into `takePayment`. (The server would
 * refuse it as "already paid" anyway; this keeps the screen from ever showing it.)
 */
export function chargeCoursesFrom(
  courses: {
    courseId: number;
    free: boolean;
    monthly: string | null;
    comboMonthly: string | null;
    halfMonthly: string | null;
    halfComboMonthly: string | null;
    comboId: number | null;
    combo?: { state: ComboState } | null;
    months: { year: number; month: number; state: "paid" | "unpaid" | "ahead" }[];
  }[],
): ChargeCourse[] {
  return courses.map((c) => ({
    courseId: c.courseId,
    free: c.free,
    monthly: c.monthly,
    comboMonthly: c.comboMonthly,
    halfMonthly: c.halfMonthly,
    halfComboMonthly: c.halfComboMonthly,
    comboId: c.comboId,
    comboState: c.combo?.state ?? null,
    months: c.months.filter((m) => m.state !== "paid").map((m) => ({ year: m.year, month: m.month })),
  }));
}

/**
 * Does the combo's rate apply to a line? The screen's copy of the server's rule: a switched-off
 * combo never; `needs-confirmation` only once staff said "Yes"; every other state applies on its
 * own — unless a refusal was answered. A caller that knows no state gets the old behaviour: a
 * combo applies only after a "Yes".
 */
export function comboApplies(
  state: ComboState | null | undefined,
  switchedOff: boolean,
  decision: { apply: boolean } | undefined,
): boolean {
  if (switchedOff) return false;
  if (state == null || state === "needs-confirmation") return decision?.apply === true;
  return decision ? decision.apply : true;
}

/** Does this course's combo apply right now, given the switches and the answers so far? */
export function courseComboApplied(
  course: Pick<ChargeCourse, "comboId" | "comboMonthly" | "comboState">,
  comboOff: ReadonlySet<number>,
  decisions: readonly ChargeDecision[],
): boolean {
  if (course.comboId === null || course.comboMonthly === null) return false;
  const decision = [...decisions].reverse().find((d) => d.comboId === course.comboId); // the last answer wins, as on the server
  return comboApplies(course.comboState, comboOff.has(course.comboId), decision);
}

/** The server-built price string a line is charged: Full, Half, or nothing. */
export function lineAmountText(
  course: Pick<ChargeCourse, "monthly" | "comboMonthly" | "halfMonthly" | "halfComboMonthly">,
  mode: PaymentMode,
  comboApplied: boolean,
): string {
  if (mode === "NO_CHARGE") return "0.00";
  if (mode === "HALF") return (comboApplied && course.halfComboMonthly ? course.halfComboMonthly : course.halfMonthly) ?? "0.00";
  return (comboApplied && course.comboMonthly ? course.comboMonthly : course.monthly) ?? "0.00";
}

export function chargeTotal(input: {
  admission: boolean;
  smartCard: boolean;
  admissionAmount: string;
  smartCardAmount: string;
  courses: ChargeCourse[];
  selected: SelectionLike;
  decisions: readonly ChargeDecision[];
  /** Combos staff switched off. */
  comboOff?: ReadonlySet<number>;
}): number {
  const selection = asSelection(input.selected);
  const off = input.comboOff ?? new Set<number>();
  let sum = 0;
  if (input.admission) sum += Number(input.admissionAmount);
  if (input.smartCard) sum += Number(input.smartCardAmount);
  for (const c of input.courses) {
    if (c.free || !c.monthly) continue;
    const applied = courseComboApplied(c, off, input.decisions);
    for (const m of c.months) {
      const mode = selection.get(monthKey(c.courseId, m.year, m.month));
      if (mode !== undefined) sum += Number(lineAmountText(c, mode, applied));
    }
  }
  return sum;
}

/** The `classMonths` of a `takePayment` call: course order, then oldest month first. `mode` only when not FULL. */
export function selectedClassMonths(courses: ChargeCourse[], selected: SelectionLike) {
  const selection = asSelection(selected);
  return courses.flatMap((c) =>
    c.free
      ? []
      : c.months.flatMap((m) => {
          const mode = selection.get(monthKey(c.courseId, m.year, m.month));
          if (mode === undefined) return [];
          return [
            mode === "FULL"
              ? { courseId: c.courseId, year: m.year, month: m.month }
              : { courseId: c.courseId, year: m.year, month: m.month, mode },
          ];
        }),
  );
}

/** Exactly the input shape `takePayment` takes; a Full-only checkout is byte-identical to the old one. */
export function chargeInput(input: {
  studentId: number;
  admission: boolean;
  smartCard: boolean;
  courses: ChargeCourse[];
  selected: SelectionLike;
  comboDecisions: ChargeDecision[];
}) {
  return {
    studentId: input.studentId,
    admission: input.admission,
    smartCard: input.smartCard,
    classMonths: selectedClassMonths(input.courses, input.selected),
    comboDecisions: input.comboDecisions,
  };
}

/**
 * The combos a selection touches. A month picked as No charge touches nothing (it is 0.00 with
 * or without a combo), exactly as on the server.
 */
export function touchedComboIds(courses: ChargeCourse[], selected: SelectionLike): number[] {
  const ids = new Set(
    selectedClassMonths(courses, selected)
      .filter((m) => !("mode" in m && m.mode === "NO_CHARGE"))
      .map((m) => courses.find((c) => c.courseId === m.courseId)?.comboId)
      .filter((v): v is number => v !== null && v !== undefined),
  );
  return [...ids];
}

/**
 * Which combos get the pop-up when staff press Take payment: touched, still switched ON, and the
 * server says a person must decide. (A caller that knows no state gets the old behaviour: every
 * touched combo is asked.)
 */
export function comboQuestionIds(courses: ChargeCourse[], selected: SelectionLike, comboOff: ReadonlySet<number>): number[] {
  return touchedComboIds(courses, selected).filter((id) => {
    if (comboOff.has(id)) return false;
    const state = courses.find((c) => c.comboId === id)?.comboState;
    return state == null || state === "needs-confirmation";
  });
}

/** The "switched off" answers to send for the touched combos staff turned off: no reason needed. */
export function comboOffDecisions(courses: ChargeCourse[], selected: SelectionLike, comboOff: ReadonlySet<number>): ChargeDecision[] {
  return touchedComboIds(courses, selected)
    .filter((id) => comboOff.has(id))
    .map((comboId) => ({ comboId, apply: false, off: true }));
}

/**
 * Tapping a card: pick its month (the oldest unpaid) in `mode`, or — if anything for the course is
 * already picked, from the card or from the calendar — clear it all.
 */
export function toggleCard(
  courseId: number,
  cardMonth: { year: number; month: number } | null,
  selected: SelectionLike,
  mode: PaymentMode = "FULL",
): Map<string, PaymentMode> {
  const next = new Map(asSelection(selected));
  const prefix = `${courseId}:`;
  const mine = [...next.keys()].filter((k) => k.startsWith(prefix));
  if (mine.length > 0) {
    for (const k of mine) next.delete(k);
  } else if (cardMonth) {
    next.set(monthKey(courseId, cardMonth.year, cardMonth.month), mode);
  }
  return next;
}

/** Pick a month as Full, or un-pick it if it is already picked (in any mode). */
export function toggleMonth(selected: SelectionLike, key: string): Map<string, PaymentMode> {
  const next = new Map(asSelection(selected));
  if (next.has(key)) next.delete(key);
  else next.set(key, "FULL");
  return next;
}

/** Pick a month in a specific mode (replacing any mode it had). */
export function setMonthMode(selected: SelectionLike, key: string, mode: PaymentMode): Map<string, PaymentMode> {
  const next = new Map(asSelection(selected));
  next.set(key, mode);
  return next;
}

/**
 * A price as the boards draw it on a card: "2500", not "2500.00". Only the display
 * changes — a price with real cents ("666.66", "1250.50") keeps them, and the Total,
 * Admission and Smart card rows keep two decimals.
 */
export const shortMoney = (amount: string | null) =>
  amount === null ? "—" : amount.replace(/\.00$/, "");
