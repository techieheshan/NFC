"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOperationalAccess } from "@/lib/authz";
import { normalizeCardUid } from "@/lib/card-uid";
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

export type ActionState = { ok: boolean; error?: string };

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
  admissionPaid: boolean;
  enrolments: EnrolmentView[];
};

export type LookupResult =
  | { status: "invalid"; message: string }
  | { status: "new"; cardUid: string }
  | { status: "found"; student: StudentView };

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

const studentDetails = {
  name: z.string().trim().min(1, "Name is required.").max(120),
  phone: z.string().trim().min(1, "Phone is required.").max(30),
  school: z.string().trim().min(1, "School is required.").max(150),
  address: optionalText,
  nic: optionalText,
};

const id = z.coerce.number().int().positive();

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

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Step A: is this card known? Read-only, but still role-guarded. */
export async function lookupCard(rawUid: string): Promise<LookupResult> {
  await requireOperationalAccess();

  const parsed = uidSchema.safeParse(rawUid);
  if (!parsed.success) {
    return { status: "invalid", message: parsed.error.issues[0].message };
  }

  const cardUid = parsed.data;
  const student = await db.student.findUnique({
    where: { cardUid },
    include: studentInclude,
  });

  return student
    ? { status: "found", student: toStudentView(student) }
    : { status: "new", cardUid };
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

  const parsed = z
    .object({ ...studentDetails, cardUid: uidSchema })
    .safeParse({
      name: formData.get("name"),
      phone: formData.get("phone"),
      school: formData.get("school"),
      address: formData.get("address") ?? "",
      nic: formData.get("nic") ?? "",
      cardUid: formData.get("cardUid"),
    });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const rawRows = readEnrolments(formData);
  if (!rawRows) return { ok: false, error: "Enrolment rows are malformed." };

  const rows = enrolmentSchema.safeParse(rawRows);
  if (!rows.success) {
    return { ok: false, error: rows.error.issues[0].message };
  }

  const refError = await assertEnrolmentRefs(rows.data);
  if (refError) return { ok: false, error: refError };

  const photo = await readPhoto(formData);
  if (typeof photo === "string") return { ok: false, error: photo };

  let uploadedFor: number | null = null;

  try {
    await db.$transaction(
      async (tx) => {
        // admissionPaid deliberately left at its default false — no money is
        // charged during registration.
        const student = await tx.student.create({ data: parsed.data });

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
      return { ok: false, error: "That card is already assigned to a student." };
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

export async function updateStudent(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOperationalAccess();

  const parsed = z
    .object({ studentId: id, ...studentDetails })
    .safeParse({
      studentId: formData.get("studentId"),
      name: formData.get("name"),
      phone: formData.get("phone"),
      school: formData.get("school"),
      address: formData.get("address") ?? "",
      nic: formData.get("nic") ?? "",
    });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { studentId, ...details } = parsed.data;
  await db.student.update({ where: { id: studentId }, data: details });

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
