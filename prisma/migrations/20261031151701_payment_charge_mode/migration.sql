-- CreateEnum
CREATE TYPE "ChargeMode" AS ENUM ('HALF', 'NO_CHARGE');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "chargeMode" "ChargeMode";
