import Module from "node:module";

import type { UserRole } from "@prisma/client";

/**
 * Lets a plain `node --test` import the real server modules and actions.
 *
 * Next resolves `server-only` with the `react-server` condition and supplies the
 * session, cache and navigation itself; under the test runner none of that
 * exists, so each is replaced at the module-loader level. Nothing in `src/` is
 * touched — the production code under test is the real file, unmodified.
 *
 * Import AFTER `no-database` / the db guard and BEFORE any `@/…` module.
 */

let currentRole: UserRole | null = null;
let currentUserId = "test-user";

/**
 * Who the stubbed `auth()` reports: a role, or `null` for "not signed in".
 * Database tests pass the id of a real User row — payments are written with it
 * as a foreign key.
 */
export function setSession(role: UserRole | null, userId = "test-user") {
  currentRole = role;
  currentUserId = userId;
}

type Loader = (request: string, ...rest: unknown[]) => unknown;
const internals = Module as unknown as { _load: Loader };
const original = internals._load;

internals._load = function (this: unknown, request: string, ...rest: unknown[]) {
  switch (request) {
    case "server-only":
      return {};
    case "@/auth":
      return {
        auth: async () =>
          currentRole ? { user: { id: currentUserId, username: "test", role: currentRole } } : null,
      };
    case "next/font/google":
      // next/font is a build-time transform; under node every font function just returns its CSS variable name.
      return new Proxy({}, { get: () => () => ({ variable: "stub-font-variable", className: "stub-font-class" }) });
    case "next/cache":
      return { revalidatePath() {}, revalidateTag() {}, unstable_cache: (fn: unknown) => fn };
    case "next/navigation":
      return {
        notFound() {
          throw new Error("NEXT_NOT_FOUND");
        },
        redirect() {
          throw new Error("NEXT_REDIRECT");
        },
      };
    default:
      return original.call(this, request, ...rest);
  }
};
