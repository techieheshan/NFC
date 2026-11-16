-- Staff quick login: staff cards and QR tokens, registered terminals, and the audit trail.
-- Additive only: three enums, three new tables, their indexes and foreign keys. Nothing here changes a table that exists today
-- (the foreign keys to "User" only take a brief lock on it). The feature is OFF until the Setting quick_login_enabled is switched on.
-- Wait at most 3 seconds for a lock; if it is not free the statement fails and nothing is applied.
SET lock_timeout = '3s';

-- CreateEnum
CREATE TYPE "StaffCredentialKind" AS ENUM ('NFC', 'QR');

-- CreateEnum
CREATE TYPE "QuickLoginOutcome" AS ENUM ('SUCCESS', 'UNKNOWN_CREDENTIAL', 'STUDENT_CARD_REFUSED', 'REVOKED', 'USER_INACTIVE', 'NOT_STAFF_ROLE', 'MUST_CHANGE_PASSWORD', 'PASSWORD_REQUIRED', 'NO_TERMINAL', 'RATE_LIMITED', 'DISABLED');

-- CreateEnum
CREATE TYPE "QuickLoginMethod" AS ENUM ('NFC', 'QR', 'PASSWORD');

-- CreateTable
CREATE TABLE "StaffCredential" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "StaffCredentialKind" NOT NULL,
    "nfcUid" TEXT,
    "qrTokenHash" TEXT,
    "label" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "StaffCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickLoginTerminal" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consecutiveQuick" INTEGER NOT NULL DEFAULT 0,
    "failedTaps" INTEGER NOT NULL DEFAULT 0,
    "failedWindowStart" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "QuickLoginTerminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickLoginEvent" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "QuickLoginOutcome" NOT NULL,
    "method" "QuickLoginMethod" NOT NULL,
    "userId" TEXT,
    "credentialId" INTEGER,
    "terminalId" INTEGER,
    "ip" TEXT,
    "userAgent" TEXT,
    "note" TEXT,

    CONSTRAINT "QuickLoginEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffCredential_nfcUid_key" ON "StaffCredential"("nfcUid");

-- CreateIndex
CREATE UNIQUE INDEX "StaffCredential_qrTokenHash_key" ON "StaffCredential"("qrTokenHash");

-- CreateIndex
CREATE INDEX "StaffCredential_userId_idx" ON "StaffCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "QuickLoginTerminal_tokenHash_key" ON "QuickLoginTerminal"("tokenHash");

-- CreateIndex
CREATE INDEX "QuickLoginEvent_at_idx" ON "QuickLoginEvent"("at");

-- CreateIndex
CREATE INDEX "QuickLoginEvent_ip_at_idx" ON "QuickLoginEvent"("ip", "at");

-- CreateIndex
CREATE INDEX "QuickLoginEvent_terminalId_at_idx" ON "QuickLoginEvent"("terminalId", "at");

-- AddForeignKey
ALTER TABLE "StaffCredential" ADD CONSTRAINT "StaffCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCredential" ADD CONSTRAINT "StaffCredential_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCredential" ADD CONSTRAINT "StaffCredential_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickLoginTerminal" ADD CONSTRAINT "QuickLoginTerminal_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A credential is exactly one kind: an NFC card has a UID and no token hash, a QR has a token hash and no UID.
ALTER TABLE "StaffCredential" ADD CONSTRAINT "StaffCredential_kind_check" CHECK (
  ("kind" = 'NFC' AND "nfcUid" IS NOT NULL AND "qrTokenHash" IS NULL)
  OR ("kind" = 'QR' AND "qrTokenHash" IS NOT NULL AND "nfcUid" IS NULL)
);
