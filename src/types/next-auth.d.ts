import type { UserRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      role: UserRole;
    } & DefaultSession["user"];
  }

  interface User {
    username: string;
    role: UserRole;
  }
}

/**
 * Augment `@auth/core/jwt`, NOT `next-auth/jwt`.
 *
 * `next-auth/jwt` is only a re-export (`export * from "@auth/core/jwt"`), so
 * declaring an interface there creates a second, unrelated JWT type instead of
 * merging into the one the callbacks are actually typed against.
 */
declare module "@auth/core/jwt" {
  interface JWT {
    userId: string;
    username: string;
    role: UserRole;
  }
}
