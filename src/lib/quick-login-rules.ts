import { createHash, randomBytes } from "node:crypto";

/**
 * Staff quick login: the pure rules (no database), so they are tested on their own.
 *
 * The honest limit, said once: a card UID is a convenience, not a secret, and Web NFC reads a UID, not a challenge-response. The design does not
 * rely on the card being unforgeable. It relies on the REGISTERED-TERMINAL rule, the quick sign-in counter, the STAFF-only role limit and the
 * audit trail (see `quick-login.ts`).
 */

/** The cookie that names a registered terminal. Its value is random; only its SHA-256 is stored. */
export const TERMINAL_COOKIE = "xenon_terminal";

/** A staff QR carries this prefix, so a student's QR (a bare card number) is never read as one, and a staff QR is just an unknown number at the counter. */
export const QR_PREFIX = "XSTF1.";

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** A fresh terminal cookie value: 32 random bytes, URL-safe. */
export const newTerminalToken = () => randomBytes(32).toString("base64url");

/** A fresh staff QR token ("XSTF1." + 32 random bytes, URL-safe). It is shown once, when printed. */
export const newQrToken = () => `${QR_PREFIX}${randomBytes(32).toString("base64url")}`;

/** The token inside a scanned staff QR, or null for anything else (a student card number, junk, a wrong length). */
export function parseStaffQr(raw: string): string | null {
  const v = raw.trim();
  return /^XSTF1\.[A-Za-z0-9_-]{43}$/.test(v) ? v : null;
}

/** Reads one cookie from a `Cookie:` request header. */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** The first hop of `X-Forwarded-For`, trimmed and bounded; null when absent. */
export function firstHop(forwardedFor: string | null | undefined): string | null {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first ? first.slice(0, 64) : null;
}

export type Outcome =
  | "SUCCESS" | "UNKNOWN_CREDENTIAL" | "STUDENT_CARD_REFUSED" | "REVOKED" | "USER_INACTIVE" | "NOT_STAFF_ROLE"
  | "MUST_CHANGE_PASSWORD" | "PASSWORD_REQUIRED" | "NO_TERMINAL" | "RATE_LIMITED" | "DISABLED";

/**
 * What the person at the terminal is told. Deliberately coarse: an unknown card, a student card, a revoked card, a switched-off login and a
 * non-staff card all read "not recognised", so the screen never tells a stranger which of them a card is. The audit trail has the real reason.
 */
export type PublicCode = "off" | "no-terminal" | "paused" | "use-password" | "unknown" | `password:${string}`;

export function publicCode(outcome: Outcome, username?: string): PublicCode {
  switch (outcome) {
    case "DISABLED": return "off";
    case "NO_TERMINAL": return "no-terminal";
    case "RATE_LIMITED": return "paused";
    case "MUST_CHANGE_PASSWORD": return "use-password";
    case "PASSWORD_REQUIRED": return `password:${username ?? ""}`;
    default: return "unknown";
  }
}

export const PUBLIC_TEXT: Record<"off" | "no-terminal" | "paused" | "use-password" | "unknown", string> = {
  off: "Card sign-in is switched off. Use your username and password.",
  "no-terminal": "Sign in with your password once on this terminal to turn on card sign-in here.",
  paused: "Card sign-in is paused on this terminal for a few minutes. Use your password.",
  "use-password": "Use your username and password to sign in.",
  unknown: "That card was not recognised.",
};

export const PASSWORD_NEEDED_TEXT = "Password needed on this terminal. Type your password to continue.";

/** A quick session ends after `hours`; a password session (no `via`, or "password") never ends here. */
export function quickSessionExpired(token: { via?: string; qAt?: number }, nowMs: number, hours: number): boolean {
  if (!token.via || token.via === "password") return false;
  if (typeof token.qAt !== "number") return true; // a quick token without its start time is not trusted
  return nowMs - token.qAt > hours * 3_600_000;
}

/** Positive whole number from a Setting's text, else the documented default. */
export function intSetting(raw: string | null | undefined, fallback: number, max = 9999): number {
  const n = Number((raw ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback;
}
