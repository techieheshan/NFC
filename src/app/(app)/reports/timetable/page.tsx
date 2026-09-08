import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { db } from "@/lib/db";
import { buildTimetable, currentColomboDate } from "@/lib/report-timetable";
import { courseScopeFor } from "@/lib/reports";

import { TimetableScreen } from "./timetable-report";

export const metadata = { title: "Timetable" };

const FIELD = "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-xs";

function toStr(v: string | string[] | undefined) {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw !== "" ? raw : undefined;
}
function toId(v: string | string[] | undefined) {
  const n = Number(toStr(v));
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export default async function TimetablePage({ searchParams }: PageProps<"/reports/timetable">) {
  // All three roles; a TEACHER is narrowed to their own classes below.
  const user = await requireNavAccess("/reports");
  const isTeacher = user.role === "TEACHER";

  const params = await searchParams;
  const today = currentColomboDate();
  const rawDate = toStr(params.date);
  const anchor = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : today;

  // A teacher's own id comes from the database, never from the query string;
  // their filter cannot be widened, only their own week shown.
  const scope = await courseScopeFor(user);
  const ownTeacherId = scope && "teacherId" in scope ? scope.teacherId : undefined;
  const askedTeacher = toId(params.teacherId);
  const teacherId = isTeacher ? (ownTeacherId ?? -1) : askedTeacher;

  const [report, teachers] = await Promise.all([
    buildTimetable(anchor, { teacherId }),
    isTeacher
      ? []
      : db.teacher.findMany({
          where: { active: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
  ]);

  const subtitle = [
    `Week of ${report.from} to ${report.to}`,
    isTeacher ? "your classes" : teachers.find((t) => t.id === teacherId)?.name,
    "resolved hall per day, one-day reassignments included",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Timetable</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The week by room. Built from the same resolver the allocation screen
          uses, so a class moved for one day appears in its temporary hall on
          that day and its usual one on the rest.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <div className="space-y-2">
          <label htmlFor="date" className="block text-sm font-medium">Week of</label>
          <input id="date" name="date" type="date" className={FIELD} defaultValue={anchor} />
        </div>
        {!isTeacher && (
          <div className="space-y-2">
            <label htmlFor="teacherId" className="block text-sm font-medium">Teacher</label>
            <select id="teacherId" name="teacherId" className={FIELD} defaultValue={teacherId ?? ""}>
              <option value="">All teachers</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        )}
        <Button type="submit">Show</Button>
        <Button asChild variant="ghost"><Link href="/reports/timetable">This week</Link></Button>
      </form>

      <TimetableScreen key={`${anchor}|${teacherId ?? ""}`} report={report} subtitle={subtitle} />
    </div>
  );
}
