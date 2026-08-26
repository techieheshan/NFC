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
 * Which combos this student qualifies for — at most one per teacher.
 *
 * When several qualify for the same teacher (a 2-way and a 3-way both matching),
 * the fullest set wins, so a student enrolled in all three is offered the 3-way.
 * Ties break on the lower combo id purely so the result is deterministic.
 */
export async function applicableCombos(studentId: number): Promise<ApplicableCombo[]> {
  const enrolments = await db.enrollment.findMany({
    where: { studentId, status: "ACTIVE" },
    select: { courseId: true, course: { select: { teacherId: true } } },
  });
  if (enrolments.length === 0) return [];

  const enrolledCourseIds = new Set(enrolments.map((e) => e.courseId));
  const teacherIds = [...new Set(enrolments.map((e) => e.course.teacherId))];

  const combos = await db.combo.findMany({
    where: { active: true, teacherId: { in: teacherIds } },
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

  const bestByTeacher = new Map<number, (typeof qualifying)[number]>();
  for (const combo of qualifying) {
    const current = bestByTeacher.get(combo.teacherId);
    if (
      !current ||
      combo.items.length > current.items.length ||
      (combo.items.length === current.items.length && combo.id < current.id)
    ) {
      bestByTeacher.set(combo.teacherId, combo);
    }
  }

  const chosen = [...bestByTeacher.values()];
  if (chosen.length === 0) return [];

  const window = lastCompletedMonth();
  const range = monthRange(window.year, window.month);

  return Promise.all(
    chosen.map(async (combo) => {
      const attendance = await Promise.all(
        combo.items.map(async (item) => ({
          courseId: item.courseId,
          course: courseDisplayName(item.course),
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
