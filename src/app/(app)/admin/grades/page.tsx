import { LabelManager } from "@/app/(app)/admin/_components/label-manager";
import { listLabels } from "@/app/(app)/admin/_lib/label-crud";
import { requireNavAccess } from "@/lib/authz";

import { createGrade, setGradeActive, updateGrade } from "./actions";

export const metadata = { title: "Grades" };

export default async function GradesPage() {
  await requireNavAccess("/admin/grades");

  const rows = await listLabels("grade");

  return (
    <LabelManager
      noun="Grade"
      rows={rows}
      placeholder="e.g. A/L 2027"
      createAction={createGrade}
      updateAction={updateGrade}
      toggleAction={setGradeActive}
    />
  );
}
