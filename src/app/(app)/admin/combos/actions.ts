"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOperationalAccess } from "@/lib/authz";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";

const PATH = "/admin/combos";

export type ActionState = { ok: boolean; error?: string };

export type TeacherOption = { id: number; name: string };

export type CourseOption = {
  id: number;
  label: string;
  defaultFee: string;
};

export type ComboItemRow = {
  courseId: number;
  course: string;
  comboFee: string;
  defaultFee: string;
};

export type ComboRow = {
  id: number;
  name: string;
  teacherId: number;
  teacher: string;
  active: boolean;
  items: ComboItemRow[];
  comboTotal: string;
  defaultTotal: string;
};

const id = z.coerce.number().int().positive();
const money = (n: number) => n.toFixed(2);

const feeSchema = z.coerce
  .number()
  .refine(Number.isFinite, "Enter a valid combo fee.")
  .min(0, "Combo fees cannot be negative.")
  .max(99_999_999, "Combo fee is too large.");

/** Parallel `courseId` / `comboFee` inputs, one pair per selected course. */
function readItems(formData: FormData) {
  const courseIds = formData.getAll("courseId").map(String).filter((v) => v !== "");
  const fees = formData.getAll("comboFee").map(String);
  if (courseIds.length !== fees.length) return null;
  return courseIds.map((c, i) => ({ courseId: c, comboFee: fees[i] }));
}

const itemsSchema = z
  .array(z.object({ courseId: id, comboFee: feeSchema }))
  .min(2, "A combo needs at least two courses.");

// ---------------------------------------------------------------------------
// Reads — guarded like the writes; combo pricing is commercial information.
// ---------------------------------------------------------------------------

export async function listCombos(): Promise<ComboRow[]> {
  await requireOperationalAccess();

  const rows = await db.combo.findMany({
    include: {
      teacher: { select: { name: true } },
      items: {
        include: {
          course: {
            select: {
              name: true,
              defaultFee: true,
              teacher: { select: { name: true } },
              subject: { select: { label: true } },
              grade: { select: { label: true } },
              classType: { select: { label: true } },
            },
          },
        },
        orderBy: { id: "asc" },
      },
    },
    orderBy: [{ active: "desc" }, { id: "desc" }],
  });

  return rows.map((c) => {
    const items = c.items.map((i) => ({
      courseId: i.courseId,
      course: courseDisplayName(i.course),
      comboFee: money(Number(String(i.comboFee))),
      defaultFee: money(Number(String(i.course.defaultFee))),
    }));
    return {
      id: c.id,
      name: c.name,
      teacherId: c.teacherId,
      teacher: c.teacher.name,
      active: c.active,
      items,
      comboTotal: money(items.reduce((s, i) => s + Number(i.comboFee), 0)),
      defaultTotal: money(items.reduce((s, i) => s + Number(i.defaultFee), 0)),
    };
  });
}

/**
 * Every active course — the pool a combo can be built from.
 *
 * No longer scoped to one teacher: a combo may span them. The label carries the
 * teacher's name (courseDisplayName does that), so a mixed combo is readable
 * while it is being assembled.
 */
export async function comboCoursePool(): Promise<CourseOption[]> {
  await requireOperationalAccess();

  const rows = await db.course.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      defaultFee: true,
      teacher: { select: { name: true } },
      subject: { select: { label: true } },
      grade: { select: { label: true } },
      classType: { select: { label: true } },
    },
    orderBy: { id: "asc" },
  });

  return rows.map((c) => ({
    id: c.id,
    label: courseDisplayName(c),
    defaultFee: money(Number(String(c.defaultFee))),
  }));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * A combo may now span teachers, so the only requirement is that every course
 * is real and active.
 *
 * The old rule assumed a cross-teacher combo would be unpriceable. It isn't:
 * the combo changes the PRICE COLLECTED, while each row still records its own
 * course, its own teacher and that course's own frozen institute % — so payroll
 * splits per course exactly as before, with no payslip changes at all.
 * `Combo.teacherId` remains, as the teacher the combo is filed under.
 */
async function assertCoursesExist(courseIds: number[]): Promise<string | null> {
  const found = await db.course.count({
    where: { id: { in: courseIds }, active: true },
  });
  return found === courseIds.length ? null : "Every course in a combo must be active.";
}

function parseCombo(formData: FormData) {
  const rawItems = readItems(formData);
  if (!rawItems) return { error: "Course rows are malformed." } as const;

  const items = itemsSchema.safeParse(rawItems);
  if (!items.success) return { error: items.error.issues[0].message } as const;

  const unique = new Set(items.data.map((i) => i.courseId));
  if (unique.size !== items.data.length) {
    return { error: "The same course is listed twice." } as const;
  }

  const teacherId = id.safeParse(formData.get("teacherId"));
  const name = z
    .string()
    .trim()
    .min(1, "Give the combo a name.")
    .max(150)
    .safeParse(formData.get("name"));

  if (!teacherId.success) return { error: "Select a teacher." } as const;
  if (!name.success) return { error: name.error.issues[0].message } as const;

  return { teacherId: teacherId.data, name: name.data, items: items.data } as const;
}

export async function createCombo(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOperationalAccess();

  const parsed = parseCombo(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const bad = await assertCoursesExist(parsed.items.map((i) => i.courseId));
  if (bad) return { ok: false, error: bad };

  await db.combo.create({
    data: {
      name: parsed.name,
      teacherId: parsed.teacherId,
      items: {
        create: parsed.items.map((i) => ({
          courseId: i.courseId,
          comboFee: money(i.comboFee),
        })),
      },
    },
  });

  revalidatePath(PATH);
  return { ok: true };
}

export async function updateCombo(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOperationalAccess();

  const comboId = id.safeParse(formData.get("id"));
  if (!comboId.success) return { ok: false, error: "Invalid combo." };

  const parsed = parseCombo(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const bad = await assertCoursesExist(parsed.items.map((i) => i.courseId));
  if (bad) return { ok: false, error: bad };

  // Items are replaced wholesale — ComboItem carries no history of its own, and
  // past payments reference the Combo, not its items.
  await db.$transaction([
    db.comboItem.deleteMany({ where: { comboId: comboId.data } }),
    db.combo.update({
      where: { id: comboId.data },
      data: {
        name: parsed.name,
        teacherId: parsed.teacherId,
        items: {
          create: parsed.items.map((i) => ({
            courseId: i.courseId,
            comboFee: money(i.comboFee),
          })),
        },
      },
    }),
  ]);

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Soft delete only. Past payments carry `comboId`, so a combo must survive as
 * the audit trail for a discount that was applied or refused.
 */
export async function setComboActive(formData: FormData): Promise<void> {
  await requireOperationalAccess();

  const comboId = id.safeParse(formData.get("id"));
  if (!comboId.success) return;

  await db.combo.update({
    where: { id: comboId.data },
    data: { active: formData.get("active") === "true" },
  });

  revalidatePath(PATH);
}
