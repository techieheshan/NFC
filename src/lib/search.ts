import "server-only";

import type { PaymentKind } from "@prisma/client";

import { normalizeCardNumber } from "@/lib/card-uid";
import { colomboNow, colomboRangeUtc } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { transactionKey } from "@/lib/receipts";

/**
 * The counter lookup. Read-only: nothing here writes, and every function is a
 * plain query — callers apply their own role guard.
 *
 * Card number is the primary path and is matched with `contains`, not equals:
 * the office usually knows only the last few printed digits ("…2000"), and the
 * printed number is normalised the same way it is on the way in, so a query
 * typed with spaces still finds the row.
 */

/** How many rows a lookup will ever return. A counter tool, not a report. */
const LIMIT = 100;

export type StudentFilters = {
  card?: string;
  name?: string;
  school?: string;
  gradeId?: number;
  nic?: string;
};

export type StudentHit = {
  id: number;
  name: string;
  cardNumber: string | null;
  cardUid: string | null;
  grade: string | null;
  phone: string | null;
  school: string | null;
  nic: string | null;
  admissionPaid: boolean;
  enrolments: string[];
};

export const hasStudentFilter = (f: StudentFilters) =>
  Boolean(f.card || f.name || f.school || f.gradeId || f.nic);

export async function searchStudents(filters: StudentFilters): Promise<StudentHit[]> {
  // Requires at least one filter: an unfiltered dump of every student is
  // neither useful at a counter nor cheap.
  if (!hasStudentFilter(filters)) return [];

  const like = (v: string) => ({ contains: v, mode: "insensitive" as const });

  const students = await db.student.findMany({
    where: {
      // Normalised on the way in so "0186 0009 0007" matches "0186-0009-0007".
      ...(filters.card ? { cardNumber: like(normalizeCardNumber(filters.card)) } : {}),
      ...(filters.name ? { name: like(filters.name) } : {}),
      ...(filters.school ? { school: like(filters.school) } : {}),
      ...(filters.nic ? { nic: like(filters.nic) } : {}),
      ...(filters.gradeId
        ? { enrollments: { some: { status: "ACTIVE", course: { gradeId: filters.gradeId } } } }
        : {}),
    },
    select: {
      id: true,
      name: true,
      cardNumber: true,
      cardUid: true,
      phone: true,
      school: true,
      nic: true,
      admissionPaid: true,
      enrollments: {
        where: { status: "ACTIVE" },
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
        orderBy: { id: "asc" },
      },
    },
    orderBy: { name: "asc" },
    take: LIMIT,
  });

  return students.map((s) => ({
    id: s.id,
    name: s.name,
    cardNumber: s.cardNumber,
    cardUid: s.cardUid,
    // A student has no grade of their own; it comes from what they are enrolled
    // in, which is also why the grade filter goes through the enrolment.
    grade: s.enrollments[0]?.course.grade.label ?? null,
    phone: s.phone,
    school: s.school,
    nic: s.nic,
    admissionPaid: s.admissionPaid,
    enrolments: s.enrollments.map((e) => courseDisplayName(e.course)),
  }));
}

export type PaymentFilters = {
  /** Card number or name. */
  student?: string;
  from?: string;
  to?: string;
  courseId?: number;
  kind?: PaymentKind;
  includeCancelled?: boolean;
};

export type PaymentHit = {
  id: number;
  date: string;
  at: string;
  student: string;
  studentId: number;
  cardNumber: string | null;
  course: string | null;
  kind: PaymentKind;
  amount: string;
  cancelled: boolean;
  takenBy: string;
  /** Deep-links the row to its receipt on /receipts. */
  receiptKey: string;
};

export const hasPaymentFilter = (f: PaymentFilters) =>
  Boolean(f.student || (f.from && f.to) || f.courseId || f.kind);

export async function searchPayments(filters: PaymentFilters): Promise<PaymentHit[]> {
  if (!hasPaymentFilter(filters)) return [];

  const student = filters.student?.trim() ?? "";

  const rows = await db.payment.findMany({
    where: {
      // Cancelled rows are hidden unless asked for: they are not money.
      ...(filters.includeCancelled ? {} : { cancelled: false }),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.courseId ? { courseId: filters.courseId } : {}),
      ...(filters.from && filters.to
        ? { paidAt: colomboRangeUtc(filters.from, filters.to) }
        : {}),
      ...(student
        ? {
            student: {
              OR: [
                { cardNumber: { contains: normalizeCardNumber(student), mode: "insensitive" } },
                { name: { contains: student, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    select: {
      id: true,
      kind: true,
      amount: true,
      paidAt: true,
      cancelled: true,
      transactionRef: true,
      billingYear: true,
      billingMonth: true,
      takenBy: { select: { username: true } },
      student: { select: { id: true, name: true, cardNumber: true } },
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
    take: LIMIT,
  });

  return rows.map((r) => {
    const when = colomboNow(r.paidAt);
    return {
      id: r.id,
      date: when.date,
      at: when.time,
      student: r.student.name,
      studentId: r.student.id,
      cardNumber: r.student.cardNumber,
      course: r.course ? courseDisplayName(r.course) : null,
      kind: r.kind,
      amount: Number(String(r.amount)).toFixed(2),
      cancelled: r.cancelled,
      takenBy: r.takenBy.username,
      receiptKey: transactionKey(r),
    };
  });
}
