import "server-only";

import { normalizeCardNumber, normalizeCardUid } from "@/lib/card-uid";
import { db } from "@/lib/db";
import { getSetting, getToggle } from "@/lib/settings";
import { intSetting, newTerminalToken, parseStaffQr, sha256, type Outcome } from "@/lib/quick-login-rules";

/*
 * Staff quick login: the server rules. Read `quick-login-rules.ts` for the honest limit of a card UID. This file is the whole decision:
 *
 *  1. the feature must be switched on (Setting quick_login_enabled, off by default);
 *  2. the request must come from a REGISTERED terminal (a cookie whose hash is in QuickLoginTerminal): a copied UID or a photographed QR
 *     sent from anywhere else is refused, so 4-byte UIDs cannot be brute-forced from outside;
 *  3. the terminal must not be paused (too many refused taps) and a flood from one IP is refused first;
 *  4. the credential is looked up in StaffCredential ONLY. A student's card never signs anyone in; it is logged as STUDENT_CARD_REFUSED;
 *  5. the holder must be an ACTIVE STAFF user without a forced password change; ADMIN and TEACHER cards never sign in;
 *  6. after `quick_login_max_in_a_row` quick sign-ins on this terminal the next person must type their password (which resets the count).
 *
 * Every attempt is written to QuickLoginEvent (never the raw UID or token). The counter increment is one atomic UPDATE, so two taps at once
 * cannot both take the last quick sign-in.
 */

export type QuickUser = {
  id: string;
  username: string;
  role: "STAFF";
  tokenVersion: number;
  credentialId: number;
  terminalId: number;
};
export type QuickResult =
  | { outcome: "SUCCESS"; user: QuickUser }
  | { outcome: Exclude<Outcome, "SUCCESS">; username?: string };

export type QuickConfig = { enabled: boolean; maxInRow: number; sessionHours: number; maxFailedTaps: number; lockMinutes: number };

export async function quickConfig(): Promise<QuickConfig> {
  const [enabled, maxInRow, sessionHours, maxFailedTaps, lockMinutes] = await Promise.all([
    getToggle("quick_login_enabled"),
    getSetting("quick_login_max_in_a_row"),
    getSetting("quick_login_session_hours"),
    getSetting("quick_login_max_failed_taps"),
    getSetting("quick_login_lock_minutes"),
  ]);
  return {
    enabled,
    maxInRow: intSetting(maxInRow, 5),
    sessionHours: intSetting(sessionHours, 12),
    maxFailedTaps: intSetting(maxFailedTaps, 10),
    lockMinutes: intSetting(lockMinutes, 5),
  };
}

type Ctx = { ip: string | null; userAgent: string | null };
const ua = (v: string | null) => (v ? v.slice(0, 200) : null);

async function logEvent(c: Ctx, e: { outcome: Outcome; method: "NFC" | "QR" | "PASSWORD"; userId?: string | null; credentialId?: number | null; terminalId?: number | null; note?: string }) {
  await db.quickLoginEvent.create({
    data: { outcome: e.outcome, method: e.method, userId: e.userId ?? null, credentialId: e.credentialId ?? null, terminalId: e.terminalId ?? null, ip: c.ip, userAgent: ua(c.userAgent), note: e.note ?? null },
  });
}

/** One refused tap on this terminal: counts in a one-minute window; too many pause the terminal for a few minutes. */
async function recordFailedTap(terminalId: number, cfg: QuickConfig, now: Date) {
  const t = await db.quickLoginTerminal.findUnique({ where: { id: terminalId }, select: { failedTaps: true, failedWindowStart: true } });
  if (!t) return;
  const fresh = !t.failedWindowStart || now.getTime() - t.failedWindowStart.getTime() > 60_000;
  const taps = fresh ? 1 : t.failedTaps + 1;
  const pause = taps >= cfg.maxFailedTaps;
  await db.quickLoginTerminal.update({
    where: { id: terminalId },
    data: pause
      ? { failedTaps: 0, failedWindowStart: null, lockedUntil: new Date(now.getTime() + cfg.lockMinutes * 60_000) }
      : { failedTaps: taps, failedWindowStart: fresh ? now : t.failedWindowStart },
  });
}

