import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { getInstituteSharePresets } from "@/lib/settings";

import { createCourse, setCourseActive, updateCourse } from "./actions";
import {
  CourseManager,
  type CourseOptions,
  type CourseRow,
} from "./course-manager";

export const metadata = { title: "Classes / Courses" };

const SELECT_CLASS =
  "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-xs";

/** Prisma Decimal -> fixed 2dp string for display and number inputs. */
function money(value: unknown): string {
  return Number(String(value)).toFixed(2);
}

function toId(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? n : undefined;
}

export default async function CoursesPage({
  searchParams,
}: PageProps<"/admin/courses">) {
  await requireNavAccess("/admin/courses");

  const params = await searchParams;
  const teacherFilter = toId(params.teacher);
  const gradeFilter = toId(params.grade);

  const [courses, teachers, subjects, grades, streams, classTypes, sharePresets] =
    await Promise.all([
      db.course.findMany({
        where: {
          ...(teacherFilter ? { teacherId: teacherFilter } : {}),
          ...(gradeFilter ? { gradeId: gradeFilter } : {}),
        },
        include: {
          teacher: { select: { name: true } },
          subject: { select: { label: true } },
          grade: { select: { label: true } },
          stream: { select: { label: true } },
          classType: { select: { label: true } },
        },
        orderBy: [{ active: "desc" }, { id: "desc" }],
      }),
      db.teacher.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      db.subject.findMany({
        where: { active: true },
        select: { id: true, label: true },
        orderBy: { label: "asc" },
      }),
      db.grade.findMany({
        where: { active: true },
        select: { id: true, label: true },
        orderBy: { label: "asc" },
      }),
      db.stream.findMany({
        where: { active: true },
        select: { id: true, label: true },
        orderBy: { label: "asc" },
      }),
      db.classType.findMany({
        where: { active: true },
        select: { id: true, label: true },
        orderBy: { label: "asc" },
      }),
      getInstituteSharePresets(),
    ]);

  const rows: CourseRow[] = courses.map((c) => ({
    id: c.id,
    name: c.name,
    displayName: courseDisplayName(c),
    teacherId: c.teacherId,
    subjectId: c.subjectId,
    gradeId: c.gradeId,
    streamId: c.streamId,
    classTypeId: c.classTypeId,
    teacher: c.teacher.name,
    subject: c.subject.label,
    grade: c.grade.label,
    stream: c.stream.label,
    classType: c.classType.label,
    defaultFee: money(c.defaultFee),
    instituteSharePercent: money(c.instituteSharePercent),
    instituteFee: money(c.instituteFee),
    active: c.active,
  }));

  const options: CourseOptions = {
    teachers: teachers.map((t) => ({ id: t.id, label: t.name })),
    subjects,
    grades,
    streams,
    classTypes,
  };

  const filtered = teacherFilter !== undefined || gradeFilter !== undefined;

  /* Plain GET form — filtering needs no client JS. */
  const filters = (
    <form
      method="get"
      className="bg-muted/40 flex flex-wrap items-end gap-3 rounded-xl border p-4"
    >
      <div className="space-y-1.5">
        <label htmlFor="teacher" className="block text-sm font-medium">
          Teacher
        </label>
        <select
          id="teacher"
          name="teacher"
          className={SELECT_CLASS}
          defaultValue={teacherFilter ?? ""}
        >
          <option value="">All teachers</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="grade" className="block text-sm font-medium">
          Grade
        </label>
        <select
          id="grade"
          name="grade"
          className={SELECT_CLASS}
          defaultValue={gradeFilter ?? ""}
        >
          <option value="">All grades</option>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" variant="secondary">
        Filter
      </Button>

      {filtered && (
        <Button asChild variant="ghost">
          <Link href="/admin/courses">Clear</Link>
        </Button>
      )}
    </form>
  );

  return (
    <CourseManager
      rows={rows}
      options={options}
      sharePresets={sharePresets}
      filters={filters}
      createAction={createCourse}
      updateAction={updateCourse}
      toggleAction={setCourseActive}
    />
  );
}
