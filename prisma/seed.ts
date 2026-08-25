import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

// Seeding runs from the CLI, so it uses the direct (non-pooled) endpoint when
// available, exactly like migrations do.
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Neither DIRECT_URL nor DATABASE_URL is set");
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  // --- ClassType (code -> label) ---
  const classTypes = [
    { code: "THEORY", label: "Theory" },
    { code: "PAPER", label: "Paper" },
    { code: "REVISION", label: "Revision" },
  ];
  for (const c of classTypes)
    await db.classType.upsert({ where: { code: c.code }, update: {}, create: c });

  // --- FeeTier (multiplier is what turns a tier into money) ---
  const feeTiers = [
    { code: "FULL", label: "Full", multiplier: "1.000" },
    { code: "HALF", label: "Half", multiplier: "0.500" },
    { code: "QUARTER", label: "25%", multiplier: "0.250" },
    { code: "FREE", label: "Free", multiplier: "0.000" },
  ];
  for (const t of feeTiers)
    await db.feeTier.upsert({ where: { code: t.code }, update: {}, create: t });

  // --- ExpenseType (affectsTeacherPayslip routes advances correctly) ---
  const expenseTypes = [
    { code: "TEACHER_ADVANCE", label: "Teacher Advance", affectsTeacherPayslip: true },
    { code: "XENON", label: "Xenon Expense", affectsTeacherPayslip: false },
  ];
  for (const e of expenseTypes)
    await db.expenseType.upsert({ where: { code: e.code }, update: {}, create: e });

  // --- Settings (editable money globals — NOT hardcoded in app) ---
  const settings = [
    { key: "admission_fee", value: "1300", label: "Admission fee (one-time)" },
    { key: "smart_card_fee", value: "500", label: "Smart card fee (per issuance)" },
    { key: "default_institute_fee", value: "0", label: "Default institute fee" },
    { key: "institute_share_presets", value: "20,25,30", label: "Institute share % presets" },
  ];
  for (const s of settings)
    await db.setting.upsert({ where: { key: s.key }, update: {}, create: s });

  // --- Streams (editable; starter set) ---
  const streams = [
    "Science",
    "Maths",
    "Tech",
    "Commerce",
    "Art",
    "Grade 6-11",
    "Primary",
    "A/L",
    "Other",
  ];
  for (const label of streams)
    await db.stream.upsert({ where: { label }, update: {}, create: { label } });

  // --- One admin user (change the password!) ---
  // Subjects and Grades are intentionally NOT seeded — the institute adds its
  // real ones through the UI later.
  const adminPassword = process.env.ADMIN_PASSWORD ?? "change-me-now";
  await db.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash: await bcrypt.hash(adminPassword, 10),
      role: "ADMIN",
    },
  });

  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
