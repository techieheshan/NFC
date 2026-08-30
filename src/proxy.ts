import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

/**
 * Route protection. (Next.js 16 renamed the `middleware` convention to
 * `proxy`; this is the same edge interception point.)
 *
 * Edge-safe: authConfig carries no Prisma/bcrypt, and the JWT session strategy
 * means authorization is a token read, not a database query. The redirect to
 * /login comes from `pages.signIn` in authConfig.
 */
export default NextAuth(authConfig).auth;

export const config = {
  /**
   * Protect everything except:
   *   - /api/auth/*        Auth.js's own endpoints (sign-in would deadlock)
   *   - Next.js internals and static assets
   *   - PWA files that must be fetchable before a session exists
   *   - /offline, which the service worker precaches and serves when there is
   *     no server to redirect anyone anywhere
   */
  matcher: [
    "/((?!api/auth|offline|_next/static|_next/image|icons/|favicon.ico|manifest.webmanifest|sw.js).*)",
  ],
};
