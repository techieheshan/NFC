"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOperationalAccess, requireRole } from "@/lib/authz";
import { normalizeCardNumber, normalizeCardUid } from "@/lib/card-uid";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { coursesForSubject, subjectsForStream } from "@/lib/streams";
import {
  MAX_PHOTO_BYTES,
  deleteStudentPhoto,
  uploadStudentPhoto,
  type PhotoUpload,
} from "@/lib/photo";

const PATH = "/registration";

/** What the cascade's two pickers render. */
export type SubjectPick = { id: number; label: string };
export type CoursePick = { id: number; label: string; hint?: string };

/** The columns `courseDisplayName` needs, matching `coursesForSubject`. */
const cascadeCourseSelect = {
  id: true,
  name: true,
  defaultFee: true,
  teacher: { select: { name: true } },
  grade: { select: { label: true } },
  subject: { select: { label: true } },
  classType: { select: { label: true } },
} as const;

/**
 * `values` echoes back what was submitted. React 19 resets an uncontrolled form
 * once its action resolves, which on a validation error would wipe everything
 * the user typed — so failures return the submitted values and the inputs use
 * them as defaults. See AGENTS.md rule 14.
 */
export type ActionState = {
  ok: boolean;
  error?: string;
  values?: Record<string, string>;
};

/** Every string field of a submission (the photo File is skipped). */
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

export type EnrolmentView = {
  id: number;
  courseId: number;
  course: string;
  feeTier: string;
  /** Additive: lets the "Change fee" dialog preselect the current tier. */
  feeTierId: number;
  status: "ACTIVE" | "DROPPED";
  /**
   * How much history hangs off this enrolment. Zero of both means it is still
   * just a typing mistake and can be removed outright; anything else and the
   * row has to stay, because deleting it would delete the reason a payment or
   * a mark exists.
   */
  payments: number;
  attendance: number;
};

export type StudentView = {
  id: number;
  name: string;
  address: string | null;
  school: string | null;
  phone: string | null;
  nic: string | null;
  photoUrl: string | null;
  cardUid: string | null;
  cardNumber: string | null;
  admissionPaid: boolean;
  enrolments: EnrolmentView[];
};

/**
 * What the identify step captured. A card carries both identifiers, but any one
 * scan only yields one of them: an NFC tap gives the UID, a QR gives the printed
 * card number. Either is enough to find a student.
 */
export type Identifier = { cardUid?: string; cardNumber?: string };

export type LookupResult =
  | { status: "invalid"; message: string }
  | { status: "new"; captured: Identifier }
  /** `captured` is echoed so the caller can offer to fill in a missing field. */
  | { status: "found"; student: StudentView; captured: Identifier };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const optionalText = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v === "" ? null : v))
  .nullable();

const uidSchema = z
  .string()
  .trim()
  .min(4, "Card UID looks too short.")
  .max(64, "Card UID looks too long.")
  .transform(normalizeCardUid)
  .refine((v) => /^[0-9A-Z]+$/.test(v), "Card UID must be hexadecimal.");

const cardNumberSchema = z
  .string()
  .trim()
  .min(3, "Card number looks too short.")
  .max(64, "Card number looks too long.")
  .transform(normalizeCardNumber);

const studentDetails = {
  name: z.string().trim().min(1, "Name is required.").max(120),
  phone: z.string().trim().min(1, "Phone is required.").max(30),
  school: z.string().trim().min(1, "School is required.").max(150),
  address: optionalText,
  nic: optionalText,
};

const id = z.coerce.number().int().positive();

/** An untouched form field arrives as "" — that means "not captured", not invalid. */
function blankToUndefined(value: FormDataEntryValue | null): string | undefined {
  const v = typeof value === "string" ? value.trim() : "";
  return v === "" ? undefined : v;
}

/** Repeatable enrolment rows arrive as parallel `courseId` / `feeTierId` lists. */
function readEnrolments(formData: FormData) {
  const courseIds = formData.getAll("courseId").map(String).filter((v) => v !== "");
  const feeTierIds = formData.getAll("feeTierId").map(String).filter((v) => v !== "");

  if (courseIds.length !== feeTierIds.length) return null;

  return courseIds.map((c, i) => ({ courseId: c, feeTierId: feeTierIds[i] }));
}

