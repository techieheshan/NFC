import "server-only";

import type { UserRole } from "@prisma/client";

import {
  colomboDateValue,
  colomboNextDay,
  colomboNow,
  colomboRangeUtc,
} from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { courseMonthStates } from "@/lib/student-arrears";
import { sortRoster, tallyMonthStates, type MonthCounts, type MonthState } from "@/lib/month-status";

/**
 * Read-only reporting. Two rules run through everything here:
 *
 *   • Cancelled payments never count — not in a total, not in a "paid" tally.
 *   • Money is attributed by `paidAt` (when it was actually received), not by
 *     billing month, so a late payment for July shows in the day it came in.
 */

const money = (n: number) => n.toFixed(2);
const num = (v: unknown) => Number(String(v));

const courseSelect = {
  id: true,
  name: true,
  teacherId: true,
  teacher: { select: { name: true } },
  subject: { select: { label: true } },
  grade: { select: { label: true } },
  classType: { select: { label: true } },
} as const;

// ---------------------------------------------------------------------------
// Teacher scoping
// ---------------------------------------------------------------------------

/**
 * The Teacher a login belongs to, or null.
 *
 * Resolved from the database rather than the session, so widening a teacher's
 * view would take a real data change — not a forged token claim.
 */
export async function teacherIdForUser(userId: string): Promise<number | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { teacherId: true },
  });
  return user?.teacherId ?? null;
}

/**
 * Course filter for the current viewer. ADMIN and STAFF see everything; a
 * TEACHER is narrowed to courses they teach. A teacher login with no Teacher
 * attached sees nothing, which is the safe direction to fail.
 */
export async function courseScopeFor(user: {
  id: string;
  role: UserRole;
}): Promise<{ teacherId: number } | Record<string, never> | null> {
  if (user.role !== "TEACHER") return {};
  const teacherId = await teacherIdForUser(user.id);
  return teacherId === null ? null : { teacherId };
}

// ---------------------------------------------------------------------------
// Report A — Daily Summary
// ---------------------------------------------------------------------------

export type SummaryCourseRow = {
  courseId: number;
  course: string;
  teacher: string;
  registered: number;
  paidFull: number;
  paidHalf: number;
  paidQuarter: number;
  /** Registered − free − distinct non-free students who paid in range. */
  notPaid: number;
  free: number;
  amount: string;
  /** True when registered === paid + notPaid + free. */
  reconciles: boolean;
};

export type DailySummary = {
  from: string;
  to: string;
  courses: SummaryCourseRow[];
  admission: { count: number; total: string };
  smartCard: { count: number; total: string };
  classTotal: string;
  totalCollected: string;
  deductions: {
    teacherAdvances: string;
    xenonExpenses: string;
    total: string;
  };
  /** Every deduction, itemised: what it was for and who authorised it. */
  deductionLines: {
    date: string;
    kind: "TEACHER_ADVANCE" | "XENON";
    person: string | null;
    reason: string;
    authorizedBy: string;
    isStaffAdvance: boolean;
    amount: string;
  }[];
  net: string;
};

