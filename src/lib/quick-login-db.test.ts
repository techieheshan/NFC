import { dbSkip, freezeClock, makeStudent, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

import { newQrToken, sha256, newTerminalToken } from "@/lib/quick-login-rules";

/*
 * Staff quick login against a real (throw-away) database, made-up data only. The rules under test (design D):
 *  - off unless the Setting is on; refused unless the request comes from a REGISTERED terminal (a copied UID or a photographed QR alone is useless);
 *  - STAFF cards only, looked up in StaffCredential only: a student's card (UID or card number) never signs anyone in;
 *  - after N quick sign-ins in a row the next needs a password, which resets the count; the counter is atomic under a race;
 *  - revoked, inactive, locked, ADMIN, TEACHER and must-change-password holders are refused; repeated refusals pause the terminal; an IP flood is refused;
 *  - every attempt is audited and the audit never holds the raw UID or token.
 */

const NOW = "2026-11-16T06:00:00Z";
type Lib = typeof import("@/lib/quick-login");
let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let L: Lib;
let n = 0;

describe("staff quick login (database)", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    L = await import("@/lib/quick-login");
    w = await seedWorld(db);
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  const set = (key: string, value: string) => db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  const on = async (extra: Record<string, string> = {}) => {
    await set("quick_login_enabled", "on");
    for (const [k, v] of Object.entries({ quick_login_max_in_a_row: "5", quick_login_max_failed_taps: "10", quick_login_lock_minutes: "5", ...extra })) await set(k, v);
  };
  const uid = () => `04A2${(++n).toString(16).toUpperCase().padStart(4, "0")}`;
  const ip = () => `203.0.113.${(n++ % 200) + 1}`;
  const staffUser = (o: Record<string, unknown> = {}) => db.user.create({ data: { username: `staff-${++n}`, passwordHash: "x", role: "STAFF", ...o } });
  const card = async (userId: string, cardUid = uid()) => (await db.staffCredential.create({ data: { userId, kind: "NFC", nfcUid: cardUid, createdById: w.admin.id } }), cardUid);
  /** A registered terminal: what a password sign-in makes. Returns its cookie value. */
  const terminal = async () => {
    const r = await L.registerTerminalOnPasswordLogin({ terminalToken: null, userId: w.staff.id, ip: ip(), userAgent: "test" });
    assert.ok(r.newToken);
    return r.newToken!;
  };
  const tap = (cardUid: string, token: string | null, o: { ip?: string; kind?: "NFC" | "QR"; now?: Date } = {}) =>
    L.attemptQuickLogin({ kind: o.kind ?? "NFC", value: cardUid, terminalToken: token, ip: o.ip ?? ip(), userAgent: "test", now: o.now });
  const outcomes = async () => (await db.quickLoginEvent.findMany({ orderBy: { id: "asc" } })).map((e) => e.outcome);
  const reset = async () => { await db.quickLoginEvent.deleteMany(); };

  test("the feature is off by default: a good card on a registered terminal is refused as DISABLED, and a password sign-in registers no terminal", async () => {
    const u = await staffUser();
    const c = await card(u.id);
    assert.equal((await tap(c, "whatever")).outcome, "DISABLED");
    assert.deepEqual(await L.registerTerminalOnPasswordLogin({ terminalToken: null, userId: u.id, ip: null, userAgent: null }), { newToken: null });
    assert.equal(await db.quickLoginTerminal.count(), 0);
  });

  test("no terminal, no sign-in: a missing, unknown or revoked terminal cookie refuses even a good staff card", async () => {
    await on();
    const u = await staffUser();
    const c = await card(u.id);
    const t = await terminal();
    assert.equal((await tap(c, null)).outcome, "NO_TERMINAL");
    assert.equal((await tap(c, newTerminalToken())).outcome, "NO_TERMINAL", "a made-up cookie");
    assert.equal((await tap(c, sha256(t))).outcome, "NO_TERMINAL", "the HASH is not the cookie");
    const ok = await tap(c, t);
    assert.equal(ok.outcome, "SUCCESS");
    await db.quickLoginTerminal.updateMany({ data: { revokedAt: new Date() } });
    assert.equal((await tap(c, t)).outcome, "NO_TERMINAL", "a revoked terminal");
    await db.quickLoginTerminal.updateMany({ data: { revokedAt: null } });
  });

  test("a STAFF card signs in as that STAFF user only, with the user's current token version", async () => {
    await on();
    const u = await staffUser({ tokenVersion: 7 });
    const c = await card(u.id);
    const r = await tap(c, await terminal());
    assert.equal(r.outcome, "SUCCESS");
    if (r.outcome === "SUCCESS") assert.deepEqual([r.user.id, r.user.role, r.user.tokenVersion], [u.id, "STAFF", 7]);
    assert.ok((await db.staffCredential.findFirstOrThrow({ where: { userId: u.id } })).lastUsedAt, "last used is stamped");
    // the card format does not matter: colons, lowercase, spaces
    const t = await terminal();
    assert.equal((await tap(c.match(/.{2}/g)!.join(":").toLowerCase(), t)).outcome, "SUCCESS");
    assert.equal((await tap(` ${c.slice(0, 4)} ${c.slice(4)} `, t)).outcome, "SUCCESS");
  });

  test("the counter: 5 quick sign-ins in a row, the 6th asks for a password (with the username); a PASSWORD sign-in on the terminal resets it", async () => {
    await on();
    const u = await staffUser();
    const c = await card(u.id);
    const t = await terminal();
    for (let i = 1; i <= 5; i++) assert.equal((await tap(c, t)).outcome, "SUCCESS", `quick sign-in ${i}`);
    const sixth = await tap(c, t);
    assert.equal(sixth.outcome, "PASSWORD_REQUIRED");
    assert.equal("username" in sixth ? sixth.username : "", u.username);
    assert.equal((await tap(c, t)).outcome, "PASSWORD_REQUIRED", "still, until a password is typed");
    assert.equal((await db.quickLoginTerminal.findFirstOrThrow({ where: { tokenHash: sha256(t) } })).consecutiveQuick, 5, "refused taps do not count");
    // anyone's password sign-in on this terminal resets it, and does not make a new terminal
    assert.deepEqual(await L.registerTerminalOnPasswordLogin({ terminalToken: t, userId: w.admin.id, ip: null, userAgent: null }), { newToken: null });
    assert.equal((await db.quickLoginTerminal.findFirstOrThrow({ where: { tokenHash: sha256(t) } })).consecutiveQuick, 0);
    assert.equal((await tap(c, t)).outcome, "SUCCESS");
  });

  test("a race: eight taps at once on a terminal with one quick sign-in left take it once", async () => {
    await on({ quick_login_max_in_a_row: "3" });
    const u = await staffUser();
    const c = await card(u.id);
    const t = await terminal();
    const results = await Promise.all(Array.from({ length: 8 }, () => tap(c, t)));
    assert.equal(results.filter((r) => r.outcome === "SUCCESS").length, 3, JSON.stringify(results.map((r) => r.outcome)));
    assert.equal(results.filter((r) => r.outcome === "PASSWORD_REQUIRED").length, 5);
    assert.equal((await db.quickLoginTerminal.findFirstOrThrow({ where: { tokenHash: sha256(t) } })).consecutiveQuick, 3);
  });

  test("a student's card never signs anyone in: its UID and its card number are STUDENT_CARD_REFUSED", async () => {
    await on();
    const s = await makeStudent(db, { cardUid: uid() });
    const t = await terminal();
    await reset();
    assert.equal((await tap(s.cardUid!, t)).outcome, "STUDENT_CARD_REFUSED");
    assert.equal((await tap(s.cardNumber!, t, { kind: "QR" })).outcome, "STUDENT_CARD_REFUSED");
    assert.deepEqual(await outcomes(), ["STUDENT_CARD_REFUSED", "STUDENT_CARD_REFUSED"]);
    assert.equal(await db.staffCredential.count({ where: { OR: [{ nfcUid: s.cardUid }, { qrTokenHash: sha256(s.cardNumber!) }] } }), 0);
  });

  test("who is refused: revoked card, inactive user, locked account, ADMIN, TEACHER, must-change-password, and a made-up card", async () => {
    await on({ quick_login_max_failed_taps: "100" });
    const t = await terminal();
    const revoked = await staffUser();
    const cRevoked = await card(revoked.id);
    await db.staffCredential.updateMany({ where: { userId: revoked.id }, data: { revokedAt: new Date(), revokedById: w.admin.id, revokeReason: "lost" } });
    const inactive = await staffUser({ active: false });
    const locked = await staffUser({ lockedUntil: new Date("2026-11-17T00:00:00Z") });
    const teacher = await db.user.create({ data: { username: `t-${++n}`, passwordHash: "x", role: "TEACHER" } });
    const mustChange = await staffUser({ mustChangePassword: true });
    const cases: [string, string, string][] = [
      ["REVOKED", cRevoked, "revoked"], ["USER_INACTIVE", await card(inactive.id), "inactive"], ["USER_INACTIVE", await card(locked.id), "locked"],
      ["NOT_STAFF_ROLE", await card(w.admin.id), "an ADMIN's card"], ["NOT_STAFF_ROLE", await card(teacher.id), "a TEACHER's card"],
      ["MUST_CHANGE_PASSWORD", await card(mustChange.id), "must change password"], ["UNKNOWN_CREDENTIAL", "04FFFFFF", "unknown"], ["UNKNOWN_CREDENTIAL", "zzzz", "not hex"],
    ];
    for (const [want, c, why] of cases) assert.equal((await tap(c, t)).outcome, want, why);
    assert.equal((await db.quickLoginTerminal.findFirstOrThrow({ where: { tokenHash: sha256(t) } })).consecutiveQuick, 0, "no refusal used up a quick sign-in");
  });

  test("a QR: the token's hash is looked up; a wrong prefix, a student's number or junk is refused", async () => {
    await on();
    const u = await staffUser();
    const token = newQrToken();
    await db.staffCredential.create({ data: { userId: u.id, kind: "QR", qrTokenHash: sha256(token), createdById: w.admin.id } });
    const t = await terminal();
    assert.equal((await tap(token, t, { kind: "QR" })).outcome, "SUCCESS");
    assert.equal((await tap(token.replace("XSTF1.", "XSTF2."), t, { kind: "QR" })).outcome, "UNKNOWN_CREDENTIAL");
    assert.equal((await tap("0186-0001-2000", t, { kind: "QR" })).outcome, "UNKNOWN_CREDENTIAL");
    assert.equal((await tap(token, t, { kind: "NFC" })).outcome, "UNKNOWN_CREDENTIAL", "a QR token is not an NFC UID");
  });

  test("repeated refused taps pause the terminal (even for a good card) until the pause ends; the count is per minute", async () => {
    await on({ quick_login_max_failed_taps: "3", quick_login_lock_minutes: "5" });
    const u = await staffUser();
    const c = await card(u.id);
    const t = await terminal();
    const t0 = new Date("2026-11-16T07:00:00Z");
    for (let i = 0; i < 3; i++) assert.equal((await tap("04AAAAAA", t, { now: new Date(t0.getTime() + i * 1000), ip: "198.51.100.1" })).outcome, "UNKNOWN_CREDENTIAL");
    assert.equal((await tap(c, t, { now: new Date(t0.getTime() + 4000), ip: "198.51.100.2" })).outcome, "RATE_LIMITED", "paused: a good card is refused too");
    assert.equal((await tap(c, t, { now: new Date(t0.getTime() + 6 * 60_000), ip: "198.51.100.3" })).outcome, "SUCCESS", "after the pause");
    // taps spread over more than a minute do not add up
    await db.quickLoginTerminal.updateMany({ data: { failedTaps: 0, failedWindowStart: null, lockedUntil: null } });
    for (let i = 0; i < 6; i++) await tap("04AAAAAA", t, { now: new Date(t0.getTime() + 20 * 60_000 + i * 70_000), ip: "198.51.100.4" });
    assert.equal((await tap(c, t, { now: new Date(t0.getTime() + 30 * 60_000), ip: "198.51.100.5" })).outcome, "SUCCESS");
  });

  test("a flood from one address is refused, a different address is not", async () => {
    await on({ quick_login_max_failed_taps: "2" }); // the IP limit is three times this: 6 refusals a minute
    const u = await staffUser();
    const c = await card(u.id);
    const t = await terminal();
    const bad = ip();
    // audit rows are stamped by the frozen clock, so the attempts use it too (no `now` override)
    for (let i = 0; i < 6; i++) await L.attemptQuickLogin({ kind: "NFC", value: "04BBBBBB", terminalToken: null, ip: bad, userAgent: null });
    assert.equal((await L.attemptQuickLogin({ kind: "NFC", value: c, terminalToken: t, ip: bad, userAgent: null })).outcome, "RATE_LIMITED");
    assert.equal((await L.attemptQuickLogin({ kind: "NFC", value: c, terminalToken: t, ip: ip(), userAgent: null })).outcome, "SUCCESS");
  });

  test("the audit: every attempt is a row; no row holds a raw UID or token; each row names its terminal", async () => {
    await on();
    await db.quickLoginEvent.deleteMany();
    const u = await staffUser();
    const c = await card(u.id);
    const token = newQrToken();
    await db.staffCredential.create({ data: { userId: u.id, kind: "QR", qrTokenHash: sha256(token), createdById: w.admin.id } });
    const t = await terminal();
    await tap(c, t);
    await tap(token, t, { kind: "QR" });
    await tap("04DEADBE", t);
    await tap(c, null);
    const events = await db.quickLoginEvent.findMany({ orderBy: { id: "asc" } });
    assert.deepEqual(events.map((e) => [e.method, e.outcome]), [["PASSWORD", "SUCCESS"], ["NFC", "SUCCESS"], ["QR", "SUCCESS"], ["NFC", "UNKNOWN_CREDENTIAL"], ["NFC", "NO_TERMINAL"]]);
    const text = JSON.stringify(events);
    for (const secret of [c, token, "04DEADBE", t, sha256(t)]) assert.ok(!text.includes(secret), "no raw uid, token or cookie value in the audit");
    assert.ok(events.slice(0, 4).every((e) => e.terminalId !== null));
    assert.equal(events[1].userId, u.id);
  });

  test("a session ends when its card or its terminal is revoked", async () => {
    await on();
    const u = await staffUser();
    const c = await card(u.id);
    const t = await terminal();
    const r = await tap(c, t);
    assert.equal(r.outcome, "SUCCESS");
    if (r.outcome !== "SUCCESS") return;
    assert.equal(await L.quickSessionStillValid(r.user.credentialId, r.user.terminalId), true);
    assert.equal(await L.quickSessionStillValid(undefined, r.user.terminalId), false);
    await db.staffCredential.update({ where: { id: r.user.credentialId }, data: { revokedAt: new Date(), revokedById: w.admin.id, revokeReason: "lost" } });
    assert.equal(await L.quickSessionStillValid(r.user.credentialId, r.user.terminalId), false, "card revoked");
    await db.staffCredential.update({ where: { id: r.user.credentialId }, data: { revokedAt: null } });
    await db.quickLoginTerminal.update({ where: { id: r.user.terminalId }, data: { revokedAt: new Date() } });
    assert.equal(await L.quickSessionStillValid(r.user.credentialId, r.user.terminalId), false, "terminal revoked");
  });

  test("old audit rows are purged by the retention setting; newer ones stay", async () => {
    await set("quick_login_audit_days", "30");
    await db.quickLoginEvent.deleteMany();
    await db.quickLoginEvent.create({ data: { at: new Date("2026-09-01T00:00:00Z"), outcome: "UNKNOWN_CREDENTIAL", method: "NFC" } });
    await db.quickLoginEvent.create({ data: { at: new Date("2026-11-10T00:00:00Z"), outcome: "UNKNOWN_CREDENTIAL", method: "NFC" } });
    assert.equal(await L.purgeOldQuickEvents(new Date(NOW)), 1);
    assert.equal(await db.quickLoginEvent.count(), 1);
  });

  test("the database refuses a credential that is both kinds or neither (CHECK)", async () => {
    const u = await staffUser();
    await assert.rejects(() => db.staffCredential.create({ data: { userId: u.id, kind: "NFC", nfcUid: uid(), qrTokenHash: sha256("x"), createdById: w.admin.id } }));
    await assert.rejects(() => db.staffCredential.create({ data: { userId: u.id, kind: "NFC", createdById: w.admin.id } }));
    await assert.rejects(() => db.staffCredential.create({ data: { userId: u.id, kind: "QR", nfcUid: uid(), createdById: w.admin.id } }));
  });
});
