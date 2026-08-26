-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "clientRef" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "cardNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_clientRef_key" ON "Attendance"("clientRef");

-- CreateIndex
CREATE UNIQUE INDEX "Student_cardNumber_key" ON "Student"("cardNumber");

