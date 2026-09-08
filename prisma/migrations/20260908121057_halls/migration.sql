-- AlterTable
ALTER TABLE "AdditionalClass" ADD COLUMN     "hallId" INTEGER;

-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "defaultHallId" INTEGER;

-- CreateTable
CREATE TABLE "Hall" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HallAllocationOverride" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "scheduleId" INTEGER,
    "additionalClassId" INTEGER,
    "hallId" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HallAllocationOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Hall_name_key" ON "Hall"("name");

-- CreateIndex
CREATE INDEX "HallAllocationOverride_date_idx" ON "HallAllocationOverride"("date");

-- CreateIndex
CREATE UNIQUE INDEX "HallAllocationOverride_date_scheduleId_key" ON "HallAllocationOverride"("date", "scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "HallAllocationOverride_date_additionalClassId_key" ON "HallAllocationOverride"("date", "additionalClassId");

-- AddForeignKey
ALTER TABLE "HallAllocationOverride" ADD CONSTRAINT "HallAllocationOverride_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HallAllocationOverride" ADD CONSTRAINT "HallAllocationOverride_additionalClassId_fkey" FOREIGN KEY ("additionalClassId") REFERENCES "AdditionalClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HallAllocationOverride" ADD CONSTRAINT "HallAllocationOverride_hallId_fkey" FOREIGN KEY ("hallId") REFERENCES "Hall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HallAllocationOverride" ADD CONSTRAINT "HallAllocationOverride_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_defaultHallId_fkey" FOREIGN KEY ("defaultHallId") REFERENCES "Hall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdditionalClass" ADD CONSTRAINT "AdditionalClass_hallId_fkey" FOREIGN KEY ("hallId") REFERENCES "Hall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

