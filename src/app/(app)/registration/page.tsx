import { requireNavAccess } from "@/lib/authz";
import { getToggle } from "@/lib/settings";
import { db } from "@/lib/db";

import {
  addEnrolment,
  loadCoursesForCascade,
  loadSubjectsForStream,
  attachIdentifier,
  createStudent,
  lookupCard,
  refreshStudent,
  updateStudent,
  updateStudentPhoto,
} from "./actions";
import { RegistrationScreen } from "./registration-screen";

export const metadata = { title: "Registration" };

export default async function RegistrationPage({
  searchParams,
}: PageProps<"/registration">) {
  await requireNavAccess("/registration");

  // Search links here with a student id so its rows open the edit view
  // directly; the scan flow is unchanged when the parameter is absent.
  const voiceEnabled = await getToggle("voice_confirmations");

  const raw = (await searchParams).studentId;
  const studentId = Number(Array.isArray(raw) ? raw[0] : raw);
  const initialStudent =
    Number.isInteger(studentId) && studentId > 0 ? await refreshStudent(studentId) : null;

  // Only step 1 ships with the page. Subjects and courses are fetched per
  // step, so a terminal never downloads every course to show three of them.
  const [streams, courseCount, feeTiers] = await Promise.all([
    db.stream.findMany({
      where: { active: true },
      select: { id: true, label: true },
      orderBy: { label: "asc" },
    }),
    db.course.count({ where: { active: true } }),
    // Fee tiers are institute-configurable rows, never hardcoded.
    db.feeTier.findMany({
      where: { active: true },
      select: { id: true, label: true, multiplier: true },
      orderBy: { id: "asc" },
    }),
  ]);

  return (
    <RegistrationScreen
      streams={streams}
      courseCount={courseCount}
      loadSubjects={loadSubjectsForStream}
      loadCourses={loadCoursesForCascade}
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
      attachIdentifier={attachIdentifier}
      initialStudent={initialStudent}
      voiceEnabled={voiceEnabled}
    />
  );
}
