"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSetupAccess } from "@/lib/authz";
import { db } from "@/lib/db";

export type ActionState = { ok: boolean; error?: string };

const PATH = "/admin/streams";

const idSchema = z.coerce.number().int().positive();

/**
 * Replace one stream's subject list with exactly what was ticked.
 *
 * `set` rather than connect/disconnect: the form submits the whole list, so the
 * saved state is the screen's state — no drift from a checkbox whose unchecking
 * never reached the server. Unticking a subject only removes the LINK; the
 * subject and any course using it are untouched.
 */
export async function setStreamSubjects(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSetupAccess();

  const streamId = idSchema.safeParse(formData.get("streamId"));
  if (!streamId.success) return { ok: false, error: "Invalid stream." };

  const ids: number[] = [];
  for (const raw of formData.getAll("subjectId")) {
    const parsed = idSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Invalid subject." };
    ids.push(parsed.data);
  }

  await db.stream.update({
    where: { id: streamId.data },
    data: { subjects: { set: ids.map((id) => ({ id })) } },
  });

  revalidatePath(PATH);
  return { ok: true };
}
