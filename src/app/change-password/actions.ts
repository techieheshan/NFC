"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth, signIn } from "@/auth";
import { hashPassword, passwordField } from "@/lib/credentials";
import { db } from "@/lib/db";

export type ActionState = { ok: boolean; error?: string };

/**
 * Change your own password.
 *
 * Two modes, one action:
 *   forced    — the account is flagged `mustChangePassword`, so the person set
 *               nothing themselves yet and the old password is one an admin
 *               chose. Only the new password is asked for.
 *   voluntary — anyone changing their own password proves they know the current
 *               one first.
 *
 * Either way `tokenVersion` is bumped, which kills every other session this
 * user has. The current session is then re-minted with the new password, so
 * the person changing it stays signed in and everyone else is thrown out.
 */
export async function changeOwnPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Your session has expired. Sign in again." };

  const parsed = z
    .object({
      current: z.string().optional(),
      password: passwordField,
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, {
      message: "The two passwords do not match.",
    })
    .safeParse({
      current: String(formData.get("current") ?? ""),
      password: String(formData.get("password") ?? ""),
      confirm: String(formData.get("confirm") ?? ""),
    });

  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, username: true, passwordHash: true, mustChangePassword: true },
  });
  if (!user) return { ok: false, error: "Your account no longer exists." };

  if (!user.mustChangePassword) {
    const current = parsed.data.current ?? "";
    if (!current) return { ok: false, error: "Enter your current password." };
    if (!(await bcrypt.compare(current, user.passwordHash))) {
      return { ok: false, error: "That is not your current password." };
    }
  }

  if (await bcrypt.compare(parsed.data.password, user.passwordHash)) {
    return { ok: false, error: "Choose a password you have not used here before." };
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(parsed.data.password),
      mustChangePassword: false,
      // Revokes every token minted before this moment, including any session
      // an admin or an attacker still holds for this account.
      tokenVersion: { increment: 1 },
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });

  // Re-sign-in with the password just set: the bump above invalidated this
  // session too, and signing the person out of their own password change would
  // be a strange way to reward them.
  await signIn("credentials", {
    username: user.username,
    password: parsed.data.password,
    redirect: false,
  });

  redirect("/");
}
