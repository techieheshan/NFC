"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOperationalAccess } from "@/lib/authz";
import { colomboDateValue, colomboNow } from "@/lib/colombo-time";
import { db } from "@/lib/db";
import { classesForDate, clashesFor, type AllocatedClass } from "@/lib/halls";

export type AllocationResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

const dateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const kindSchema = z.enum(["SCHEDULE", "ADDITIONAL"]);
const idSchema = z.coerce.number().int().positive();

/** A read is its own endpoint, so it is guarded exactly like a write. */
export async function loadAllocation(date: string): Promise<AllocatedClass[]> {
  await requireOperationalAccess();
  const parsed = dateSchema.safeParse(date);
  return classesForDate(parsed.success ? parsed.data : colomboNow().date);
}

/**
 * Move one class to another hall FOR ONE DATE.
 *
 * This writes (or clears) a `HallAllocationOverride` and touches nothing else:
 * `Schedule.defaultHallId` is left alone on purpose, so tomorrow the class is
 * back in its usual room. Sending an empty hall removes the override, which is
 * how staff undo a reassignment rather than by setting the old room by hand.
 *
 * A clash is REPORTED, never enforced: two classes genuinely do share a room
 * sometimes, and a system that refuses the save just gets worked around.
 */
export async function reassignHall(formData: FormData): Promise<AllocationResult> {
  const user = await requireOperationalAccess();

  const date = dateSchema.safeParse(formData.get("date"));
  const kind = kindSchema.safeParse(formData.get("kind"));
  const id = idSchema.safeParse(formData.get("classId"));
  const rawHall = String(formData.get("hallId") ?? "");
  const hallId = rawHall === "" ? null : idSchema.safeParse(rawHall);

  if (!date.success || !kind.success || !id.success) {
    return { ok: false, error: "That class could not be identified." };
  }
  if (hallId !== null && !hallId.success) {
    return { ok: false, error: "Pick a hall." };
  }

  const dateValue = colomboDateValue(date.data);
  const where =
    kind.data === "SCHEDULE"
      ? { date_scheduleId: { date: dateValue, scheduleId: id.data } }
      : { date_additionalClassId: { date: dateValue, additionalClassId: id.data } };

  if (hallId === null) {
    // Back to the class's own default for that day.
    await db.hallAllocationOverride.deleteMany({
      where:
        kind.data === "SCHEDULE"
          ? { date: dateValue, scheduleId: id.data }
          : { date: dateValue, additionalClassId: id.data },
    });
  } else {
    const hall = await db.hall.findUnique({ where: { id: hallId.data }, select: { active: true } });
    if (!hall?.active) return { ok: false, error: "That hall is not available." };

    await db.hallAllocationOverride.upsert({
      where,
      create: {
        date: dateValue,
        hallId: hallId.data,
        createdById: user.id,
        ...(kind.data === "SCHEDULE" ? { scheduleId: id.data } : { additionalClassId: id.data }),
      },
      update: { hallId: hallId.data, createdById: user.id },
    });
  }

  // Re-resolved from the same helper every screen reads, purely to see what the
  // save landed next to. The grid itself is re-rendered by revalidatePath —
  // the rows are never held in client state, so there is one source of truth.
  const classes = await classesForDate(date.data);
  const moved = classes.find((c) => c.kind === kind.data && c.id === id.data);

  let warning: string | undefined;
  if (moved?.hall) {
    const clashes = clashesFor(moved, moved.hall.id, classes);
    if (clashes.length > 0) {
      warning = `${moved.hall.name} is already allocated to ${clashes
        .map((c) => `${c.course} (${c.startTime}–${c.endTime})`)
        .join(", ")} at this time. Saved anyway.`;
    }
  }

  revalidatePath("/hall-allocation");
  return { ok: true, warning };
}
