import "server-only";

import type { PaymentPanel } from "@/app/(app)/payment/actions";
import { colomboNow, to12Hour } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { monthLabel } from "@/lib/receipts";
import { SETTLED_PAYMENT_WHERE, studentArrears } from "@/lib/student-arrears";

/**
 * Everything the NEW payment screens show that the existing panel does not.
 * Read-only: no writes, no money arithmetic.
 *
 * What it adds to `loadPanel` (prices, tiers, combo fees, admission and smart
 * card all still come from there, untouched):
 *   - the month a card charges  = the oldest unpaid month up to the current one,
 *     taken from `studentArrears` — the one "who owes what" rule (AGENTS 23);
 *   - for the calendar: every offered month from the enrolment's own start to
 *     the ahead limit, each paid (with the Colombo day it was paid), unpaid
 *     (with the days attended) or still ahead;
 *   - the last day each course was attended, for the combo pop-up.
 *
 * "Paid" is read through SETTLED_PAYMENT_WHERE, the same constant `studentArrears`
 * uses, so the card and the calendar cannot disagree; a test asserts it.
 */

/** paid · unpaid (this month or earlier) · ahead (still to come, may be paid early). */
export type ViewMonthState = "paid" | "unpaid" | "ahead";

export type ViewMonth = {
  year: number;
  month: number;
  /** "Nov 2026" */
  label: string;
  state: ViewMonthState;
  /** Day of the month it was paid, in Colombo time. Only for `paid`. */
  paidDay: number | null;
  /** Classes attended that month. */
  attended: number;
  /** Unpaid AND before the current month — shown as "Owed". */
  owed: boolean;
};

export type CourseCardData = {
  courseId: number;
  course: string;
  teacher: string;
  tierCode: string;
  tierLabel: string;
  free: boolean;
  /** `defaultFee × multiplier`, 2dp — straight from the existing panel. */
  monthly: string | null;
  /** `comboFee × multiplier` when the course qualifies for a combo. */
  comboMonthly: string | null;
  comboId: number | null;
  /** What tapping the card charges: the oldest unpaid month up to now. null when nothing is owed. */
  cardMonth: ViewMonth | null;
  /** Set when nothing is owed up to now: the current month is settled. */
  paidThisMonth: { label: string; paidDay: number | null; paidLabel: string } | null;
  /** Every offered month, oldest first: enrolment start .. current + ahead limit. */
  months: ViewMonth[];
};

export type PaymentView = {
  student: PaymentPanel["student"];
  admission: PaymentPanel["admission"];
  smartCard: PaymentPanel["smartCard"];
  combos: PaymentPanel["combos"];
  /** The current Colombo month. */
  today: { year: number; month: number };
  /** How many months ahead may be paid — read from the existing panel, never restated here. */
  ahead: number;
  /** Most recent class attended, by course, as "2026-10-24" (null = never). */
  lastAttended: Record<number, string | null>;
  courses: CourseCardData[];
};

const ordinal = (year: number, month: number) => year * 12 + (month - 1);
const fromOrdinal = (o: number) => ({ year: Math.floor(o / 12), month: (o % 12) + 1 });
const ym = (date: Date) => date.toISOString().slice(0, 7); // a @db.Date is stored as UTC midnight

