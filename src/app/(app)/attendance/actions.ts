"use server";

import { z } from "zod";

import {
  candidateKey,
  matchCandidates,
  outsideMessage,
  type ArrearsBadge,
  type Candidate,
} from "@/lib/attendance-match";
import { requireOperationalAccess } from "@/lib/authz";
import { studentArrears, studentArrearsMany } from "@/lib/student-arrears";
import { normalizeCardNumber, normalizeCardUid } from "@/lib/card-uid";
import {colomboDateValue, colomboNow } from "@/lib/colombo-time";
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

export type { Candidate };

export type MarkedInfo = {
  attendanceId: number;
  clientRef: string;
  at: string;
  candidate: Candidate;
};

export type ScanResult =
  | { status: "unknown" }
  /** Offline outcomes. Produced in the browser, never by these actions. */
  | { status: "queued"; student: StudentBrief; candidate: Candidate; at: string; arrears: ArrearsBadge }
  | { status: "offline-blocked"; message: string }
  | { status: "no-class"; student: StudentBrief; arrears: ArrearsBadge }
  | { status: "outside"; student: StudentBrief; message: string; arrears: ArrearsBadge }
  | { status: "already"; student: StudentBrief; candidate: Candidate; at: string; arrears: ArrearsBadge }
  | { status: "marked"; student: StudentBrief; mark: MarkedInfo; arrears: ArrearsBadge }
  | { status: "confirm"; student: StudentBrief; candidate: Candidate; arrears: ArrearsBadge }
  | { status: "choose"; student: StudentBrief; candidates: Candidate[]; arrears: ArrearsBadge };

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

/**
 * The colour, straight from the shared arrears function. Not recomputed here —
 * the counter and the Student Profile must never disagree about who is behind.
 */
