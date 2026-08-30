import { requireNavAccess } from "@/lib/authz";
import { db } from "@/lib/db";

import { createTeacher, resetTeacherPassword, setTeacherActive, updateTeacher } from "./actions";
import { TeacherManager, type TeacherRow } from "./teacher-manager";

export const metadata = { title: "Teachers" };

/** `@db.Date` values carry no meaningful time; render the calendar day as-is. */
function toDateInput(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export default async function TeachersPage() {
  await requireNavAccess("/admin/teachers");

  const teachers = await db.teacher.findMany({
    select: {
      id: true,
      name: true,
      nic: true,
      phone: true,
      joinDate: true,
      active: true,
      user: { select: { id: true, username: true } },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  const rows: TeacherRow[] = teachers.map((t) => ({
    id: t.id,
    name: t.name,
    nic: t.nic,
    phone: t.phone,
    joinDate: toDateInput(t.joinDate),
    active: t.active,
    username: t.user?.username ?? null,
    userId: t.user?.id ?? null,
  }));

  return (
    <TeacherManager
      rows={rows}
      createAction={createTeacher}
      updateAction={updateTeacher}
      resetPasswordAction={resetTeacherPassword}
      toggleAction={setTeacherActive}
    />
  );
}
