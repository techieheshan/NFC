// prisma/seed-demo.ts
// -----------------------------------------------------------------------------
// DEMO DATA — exercises every path in the app (dev only).
//
//   Seed:  npx tsx prisma/seed-demo.ts
//   Wipe:  npx tsx prisma/seed-demo.ts --wipe
//
// Idempotent: safe to run repeatedly. Everything it creates is tagged so `--wipe`
// removes exactly this data and nothing else:
//   • courses  -> name starts with "[DEMO] "
//   • students -> cardNumber in the 0186-0009-XXXX range
//   • combos   -> name starts with "[DEMO] "
//   • expenses -> reason starts with "[DEMO] "
// Base reference rows (ClassType / FeeTier / ExpenseType / Setting / Stream) are
// READ ONLY here, and the admin user is never touched.
//
// Scale: ~11 teachers, ~28 courses, ~110 students, with attendance on every one
// of the last 10 days (today included) against classes that actually meet that
// weekday. Big enough that the reports look like a real institute, small enough
// that the terminal screens stay quick. The first four teachers, first nine
// courses and first fifteen students are the load-bearing cases — the combos,
// the fraud case, the tier spread and the open-now schedule all live there.
//
// NO LOGINS ARE CREATED. Teachers and staff are entities only; a committed seed
// cannot hold a password without publishing it, and this repo is public. Create
// real logins through Setup → Teachers with a password you choose.
// -----------------------------------------------------------------------------

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { colomboDateValue, colomboNow } from "../src/lib/colombo-time";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Neither DIRECT_URL nor DATABASE_URL is set (check .env).");
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const DEMO = "[DEMO] ";
const DEMO_CARD_PREFIX = "0186-0009-";

/**
 * Which students belong to this seed.
 *
 * Card number alone is not enough: one demo student deliberately has none, to
 * exercise the UID-only path. Matching on the name list too keeps `--wipe`
 * exact — and the same selector guards payment re-seeding, so a wipe that
 * missed a student can't cause duplicate payments on the next run.
 */
const demoStudentWhere = () => ({
  OR: [
    { cardNumber: { startsWith: DEMO_CARD_PREFIX } },
    { name: { in: STUDENT_NAMES } },
  ],
});

// --- helpers ----------------------------------------------------------------

/** Shift an "HH:mm" by minutes, clamped inside the day. */
function shift(time: string, mins: number): string {
  const [h, m] = time.split(":").map(Number);
  const t = Math.max(0, Math.min(24 * 60 - 1, h * 60 + m + mins));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** A Colombo calendar date N days back, as the DATE value the app stores. */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return colomboDateValue(colomboNow(d).date);
}

/**
 * A given day of the LAST COMPLETED month, Colombo.
 *
 * Combo attendance is seeded here rather than by "days ago" on purpose: the
 * combined-payment fraud check reads last completed month, so evidence spread
 * by days-ago would mostly land in the current month and the lopsided case
 * would not show where staff actually look.
 */
function dayInLastMonth(day: number): Date {
  const [y, m] = colomboNow().date.split("-").map(Number);
  const year = m === 1 ? y - 1 : y;
  const month = m === 1 ? 12 : m - 1;
  return colomboDateValue(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );
}

/** Money as a fixed 2dp string — Decimal columns never see a float. */
const money = (n: number) => n.toFixed(2);

/**
 * clientRef is UNIQUE and is what makes attendance seeding idempotent: it is
 * derived from (student, course, day) — exactly the app's own "one mark per
 * student per class per day" rule — so a re-run collides with itself and
 * `skipDuplicates` drops the repeat instead of doubling the history.
 */
const attRef = (tag: string, studentId: number, courseId: number, date: Date) =>
  `demo-${tag}-${studentId}-${courseId}-${date.toISOString().slice(0, 10)}`;

/**
 * A stable pseudo-random number in [0,1) from a string key (FNV-1a, then a
 * xorshift finaliser). Attendance has to look random but BE deterministic:
 * re-running the seed must reach the same present/absent decisions, or every
 * run would rewrite the reports staff are looking at.
 */