export async function attemptQuickLogin(input: { kind: "NFC" | "QR"; value: string; terminalToken: string | null; ip: string | null; userAgent: string | null; now?: Date }): Promise<QuickResult> {
  const now = input.now ?? new Date();
  const c: Ctx = { ip: input.ip, userAgent: input.userAgent };
  const method = input.kind;
  const cfg = await quickConfig();

  if (!cfg.enabled) {
    await logEvent(c, { outcome: "DISABLED", method });
    return { outcome: "DISABLED" };
  }

  // A flood from one address is refused before anything else, and past three times the limit it is not even written down.
  if (c.ip) {
    const recent = await db.quickLoginEvent.count({ where: { ip: c.ip, at: { gte: new Date(now.getTime() - 60_000) }, NOT: { outcome: "SUCCESS" } } });
    const limit = cfg.maxFailedTaps * 3;
    if (recent >= limit) {
      if (recent < limit * 3) await logEvent(c, { outcome: "RATE_LIMITED", method, note: "ip" });
      return { outcome: "RATE_LIMITED" };
    }
  }

  const terminal = input.terminalToken ? await db.quickLoginTerminal.findUnique({ where: { tokenHash: sha256(input.terminalToken) } }) : null;
  if (!terminal || terminal.revokedAt) {
    await logEvent(c, { outcome: "NO_TERMINAL", method });
    return { outcome: "NO_TERMINAL" };
  }
  if (terminal.lockedUntil && terminal.lockedUntil > now) {
    await logEvent(c, { outcome: "RATE_LIMITED", method, terminalId: terminal.id, note: "terminal" });
    return { outcome: "RATE_LIMITED" };
  }

  const refuse = async (outcome: Exclude<Outcome, "SUCCESS" | "PASSWORD_REQUIRED">, extra: { userId?: string; credentialId?: number } = {}): Promise<QuickResult> => {
    await logEvent(c, { outcome, method, terminalId: terminal.id, ...extra });
    await recordFailedTap(terminal.id, cfg, now);
    return { outcome };
  };

  // ---- find the STAFF credential (and nothing else) ----
  let cred: Awaited<ReturnType<typeof findCredential>> = null;
  let studentCard = false;
  if (input.kind === "NFC") {
    const uid = normalizeCardUid(input.value);
    if (!/^[0-9A-F]{4,32}$/.test(uid)) return refuse("UNKNOWN_CREDENTIAL");
    cred = await findCredential({ nfcUid: uid });
    if (!cred) studentCard = (await db.student.findUnique({ where: { cardUid: uid }, select: { id: true } })) !== null;
  } else {
    const token = parseStaffQr(input.value);
    cred = token ? await findCredential({ qrTokenHash: sha256(token) }) : null;
    if (!cred) studentCard = (await db.student.findUnique({ where: { cardNumber: normalizeCardNumber(input.value) }, select: { id: true } })) !== null;
  }
  if (!cred) return refuse(studentCard ? "STUDENT_CARD_REFUSED" : "UNKNOWN_CREDENTIAL");

  const who = { userId: cred.userId, credentialId: cred.id };
  if (cred.revokedAt) return refuse("REVOKED", who);
  if (!cred.user.active) return refuse("USER_INACTIVE", who);
  if (cred.user.role !== "STAFF") return refuse("NOT_STAFF_ROLE", who);
  if (cred.user.mustChangePassword) return refuse("MUST_CHANGE_PASSWORD", who);
  // The account's own lockout (failed passwords) also stops a card: a locked account is not opened by a card.
  if (cred.user.lockedUntil && cred.user.lockedUntil > now) return refuse("USER_INACTIVE", { ...who });

  // One atomic step: take one of the quick sign-ins left on this terminal, or none.
  const took = await db.quickLoginTerminal.updateMany({
    where: { id: terminal.id, revokedAt: null, consecutiveQuick: { lt: cfg.maxInRow } },
    data: { consecutiveQuick: { increment: 1 }, lastSeenAt: now, failedTaps: 0, failedWindowStart: null },
  });
  if (took.count === 0) {
    await logEvent(c, { outcome: "PASSWORD_REQUIRED", method, terminalId: terminal.id, ...who });
    return { outcome: "PASSWORD_REQUIRED", username: cred.user.username };
  }

  await db.staffCredential.update({ where: { id: cred.id }, data: { lastUsedAt: now } });
  await logEvent(c, { outcome: "SUCCESS", method, terminalId: terminal.id, ...who });
  return { outcome: "SUCCESS", user: { id: cred.user.id, username: cred.user.username, role: "STAFF", tokenVersion: cred.user.tokenVersion, credentialId: cred.id, terminalId: terminal.id } };
}

