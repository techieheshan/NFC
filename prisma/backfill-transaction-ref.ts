// prisma/backfill-transaction-ref.ts
// -----------------------------------------------------------------------------
// One-time backfill for Payment.transactionRef.
//
//   npx tsx prisma/backfill-transaction-ref.ts
//
// Reconstructs receipts for rows written before the column existed. Everything
// one checkout wrote shares a student, a cashier and a paidAt — takePayment
// stamps a single `new Date()` across the whole transaction — so grouping on
// (studentId, takenById, paidAt truncated to the second) rebuilds the original
// documents. Rows that were alone in their second simply get a ref of their own.
//
// Idempotent: the statement only ever touches rows where transactionRef IS NULL,
// so a second run matches nothing and changes nothing.
//
// Done as one SQL statement rather than a read-then-update loop: the grouping is
// a GROUP BY, and 700 individual round trips to Neon would take a minute for
// work the database does in one pass.
// -----------------------------------------------------------------------------

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Neither DIRECT_URL nor DATABASE_URL is set.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const before = await db.payment.count({ where: { transactionRef: null } });
  console.log(`payments without a transactionRef: ${before}`);

  const updated = await db.$executeRaw`
    UPDATE "Payment" p
    SET "transactionRef" = g.ref
    FROM (
      SELECT "studentId",
             "takenById",
             date_trunc('second', "paidAt") AS sec,
             gen_random_uuid()::text        AS ref
      FROM "Payment"
      WHERE "transactionRef" IS NULL
      GROUP BY 1, 2, 3
    ) g
    WHERE p."transactionRef" IS NULL
      AND p."studentId" = g."studentId"
      AND p."takenById" = g."takenById"
      AND date_trunc('second', p."paidAt") = g.sec
  `;

  const remaining = await db.payment.count({ where: { transactionRef: null } });
  const groups = await db.payment.groupBy({
    by: ["transactionRef"],
    _count: { _all: true },
    where: { transactionRef: { not: null } },
  });
  const multi = groups.filter((g) => g._count._all > 1).length;

  console.log(`BACKFILLED ${updated}`);
  console.log(`still null: ${remaining} (must be 0)`);
  console.log(`transactions: ${groups.length} (${multi} covering more than one row)`);
}

main().finally(() => db.$disconnect());
