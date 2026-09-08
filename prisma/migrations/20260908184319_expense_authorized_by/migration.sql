-- Every expense records who AUTHORISED it, not just who typed it in.
--
-- Added in three steps because the column is required and the table already has
-- rows: add it nullable, backfill each existing row with its `recordedById`
-- (the best available answer — the person who entered it is the only person the
-- old rows name), then enforce NOT NULL. No row is left null, and nothing has
-- to guess at an authoriser it never recorded.
ALTER TABLE "Expense" ADD COLUMN "authorizedById" TEXT;

UPDATE "Expense" SET "authorizedById" = "recordedById" WHERE "authorizedById" IS NULL;

ALTER TABLE "Expense" ALTER COLUMN "authorizedById" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_authorizedById_fkey" FOREIGN KEY ("authorizedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
