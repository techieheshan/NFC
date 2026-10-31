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

/** Who the stubbed `auth()` reports: a role, or `null` for "not signed in". */
export function setSession(role: UserRole | null) {
  currentRole = role;
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
          currentRole ? { user: { id: "test-user", username: "test", role: currentRole } } : null,
      };
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
