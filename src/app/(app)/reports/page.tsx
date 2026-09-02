import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import {
  buildStudentList,
  currentColomboMonth,
  reportableCourses,
} from "@/lib/report-student-list";

import { ReportScreen } from "./report-screen";

export const metadata = { title: "Reports" };

const FIELD = "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-xs";

function toStr(v: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw !== "" ? raw : undefined;
}
function toId(v: string | string[] | undefined): number | undefined {
  const n = Number(toStr(v));
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  // All three roles. What a TEACHER may see is narrowed in the library, from
  // the database — not from anything in this request.
  const user = await requireNavAccess("/reports");
  const isTeacher = user.role === "TEACHER";

  const params = await searchParams;
  const teacherId = toId(params.teacherId);
  const courseId = toId(params.courseId);

  const asked = toStr(params.month);
  const now = currentColomboMonth();
  const [year, month] =
    asked && /^\d{4}-\d{2}$/.test(asked) ? asked.split("-").map(Number) : [now.year, now.month];

  const { courses, blocked, teacherScoped } = await reportableCourses(user, teacherId);

  // Teachers never pick a teacher — theirs is fixed and shown read-only.
  const teachers = isTeacher
    ? []
    : await db.teacher.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
  const ownName = isTeacher && teacherScoped
    ? (await db.teacher.findUnique({ where: { id: teacherScoped }, select: { name: true } }))?.name ?? null
    : null;

  const report = courseId
    ? await buildStudentList(user, { courseId, year, month })
    : { course: null, year, month, label: "", rows: [], blocked,
        totals: { registered: 0, paid: 0, notPaid: 0, free: 0, reconciles: true } };

  const monthValue = `${year}-${String(month).padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Student list report</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Who has paid for a course in a given month. Read-only, by billing month —
          a fee stamped for that month counts however late it was taken.
        </p>
      </div>

      {blocked && (
        <p className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-4 py-3 text-sm">
          This login is not linked to a teacher record, so it has no courses.
        </p>
      )}

      <form className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <div className="space-y-2">
          <label htmlFor="teacherId" className="block text-sm font-medium">Teacher</label>
          {isTeacher ? (
            // Fixed, and not a form field at all — there is nothing to submit.
            <p className={`${FIELD} flex items-center bg-muted/50`}>{ownName ?? "—"}</p>
          ) : (
            <select id="teacherId" name="teacherId" className={FIELD} defaultValue={teacherId ?? ""}>
              <option value="">All teachers</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
        </div>

        <div className="min-w-56 flex-1 space-y-2">
          <label htmlFor="courseId" className="block text-sm font-medium">Course</label>
          <select id="courseId" name="courseId" className={`${FIELD} w-full`} defaultValue={courseId ?? ""} required>
            <option value="" disabled>Select a course…</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{courseDisplayName(c)}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="month" className="block text-sm font-medium">Month</label>
          <input id="month" name="month" type="month" className={FIELD} defaultValue={monthValue} />
        </div>

        <Button type="submit">Show</Button>
        <Button asChild variant="ghost"><Link href="/reports">Clear</Link></Button>
      </form>

      {/* Keyed on the selection: a new selection remounts rather than syncing. */}
      <ReportScreen key={`${courseId ?? ""}|${monthValue}`} report={report} />
    </div>
  );
}
