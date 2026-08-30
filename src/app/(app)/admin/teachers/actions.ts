"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSetupAccess } from "@/lib/authz";
import { hashPassword, passwordField, usernameField } from "@/lib/credentials";
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

const createSchema = z.object({
  ...teacherFields,
  username: usernameField,
  // Set once here; resetting it later is User/Roles' job, on /user-roles.
  password: passwordField,
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
  const passwordHash = await hashPassword(password);

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

/**
 * Reset a TEACHER's login password. ADMIN + STAFF.
 *
 * The front desk fixing a forgotten password is routine, so it does not need an
 * administrator — but it is deliberately the ONLY account power staff have.
 * `requireSetupAccess` lets them in; the role check below is what keeps them
 * out of admin and staff accounts, and it is a server check because hiding the
 * control would protect nothing (this is its own HTTP endpoint).
 *
 * The consequences are Auth Hardening's, unchanged: the teacher must choose
 * their own password at next login, every session they hold is revoked, and any
 * lockout is lifted — which is the other half of "the front desk can rescue me".
 */
export async function resetTeacherPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSetupAccess();

  const parsed = z
    .object({ userId: z.string().min(1), password: passwordField })
    .safeParse({ userId: formData.get("userId"), password: formData.get("password") });

  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const target = await db.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, role: true, username: true },
  });
  if (!target) return { ok: false, error: "That login no longer exists." };

  // The whole point of this action. An admin resetting an admin goes through
  // User Roles, which is ADMIN-only.
  if (target.role !== "TEACHER") {
    return {
      ok: false,
      error: "Only teacher logins can be reset here. Use User Roles for admin and staff accounts.",
    };
  }

  await db.user.update({
    where: { id: target.id },
    data: {
      passwordHash: await hashPassword(parsed.data.password),
      mustChangePassword: true,
      tokenVersion: { increment: 1 },
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  revalidatePath(PATH);
  return { ok: true };
}
