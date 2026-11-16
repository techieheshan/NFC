import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { authConfig } from "@/auth.config";
import { colomboNow, to12Hour } from "@/lib/colombo-time";
import { db } from "@/lib/db";
import { attemptQuickLogin, quickConfig, quickSessionStillValid } from "@/lib/quick-login";
import { firstHop, publicCode, quickSessionExpired, readCookie, TERMINAL_COOKIE } from "@/lib/quick-login-rules";

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/** Failed attempts before the account locks, and for how long. */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

/**
 * Thrown when a locked account is used, so the login page can say WHEN the
 * lock lifts instead of "wrong password" — otherwise a legitimate user with the
 * right password sees a lie and keeps trying.
 *
 * `code` carries the Colombo time back to the page; Auth.js preserves it on the
 * error it re-throws.
 */
export class AccountLockedError extends CredentialsSignin {
  code: string;
  constructor(until: string) {
    super("locked");
    this.code = `locked:${until}`;
  }
}

/**
 * A refused staff card or QR. The `code` carries what the screen may say ("quick:no-terminal", "quick:password:<username>"...): coarse on
 * purpose, so a stranger never learns whether a card is a student's, a revoked one or an unknown one (the audit trail has the real reason).
 */
export class QuickLoginRefusal extends CredentialsSignin {
  code: string;
  constructor(code: string) {
    super("quick");
    this.code = `quick:${code}`;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    /**
     * Staff quick login: a second, separate provider. The password provider below is untouched. Everything it decides lives in
     * `src/lib/quick-login.ts` (registered terminal, STAFF-only, counter, audit); this only reads the request and hands the result to Auth.js.
     */
    Credentials({
      id: "quick",
      name: "Staff card",
      credentials: { kind: { label: "Kind" }, value: { label: "Value" } },
      async authorize(raw, request) {
        const kind = raw?.kind === "NFC" ? "NFC" : raw?.kind === "QR" ? "QR" : null;
        const value = typeof raw?.value === "string" ? raw.value.slice(0, 300) : "";
        if (!kind || value === "") return null;
        const h = request?.headers;
        const result = await attemptQuickLogin({
          kind,
          value,
          terminalToken: readCookie(h?.get("cookie"), TERMINAL_COOKIE),
          ip: firstHop(h?.get("x-forwarded-for")),
          userAgent: h?.get("user-agent") ?? null,
        });
        if (result.outcome !== "SUCCESS") throw new QuickLoginRefusal(publicCode(result.outcome, result.outcome === "PASSWORD_REQUIRED" ? result.username : undefined));
        const u = result.user;
        return {
          id: u.id,
          username: u.username,
          role: u.role,
          name: u.username,
          tokenVersion: u.tokenVersion,
          mustChangePassword: false,
          via: kind === "NFC" ? ("nfc" as const) : ("qr" as const),
          credentialId: u.credentialId,
          terminalId: u.terminalId,
        };
      },
    }),
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { username, password } = parsed.data;

        const user = await db.user.findUnique({ where: { username } });
        // Deactivated logins are rejected the same way a wrong password is —
        // no signal to the caller about which it was.
        if (!user || !user.active) return null;

        const now = new Date();

        // Checked BEFORE the password: a correct password during a lockout
        // must still be refused, or the lockout defends nothing.
        if (user.lockedUntil && user.lockedUntil > now) {
          throw new AccountLockedError(to12Hour(colomboNow(user.lockedUntil).time));
        }

        const ok = await bcrypt.compare(password, user.passwordHash);

        if (!ok) {
          const failed = user.failedLoginCount + 1;
          await db.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount: failed,
              // Counted in the database, so restarting the box — or running a
              // second instance — does not hand an attacker a fresh five.
              ...(failed >= MAX_FAILED_LOGINS
                ? { lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) }
                : {}),
            },
          });
          return null;
        }

        // A good password clears the slate; a lock only ever follows failures.
        if (user.failedLoginCount !== 0 || user.lockedUntil) {
          await db.user.update({
            where: { id: user.id },
            data: { failedLoginCount: 0, lockedUntil: null },
          });
        }

        return {
          id: user.id,
          username: user.username,
          role: user.role,
          name: user.username,
          tokenVersion: user.tokenVersion,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,

    /**
     * Runs on sign-in AND on every session read, but only in Node — the edge
     * proxy uses authConfig's token-only version, which cannot reach Prisma.
     * That is fine: the proxy is a coarse "is there a token" gate, and every
     * page and action re-checks here through `auth()`.
     *
     * The read is one lookup by primary key. At this scale, against Postgres on
     * the same machine, that is cheaper than the alternative of sessions that
     * cannot be revoked.
     */
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id as string;
        token.username = user.username;
        token.role = user.role;
        token.ver = user.tokenVersion;
        token.mustChange = user.mustChangePassword;
        // A password sign-in leaves these absent, exactly as before this provider existed.
        if (user.via) {
          token.via = user.via;
          token.qAt = Date.now();
          token.cred = user.credentialId;
          token.term = user.terminalId;
        }
        return token;
      }

      const current = await db.user.findUnique({
        where: { id: token.userId },
        select: {
          active: true,
          role: true,
          tokenVersion: true,
          mustChangePassword: true,
        },
      });

      // Returning null invalidates the session: the account is gone, switched
      // off, or every token issued before a revocation point.
      if (!current || !current.active || current.tokenVersion !== token.ver) {
        return null;
      }

      // A session that started with a staff card or QR is only as good as that card and that terminal, only while the person is still STAFF,
      // and only for the Setting's hours. A password session (no `via`) never enters this branch, so it is exactly what it was.
      if (token.via === "nfc" || token.via === "qr") {
        const cfg = await quickConfig();
        if (
          current.role !== "STAFF" ||
          !cfg.enabled ||
          quickSessionExpired(token, Date.now(), cfg.sessionHours) ||
          !(await quickSessionStillValid(token.cred, token.term))
        ) {
          return null;
        }
      }

      // Role and the forced-change flag can change mid-session, so they are
      // read fresh. `ver` deliberately is not — see the JWT augmentation.
      token.role = current.role;
      token.mustChange = current.mustChangePassword;
      return token;
    },

    session({ session, token }) {
      session.user.id = token.userId;
      session.user.username = token.username;
      session.user.role = token.role;
      session.user.mustChangePassword = token.mustChange;
      return session;
    },
  },
});
