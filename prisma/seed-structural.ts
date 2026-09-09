import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Go-live structural seed: the rows the APP LOGIC cannot run without, and
 * nothing else.
 *
 * Deliberately NOT here: subjects, grades, teachers, courses, students,
 * payments, attendance — the institute creates its own through the UI — and the
 * bootstrap admin, which is its own step with its own password handling.
 *
 * Everything is an upsert keyed on the natural unique column, so running this
 * against a database that already has some of it is safe and changes nothing
 * that staff have since edited (`update: {}`).
 */
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Neither DIRECT_URL nor DATABASE_URL is set");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  // --- ClassType: what kind of class a course is.
  const classTypes = [
    { code: "THEORY", label: "Theory" },
    { code: "PAPER", label: "Paper" },
    { code: "REVISION", label: "Revision" },
  ];
  for (const c of classTypes)
    await db.classType.upsert({ where: { code: c.code }, update: {}, create: c });

  // --- FeeTier: the multiplier is what turns a tier into money, and FREE's
  // zero is what the arrears colour and the not-paid report read to know a
  // student owes nothing.
  const feeTiers = [
    { code: "FULL", label: "Full", multiplier: "1.000" },
    { code: "HALF", label: "Half", multiplier: "0.500" },
    { code: "QUARTER", label: "25%", multiplier: "0.250" },
    { code: "FREE", label: "Free", multiplier: "0.000" },
  ];
  for (const t of feeTiers)
    await db.feeTier.upsert({ where: { code: t.code }, update: {}, create: t });

  // --- ExpenseType: `affectsTeacherPayslip` is what routes an advance to the
  // right side of payroll.
  const expenseTypes = [
    { code: "TEACHER_ADVANCE", label: "Teacher Advance", affectsTeacherPayslip: true },
    { code: "XENON", label: "Xenon Expense", affectsTeacherPayslip: false },
  ];
  for (const e of expenseTypes)
    await db.expenseType.upsert({ where: { code: e.code }, update: {}, create: e });

  // --- Stream: Course.streamId is REQUIRED, so without at least one of these
  // staff cannot create their first course. Editable starter set.
  const streams = [
    "Science", "Maths", "Tech", "Commerce", "Art",
    "Grade 6-11", "Primary", "A/L", "Other",
  ];
  for (const label of streams)
    await db.stream.upsert({ where: { label }, update: {}, create: { label } });

  // --- Settings: the money globals and toggles, at the institute's real
  // values. Every one of these is editable at /settings; seeding them only
  // means the first transaction has a number to read instead of a fallback.
  const settings = [
    { key: "admission_fee", value: "1300", label: "Admission fee (one-time)" },
    { key: "smart_card_fee", value: "500", label: "Smart card fee (per issuance)" },
    { key: "default_institute_fee", value: "0", label: "Default institute fee" },
    { key: "institute_share_presets", value: "20,25,30", label: "Institute share % presets" },
    { key: "voice_confirmations", value: "on", label: "Voice confirmations" },
    { key: "roster_show_phone", value: "on", label: "Show phone numbers on My Students" },
  ];
  for (const s of settings)
    await db.setting.upsert({ where: { key: s.key }, update: {}, create: s });

  // --- Halls: real institute configuration, with the icon key each is drawn
  // with. Renameable and deactivatable at /admin/halls like any reference row.
  const halls = [
    { name: "Rhythm Devin", icon: "music" },
    { name: "Forget Me Not", icon: "flower-2" },
    { name: "Avocado", icon: "salad" },
    { name: "Lumos", icon: "lightbulb" },
    { name: "Daffodil", icon: "flower" },
    { name: "Moonlight", icon: "moon" },
    { name: "Sunset", icon: "sunset" },
    { name: "Blue Sky", icon: "cloud" },
    { name: "Picasso", icon: "palette" },
    { name: "Rest Area", icon: "armchair" },
    { name: "Tesla", icon: "zap" },
  ];
  for (const h of halls)
    await db.hall.upsert({ where: { name: h.name }, update: {}, create: h });

  console.log(
    `Structural seed complete: ${classTypes.length} class types, ${feeTiers.length} fee tiers, ` +
      `${expenseTypes.length} expense types, ${streams.length} streams, ${settings.length} settings, ` +
      `${halls.length} halls. No users, no subjects/grades/teachers/courses, no student data.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
