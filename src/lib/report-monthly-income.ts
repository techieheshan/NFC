import "server-only";

import { colomboNow, colomboRangeUtc } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";

/**
 * What the institute actually collected in a month, sliced.
 *
 * Income is by `paidAt` — cash received in the month — which is the Daily
 * Summary question, deliberately NOT the billing-month question the arrears
 * colour and the not-paid list answer. A July fee taken in August is August
 * income here and clears July there; both are right.
 *
 * "By teacher" is GROSS collected on that teacher's courses, not their share.
 * The split is the Payslips report's job; mixing the two here would give two
 * different answers to "what did this teacher bring in".
 */

export type DayRow = { date: string; label: string; total: string };
export type TeacherRow = { teacherId: number; teacher: string; total: string };
export type CourseRow = { courseId: number; course: string; teacher: string; total: string };
export type MatrixRow = { teacherId: number; teacher: string; byDay: string[]; total: string };

export type MonthlyIncome = {
  year: number;
  month: number;
  label: string;
  /** Every day of the month, including the empty ones — a gap is information. */
  days: DayRow[];
  classTotal: string;
  admission: { count: number; total: string };
  smartCard: { count: number; total: string };
  total: string;
  byTeacher: TeacherRow[];
  byCourse: CourseRow[];
  matrix: MatrixRow[];
  /**
   * Class fees on a payment with no course (legacy rows). They are in the month
   * total but in no teacher's or course's column, so the screen says so rather
   * than letting the breakdowns quietly come up short.
   */
  unattributed: string;
  /** True when the slices add back up to the month total. */
  reconciles: boolean;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const money = (n: number) => n.toFixed(2);

export function currentColomboMonth() {
  const [year, month] = colomboNow().date.split("-").map(Number);
  return { year, month };
}

export async function buildMonthlyIncome(year: number, month: number): Promise<MonthlyIncome> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const daysInMonth = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 0)).getUTCDate();
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(daysInMonth)}`;

  const rows = await db.payment.findMany({
    where: { cancelled: false, paidAt: colomboRangeUtc(from, to) },
    select: {
      kind: true,
      amount: true,
      paidAt: true,
      course: {
        select: {
          id: true, name: true,
          grade: { select: { label: true } },
          subject: { select: { label: true } },
          classType: { select: { label: true } },
          teacher: { select: { id: true, name: true } },
        },
      },
    },
  });

  const dayTotals = new Map<string, number>();
  const teacherTotals = new Map<number, { name: string; total: number }>();
  const courseTotals = new Map<number, { course: string; teacher: string; total: number }>();
  const matrix = new Map<number, { name: string; days: Map<string, number> }>();

  let classTotal = 0;
  let admissionTotal = 0, admissionCount = 0;
  let smartTotal = 0, smartCount = 0;
  let unattributed = 0;

  for (const r of rows) {
    const amount = Number(String(r.amount));
    // The Colombo calendar day the cash landed on.
    const day = colomboNow(r.paidAt).date;
    dayTotals.set(day, (dayTotals.get(day) ?? 0) + amount);

    if (r.kind === "ADMISSION") { admissionTotal += amount; admissionCount++; continue; }
    if (r.kind === "SMART_CARD") { smartTotal += amount; smartCount++; continue; }

    classTotal += amount;
    if (!r.course) { unattributed += amount; continue; }

    const t = r.course.teacher;
    const name = courseDisplayName(r.course);
    teacherTotals.set(t.id, { name: t.name, total: (teacherTotals.get(t.id)?.total ?? 0) + amount });
    courseTotals.set(r.course.id, {
      course: name,
      teacher: t.name,
      total: (courseTotals.get(r.course.id)?.total ?? 0) + amount,
    });
    const m = matrix.get(t.id) ?? { name: t.name, days: new Map<string, number>() };
    m.days.set(day, (m.days.get(day) ?? 0) + amount);
    matrix.set(t.id, m);
  }

  const dayKeys = Array.from({ length: daysInMonth }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);
  const days: DayRow[] = dayKeys.map((date) => ({
    date,
    label: String(Number(date.slice(8))),
    total: money(dayTotals.get(date) ?? 0),
  }));

  const total = classTotal + admissionTotal + smartTotal;
  const daySum = [...dayTotals.values()].reduce((a, b) => a + b, 0);

  return {
    year, month,
    label: `${MONTHS[month - 1]} ${year}`,
    days,
    classTotal: money(classTotal),
    admission: { count: admissionCount, total: money(admissionTotal) },
    smartCard: { count: smartCount, total: money(smartTotal) },
    total: money(total),
    unattributed: money(unattributed),
    byTeacher: [...teacherTotals]
      .map(([teacherId, v]) => ({ teacherId, teacher: v.name, total: money(v.total) }))
      .sort((a, b) => Number(b.total) - Number(a.total)),
    byCourse: [...courseTotals]
      .map(([courseId, v]) => ({ courseId, course: v.course, teacher: v.teacher, total: money(v.total) }))
      .sort((a, b) => Number(b.total) - Number(a.total)),
    matrix: [...matrix]
      .map(([teacherId, v]) => ({
        teacherId,
        teacher: v.name,
        byDay: dayKeys.map((d) => money(v.days.get(d) ?? 0)),
        total: money([...v.days.values()].reduce((a, b) => a + b, 0)),
      }))
      .sort((a, b) => Number(b.total) - Number(a.total)),
    // Day totals cover every kind, so they must equal the month total exactly.
    reconciles: Math.abs(daySum - total) < 0.005,
  };
}