const SHORT_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function buildPaymentView(panel: PaymentPanel): Promise<PaymentView> {
  const studentId = panel.student.id;
  const now = colomboNow();
  const [cy, cm] = now.date.split("-").map(Number);
  const here = ordinal(cy, cm);

  // The ahead limit is the panel's own: however many future months it offers.
  const ahead = panel.courses.reduce(
    (max, c) => Math.max(max, c.months.filter((m) => m.kind === "future").length),
    0,
  );

  const courseIds = panel.courses.map((c) => c.courseId);

  const [enrolments, arrears, settled, attendance] = await Promise.all([
    db.enrollment.findMany({
      where: { studentId, status: "ACTIVE", courseId: { in: courseIds } },
      select: { courseId: true, createdAt: true },
    }),
    studentArrears(studentId),
    db.payment.findMany({
      where: { ...SETTLED_PAYMENT_WHERE, studentId },
      select: { courseId: true, billingYear: true, billingMonth: true, paidAt: true },
      orderBy: { paidAt: "asc" },
    }),
    db.attendance.findMany({
      where: { studentId, courseId: { in: courseIds } },
      select: { courseId: true, date: true },
    }),
  ]);

  const startOf = new Map(
    enrolments.map((e) => {
      const [y, m] = colomboNow(e.createdAt).date.split("-").map(Number);
      return [e.courseId, ordinal(y, m)] as const;
    }),
  );

  // First payment wins when a month was (wrongly) paid twice: the day it was first settled.
  const paidDayOf = new Map<string, number>();
  for (const p of settled) {
    if (p.courseId === null || p.billingYear === null || p.billingMonth === null) continue;
    const key = `${p.courseId}:${p.billingYear}:${p.billingMonth}`;
    if (!paidDayOf.has(key)) paidDayOf.set(key, Number(colomboNow(p.paidAt).date.slice(8, 10)));
  }

  const attendedIn = new Map<string, number>();
  const lastAttended: Record<number, string | null> = Object.fromEntries(courseIds.map((id) => [id, null]));
  for (const a of attendance) {
    const key = `${a.courseId}:${ym(a.date)}`;
    attendedIn.set(key, (attendedIn.get(key) ?? 0) + 1);
    const day = a.date.toISOString().slice(0, 10);
    const prev = lastAttended[a.courseId];
    if (!prev || day > prev) lastAttended[a.courseId] = day;
  }

  const owedByCourse = new Map(arrears.courses.map((c) => [c.courseId, c.owed]));

  const courses: CourseCardData[] = panel.courses.map((c) => {
    const start = startOf.get(c.courseId) ?? here;
    const months: ViewMonth[] = [];
    for (let o = start; o <= here + ahead; o++) {
      const { year, month } = fromOrdinal(o);
      const paidDay = paidDayOf.get(`${c.courseId}:${year}:${month}`);
      const state: ViewMonthState = paidDay !== undefined ? "paid" : o > here ? "ahead" : "unpaid";
      months.push({
        year,
        month,
        label: monthLabel(year, month),
        state,
        paidDay: paidDay ?? null,
        attended: attendedIn.get(`${c.courseId}:${year}-${String(month).padStart(2, "0")}`) ?? 0,
        owed: state === "unpaid" && o < here,
      });
    }

    const oldestOwed = c.free ? undefined : owedByCourse.get(c.courseId)?.[0];
    const cardMonth = oldestOwed
      ? (months.find((m) => m.year === oldestOwed.year && m.month === oldestOwed.month) ?? null)
      : null;

    const current = months.find((m) => m.year === cy && m.month === cm);
    const paidThisMonth =
      !c.free && !cardMonth && current?.state === "paid"
        ? {
            label: current.label,
            paidDay: current.paidDay,
            paidLabel:
              current.paidDay !== null
                ? `${String(current.paidDay).padStart(2, "0")} ${SHORT_MONTH[current.month - 1]}`
                : "",
          }
        : null;

    return {
      courseId: c.courseId,
      course: c.course,
      teacher: c.teacher,
      tierCode: c.tierCode,
      tierLabel: c.tierLabel,
      free: c.free,
      monthly: c.monthly,
      comboMonthly: c.comboMonthly,
      comboId: c.comboId,
      cardMonth,
      paidThisMonth,
      months,
    };
  });

  return {
    student: panel.student,
    admission: panel.admission,
    smartCard: panel.smartCard,
    combos: panel.combos,
    today: { year: cy, month: cm },
    ahead,
    lastAttended,
    courses,
  };
}

// ---------------------------------------------------------------------------
// Month detail (board 5)
// ---------------------------------------------------------------------------

