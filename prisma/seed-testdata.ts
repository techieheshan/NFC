// prisma/seed-testdata.ts
// -----------------------------------------------------------------------------
// REALISTIC TEST DATA for clicking around the app (dev only).
// Fills: Subjects, Grades, Teachers, Courses, and a few Students
// with enrollments + typeable card UIDs (use these in the manual UID field).
//
// Run:  npx tsx prisma/seed-testdata.ts
// Wipe: npx tsx prisma/seed-testdata.ts --wipe   (removes ONLY this test data)
//
// This does NOT touch the base reference seed (ClassTypes/FeeTiers/etc.).
// It is idempotent — safe to run multiple times.
// -----------------------------------------------------------------------------

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 has no `url` in the datasource block, so the client is constructed
// with a driver adapter (same pattern as prisma/seed.ts and src/lib/db.ts).
// CLI scripts use the direct, non-pooled endpoint.
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Neither DIRECT_URL nor DATABASE_URL is set (check .env).");
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// Card UIDs you can type into the manual "enter UID" field on /registration.
// Format is bare uppercase hex (the app normalises, so 04a22b9c5d works too).
const STUDENTS = [
  { name: "Nimal Perera",     phone: "0771234567", school: "Kalutara Vidyalaya",  cardUid: "04A11B22C3", nic: "200145600123" },
  { name: "Saduni Fernando",  phone: "0762345678", school: "Holy Cross College",  cardUid: "04B22C33D4", nic: "200256700234" },
  { name: "Kasun Silva",      phone: "0753456789", school: "Tissa Central",       cardUid: "04C33D44E5", nic: "200367800345" },
  { name: "Ishara Jayasuriya",phone: "0714567890", school: "Kalutara Vidyalaya",  cardUid: "04D44E55F6", nic: "200478900456" },
  { name: "Ravindu Bandara",  phone: "0785678901", school: "St. John's College",  cardUid: "04E55F6607", nic: "200589000567" },
];

async function wipe() {
  // Delete in FK-safe order; only the test rows this script creates.
  const testCardUids = STUDENTS.map((s) => s.cardUid);
  const students = await db.student.findMany({ where: { cardUid: { in: testCardUids } }, select: { id: true } });
  const ids = students.map((s) => s.id);
  await db.enrollment.deleteMany({ where: { studentId: { in: ids } } });
  await db.student.deleteMany({ where: { id: { in: ids } } });

  await db.course.deleteMany({ where: { name: { startsWith: "[TEST] " } } });
  const teacherNames = ["Mr. A. Gunawardena", "Ms. R. Wickramasinghe", "Mr. S. Rathnayake"];
  // Teacher has no `userId` column — the relation runs the other way
  // (User.teacherId), which is how the logins are deleted just below.
  const teachers = await db.teacher.findMany({ where: { name: { in: teacherNames } }, select: { id: true } });
  // This seed no longer creates logins, but an earlier version did — clear any
  // it left behind so a wipe fully undoes that too.
  const tIds = teachers.map((t) => t.id);
  await db.user.deleteMany({ where: { teacherId: { in: tIds } } });
  await db.teacher.deleteMany({ where: { id: { in: tIds } } });

  await db.subject.deleteMany({ where: { label: { in: ["ICT", "Chemistry", "Physics", "Combined Maths"] } } });
  await db.grade.deleteMany({ where: { label: { in: ["A/L 2027", "A/L 2026", "Grade 11"] } } });
  console.log("Test data wiped.");
}

