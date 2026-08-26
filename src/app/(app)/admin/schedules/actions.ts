"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOperationalAccess } from "@/lib/authz";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { TIME_PATTERN } from "@/lib/schedule-time";

const PATH = "/admin/schedules";

/**
 * `values` echoes back what was submitted.
 *
 * React 19 resets an uncontrolled form once its action resolves. That is
 * invisible on success (the dialog closes), but on a validation error it would
 * wipe everything the user typed — so the failed values are returned and the
 * inputs use them as their defaults, restoring the form as the user left it.
 */
export type ActionState = {
  ok: boolean;
  error?: string;
  values?: Record<string, string>;
};

/** Every string field of a submission, for the echo above. */
function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function fail(formData: FormData, error: string): ActionState {
  return { ok: false, error, values: echo(formData) };
}

export type ScheduleRow = {
  id: number;
  courseId: number;
  course: string;
  teacher: string;
  subject: string;
  grade: string;
  dayOfWeek: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
  startTime: string;
  endTime: string;
  attendanceOpensBeforeMin: number;
  attendanceClosesBeforeMin: number;
  active: boolean;
};

export type AdditionalRow = {
  id: number;
  courseId: number;
  course: string;
  teacher: string;
  /** "YYYY-MM-DD" */
  date: string;
  startTime: string;
  endTime: string;
  attendanceOpensBeforeMin: number;
  attendanceClosesBeforeMin: number;
  note: string | null;
  /** Drives the delete-only-when-unused rule. */
  attendanceCount: number;
};

export type ScheduleFilters = {
  teacherId?: number;
  gradeId?: number;
  day?: string;
};

export type DateRange = { from?: string; to?: string };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const id = z.coerce.number().int().positive();

const time = z
  .string()
  .trim()
  .regex(TIME_PATTERN, "Times must be in 24-hour HH:mm format.");

/** Offsets are whole minutes and never negative — a window can't open after itself. */
const offset = z.coerce
  .number()
  .int("Attendance offsets must be whole minutes.")
  .min(0, "Attendance offsets cannot be negative.")
  .max(24 * 60, "Attendance offsets cannot exceed 24 hours.");

const dayOfWeek = z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);

const dateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date.");

/**
 * "HH:mm" is zero-padded, so a plain string compare is a chronological compare.
 * Applied as a refinement so the message points at the pair, not one field.
 */
const withOrderedTimes = <T extends { startTime: string; endTime: string }>(
  schema: z.ZodType<T>,
) =>
  schema.refine((v) => v.endTime > v.startTime, {
    message: "End time must be after start time.",
  });

const scheduleSchema = withOrderedTimes(
  z.object({
    courseId: id,
    dayOfWeek,
    startTime: time,
    endTime: time,
    attendanceOpensBeforeMin: offset,
    attendanceClosesBeforeMin: offset,
    active: z.boolean(),
  }),
);

const additionalSchema = withOrderedTimes(
  z.object({
    courseId: id,
    date: dateString,
    startTime: time,
    endTime: time,
    attendanceOpensBeforeMin: offset,
    attendanceClosesBeforeMin: offset,
    note: z
      .string()
      .trim()
      .max(300)
      .transform((v) => (v === "" ? null : v))
      .nullable(),
  }),
);

function readOffsets(formData: FormData) {
  return {
    // Blank inputs fall back to the schema default of 30 rather than failing.
    attendanceOpensBeforeMin: (formData.get("attendanceOpensBeforeMin") || "30") as string,
    attendanceClosesBeforeMin: (formData.get("attendanceClosesBeforeMin") || "30") as string,
  };
}

async function assertActiveCourse(courseId: number): Promise<string | null> {
  const course = await db.course.findFirst({
    where: { id: courseId, active: true },
    select: { id: true },
  });
  return course ? null : "Select an active course.";
}

// ---------------------------------------------------------------------------
// Reads — guarded exactly like the mutations. A list endpoint leaks the whole
// timetable if left open, so these are not exempt.
// ---------------------------------------------------------------------------

const courseInclude = {
  teacher: { select: { name: true } },
  subject: { select: { label: true } },
  grade: { select: { label: true } },
  classType: { select: { label: true } },
} as const;

export async function listSchedules(
  filters: ScheduleFilters = {},
): Promise<ScheduleRow[]> {
  await requireOperationalAccess();

  const rows = await db.schedule.findMany({
    where: {
      ...(filters.day ? { dayOfWeek: dayOfWeek.parse(filters.day) } : {}),
      ...(filters.teacherId || filters.gradeId
        ? {
            course: {
              ...(filters.teacherId ? { teacherId: filters.teacherId } : {}),
              ...(filters.gradeId ? { gradeId: filters.gradeId } : {}),
            },
          }
        : {}),
    },
    include: { course: { select: { name: true, ...courseInclude } } },
    // Postgres orders enums by declaration order, so MON..SUN sorts correctly.
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });

  return rows.map((s) => ({
    id: s.id,
    courseId: s.courseId,
    course: courseDisplayName(s.course),
    teacher: s.course.teacher.name,
    subject: s.course.subject.label,
    grade: s.course.grade.label,
    dayOfWeek: s.dayOfWeek,
    startTime: s.startTime,
    endTime: s.endTime,
    attendanceOpensBeforeMin: s.attendanceOpensBeforeMin,
    attendanceClosesBeforeMin: s.attendanceClosesBeforeMin,
    active: s.active,
  }));
}