export type MonthDetailRow = {
  /** "2026-10-03" */
  date: string;
  /** "Sat" */
  weekday: string;
  /** present · absent · today (class day, not yet attended) · upcoming (later this month) */
  status: "present" | "absent" | "today" | "upcoming";
  /** "10:15 AM" when present. */
  time: string | null;
  /** True for a one-off class, or an attended day that is not on the timetable. */
  extra: boolean;
};

export type MonthDetail = {
  courseId: number;
  course: string;
  teacher: string;
  year: number;
  month: number;
  label: string;
  rows: MonthDetailRow[];
  attended: number;
  /** Classes held so far: counted rows that are present or absent. */
  held: number;
  /** "2026-10-10" — the last class attended IN THIS MONTH, or null. */
  lastAttended: string | null;
};

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The attendance behind one month of one course, for the month-detail pop-up.
 *
 * Expected class days come from the course's ACTIVE weekly schedule plus any
 * one-off additional class that month. The timetable has no history, so a past
 * month is read against TODAY's timetable — a limit worth knowing. Days before
 * the student enrolled are not expected; a class attended on an unscheduled day
 * is still listed (as an extra) rather than hidden.
 */
export async function buildMonthDetail(input: {
  studentId: number;
  courseId: number;
  year: number;
  month: number;
}): Promise<MonthDetail | null> {
  const { studentId, courseId, year, month } = input;

  const enrolment = await db.enrollment.findFirst({
    where: { studentId, courseId, status: "ACTIVE" },
    select: {
      createdAt: true,
      course: { select: { name: true, grade: { select: { label: true } }, subject: { select: { label: true } }, classType: { select: { label: true } }, teacher: { select: { name: true } } } },
    },
  });
  if (!enrolment) return null;

  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
  const range = { gte: new Date(`${first}T00:00:00.000Z`), lte: new Date(`${last}T00:00:00.000Z`) };

  const [schedules, additional, attendance] = await Promise.all([
    db.schedule.findMany({ where: { courseId, active: true }, select: { dayOfWeek: true } }),
    db.additionalClass.findMany({ where: { courseId, date: range }, select: { date: true } }),
    db.attendance.findMany({
      where: { studentId, courseId, date: range },
      select: { date: true, markedAt: true },
      orderBy: { date: "asc" },
    }),
  ]);

  const today = colomboNow().date;
  const enrolledOn = colomboNow(enrolment.createdAt).date;
  const weekdays = new Set(schedules.map((s) => s.dayOfWeek as string));
  const oneOff = new Set(additional.map((a) => a.date.toISOString().slice(0, 10)));
  const attendedAt = new Map(attendance.map((a) => [a.date.toISOString().slice(0, 10), a.markedAt]));

  const dates = new Set<string>();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dow = DOW[new Date(`${date}T00:00:00.000Z`).getUTCDay()];
    const scheduled = weekdays.has(dow) || oneOff.has(date);
    if (scheduled && date >= enrolledOn) dates.add(date);
  }
  for (const date of attendedAt.keys()) dates.add(date); // never hide a class that was attended

  const rows: MonthDetailRow[] = [...dates].sort().map((date) => {
    const marked = attendedAt.get(date);
    const scheduledDay = weekdays.has(DOW[new Date(`${date}T00:00:00.000Z`).getUTCDay()]) || oneOff.has(date);
    return {
      date,
      weekday: WEEKDAY[new Date(`${date}T00:00:00.000Z`).getUTCDay()],
      status: marked ? "present" : date > today ? "upcoming" : date === today ? "today" : "absent",
      time: marked ? to12Hour(colomboNow(marked).time) : null,
      extra: oneOff.has(date) || !scheduledDay,
    };
  });

  const attended = rows.filter((r) => r.status === "present").length;
  const held = rows.filter((r) => r.status === "present" || r.status === "absent").length;
  const lastRow = [...rows].reverse().find((r) => r.status === "present");

  const c = enrolment.course;
  return {
    courseId,
    course: courseDisplayName(c),
    teacher: c.teacher.name,
    year,
    month,
    label: monthLabel(year, month),
    rows,
    attended,
    held,
    lastAttended: lastRow?.date ?? null,
  };
}