async function seed() {
  // --- Subjects ---
  const subjectLabels = ["ICT", "Chemistry", "Physics", "Combined Maths"];
  const subjects: Record<string, number> = {};
  for (const label of subjectLabels) {
    const s = await db.subject.upsert({ where: { label }, update: {}, create: { label } });
    subjects[label] = s.id;
  }

  // --- Grades ---
  const gradeLabels = ["A/L 2027", "A/L 2026", "Grade 11"];
  const grades: Record<string, number> = {};
  for (const label of gradeLabels) {
    const g = await db.grade.upsert({ where: { label }, update: {}, create: { label } });
    grades[label] = g.id;
  }

  // --- Reference lookups (already seeded by the base seed) ---
  const streamAL = await db.stream.findFirstOrThrow({ where: { label: "A/L" } });
  const ctTheory = await db.classType.findUniqueOrThrow({ where: { code: "THEORY" } });
  const ctPaper = await db.classType.findUniqueOrThrow({ where: { code: "PAPER" } });
  const ctRevision = await db.classType.findUniqueOrThrow({ where: { code: "REVISION" } });
  const tierFull = await db.feeTier.findUniqueOrThrow({ where: { code: "FULL" } });
  const tierHalf = await db.feeTier.findUniqueOrThrow({ where: { code: "HALF" } });

  // --- Teachers ---
  // Entities only — this seed creates NO logins.
  // A committed seed cannot hold a password without publishing it, and this
  // repo is public. Real teacher logins are created through Setup → Teachers,
  // which hashes a password the operator chooses.
  const teacherDefs = [
    { name: "Mr. A. Gunawardena", nic: "197812300456", phone: "0771111111" },
    { name: "Ms. R. Wickramasinghe", nic: "198534500678", phone: "0772222222" },
    { name: "Mr. S. Rathnayake", nic: "198045600789", phone: "0773333333" },
  ];
  const teachers: Record<string, number> = {};
  for (const t of teacherDefs) {
    let teacher = await db.teacher.findFirst({ where: { name: t.name } });
    if (!teacher) {
      teacher = await db.teacher.create({
        data: { name: t.name, nic: t.nic, phone: t.phone, joinDate: new Date("2024-01-15") },
      });
    }
    teachers[t.name] = teacher.id;
  }

  // --- Courses ([TEST] prefix so wipe can find them) ---
  const courseDefs = [
    { name: "[TEST] A/L 2027 ICT Theory (Gunawardena)",   teacher: "Mr. A. Gunawardena",     subject: "ICT",           grade: "A/L 2027", classType: ctTheory.id,   fee: "2500", share: "25" },
    { name: "[TEST] A/L 2027 ICT Paper (Gunawardena)",    teacher: "Mr. A. Gunawardena",     subject: "ICT",           grade: "A/L 2027", classType: ctPaper.id,    fee: "2500", share: "25" },
    { name: "[TEST] A/L 2027 Chemistry Theory (Wickrama)",teacher: "Ms. R. Wickramasinghe",  subject: "Chemistry",     grade: "A/L 2027", classType: ctTheory.id,   fee: "3000", share: "20" },
    { name: "[TEST] A/L 2027 Chemistry Revision (Wickrama)",teacher: "Ms. R. Wickramasinghe",subject: "Chemistry",     grade: "A/L 2027", classType: ctRevision.id, fee: "2000", share: "30" },
    { name: "[TEST] A/L 2026 Physics Theory (Rathnayake)",teacher: "Mr. S. Rathnayake",      subject: "Physics",       grade: "A/L 2026", classType: ctTheory.id,   fee: "2800", share: "25" },
    { name: "[TEST] A/L 2027 Combined Maths Theory (Rathnayake)", teacher: "Mr. S. Rathnayake", subject: "Combined Maths", grade: "A/L 2027", classType: ctTheory.id, fee: "3000", share: "27.5" },
  ];
  const courses: number[] = [];
  for (const c of courseDefs) {
    let course = await db.course.findFirst({ where: { name: c.name } });
    if (!course) {
      course = await db.course.create({
        data: {
          name: c.name,
          teacherId: teachers[c.teacher],
          subjectId: subjects[c.subject],
          gradeId: grades[c.grade],
          streamId: streamAL.id,
          classTypeId: c.classType,
          defaultFee: c.fee,
          instituteSharePercent: c.share,
        },
      });
    }
    courses.push(course.id);
  }

  // --- Students (+ enrollments). No photos (add those by hand to test camera). ---
  for (let i = 0; i < STUDENTS.length; i++) {
    const s = STUDENTS[i];
    let student = await db.student.findUnique({ where: { cardUid: s.cardUid } });
    if (!student) {
      student = await db.student.create({
        data: {
          name: s.name, phone: s.phone, school: s.school, nic: s.nic,
          cardUid: s.cardUid, admissionPaid: false,
        },
      });
      // enroll each student in 1-3 courses, mixed tiers
      const pick = [courses[i % courses.length], courses[(i + 1) % courses.length]];
      await db.enrollment.create({ data: { studentId: student.id, courseId: pick[0], feeTierId: tierFull.id, status: "ACTIVE" } });
      if (i % 2 === 0)
        await db.enrollment.create({ data: { studentId: student.id, courseId: pick[1], feeTierId: tierHalf.id, status: "ACTIVE" } });
    }
  }

  const counts = {
    subjects: await db.subject.count(),
    grades: await db.grade.count(),
    teachers: await db.teacher.count(),
    courses: await db.course.count(),
    students: await db.student.count(),
    enrollments: await db.enrollment.count(),
  };
  console.log("Test data seeded:", counts);
  console.log("\nType these UIDs into the manual field on /registration:");
  for (const s of STUDENTS) console.log(`  ${s.cardUid}  -> ${s.name}`);
  console.log(
    "\nTeachers are entities only — no logins are seeded. Create one through" +
      "\nSetup → Teachers to get a teacher login with a password you choose.",
  );
}

async function main() {
  if (process.argv.includes("--wipe")) await wipe();
  else await seed();
}

main().finally(() => db.$disconnect());