function rand(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Pick from a list by stable hash. */
const pick = <T,>(key: string, list: readonly T[]): T => list[Math.floor(rand(key) * list.length)];


// --- wipe -------------------------------------------------------------------

async function wipe() {
  const students = await db.student.findMany({
    where: demoStudentWhere(),
    select: { id: true },
  });
  const studentIds = students.map((s) => s.id);

  const courses = await db.course.findMany({
    where: { name: { startsWith: DEMO } },
    select: { id: true },
  });
  const courseIds = courses.map((c) => c.id);

  const combos = await db.combo.findMany({
    where: { name: { startsWith: DEMO } },
    select: { id: true },
  });
  const comboIds = combos.map((c) => c.id);

  // FK-safe order: leaf rows first.
  await db.attendance.deleteMany({
    where: { OR: [{ studentId: { in: studentIds } }, { courseId: { in: courseIds } }] },
  });
  await db.payment.deleteMany({
    where: { OR: [{ studentId: { in: studentIds } }, { courseId: { in: courseIds } }] },
  });
  await db.enrollment.deleteMany({
    where: { OR: [{ studentId: { in: studentIds } }, { courseId: { in: courseIds } }] },
  });
  await db.comboItem.deleteMany({
    where: { OR: [{ comboId: { in: comboIds } }, { courseId: { in: courseIds } }] },
  });
  await db.combo.deleteMany({ where: { id: { in: comboIds } } });
  await db.additionalClass.deleteMany({ where: { courseId: { in: courseIds } } });
  await db.schedule.deleteMany({ where: { courseId: { in: courseIds } } });
  await db.student.deleteMany({ where: { id: { in: studentIds } } });
  await db.expense.deleteMany({ where: { reason: { startsWith: DEMO } } });
  await db.course.deleteMany({ where: { id: { in: courseIds } } });

  // Teachers/staff/subjects/grades created by this seed, only if now unused.
  const teacherNames = TEACHERS.map((t) => t.name);
  const teacherRows = await db.teacher.findMany({
    where: { name: { in: teacherNames } },
    select: { id: true, _count: { select: { courses: true, combos: true, advances: true } } },
  });
  await db.teacher.deleteMany({
    where: {
      id: {
        in: teacherRows
          .filter((t) => t._count.courses + t._count.combos + t._count.advances === 0)
          .map((t) => t.id),
      },
    },
  });

  const staffRows = await db.staff.findMany({
    where: { name: { in: STAFF.map((s) => s.name) } },
    select: { id: true, _count: { select: { advances: true } } },
  });
  await db.staff.deleteMany({
    where: { id: { in: staffRows.filter((s) => s._count.advances === 0).map((s) => s.id) } },
  });

  for (const label of SUBJECTS) {
    const used = await db.course.count({ where: { subject: { label } } });
    if (used === 0) await db.subject.deleteMany({ where: { label } });
  }
  for (const label of GRADES) {
    const used = await db.course.count({ where: { grade: { label } } });
    if (used === 0) await db.grade.deleteMany({ where: { label } });
  }

  console.log("Demo data wiped.");
}

// --- definitions ------------------------------------------------------------

const SUBJECTS = [
  "ICT", "Chemistry", "Physics", "Combined Maths", "Biology", "Accounting",
  "English", "Mathematics", "Science", "Business Studies", "Economics",
];
const GRADES = ["A/L 2027", "A/L 2026", "A/L 2025", "Grade 11", "Grade 10", "Grade 9"];

/**
 * The first four are load-bearing: the combos, the fraud case and every payslip
 * assertion name them. Anything appended after them is volume — it makes the
 * reports look like a real institute without touching those cases.
 */
const TEACHERS = [
  { name: "Ms. R. Wickramasinghe", nic: "198534500678", phone: "0772222222" },
  { name: "Mr. A. Gunawardena", nic: "197812300456", phone: "0771111111" },
  { name: "Mr. S. Rathnayake", nic: "198045600789", phone: "0773333333" },
  { name: "Mrs. D. Alwis", nic: "198711100222", phone: "0774444444" },
  { name: "Mr. N. Jayasuriya", nic: "198209800123", phone: "0777000001" },
  { name: "Ms. T. Karunaratne", nic: "199103400567", phone: "0777000002" },
  { name: "Mr. L. Dissanayake", nic: "197905600890", phone: "0777000003" },
  { name: "Mrs. S. Amarasinghe", nic: "198607800234", phone: "0777000004" },
  { name: "Mr. H. Pathirana", nic: "198401200345", phone: "0777000005" },
  { name: "Ms. N. Liyanage", nic: "199205600456", phone: "0777000006" },
  { name: "Mr. C. Wijeratne", nic: "198310900567", phone: "0777000007" },
];

/** Every demo student's name — the other half of `demoStudentWhere`. */
const STUDENT_NAMES = [
  "Nimali Rajapaksa", "Tharindu Weerasinghe", "Sanduni Herath",
  "Kavindu Jayawardena", "Ishara Madushani", "Dilshan Peiris",
  "Hasini Gunasekara", "Ruwan Bandara", "Amaya Fernando",
  "Chamod Senanayake", "Piyumi Wijesinghe", "Nuwan Ekanayake",
  "Sewwandi Kumari", "Malith Abeysekara", "Oshadi Perera",
];

const STAFF = [
  { name: "Ms. K. Dias", nic: "199022200333", phone: "0775555555" },
  { name: "Mr. P. Silva", nic: "198833300444", phone: "0776666666" },
];

// --- seed -------------------------------------------------------------------

async function seed() {
  const now = colomboNow();

  // Reference rows are read, never created.
  const [theory, paper, revision] = await Promise.all([
    db.classType.findUniqueOrThrow({ where: { code: "THEORY" } }),
    db.classType.findUniqueOrThrow({ where: { code: "PAPER" } }),
    db.classType.findUniqueOrThrow({ where: { code: "REVISION" } }),
  ]);
  const [full, half, quarter, free] = await Promise.all([
    db.feeTier.findUniqueOrThrow({ where: { code: "FULL" } }),
    db.feeTier.findUniqueOrThrow({ where: { code: "HALF" } }),
    db.feeTier.findUniqueOrThrow({ where: { code: "QUARTER" } }),
    db.feeTier.findUniqueOrThrow({ where: { code: "FREE" } }),
  ]);
  const [teacherAdvance, xenonExpense] = await Promise.all([
    db.expenseType.findUniqueOrThrow({ where: { code: "TEACHER_ADVANCE" } }),
    db.expenseType.findUniqueOrThrow({ where: { code: "XENON" } }),
  ]);
  const [alStream, techStream, sciStream, comStream] = await Promise.all([
    db.stream.findFirstOrThrow({ where: { label: "A/L" } }),
    db.stream.findFirstOrThrow({ where: { label: "Tech" } }),
    db.stream.findFirstOrThrow({ where: { label: "Science" } }),
    db.stream.findFirstOrThrow({ where: { label: "Commerce" } }),
  ]);

  // Every audited row needs a user; the seed uses the existing admin rather
  // than inventing a login.
  const actor = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });

  // --- subjects / grades ---
  const subject: Record<string, number> = {};
  for (const label of SUBJECTS) {
    const row = await db.subject.upsert({ where: { label }, update: {}, create: { label } });
    subject[label] = row.id;
  }
  const grade: Record<string, number> = {};
  for (const label of GRADES) {
    const row = await db.grade.upsert({ where: { label }, update: {}, create: { label } });
    grade[label] = row.id;
  }

  // --- teachers + staff (entities only, no logins) ---
  const teacher: Record<string, number> = {};
  for (const t of TEACHERS) {
    const found = await db.teacher.findFirst({ where: { name: t.name } });
    const row =
      found ??
      (await db.teacher.create({ data: { ...t, joinDate: new Date("2024-01-15") } }));
    teacher[t.name] = row.id;
  }
  const staff: Record<string, number> = {};
  for (const s of STAFF) {
    const found = await db.staff.findFirst({ where: { name: s.name } });
    const row = found ?? (await db.staff.create({ data: s }));
    staff[s.name] = row.id;
  }

  // --- courses ---
  const CHEM = "Ms. R. Wickramasinghe";
  const ICT_T = "Mr. A. Gunawardena";
  type CourseDef = {
    key: string; name: string; teacher: string; subject: string; grade: string;
    classType: number; stream: number; fee: number; share: string;
  };
  const courseDefs: CourseDef[] = [
    // Full combo set for one teacher, so combos are meaningful.
    { key: "chemT", name: `${DEMO}A/L 2027 Chemistry Theory`, teacher: CHEM, subject: "Chemistry", grade: "A/L 2027", classType: theory.id, stream: sciStream.id, fee: 3000, share: "20.00" },
    { key: "chemP", name: `${DEMO}A/L 2027 Chemistry Paper`, teacher: CHEM, subject: "Chemistry", grade: "A/L 2027", classType: paper.id, stream: sciStream.id, fee: 2500, share: "25.00" },
    { key: "chemR", name: `${DEMO}A/L 2027 Chemistry Revision`, teacher: CHEM, subject: "Chemistry", grade: "A/L 2027", classType: revision.id, stream: sciStream.id, fee: 2000, share: "30.00" },
    // Second combo-capable pair.
    { key: "ictT", name: `${DEMO}A/L 2027 ICT Theory`, teacher: ICT_T, subject: "ICT", grade: "A/L 2027", classType: theory.id, stream: techStream.id, fee: 2500, share: "25.00" },
    { key: "ictP", name: `${DEMO}A/L 2027 ICT Paper`, teacher: ICT_T, subject: "ICT", grade: "A/L 2027", classType: paper.id, stream: techStream.id, fee: 2200, share: "27.50" },
    // Standalones.
    { key: "phyT", name: `${DEMO}A/L 2026 Physics Theory`, teacher: "Mr. S. Rathnayake", subject: "Physics", grade: "A/L 2026", classType: theory.id, stream: sciStream.id, fee: 2800, share: "25.00" },
    { key: "cmT", name: `${DEMO}A/L 2027 Combined Maths Theory`, teacher: "Mr. S. Rathnayake", subject: "Combined Maths", grade: "A/L 2027", classType: theory.id, stream: alStream.id, fee: 3000, share: "30.00" },
    { key: "bioT", name: `${DEMO}A/L 2026 Biology Theory`, teacher: "Mrs. D. Alwis", subject: "Biology", grade: "A/L 2026", classType: theory.id, stream: sciStream.id, fee: 2600, share: "20.00" },
    { key: "accT", name: `${DEMO}Grade 11 Accounting Theory`, teacher: "Mrs. D. Alwis", subject: "Accounting", grade: "Grade 11", classType: theory.id, stream: comStream.id, fee: 1500, share: "25.00" },
  ];

  /**
   * Volume courses. Deliberately appended AFTER the nine above so the combo /
   * fraud / tier cases keep their exact shape; these only widen the reports.
   * `day`/`start` give each one a weekly session, which is what the live
   * attendance below marks against.
   */
  const extraCourseDefs = [
    { key: "x01", subject: "Physics", grade: "A/L 2027", teacher: "Mr. N. Jayasuriya", classType: theory.id, stream: sciStream.id, fee: 3000, share: "25.00", day: "MON", start: "08:00", end: "10:00" },
    { key: "x02", subject: "Physics", grade: "A/L 2027", teacher: "Mr. N. Jayasuriya", classType: paper.id, stream: sciStream.id, fee: 2400, share: "27.50", day: "THU", start: "15:00", end: "17:00" },
    { key: "x03", subject: "Chemistry", grade: "A/L 2026", teacher: "Ms. T. Karunaratne", classType: theory.id, stream: sciStream.id, fee: 2900, share: "20.00", day: "TUE", start: "08:00", end: "10:00" },
    { key: "x04", subject: "Chemistry", grade: "A/L 2026", teacher: "Ms. T. Karunaratne", classType: revision.id, stream: sciStream.id, fee: 2100, share: "30.00", day: "SAT", start: "08:00", end: "10:00" },
    { key: "x05", subject: "Combined Maths", grade: "A/L 2026", teacher: "Mr. L. Dissanayake", classType: theory.id, stream: alStream.id, fee: 3200, share: "30.00", day: "WED", start: "08:00", end: "10:30" },
    { key: "x06", subject: "Combined Maths", grade: "A/L 2026", teacher: "Mr. L. Dissanayake", classType: paper.id, stream: alStream.id, fee: 2600, share: "27.50", day: "SUN", start: "08:00", end: "10:00" },
    { key: "x07", subject: "Biology", grade: "A/L 2027", teacher: "Mrs. S. Amarasinghe", classType: theory.id, stream: sciStream.id, fee: 2800, share: "20.00", day: "MON", start: "13:00", end: "15:00" },
    { key: "x08", subject: "Biology", grade: "A/L 2027", teacher: "Mrs. S. Amarasinghe", classType: paper.id, stream: sciStream.id, fee: 2300, share: "25.00", day: "FRI", start: "08:00", end: "10:00" },
    { key: "x09", subject: "ICT", grade: "A/L 2026", teacher: "Mr. H. Pathirana", classType: theory.id, stream: techStream.id, fee: 2500, share: "25.00", day: "TUE", start: "15:00", end: "17:00" },
    { key: "x10", subject: "ICT", grade: "Grade 11", teacher: "Mr. H. Pathirana", classType: theory.id, stream: techStream.id, fee: 1600, share: "25.00", day: "SAT", start: "11:00", end: "12:30" },
    { key: "x11", subject: "English", grade: "Grade 11", teacher: "Ms. N. Liyanage", classType: theory.id, stream: comStream.id, fee: 1500, share: "20.00", day: "WED", start: "15:00", end: "16:30" },
    { key: "x12", subject: "English", grade: "Grade 10", teacher: "Ms. N. Liyanage", classType: theory.id, stream: comStream.id, fee: 1400, share: "20.00", day: "SUN", start: "13:00", end: "14:30" },
    { key: "x13", subject: "Mathematics", grade: "Grade 11", teacher: "Mr. C. Wijeratne", classType: theory.id, stream: comStream.id, fee: 1700, share: "25.00", day: "THU", start: "13:00", end: "15:00" },
    { key: "x14", subject: "Mathematics", grade: "Grade 10", teacher: "Mr. C. Wijeratne", classType: theory.id, stream: comStream.id, fee: 1600, share: "25.00", day: "FRI", start: "15:00", end: "17:00" },
    { key: "x15", subject: "Mathematics", grade: "Grade 9", teacher: "Mr. C. Wijeratne", classType: theory.id, stream: comStream.id, fee: 1400, share: "22.50", day: "SAT", start: "16:30", end: "18:00" },
    { key: "x16", subject: "Science", grade: "Grade 11", teacher: "Mrs. S. Amarasinghe", classType: theory.id, stream: sciStream.id, fee: 1600, share: "22.50", day: "TUE", start: "13:00", end: "14:30" },
    { key: "x17", subject: "Science", grade: "Grade 10", teacher: "Mrs. S. Amarasinghe", classType: theory.id, stream: sciStream.id, fee: 1500, share: "22.50", day: "MON", start: "17:00", end: "18:30" },
    { key: "x18", subject: "Business Studies", grade: "A/L 2025", teacher: "Ms. N. Liyanage", classType: theory.id, stream: comStream.id, fee: 2400, share: "25.00", day: "WED", start: "17:00", end: "19:00" },
    { key: "x19", subject: "Economics", grade: "A/L 2025", teacher: "Mr. L. Dissanayake", classType: theory.id, stream: comStream.id, fee: 2400, share: "27.50", day: "FRI", start: "17:00", end: "19:00" },
  ] as const;

  for (const c of extraCourseDefs) {
    const label =
      c.classType === theory.id ? "Theory" : c.classType === paper.id ? "Paper" : "Revision";
    courseDefs.push({
      key: c.key,
      name: `${DEMO}${c.grade} ${c.subject} ${label}`,
      teacher: c.teacher,
      subject: c.subject,
      grade: c.grade,
      classType: c.classType,
      stream: c.stream,
      fee: c.fee,
      share: c.share,
    });
  }

  const course: Record<string, { id: number; fee: number; share: string }> = {};
  for (const c of courseDefs) {
    const found = await db.course.findFirst({ where: { name: c.name } });
    const row =
      found ??
      (await db.course.create({
        data: {
          name: c.name,
          teacherId: teacher[c.teacher],
          subjectId: subject[c.subject],
          gradeId: grade[c.grade],
          streamId: c.stream,
          classTypeId: c.classType,
          defaultFee: money(c.fee),
          instituteSharePercent: c.share,
        },
      }));
    course[c.key] = { id: row.id, fee: c.fee, share: c.share };
  }

  // --- combos (one deliberately inactive) ---
  const comboDefs = [
    { name: `${DEMO}Chemistry Theory+Paper`, teacher: CHEM, active: true, items: [["chemT", 2000], ["chemP", 2000]] as [string, number][] },
    { name: `${DEMO}Chemistry Theory+Paper+Revision`, teacher: CHEM, active: true, items: [["chemT", 1800], ["chemP", 1800], ["chemR", 1800]] as [string, number][] },
    { name: `${DEMO}ICT Theory+Paper`, teacher: ICT_T, active: false, items: [["ictT", 2100], ["ictP", 1900]] as [string, number][] },
  ];
  const combo: Record<string, number> = {};
  for (const c of comboDefs) {
    let row = await db.combo.findFirst({ where: { name: c.name } });
    if (!row) {
      row = await db.combo.create({
        data: {
          name: c.name,
          teacherId: teacher[c.teacher],
          active: c.active,
          items: {
            create: c.items.map(([key, fee]) => ({
              courseId: course[key].id,
              comboFee: money(fee),
            })),
          },
        },
      });
    }
    combo[c.name] = row.id;
  }

  // --- schedules ---------------------------------------------------------
  // The first one is deliberately OPEN RIGHT NOW (Colombo), so attendance is
  // testable the moment this finishes with no extra setup.
  // The open-now row is matched on (course, day) only and UPDATED, never
  // appended: its times are relative to "now", so keying on startTime would add
  // a fresh schedule on every re-run. Updating also re-opens the window if the
  // seed is run again later in the day.
  const openStart = shift(now.time, -30);
  const openEnd = shift(now.time, 120);
  const existingOpen = await db.schedule.findFirst({
    where: { courseId: course.chemT.id, dayOfWeek: now.dayOfWeek as never },
  });
  if (existingOpen) {
    await db.schedule.update({
      where: { id: existingOpen.id },
      data: { startTime: openStart, endTime: openEnd, active: true },
    });
  } else {
    await db.schedule.create({
      data: {
        courseId: course.chemT.id,
        dayOfWeek: now.dayOfWeek as never,
        startTime: openStart,
        endTime: openEnd,
        attendanceOpensBeforeMin: 30,
        attendanceClosesBeforeMin: 30,
        active: true,
      },
    });
  }

  const scheduleDefs: { course: string; day: string; start: string; end: string; active: boolean }[] = [
    { course: "ictT", day: "MON", start: "15:00", end: "17:00", active: true },
    { course: "ictP", day: "WED", start: "15:00", end: "17:00", active: true },
    { course: "chemP", day: "THU", start: "08:00", end: "10:00", active: true },
    { course: "phyT", day: "FRI", start: "13:00", end: "15:00", active: true },
    { course: "cmT", day: "SAT", start: "09:00", end: "11:30", active: true },
    { course: "bioT", day: "SAT", start: "14:00", end: "16:00", active: true },
    { course: "accT", day: "SUN", start: "10:00", end: "12:00", active: false },
    ...extraCourseDefs.map((c) => ({
      course: c.key, day: c.day, start: c.start, end: c.end, active: true,
    })),
  ];
  for (const s of scheduleDefs) {
    const exists = await db.schedule.findFirst({
      where: { courseId: course[s.course].id, dayOfWeek: s.day as never, startTime: s.start },
    });
    if (!exists) {
      await db.schedule.create({
        data: {
          courseId: course[s.course].id,
          dayOfWeek: s.day as never,
          startTime: s.start,
          endTime: s.end,
          attendanceOpensBeforeMin: 30,
          attendanceClosesBeforeMin: 30,
          active: s.active,
        },
      });
    }
  }

  // An additional class dated today and open now, on a combo course, so the
  // confirm path is testable immediately too.
  //
  // Deliberately on ICT Paper rather than a Chemistry course: its student
  // (Dilshan) has no other class open today, so he hits the confirm path
  // cleanly, while Nimali still hits the single-regular auto-mark. Putting both
  // on one student would only ever produce a pick-list.
  const todayDate = colomboDateValue(now.date);
  const addExists = await db.additionalClass.findFirst({
    where: { courseId: course.ictP.id, date: todayDate },
  });
  if (addExists) {
    // Same reasoning as the open-now schedule: refresh rather than duplicate.
    await db.additionalClass.update({
      where: { id: addExists.id },
      data: { startTime: shift(now.time, -15), endTime: shift(now.time, 150) },
    });
  } else {
    await db.additionalClass.create({
      data: {
        courseId: course.ictP.id,
        date: todayDate,
        startTime: shift(now.time, -15),
        endTime: shift(now.time, 150),
        attendanceOpensBeforeMin: 30,
        attendanceClosesBeforeMin: 30,
        note: `${DEMO}Poya-day extra session`,
      },
    });
  }

  // --- students -----------------------------------------------------------
  // `enrol` lists [courseKey, feeTier]; combo eligibility follows from it.
  type Tier = typeof full;
  const S = (n: number) => `${DEMO_CARD_PREFIX}${String(n).padStart(4, "0")}`;
  type StudentDef = {
    n: number;
    name: string;
    school: string;
    phone: string;
    uid: string | null;
    number: string | null;
    admissionPaid: boolean;
    enrol: [string, Tier][];
    dropped?: string;
  };
  const studentDefs: StudentDef[] = [
    // Combo-eligible: Theory + Paper (qualifies for the 2-way combo).
    { n: 1, name: "Nimali Rajapaksa", school: "Holy Family Convent", phone: "0770000001", uid: "0A100001", number: S(1), admissionPaid: true, enrol: [["chemT", full], ["chemP", full]] },
    // The fraud case: attends Theory but almost never Paper (history below).
    { n: 2, name: "Tharindu Weerasinghe", school: "Kalutara Vidyalaya", phone: "0770000002", uid: "0A100002", number: S(2), admissionPaid: true, enrol: [["chemT", full], ["chemP", full]] },
    // Qualifies for the 3-way combo.
    { n: 3, name: "Sanduni Herath", school: "Holy Family Convent", phone: "0770000003", uid: "0A100003", number: S(3), admissionPaid: true, enrol: [["chemT", half], ["chemP", half], ["chemR", half]] },
    // Theory only — deliberately does NOT qualify.
    { n: 4, name: "Kavindu Jayawardena", school: "St. John's College", phone: "0770000004", uid: "0A100004", number: S(4), admissionPaid: true, enrol: [["chemT", full]] },
    { n: 5, name: "Ishara Madushani", school: "Tissa Central", phone: "0770000005", uid: "0A100005", number: S(5), admissionPaid: true, enrol: [["chemT", quarter]] },
    // ICT pair.
    { n: 6, name: "Dilshan Peiris", school: "St. John's College", phone: "0770000006", uid: "0A100006", number: S(6), admissionPaid: true, enrol: [["ictT", full], ["ictP", full]] },
    { n: 7, name: "Hasini Gunasekara", school: "Kalutara Vidyalaya", phone: "0770000007", uid: "0A100007", number: S(7), admissionPaid: false, enrol: [["ictT", half]] },
    // Standalones, mixed tiers.
    { n: 8, name: "Ruwan Bandara", school: "Tissa Central", phone: "0770000008", uid: "0A100008", number: S(8), admissionPaid: true, enrol: [["phyT", full]] },
    { n: 9, name: "Amaya Fernando", school: "Holy Family Convent", phone: "0770000009", uid: "0A100009", number: S(9), admissionPaid: false, enrol: [["phyT", half], ["cmT", full]] },
    { n: 10, name: "Chamod Senanayake", school: "Royal College", phone: "0770000010", uid: "0A10000A", number: S(10), admissionPaid: true, enrol: [["cmT", quarter]] },
    { n: 11, name: "Piyumi Wijesinghe", school: "Royal College", phone: "0770000011", uid: "0A10000B", number: S(11), admissionPaid: true, enrol: [["bioT", free]] },
    { n: 12, name: "Nuwan Ekanayake", school: "Ananda College", phone: "0770000012", uid: "0A10000C", number: S(12), admissionPaid: false, enrol: [["bioT", full]] },
    { n: 13, name: "Sewwandi Kumari", school: "Ananda College", phone: "0770000013", uid: "0A10000D", number: S(13), admissionPaid: true, enrol: [["accT", full]] },
    // Identifier edge cases: card number only, and UID only.
    { n: 14, name: "Malith Abeysekara", school: "Kalutara Vidyalaya", phone: "0770000014", uid: null, number: S(14), admissionPaid: true, enrol: [["accT", half]] },
    { n: 15, name: "Oshadi Perera", school: "Tissa Central", phone: "0770000015", uid: "0A10000F", number: null, admissionPaid: true, enrol: [["ictT", full]], dropped: "ictP" },
  ];

  /**
   * Volume students, n = 101 upward so the fifteen hand-built cases above keep
   * their numbers and their card numbers. Everything about them is derived from
   * a stable hash of their own name, so a re-run produces byte-identical rows.
   *
   * They all get a card number (the DEMO prefix), which is what `--wipe`
   * matches on — the name list stays reserved for the one hand-built student
   * who deliberately has none.
   */
  const FIRST_NAMES = [
    "Nadeesha", "Kasun", "Thilini", "Lahiru", "Dinusha", "Sachini", "Isuru",
    "Rashmi", "Chathura", "Upeksha", "Gayan", "Nethmi", "Sahan", "Dulani",
    "Pasindu", "Tharushi", "Janith", "Hiruni", "Randika", "Anjali", "Buddhika",
    "Shanika", "Tharaka", "Nipuni", "Charith", "Yasodha", "Kalpa", "Erandi",
  ];
  const SURNAMES = [
    "Ratnayake", "Samarasinghe", "Wijekoon", "Dharmasena", "Ilangakoon",
    "Munasinghe", "Karunanayake", "Seneviratne", "Abeywickrama", "Gamage",
    "Hettiarachchi", "Wanigasekara", "Pathiraja", "Kodikara", "Rupasinghe",
  ];
  const SCHOOLS = [
    "Royal College", "Ananda College", "Visakha Vidyalaya", "Nalanda College",
    "Holy Family Convent", "St. John's College", "Tissa Central",
    "Kalutara Vidyalaya", "Devi Balika Vidyalaya", "Mahanama College",
  ];
  // Weighted so FULL dominates and FREE is rare — the tier spread stays
  // visible without pretending a quarter of the institute pays nothing.
  const TIER_POOL: Tier[] = [full, full, full, full, full, half, half, quarter, free];
  const extraCourseKeys = extraCourseDefs.map((c) => c.key);

  const takenNames = new Set(STUDENT_NAMES);
  for (let i = 0; i < 95; i++) {
    const n = 101 + i;
    const seed = `student-${n}`;
    let name = `${pick(`${seed}-first`, FIRST_NAMES)} ${pick(`${seed}-last`, SURNAMES)}`;
    // Two students may share a name in real life, but a duplicate here would
    // make the demo confusing to read; nudge until it's unique.
    for (let bump = 1; takenNames.has(name); bump++) {
      name = `${pick(`${seed}-first-${bump}`, FIRST_NAMES)} ${pick(`${seed}-last-${bump}`, SURNAMES)}`;
    }
    takenNames.add(name);

    // 1–3 courses, drawn from the volume set (occasionally a core one, so the
    // original nine courses have believable class sizes too).
    const howMany = 1 + Math.floor(rand(`${seed}-count`) * 3);
    const keys = new Set<string>();
    for (let k = 0; k < howMany; k++) {
      const fromCore = rand(`${seed}-core-${k}`) < 0.25;
      const poolKeys = fromCore
        ? ["chemT", "chemP", "ictT", "phyT", "cmT", "bioT", "accT"]
        : extraCourseKeys;
      keys.add(pick(`${seed}-course-${k}`, poolKeys));
    }

    studentDefs.push({
      n,
      name,
      school: pick(`${seed}-school`, SCHOOLS),
      phone: `07${String(80000000 + i * 137).padStart(8, "0")}`,
      uid: `0B${String(n).padStart(6, "0")}`,
      number: S(n),
      admissionPaid: rand(`${seed}-adm`) < 0.88,
      enrol: [...keys].map((key) => [key, pick(`${seed}-tier-${key}`, TIER_POOL)] as [string, Tier]),
    });
  }

  const student: Record<number, number> = {};
  for (const s of studentDefs) {
    let row = s.number
      ? await db.student.findUnique({ where: { cardNumber: s.number } })
      : await db.student.findFirst({ where: { name: s.name } });

    if (!row) {
      row = await db.student.create({
        data: {
          name: s.name,
          school: s.school,
          phone: s.phone,
          cardUid: s.uid,
          cardNumber: s.number,
          admissionPaid: s.admissionPaid,
          // photoUrl stays null — Cloudinary is not seeded.
        },
      });
      for (const [key, tier] of s.enrol) {
        await db.enrollment.create({
          data: { studentId: row.id, courseId: course[key].id, feeTierId: tier.id, status: "ACTIVE" },
        });
      }
      if (s.dropped) {
        await db.enrollment.create({
          data: { studentId: row.id, courseId: course[s.dropped].id, feeTierId: full.id, status: "DROPPED" },
        });
      }
    }
    student[s.n] = row.id;
  }

  // --- attendance history (last ~30 days) ---------------------------------
  // Enough past data for the combined-payment "did they actually attend?" check,
  // including the fraud case: student 2 attends Theory but rarely Paper.
  const methods = ["NFC", "QR", "SEARCH"] as const;
  // Combo courses: days of the LAST COMPLETED month, so the fraud check has
  // something to show. Non-combo courses stay on a rolling days-ago spread.
  const lastMonthPlan: { student: number; course: string; days: number[] }[] = [
    { student: 1, course: "chemT", days: [3, 10, 17, 24] },
    { student: 1, course: "chemP", days: [4, 11, 18, 25] },
    { student: 2, course: "chemT", days: [3, 10, 17, 24, 27] }, // diligent in Theory
    { student: 2, course: "chemP", days: [4] },                 // ...but not Paper
    { student: 3, course: "chemT", days: [5, 19] },
    { student: 3, course: "chemP", days: [6, 20] },
    { student: 3, course: "chemR", days: [7, 21] },
    { student: 4, course: "chemT", days: [8, 22] },
    { student: 6, course: "ictT", days: [2, 9, 16, 23] },
    { student: 6, course: "ictP", days: [5, 12] },
  ];
  const attendancePlan: { student: number; course: string; days: number[] }[] = [
    { student: 8, course: "phyT", days: [22, 15, 8] },
  ];

  // Written with createMany + skipDuplicates rather than guarded by a global
  // count: each ref carries (student, course, day), so a re-run collides with
  // itself and inserts nothing. That also means new history can be added later
  // without a wipe.
  const history: {
    studentId: number; courseId: number; date: Date; method: (typeof methods)[number];
    markedById: string; markedAt: Date; clientRef: string;
  }[] = [];

  for (const plan of attendancePlan) {
    for (const [i, d] of plan.days.entries()) {
      const when = daysAgo(d);
      history.push({
        studentId: student[plan.student],
        courseId: course[plan.course].id,
        date: when,
        method: methods[i % methods.length],
        markedById: actor.id,
        markedAt: when,
        clientRef: attRef("att", student[plan.student], course[plan.course].id, when),
      });
    }
  }
  for (const plan of lastMonthPlan) {
    for (const [i, d] of plan.days.entries()) {
      const when = dayInLastMonth(d);
      history.push({
        studentId: student[plan.student],
        courseId: course[plan.course].id,
        date: when,
        method: methods[i % methods.length],
        markedById: actor.id,
        markedAt: when,
        clientRef: attRef("lm", student[plan.student], course[plan.course].id, when),
      });
    }
  }

  // --- live attendance: the last 10 days, including today -----------------
  //
  // Marked only against courses that ACTUALLY have a session that weekday, read
  // back from the schedules just written plus any additional class on the day —
  // seeding a mark for a class that never met would make Daily Attendance lie.
  //
  // Who attends is a stable hash of (course, day, student), so the mix is
  // realistic but reproducible: roughly 60–85% of a course's active students,
  // with the rate itself varying per course per day.
  const LIVE_DAYS = 10;

  const activeSchedules = await db.schedule.findMany({
    where: { active: true, course: { name: { startsWith: DEMO } } },
    select: { courseId: true, dayOfWeek: true },
  });
  const courseIdsByWeekday = new Map<string, number[]>();
  for (const sc of activeSchedules) {
    const list = courseIdsByWeekday.get(sc.dayOfWeek) ?? [];
    list.push(sc.courseId);
    courseIdsByWeekday.set(sc.dayOfWeek, list);
  }

  const extraSessions = await db.additionalClass.findMany({
    where: { course: { name: { startsWith: DEMO } } },
    select: { courseId: true, date: true },
  });
  const courseIdsByDate = new Map<string, number[]>();
  for (const a of extraSessions) {
    const key = a.date.toISOString().slice(0, 10);
    const list = courseIdsByDate.get(key) ?? [];
    list.push(a.courseId);
    courseIdsByDate.set(key, list);
  }

  const activeEnrolments = await db.enrollment.findMany({
    where: { status: "ACTIVE", course: { name: { startsWith: DEMO } } },
    select: { studentId: true, courseId: true },
  });
  const rosterOf = new Map<number, number[]>();
  for (const e of activeEnrolments) {
    const list = rosterOf.get(e.courseId) ?? [];
    list.push(e.studentId);
    rosterOf.set(e.courseId, list);
  }

  for (let back = LIVE_DAYS - 1; back >= 0; back--) {
    const at = new Date();
    at.setUTCDate(at.getUTCDate() - back);
    const day = colomboNow(at);
    const dateValue = colomboDateValue(day.date);

    const meeting = new Set([
      ...(courseIdsByWeekday.get(day.dayOfWeek) ?? []),
      ...(courseIdsByDate.get(dateValue.toISOString().slice(0, 10)) ?? []),
    ]);

    for (const courseId of meeting) {
      const roster = rosterOf.get(courseId) ?? [];
      // 60–85%, drifting by course and by day — never everyone, never nobody.
      const presentRate = 0.6 + rand(`rate-${courseId}-${day.date}`) * 0.25;

      for (const studentId of roster) {
        if (rand(`mark-${courseId}-${day.date}-${studentId}`) >= presentRate) continue;
        history.push({
          studentId,
          courseId,
          date: dateValue,
          method: pick(`method-${courseId}-${day.date}-${studentId}`, methods),
          markedById: actor.id,
          // Mid-morning Colombo, so the timestamp reads sensibly next to the date.
          markedAt: new Date(dateValue.getTime() + 4 * 60 * 60 * 1000),
          clientRef: attRef("live", studentId, courseId, dateValue),
        });
      }
    }
  }

  await db.attendance.createMany({ data: history, skipDuplicates: true });

  // --- payments -----------------------------------------------------------
  const admissionFee = Number(
    (await db.setting.findUnique({ where: { key: "admission_fee" } }))?.value ?? "1300",
  );
  const smartCardFee = Number(
    (await db.setting.findUnique({ where: { key: "smart_card_fee" } }))?.value ?? "500",
  );

  /**
   * Payments are deduped precisely instead of behind one global "has this seed
   * run?" flag: the app's own rule is one un-cancelled CLASS payment per
   * student per course per billing month, so that tuple is the key. Re-running
   * adds only what is genuinely missing, which is what lets the volume students
   * below be added to an already-seeded database.
   */
  const existingPayments = await db.payment.findMany({
    where: { student: demoStudentWhere() },
    select: {
      kind: true, studentId: true, courseId: true,
      billingYear: true, billingMonth: true, comboId: true, cancelled: true,
    },
  });
  const classKey = (sid: number, cid: number, y: number, m: number) => `${sid}:${cid}:${y}:${m}`;
  const haveClass = new Set(
    existingPayments
      .filter((p) => p.kind === "CLASS" && p.comboId === null && p.courseId !== null)
      .map((p) => classKey(p.studentId, p.courseId!, p.billingYear!, p.billingMonth!)),
  );
  const haveAdmission = new Set(
    existingPayments.filter((p) => p.kind === "ADMISSION").map((p) => p.studentId),
  );
  const haveSmartCard = new Set(
    existingPayments.filter((p) => p.kind === "SMART_CARD").map((p) => p.studentId),
  );
  const haveComboRows = existingPayments.some((p) => p.comboId !== null);
  const haveCancelled = existingPayments.some((p) => p.cancelled);

  const tierOf = new Map<string, number>();
  for (const s of studentDefs) {
    for (const [key, tier] of s.enrol) {
      tierOf.set(`${s.n}:${key}`, Number(tier.multiplier));
    }
  }

  type CreateManyArgs = NonNullable<Parameters<typeof db.payment.createMany>[0]>;
  type NewPayment = Extract<CreateManyArgs["data"], unknown[]>[number];
  const payments: NewPayment[] = [];

  // --- admission: spread across the last two months, not all on one day ---
  for (const s of studentDefs.filter((x) => x.admissionPaid)) {
    if (haveAdmission.has(student[s.n])) continue;
    payments.push({
      kind: "ADMISSION",
      studentId: student[s.n],
      amount: money(admissionFee),
      takenById: actor.id,
      paidAt: daysAgo(s.n <= 15 ? 45 : 3 + Math.floor(rand(`adm-${s.n}`) * 57)),
    });
  }

  // --- smart cards: the original three, plus a slice of the new intake -----
  const smartCardPlan: { n: number; uid: string; back: number }[] = [
    { n: 1, uid: "0A100001", back: 45 },
    { n: 1, uid: "0A1000F1", back: 10 },   // the lost-card reissue case
    { n: 6, uid: "0A100006", back: 44 },
  ];
  for (const s of studentDefs.filter((x) => x.n > 15)) {
    if (rand(`card-${s.n}`) < 0.35) {
      smartCardPlan.push({ n: s.n, uid: s.uid!, back: 2 + Math.floor(rand(`card-day-${s.n}`) * 58) });
    }
  }
  for (const c of smartCardPlan) {
    // Student 1 legitimately has two (lost card), so only the volume students
    // are deduped by "already has one".
    if (c.n > 15 && haveSmartCard.has(student[c.n])) continue;
    if (c.n <= 15 && haveSmartCard.has(student[c.n])) continue;
    payments.push({
      kind: "SMART_CARD",
      studentId: student[c.n],
      amount: money(smartCardFee),
      cardUidIssued: c.uid,
      takenById: actor.id,
      paidAt: daysAgo(c.back),
    });
  }

  // --- monthly class fees, at each student's tier -------------------------
  // paidAt is scattered through each billing month rather than parked on the
  // 5th, so Daily Summary has something on most days of a 30-day range.
  const monthsBack = [2, 1, 0];
  for (const s of studentDefs) {
    for (const [key, tier] of s.enrol) {
      for (const back of monthsBack) {
        // Leave the current month unpaid for some students, so paid/unpaid and
        // "owing" views have something to show.
        if (back === 0 && s.n % 3 === 0) continue;

        const anchor = new Date();
        anchor.setUTCMonth(anchor.getUTCMonth() - back, 5);
        const [y, m] = colomboNow(anchor).date.split("-").map(Number);
        if (haveClass.has(classKey(student[s.n], course[key].id, y, m))) continue;

        // The current month can't have been paid in the future.
        const lastDay = back === 0 ? Number(now.date.slice(8, 10)) : 28;
        const day = 1 + Math.floor(rand(`pay-${s.n}-${key}-${back}`) * lastDay);
        const paidOn = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

        payments.push({
          kind: "CLASS",
          studentId: student[s.n],
          courseId: course[key].id,
          feeTierId: tier.id,
          billingYear: y,
          billingMonth: m,
          amount: money(course[key].fee * (tierOf.get(`${s.n}:${key}`) ?? 1)),
          // Frozen at payment time, exactly as the counter does it.
          instituteSharePercentApplied: course[key].share,
          takenById: actor.id,
          paidAt: colomboDateValue(paidOn),
        });
      }
    }
  }

  // One transactionRef per (student, instant) — the same grouping the counter
  // produces and the backfill reconstructs, so demo receipts reprint as whole
  // documents instead of single lines.
  const refByGroup = new Map<string, string>();
  for (const row of payments) {
    const key = `${row.studentId}|${(row.paidAt as Date).toISOString()}`;
    let ref = refByGroup.get(key);
    if (!ref) {
      ref = randomUUID();
      refByGroup.set(key, ref);
    }
    row.transactionRef = ref;
  }

  if (payments.length > 0) await db.payment.createMany({ data: payments });

  const comboTP = combo[`${DEMO}Chemistry Theory+Paper`];
  const lastMonth = new Date();
  lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1, 12);
  const lm = colomboNow(lastMonth);
  const [ly, lmn] = lm.date.split("-").map(Number);

  if (!haveComboRows) {
    // Both rows of a combo are one receipt — the case reprint has to get right.
    const comboAppliedRef = randomUUID();
    const comboRefusedRef = randomUUID();

    // Combo APPLIED — student 1, Chemistry Theory+Paper at the combo rate.
    for (const key of ["chemT", "chemP"]) {
      await db.payment.create({
        data: {
          kind: "CLASS",
          studentId: student[1],
          courseId: course[key].id,
          feeTierId: full.id,
          billingYear: ly,
          billingMonth: lmn,
          amount: money(2000),
          instituteSharePercentApplied: course[key].share,
          transactionRef: comboAppliedRef,
          comboId: comboTP,
          comboApplied: true,
          takenById: actor.id,
          paidAt: colomboDateValue(lm.date),
        },
      });
    }

    // Combo REFUSED — student 2 qualifies but barely attended Paper, so staff
    // declined the combo and charged the normal fee. Reason is required.
    for (const key of ["chemT", "chemP"]) {
      await db.payment.create({
        data: {
          kind: "CLASS",
          studentId: student[2],
          courseId: course[key].id,
          feeTierId: full.id,
          billingYear: ly,
          billingMonth: lmn,
          amount: money(course[key].fee),
          instituteSharePercentApplied: course[key].share,
          transactionRef: comboRefusedRef,
          comboId: comboTP,
          comboApplied: false,
          comboRefusedReason: "Did not attend Paper class regularly last month.",
          takenById: actor.id,
          paidAt: colomboDateValue(lm.date),
        },
      });
    }
  }

  if (!haveCancelled) {
    // A cancelled payment — must be excluded from every total.
    const toCancel = await db.payment.create({
      data: {
        kind: "CLASS",
        studentId: student[8],
        courseId: course.phyT.id,
        feeTierId: full.id,
        billingYear: ly,
        billingMonth: lmn,
        amount: money(course.phyT.fee),
        instituteSharePercentApplied: course.phyT.share,
        transactionRef: randomUUID(),
        takenById: actor.id,
        paidAt: colomboDateValue(lm.date),
      },
    });
    await db.payment.update({
      where: { id: toCancel.id },
      data: {
        cancelled: true,
        cancelledById: actor.id,
        cancelledAt: new Date(),
        cancelReason: "Duplicate entry — collected twice at the counter.",
      },
    });
  }

  // --- expenses -----------------------------------------------------------
  if ((await db.expense.count({ where: { reason: { startsWith: DEMO } } })) === 0) {
    await db.expense.create({
      data: {
        expenseTypeId: teacherAdvance.id,
        amount: money(15000),
        reason: `${DEMO}Advance against this month's salary`,
        date: daysAgo(6),
        teacherId: teacher[CHEM],
        recordedById: actor.id,
      },
    });
    await db.expense.create({
      data: {
        expenseTypeId: xenonExpense.id,
        amount: money(4500),
        reason: `${DEMO}Printer toner and A4 paper`,
        date: daysAgo(4),
        recordedById: actor.id,
      },
    });
    // A staff advance lives INSIDE Xenon expenses, flagged — counted once.
    await db.expense.create({
      data: {
        expenseTypeId: xenonExpense.id,
        amount: money(8000),
        reason: `${DEMO}Staff advance — Ms. K. Dias`,
        date: daysAgo(2),
        isStaffAdvance: true,
        staffId: staff["Ms. K. Dias"],
        recordedById: actor.id,
      },
    });
  }

  // --- report -------------------------------------------------------------
  const openNow = studentDefs[0];
  const counts = {
    subjects: await db.subject.count(),
    grades: await db.grade.count(),
    teachers: await db.teacher.count(),
    staff: await db.staff.count(),
    courses: await db.course.count(),
    combos: await db.combo.count(),
    students: await db.student.count(),
    enrollments: await db.enrollment.count(),
    schedules: await db.schedule.count(),
    additionalClasses: await db.additionalClass.count(),
    attendance: await db.attendance.count(),
    payments: await db.payment.count(),
    expenses: await db.expense.count(),
  };

  // Today's marks, per course — the number the Daily Attendance screen shows.
  const todayMarks = await db.attendance.findMany({
    where: { date: colomboDateValue(now.date), course: { name: { startsWith: DEMO } } },
    select: { courseId: true },
  });
  const perCourseToday = new Map<number, number>();
  for (const a of todayMarks) perCourseToday.set(a.courseId, (perCourseToday.get(a.courseId) ?? 0) + 1);
  const namesById = new Map(
    (await db.course.findMany({
      where: { id: { in: [...perCourseToday.keys()] } },
      select: { id: true, name: true },
    })).map((c) => [c.id, c.name]),
  );

  console.log("\nDemo data seeded:", counts);
  console.log(`\nColombo now: ${now.date} ${now.time} ${now.dayOfWeek}`);
  console.log(`Attendance marked TODAY (${now.date}): ${todayMarks.length} across ${perCourseToday.size} classes`);
  for (const [id, n] of [...perCourseToday].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(3)}  ${namesById.get(id)}`);
  }
  console.log("OPEN NOW — mark this student on /attendance immediately:");
  console.log(`  ${openNow.name}  card ${openNow.number}  uid ${openNow.uid}`);
  console.log(`  regular class : ${DEMO}A/L 2027 Chemistry Theory`);
  console.log(`  regular auto-mark works for the student above.`);
  console.log("CONFIRM PATH — additional class open now:");
  console.log(`  Dilshan Peiris  card ${S(6)}  uid 0A100006`);
  console.log(`  additional    : ${DEMO}A/L 2027 ICT Paper`);
  console.log("\nLogins: NONE are seeded. Teachers and staff exist as entities only.");
  console.log("Create a teacher login through Setup → Teachers with your own password.");
  console.log(
    "\n⚠  This is DEMO data on a publicly-reachable database.\n" +
      "   Run `npx tsx prisma/seed-demo.ts --wipe` before go-live,\n" +
      "   and rotate the admin password (ADMIN_PASSWORD in .env).",
  );
}

async function main() {
  if (process.argv.includes("--wipe")) await wipe();
  else await seed();
}

main().finally(() => db.$disconnect());
