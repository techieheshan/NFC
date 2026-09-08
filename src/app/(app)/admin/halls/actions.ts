"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSetupAccess } from "@/lib/authz";
import { db } from "@/lib/db";
import { DEFAULT_HALL_ICON, HALL_ICON_KEYS } from "@/lib/hall-icons";
import { isUniqueViolation } from "@/lib/prisma-errors";

export type ActionState = { ok: boolean; error?: string };

const PATH = "/admin/halls";

const hallSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100, "Name must be 100 characters or fewer."),
  // An icon key the app actually knows; anything else would render the
  // fallback forever with no way to tell why.
  icon: z.string().refine((v) => HALL_ICON_KEYS.includes(v), "Pick an icon."),
});
const idSchema = z.coerce.number().int().positive();

export async function createHall(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSetupAccess();

  const parsed = hallSchema.safeParse({
    name: formData.get("name"),
    icon: formData.get("icon") ?? DEFAULT_HALL_ICON,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  try {
    await db.hall.create({ data: parsed.data });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: `Hall "${parsed.data.name}" already exists.` };
    throw error;
  }

  revalidatePath(PATH);
  return { ok: true };
}

export async function updateHall(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSetupAccess();

  const id = idSchema.safeParse(formData.get("id"));
  const parsed = hallSchema.safeParse({ name: formData.get("name"), icon: formData.get("icon") });
  if (!id.success) return { ok: false, error: "Invalid record." };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  try {
    await db.hall.update({ where: { id: id.data }, data: parsed.data });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: `Hall "${parsed.data.name}" already exists.` };
    throw error;
  }

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Soft-delete only. Schedules, one-off classes and past overrides point at a
 * hall; a deactivated room stops being offered but every row that used it still
 * reads correctly.
 */
export async function setHallActive(formData: FormData): Promise<void> {
  await requireSetupAccess();

  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;

  await db.hall.update({
    where: { id: id.data },
    data: { active: formData.get("active") === "true" },
  });
  revalidatePath(PATH);
}
