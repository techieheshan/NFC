import { requireNavAccess } from "@/lib/authz";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";

import {
  addEnrolment,
  createStudent,
  lookupCard,
  refreshStudent,
  updateStudent,
  updateStudentPhoto,
} from "./actions";
import { RegistrationScreen } from "./registration-screen";

export const metadata = { title: "Registration" };

export default async function RegistrationPage() {
  await requireNavAccess("/registration");

  const [courses, feeTiers] = await Promise.all([
    db.course.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        grade: { select: { label: true } },
        subject: { select: { label: true } },
        classType: { select: { label: true } },
        teacher: { select: { name: true } },
      },
      orderBy: { id: "asc" },
    }),
    // Fee tiers are institute-configurable rows, never hardcoded.
    db.feeTier.findMany({
      where: { active: true },
      select: { id: true, label: true, multiplier: true },
      orderBy: { id: "asc" },
    }),
  ]);

  return (
    <RegistrationScreen
      courses={courses.map((c) => ({ id: c.id, label: courseDisplayName(c) }))}
      feeTiers={feeTiers.map((t) => ({
        id: t.id,
        label: t.label,
        multiplier: String(t.multiplier),
      }))}
      lookupCard={lookupCard}
      refreshStudent={refreshStudent}
      createStudent={createStudent}
      addEnrolment={addEnrolment}
      updateStudent={updateStudent}
      updatePhoto={updateStudentPhoto}
    />
  );
}