const enrolmentSchema = z
  .array(z.object({ courseId: id, feeTierId: id }))
  .min(1, "Enrol the student in at least one course.");

/**
 * Course must be active and fee tier must exist — a stale form or a replayed
 * request must not attach a student to a deactivated course.
 */
async function assertEnrolmentRefs(
  rows: { courseId: number; feeTierId: number }[],
): Promise<string | null> {
  const courseIds = [...new Set(rows.map((r) => r.courseId))];
  const feeTierIds = [...new Set(rows.map((r) => r.feeTierId))];

  if (courseIds.length !== rows.length) {
    return "The same course is listed twice.";
  }

  const [courses, tiers] = await Promise.all([
    db.course.count({ where: { id: { in: courseIds }, active: true } }),
    db.feeTier.count({ where: { id: { in: feeTierIds }, active: true } }),
  ]);

  if (courses !== courseIds.length) return "Select an active course.";
  if (tiers !== feeTierIds.length) return "Select an active fee tier.";
  return null;
}

async function readPhoto(formData: FormData): Promise<PhotoUpload | null | string> {
  const entry = formData.get("photo");
  if (!(entry instanceof File) || entry.size === 0) return null;

  if (!entry.type.startsWith("image/")) return "Photo must be an image.";
  if (entry.size > MAX_PHOTO_BYTES) return "Photo is too large.";

  return {
    buffer: Buffer.from(await entry.arrayBuffer()),
    type: entry.type,
  };
}

/**
 * How many payments and attendance marks exist for each of a student's courses.
 *
 * Payment and Attendance point at (student, course), not at the enrolment row,
 * so this is two grouped counts rather than a relation count — and it is what
 * decides whether an enrolment is still just a mistake that can be deleted.
 */
async function historyByCourse(studentId: number) {
  const [payments, attendance] = await Promise.all([
    db.payment.groupBy({
      by: ["courseId"],
      where: { studentId, courseId: { not: null } },
      _count: { _all: true },
    }),
    db.attendance.groupBy({ by: ["courseId"], where: { studentId }, _count: { _all: true } }),
  ]);
  return {
    payments: new Map(payments.map((p) => [p.courseId!, p._count._all])),
    attendance: new Map(attendance.map((a) => [a.courseId, a._count._all])),
  };
}

function toStudentView(student: {
  id: number;
  name: string;
  address: string | null;
  school: string | null;
  phone: string | null;
  nic: string | null;
  photoUrl: string | null;
  cardUid: string | null;
  cardNumber: string | null;
  admissionPaid: boolean;
  enrollments: {
    id: number;
    courseId: number;
    status: "ACTIVE" | "DROPPED";
    feeTierId: number;
    feeTier: { label: string };
    course: {
      name: string | null;
      grade: { label: string };
      subject: { label: string };
      classType: { label: string };
      teacher: { name: string };
    };
  }[];
}): StudentView {
  return {
    id: student.id,
    name: student.name,
    address: student.address,
    school: student.school,
    phone: student.phone,
    nic: student.nic,
    photoUrl: student.photoUrl,
    cardUid: student.cardUid,
    cardNumber: student.cardNumber,
    admissionPaid: student.admissionPaid,
    enrolments: student.enrollments.map((e) => ({
      id: e.id,
      courseId: e.courseId,
      course: courseDisplayName(e.course),
      feeTier: e.feeTier.label,
      feeTierId: e.feeTierId,
      status: e.status,
      payments: 0,
      attendance: 0,
    })),
  };
}

