import "server-only";

import { colomboDateValue, colomboNow } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";

/**
 * Combined payment — eligibility and the evidence behind the fraud check.
 *
 * Eligibility is based on ENROLMENT, not on what staff tick to pay: a student
 * qualifies for a combo when they are actively enrolled in every course of it.
 * That means they can pay one combo course alone and still get its combo rate.
 */

export type ComboCourse = {
  courseId: number;
  course: string;
  /** Combo price for this course, before the fee tier is applied. */
  comboFee: string;
  /** Normal price, shown so staff can see the discount. */
  defaultFee: string;
};

export type ComboAttendance = {
  courseId: number;
  course: string;
  /** Named per course: a combo can span teachers, so "5 days" needs an owner. */
  teacher: string;
  days: number;
};

export type ApplicableCombo = {
  comboId: number;
  name: string;
  teacher: string;
  courseIds: number[];
  items: ComboCourse[];
  /** Last COMPLETED month, e.g. "Jul 2026" — the fraud-check window. */
  lastMonthLabel: string;
  attendance: ComboAttendance[];
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * The last *completed* month in Colombo. August's payment is judged on July's
 * attendance — the current month is still in progress and would understate it.
 */
export function lastCompletedMonth(at: Date = new Date()) {
  const [y, m] = colomboNow(at).date.split("-").map(Number);
  const year = m === 1 ? y - 1 : y;
  const month = m === 1 ? 12 : m - 1;
  return { year, month, label: `${MONTH_NAMES[month - 1]} ${year}` };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Half-open [first of month, first of next month) over the `@db.Date` column. */
function monthRange(year: number, month: number) {
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  return {
    gte: colomboDateValue(`${year}-${pad(month)}-01`),
    lt: colomboDateValue(`${nextY}-${pad(nextM)}-01`),
  };
}

const courseSelect = {
  id: true,
  name: true,
  defaultFee: true,
  teacher: { select: { name: true } },
  subject: { select: { label: true } },
  grade: { select: { label: true } },
  classType: { select: { label: true } },
} as const;

/**
 * Which combos this student qualifies for, without offering the same course
 * twice.
 *
 * This used to pick one combo per teacher, which stopped working once a combo
 * could span teachers. The rule it was really enforcing is that no course may
 * be priced by two combos at once — so that is what it now says: fullest set
 * first, then skip any combo overlapping one already taken. Ties break on the
 * lower combo id purely so the result is deterministic.
 */
export async function applicableCombos(studentId: number, at: Date = new Date()): Promise<ApplicableCombo[]> {
  const enrolments = await db.enrollment.findMany({
    where: { studentId, status: "ACTIVE" },
    select: { courseId: true, course: { select: { teacherId: true } } },
  });
  if (enrolments.length === 0) return [];

  const enrolledCourseIds = new Set(enrolments.map((e) => e.courseId));
  // Not narrowed by teacher: a combo may span them, so the enrolment check
  // below is the only thing that decides eligibility.
  const combos = await db.combo.findMany({
    where: { active: true, items: { some: { courseId: { in: [...enrolledCourseIds] } } } },
    include: {
      teacher: { select: { name: true } },
      items: { include: { course: { select: courseSelect } } },
    },
  });

  // Qualifies only when EVERY course of the combo is actively enrolled.
  const qualifying = combos.filter(
    (c) =>
      c.items.length > 0 && c.items.every((i) => enrolledCourseIds.has(i.courseId)),
  );

  const ranked = [...qualifying].sort(
    (a, b) => b.items.length - a.items.length || a.id - b.id,
  );
  const taken = new Set<number>();
  const chosen: typeof qualifying = [];
  for (const combo of ranked) {
    if (combo.items.some((i) => taken.has(i.courseId))) continue;
    for (const i of combo.items) taken.add(i.courseId);
    chosen.push(combo);
  }

  if (chosen.length === 0) return [];

  const window = lastCompletedMonth(at);
  const range = monthRange(window.year, window.month);

  return Promise.all(
    chosen.map(async (combo) => {
      const attendance = await Promise.all(
        combo.items.map(async (item) => ({
          courseId: item.courseId,
          course: courseDisplayName(item.course),
          teacher: item.course.teacher.name,
          days: await db.attendance.count({
            where: { studentId, courseId: item.courseId, date: range },
          }),
        })),
      );

      return {
        comboId: combo.id,
        name: combo.name,
        teacher: combo.teacher.name,
        courseIds: combo.items.map((i) => i.courseId),
        items: combo.items.map((i) => ({
          courseId: i.courseId,
          course: courseDisplayName(i.course),
          comboFee: Number(String(i.comboFee)).toFixed(2),
          defaultFee: Number(String(i.course.defaultFee)).toFixed(2),
        })),
        lastMonthLabel: window.label,
        attendance,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Combo state — does this combo need a human, or does it simply apply?
// ---------------------------------------------------------------------------

/**
 * A combo is a discount for a student who attends BOTH classes. The check exists only to
 * catch a student who did NOT attend one of them, so it looks at the last completed month
 * (the same window as above) and asks a person only when a class has 0 days.
 *
 *   off                 staff switched this combo off: normal rate, no reason needed
 *   exempt-free         one class is a FREE enrolment: the combo applies, no check at all
 *   needs-confirmation  a class that existed last month has 0 days: a person decides
 *   exempt-new          a class began THIS month, so there is no completed month to check
 *   auto                every class that can be checked was attended at least once
 *
 * Evaluated top to bottom, first match wins. "New" means the enrolment's Colombo start
 * month is later than the last completed month — so the exemption ends at the Colombo
 * midnight that starts the month AFTER the one the class began in.
 *
 * Which classes the student is paying for right now does not matter: the state belongs to
 * the combo, and the combo rate goes to whichever of its classes is being charged.
 */
export type ComboState = "auto" | "needs-confirmation" | "exempt-new" | "exempt-free" | "off";

export type ComboClassFacts = {
  courseId: number;
  /** A FREE-tier enrolment (multiplier 0). */
  free: boolean;
  /** The enrolment began in the current month (or later): there is no completed month for it. */
  isNew: boolean;
  /** Days attended in the last completed month. */
  days: number;
};

/** The rule table. Pure: no clock, no database. */
export function comboStateOf(classes: readonly ComboClassFacts[], switchedOff = false): ComboState {
  if (switchedOff) return "off";
  if (classes.some((c) => c.free)) return "exempt-free";
  if (classes.some((c) => !c.isNew && c.days === 0)) return "needs-confirmation";
  if (classes.some((c) => c.isNew)) return "exempt-new";
  return "auto";
}

export type ComboWithState = ApplicableCombo & {
  state: ComboState;
  /** The facts the state was decided from, per class, in combo order. */
  classes: ComboClassFacts[];
};

const monthOrdinal = (year: number, month: number) => year * 12 + (month - 1);

/**
 * Every combo this student qualifies for (same selection as `applicableCombos`: fullest set
 * first, lowest id on a tie, no course priced twice), each with its state.
 *
 * `switchedOff` holds the ids of combos staff switched off for this payment. `at` is the
 * one instant everything is judged at.
 */
export async function comboStates(
  studentId: number,
  opts: { switchedOff?: ReadonlySet<number>; at?: Date } = {},
): Promise<ComboWithState[]> {
  const at = opts.at ?? new Date();
  const combos = await applicableCombos(studentId, at);
  if (combos.length === 0) return [];

  const last = lastCompletedMonth(at);
  const lastOrdinal = monthOrdinal(last.year, last.month);

  const enrolments = await db.enrollment.findMany({
    where: { studentId, status: "ACTIVE", courseId: { in: combos.flatMap((c) => c.courseIds) } },
    select: { courseId: true, createdAt: true, feeTier: { select: { multiplier: true } } },
  });
  const byCourse = new Map(enrolments.map((e) => [e.courseId, e]));

  return combos.map((combo) => {
    const classes: ComboClassFacts[] = combo.courseIds.map((courseId) => {
      const e = byCourse.get(courseId);
      const [y, m] = e ? colomboNow(e.createdAt).date.split("-").map(Number) : [0, 0];
      return {
        courseId,
        free: e ? Number(String(e.feeTier.multiplier)) === 0 : false,
        isNew: e ? monthOrdinal(y, m) > lastOrdinal : false,
        days: combo.attendance.find((a) => a.courseId === courseId)?.days ?? 0,
      };
    });
    return { ...combo, classes, state: comboStateOf(classes, opts.switchedOff?.has(combo.comboId)) };
  });
}
