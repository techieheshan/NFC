-- Wait at most 3 seconds for a lock on any table this migration touches (the foreign keys to "User" take a brief SHARE ROW EXCLUSIVE lock);
-- if the lock is not free, the statement fails instead of queueing logins behind it, and nothing is applied.
SET lock_timeout = '3s';

-- CreateEnum
CREATE TYPE "DailySummarySaveKind" AS ENUM ('SAVE', 'EDIT', 'RESAVE_LIVE');

-- CreateTable
CREATE TABLE "DailySummaryDay" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "currentVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailySummaryDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySummaryVersion" (
    "id" SERIAL NOT NULL,
    "dayId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "DailySummarySaveKind" NOT NULL,
    "bringForward" DECIMAL(12,2) NOT NULL,
    "collected" DECIMAL(12,2) NOT NULL,
    "deductions" DECIMAL(12,2) NOT NULL,
    "shouldBeInDrawer" DECIMAL(12,2) NOT NULL,
    "bankTotal" DECIMAL(12,2) NOT NULL,
    "leftInDrawer" DECIMAL(12,2) NOT NULL,
    "net" DECIMAL(12,2) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshotSchema" INTEGER NOT NULL DEFAULT 1,
    "changes" JSONB NOT NULL,
    "doneById" TEXT NOT NULL,
    "doneByName" TEXT NOT NULL,
    "preparedById" TEXT NOT NULL,
    "preparedByName" TEXT NOT NULL,
    "savedById" TEXT NOT NULL,
    "savedByName" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailySummaryVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySummaryBankLine" (
    "id" SERIAL NOT NULL,
    "versionId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "time" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "slip" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "recordedByName" TEXT NOT NULL,

    CONSTRAINT "DailySummaryBankLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySummaryCheck" (
    "id" SERIAL NOT NULL,
    "versionId" INTEGER NOT NULL,
    "checkedById" TEXT NOT NULL,
    "checkedByName" TEXT NOT NULL,
    "markedById" TEXT NOT NULL,
    "markedByName" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "carriedFromVersion" INTEGER,

    CONSTRAINT "DailySummaryCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailySummaryDay_date_key" ON "DailySummaryDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailySummaryVersion_dayId_version_key" ON "DailySummaryVersion"("dayId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DailySummaryBankLine_versionId_position_key" ON "DailySummaryBankLine"("versionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "DailySummaryCheck_versionId_key" ON "DailySummaryCheck"("versionId");

-- AddForeignKey
ALTER TABLE "DailySummaryVersion" ADD CONSTRAINT "DailySummaryVersion_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "DailySummaryDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySummaryVersion" ADD CONSTRAINT "DailySummaryVersion_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySummaryVersion" ADD CONSTRAINT "DailySummaryVersion_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySummaryVersion" ADD CONSTRAINT "DailySummaryVersion_savedById_fkey" FOREIGN KEY ("savedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySummaryBankLine" ADD CONSTRAINT "DailySummaryBankLine_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DailySummaryVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySummaryBankLine" ADD CONSTRAINT "DailySummaryBankLine_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySummaryCheck" ADD CONSTRAINT "DailySummaryCheck_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DailySummaryVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySummaryCheck" ADD CONSTRAINT "DailySummaryCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySummaryCheck" ADD CONSTRAINT "DailySummaryCheck_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

