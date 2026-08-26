import { requireNavAccess } from "@/lib/authz";
import { db } from "@/lib/db";

import {
  coursesForTeacher,
  createCombo,
  listCombos,
  setComboActive,
  updateCombo,
} from "./actions";
import { ComboManager } from "./combo-manager";

export const metadata = { title: "Combine Payment" };

export default async function CombosPage() {
  await requireNavAccess("/admin/combos");

  const [rows, teachers] = await Promise.all([
    listCombos(),
    db.teacher.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <ComboManager
      initialRows={rows}
      teachers={teachers}
      listAction={listCombos}
      coursesForTeacher={coursesForTeacher}
      createAction={createCombo}
      updateAction={updateCombo}
      toggleAction={setComboActive}
    />
  );
}
