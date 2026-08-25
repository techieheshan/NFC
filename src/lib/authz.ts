import "server-only";

import { notFound } from "next/navigation";
import type { UserRole } from "@prisma/client";

import { auth } from "@/auth";
import { navItemByHref } from "@/config/nav";

export type SessionUser = {
  id: string;
  username: string;
  role: UserRole;
};

/**
 * Route guard driven by the nav config, so "who sees the menu entry" and "who
 * may load the page" can never drift apart. Anything a role can't see 404s
 * rather than 403s — no point confirming a screen exists to someone who may
 * not use it.
 */
export async function requireNavAccess(href: string): Promise<SessionUser> {
  const item = navItemByHref(href);
  if (!item) notFound();

  const session = await auth();
  if (!session?.user || !item.roles.includes(session.user.role)) {
    notFound();
  }

  return session.user;
}

/**
 * Server-action guard. Actions are independently reachable HTTP endpoints, so
 * every one of them re-checks the role — the page guard above protects the
 * render, not the mutation.
 *
 * Throws rather than 404s: an action is never a navigation.
 */
export async function requireRole(roles: UserRole[]): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user || !roles.includes(session.user.role)) {
    throw new Error("Not authorised");
  }
  return session.user;
}

/**
 * Everything staff operate day to day — the Setup screens, registration, and
 * later attendance/payment — is ADMIN + STAFF. TEACHER is deliberately excluded.
 */
export const OPERATIONAL_ROLES: UserRole[] = ["ADMIN", "STAFF"];

/** The Setup screens (subjects, grades, teachers, courses). */
export const SETUP_ROLES = OPERATIONAL_ROLES;

export const requireSetupAccess = () => requireRole(SETUP_ROLES);

/** Registration and the other scan-driven operational screens. */
export const requireOperationalAccess = () => requireRole(OPERATIONAL_ROLES);
