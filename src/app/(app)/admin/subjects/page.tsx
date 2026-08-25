import { LabelManager } from "@/app/(app)/admin/_components/label-manager";
import { listLabels } from "@/app/(app)/admin/_lib/label-crud";
import { requireNavAccess } from "@/lib/authz";

import { createSubject, setSubjectActive, updateSubject } from "./actions";

export const metadata = { title: "Subjects" };

export default async function SubjectsPage() {
  await requireNavAccess("/admin/subjects");

  const rows = await listLabels("subject");

  return (
    <LabelManager
      noun="Subject"
      rows={rows}
      placeholder="e.g. ICT"
      createAction={createSubject}
      updateAction={updateSubject}
      toggleAction={setSubjectActive}
    />
  );
}
