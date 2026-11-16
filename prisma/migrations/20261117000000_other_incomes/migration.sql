-- Other incomes: money that came in with no bill. Additive only: one enum, two new tables, their indexes and foreign keys.
-- Nothing here changes a table that exists today (the foreign keys to "User" only take a brief lock on it).
-- Wait at most 3 seconds for a lock; if it is not free the statement fails and nothing is applied.
SET lock_timeout = '3s';

-- CreateEnum
CREATE TYPE "IncomeMethod" AS ENUM ('CASH', 'BANK');

-- CreateTable
CREATE TABLE "IncomeCategory" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtherIncome" (
    "id" SERIAL NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "method" "IncomeMethod" NOT NULL DEFAULT 'CASH',
    "receivedById" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtherIncome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncomeCategory_code_key" ON "IncomeCategory"("code");

-- CreateIndex
CREATE INDEX "OtherIncome_date_idx" ON "OtherIncome"("date");

-- CreateIndex
CREATE INDEX "OtherIncome_categoryId_idx" ON "OtherIncome"("categoryId");

-- AddForeignKey
ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "IncomeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Starter categories: DATA, editable on a screen and soft-deleted, never listed in code.
INSERT INTO "IncomeCategory" ("code", "label", "updatedAt") VALUES
  ('DONATION', 'Donation', CURRENT_TIMESTAMP),
  ('SPONSORSHIP', 'Sponsorship', CURRENT_TIMESTAMP),
  ('RENT', 'Rent received', CURRENT_TIMESTAMP),
  ('EQUIPMENT_SALE', 'Equipment sale', CURRENT_TIMESTAMP),
  ('SUPPLIER_REFUND', 'Supplier refund', CURRENT_TIMESTAMP),
  ('OTHER', 'Other', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
