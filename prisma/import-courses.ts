import "dotenv/config";
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Bulk course import from the institute's filled-in CSV.
 *
 * The institute has too many courses to type in one at a time, so they fill
 * `prisma/import/courses-template.csv` — one row per class SLOT — and this
 * turns it into teachers, subjects, grades, streams, courses and schedules.
 *
 * Three rules it will not bend:
 *
 *  1. DRY RUN BY DEFAULT. Nothing is written without `--commit`, and both runs
 *     print the same report, so what you approve is what happens.
 *  2. NOTHING IS INVENTED. A row missing something required is reported and
 *     skipped. A fee that is not a number is an error, not a zero.
 *  3. RE-RUNNABLE. Courses match on teacher + subject + grade + class type
 *     (+ name), schedules on course + day + start time. Running it twice
 *     creates nothing the first run already made, so a corrected file can be
 *     re-sent and re-imported.
 *
 * It also flags near-duplicate names (case/spacing only), because "E-Tech" and
 * "E- Tech" in the same file is how a teacher ends up with two subjects.
 */

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Neither DIRECT_URL nor DATABASE_URL is set");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
type Day = (typeof DAYS)[number];
const DAY_ALIASES: Record<string, Day> = {
  monday: "MON", tuesday: "TUE", wednesday: "WED", thursday: "THU",
  friday: "FRI", saturday: "SAT", sunday: "SUN",
  ...Object.fromEntries(DAYS.map((d) => [d.toLowerCase(), d])),
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Minimal RFC4180 reader: quoted fields, embedded commas, Excel's BOM. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** For the near-duplicate check: what two spellings of one name have in common. */
const fold = (s: string) => s.toLowerCase().replace(/[\s.\-_]/g, "");

type Row = {
  line: number;
  teacher: string;
  subject: string;
  grade: string;
  stream: string;
  classType: string;
  fee: string;
  percent: string;
  day: string;
  start: string;
  end: string;
  hall: string;
  courseName: string;
};

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const commit = args.includes("--commit");

  /**
   * `--reference` writes the sheet's companion file: every name already in the
   * system, spelled exactly as the import will match it. Whoever fills the
   * course sheet copies from this instead of typing a teacher's name from
   * memory — which is the only reliable way to stop one teacher's name, typed
   * two slightly different ways, becoming two teachers.
   */
  if (args.includes("--reference")) {
    const [teachers, subjects, grades, streams, classTypes, halls] = await Promise.all([
      db.teacher.findMany({ where: { active: true }, select: { name: true }, orderBy: { name: "asc" } }),
      db.subject.findMany({ where: { active: true }, select: { label: true }, orderBy: { label: "asc" } }),
      db.grade.findMany({ where: { active: true }, select: { label: true }, orderBy: { label: "asc" } }),
      db.stream.findMany({ where: { active: true }, select: { label: true }, orderBy: { label: "asc" } }),
      db.classType.findMany({ select: { code: true }, orderBy: { code: "asc" } }),
      db.hall.findMany({ where: { active: true }, select: { name: true }, orderBy: { name: "asc" } }),
    ]);
    const columns: [string, string[]][] = [
      ["teacher", teachers.map((t) => t.name)],
      ["subject", subjects.map((x) => x.label)],
      ["grade", grades.map((x) => x.label)],
      ["stream", streams.map((x) => x.label)],
      ["class_type", classTypes.map((c) => c.code)],
      ["hall", halls.map((h) => h.name)],
    ];
    const depth = Math.max(...columns.map(([, v]) => v.length));
    const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [columns.map(([h]) => h).join(",")];
    for (let i = 0; i < depth; i++) lines.push(columns.map(([, v]) => quote(v[i] ?? "")).join(","));
    const out = file ?? "reference-values.csv";
    const { writeFileSync } = await import("node:fs");
    writeFileSync(out, lines.join("\n") + "\n");
    console.log(`Wrote ${out}: ${columns.map(([h, v]) => `${v.length} ${h}s`).join(", ")}.`);
    return;
  }

  if (!file) {
    console.error("usage: tsx prisma/import-courses.ts <file.csv> [--commit]");
    process.exitCode = 1;
    return;
  }

  const rows = parseCsv(readFileSync(file, "utf8"));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const need = [
    "teacher", "subject", "grade", "stream", "class_type", "fee",
    "institute_share_percent", "day", "start_time", "end_time", "hall", "course_name",
  ];
  const missing = need.filter((c) => !header.includes(c));
  if (missing.length) {
    console.error(`This file is missing column(s): ${missing.join(", ")}`);
    console.error(`Found: ${header.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const at = (r: string[], col: string) => (r[header.indexOf(col)] ?? "").trim();

  const parsed: Row[] = rows.slice(1).map((r, i) => ({
    line: i + 2,
    teacher: at(r, "teacher"),
    subject: at(r, "subject"),
    grade: at(r, "grade"),
    stream: at(r, "stream"),
    classType: at(r, "class_type"),
    fee: at(r, "fee"),
    percent: at(r, "institute_share_percent"),
    day: at(r, "day"),
    start: at(r, "start_time"),
    end: at(r, "end_time"),
    hall: at(r, "hall"),
    courseName: at(r, "course_name"),
  }));

  // The template ships with example rows; they are a shape, not data.
  const examples = parsed.filter((r) => r.teacher.toUpperCase().startsWith("EXAMPLE"));
  const data = parsed.filter((r) => !r.teacher.toUpperCase().startsWith("EXAMPLE"));

  const [classTypes, halls] = await Promise.all([
    db.classType.findMany({ select: { id: true, code: true, label: true } }),
    db.hall.findMany({ where: { active: true }, select: { id: true, name: true } }),
  ]);
  const classTypeBy = new Map<string, { id: number; code: string }>();
  for (const c of classTypes) {
    classTypeBy.set(fold(c.code), c);
    classTypeBy.set(fold(c.label), c);
  }
  const hallBy = new Map(halls.map((h) => [fold(h.name), h]));

  const errors: string[] = [];
  // `day` narrows from the raw string to the enum (or null for a course with
  // no slot yet), so it is replaced rather than intersected.
  type Ready = Omit<Row, "day"> & { classTypeId: number; hallId: number | null; day: Day | null };
  const good: Ready[] = [];

  for (const r of data) {
    const problems: string[] = [];
    for (const [label, value] of [
      ["teacher", r.teacher], ["subject", r.subject], ["grade", r.grade],
      ["stream", r.stream], ["class_type", r.classType], ["fee", r.fee],
      ["institute_share_percent", r.percent],
    ] as const) {
      if (!value) problems.push(`${label} is blank`);
    }

    const ct = classTypeBy.get(fold(r.classType));
    if (r.classType && !ct) {
      problems.push(`class_type "${r.classType}" is not one of ${classTypes.map((c) => c.code).join("/")}`);
    }

    const fee = Number(r.fee.replace(/[, ]/g, ""));
    if (r.fee && (!Number.isFinite(fee) || fee < 0)) problems.push(`fee "${r.fee}" is not a number`);
    const pct = Number(r.percent.replace(/[%\s]/g, ""));
    if (r.percent && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      problems.push(`institute_share_percent "${r.percent}" is not 0–100`);
    }

    // Day and times travel together: one without the others is a half-written
    // slot, and guessing which half was meant is not this script's job.
    let day: Day | null = null;
    if (r.day || r.start || r.end) {
      day = DAY_ALIASES[r.day.toLowerCase()] ?? null;
      if (!day) problems.push(`day "${r.day}" is not MON–SUN`);
      if (!TIME.test(r.start)) problems.push(`start_time "${r.start}" is not HH:mm`);
      if (!TIME.test(r.end)) problems.push(`end_time "${r.end}" is not HH:mm`);
      if (TIME.test(r.start) && TIME.test(r.end) && r.end <= r.start) {
        problems.push(`end_time ${r.end} is not after start_time ${r.start}`);
      }
    }

    let hallId: number | null = null;
    if (r.hall) {
      const h = hallBy.get(fold(r.hall));
      if (!h) problems.push(`hall "${r.hall}" is not one of: ${halls.map((x) => x.name).join(", ")}`);
      else hallId = h.id;
    }

    if (problems.length) errors.push(`  line ${r.line}: ${problems.join("; ")}`);
    else good.push({ ...r, classTypeId: ct!.id, hallId, day });
  }

  // --- what the file says, before anything is written -----------------------
  const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  const teachers = uniq(good.map((r) => r.teacher));
  const subjects = uniq(good.map((r) => r.subject));
  const grades = uniq(good.map((r) => r.grade));
  const streams = uniq(good.map((r) => r.stream));
  const courseKey = (r: Omit<Row, "day">) =>
    [r.teacher, r.subject, r.grade, r.classType, r.courseName].map(fold).join("|");
  const courses = new Map<string, Ready[]>();
  for (const r of good) {
    const k = courseKey(r);
    courses.set(k, [...(courses.get(k) ?? []), r]);
  }
  const slots = good.filter((r) => r.day !== null).length;

  console.log(`\nFILE: ${file}`);
  console.log(`  rows read              : ${parsed.length}`);
  console.log(`  example rows skipped   : ${examples.length}`);
  console.log(`  rows understood        : ${good.length}`);
  console.log(`  rows with problems     : ${errors.length}`);
  if (errors.length) {
    console.log("\nPROBLEM ROWS — fixed in the file and re-sent, never guessed at here:");
    for (const e of errors) console.log(e);
  }

  console.log(`\nWHAT IT ADDS UP TO`);
  console.log(`  teachers               : ${teachers.length}`);
  console.log(`  subjects               : ${subjects.length}`);
  console.log(`  grades                 : ${grades.length}`);
  console.log(`  streams                : ${streams.length}`);
  console.log(`  courses                : ${courses.size}`);
  console.log(`  weekly class slots     : ${slots}`);
  const noSlot = [...courses.values()].filter((rs) => rs.every((r) => r.day === null)).length;
  if (noSlot) console.log(`  courses with no day/time yet: ${noSlot}`);

  // Two spellings of one name is the failure mode of a hand-filled sheet.
  for (const [label, values] of [
    ["teacher", teachers], ["subject", subjects], ["grade", grades], ["stream", streams],
  ] as const) {
    const byFold = new Map<string, string[]>();
    for (const v of values) byFold.set(fold(v), [...(byFold.get(fold(v)) ?? []), v]);
    const clashes = [...byFold.values()].filter((v) => v.length > 1);
    for (const c of clashes) console.log(`  ⚠ ${label} spelled two ways: ${c.map((x) => `"${x}"`).join(" vs ")}`);
  }

  // --- what already exists, so the report says NEW vs EXISTING --------------
  const [haveSubjects, haveGrades, haveStreams, haveTeachers] = await Promise.all([
    db.subject.findMany({ select: { id: true, label: true } }),
    db.grade.findMany({ select: { id: true, label: true } }),
    db.stream.findMany({ select: { id: true, label: true } }),
    db.teacher.findMany({ select: { id: true, name: true } }),
  ]);
  const known = (rows: { label?: string; name?: string }[]) =>
    new Map(rows.map((r) => [fold((r.label ?? r.name)!), r as { id: number }]));
  const subjectBy = known(haveSubjects);
  const gradeBy = known(haveGrades);
  const streamBy = known(haveStreams);
  const teacherBy = known(haveTeachers);

  const newOnes = (values: string[], have: Map<string, unknown>) => values.filter((v) => !have.has(fold(v)));
  console.log(`\nWOULD CREATE (names not already in the database)`);
  for (const [label, values, have, existing] of [
    ["teachers", teachers, teacherBy, haveTeachers.map((t) => t.name)],
    ["subjects", subjects, subjectBy, haveSubjects.map((x) => x.label)],
    ["grades", grades, gradeBy, haveGrades.map((x) => x.label)],
    ["streams", streams, streamBy, haveStreams.map((x) => x.label)],
  ] as const) {
    const list = newOnes(values, have);
    console.log(`  ${label.padEnd(10)} ${list.length}${list.length ? ": " + list.join(", ") : ""}`);

    // A new name that one of the existing ones contains (or vice versa) is
    // almost always the same thing spelled differently — "Tech" arriving in a
    // system that already calls it "AL Tech". Worth a human's eye before it
    // becomes a second row nobody notices.
    for (const candidate of list) {
      const near = existing.filter((e) => {
        const [a, b] = [fold(candidate), fold(e)];
        return a !== b && a.length > 2 && b.length > 2 && (a.includes(b) || b.includes(a));
      });
      if (near.length) {
        console.log(`     ⚠ "${candidate}" is new, but the system already has ${near.map((x) => `"${x}"`).join(", ")}`);
      }
    }
  }

  if (!commit) {
    console.log(`\nDRY RUN — nothing was written. Re-run with --commit to apply.`);
    return;
  }
  if (errors.length) {
    console.log(`\nRefusing to commit while ${errors.length} row(s) have problems. Fix the file and re-run.`);
    process.exitCode = 1;
    return;
  }

  // --- write ---------------------------------------------------------------
  let madeSubjects = 0, madeGrades = 0, madeStreams = 0, madeTeachers = 0;
  let madeCourses = 0, madeSchedules = 0, existingCourses = 0, existingSchedules = 0;

  const ensure = async (
    value: string,
    have: Map<string, { id: number }>,
    create: (label: string) => Promise<{ id: number }>,
    count: () => void,
  ) => {
    const hit = have.get(fold(value));
    if (hit) return hit.id;
    const made = await create(value);
    have.set(fold(value), made);
    count();
    return made.id;
  };

  for (const rowsForCourse of courses.values()) {
    const first = rowsForCourse[0];
    const [teacherId, subjectId, gradeId, streamId] = await Promise.all([
      ensure(first.teacher, teacherBy, (name) => db.teacher.create({ data: { name }, select: { id: true } }), () => madeTeachers++),
      ensure(first.subject, subjectBy, (label) => db.subject.create({ data: { label }, select: { id: true } }), () => madeSubjects++),
      ensure(first.grade, gradeBy, (label) => db.grade.create({ data: { label }, select: { id: true } }), () => madeGrades++),
      ensure(first.stream, streamBy, (label) => db.stream.create({ data: { label }, select: { id: true } }), () => madeStreams++),
    ]);

    // Course identity is the combination, because none of these columns is
    // unique on its own — two teachers really do both teach A/L 2027 ICT.
    const existing = await db.course.findFirst({
      where: {
        teacherId, subjectId, gradeId, classTypeId: first.classTypeId,
        name: first.courseName || null,
      },
      select: { id: true },
    });
    const courseId =
      existing?.id ??
      (await db.course.create({
        data: {
          teacherId, subjectId, gradeId, streamId, classTypeId: first.classTypeId,
          name: first.courseName || null,
          defaultFee: String(Number(first.fee.replace(/[, ]/g, ""))),
          instituteSharePercent: String(Number(first.percent.replace(/[%\s]/g, ""))),
        },
        select: { id: true },
      })).id;
    if (existing) existingCourses++;
    else madeCourses++;

    for (const slot of rowsForCourse) {
      if (!slot.day) continue;
      const had = await db.schedule.findFirst({
        where: { courseId, dayOfWeek: slot.day, startTime: slot.start },
        select: { id: true },
      });
      if (had) { existingSchedules++; continue; }
      await db.schedule.create({
        data: {
          courseId,
          dayOfWeek: slot.day,
          startTime: slot.start,
          endTime: slot.end,
          defaultHallId: slot.hallId,
        },
      });
      madeSchedules++;
    }
  }

  console.log(`\nWRITTEN`);
  console.log(`  teachers created       : ${madeTeachers}`);
  console.log(`  subjects created       : ${madeSubjects}`);
  console.log(`  grades created         : ${madeGrades}`);
  console.log(`  streams created        : ${madeStreams}`);
  console.log(`  courses created        : ${madeCourses} (already there: ${existingCourses})`);
  console.log(`  schedules created      : ${madeSchedules} (already there: ${existingSchedules})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
