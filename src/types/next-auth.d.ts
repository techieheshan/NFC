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
    /** Set only by a staff card or QR sign-in (provider "quick"). Absent for a password sign-in. */
    via?: "nfc" | "qr";
    credentialId?: number;
    terminalId?: number;
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
    /** How the session started. ABSENT on every token minted before quick login existed, which reads as "password". */
    via?: "password" | "nfc" | "qr";
    /** When a quick session started (ms), the clock for `quick_login_session_hours`. */
    qAt?: number;
    /** The staff card and the terminal a quick session came from: revoking either ends the session. */
    cred?: number;
    term?: number;
  }
}
