import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { db } from "@/lib/db";
import { buildClassSchedule } from "@/lib/report-class-schedule";
import { DAYS, DAY_LABEL } from "@/lib/schedule-time";

import { ScheduleScreen } from "./schedule-report";

export const metadata = { title: "Class schedule" };

const FIELD = "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-xs";

function toStr(v: string | string[] | undefined) {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw !== "" ? raw : undefined;
}
function toId(v: string | string[] | undefined) {
  const n = Number(toStr(v));
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export default async function ClassSchedulePage({
  searchParams,
}: PageProps<"/reports/class-schedule">) {
  // All three roles; a TEACHER is narrowed to their own courses in the library.
  const user = await requireNavAccess("/reports");
  const isTeacher = user.role === "TEACHER";

  const params = await searchParams;
  const teacherId = toId(params.teacherId);
  const day = toStr(params.day);

  const report = await buildClassSchedule(user, { teacherId, day });

  const teachers = isTeacher
    ? []
    : await db.teacher.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
  const ownName =
    isTeacher && report.scopedToTeacher
      ? (await db.teacher.findUnique({ where: { id: report.scopedToTeacher }, select: { name: true } }))?.name ?? null
      : null;

  const subtitle = [
    isTeacher ? `${ownName ?? "Your"} classes` : "All classes",
    teacherId && !isTeacher && teachers.find((t) => t.id === teacherId)?.name,
    day && DAY_LABEL[day as keyof typeof DAY_LABEL],
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Class schedule</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The recurring weekly timetable — active classes only. Read-only.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
        {isTeacher ? (
          <div className="space-y-2">
            <span className="block text-sm font-medium">Teacher</span>
            <p className={`${FIELD} bg-muted/50 flex items-center`}>{ownName ?? "—"}</p>
          </div>
        ) : (
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
        <div className="space-y-2">
          <label htmlFor="day" className="block text-sm font-medium">Day</label>
          <select id="day" name="day" className={FIELD} defaultValue={day ?? ""}>
            <option value="">Every day</option>
            {DAYS.map((d) => (
              <option key={d} value={d}>{DAY_LABEL[d]}</option>
            ))}
          </select>
        </div>
        <Button type="submit">Show</Button>
        <Button asChild variant="ghost"><Link href="/reports/class-schedule">Clear</Link></Button>
      </form>

      <ScheduleScreen key={`${teacherId ?? ""}|${day ?? ""}`} report={report} subtitle={subtitle} />
    </div>
  );
}
