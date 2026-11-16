import { dbSkip, freezeClock, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PrismaClient } from "@prisma/client";

import { newQrToken, newTerminalToken, sha256 } from "@/lib/quick-login-rules";

/*
 * Staff quick login stays OFF unless an ADMIN switches it on. With it off (the shipped default: no Setting row at all):
 *  - the sign-in screen shows no card panel, the shell shows no "Switch user", a quick session in the cookie is dead on its next request;
 *  - a card tap or QR scan, even a good one on a registered terminal, is refused as DISABLED, writes no counter, and signs nobody in;
 *  - a password sign-in registers no terminal (no cookie, no rows).
 * The first group reads the source (no database needed); the second runs against a throw-away database.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("staff quick login is off by default (source)", () => {
  test("the switch's default is off, it is a toggle, and only the ADMIN settings action writes it", () => {
    // Read as text: importing the settings module here would bind the database client before the test database exists.
    const specs = read("src/lib/settings.ts");
    const spec = specs.slice(specs.indexOf('key: "quick_login_enabled"'));
    assert.match(spec.slice(0, specs.length), /^key: "quick_login_enabled"[\s\S]*?kind: "toggle",\s*fallback: "off",/);
    assert.equal(/^key: "quick_login_enabled"[\s\S]*?\},/.exec(spec)![0].includes('fallback: "on"'), false);
    const actions = read("src/app/(app)/settings/actions.ts");
    assert.equal((actions.match(/requireRole\(\["ADMIN"\]\)/g) ?? []).length >= 2, true, "every settings action is ADMIN only");
    assert.equal(/requireRole\(\[[^\]]*"STAFF"/.test(actions), false);
  });

  test("no migration or seed switches it on", () => {
    for (const p of ["prisma/migrations/20261119000000_staff_quick_login/migration.sql", "prisma/schema.prisma"]) {
      assert.equal(/quick_login_enabled[^\n]*\bon\b[^\n]*(INSERT|VALUES)|INSERT[^\n]*quick_login_enabled/i.test(read(p)), false, p);
    }
  });

  test("the sign-in screen renders the card panel only while the feature is on", () => {
    const page = read("src/app/login/page.tsx");
    assert.match(page, /const quickOn = await getToggle\("quick_login_enabled"\)/);
    assert.match(page, /const registered = quickOn && /);
    assert.match(page, /\{registered && !passwordNeeded && <QuickLoginPanel \/>\}/);
    assert.equal((page.match(/<QuickLoginPanel/g) ?? []).length, 1, "the panel is rendered in one place, behind that gate");
  });

  test("Switch user is offered only to STAFF and only while the feature is on", () => {
    const layout = read("src/app/(app)/layout.tsx");
    assert.match(layout, /canSwitchUser = session\.user\.role === "STAFF" && \(await getToggle\("quick_login_enabled"\)\)/);
  });

  test("a quick session (via nfc / qr) is ended on its next request when the feature is off", () => {
    const auth = read("src/auth.ts");
    const branch = auth.slice(auth.indexOf('token.via === "nfc"'));
    assert.match(branch.slice(0, 600), /!cfg\.enabled/);
  });

  test("the only path from a tap to a session is attemptQuickLogin, and it checks the switch before anything else", () => {
    const lib = read("src/lib/quick-login.ts");
    const body = lib.slice(lib.indexOf("export async function attemptQuickLogin"));
    const firstCheck = body.indexOf("if (!cfg.enabled)");
    assert.ok(firstCheck > 0);
    for (const later of ["db.quickLoginEvent.count", "db.quickLoginTerminal.findUnique", "findCredential(", "db.student.findUnique"]) {
      assert.ok(body.indexOf(later) > firstCheck, `${later} comes after the switch check`);
    }
    assert.match(read("src/app/login/quick-actions.ts"), /signIn\("quick"/);
    assert.equal((read("src/auth.ts").match(/attemptQuickLogin\(/g) ?? []).length, 1, "one caller");
  });
});

describe("staff quick login is off by default (database)", { skip: dbSkip }, () => {
  let db: PrismaClient;
  let handle: TestDatabase;
  let w: World;
  let L: typeof import("@/lib/quick-login");
  let S: typeof import("@/lib/settings");

  before(async () => {
    handle = await openTestDatabase();
    freezeClock("2026-11-16T06:00:00Z");
    ({ db } = await import("@/lib/db"));
    L = await import("@/lib/quick-login");
    S = await import("@/lib/settings");
    w = await seedWorld(db);
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  test("a fresh database has no row for the switch, and reads as off", async () => {
    assert.equal(await db.setting.count({ where: { key: "quick_login_enabled" } }), 0);
    assert.equal(await S.getToggle("quick_login_enabled"), false);
    assert.equal((await L.quickConfig()).enabled, false);
  });

  test("with it off, a good NFC card and a good QR on a registered terminal are refused, sign nobody in and move no counter", async () => {
    const user = await db.user.create({ data: { username: "staff-off", passwordHash: "x", role: "STAFF" } });
    const terminalToken = newTerminalToken();
    const terminal = await db.quickLoginTerminal.create({ data: { tokenHash: sha256(terminalToken), lastSeenAt: new Date() } });
    await db.staffCredential.create({ data: { userId: user.id, kind: "NFC", nfcUid: "04A20001", createdById: w.admin.id } });
    const qr = newQrToken();
    await db.staffCredential.create({ data: { userId: user.id, kind: "QR", qrTokenHash: sha256(qr), createdById: w.admin.id } });

    const taps = [
      await L.attemptQuickLogin({ kind: "NFC", value: "04A20001", terminalToken, ip: "203.0.113.5", userAgent: "t" }),
      await L.attemptQuickLogin({ kind: "QR", value: qr, terminalToken, ip: "203.0.113.5", userAgent: "t" }),
      await L.attemptQuickLogin({ kind: "NFC", value: "04A20001", terminalToken: null, ip: "203.0.113.5", userAgent: "t" }),
    ];
    assert.deepEqual(taps.map((t) => t.outcome), ["DISABLED", "DISABLED", "DISABLED"]);
    assert.equal(taps.some((t) => "user" in t), false, "no user is handed back");
    const t = await db.quickLoginTerminal.findUniqueOrThrow({ where: { id: terminal.id } });
    assert.deepEqual([t.consecutiveQuick, t.failedTaps, t.lockedUntil], [0, 0, null], "a disabled tap moves no counter and never pauses a terminal");
    assert.equal((await db.staffCredential.findFirstOrThrow({ where: { kind: "NFC" } })).lastUsedAt, null);
    assert.deepEqual([...new Set((await db.quickLoginEvent.findMany()).map((e) => e.outcome))], ["DISABLED"]);
  });

  test("with it off, a password sign-in registers no terminal and hands out no cookie", async () => {
    const user = await db.user.findFirstOrThrow({ where: { username: "staff-off" } });
    const before = await db.quickLoginTerminal.count();
    assert.deepEqual(await L.registerTerminalOnPasswordLogin({ terminalToken: null, userId: user.id, ip: null, userAgent: null }), { newToken: null });
    assert.equal(await db.quickLoginTerminal.count(), before);
  });

  test("switched on and off again: taps are refused again at once", async () => {
    const set = (value: string) => db.setting.upsert({ where: { key: "quick_login_enabled" }, update: { value }, create: { key: "quick_login_enabled", value } });
    await set("on");
    assert.equal((await L.quickConfig()).enabled, true, "control: the switch is read");
    await set("off");
    assert.equal((await L.quickConfig()).enabled, false);
    const r = await L.attemptQuickLogin({ kind: "NFC", value: "04A20001", terminalToken: "x", ip: "203.0.113.9", userAgent: "t" });
    assert.equal(r.outcome, "DISABLED");
  });
});
