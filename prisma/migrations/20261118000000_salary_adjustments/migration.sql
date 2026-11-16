-- Salary adjustments: share an expense with named teachers and/or staff, or pay them part of an income as a bonus.
-- Additive only: two enums, two new tables, their indexes, foreign keys and CHECK constraints. Nothing here changes a table that exists
-- today (the foreign keys to "Expense", "OtherIncome", "Teacher", "Staff" and "User" only take a brief lock on them).
-- Wait at most 3 seconds for a lock; if it is not free the statement fails and nothing is applied.
SET lock_timeout = '3s';

-- CreateEnum
CREATE TYPE "SalaryAdjustmentKind" AS ENUM ('SHARED_EXPENSE', 'BONUS');

-- CreateEnum
CREATE TYPE "SplitMode" AS ENUM ('EQUAL', 'CUSTOM');

-- CreateTable
CREATE TABLE "SalaryAdjustment" (
    "id" SERIAL NOT NULL,
    "kind" "SalaryAdjustmentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "applyYear" INTEGER NOT NULL,
    "applyMonth" INTEGER NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "instituteAmount" DECIMAL(12,2) NOT NULL,
    "splitMode" "SplitMode" NOT NULL,
    "expenseId" INTEGER,
    "otherIncomeId" INTEGER,
    "consentNote" TEXT NOT NULL,
    "consentOn" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "SalaryAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryAdjustmentLine" (
    "id" SERIAL NOT NULL,
    "adjustmentId" INTEGER NOT NULL,
    "teacherId" INTEGER,
    "staffId" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "SalaryAdjustmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalaryAdjustment_applyYear_applyMonth_idx" ON "SalaryAdjustment"("applyYear", "applyMonth");

-- CreateIndex
CREATE INDEX "SalaryAdjustment_expenseId_idx" ON "SalaryAdjustment"("expenseId");

-- CreateIndex
CREATE INDEX "SalaryAdjustment_otherIncomeId_idx" ON "SalaryAdjustment"("otherIncomeId");

-- CreateIndex
CREATE INDEX "SalaryAdjustmentLine_teacherId_idx" ON "SalaryAdjustmentLine"("teacherId");

-- CreateIndex
CREATE INDEX "SalaryAdjustmentLine_staffId_idx" ON "SalaryAdjustmentLine"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryAdjustmentLine_adjustmentId_teacherId_key" ON "SalaryAdjustmentLine"("adjustmentId", "teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryAdjustmentLine_adjustmentId_staffId_key" ON "SalaryAdjustmentLine"("adjustmentId", "staffId");

-- AddForeignKey
ALTER TABLE "SalaryAdjustment" ADD CONSTRAINT "SalaryAdjustment_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdjustment" ADD CONSTRAINT "SalaryAdjustment_otherIncomeId_fkey" FOREIGN KEY ("otherIncomeId") REFERENCES "OtherIncome"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdjustment" ADD CONSTRAINT "SalaryAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdjustment" ADD CONSTRAINT "SalaryAdjustment_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdjustmentLine" ADD CONSTRAINT "SalaryAdjustmentLine_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "SalaryAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdjustmentLine" ADD CONSTRAINT "SalaryAdjustmentLine_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdjustmentLine" ADD CONSTRAINT "SalaryAdjustmentLine_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The rules the application also enforces, kept in the database as a second line of defence.
ALTER TABLE "SalaryAdjustment" ADD CONSTRAINT "SalaryAdjustment_month_check" CHECK ("applyMonth" BETWEEN 1 AND 12 AND "applyYear" BETWEEN 2000 AND 2100);
ALTER TABLE "SalaryAdjustment" ADD CONSTRAINT "SalaryAdjustment_amounts_check" CHECK ("totalAmount" > 0 AND "instituteAmount" >= 0 AND "instituteAmount" <= "totalAmount");
ALTER TABLE "SalaryAdjustment" ADD CONSTRAINT "SalaryAdjustment_source_check" CHECK (
  ("kind" = 'SHARED_EXPENSE' AND "expenseId" IS NOT NULL AND "otherIncomeId" IS NULL)
  OR ("kind" = 'BONUS' AND "otherIncomeId" IS NOT NULL AND "expenseId" IS NULL)
);
ALTER TABLE "SalaryAdjustmentLine" ADD CONSTRAINT "SalaryAdjustmentLine_person_check" CHECK (("teacherId" IS NULL) <> ("staffId" IS NULL));
ALTER TABLE "SalaryAdjustmentLine" ADD CONSTRAINT "SalaryAdjustmentLine_amount_check" CHECK ("amount" > 0);
