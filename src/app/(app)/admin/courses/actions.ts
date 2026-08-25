"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSetupAccess } from "@/lib/authz";
import { db } from "@/lib/db";

const PATH = "/admin/courses";

export type ActionState = { ok: boolean; error?: string };

const id = z.coerce.number().int().positive();

/**
 * Money and percentages are `Decimal` columns. Values are validated as numbers
 * for range checks, then handed to Prisma as fixed 2dp strings so nothing ever
 * round-trips through float formatting.
 */
const money = z.coerce
  .number()
  .refine(Number.isFinite, "Enter a valid amount.")
  .min(0, "Amount cannot be negative.")
  .max(99_999_999, "Amount is too large.");

const percent = z.coerce
  .number()
  .refine(Number.isFinite, "Enter a valid percentage.")
  .min(0, "Share must be between 0 and 100.")
  .max(100, "Share must be between 0 and 100.");

const courseSchema = z.object({
  teacherId: id,
  subjectId: id,
  gradeId: id,
  streamId: id,
  classTypeId: id,
  defaultFee: money,
  instituteSharePercent: percent,
  instituteFee: money,
  // Only persisted when staff actually typed one; blank stays NULL so the
  // display name stays derived. See src/lib/course-name.ts.
  name: z
    .string()
    .trim()
    .max(150)
    .transform((v) => (v === "" ? null : v))
    .nullable(),
});

function readForm(formData: FormData) {
  return {
    teacherId: formData.get("teacherId"),
    subjectId: formData.get("subjectId"),
    gradeId: formData.get("gradeId"),
    streamId: formData.get("streamId"),
    classTypeId: formData.get("classTypeId"),
    defaultFee: formData.get("defaultFee") ?? "0",
    instituteSharePercent: formData.get("instituteSharePercent"),
    instituteFee: formData.get("instituteFee") ?? "0",
    name: formData.get("name") ?? "",
  };
}

/**
 * Every foreign key must point at a row that exists AND is still active —
 * otherwise a course could be attached to a deactivated teacher or subject by
 * replaying an old form.
 */
async function assertActiveRefs(data: {
  teacherId: number;
  subjectId: number;
  gradeId: number;
  streamId: number;
  classTypeId: number;
}): Promise<string | null> {
  const [teacher, subject, grade, stream, classType] = await Promise.all([
    db.teacher.findFirst({ where: { id: data.teacherId, active: true }, select: { id: true } }),
    db.subject.findFirst({ where: { id: data.subjectId, active: true }, select: { id: true } }),
    db.grade.findFirst({ where: { id: data.gradeId, active: true }, select: { id: true } }),
    db.stream.findFirst({ where: { id: data.streamId, active: true }, select: { id: true } }),
    db.classType.findFirst({ where: { id: data.classTypeId, active: true }, select: { id: true } }),
  ]);

  if (!teacher) return "Select an active teacher.";
  if (!subject) return "Select an active subject.";
  if (!grade) return "Select an active grade.";
  if (!stream) return "Select an active stream.";
  if (!classType) return "Select an active class type.";
  return null;
}

function toDecimals(parsed: z.infer<typeof courseSchema>) {
  return {
    teacherId: parsed.teacherId,
    subjectId: parsed.subjectId,
    gradeId: parsed.gradeId,
    streamId: parsed.streamId,
    classTypeId: parsed.classTypeId,
    name: parsed.name,
    defaultFee: parsed.defaultFee.toFixed(2),
    instituteSharePercent: parsed.instituteSharePercent.toFixed(2),
    instituteFee: parsed.instituteFee.toFixed(2),
  };
}

export async function createCourse(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSetupAccess();

  const parsed = courseSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const refError = await assertActiveRefs(parsed.data);
  if (refError) return { ok: false, error: refError };

  await db.course.create({ data: toDecimals(parsed.data) });

  revalidatePath(PATH);
  return { ok: true };
}

export async function updateCourse(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSetupAccess();

  const courseId = id.safeParse(formData.get("id"));
  if (!courseId.success) return { ok: false, error: "Invalid course." };

  const parsed = courseSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const refError = await assertActiveRefs(parsed.data);
  if (refError) return { ok: false, error: refError };

  await db.course.update({
    where: { id: courseId.data },
    data: toDecimals(parsed.data),
  });

  revalidatePath(PATH);
  return { ok: true };
}

export async function setCourseActive(formData: FormData): Promise<void> {
  await requireSetupAccess();

  const courseId = id.safeParse(formData.get("id"));
  if (!courseId.success) return;

  await db.course.update({
    where: { id: courseId.data },
    data: { active: formData.get("active") === "true" },
  });

  revalidatePath(PATH);
}
