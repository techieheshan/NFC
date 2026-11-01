import "server-only";

import { notFound } from "next/navigation";
import type { UserRole } from "@prisma/client";

import { auth } from "@/auth";
import { OPERATIONAL_ROLES, requireRole } from "@/lib/authz";

/**
 * Who may use the NEW payment screens: the one switch.
 *
 * ADMIN + STAFF, what the old /payment allowed: since the menu switch the Payment entry opens
 * these screens. This decides who may OPEN the screens; it is not a limit on the modes — once
 * the screens are open, Full, Half and No charge carry no role limit (a decision, see AGENTS.md).
 * Both pages and both read actions below read this one constant, and the tests tie them to it.
 *
 * It is a COPY of `OPERATIONAL_ROLES`, so a test that pushes into it cannot change the shared array.
 */
export const PAYMENT_NEW_ROLES: UserRole[] = [...OPERATIONAL_ROLES];

/** The pages. Anyone else gets the not-found screen, as for a route that does not exist. */
export async function requirePaymentNewPage() {
  const session = await auth();
  if (!session?.user || !PAYMENT_NEW_ROLES.includes(session.user.role)) notFound();
  return session.user;
}

/** The read actions. Each is its own HTTP endpoint, so each calls this itself (AGENTS rule 10). */
export const requirePaymentNewAction = () => requireRole(PAYMENT_NEW_ROLES);
