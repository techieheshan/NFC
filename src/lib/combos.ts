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
export async function applicableCombos(studentId: number): Promise<ApplicableCombo[]> {
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

  const window = lastCompletedMonth();
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