const findCredential = (where: { nfcUid: string } | { qrTokenHash: string }) =>
  db.staffCredential.findUnique({
    where,
    include: { user: { select: { id: true, username: true, role: true, active: true, mustChangePassword: true, tokenVersion: true, lockedUntil: true } } },
  });

/**
 * A good PASSWORD sign-in: the device becomes (or stays) a registered terminal, and its quick sign-in count goes back to zero. Returns the new
 * cookie value only when a terminal was created. Does nothing while the feature is off, so a site that never uses it gets no cookie and no rows.
 */
export async function registerTerminalOnPasswordLogin(input: { terminalToken: string | null; userId: string; ip: string | null; userAgent: string | null; now?: Date }): Promise<{ newToken: string | null }> {
  const cfg = await quickConfig();
  if (!cfg.enabled) return { newToken: null };
  const now = input.now ?? new Date();
  const c: Ctx = { ip: input.ip, userAgent: input.userAgent };

  const existing = input.terminalToken ? await db.quickLoginTerminal.findUnique({ where: { tokenHash: sha256(input.terminalToken) } }) : null;
  if (existing && !existing.revokedAt) {
    await db.quickLoginTerminal.update({ where: { id: existing.id }, data: { consecutiveQuick: 0, failedTaps: 0, failedWindowStart: null, lastSeenAt: now } });
    await logEvent(c, { outcome: "SUCCESS", method: "PASSWORD", userId: input.userId, terminalId: existing.id });
    return { newToken: null };
  }
  const token = newTerminalToken();
  const created = await db.quickLoginTerminal.create({ data: { tokenHash: sha256(token), lastSeenAt: now } });
  await logEvent(c, { outcome: "SUCCESS", method: "PASSWORD", userId: input.userId, terminalId: created.id, note: "terminal registered" });
  return { newToken: token };
}

/**
 * A quick session is only as good as its card and its terminal: revoking either ends it on the very next request. One query, quick sessions only.
 * (A password session never calls this.)
 */
export async function quickSessionStillValid(credentialId: number | undefined, terminalId: number | undefined): Promise<boolean> {
  if (!credentialId || !terminalId) return false;
  const [cred, term] = await Promise.all([
    db.staffCredential.findUnique({ where: { id: credentialId }, select: { revokedAt: true } }),
    db.quickLoginTerminal.findUnique({ where: { id: terminalId }, select: { revokedAt: true } }),
  ]);
  return cred !== null && cred.revokedAt === null && term !== null && term.revokedAt === null;
}

/** Old audit rows go (an admin opening the staff card screen runs this). Returns how many. */
export async function purgeOldQuickEvents(now: Date = new Date()): Promise<number> {
  const days = intSetting(await getSetting("quick_login_audit_days"), 90);
  const r = await db.quickLoginEvent.deleteMany({ where: { at: { lt: new Date(now.getTime() - days * 86_400_000) } } });
  return r.count;
}
