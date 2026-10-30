/**
 * The four payment states of one student in one class for one billing month.
 *
 * Pure on purpose — no database, no `server-only` — so the rule can be tested on
 * its own and the Daily Attendance cards and the class list can never disagree:
 * both are built from `buildMonthStates`.
 *
 * It does NOT decide what "settled" means. That is `SETTLED_PAYMENT_WHERE` in
 * `student-arrears.ts`; this module is handed the two sets of students that
 * query returned (this month's payers, last month's payers) and only classifies.
 *
 *   paid     this month is settled
 *   notPaid  this month unpaid, and last month either settled or not applicable
 *   overdue  this month unpaid AND last month also unpaid — one step worse
 *   free     free tier: nothing to owe, which is not the same as paid up
 */
export type MonthState = "paid" | "notPaid" | "overdue" | "free";

export const MONTH_STATES: readonly MonthState[] = ["paid", "notPaid", "overdue", "free"];

export type MonthCounts = Record<MonthState, number>;

export type MonthEnrolment = {
  studentId: number;
  /** Free-tier enrolments generate no payment row and are never "owed". */
  free: boolean;
  /**
   * Was this enrolment already running in the PREVIOUS billing month? "Last
   * month" only counts if the student was there for it — a student who joined
   * this month cannot be overdue for a month before they enrolled.
   */
  enrolledLastMonth: boolean;
};

export function classifyMonth(input: {
  free: boolean;
  paidThisMonth: boolean;
  enrolledLastMonth: boolean;
  paidLastMonth: boolean;
}): MonthState {
  if (input.free) return "free";
  if (input.paidThisMonth) return "paid";
  if (input.enrolledLastMonth && !input.paidLastMonth) return "overdue";
  return "notPaid";
}

/** One state per enrolment. Every enrolment gets exactly one, so the counts add up. */
export function buildMonthStates(input: {
  enrolments: MonthEnrolment[];
  paidThisMonth: ReadonlySet<number>;
  paidLastMonth: ReadonlySet<number>;
}): Map<number, MonthState> {
  const out = new Map<number, MonthState>();
  for (const e of input.enrolments) {
    out.set(
      e.studentId,
      classifyMonth({
        free: e.free,
        paidThisMonth: input.paidThisMonth.has(e.studentId),
        enrolledLastMonth: e.enrolledLastMonth,
        paidLastMonth: input.paidLastMonth.has(e.studentId),
      }),
    );
  }
  return out;
}

export function tallyMonthStates(states: Iterable<MonthState>): MonthCounts {
  const counts: MonthCounts = { paid: 0, notPaid: 0, overdue: 0, free: 0 };
  for (const s of states) counts[s] += 1;
  return counts;
}

export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** A calendar month as a comparable integer, so "enrolled by last month" is `<=`. */
export const monthIndex = (year: number, month: number) => year * 12 + (month - 1);

// ---------------------------------------------------------------------------
// The class list order
// ---------------------------------------------------------------------------

export type RosterSortable = {
  name: string;
  present: boolean;
  /** "HH:mm" in Colombo, or null for someone who did not attend. */
  arrivedAt: string | null;
};

/**
 * Who came first, then who did not.
 *
 *   attended   earliest arrival first, ties by name
 *   absent     name A to Z
 *
 * "HH:mm" strings sort correctly as text because they are zero-padded 24-hour.
 */
export function sortRoster<T extends RosterSortable>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.present !== b.present) return a.present ? -1 : 1;
    if (a.present && b.present) {
      const byTime = (a.arrivedAt ?? "99:99").localeCompare(b.arrivedAt ?? "99:99");
      if (byTime !== 0) return byTime;
    }
    return a.name.localeCompare(b.name);
  });
}
