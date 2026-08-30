"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { UserRole } from "@prisma/client";

import { requireRole } from "@/lib/authz";
import { colomboNow, to12Hour } from "@/lib/colombo-time";
import { hashPassword, passwordField, usernameField } from "@/lib/credentials";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/prisma-errors";

const PATH = "/user-roles";

/**
 * ADMIN and nothing else — on the reads as well as the writes. The user list
 * names every login in the institute, so `listUsers` is guarded exactly as
 * hard as `resetPassword`: a server action is its own HTTP endpoint, and the
 * page guard does not cover it.
 */
const ADMIN = ["ADMIN"] as UserRole[];

export type ActionState = {
  ok: boolean;
  error?: string;
  values?: Record<string, string>;
};

export type UserRow = {
  id: string;
  username: string;
  role: UserRole;
  active: boolean;
  /** TEACHER/STAFF logins are linked to a person; ADMIN logins are not. */
  linkedTo: string | null;
  /** The signed-in admin's own row, which they may not deactivate. */
  isSelf: boolean;
  /** Colombo time the login lockout lifts, or null when not locked. */
  lockedUntil: string | null;
  /** Still using an admin-chosen password; forced to change it at next login. */
  mustChangePassword: boolean;
};

function echo(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    // Never echo a password back into the DOM — a validation error must not
    // put the plaintext into the rendered HTML.
    if (typeof v === "string" && !k.toLowerCase().includes("password")) out[k] = v;
  }
  return out;
}

const fail = (formData: FormData, error: string): ActionState => ({
  ok: false,
  error,
  values: echo(formData),
});

export async function listUsers(): Promise<UserRow[]> {
  const me = await requireRole(ADMIN);

  const users = await db.user.findMany({
    select: {
      id: true,
      username: true,
      role: true,
      active: true,
      lockedUntil: true,
      mustChangePassword: true,
      teacher: { select: { name: true } },
      staff: { select: { name: true } },
    },
    // Inactive last, then admins first, then alphabetical — the shape of the
    // list matches how it is read: who can do what, and who is switched off.
    orderBy: [{ active: "desc" }, { role: "asc" }, { username: "asc" }],
  });

  return users.map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    active: u.active,
    linkedTo: u.teacher?.name ?? u.staff?.name ?? null,
    isSelf: u.id === me.id,
    // Only surfaced while the lock is actually in force; a stale timestamp
    // from last week is noise on the screen.
    lockedUntil:
      u.lockedUntil && u.lockedUntil > new Date()
        ? to12Hour(colomboNow(u.lockedUntil).time)
        : null,
    mustChangePassword: u.mustChangePassword,
  }));
}

/**
 * Create an ADMIN or STAFF login.
 *
 * TEACHER is deliberately not offered: a teacher login must be attached to a
 * Teacher row, and Setup → Teachers already creates both in one transaction.
 * Allowing TEACHER here would produce a login with no teacher, whose payslip
 * screen has nothing to scope to.
 */
export async function createUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(ADMIN);

  const parsed = z
    .object({
      username: usernameField,
      password: passwordField,
      role: z.enum(["ADMIN", "STAFF"], {
        message: "Pick a role. Teacher logins are created under Setup → Teachers.",
      }),
    })
    .safeParse({
      username: formData.get("username"),
      password: formData.get("password"),
      role: formData.get("role"),
    });

  if (!parsed.success) return fail(formData, parsed.error.issues[0].message);

  const { username, password, role } = parsed.data;

  try {
    await db.user.create({
      data: {
        username,
        role,
        passwordHash: await hashPassword(password),
        // The admin picked this one, so it is a handover token, not a password.
        // The account cannot reach the app until its owner replaces it.
        mustChangePassword: true,
      },
    });
  } catch (error) {
    // The unique index is the authority; a pre-check would still race.
    if (isUniqueViolation(error)) {
      return fail(formData, `Username "${username}" is already taken.`);
    }
    throw error;
  }

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Set a new password for anyone, without the old one.
 *
 * That asymmetry is the point: an admin resets a password for someone who has
 * forgotten it, and closes the bootstrap default by resetting their own.
 * Knowing the current password is not evidence of anything an admin lacks.
 *
 * A reset is also a security event: it revokes every session that user already
 * holds, clears any lockout (this is how an admin rescues someone locked out),
 * and forces them to replace the admin-chosen password at next login.
 */
export async function resetPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(ADMIN);

  const parsed = z
    .object({ id: z.string().min(1), password: passwordField })
    .safeParse({ id: formData.get("id"), password: formData.get("password") });

  if (!parsed.success) return fail(formData, parsed.error.issues[0].message);

  const target = await db.user.findUnique({
    where: { id: parsed.data.id },
    select: { id: true },
  });
  if (!target) return fail(formData, "That user no longer exists.");

  await db.user.update({
    where: { id: target.id },
    data: {
      passwordHash: await hashPassword(parsed.data.password),
      tokenVersion: { increment: 1 },
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Deactivate or reactivate a login. Never a delete: payments, attendance and
 * expenses all point at the user who recorded them, and the audit trail has to
 * survive the person leaving.
 *
 * Two guards, both server-side, because both are ways to lock everyone out:
 *   • an admin cannot switch off their own login
 *   • the last active ADMIN cannot be switched off
 *
 * Deactivating bumps `tokenVersion`, which is what ends a session the person is
 * already holding — the account flag alone only stops the next login, and a
 * stateless JWT would happily outlive it.
 */
export async function setUserActive(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const me = await requireRole(ADMIN);

  const parsed = z
    .object({ id: z.string().min(1), active: z.enum(["true", "false"]) })
    .safeParse({ id: formData.get("id"), active: formData.get("active") });

  if (!parsed.success) return fail(formData, "Invalid request.");

  const active = parsed.data.active === "true";

  const target = await db.user.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, username: true, role: true, active: true },
  });
  if (!target) return fail(formData, "That user no longer exists.");

  if (!active) {
    if (target.id === me.id) {
      return fail(formData, "You can't deactivate your own login.");
    }

    // Counted excluding the target, so this holds however many admins exist.
    const otherActiveAdmins = await db.user.count({
      where: { role: "ADMIN", active: true, id: { not: target.id } },
    });
    if (target.role === "ADMIN" && otherActiveAdmins === 0) {
      return fail(
        formData,
        "This is the last active admin. Create or reactivate another admin first.",
      );
    }
  }

  await db.user.update({
    where: { id: target.id },
    data: active
      ? // Reactivating also lifts any lockout, so an admin can rescue someone
        // who locked themselves out rather than making them wait it out.
        { active: true, failedLoginCount: 0, lockedUntil: null }
      : { active: false, tokenVersion: { increment: 1 } },
  });

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Sign a user out everywhere, without touching their password.
 *
 * For the "I left it signed in on the counter tablet" case, and for an admin
 * who suspects a session is in the wrong hands. Bumping the version is the
 * whole mechanism — there is no session table to delete rows from.
 */
export async function logOutAllSessions(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireRole(ADMIN);

  const parsed = z.object({ id: z.string().min(1) }).safeParse({ id: formData.get("id") });
  if (!parsed.success) return fail(formData, "Invalid request.");

  const target = await db.user.findUnique({
    where: { id: parsed.data.id },
    select: { id: true },
  });
  if (!target) return fail(formData, "That user no longer exists.");

  await db.user.update({
    where: { id: target.id },
    data: { tokenVersion: { increment: 1 } },
  });

  revalidatePath(PATH);
  return { ok: true };
}
