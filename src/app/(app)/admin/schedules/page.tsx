import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { DAYS, DAY_LABEL } from "@/lib/schedule-time";

import {
  createAdditionalClass,
  createSchedule,
  deleteAdditionalClass,
  listAdditionalClasses,
  listSchedules,
  setScheduleActive,
  updateAdditionalClass,
  updateSchedule,
  type DateRange,
  type ScheduleFilters,
} from "./actions";
import { SchedulesScreen } from "./schedules-screen";

export const metadata = { title: "Schedules" };

const SELECT_CLASS =
  "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-xs";

function toId(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : undefined;
}

function toStr(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw !== "" ? raw : undefined;
}

export default async function SchedulesPage({
  searchParams,
}: PageProps<"/admin/schedules">) {
  await requireNavAccess("/admin/schedules");

  const params = await searchParams;

  const scheduleFilters: ScheduleFilters = {
    teacherId: toId(params.teacher),
    gradeId: toId(params.grade),
    day: DAYS.includes(toStr(params.day) as never) ? toStr(params.day) : undefined,
  };
  const dateRange: DateRange = { from: toStr(params.from), to: toStr(params.to) };
  // Which section is open is a searchParam, so applying a filter (a full page
  // navigation) doesn't bounce the user back to the other tab.
  const tab = toStr(params.tab) === "additional" ? "additional" : "weekly";

  const today = new Date().toISOString().slice(0, 10);

  const [schedules, additional, courseRows, teachers, grades] = await Promise.all([
    listSchedules(scheduleFilters),
    listAdditionalClasses(dateRange),
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
    db.teacher.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.grade.findMany({
      where: { active: true },
      select: { id: true, label: true },
      orderBy: { label: "asc" },
    }),
  ]);

  const courses = courseRows.map((c) => ({ id: c.id, label: courseDisplayName(c) }));

  const timetableFiltered =
    scheduleFilters.teacherId !== undefined ||
    scheduleFilters.gradeId !== undefined ||
    scheduleFilters.day !== undefined;

  /* Plain GET forms — filtering needs no client JS and stays shareable by URL. */
  const timetableFilterUi = (
    <form method="get" className="bg-muted/40 flex flex-wrap items-end gap-3 rounded-xl border p-4">
      <input type="hidden" name="tab" value="weekly" />
      <div className="space-y-1.5">
        <label htmlFor="teacher" className="block text-sm font-medium">Teacher</label>
        <select id="teacher" name="teacher" className={SELECT_CLASS} defaultValue={scheduleFilters.teacherId ?? ""}>
          <option value="">All teachers</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="grade" className="block text-sm font-medium">Grade</label>
        <select id="grade" name="grade" className={SELECT_CLASS} defaultValue={scheduleFilters.gradeId ?? ""}>
          <option value="">All grades</option>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>{g.label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="day" className="block text-sm font-medium">Day</label>
        <select id="day" name="day" className={SELECT_CLASS} defaultValue={scheduleFilters.day ?? ""}>
          <option value="">All days</option>
          {DAYS.map((d) => (
            <option key={d} value={d}>{DAY_LABEL[d]}</option>
          ))}
        </select>
      </div>

      <Button type="submit" variant="secondary">Filter</Button>
      {timetableFiltered && (
        <Button asChild variant="ghost">
          <Link href="/admin/schedules?tab=weekly">Clear</Link>
        </Button>
      )}
    </form>
  );

  const additionalFilterUi = (
    <form method="get" className="bg-muted/40 flex flex-wrap items-end gap-3 rounded-xl border p-4">
      <input type="hidden" name="tab" value="additional" />
      <div className="space-y-1.5">
        <label htmlFor="from" className="block text-sm font-medium">From</label>
        <input id="from" name="from" type="date" className={SELECT_CLASS} defaultValue={dateRange.from ?? ""} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="to" className="block text-sm font-medium">To</label>
        <input id="to" name="to" type="date" className={SELECT_CLASS} defaultValue={dateRange.to ?? ""} />
      </div>
      <Button type="submit" variant="secondary">Filter</Button>
      {(dateRange.from || dateRange.to) && (
        <Button asChild variant="ghost">
          <Link href="/admin/schedules?tab=additional">Clear</Link>
        </Button>
      )}
    </form>
  );

  return (
    <SchedulesScreen
      initialSchedules={schedules}
      initialAdditional={additional}
      courses={courses}
      today={today}
      tab={tab}
      scheduleFilters={scheduleFilters}
      dateRange={dateRange}
      timetableFilterUi={timetableFilterUi}
      additionalFilterUi={additionalFilterUi}
      listSchedules={listSchedules}
      listAdditionalClasses={listAdditionalClasses}
      createSchedule={createSchedule}
      updateSchedule={updateSchedule}
      setScheduleActive={setScheduleActive}
      createAdditionalClass={createAdditionalClass}
      updateAdditionalClass={updateAdditionalClass}
      deleteAdditionalClass={deleteAdditionalClass}
    />
  );
}
