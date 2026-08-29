// prisma/backfill-institute-share.ts
// -----------------------------------------------------------------------------
// One-time backfill for Payment.instituteSharePercentApplied.
//
//   npx tsx prisma/backfill-institute-share.ts
//
// Idempotent: it only ever touches CLASS payments where the column is NULL, so
// re-running changes nothing. Rows written before this column existed take the
// course's CURRENT percent — the best available approximation of what was in
// force at the time. Everything paid from now on freezes its own.
// -----------------------------------------------------------------------------

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Neither DIRECT_URL nor DATABASE_URL is set.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const pending = await db.payment.findMany({
    where: { kind: "CLASS", instituteSharePercentApplied: null, courseId: { not: null } },
    select: { id: true, course: { select: { instituteSharePercent: true } } },
  });

  console.log(`CLASS payments needing a frozen percent: ${pending.length}`);

  let updated = 0;
  for (const p of pending) {
    if (!p.course) continue;
    await db.payment.update({
      where: { id: p.id },
      data: { instituteSharePercentApplied: p.course.instituteSharePercent },
    });
    updated++;
  }

  const remaining = await db.payment.count({
    where: { kind: "CLASS", instituteSharePercentApplied: null },
  });
  const nonClassSet = await db.payment.count({
    where: { kind: { not: "CLASS" }, instituteSharePercentApplied: { not: null } },
  });

  console.log(`BACKFILLED ${updated}`);
  console.log(`CLASS payments still null: ${remaining} (must be 0)`);
  console.log(`Non-CLASS payments wrongly set: ${nonClassSet} (must be 0)`);
}

main().finally(() => db.$disconnect());
