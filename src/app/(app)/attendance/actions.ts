"use server";

import { z } from "zod";

import { requireOperationalAccess } from "@/lib/authz";
import { normalizeCardNumber, normalizeCardUid } from "@/lib/card-uid";
import { colomboDateValue, colomboNow, to12Hour } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/prisma-errors";
import {
  searchStudentsQuery,
  studentBriefSelect,
  type StudentBrief,
} from "@/lib/students";
import { attendanceWindow } from "@/lib/schedule-time";

export type Method = "NFC" | "QR" | "SEARCH";

export type { StudentBrief };

export type Candidate = {
  key: string;
  kind: "regular" | "additional";
  courseId: number;
  additionalClassId: number | null;
  course: string;
  teacher: string;
  startTime: string;
  endTime: string;
  opens: string;
  closes: string;
  /** "HH:mm" if this class is already marked for the student today. */
  markedAt: string | null;
};

export type MarkedInfo = {
  attendanceId: number;
  clientRef: string;
  at: string;
  candidate: Candidate;
};

export type ScanResult =
  | { status: "unknown" }
  | { status: "no-class"; student: StudentBrief }
  | { status: "outside"; student: StudentBrief; message: string }
  | { status: "already"; student: StudentBrief; candidate: Candidate; at: string }
  | { status: "marked"; student: StudentBrief; mark: MarkedInfo }
  | { status: "confirm"; student: StudentBrief; candidate: Candidate }
  | { status: "choose"; student: StudentBrief; candidates: Candidate[] };

// ---------------------------------------------------------------------------

const uid = z.string().trim().min(1).max(64).transform(normalizeCardUid);
const cardNumber = z.string().trim().min(1).max(64).transform(normalizeCardNumber);
const id = z.coerce.number().int().positive();
const clientRefSchema = z.string().trim().min(8).max(64);
const method = z.enum(["NFC", "QR", "SEARCH"]);

const studentSelect = studentBriefSelect;

const courseSelect = {
  name: true,
  teacher: { select: { name: true } },
  subject: { select: { label: true } },
  grade: { select: { label: true } },
  classType: { select: { label: true } },
} as const;

/**
 * Every candidate class for this student *today*, whether or not `now` falls
 * inside its window. The window check is applied by the caller so the
 * out-of-window case can still explain itself with a real class name.
 */
async function todaysClasses(studentId: number, date: string, dayOfWeek: string) {
  const enrolments = await db.enrollment.findMany({
    where: { studentId, status: "ACTIVE" },
    select: { courseId: true },
  });
  const courseIds = enrolments.map((e) => e.courseId);
  if (courseIds.length === 0) return [];

  const [schedules, additional] = await Promise.all([
    db.schedule.findMany({
      where: {
        courseId: { in: courseIds },
        active: true,
        dayOfWeek: dayOfWeek as never,
      },
      include: { course: { select: courseSelect } },
    }),
    db.additionalClass.findMany({
      where: { courseId: { in: courseIds }, date: colomboDateValue(date) },
      include: { course: { select: courseSelect } },
    }),
  ]);

  const toCandidate = (
    row: {
      id: number;
      courseId: number;
      startTime: string;
      endTime: string;
      attendanceOpensBeforeMin: number;
      attendanceClosesBeforeMin: number;
      course: {
        name: string | null;
        teacher: { name: string };
        subject: { label: string };
        grade: { label: string };
        classType: { label: string };
      };
    },
    kind: "regular" | "additional",
  ): Candidate => {
    const w = attendanceWindow(row);
    return {
      key: `${kind}:${row.id}`,
      kind,
      courseId: row.courseId,
      additionalClassId: kind === "additional" ? row.id : null,
      course: courseDisplayName(row.course),
      teacher: row.course.teacher.name,
      startTime: row.startTime,
      endTime: row.endTime,
      opens: w.opens,
      closes: w.closes,
      markedAt: null,
    };
  };

  return [
    ...schedules.map((s) => toCandidate(s, "regular")),
    ...additional.map((a) => toCandidate(a, "additional")),
  ];
}

