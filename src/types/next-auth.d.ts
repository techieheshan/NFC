import type { UserRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      role: UserRole;
      /** Routes the whole app to /change-password until it is cleared. */
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    username: string;
    role: UserRole;
    /** Stamped into the token at sign-in so revocation can be detected later. */
    tokenVersion: number;
    mustChangePassword: boolean;
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
    /**
     * The User.tokenVersion this token was minted with. It is deliberately NOT
     * refreshed from the database on later requests — comparing the frozen
     * value against the live one is the whole revocation mechanism.
     */
    ver: number;
    mustChange: boolean;
  }
}