const studentInclude = {
  enrollments: {
    include: {
      feeTier: { select: { label: true } },
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
} as const;

/** `toStudentView`, with each enrolment's payment and attendance counts filled in. */
async function withHistory(
  student: Parameters<typeof toStudentView>[0] & { id: number },
): Promise<StudentView> {
  const history = await historyByCourse(student.id);
  const view = toStudentView(student);
  return {
    ...view,
    enrolments: view.enrolments.map((e) => ({
      ...e,
      payments: history.payments.get(e.courseId) ?? 0,
      attendance: history.attendance.get(e.courseId) ?? 0,
    })),
  };
}

/**
 * Both cardUid and cardNumber are unique, so a clash has to name the offending
 * one. Prisma's `meta.target` isn't reliably populated through the driver
 * adapter, so the values are re-checked directly instead of parsed out of the
 * error — deterministic, and it costs one query on a path that already failed.
 *
 * `exceptStudentId` is what makes editing work: a student saving their own card
 * number unchanged must not collide with themselves. Returns null when nothing
 * is taken, so the same helper serves as the up-front check on edit and as the
 * message builder in a create's catch.
 *
 * The message names which identifier clashed and nothing else — staff don't
 * need (and shouldn't be shown) the other student behind a card they're not
 * looking at.
 */
async function clashMessage(
  candidate: { cardUid?: string; cardNumber?: string },
  exceptStudentId?: number,
): Promise<string | null> {
  const other = exceptStudentId ? { id: { not: exceptStudentId } } : {};

  const [uidTaken, numberTaken] = await Promise.all([
    candidate.cardUid
      ? db.student.findFirst({
          where: { cardUid: candidate.cardUid, ...other },
          select: { id: true },
        })
      : null,
    candidate.cardNumber
      ? db.student.findFirst({
          where: { cardNumber: candidate.cardNumber, ...other },
          select: { id: true },
        })
      : null,
  ]);

  if (uidTaken && numberTaken) {
    return "That card UID and card number are both already assigned to other students.";
  }
  if (numberTaken) return "That card number is already assigned to another student.";
  if (uidTaken) return "That card UID is already assigned to another student.";
  return null;
}

/** A unique violation we couldn't attribute to a specific column. */
const GENERIC_CLASH = "That card identifier is already assigned to another student.";

/** Both identifiers are optional individually, but a student needs one of them. */
const AT_LEAST_ONE = {
  message: "A student needs a card UID or a card number (at least one).",
} as const;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Step A: is this card known? Read-only, but still role-guarded.
 *
 * Matches on cardUid OR cardNumber, so tapping a card and scanning its QR both
 * resolve to the same student — the two identifiers are printed on one card.
 */
export async function lookupCard(input: Identifier): Promise<LookupResult> {
  await requireOperationalAccess();

  const captured: Identifier = {};

  if (input.cardUid !== undefined && input.cardUid !== "") {
    const parsed = uidSchema.safeParse(input.cardUid);
    if (!parsed.success) {
      return { status: "invalid", message: parsed.error.issues[0].message };
    }
    captured.cardUid = parsed.data;
  }

  if (input.cardNumber !== undefined && input.cardNumber !== "") {
    const parsed = cardNumberSchema.safeParse(input.cardNumber);
    if (!parsed.success) {
      return { status: "invalid", message: parsed.error.issues[0].message };
    }
    captured.cardNumber = parsed.data;
  }

  if (!captured.cardUid && !captured.cardNumber) {
    return { status: "invalid", message: "Scan a card or enter an identifier." };
  }

  const or: { cardUid?: string; cardNumber?: string }[] = [];
  if (captured.cardUid) or.push({ cardUid: captured.cardUid });
  if (captured.cardNumber) or.push({ cardNumber: captured.cardNumber });

  const student = await db.student.findFirst({
    where: { OR: or },
    include: studentInclude,
  });

  return student
    ? { status: "found", student: await withHistory(student), captured }
    : { status: "new", captured };
}

/**
 * Fills in whichever identifier a known student is missing — the QR-registered
 * student whose card is later tapped, or vice versa. Never overwrites a value
 * that is already set; that would be a card reissue, which belongs elsewhere.
 */
export async function attachIdentifier(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOperationalAccess();

  const studentId = id.safeParse(formData.get("studentId"));
  if (!studentId.success) return fail(formData, "Invalid student.");

  const kind = formData.get("kind");
  const raw = String(formData.get("value") ?? "");

  if (kind !== "cardUid" && kind !== "cardNumber") {
    return fail(formData, "Unknown identifier type.");
  }

  const parsed =
    kind === "cardUid" ? uidSchema.safeParse(raw) : cardNumberSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(formData, parsed.error.issues[0].message);
  }

  const current = await db.student.findUnique({
    where: { id: studentId.data },
    select: { cardUid: true, cardNumber: true },
  });
  if (!current) return fail(formData, "Student not found.");
  if (current[kind]) {
    return {
      ok: false,
      values: echo(formData),
      error:
        kind === "cardUid"
          ? "This student already has a card UID."
          : "This student already has a card number.",
    };
  }

  try {
    await db.student.update({
      where: { id: studentId.data },
      data: { [kind]: parsed.data },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        values: echo(formData),
        error:
          kind === "cardUid"
            ? "That card UID is already assigned to another student."
            : "That card number is already assigned to another student.",
      };
    }
    throw error;
  }

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Step B: create the student, their enrolments and their photo as one unit.
 *
 * The Cloudinary upload happens INSIDE the transaction because the public_id is
 * derived from the new student's id. If the upload throws, the whole write
 * rolls back; if a later step throws after a successful upload, the orphaned
 * image is deleted in the catch.
 */
export async function createStudent(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOperationalAccess();

  /**
   * Both identifiers are optional individually but at least one is required:
   * an NFC-only terminal may capture just the UID, while an office with no NFC
   * phone has only the printed/QR card number. Blank means "not captured", and
   * is stored as NULL so the unique indexes stay usable.
   */
  const parsed = z
    .object({
      ...studentDetails,
      cardUid: uidSchema.optional(),
      cardNumber: cardNumberSchema.optional(),
    })
    .refine((v) => Boolean(v.cardUid) || Boolean(v.cardNumber), AT_LEAST_ONE)
    .safeParse({
      name: formData.get("name"),
      phone: formData.get("phone"),
      school: formData.get("school"),
      address: formData.get("address") ?? "",
      nic: formData.get("nic") ?? "",
      cardUid: blankToUndefined(formData.get("cardUid")),
      cardNumber: blankToUndefined(formData.get("cardNumber")),
    });

  if (!parsed.success) {
    return fail(formData, parsed.error.issues[0].message);
  }

  const rawRows = readEnrolments(formData);
  if (!rawRows) return fail(formData, "Enrolment rows are malformed.");

  const rows = enrolmentSchema.safeParse(rawRows);
  if (!rows.success) {
    return fail(formData, rows.error.issues[0].message);
  }

  const refError = await assertEnrolmentRefs(rows.data);
  if (refError) return fail(formData, refError);

  const photo = await readPhoto(formData);
  if (typeof photo === "string") return fail(formData, photo);

  let uploadedFor: number | null = null;

  try {
    await db.$transaction(
      async (tx) => {
        // admissionPaid deliberately left at its default false — no money is
        // charged during registration.
        const student = await tx.student.create({
          data: {
            ...parsed.data,
            cardUid: parsed.data.cardUid ?? null,
            cardNumber: parsed.data.cardNumber ?? null,
          },
        });

        await tx.enrollment.createMany({
          data: rows.data.map((r) => ({
            studentId: student.id,
            courseId: r.courseId,
            feeTierId: r.feeTierId,
          })),
        });

        if (photo) {
          const photoUrl = await uploadStudentPhoto(student.id, photo);
          uploadedFor = student.id;
          await tx.student.update({
            where: { id: student.id },
            data: { photoUrl },
          });
        }
      },
      // The Cloudinary round-trip lives inside this transaction, so the default
      // 5s ceiling is too tight.
      { timeout: 30_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (uploadedFor !== null) {
      await deleteStudentPhoto(uploadedFor).catch(() => {});
    }
    if (isUniqueViolation(error)) {
      return fail(formData, (await clashMessage(parsed.data)) ?? GENERIC_CLASH);
    }
    throw error;
  }

  revalidatePath(PATH);
  return { ok: true };
}

/** Step C: add another course to a student who already has a card. */
export async function addEnrolment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOperationalAccess();

  const parsed = z
    .object({ studentId: id, courseId: id, feeTierId: id })
    .safeParse({
      studentId: formData.get("studentId"),
      courseId: formData.get("courseId"),
      feeTierId: formData.get("feeTierId"),
    });

  if (!parsed.success) return { ok: false, error: "Select a course and fee tier." };

  const { studentId, courseId, feeTierId } = parsed.data;

  const refError = await assertEnrolmentRefs([{ courseId, feeTierId }]);
  if (refError) return { ok: false, error: refError };

  // @@unique([studentId, courseId]) means a dropped enrolment blocks a new row,
  // so re-enrolling reactivates the existing one instead of failing.
  const existing = await db.enrollment.findUnique({
    where: { studentId_courseId: { studentId, courseId } },
    select: { id: true, status: true },
  });

  if (existing?.status === "ACTIVE") {
    return { ok: false, error: "This student is already enrolled in that course." };
  }

  try {
    if (existing) {
      await db.enrollment.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", feeTierId },
      });
    } else {
      await db.enrollment.create({ data: { studentId, courseId, feeTierId } });
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "This student is already enrolled in that course." };
    }
    throw error;
  }

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Edit a student's details AND their card identifiers.
 *
 * Card edits are deliberately an overwrite, not an append: the office fixes a
 * mistyped number, and a lost card is reissued by writing the new UID over the
 * old one. Clearing a field is allowed as long as the other one survives —
 * a student must always be findable by at least one identifier.
 */
export async function updateStudent(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOperationalAccess();

  const parsed = z
    .object({
      studentId: id,
      ...studentDetails,
      cardUid: uidSchema.optional(),
      cardNumber: cardNumberSchema.optional(),
    })
    .refine((v) => Boolean(v.cardUid) || Boolean(v.cardNumber), AT_LEAST_ONE)
    .safeParse({
      studentId: formData.get("studentId"),
      name: formData.get("name"),
      phone: formData.get("phone"),
      school: formData.get("school"),
      address: formData.get("address") ?? "",
      nic: formData.get("nic") ?? "",
      cardUid: blankToUndefined(formData.get("cardUid")),
      cardNumber: blankToUndefined(formData.get("cardNumber")),
    });

  if (!parsed.success) {
    return fail(formData, parsed.error.issues[0].message);
  }

  const { studentId, cardUid, cardNumber, ...details } = parsed.data;
  const card = { cardUid, cardNumber };

  // Checked up front so the message can name the offending identifier; the
  // unique indexes below are still the authority, since another terminal could
  // claim the same card between this read and the write.
  const clash = await clashMessage(card, studentId);
  if (clash) return fail(formData, clash);

  try {
    await db.student.update({
      where: { id: studentId },
      data: { ...details, cardUid: cardUid ?? null, cardNumber: cardNumber ?? null },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail(formData, (await clashMessage(card, studentId)) ?? GENERIC_CLASH);
    }
    throw error;
  }

  revalidatePath(PATH);
  return { ok: true };
}

/** Replaces the Cloudinary image in place — same public_id, overwrite: true. */
export async function updateStudentPhoto(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOperationalAccess();

  const studentId = id.safeParse(formData.get("studentId"));
  if (!studentId.success) return { ok: false, error: "Invalid student." };

  const photo = await readPhoto(formData);
  if (typeof photo === "string") return { ok: false, error: photo };
  if (!photo) return { ok: false, error: "Choose a photo first." };

  const exists = await db.student.findUnique({
    where: { id: studentId.data },
    select: { id: true },
  });
  if (!exists) return { ok: false, error: "Student not found." };

  const photoUrl = await uploadStudentPhoto(studentId.data, photo);
  await db.student.update({
    where: { id: studentId.data },
    data: { photoUrl },
  });

  revalidatePath(PATH);
  return { ok: true };
}

/** Re-reads a student after a mutation so the client can refresh its panel. */
export async function refreshStudent(studentId: number): Promise<StudentView | null> {
  await requireOperationalAccess();

  const student = await db.student.findUnique({
    where: { id: studentId },
    include: studentInclude,
  });

  return student ? await withHistory(student) : null;
}

// ---------------------------------------------------------------------------
// The registration cascade: stream → subject → course
// ---------------------------------------------------------------------------

/**
 * The subjects a stream offers, and the courses that teach one subject.
 *
 * These are thin wrappers over `src/lib/streams.ts` — the same helpers Setup
 * writes through — so the list staff can pick from is the list Setup says the
 * stream contains, and never a second copy assembled here.
 *
 * They are fetched per step rather than shipped whole: registration is the
 * screen with hundreds of courses behind it, and sending all of them to a
 * terminal on every student is the cost this cascade exists to remove.
 * Each is its own HTTP endpoint, so each re-checks the role.
 */
export async function loadSubjectsForStream(streamId: number): Promise<SubjectPick[]> {
  await requireOperationalAccess();
  return subjectsForStream(streamId);
}

/**
 * Courses for one subject, or — with `all` — every active course.
 *
 * The `all` escape is deliberate: a student catching up sits in a course
 * outside their stream's usual set, and a cascade with no way out would send
 * staff to the database instead.
 */
export async function loadCoursesForCascade(input: {
  subjectId?: number;
  all?: boolean;
}): Promise<CoursePick[]> {
  await requireOperationalAccess();

  const rows = input.all
    ? await db.course.findMany({
        where: { active: true },
        select: cascadeCourseSelect,
        orderBy: { id: "asc" },
      })
    : input.subjectId
      ? await coursesForSubject(input.subjectId)
      : [];

  return rows.map((c) => ({
    id: c.id,
    label: courseDisplayName(c),
    hint: c.teacher.name,
  }));
}

/**
 * Undo a wrongly-added enrolment.
 *
 * In the rush at the counter staff pick the course above the one they meant, and
 * until that enrolment has been used it is nothing but a typo — so it is
 * deleted outright rather than left as a DROPPED row nobody can explain later.
 *
 * The moment it HAS been used it stops being a typo: a payment or an attendance
 * mark points at that (student, course), and removing the enrolment would leave
 * money and marks with nothing behind them. Then it is refused, with the counts
 * in the message, and the student is dropped from the course instead — the
 * record stays, the enrolment stops.
 *
 * The check is re-run here rather than trusted from the screen: the screen's
 * copy was fetched before someone else's payment may have landed.
 */
export async function removeEnrolment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOperationalAccess();

  const parsed = z.object({ enrolmentId: id }).safeParse({
    enrolmentId: formData.get("enrolmentId"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid enrolment." };

  const enrolment = await db.enrollment.findUnique({
    where: { id: parsed.data.enrolmentId },
    select: { id: true, studentId: true, courseId: true },
  });
  if (!enrolment) return { ok: false, error: "That enrolment no longer exists." };

  const [payments, attendance] = await Promise.all([
    db.payment.count({
      where: { studentId: enrolment.studentId, courseId: enrolment.courseId },
    }),
    db.attendance.count({
      where: { studentId: enrolment.studentId, courseId: enrolment.courseId },
    }),
  ]);

  if (payments > 0 || attendance > 0) {
    const parts = [
      payments > 0 ? `${payments} payment${payments === 1 ? "" : "s"}` : null,
      attendance > 0 ? `${attendance} attendance mark${attendance === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    return {
      ok: false,
      error: `This course has ${parts.join(" and ")} against it, so it cannot be removed. Drop the student from the course instead — the history stays.`,
    };
  }

  await db.enrollment.delete({ where: { id: enrolment.id } });

  revalidatePath(PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Change a course's fee tier (ADMIN only)
// ---------------------------------------------------------------------------

/**
 * The SAME per-student advisory lock namespace the payment charge takes
 * (`PAYMENT_LOCK_NAMESPACE` in payment/actions.ts, a non-exported constant of a "use server"
 * file, so the number is repeated here; `fee-tier-change.test.ts` fails if the two differ). A
 * tier change and a checkout of the same student therefore never interleave: a payment prices
 * from the tier it read and freezes that tier onto its row, and this makes sure the row is
 * either wholly old-tier or wholly new-tier.
 */
const STUDENT_LOCK_NAMESPACE = 7301;
const LOCK_WAIT_MS = 4000;
const TX_MAX_WAIT_MS = 2000;
const TX_TIMEOUT_MS = 6000;

/** Could not run in time (transaction expired, or the student's lock was not free). Nothing was written. */
function isBusyError(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code === "P2028") return true;
  let detail = e.message;
  try {
    detail += ` ${JSON.stringify(e.meta ?? {})}`;
  } catch {
    // meta that cannot be serialised must not replace the real error — the message alone decides.
  }
  return /55P03|lock timeout/i.test(detail);
}

export type ChangeFeeResult =
  | { ok: true; course: string; from: string; to: string }
  | { ok: false; error: string };

/**
 * Move one enrolment to another of Full / Half / 25%. ADMIN only, enforced HERE (AGENTS rule 10;
 * the button on the screen is a courtesy). Writes ONE column of ONE enrolment: no Payment row is
 * created or touched (rule 13) and every past payment keeps its own frozen amount, tier and share.
 * From then on, every month still unpaid for that course — earlier owed months included — is
 * charged at the new tier.
 *
 * Refused: an unknown or dropped enrolment, an inactive or unknown tier, the tier it already has,
 * and ANY change to or from a Free tier (multiplier 0): the Daily Summary derives "free" from the
 * current enrolments but counts payers from the payments' frozen tier, so switching a payer to or
 * from Free would make past days stop adding up.
 */
export async function changeFeeTier(enrolmentId: number, feeTierId: number): Promise<ChangeFeeResult> {
  const user = await requireRole(["ADMIN"]);

  const parsed = z.object({ enrolmentId: id, feeTierId: id }).safeParse({ enrolmentId, feeTierId });
  if (!parsed.success) return { ok: false, error: "Invalid enrolment or fee." };

  const first = await db.enrollment.findUnique({
    where: { id: parsed.data.enrolmentId },
    select: { studentId: true },
  });
  if (!first) return { ok: false, error: "That enrolment no longer exists." };
  const studentId = first.studentId;

  type Done = { refused: string } | { course: string; from: string; to: string; log: Record<string, unknown> };
  let done: Done;
  try {
    done = await db.$transaction(
      async (tx): Promise<Done> => {
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${LOCK_WAIT_MS}ms`}, true)`; // this transaction only
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${STUDENT_LOCK_NAMESPACE}::int, ${studentId}::int)`;

        // Everything is re-read under the lock: what the screen showed may be minutes old.
        const enrolment = await tx.enrollment.findUnique({
          where: { id: parsed.data.enrolmentId },
          select: {
            id: true,
            studentId: true,
            courseId: true,
            status: true,
            feeTier: { select: { id: true, code: true, label: true, multiplier: true } },
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
        if (!enrolment || enrolment.studentId !== studentId) return { refused: "That enrolment no longer exists." };
        if (enrolment.status !== "ACTIVE") return { refused: "Only a course the student is attending can change its fee." };

        const target = await tx.feeTier.findUnique({
          where: { id: parsed.data.feeTierId },
          select: { id: true, code: true, label: true, multiplier: true, active: true },
        });
        if (!target || !target.active) return { refused: "Select an active fee tier." };
        if (target.id === enrolment.feeTier.id) return { refused: `This course is already on ${target.label}.` };

        const isFree = (m: { toString(): string }) => Number(m.toString()) === 0;
        if (isFree(enrolment.feeTier.multiplier) || isFree(target.multiplier)) {
          return { refused: "The fee can only be changed between Full, Half and 25%. A Free course cannot be changed here." };
        }

        await tx.enrollment.update({ where: { id: enrolment.id }, data: { feeTierId: target.id } });

        const course = courseDisplayName(enrolment.course);
        return {
          course,
          from: enrolment.feeTier.label,
          to: target.label,
          log: {
            event: "fee-tier-changed",
            byUserId: user.id,
            byUsername: user.username,
            studentId,
            enrolmentId: enrolment.id,
            courseId: enrolment.courseId,
            fromTier: { id: enrolment.feeTier.id, code: enrolment.feeTier.code, label: enrolment.feeTier.label },
            toTier: { id: target.id, code: target.code, label: target.label },
          },
        };
      },
      { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS },
    );
  } catch (e) {
    if (isBusyError(e)) {
      return { ok: false, error: "The change didn't go through in time and nothing was changed. Try again." };
    }
    throw e;
  }

  if ("refused" in done) return { ok: false, error: done.refused };

  // The only audit trail without a table: this line, plus Enrollment.updatedAt.
  console.info(JSON.stringify(done.log));

  revalidatePath(PATH);
  return { ok: true, course: done.course, from: done.from, to: done.to };
}
