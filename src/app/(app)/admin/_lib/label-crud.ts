import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSetupAccess } from "@/lib/authz";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/prisma-errors";

/**
 * Subject and Grade are the same entity shape — `label` + `active` — so their
 * CRUD lives here once and each route exposes thin "use server" wrappers.
 *
 * The model is switched explicitly rather than through a shared delegate type:
 * Prisma's per-model delegates are nominally distinct, and spelling out both
 * branches keeps full type-safety for two extra lines.
 */
export type LabelModel = "subject" | "grade";

export type LabelRow = {
  id: number;
  label: string;
  active: boolean;
};

export type ActionState = {
  ok: boolean;
  /** Non-null only after a failed attempt; rendered next to the form. */
  error?: string;
};

const NOUN: Record<LabelModel, string> = {
  subject: "Subject",
  grade: "Grade",
};

const labelSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Label is required.")
    .max(100, "Label must be 100 characters or fewer."),
});

const idSchema = z.coerce.number().int().positive();

export function listLabels(model: LabelModel): Promise<LabelRow[]> {
  const select = { id: true, label: true, active: true } as const;
  // Active first, then alphabetical — deactivated rows stay visible but sink.
  const orderBy = [{ active: "desc" }, { label: "asc" }] as const;

  return model === "subject"
    ? db.subject.findMany({ select, orderBy: [...orderBy] })
    : db.grade.findMany({ select, orderBy: [...orderBy] });
}

export async function createLabel(
  model: LabelModel,
  path: string,
  formData: FormData,
): Promise<ActionState> {
  await requireSetupAccess();

  const parsed = labelSchema.safeParse({ label: formData.get("label") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { label } = parsed.data;

  try {
    if (model === "subject") {
      await db.subject.create({ data: { label } });
    } else {
      await db.grade.create({ data: { label } });
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: `${NOUN[model]} "${label}" already exists.` };
    }
    throw error;
  }

  revalidatePath(path);
  return { ok: true };
}

export async function updateLabel(
  model: LabelModel,
  path: string,
  formData: FormData,
): Promise<ActionState> {
  await requireSetupAccess();

  const id = idSchema.safeParse(formData.get("id"));
  const parsed = labelSchema.safeParse({ label: formData.get("label") });

  if (!id.success) return { ok: false, error: "Invalid record." };
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { label } = parsed.data;

  try {
    if (model === "subject") {
      await db.subject.update({ where: { id: id.data }, data: { label } });
    } else {
      await db.grade.update({ where: { id: id.data }, data: { label } });
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: `${NOUN[model]} "${label}" already exists.` };
    }
    throw error;
  }

  revalidatePath(path);
  return { ok: true };
}

/**
 * Soft delete. These rows are referenced by Courses (and later by enrolments),
 * so they are never removed — only flipped inactive, and reversibly.
 */
export async function setLabelActive(
  model: LabelModel,
  path: string,
  formData: FormData,
): Promise<void> {
  await requireSetupAccess();

  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;

  const active = formData.get("active") === "true";

  if (model === "subject") {
    await db.subject.update({ where: { id: id.data }, data: { active } });
  } else {
    await db.grade.update({ where: { id: id.data }, data: { active } });
  }

  revalidatePath(path);
}
