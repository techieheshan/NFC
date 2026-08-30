-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "transactionRef" TEXT;

-- CreateIndex
CREATE INDEX "Payment_transactionRef_idx" ON "Payment"("transactionRef");

