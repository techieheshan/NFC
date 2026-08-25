"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { requireSetupAccess } from "@/lib/authz";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/prisma-errors";

const PATH = "/admin/teachers";

export type ActionState = { ok: boolean; error?: string };

/** Blank optional inputs arrive as "" from HTML forms; store NULL, not "". */
const optionalText = z
  .string()
  .trim()
  .max(100)
  .transform((v) => (v === "" ? null : v))
  .nullable();

/**
 * `joinDate` is `@db.Date`. Parsing at UTC midnight keeps the stored calendar
 * day identical to the one staff typed regardless of server timezone.
 */
const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Invalid join date.")
  .transform((v) => (v === null ? null : new Date(`${v}T00:00:00.000Z`)));

const teacherFields = {
  name: z.string().trim().min(1, "Name is required.").max(120),
  nic: optionalText,
  phone: optionalText,
  joinDate: optionalDate,
};

const usernameField = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(50)
  .regex(/^[a-zA-Z0-9._-]+$/, "Username may use letters, numbers, . _ - only.");

const createSchema = z.object({
  ...teacherFields,
  username: usernameField,
  // Staff set this once at creation; resetting it belongs to the User/Roles tag.
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
});

const updateSchema = z.object({
  id: z.coerce.number().int().positive(),
  ...teacherFields,
  username: usernameField.optional(),
});

const idSchema = z.coerce.number().int().positive();

function fields(formData: FormData) {
  return {
    name: formData.get("name"),
    nic: formData.get("nic") ?? "",
    phone: formData.get("phone") ?? "",
    joinDate: formData.get("joinDate") ?? "",
  };
}

export async function createTeacher(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSetupAccess();

  const parsed = createSchema.safeParse({
    ...fields(formData),
    username: formData.get("username"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { username, password, ...teacher } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    // Both writes or neither: a duplicate username must not leave an orphan
    // Teacher row behind.
    await db.$transaction(async (tx) => {
      const created = await tx.teacher.create({ data: teacher });
      await tx.user.create({
        data: {
          username,
          passwordHash,
          role: "TEACHER",
          teacherId: created.id,
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: `Username "${username}" is already taken.` };
    }
    throw error;
  }

  revalidatePath(PATH);
  return { ok: true };
}

export async function updateTeacher(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSetupAccess();

  const rawUsername = formData.get("username");
  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    ...fields(formData),
    ...(rawUsername ? { username: rawUsername } : {}),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { id, username, ...teacher } = parsed.data;

  try {
    await db.$transaction(async (tx) => {
      await tx.teacher.update({ where: { id }, data: teacher });

      // Only teachers that actually have a login can have it renamed. Creating
      // a missing login needs a password, which this tag deliberately omits.
      if (username) {
        await tx.user.updateMany({
          where: { teacherId: id },
          data: { username },
        });
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: `Username "${username}" is already taken.` };
    }
    throw error;
  }

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Soft delete, and it must reach the login: a deactivated teacher who could
 * still sign in would be a live account nobody thinks exists.
 */
export async function setTeacherActive(formData: FormData): Promise<void> {
  await requireSetupAccess();

  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;

  const active = formData.get("active") === "true";

  await db.$transaction([
    db.teacher.update({ where: { id: id.data }, data: { active } }),
    db.user.updateMany({ where: { teacherId: id.data }, data: { active } }),
  ]);

  revalidatePath(PATH);
}
