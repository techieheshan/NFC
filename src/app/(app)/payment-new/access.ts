import "server-only";

import { notFound } from "next/navigation";
import type { UserRole } from "@prisma/client";

import { auth } from "@/auth";
import { requireRole } from "@/lib/authz";

/**
 * Who may use the NEW payment screens: the one switch.
 *
 * ADMIN only, for now. The new screens can record a month as "No charge", and the
 * Daily Summary and payslip counts still count such a row as a payer until job 5
 * (see the gate in AGENTS.md). Until then anyone with STAFF access who typed the
 * address must not be able to create those rows.
 *
 * AT THE MENU SWITCH, flip this single constant to `OPERATIONAL_ROLES` (ADMIN + STAFF,
 * what the old /payment allows) — nothing else changes: both pages and both read
 * actions below read it, and the tests tie them to it.
 */
export const PAYMENT_NEW_ROLES: UserRole[] = ["ADMIN"];

/** The pages. Anyone else gets the not-found screen, as for a route that does not exist. */
export async function requirePaymentNewPage() {
  const session = await auth();
  if (!session?.user || !PAYMENT_NEW_ROLES.includes(session.user.role)) notFound();
  return session.user;
}

/** The read actions. Each is its own HTTP endpoint, so each calls this itself (AGENTS rule 10). */
export const requirePaymentNewAction = () => requireRole(PAYMENT_NEW_ROLES);