/** Existing marks for this student today, keyed the way candidates are. */
async function markedToday(studentId: number, date: string) {
  const rows = await db.attendance.findMany({
    where: { studentId, date: colomboDateValue(date) },
    select: { id: true, courseId: true, additionalClassId: true, markedAt: true },
  });

  const map = new Map<string, { id: number; at: string }>();
  for (const r of rows) {
    map.set(`${r.courseId}:${r.additionalClassId ?? ""}`, {
      id: r.id,
      at: colomboNow(r.markedAt).time,
    });
  }
  return map;
}

const candidateKey = (c: Candidate) =>
  `${c.courseId}:${c.additionalClassId ?? ""}`;

/**
 * Why is nothing open? Answer with the class staff are most likely asking
 * about: the next one to open if all are still ahead, otherwise the one that
 * closed most recently.
 */
function outsideMessage(all: Candidate[], now: string): string {
  const upcoming = all
    .filter((c) => now < c.opens)
    .sort((a, b) => a.opens.localeCompare(b.opens))[0];
  if (upcoming) {
    return `${upcoming.course} — attendance opens at ${to12Hour(upcoming.opens)}`;
  }

  const closed = all
    .filter((c) => now > c.closes)
    .sort((a, b) => b.closes.localeCompare(a.closes))[0];
  if (closed) {
    return `${closed.course} — attendance closed at ${to12Hour(closed.closes)}`;
  }

  return "No class open right now.";
}

/**
 * Writes the mark, or reports that it already exists.
 *
 * Two layers of idempotency: an explicit check for an existing mark on
 * (student, course, date [, additionalClass]) — the app-level rule the schema
 * deliberately leaves to code — and the unique `clientRef`, which makes a
 * double-submit of the *same* attempt a no-op rather than a second row.
 */
