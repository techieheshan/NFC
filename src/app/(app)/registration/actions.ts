"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOperationalAccess } from "@/lib/authz";
import { normalizeCardNumber, normalizeCardUid } from "@/lib/card-uid";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/prisma-errors";
import {
  MAX_PHOTO_BYTES,
  deleteStudentPhoto,
  uploadStudentPhoto,
  type PhotoUpload,
} from "@/lib/photo";

const PATH = "/registration";

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
  status: "ACTIVE" | "DROPPED";
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
      status: e.status,
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
    ? { status: "found", student: toStudentView(student), captured }
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

  return student ? toStudentView(student) : null;
}
