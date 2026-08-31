import "server-only";

import { colomboNow } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { studentArrears, type StudentArrears } from "@/lib/student-arrears";

/**
 * Everything the read-only profile shows. Read-only means read-only: nothing
 * here writes, and the arrears colour comes from `studentArrears` rather than
 * being recomputed, so this screen and the attendance counter can never
 * disagree about who is behind.
 */

export type ProfileEnrolment = {
  courseId: number;
  course: string;
  teacher: string;
  feeTier: string;
  free: boolean;
  status: "ACTIVE" | "DROPPED";
};

/** One cell of the month-by-month grid. */
export type MonthCell = "paid" | "owed" | "free" | "before";

export type ProfileHistoryRow = {
  courseId: number;
  course: string;
  free: boolean;
  cells: MonthCell[];
};

export type ProfilePayment = {
  id: number;
  kind: "ADMISSION" | "SMART_CARD" | "CLASS";
  date: string;
  amount: string;
  course: string | null;
  billing: string | null;
  cancelled: boolean;
};

export type ProfileAttendance = {
  id: number;
  date: string;
  at: string;
  course: string;
  method: string;
};

export type StudentProfile = {
  student: {
    id: number;
    name: string;
    photoUrl: string | null;
    cardNumber: string | null;
    cardUid: string | null;
    school: string | null;
    phone: string | null;
    nic: string | null;
    address: string | null;
    admissionPaid: boolean;
    grade: string | null;
  };
  arrears: StudentArrears;
  enrolments: ProfileEnrolment[];
  /** Column headings for the history grid, oldest first. */
  months: { year: number; month: number; label: string }[];
  history: ProfileHistoryRow[];
  payments: ProfilePayment[];
  attendance: ProfileAttendance[];
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const idx = (y: number, m: number) => y * 12 + m;

/** How far back the month-by-month grid reaches. */
const HISTORY_MONTHS = 12;

export async function loadStudentProfile(studentId: number): Promise<StudentProfile | null> {
  const student = await db.student.findUnique({
    where: { id: studentId },
    select: {
      id: true, name: true, photoUrl: true, cardNumber: true, cardUid: true,
      school: true, phone: true, nic: true, address: true, admissionPaid: true,
      enrollments: {
        select: {
          courseId: true, status: true, createdAt: true,
          feeTier: { select: { label: true, multiplier: true } },
          course: {
            select: {
              id: true, name: true,
              grade: { select: { label: true } },
              subject: { select: { label: true } },
              classType: { select: { label: true } },
              teacher: { select: { name: true } },
            },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!student) return null;

  const [arrears, payments, attendance] = await Promise.all([
    studentArrears(student.id),
    db.payment.findMany({
      where: { studentId: student.id },
      select: {
        id: true, kind: true, amount: true, paidAt: true, cancelled: true,
        billingYear: true, billingMonth: true,
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
      orderBy: { paidAt: "desc" },
      take: 100,
    }),
    db.attendance.findMany({
      where: { studentId: student.id },
      select: {
        id: true, date: true, markedAt: true, method: true,
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
      orderBy: [{ date: "desc" }, { id: "desc" }],
      take: 50,
    }),
  ]);

  // --- the month-by-month grid -------------------------------------------
  const now = colomboNow();
  const [nowY, nowM] = now.date.split("-").map(Number);
  const months: { year: number; month: number; label: string }[] = [];
  for (let back = HISTORY_MONTHS - 1; back >= 0; back--) {
    const total = idx(nowY, nowM) - back;
    const y = Math.floor((total - 1) / 12);
    const m = total - y * 12;
    months.push({ year: y, month: m, label: `${MONTHS[m - 1]} ${String(y).slice(2)}` });
  }

  // Paid = a non-cancelled CLASS payment stamped for that billing month.
  const paidPerCourse = new Set(
    payments
      .filter((p) => p.kind === "CLASS" && !p.cancelled && p.billingYear && p.billingMonth)
      .map((p) => `${p.course ? courseDisplayName(p.course) : ""}:${p.billingYear}:${p.billingMonth}`),
  );

  const history: ProfileHistoryRow[] = student.enrollments
    .filter((e) => e.status === "ACTIVE")
    .map((e) => {
      const free = Number(String(e.feeTier.multiplier)) === 0;
      const course = courseDisplayName(e.course);
      const from = colomboNow(e.createdAt).date.split("-").map(Number);
      const startIndex = idx(from[0], from[1]);

      return {
        courseId: e.courseId,
        course,
        free,
        cells: months.map((mo): MonthCell => {
          if (idx(mo.year, mo.month) < startIndex) return "before";
          if (free) return "free";
          return paidPerCourse.has(`${course}:${mo.year}:${mo.month}`) ? "paid" : "owed";
        }),
      };
    });

  return {
    student: {
      id: student.id,
      name: student.name,
      photoUrl: student.photoUrl,
      cardNumber: student.cardNumber,
      cardUid: student.cardUid,
      school: student.school,
      phone: student.phone,
      nic: student.nic,
      address: student.address,
      admissionPaid: student.admissionPaid,
      grade: student.enrollments[0]?.course.grade.label ?? null,
    },
    arrears,
    enrolments: student.enrollments.map((e) => ({
      courseId: e.courseId,
      course: courseDisplayName(e.course),
      teacher: e.course.teacher.name,
      feeTier: e.feeTier.label,
      free: Number(String(e.feeTier.multiplier)) === 0,
      status: e.status,
    })),
    months,
    history,
    payments: payments.map((p) => ({
      id: p.id,
      kind: p.kind,
      date: colomboNow(p.paidAt).date,
      amount: Number(String(p.amount)).toFixed(2),
      course: p.course ? courseDisplayName(p.course) : null,
      billing:
        p.billingYear && p.billingMonth
          ? `${MONTHS[p.billingMonth - 1]} ${p.billingYear}`
          : null,
      cancelled: p.cancelled,
    })),
    attendance: attendance.map((a) => ({
      id: a.id,
      date: colomboNow(a.date).date,
      at: colomboNow(a.markedAt).time,
      course: courseDisplayName(a.course),
      method: a.method,
    })),
  };
}