async function writeMark(args: {
  studentId: number;
  candidate: Candidate;
  date: string;
  method: Method;
  clientRef: string;
  markedById: string;
}): Promise<{ ok: true; mark: MarkedInfo } | { ok: false; at: string }> {
  const existing = await db.attendance.findFirst({
    where: {
      studentId: args.studentId,
      courseId: args.candidate.courseId,
      additionalClassId: args.candidate.additionalClassId,
      date: colomboDateValue(args.date),
    },
    select: { markedAt: true },
  });
  if (existing) {
    return { ok: false, at: colomboNow(existing.markedAt).time };
  }

  try {
    const row = await db.attendance.create({
      data: {
        studentId: args.studentId,
        courseId: args.candidate.courseId,
        additionalClassId: args.candidate.additionalClassId,
        date: colomboDateValue(args.date),
        method: args.method,
        markedById: args.markedById,
        clientRef: args.clientRef,
      },
      select: { id: true, markedAt: true, clientRef: true },
    });

    return {
      ok: true,
      mark: {
        attendanceId: row.id,
        clientRef: row.clientRef,
        at: colomboNow(row.markedAt).time,
        candidate: { ...args.candidate, markedAt: colomboNow(row.markedAt).time },
      },
    };
  } catch (error) {
    // Same clientRef replayed — the first write already stands.
    if (isUniqueViolation(error)) {
      const prior = await db.attendance.findUnique({
        where: { clientRef: args.clientRef },
        select: { markedAt: true },
      });
      return { ok: false, at: colomboNow(prior?.markedAt ?? new Date()).time };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Actions — reads are guarded exactly like writes. A search endpoint left open
// would leak the whole student roster.
// ---------------------------------------------------------------------------

/** Typeahead over card number, name and school so staff can type any fragment. */
export async function searchStudents(query: string): Promise<StudentBrief[]> {
  await requireOperationalAccess();

  return searchStudentsQuery(query);
}

/**
 * Identify → match → (auto-mark when unambiguous). One round trip, because this
 * runs on a phone at the classroom door.
 */
export async function resolveScan(input: {
  cardUid?: string;
  cardNumber?: string;
  studentId?: number;
  method: Method;
  clientRef: string;
}): Promise<ScanResult> {
  const user = await requireOperationalAccess();

  const parsedMethod = method.safeParse(input.method);
  const parsedRef = clientRefSchema.safeParse(input.clientRef);
  if (!parsedMethod.success || !parsedRef.success) return { status: "unknown" };

  const where =
    input.studentId !== undefined
      ? { id: id.parse(input.studentId) }
      : input.cardUid
        ? { cardUid: uid.parse(input.cardUid) }
        : input.cardNumber
          ? { cardNumber: cardNumber.parse(input.cardNumber) }
          : null;

  if (!where) return { status: "unknown" };

  const student = await db.student.findUnique({ where, select: studentSelect });
  if (!student) return { status: "unknown" };

  const now = colomboNow();
  const all = await todaysClasses(student.id, now.date, now.dayOfWeek);
  if (all.length === 0) return { status: "no-class", student };

  const marks = await markedToday(student.id, now.date);
  const withMarks = all.map((c) => ({ ...c, markedAt: marks.get(candidateKey(c))?.at ?? null }));

  const open = withMarks.filter((c) => now.time >= c.opens && now.time <= c.closes);

  if (open.length === 0) {
    return { status: "outside", student, message: outsideMessage(withMarks, now.time) };
  }

  if (open.length === 1) {
    const candidate = open[0];

    if (candidate.markedAt) {
      return { status: "already", student, candidate, at: candidate.markedAt };
    }

    // An additional class is unusual enough that staff must acknowledge it.
    if (candidate.kind === "additional") {
      return { status: "confirm", student, candidate };
    }

    const result = await writeMark({
      studentId: student.id,
      candidate,
      date: now.date,
      method: parsedMethod.data,
      clientRef: parsedRef.data,
      markedById: user.id,
    });

    return result.ok
      ? { status: "marked", student, mark: result.mark }
      : { status: "already", student, candidate, at: result.at };
  }

  return { status: "choose", student, candidates: open };
}

/** Marks a candidate the staff explicitly chose (confirm or pick-list). */
export async function markCandidate(input: {
  studentId: number;
  courseId: number;
  additionalClassId: number | null;
  method: Method;
  clientRef: string;
}): Promise<ScanResult> {
  const user = await requireOperationalAccess();

  const parsed = z
    .object({
      studentId: id,
      courseId: id,
      additionalClassId: id.nullable(),
      method,
      clientRef: clientRefSchema,
    })
    .safeParse(input);
  if (!parsed.success) return { status: "unknown" };

  const student = await db.student.findUnique({
    where: { id: parsed.data.studentId },
    select: studentSelect,
  });
  if (!student) return { status: "unknown" };

  const now = colomboNow();
  const all = await todaysClasses(student.id, now.date, now.dayOfWeek);

  // Re-derive the candidate server-side: a stale or forged client must not be
  // able to mark a class that isn't actually open for this student right now.
  const candidate = all.find(
    (c) =>
      c.courseId === parsed.data.courseId &&
      c.additionalClassId === parsed.data.additionalClassId &&
      now.time >= c.opens &&
      now.time <= c.closes,
  );
  if (!candidate) {
    return { status: "outside", student, message: outsideMessage(all, now.time) };
  }

  const result = await writeMark({
    studentId: student.id,
    candidate,
    date: now.date,
    method: parsed.data.method,
    clientRef: parsed.data.clientRef,
    markedById: user.id,
  });

  return result.ok
    ? { status: "marked", student, mark: result.mark }
    : { status: "already", student, candidate, at: result.at };
}

/**
 * Removes a mark made moments ago. Restricted to today's rows so Undo can never
 * reach back into history — corrections to past attendance are not this screen's
 * job.
 */
export async function undoMark(attendanceId: number): Promise<{ ok: boolean; error?: string }> {
  await requireOperationalAccess();

  const parsed = id.safeParse(attendanceId);
  if (!parsed.success) return { ok: false, error: "Invalid mark." };

  const now = colomboNow();
  const row = await db.attendance.findUnique({
    where: { id: parsed.data },
    select: { id: true, date: true },
  });
  if (!row) return { ok: false, error: "That mark no longer exists." };

  if (row.date.toISOString().slice(0, 10) !== now.date) {
    return { ok: false, error: "Only today's marks can be undone." };
  }

  await db.attendance.delete({ where: { id: row.id } });
  return { ok: true };
}
