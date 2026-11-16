-- Other incomes (money in with no bill) and Extra payments (a bill for things that are not class fees).
-- Additive only: one enum, five new tables, their indexes and foreign keys.
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

-- CreateTable
CREATE TABLE "ExtraItem" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "defaultPrice" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtraItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtraPayment" (
    "id" SERIAL NOT NULL,
    "clientRef" TEXT NOT NULL,
    "studentId" INTEGER,
    "courseId" INTEGER,
    "note" TEXT,
    "total" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takenById" TEXT NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtraPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtraPaymentLine" (
    "id" SERIAL NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "itemId" INTEGER,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "custom" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ExtraPaymentLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncomeCategory_code_key" ON "IncomeCategory"("code");

-- CreateIndex
CREATE INDEX "OtherIncome_date_idx" ON "OtherIncome"("date");

-- CreateIndex
CREATE INDEX "OtherIncome_categoryId_idx" ON "OtherIncome"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtraPayment_clientRef_key" ON "ExtraPayment"("clientRef");

-- CreateIndex
CREATE INDEX "ExtraPayment_paidAt_idx" ON "ExtraPayment"("paidAt");

-- CreateIndex
CREATE INDEX "ExtraPayment_studentId_idx" ON "ExtraPayment"("studentId");

-- CreateIndex
CREATE INDEX "ExtraPaymentLine_paymentId_idx" ON "ExtraPaymentLine"("paymentId");

-- AddForeignKey
ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "IncomeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherIncome" ADD CONSTRAINT "OtherIncome_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraPayment" ADD CONSTRAINT "ExtraPayment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraPayment" ADD CONSTRAINT "ExtraPayment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraPayment" ADD CONSTRAINT "ExtraPayment_takenById_fkey" FOREIGN KEY ("takenById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraPayment" ADD CONSTRAINT "ExtraPayment_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraPaymentLine" ADD CONSTRAINT "ExtraPaymentLine_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "ExtraPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraPaymentLine" ADD CONSTRAINT "ExtraPaymentLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ExtraItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Starter categories: DATA, editable on a screen and soft-deleted, never listed in code.
INSERT INTO "IncomeCategory" ("code", "label", "updatedAt") VALUES
  ('DONATION', 'Donation', CURRENT_TIMESTAMP),
  ('SPONSORSHIP', 'Sponsorship', CURRENT_TIMESTAMP),
  ('RENT', 'Rent received', CURRENT_TIMESTAMP),
  ('EQUIPMENT_SALE', 'Equipment sale', CURRENT_TIMESTAMP),
  ('SUPPLIER_REFUND', 'Supplier refund', CURRENT_TIMESTAMP),
  ('OTHER', 'Other', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
