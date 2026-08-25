/**
 * Display name for a Course.
 *
 * `Course.name` is optional and only holds what staff actually typed. When it's
 * blank we compose a readable label at render time instead of persisting a
 * fabricated one — otherwise renaming a grade or subject would leave stale text
 * baked into the row.
 */
export type CourseNameParts = {
  name?: string | null;
  grade: { label: string };
  subject: { label: string };
  classType: { label: string };
  teacher: { name: string };
};

export function courseDisplayName(course: CourseNameParts): string {
  const typed = course.name?.trim();
  if (typed) return typed;

  return `${course.grade.label} ${course.subject.label} ${course.classType.label} (${course.teacher.name})`;
}
