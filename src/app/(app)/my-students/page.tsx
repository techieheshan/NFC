import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { buildRoster } from "@/lib/roster";

import { RosterScreen } from "./roster-screen";

export const metadata = { title: "My Students" };

/**
 * Contact numbers on the roster.
 *
 * A teacher can see the phone number of a student in their own class, so they
 * can reach the student or their parent about that class. Flip this to false to
 * remove the column from the screen AND the PDF in one edit.
 */
const SHOW_PHONE = true;

const FIELD =
  "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-xs";

function toStr(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim() !== "" ? raw.trim() : undefined;
}

function toId(value: string | string[] | undefined): number | undefined {
  const n = Number(toStr(value));
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export default async function MyStudentsPage({ searchParams }: PageProps<"/my-students">) {
  // All three roles; what each one SEES is decided in buildRoster, from the
  // database rather than from the session.
  const user = await requireNavAccess("/my-students");

  const params = await searchParams;
  const filters = {
    teacherId: toId(params.teacherId),
    courseId: toId(params.courseId),
    q: toStr(params.q),
    includeDropped: toStr(params.dropped) === "1",
  };

  const roster = await buildRoster(user, filters);
  const isTeacher = user.role === "TEACHER";

  // The filter selects are only meaningful for a viewer who can see everything.
  const [teachers, courses] = isTeacher
    ? [[], []]
    : await Promise.all([
        db.teacher.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        db.course.findMany({
          where: { active: true },
          select: {
            id: true, name: true,
            grade: { select: { label: true } },
            subject: { select: { label: true } },
            classType: { select: { label: true } },
            teacher: { select: { name: true } },
          },
          orderBy: { id: "asc" },
        }),
      ]);

  const filterSummary = [
    isTeacher ? "Your own classes" : "All classes",
    filters.teacherId && !isTeacher && `teacher = ${teachers.find((t) => t.id === filters.teacherId)?.name}`,
    filters.courseId && !isTeacher && `course = ${courses.filter((c) => c.id === filters.courseId).map(courseDisplayName)[0]}`,
    filters.q && `matching "${filters.q}"`,
    filters.includeDropped ? "dropped enrolments included" : "active enrolments only",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My Students</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {isTeacher
            ? "Everyone enrolled in the classes you teach. Read-only."
            : "Everyone enrolled, by class. Read-only."}
        </p>
      </div>

      {roster.blocked && (
        <p className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm">
          This login is not linked to a teacher record, so it has no classes.
          An administrator can link it under Setup → Teachers.
        </p>
      )}

      {/* Filters are searchParams — a filter change is a fresh server render,
          and the scope is re-derived server-side each time. */}
      <form className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <div className="min-w-52 flex-1 space-y-2">
          <label htmlFor="q" className="block text-sm font-medium">Student</label>
          <input id="q" name="q" className={`${FIELD} w-full`} defaultValue={filters.q ?? ""}
                 placeholder="Name or card number" autoComplete="off" />
        </div>

        {!isTeacher && (
          <>
            <div className="space-y-2">
              <label htmlFor="teacherId" className="block text-sm font-medium">Teacher</label>
              <select id="teacherId" name="teacherId" className={FIELD} defaultValue={filters.teacherId ?? ""}>
                <option value="">All teachers</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="courseId" className="block text-sm font-medium">Course</label>
              <select id="courseId" name="courseId" className={FIELD} defaultValue={filters.courseId ?? ""}>
                <option value="">All courses</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{courseDisplayName(c)}</option>
                ))}
              </select>
            </div>
          </>
        )}

        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="dropped" value="1" defaultChecked={filters.includeDropped} className="size-4" />
          Show dropped
        </label>

        <Button type="submit">Apply</Button>
        <Button asChild variant="ghost">
          <Link href="/my-students">Clear</Link>
        </Button>
      </form>

      {/* Keyed on the filter signature so a change remounts rather than syncing
          props into state (AGENTS.md rule 17). */}
      <RosterScreen
        key={JSON.stringify(params)}
        courses={roster.courses}
        filterSummary={filterSummary}
        showPhone={SHOW_PHONE}
      />
    </div>
  );
}