export async function dailySummary(from: string, to: string): Promise<DailySummary> {
  const range = colomboRangeUtc(from, to);

  const [payments, tiers, expenses] = await Promise.all([
    db.payment.findMany({
      where: { cancelled: false, paidAt: range },
      select: {
        kind: true,
        amount: true,
        studentId: true,
        courseId: true,
        feeTierId: true,
      },
    }),
    db.feeTier.findMany({ select: { id: true, code: true, multiplier: true } }),
    db.expense.findMany({
      where: {
        date: { gte: colomboDateValue(from), lt: colomboDateValue(colomboNextDay(to)) },
      },
      select: {
        amount: true,
        reason: true,
        date: true,
        type: { select: { code: true } },
        isStaffAdvance: true,
        teacher: { select: { name: true } },
        staff: { select: { name: true } },
        // Money leaves on someone's say-so, and the day's book says whose.
        authorizedBy: { select: { username: true, staff: { select: { name: true } } } },
      },
    }),
  ]);

  const tierCode = new Map(tiers.map((t) => [t.id, t.code]));
  const freeTierIds = new Set(tiers.filter((t) => num(t.multiplier) === 0).map((t) => t.id));

  const classPayments = payments.filter((p) => p.kind === "CLASS" && p.courseId !== null);

  // Only courses that are active OR took money in the range are worth a row.
  const paidCourseIds = [...new Set(classPayments.map((p) => p.courseId!))];
  const courses = await db.course.findMany({
    where: { OR: [{ active: true }, { id: { in: paidCourseIds } }] },
    select: courseSelect,
    orderBy: { id: "asc" },
  });

  const enrolments = await db.enrollment.findMany({
    where: { status: "ACTIVE", courseId: { in: courses.map((c) => c.id) } },
    select: { courseId: true, studentId: true, feeTierId: true },
  });

  const rows: SummaryCourseRow[] = courses.map((course) => {
    const mine = enrolments.filter((e) => e.courseId === course.id);
    const registered = mine.length;
    const free = mine.filter((e) => freeTierIds.has(e.feeTierId)).length;

    const paidHere = classPayments.filter((p) => p.courseId === course.id);

    // Distinct students per tier — paying two months in range counts once.
    const seen = { FULL: new Set<number>(), HALF: new Set<number>(), QUARTER: new Set<number>() };
    const anyNonFree = new Set<number>();
    let amount = 0;

    for (const p of paidHere) {
      amount += num(p.amount);
      if (p.feeTierId !== null && freeTierIds.has(p.feeTierId)) continue;
      anyNonFree.add(p.studentId);
      const code = p.feeTierId !== null ? tierCode.get(p.feeTierId) : undefined;
      if (code === "FULL" || code === "HALF" || code === "QUARTER") {
        seen[code].add(p.studentId);
      }
    }

    const notPaid = Math.max(0, registered - free - anyNonFree.size);
    const paidTotal = seen.FULL.size + seen.HALF.size + seen.QUARTER.size;

    return {
      courseId: course.id,
      course: courseDisplayName(course),
      teacher: course.teacher.name,
      registered,
      paidFull: seen.FULL.size,
      paidHalf: seen.HALF.size,
      paidQuarter: seen.QUARTER.size,
      notPaid,
      free,
      amount: money(amount),
      // Only exact when every payer holds one of the three named tiers; a
      // custom tier would show here rather than being silently absorbed.
      reconciles: registered === paidTotal + notPaid + free,
    };
  });

  const sumKind = (kind: "ADMISSION" | "SMART_CARD") => {
    const rows = payments.filter((p) => p.kind === kind);
    return { count: rows.length, total: money(rows.reduce((s, p) => s + num(p.amount), 0)) };
  };

  const classTotal = classPayments.reduce((s, p) => s + num(p.amount), 0);
  const admission = sumKind("ADMISSION");
  const smartCard = sumKind("SMART_CARD");
  const totalCollected = classTotal + Number(admission.total) + Number(smartCard.total);

  const advances = expenses
    .filter((e) => e.type.code === "TEACHER_ADVANCE")
    .reduce((s, e) => s + num(e.amount), 0);
  // Staff advances live inside XENON and are already in this sum — counted once.
  const xenon = expenses
    .filter((e) => e.type.code === "XENON")
    .reduce((s, e) => s + num(e.amount), 0);

  return {
    from,
    to,
    courses: rows,
    admission,
    smartCard,
    classTotal: money(classTotal),
    totalCollected: money(totalCollected),
    deductionLines: expenses
      .map((e) => ({
        date: e.date.toISOString().slice(0, 10),
        kind: e.type.code as "TEACHER_ADVANCE" | "XENON",
        person: e.teacher?.name ?? e.staff?.name ?? null,
        reason: e.reason,
        authorizedBy: e.authorizedBy.staff?.name ?? e.authorizedBy.username,
        isStaffAdvance: e.isStaffAdvance,
        amount: money(num(e.amount)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind)),
    deductions: {
      teacherAdvances: money(advances),
      xenonExpenses: money(xenon),
      total: money(advances + xenon),
    },
    net: money(totalCollected - advances - xenon),
  };
}

// ---------------------------------------------------------------------------
// Report B — Daily Attendance
// ---------------------------------------------------------------------------

export type AttendanceCourseRow = {
  courseId: number;
  course: string;
  teacher: string;
  /** Why this course appears on the selected day. */
  sessions: ("regular" | "additional")[];
  attended: number;
  absent: number;
  total: number;
  /**
   * LEGACY fields, kept with their old meaning so a terminal still running the
   * previous cached app keeps working against this server: `notPaid` is every
   * unpaid non-free student (the new `overdue` is a subset of it).
   */
  paid: number;
  notPaid: number;
  free: number;
  monthLabel: string;
  reconciles: boolean;
  /**
   * The four states for the selected month, which add up to `total`:
   * paid + notPaid (this month only) + overdue (last month unpaid too) + free.
   */
  states: MonthCounts;
  statesReconcile: boolean;
};

export type DailyAttendance = {
  date: string;
  dayLabel: string;
  monthLabel: string;
  scoped: boolean;
  courses: AttendanceCourseRow[];
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ---------------------------------------------------------------------------
// Report B2 — one class, student by student
// ---------------------------------------------------------------------------

export type ClassStudentRow = {
  studentId: number;
  name: string;
  cardNumber: string | null;
  photoUrl: string | null;
  /** Was this student marked in THIS class on THIS date. */
  present: boolean;
  /** "HH:mm" Colombo of the first mark that day, or null if they did not come. */
  arrivedAt: string | null;
  /** This course, this month: paid / notPaid / overdue / free. */
  monthState: MonthState;
};

export type ClassAttendanceDetail = {
  date: string;
  courseId: number;
  course: string;
  teacher: string;
  /** Null when the course is not one this viewer may see. */
  found: boolean;
  present: number;
  absent: number;
  /** "Oct 2026": the billing month the payment states are about. */
  monthLabel: string;
  counts: MonthCounts;
  students: ClassStudentRow[];
};

/**
 * One class on one day: who is enrolled, who turned up, and who owes.
 *
 * Nothing is recalculated. The mark is the same `Attendance` row the counter
 * writes, and the payment state is `courseMonthStates` — the SAME function the
 * Daily Attendance cards count with, so the four boxes on the card and the chips
 * on this list can never disagree. Attended students come first, earliest
 * arrival first; then the absent, A to Z.
 *
 * The viewer's scope is part of the WHERE, so a teacher asking for someone
 * else's course gets "not found" rather than someone else's roster.
 */
export async function classAttendanceDetail(
  courseId: number,
  date: string,
  scope: { teacherId: number } | Record<string, never> | null,
): Promise<ClassAttendanceDetail> {
  const [year, month] = date.split("-").map(Number);
  const monthLabel = `${MONTHS[month - 1]} ${year}`;
  const empty = {
    date, courseId, course: "", teacher: "", found: false,
    present: 0, absent: 0, monthLabel,
    counts: { paid: 0, notPaid: 0, overdue: 0, free: 0 } as MonthCounts,
    students: [] as ClassStudentRow[],
  };
  if (scope === null) return empty;

  const course = await db.course.findFirst({
    where: { id: courseId, ...scope },
    select: courseSelect,
  });
  if (!course) return empty;

  const dayValue = colomboDateValue(date);
  const [enrolments, marks, states] = await Promise.all([
    db.enrollment.findMany({
      where: { courseId, status: "ACTIVE" },
      select: {
        student: {
          select: { id: true, name: true, cardNumber: true, photoUrl: true },
        },
      },
    }),
    db.attendance.findMany({
      where: { courseId, date: dayValue },
      select: { studentId: true, markedAt: true },
    }),
    courseMonthStates([courseId], year, month),
  ]);

  // A student can have two marks the same day (a regular class and an extra one
  // for the same course); the arrival is the earliest.
  const arrival = new Map<number, string>();
  for (const m of marks) {
    const at = colomboNow(m.markedAt).time;
    const seen = arrival.get(m.studentId);
    if (seen === undefined || at < seen) arrival.set(m.studentId, at);
  }

  const monthStates = states.get(courseId) ?? new Map<number, MonthState>();

  const students: ClassStudentRow[] = sortRoster(
    enrolments.map((e) => ({
      studentId: e.student.id,
      name: e.student.name,
      cardNumber: e.student.cardNumber,
      photoUrl: e.student.photoUrl,
      present: arrival.has(e.student.id),
      arrivedAt: arrival.get(e.student.id) ?? null,
      monthState: monthStates.get(e.student.id) ?? ("notPaid" as MonthState),
    })),
  );

  const present = students.filter((s) => s.present).length;

  return {
    date,
    courseId,
    course: courseDisplayName(course),
    teacher: course.teacher.name,
    found: true,
    present,
    absent: students.length - present,
    monthLabel,
    counts: tallyMonthStates(students.map((s) => s.monthState)),
    students,
  };
}

export async function dailyAttendance(
  date: string,
  scope: { teacherId: number } | Record<string, never> | null,
): Promise<DailyAttendance> {
  const at = colomboNow(new Date(`${date}T06:00:00.000Z`));
  const [year, month] = date.split("-").map(Number);
  const monthLabel = `${MONTHS[month - 1]} ${year}`;
  const dayValue = colomboDateValue(date);

  // A teacher login with no Teacher attached gets an empty report, not everyone's.
  if (scope === null) {
    return { date, dayLabel: at.dayOfWeek, monthLabel, scoped: true, courses: [] };
  }
  const courseWhere = "teacherId" in scope ? { teacherId: scope.teacherId } : {};

  const [schedules, additional] = await Promise.all([
    db.schedule.findMany({
      where: { active: true, dayOfWeek: at.dayOfWeek, course: courseWhere },
      select: { courseId: true },
    }),
    db.additionalClass.findMany({
      where: { date: dayValue, course: courseWhere },
      select: { courseId: true },
    }),
  ]);

  const kinds = new Map<number, Set<"regular" | "additional">>();
  for (const s of schedules) {
    kinds.set(s.courseId, (kinds.get(s.courseId) ?? new Set()).add("regular"));
  }
  for (const a of additional) {
    kinds.set(a.courseId, (kinds.get(a.courseId) ?? new Set()).add("additional"));
  }

  const courseIds = [...kinds.keys()];
  if (courseIds.length === 0) {
    return { date, dayLabel: at.dayOfWeek, monthLabel, scoped: "teacherId" in scope, courses: [] };
  }

  const [courses, marks, monthStates] = await Promise.all([
    db.course.findMany({ where: { id: { in: courseIds } }, select: courseSelect }),
    db.attendance.findMany({
      where: { courseId: { in: courseIds }, date: dayValue },
      select: { courseId: true, studentId: true },
    }),
    // The one paid-check: `SETTLED_PAYMENT_WHERE`, via `courseMonthStates`. This
    // report used to run its own payment query here — a third copy of the rule.
    courseMonthStates(courseIds, year, month),
  ]);

  const rows: AttendanceCourseRow[] = courses.map((course) => {
    const states = tallyMonthStates((monthStates.get(course.id) ?? new Map()).values());
    const total = states.paid + states.notPaid + states.overdue + states.free;
    const free = states.free;
    const paid = states.paid;
    // Legacy meaning: every unpaid non-free student, overdue included.
    const notPaid = states.notPaid + states.overdue;

    const attended = new Set(
      marks.filter((m) => m.courseId === course.id).map((m) => m.studentId),
    ).size;

    return {
      courseId: course.id,
      course: courseDisplayName(course),
      teacher: course.teacher.name,
      sessions: [...(kinds.get(course.id) ?? new Set())].sort(),
      attended,
      absent: Math.max(0, total - attended),
      total,
      paid,
      notPaid,
      free,
      monthLabel,
      reconciles: total === paid + notPaid + free,
      states,
      statesReconcile: total === states.paid + states.notPaid + states.overdue + states.free,
    };
  });

  rows.sort((a, b) => a.course.localeCompare(b.course));

  return {
    date,
    dayLabel: at.dayOfWeek,
    monthLabel,
    scoped: "teacherId" in scope,
    courses: rows,
  };
}