async function badgeFor(studentId: number): Promise<ArrearsBadge> {
  const a = await studentArrears(studentId);
  return { status: a.status, label: a.label };
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
  const arrears = await badgeFor(student.id);
  const all = await todaysClasses(student.id, now.date, now.dayOfWeek);
  if (all.length === 0) return { status: "no-class", student, arrears };

  const marks = await markedToday(student.id, now.date);
  const withMarks = all.map((c) => ({ ...c, markedAt: marks.get(candidateKey(c))?.at ?? null }));

  // The same matcher the browser runs offline — one implementation, two runtimes.
  const decision = matchCandidates(withMarks, now.time);

  switch (decision.kind) {
    case "no-class":
      return { status: "no-class", student, arrears };
    case "outside":
      return { status: "outside", student, message: decision.message, arrears };
    case "already":
      return { status: "already", student, candidate: decision.candidate, at: decision.at, arrears };
    case "confirm":
      return { status: "confirm", student, candidate: decision.candidate, arrears };
    case "choose":
      return { status: "choose", student, candidates: decision.candidates, arrears };
    case "mark": {
      const result = await writeMark({
        studentId: student.id,
        candidate: decision.candidate,
        date: now.date,
        method: parsedMethod.data,
        clientRef: parsedRef.data,
        markedById: user.id,
      });

      return result.ok
        ? { status: "marked", student, mark: result.mark, arrears }
        : { status: "already", student, candidate: decision.candidate, at: result.at, arrears };
    }
  }
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
  const arrears = await badgeFor(student.id);
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
    return { status: "outside", student, message: outsideMessage(all, now.time), arrears };
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
    ? { status: "marked", student, mark: result.mark, arrears }
    : { status: "already", student, candidate, at: result.at, arrears };
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

// ---------------------------------------------------------------------------
// Offline support (Attendance Tag B)
// ---------------------------------------------------------------------------

export type WorkingSetStudent = {
  id: number;
  name: string;
  school: string | null;
  cardUid: string | null;
  cardNumber: string | null;
};

export type WorkingSet = {
  /** The Colombo date this set describes. Stale if it isn't today. */
  date: string;
  builtAt: number;
  students: WorkingSetStudent[];
  /** studentId -> today's candidate classes. Missing = no class today. */
  classes: Record<number, Candidate[]>;
  /**
   * studentId -> the paid/not-paid colour, precomputed at refresh time.
   *
   * Only the colour and its label are cached, never the month-by-month
   * history: the offline popup shows a badge, and copying arrears detail for
   * 120 students onto a terminal would be a lot of bytes nobody reads.
   */
  arrears: Record<number, ArrearsBadge>;
};

/**
 * A lean projection of everything the matcher needs to work with no network.
 *
 * No photos: this is copied into IndexedDB on a POS terminal, and the identify
 * step only needs enough to turn a tap, a scan or a typed fragment into a
 * student. Marks already made today are included so an offline terminal can say
 * "already marked" instead of queueing a duplicate.
 */
export async function loadWorkingSet(): Promise<WorkingSet> {
  await requireOperationalAccess();

  const now = colomboNow();
  const today = colomboDateValue(now.date);

  const [students, enrolments, schedules, additional, marks] = await Promise.all([
    db.student.findMany({
      select: { id: true, name: true, school: true, cardUid: true, cardNumber: true },
      orderBy: { id: "asc" },
    }),
    db.enrollment.findMany({
      where: { status: "ACTIVE" },
      select: { studentId: true, courseId: true },
    }),
    db.schedule.findMany({
      where: { active: true, dayOfWeek: now.dayOfWeek as never },
      include: { course: { select: courseSelect } },
    }),
    db.additionalClass.findMany({
      where: { date: today },
      include: { course: { select: courseSelect } },
    }),
    db.attendance.findMany({
      where: { date: today },
      select: { studentId: true, courseId: true, additionalClassId: true, markedAt: true },
    }),
  ]);

  // courseId -> the classes that course runs today.
  const byCourse = new Map<number, Candidate[]>();
  const add = (
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
  ) => {
    const w = attendanceWindow(row);
    const list = byCourse.get(row.courseId) ?? [];
    list.push({
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
    });
    byCourse.set(row.courseId, list);
  };
  for (const row of schedules) add(row, "regular");
  for (const row of additional) add(row, "additional");

  const markedBy = new Map<string, string>();
  for (const m of marks) {
    markedBy.set(
      `${m.studentId}|${candidateKey(m)}`,
      colomboNow(m.markedAt).time,
    );
  }

  const classes: Record<number, Candidate[]> = {};
  for (const e of enrolments) {
    const runs = byCourse.get(e.courseId);
    if (!runs) continue;
    const list = classes[e.studentId] ?? (classes[e.studentId] = []);
    for (const c of runs) {
      list.push({ ...c, markedAt: markedBy.get(`${e.studentId}|${candidateKey(c)}`) ?? null });
    }
  }

  // Batched: one pass for everyone, not a query per student.
  const arrearsMap = await studentArrearsMany(students.map((s) => s.id));
  const arrears: Record<number, ArrearsBadge> = {};
  for (const [id, a] of arrearsMap) arrears[id] = { status: a.status, label: a.label };

  return { date: now.date, builtAt: Date.now(), students, classes, arrears };
}

export type QueuedMark = {
  clientRef: string;
  studentId: number;
  courseId: number;
  additionalClassId: number | null;
  method: Method;
  /** The Colombo date the terminal believed it was when the mark was taken. */
  date: string;
};

export type SyncOutcome = {
  clientRef: string;
  /** `settled` means the outbox may drop it: written, or already on record. */
  settled: boolean;
  status: "written" | "duplicate" | "rejected";
  message?: string;
};

/** Marks older than this are refused rather than replayed into the past. */
const MAX_QUEUED_AGE_DAYS = 7;

const queuedSchema = z.object({
  clientRef: clientRefSchema,
  studentId: id,
  courseId: id,
  additionalClassId: z.number().int().positive().nullable(),
  method: method,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Flush the terminal's outbox.
 *
 * Idempotency is the whole contract: every item carries the `clientRef` the
 * terminal generated when the mark was taken, and `writeMark` already refuses a
 * second row for the same ref OR the same (student, class, day). Flushing the
 * same outbox twice therefore writes once, which is what lets the client keep
 * an item queued until the server confirms it.
 *
 * The attendance WINDOW is deliberately not re-checked here. The mark was taken
 * at the terminal while the class was open; by the time the router comes back
 * the window may have closed, and refusing then would throw away exactly the
 * marks this feature exists to save. Enrolment and the class's existence on
 * that date ARE re-checked, so a forged item still cannot invent attendance.
 */
export async function syncMarks(items: QueuedMark[]): Promise<SyncOutcome[]> {
  const user = await requireOperationalAccess();

  const out: SyncOutcome[] = [];
  const today = colomboNow();

  for (const raw of items.slice(0, 200)) {
    const parsed = queuedSchema.safeParse(raw);
    if (!parsed.success) {
      out.push({
        clientRef: String(raw?.clientRef ?? "?"),
        settled: true,
        status: "rejected",
        message: "Malformed queued mark.",
      });
      continue;
    }
    const item = parsed.data;

    const ageDays =
      (colomboDateValue(today.date).getTime() - colomboDateValue(item.date).getTime()) / 86_400_000;
    if (ageDays < 0 || ageDays > MAX_QUEUED_AGE_DAYS) {
      out.push({
        clientRef: item.clientRef,
        settled: true,
        status: "rejected",
        message: "Queued mark is too old to sync.",
      });
      continue;
    }

    // The weekday of the mark's OWN date, so an outage spanning midnight still
    // resolves against the right day's timetable. Midday UTC is safely inside
    // the Colombo day.
    const dayOfWeek = colomboNow(new Date(`${item.date}T06:00:00.000Z`)).dayOfWeek;
    const all = await todaysClasses(item.studentId, item.date, dayOfWeek);
    const candidate = all.find(
      (c) => c.courseId === item.courseId && c.additionalClassId === item.additionalClassId,
    );
    if (!candidate) {
      out.push({
        clientRef: item.clientRef,
        settled: true,
        status: "rejected",
        message: "That class is not on this student's timetable for that day.",
      });
      continue;
    }

    const result = await writeMark({
      studentId: item.studentId,
      candidate,
      date: item.date,
      method: item.method,
      clientRef: item.clientRef,
      markedById: user.id,
    });

    out.push(
      result.ok
        ? { clientRef: item.clientRef, settled: true, status: "written" }
        : { clientRef: item.clientRef, settled: true, status: "duplicate", message: `Already marked at ${result.at}.` },
    );
  }

  return out;
}