export async function listAdditionalClasses(
  range: DateRange = {},
): Promise<AdditionalRow[]> {
  await requireOperationalAccess();

  const from = range.from && /^\d{4}-\d{2}-\d{2}$/.test(range.from) ? range.from : null;
  const to = range.to && /^\d{4}-\d{2}-\d{2}$/.test(range.to) ? range.to : null;

  const rows = await db.additionalClass.findMany({
    where:
      from || to
        ? {
            date: {
              ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
              ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}),
            },
          }
        : {},
    include: {
      course: { select: { name: true, ...courseInclude } },
      _count: { select: { attendances: true } },
    },
    orderBy: [{ date: "desc" }, { startTime: "asc" }],
  });

  return rows.map((a) => ({
    id: a.id,
    courseId: a.courseId,
    course: courseDisplayName(a.course),
    teacher: a.course.teacher.name,
    date: a.date.toISOString().slice(0, 10),
    startTime: a.startTime,
    endTime: a.endTime,
    attendanceOpensBeforeMin: a.attendanceOpensBeforeMin,
    attendanceClosesBeforeMin: a.attendanceClosesBeforeMin,
    note: a.note,
    attendanceCount: a._count.attendances,
  }));
}

// ---------------------------------------------------------------------------
// Schedule mutations
// ---------------------------------------------------------------------------

function readSchedule(formData: FormData) {
  return {
    courseId: formData.get("courseId"),
    dayOfWeek: formData.get("dayOfWeek"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    ...readOffsets(formData),
    // An unchecked checkbox submits nothing at all.
    active: formData.get("active") === "on" || formData.get("active") === "true",
  };
}

export async function createSchedule(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOperationalAccess();

  const parsed = scheduleSchema.safeParse(readSchedule(formData));
  if (!parsed.success) return fail(formData, parsed.error.issues[0].message);

  const refError = await assertActiveCourse(parsed.data.courseId);
  if (refError) return fail(formData, refError);

  // Deliberately no duplicate/overlap check: a course legitimately runs on
  // several days, and repeated or overlapping sessions are a real occurrence.
  await db.schedule.create({ data: parsed.data });

  revalidatePath(PATH);
  return { ok: true };
}

export async function updateSchedule(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOperationalAccess();

  const scheduleId = id.safeParse(formData.get("id"));
  if (!scheduleId.success) return fail(formData, "Invalid schedule.");

  const parsed = scheduleSchema.safeParse(readSchedule(formData));
  if (!parsed.success) return fail(formData, parsed.error.issues[0].message);

  const refError = await assertActiveCourse(parsed.data.courseId);
  if (refError) return fail(formData, refError);

  await db.schedule.update({ where: { id: scheduleId.data }, data: parsed.data });

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Deactivate / reactivate. There is deliberately NO delete for schedules —
 * the timetable is history that attendance records are interpreted against.
 */
export async function setScheduleActive(formData: FormData): Promise<void> {
  await requireOperationalAccess();

  const scheduleId = id.safeParse(formData.get("id"));
  if (!scheduleId.success) return;

  await db.schedule.update({
    where: { id: scheduleId.data },
    data: { active: formData.get("active") === "true" },
  });

  revalidatePath(PATH);
}

// ---------------------------------------------------------------------------
// Additional class mutations
// ---------------------------------------------------------------------------

function readAdditional(formData: FormData) {
  return {
    courseId: formData.get("courseId"),
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    ...readOffsets(formData),
    note: formData.get("note") ?? "",
  };
}

export async function createAdditionalClass(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOperationalAccess();

  const parsed = additionalSchema.safeParse(readAdditional(formData));
  if (!parsed.success) return fail(formData, parsed.error.issues[0].message);

  const refError = await assertActiveCourse(parsed.data.courseId);
  if (refError) return fail(formData, refError);

  const { date, ...rest } = parsed.data;
  await db.additionalClass.create({
    // @db.Date — parse at UTC midnight so the stored calendar day matches what
    // staff picked, whatever the server timezone.
    data: { ...rest, date: new Date(`${date}T00:00:00.000Z`) },
  });

  revalidatePath(PATH);
  return { ok: true };
}

export async function updateAdditionalClass(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOperationalAccess();

  const classId = id.safeParse(formData.get("id"));
  if (!classId.success) return fail(formData, "Invalid class.");

  const parsed = additionalSchema.safeParse(readAdditional(formData));
  if (!parsed.success) return fail(formData, parsed.error.issues[0].message);

  const refError = await assertActiveCourse(parsed.data.courseId);
  if (refError) return fail(formData, refError);

  const { date, ...rest } = parsed.data;
  await db.additionalClass.update({
    where: { id: classId.data },
    data: { ...rest, date: new Date(`${date}T00:00:00.000Z`) },
  });

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * AdditionalClass has no `active` flag in the schema, so removal is a real
 * delete — permitted ONLY while nothing references it. Once attendance has been
 * marked against the session it becomes history and must survive.
 */
export async function deleteAdditionalClass(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOperationalAccess();

  const classId = id.safeParse(formData.get("id"));
  if (!classId.success) return { ok: false, error: "Invalid class." };

  const marked = await db.attendance.count({
    where: { additionalClassId: classId.data },
  });

  if (marked > 0) {
    return {
      ok: false,
      error: `Can't delete — attendance has already been marked for this class (${marked} ${
        marked === 1 ? "record" : "records"
      }). It is kept as history.`,
    };
  }

  await db.additionalClass.delete({ where: { id: classId.data } });

  revalidatePath(PATH);
  return { ok: true };
}
