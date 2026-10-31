/**
 * What the NEW payment screen sends and shows as its running total — pure, so it
 * can be tested against the old screen and against `takePayment` itself.
 *
 * Nothing here decides money. The total is display only (the server recomputes
 * every amount, AGENTS rule 16), and the formula is deliberately the same one the
 * old screen uses, in the same order, so the two screens show the same number:
 *   - before a combo pop-up is answered, a course shows at its normal rate;
 *   - once a combo is accepted, its courses switch to the combo rate;
 *   - the fee tier is already inside `monthly` / `comboMonthly` (from the panel).
 */

export type ChargeCourse = {
  courseId: number;
  free: boolean;
  monthly: string | null;
  comboMonthly: string | null;
  comboId: number | null;
  /** Every month the screen offers for this course, oldest first. */
  months: { year: number; month: number }[];
};

export type ChargeDecision = { comboId: number; apply: boolean; reason?: string };

export const monthKey = (courseId: number, year: number, month: number) =>
  `${courseId}:${year}:${month}`;

export function chargeTotal(input: {
  admission: boolean;
  smartCard: boolean;
  admissionAmount: string;
  smartCardAmount: string;
  courses: ChargeCourse[];
  selected: ReadonlySet<string>;
  decisions: readonly ChargeDecision[];
}): number {
  let sum = 0;
  if (input.admission) sum += Number(input.admissionAmount);
  if (input.smartCard) sum += Number(input.smartCardAmount);
  for (const c of input.courses) {
    if (c.free || !c.monthly) continue;
    const applied =
      c.comboId !== null && input.decisions.some((d) => d.comboId === c.comboId && d.apply);
    const unit = Number(applied && c.comboMonthly ? c.comboMonthly : c.monthly);
    for (const m of c.months) {
      if (input.selected.has(monthKey(c.courseId, m.year, m.month))) sum += unit;
    }
  }
  return sum;
}

/** The `classMonths` of a `takePayment` call: course order, then oldest month first. */
export function selectedClassMonths(courses: ChargeCourse[], selected: ReadonlySet<string>) {
  return courses.flatMap((c) =>
    c.free
      ? []
      : c.months
          .filter((m) => selected.has(monthKey(c.courseId, m.year, m.month)))
          .map((m) => ({ courseId: c.courseId, year: m.year, month: m.month })),
  );
}

/** Exactly the input shape `takePayment` has always taken. */
export function chargeInput(input: {
  studentId: number;
  admission: boolean;
  smartCard: boolean;
  courses: ChargeCourse[];
  selected: ReadonlySet<string>;
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

/** The combos a selection touches — each one gets a pop-up, exactly as before. */
export function touchedComboIds(courses: ChargeCourse[], selected: ReadonlySet<string>): number[] {
  const ids = new Set(
    selectedClassMonths(courses, selected)
      .map((m) => courses.find((c) => c.courseId === m.courseId)?.comboId)
      .filter((v): v is number => v !== null && v !== undefined),
  );
  return [...ids];
}

/**
 * Tapping a card: select its month (the oldest unpaid), or — if anything for the
 * course is already selected, from the card or from the calendar — clear it all.
 */
export function toggleCard(
  courseId: number,
  cardMonth: { year: number; month: number } | null,
  selected: ReadonlySet<string>,
): Set<string> {
  const next = new Set(selected);
  const prefix = `${courseId}:`;
  const mine = [...next].filter((k) => k.startsWith(prefix));
  if (mine.length > 0) {
    for (const k of mine) next.delete(k);
  } else if (cardMonth) {
    next.add(monthKey(courseId, cardMonth.year, cardMonth.month));
  }
  return next;
}

export function toggleMonth(selected: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * A price as the boards draw it on a card: "2500", not "2500.00". Only the display
 * changes — a price with real cents ("666.66", "1250.50") keeps them, and the Total,
 * Admission and Smart card rows keep two decimals.
 */
export const shortMoney = (amount: string | null) =>
  amount === null ? "—" : amount.replace(/\.00$/, "");
