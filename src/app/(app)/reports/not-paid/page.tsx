import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { buildNotPaid, currentColomboMonth } from "@/lib/report-not-paid";

import { NotPaidScreen } from "./not-paid-report";

export const metadata = { title: "Not paid" };

const FIELD = "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-xs";

function toStr(v: string | string[] | undefined) {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw !== "" ? raw : undefined;
}
function toId(v: string | string[] | undefined) {
  const n = Number(toStr(v));
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export default async function NotPaidPage({ searchParams }: PageProps<"/reports/not-paid">) {
  const user = await requireNavAccess("/reports");
  // A collections tool over everyone's money — not a teacher's view.
  if (user.role === "TEACHER") notFound();

  const params = await searchParams;
  const asked = toStr(params.month);
  const now = currentColomboMonth();
  const [year, month] =
    asked && /^\d{4}-\d{2}$/.test(asked) ? asked.split("-").map(Number) : [now.year, now.month];

  const courseId = toId(params.courseId);
  const teacherId = toId(params.teacherId);

  const [report, teachers, courses] = await Promise.all([
    buildNotPaid(year, month, { courseId, teacherId }),
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

  const monthValue = `${year}-${String(month).padStart(2, "0")}`;
  const subtitle = [
    report.label,
    teacherId && `teacher = ${teachers.find((t) => t.id === teacherId)?.name}`,
    courseId && `course = ${courses.filter((c) => c.id === courseId).map(courseDisplayName)[0]}`,
    !teacherId && !courseId && "all courses",
  ].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Not paid</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Who owes a month, by billing month — the same check the counter&apos;s
          colour uses, so the two always agree. Free-tier students owe nothing and
          never appear.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <div className="space-y-2">
          <label htmlFor="month" className="block text-sm font-medium">Month</label>
          <input id="month" name="month" type="month" className={FIELD} defaultValue={monthValue} />
        </div>
        <div className="space-y-2">
          <label htmlFor="teacherId" className="block text-sm font-medium">Teacher</label>
          <select id="teacherId" name="teacherId" className={FIELD} defaultValue={teacherId ?? ""}>
            <option value="">All teachers</option>
            {teachers.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
          </select>
        </div>
        <div className="min-w-52 flex-1 space-y-2">
          <label htmlFor="courseId" className="block text-sm font-medium">Course</label>
          <select id="courseId" name="courseId" className={`${FIELD} w-full`} defaultValue={courseId ?? ""}>
            <option value="">All courses</option>
            {courses.map((c) => (<option key={c.id} value={c.id}>{courseDisplayName(c)}</option>))}
          </select>
        </div>
        <Button type="submit">Show</Button>
        <Button asChild variant="ghost"><Link href="/reports/not-paid">Clear</Link></Button>
      </form>

      <NotPaidScreen key={`${monthValue}|${courseId ?? ""}|${teacherId ?? ""}`} report={report} subtitle={subtitle} />
    </div>
  );
}
