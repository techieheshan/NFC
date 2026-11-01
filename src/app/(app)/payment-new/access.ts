import "server-only";

import { notFound } from "next/navigation";
import type { UserRole } from "@prisma/client";

import { auth } from "@/auth";
import { requireRole } from "@/lib/authz";

/**
 * Who may use the NEW payment screens: the one switch.
 *
 * ADMIN only, for now. The new screens can record a month as "No charge" or "Half month",
 * and the Daily Summary and payslip counts still read such a row as a payer until job 5
 * (see the gate in AGENTS.md). Until then STAFF should not reach them by typing the address.
 * This decides who may OPEN the screens; it is not a limit on the modes — once the screens
 * are open, Full, Half and No charge carry no role limit (a decision, see AGENTS.md).
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
