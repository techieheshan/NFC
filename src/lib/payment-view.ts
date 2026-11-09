import "server-only";

import type { PaymentPanel } from "@/app/(app)/payment/actions";
import { colomboNow, to12Hour } from "@/lib/colombo-time";
import { comboStates, type ComboState, type ComboWithState } from "@/lib/combos";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { BACK_MONTHS } from "@/lib/payment-months";
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
  /** How a PAID month was charged: null = the full fee, otherwise HALF or NO_CHARGE. */
  paidMode: "HALF" | "NO_CHARGE" | null;
  /** Classes attended that month. */
  attended: number;
  /** Unpaid AND before the current month — shown as "Owed". */
  owed: boolean;
  /**
   * Before the enrolment's own start month (at most BACK_MONTHS before the current month).
   * ABSENT on every other month, so a month from the enrolment start on is byte-identical to
   * what it always was. Such a month is never "owed" (arrears count from the enrolment start);
   * staff may still take it after a confirm, and `takePayment` is told with `backMonth`.
   */
  beforeStart?: true;
};

/**
 * What the card needs to show the combo, from the server's own state (`comboStates`) —
 * never decided on the screen. The staff switch is the screen's; the state is not.
 */
export type CourseComboInfo = {
  comboId: number;
  /** The combo's state with no staff switch applied. */
  state: ComboState;
  /** "Oct": the last completed month the check looked at. */
  monthWord: string;
  /** How many classes the combo has ("both" / "all"). */
  classCount: number;
  /** Classes the check is waiting on: 0 days last month, and not new. Meaningful for needs-confirmation. */
  zeroDayCourses: string[];
  /** THIS card's class began this month (no completed month): shown with a "New" chip. */
  thisClassIsNew: boolean;
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
  /**
   * Half of `monthly` / of `comboMonthly`, built here with the same arithmetic as the
   * server's Half month (`money(Number(full) * 0.5)`), so the screen only displays strings.
   * A parity test compares them with the real receipt for every tier and combo case.
   */
  halfMonthly: string | null;
  halfComboMonthly: string | null;
  combo: CourseComboInfo | null;
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
  /**
   * `chargedOn`: the Colombo date of the charge that stops a second one for the card's CURRENT
   * UID, or null. The same question the server asks when it refuses; the server stays the
   * authority (a forced request is refused), this only lets the screen say so first.
   */
  smartCard: PaymentPanel["smartCard"] & { chargedOn: string | null };
  /** Every combo the student qualifies for, with its state. */
  combos: ComboWithState[];
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

/** Half of a displayed price, exactly as the server's Half month computes it. */
const halfOf = (amount: string | null) => (amount === null ? null : (Number(amount) * 0.5).toFixed(2));

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

  const currentUid = panel.smartCard.currentUid;
  const [enrolments, arrears, settled, attendance, combos, priorCard] = await Promise.all([
    db.enrollment.findMany({
      where: { studentId, status: "ACTIVE", courseId: { in: courseIds } },
      select: { courseId: true, createdAt: true },
    }),
    studentArrears(studentId),
    db.payment.findMany({
      where: { ...SETTLED_PAYMENT_WHERE, studentId },
      select: { courseId: true, billingYear: true, billingMonth: true, paidAt: true, chargeMode: true },
      orderBy: { paidAt: "asc" },
    }),
    db.attendance.findMany({
      where: { studentId, courseId: { in: courseIds } },
      select: { courseId: true, date: true },
    }),
    comboStates(studentId),
    // Only a non-empty UID can be guarded; rows with no UID recorded never match one.
    currentUid
      ? db.payment.findFirst({
          where: { studentId, kind: "SMART_CARD", cancelled: false, cardUidIssued: currentUid },
          orderBy: { paidAt: "desc" },
          select: { paidAt: true },
        })
      : Promise.resolve(null),
  ]);

  const startOf = new Map(
    enrolments.map((e) => {
      const [y, m] = colomboNow(e.createdAt).date.split("-").map(Number);
      return [e.courseId, ordinal(y, m)] as const;
    }),
  );

  // First payment wins when a month was (wrongly) paid twice: the day it was first settled.
  const paidDayOf = new Map<string, number>();
  const paidModeOf = new Map<string, "HALF" | "NO_CHARGE" | null>();
  for (const p of settled) {
    if (p.courseId === null || p.billingYear === null || p.billingMonth === null) continue;
    const key = `${p.courseId}:${p.billingYear}:${p.billingMonth}`;
    if (!paidDayOf.has(key)) {
      paidDayOf.set(key, Number(colomboNow(p.paidAt).date.slice(8, 10)));
      paidModeOf.set(key, p.chargeMode);
    }
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
    // From BACK_MONTHS before the current month at the earliest, or the enrolment's own start when
    // that is earlier (a student enrolled long ago is unchanged). Months before the start are
    // flagged `beforeStart`; the server's `takePayment` applies the same BACK_MONTHS limit.
    for (let o = Math.min(start, here - BACK_MONTHS); o <= here + ahead; o++) {
      const { year, month } = fromOrdinal(o);
      const paidDay = paidDayOf.get(`${c.courseId}:${year}:${month}`);
      const state: ViewMonthState = paidDay !== undefined ? "paid" : o > here ? "ahead" : "unpaid";
      months.push({
        year,
        month,
        label: monthLabel(year, month),
        state,
        paidDay: paidDay ?? null,
        paidMode: paidModeOf.get(`${c.courseId}:${year}:${month}`) ?? null,
        attended: attendedIn.get(`${c.courseId}:${year}-${String(month).padStart(2, "0")}`) ?? 0,
        owed: state === "unpaid" && o < here && o >= start,
        ...(o < start ? { beforeStart: true as const } : {}),
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

    const inCombo = combos.find((x) => x.courseIds.includes(c.courseId));
    const facts = inCombo?.classes.find((x) => x.courseId === c.courseId);
    const combo: CourseComboInfo | null = inCombo
      ? {
          comboId: inCombo.comboId,
          state: inCombo.state,
          monthWord: inCombo.lastMonthLabel.split(" ")[0],
          classCount: inCombo.courseIds.length,
          zeroDayCourses: inCombo.classes
            .filter((x) => !x.isNew && !x.free && x.days === 0)
            .map((x) => inCombo.attendance.find((a) => a.courseId === x.courseId)?.course ?? ""),
          thisClassIsNew: facts?.isNew ?? false,
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
      halfMonthly: halfOf(c.monthly),
      halfComboMonthly: halfOf(c.comboMonthly),
      combo,
      cardMonth,
      paidThisMonth,
      months,
    };
  });

  return {
    student: panel.student,
    admission: panel.admission,
    smartCard: { ...panel.smartCard, chargedOn: priorCard ? colomboNow(priorCard.paidAt).date : null },
    combos,
    today: { year: cy, month: cm },
    ahead,
    lastAttended,
    courses,
  };
}

// ---------------------------------------------------------------------------
// Month detail (board 5)
// ---------------------------------------------------------------------------

/** One class the student actually attended. */
export type MonthDetailRow = {
  /** "2026-10-10" */
  date: string;
  /** "Sat" — read off the date itself. */
  weekday: string;
  /** "10:15 AM", the Colombo time the attendance was marked. */
  time: string;
};

/** Exactly what the month-detail pop-up displays, and nothing else. */
export type MonthDetail = {
  course: string;
  teacher: string;
  /** "Oct 2026" */
  label: string;
  /** The attended classes of that month, oldest first. */
  rows: MonthDetailRow[];
  attended: number;
  /** "2026-10-10" — the last class attended IN THIS MONTH, or null. */
  lastAttended: string | null;
};

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The attendance behind one month of one course, for the month-detail pop-up.
 *
 * ONLY classes the student actually attended — the Attendance rows themselves.
 * Nothing is derived from today's timetable: no "expected" class days, no absences
 * inferred from a schedule that has no history. A month with no attendance is simply
 * an empty list. The count agrees with the calendar's "N days" for the same month,
 * because both count the same rows.
 *
 * Returns null unless the student is actively enrolled in the course (the same
 * condition under which the screen offers the course at all).
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
      course: {
        select: {
          name: true,
          grade: { select: { label: true } },
          subject: { select: { label: true } },
          classType: { select: { label: true } },
          teacher: { select: { name: true } },
        },
      },
    },
  });
  if (!enrolment) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const range = {
    gte: new Date(`${year}-${pad(month)}-01T00:00:00.000Z`),
    lte: new Date(`${year}-${pad(month)}-${pad(daysInMonth)}T00:00:00.000Z`),
  };

  const attendance = await db.attendance.findMany({
    where: { studentId, courseId, date: range },
    select: { date: true, markedAt: true },
    orderBy: [{ date: "asc" }, { markedAt: "asc" }],
  });

  const rows: MonthDetailRow[] = attendance.map((a) => ({
    date: a.date.toISOString().slice(0, 10),
    weekday: WEEKDAY[a.date.getUTCDay()],
    time: to12Hour(colomboNow(a.markedAt).time),
  }));

  return {
    course: courseDisplayName(enrolment.course),
    teacher: enrolment.course.teacher.name,
    label: monthLabel(year, month),
    rows,
    attended: rows.length,
    lastAttended: rows.length ? rows[rows.length - 1].date : null,
  };
}
