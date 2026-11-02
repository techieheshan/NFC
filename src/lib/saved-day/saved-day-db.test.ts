import { dbSkip, freezeClock, makeStudent, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient, UserRole } from "@prisma/client";

import { colomboDateValue } from "@/lib/colombo-time";

import { parseSnapshot } from "./snapshot";

/*
 * Daily Summary Release 2, Phase 1: the saved-day actions against a real database (made-up data only). The clock is frozen at
 * 2 Nov 2026, 15:30 in Colombo, so "today" never moves under a test. The real server actions are called with a stubbed session.
 */

const NOW = "2026-11-02T10:00:00Z";
const DAY = "2026-11-01";
const OTHER = "2026-10-31";

type Actions = typeof import("@/app/(app)/daily-summary/saved-actions");

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let A: Actions;
let u: {
  admin2: { id: string };
  staff2: { id: string };
  inactiveStaff: { id: string };
  inactiveAdmin: { id: string };
  teacher: { id: string };
};
let studentId: number;
let xenonTypeId: number;

type BankIn = { time: string; amount: string; slip: string; note: string };
const line = (amount: string, time = "09:15", slip = "", note = ""): BankIn => ({ time, amount, slip, note });

describe("saved days against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    A = await import("@/app/(app)/daily-summary/saved-actions");
    w = await seedWorld(db);
    const mk = (username: string, role: UserRole, active = true) => db.user.create({ data: { username, passwordHash: "x", role, active } });
    u = {
      admin2: await mk("admin-two", "ADMIN"),
      staff2: await mk("staff-two", "STAFF"),
      inactiveStaff: await mk("staff-gone", "STAFF", false),
      inactiveAdmin: await mk("admin-gone", "ADMIN", false),
      teacher: await mk("teacher-login", "TEACHER"),
    };
    studentId = (await makeStudent(db)).id;
    xenonTypeId = (await db.expenseType.create({ data: { code: "XENON", label: "Xenon" } })).id;
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------
  const as = (role: UserRole | null, id = "nobody") => setSession(role, id);
  const admin = () => as("ADMIN", w.admin.id);
  const staff = () => as("STAFF", w.staff.id);

  /** Money in on a Colombo day: one admission payment of `amount` at `paidAtUtc`. */
  const pay = (paidAtUtc: string, amount = "1300.00") =>
    db.payment.create({ data: { kind: "ADMISSION", studentId, amount, takenById: w.staff.id, paidAt: new Date(paidAtUtc) } });
  const spend = (date: string, amount: string, reason = "Paper") =>
    db.expense.create({ data: { expenseTypeId: xenonTypeId, amount, reason, date: colomboDateValue(date), recordedById: w.staff.id, authorizedById: w.admin.id } });

  const cents = (text: string) => Math.round(Number(text) * 100);
  const counts = async () => ({
    days: await db.dailySummaryDay.count(),
    versions: await db.dailySummaryVersion.count(),
    lines: await db.dailySummaryBankLine.count(),
    checks: await db.dailySummaryCheck.count(),
  });
  const world = async () => ({
    payments: await db.payment.count(),
    expenses: await db.expense.count(),
    users: await db.user.count(),
    students: await db.student.count(),
  });

  /** What the Save sheet would show right now for a day (the same loaders the server uses). */
  async function seenFor(date: string) {
    const { dailySummary } = await import("@/lib/reports");
    const r = await dailySummary(date, date);
    return { collected: cents(r.totalCollected), deductions: cents(r.deductions.total) };
  }

  async function save(date: string, doneById: string, over: Record<string, unknown> = {}) {
    return A.saveDay({ date, mode: "save", baseVersion: 0, doneById, bringForward: "", bank: [], seen: await seenFor(date), ...over });
  }
  const edit = (date: string, base: number, doneById: string, over: Record<string, unknown> = {}) =>
    A.saveDay({ date, mode: "edit", baseVersion: base, doneById, bringForward: "", bank: [], ...over });

  const dayRow = (date: string) =>
    db.dailySummaryDay.findUniqueOrThrow({
      where: { date: colomboDateValue(date) },
      include: { versions: { orderBy: { version: "asc" }, include: { bankLines: { orderBy: { position: "asc" } }, check: true } } },
    });

  // A day with some money in and one expense out. Collected 2,600.00 and deductions 1,200.00 on DAY.
  before(async () => {
    await pay("2026-11-01T04:00:00Z");
    await pay("2026-11-01T05:00:00Z");
    await spend(DAY, "1200.00");
  });

  // ---- save v1 ----------------------------------------------------------------
  test("a first save writes the day, version 1, the cash book, the frozen snapshot and the bank deposits", async () => {
    staff();
    const r = await save(DAY, w.admin.id, { bringForward: "5,000.00", bank: [line("1,500.00", "09:15", "SLIP-1", "Peoples"), line("500.00", "10:30")] });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.version, 1);
    assert.equal(r.kind, "SAVE");
    assert.deepEqual(r.changes, [{ t: "saved", by: w.admin.username }]);

    const d = await dayRow(DAY);
    assert.equal(d.currentVersion, 1);
    assert.equal(d.versions.length, 1);
    const v = d.versions[0];
    assert.equal(v.kind, "SAVE");
    assert.deepEqual(
      [v.bringForward, v.collected, v.deductions, v.shouldBeInDrawer, v.bankTotal, v.leftInDrawer, v.net].map((x) => x.toFixed(2)),
      ["5000.00", "2600.00", "1200.00", "6400.00", "2000.00", "4400.00", "1400.00"],
    );
    assert.equal(v.doneById, w.admin.id);
    assert.equal(v.doneByName, w.admin.username);
    assert.equal(v.preparedById, w.admin.id, "the Done by of version 1 is Prepared by");
    assert.equal(v.savedById, w.staff.id, "savedBy is the signed-in user, not Done by");
    assert.equal(v.snapshotSchema, 1);
    assert.equal(v.check, null);
    const snap = parseSnapshot(v.snapshot, v.snapshotSchema);
    assert.equal(snap.report.totalCollected, "2600.00");
    assert.equal(snap.report.deductions.total, "1200.00");
    assert.deepEqual(v.bankLines.map((b) => [b.position, b.time, b.amount.toFixed(2), b.slip, b.note, b.recordedById]), [
      [1, "09:15", "1500.00", "SLIP-1", "Peoples", w.admin.id],
      [2, "10:30", "500.00", "", "", w.admin.id],
    ]);
    assert.ok(v.bankLines.every((b) => b.recordedAt.toISOString() === NOW.replace("Z", ".000Z")));
  });

  // ---- edit v2, v1 untouched, prepared-by ----------------------------------------
  test("an edit writes version 2 and leaves version 1 exactly as it was; the numbers stay FROZEN even though the live data moved", async () => {
    const before = await dayRow(DAY);
    await pay("2026-11-01T06:00:00Z", "700.00"); // live collected is now 3,300.00 ...
    staff();
    const r = await edit(DAY, 1, u.staff2.id, { bringForward: "6,500.00", bank: [line("1,500.00", "09:15", "SLIP-1", "Peoples"), line("500.00", "10:30")] });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.version, 2);
    assert.equal(r.kind, "EDIT");

    const after = await dayRow(DAY);
    assert.equal(after.currentVersion, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(after.versions[0])), JSON.parse(JSON.stringify(before.versions[0])), "version 1 is byte-for-byte what it was");
    const v2 = after.versions[1];
    assert.equal(v2.collected.toFixed(2), "2600.00", "... and the saved collected did not move");
    assert.equal(v2.bringForward.toFixed(2), "6500.00");
    assert.equal(v2.leftInDrawer.toFixed(2), "5900.00");
    assert.deepEqual(v2.snapshot, before.versions[0].snapshot, "the snapshot is copied unchanged");
    assert.equal(v2.doneById, u.staff2.id);
    assert.equal(v2.doneByName, u.staff2.username);
    assert.equal(v2.preparedById, w.admin.id, "Prepared by is carried unchanged from version 1");
    assert.equal(v2.preparedByName, w.admin.username);
    assert.equal(v2.savedById, w.staff.id);
    assert.deepEqual(r.changes.map((c) => c.t), ["edited-by", "bf"]);
    assert.deepEqual(r.changes[1], { t: "bf", from: 500000, to: 650000 });
    await db.payment.deleteMany({ where: { amount: "700.00" } }); // put the day back
  });

  // ---- Done by rules --------------------------------------------------------------
  test("Done by is required and must be an ACTIVE ADMIN or STAFF user, at the first save, every edit and every re-save; refusals write nothing", async () => {
    const day = "2026-10-20";
    await pay("2026-10-20T04:00:00Z");
    staff();
    const first = await save(day, w.staff.id);
    assert.ok(first.ok);
    const base = await counts();
    const bad = ["", "no-such-id", "x".repeat(65), u.inactiveStaff.id, u.inactiveAdmin.id, u.teacher.id];
    for (const doneById of bad) {
      const attempts = [
        await save("2026-10-21", doneById),
        await edit(day, 1, doneById, { bringForward: "1.00" }),
        await A.saveDay({ date: day, mode: "resave", baseVersion: 1, doneById, bringForward: "", bank: [], seen: await seenFor(day) }),
      ];
      for (const r of attempts) {
        assert.equal(r.ok, false, `refused for Done by "${doneById.slice(0, 12)}"`);
        if (!r.ok) {
          assert.ok(r.reason === "done-by" || r.reason === "invalid", r.reason);
          assert.equal(r.values.doneById, doneById.slice(0, 64), "what was submitted comes back");
        }
      }
    }
    assert.deepEqual(await counts(), base, "nothing was written by any refusal");
    let n = 0;
    for (const ok of [w.admin.id, w.staff.id, u.admin2.id, u.staff2.id]) {
      const r = await edit(day, (await dayRow(day)).currentVersion, ok, { bringForward: `${++n}00.00` });
      assert.ok(r.ok, `an active ADMIN or STAFF user is accepted: ${JSON.stringify(r)}`);
    }
  });

  // ---- check only on the current version; C1 -------------------------------------
  test("a check attaches only to the version the person saw; ADMIN or STAFF may tap it; the admin named must be an active ADMIN; both are stored", async () => {
    const day = "2026-10-22";
    await pay("2026-10-22T04:00:00Z");
    staff();
    assert.ok((await save(day, w.staff.id, { bank: [line("100.00")] })).ok);

    // the named person must be an ACTIVE ADMIN, looked up on the server
    for (const id of [w.staff.id, u.staff2.id, u.inactiveAdmin.id, u.teacher.id, "no-such-id", ""]) {
      const r = await A.markChecked({ date: day, baseVersion: 1, checkedById: id });
      assert.equal(r.ok, false);
      if (!r.ok) assert.ok(r.reason === "not-admin" || r.reason === "invalid", r.reason);
    }
    assert.equal(await db.dailySummaryCheck.count({ where: { version: { day: { date: colomboDateValue(day) } } } }), 0);

    staff(); // C1: STAFF may tap Mark as checked
    const r = await A.markChecked({ date: day, baseVersion: 1, checkedById: u.admin2.id });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.checkedByName, u.admin2.username);
    assert.equal(r.markedByName, w.staff.username);
    const c = (await dayRow(day)).versions[0].check!;
    assert.deepEqual([c.checkedById, c.checkedByName, c.markedById, c.markedByName, c.carriedFromVersion], [u.admin2.id, u.admin2.username, w.staff.id, w.staff.username, null]);

    // a second check of the same version is refused
    const again = await A.markChecked({ date: day, baseVersion: 1, checkedById: w.admin.id });
    assert.ok(!again.ok && again.reason === "already-checked");

    // a money change makes version 2 WITHOUT a check; version 1 keeps its own
    admin();
    const e = await edit(day, 1, w.admin.id, { bank: [line("101.00")] });
    assert.ok(e.ok);
    const d = await dayRow(day);
    assert.equal(d.versions[0].check?.checkedById, u.admin2.id, "version 1 keeps its check");
    assert.equal(d.versions[1].check, null);
    // a check that names the old version is refused: it can never attach to numbers the person did not see
    const stale = await A.markChecked({ date: day, baseVersion: 1, checkedById: w.admin.id });
    assert.ok(!stale.ok && stale.reason === "conflict");
    assert.equal(await db.dailySummaryCheck.count({ where: { version: { dayId: d.id } } }), 1);
  });

  test("an admin may name themselves; a check on an unsaved day is refused", async () => {
    admin();
    const none = await A.markChecked({ date: "2026-10-05", baseVersion: 1, checkedById: w.admin.id });
    assert.ok(!none.ok && none.reason === "not-saved");
  });

  // ---- money change clears the check; slip / note / time keeps it -----------------
  async function checkedDay(day: string, opts: { bf?: string; bank?: BankIn[] } = {}) {
    await pay(`${day}T04:00:00Z`);
    staff();
    const r = await save(day, w.staff.id, { bringForward: opts.bf ?? "1,000.00", bank: opts.bank ?? [line("100.00", "09:00", "A", "x"), line("200.00", "10:00")] });
    assert.ok(r.ok, JSON.stringify(r));
    const c = await A.markChecked({ date: day, baseVersion: 1, checkedById: w.admin.id });
    assert.ok(c.ok);
  }
  const newest = async (day: string) => {
    const d = await dayRow(day);
    return d.versions[d.versions.length - 1];
  };

  test("a MONEY change (bring-forward, a bank amount, the number of lines) gives a version with no check, and the log says it was cleared", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["2026-10-01", { bringForward: "1,001.00" }],
      ["2026-10-02", { bank: [line("101.00", "09:00", "A", "x"), line("200.00", "10:00")] }],
      ["2026-10-03", { bank: [line("100.00", "09:00", "A", "x"), line("200.00", "10:00"), line("5.00", "11:00")] }],
      ["2026-10-04", { bank: [line("100.00", "09:00", "A", "x")] }],
    ];
    for (const [day, over] of cases) {
      await checkedDay(day);
      admin();
      const r = await edit(day, 1, w.admin.id, { bringForward: "1,000.00", bank: [line("100.00", "09:00", "A", "x"), line("200.00", "10:00")], ...over });
      assert.ok(r.ok, `${day}: ${JSON.stringify(r)}`);
      assert.equal((await newest(day)).check, null, `${day}: no check on the new version`);
      assert.ok(r.changes.some((c) => c.t === "check-cleared" && c.by === w.admin.username), `${day}: the log says the check was cleared`);
    }
  });

  test("a re-save with new live numbers clears the check; with identical numbers it is refused", async () => {
    const day = "2026-10-06";
    await checkedDay(day);
    admin();
    const same = await A.saveDay({ date: day, mode: "resave", baseVersion: 1, doneById: w.admin.id, bringForward: "", bank: [], seen: await seenFor(day) });
    assert.ok(!same.ok && same.reason === "nothing-changed");
    await pay(`${day}T07:00:00Z`, "450.00"); // a payment arrives after saving
    const r = await A.saveDay({ date: day, mode: "resave", baseVersion: 1, doneById: u.staff2.id, bringForward: "", bank: [], seen: await seenFor(day) });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.kind, "RESAVE_LIVE");
    const v = await newest(day);
    assert.equal(v.check, null);
    assert.equal(v.collected.toFixed(2), "1750.00", "the new live number is frozen");
    assert.equal(v.bringForward.toFixed(2), "1000.00", "a re-save keeps what was typed");
    assert.equal(v.bankLines.length, 2);
    assert.deepEqual(r.changes.map((c) => c.t), ["resaved", "check-cleared"]);
    assert.equal(v.preparedById, w.staff.id, "Prepared by is still version 1's Done by");
  });

  test("an edit of ONLY slip, note or time keeps the check: it is carried over with carriedFromVersion", async () => {
    const day = "2026-10-07";
    await checkedDay(day);
    const original = (await newest(day)).check!;
    admin();
    const r = await edit(day, 1, u.staff2.id, { bringForward: "1,000.00", bank: [line("100.00", "09:30", "B", "y"), line("200.00", "10:00")] });
    assert.ok(r.ok, JSON.stringify(r));
    const v2 = await newest(day);
    assert.ok(v2.check, "the check is kept");
    assert.deepEqual(
      [v2.check.checkedById, v2.check.checkedByName, v2.check.markedById, v2.check.markedByName, v2.check.carriedFromVersion],
      [original.checkedById, original.checkedByName, original.markedById, original.markedByName, 1],
    );
    assert.equal(v2.check.checkedAt.toISOString(), original.checkedAt.toISOString(), "the time of the check is the original");
    assert.deepEqual(r.changes.map((c) => c.t), ["edited-by", "bank~", "check-kept"]);
    // a second slip-only edit carries it on, from version 2
    const r3 = await edit(day, 2, w.admin.id, { bringForward: "1,000.00", bank: [line("100.00", "09:30", "C", "y"), line("200.00", "10:00")] });
    assert.ok(r3.ok);
    assert.equal((await newest(day)).check?.carriedFromVersion, 2);
    // reordering the lines is a change but not a money change
    const r4 = await edit(day, 3, w.admin.id, { bringForward: "1,000.00", bank: [line("200.00", "10:00"), line("100.00", "09:30", "C", "y")] });
    assert.ok(r4.ok);
    assert.ok((await newest(day)).check, "a reorder keeps the check");
  });

  test("a save that changes nothing at all is refused; Done by alone is not a change; nothing is written", async () => {
    const day = "2026-10-08";
    await checkedDay(day);
    const base = await counts();
    admin();
    const same = { bringForward: "1,000.00", bank: [line("100.00", "09:00", "A", "x"), line("200.00", "10:00")] };
    for (const doneById of [w.admin.id, u.staff2.id]) {
      const r = await edit(day, 1, doneById, same);
      assert.ok(!r.ok && r.reason === "nothing-changed" && r.message === "Nothing changed.", JSON.stringify(r));
    }
    assert.deepEqual(await counts(), base);
  });

  // ---- bank recordedBy ------------------------------------------------------------
  test("a bank deposit is recorded by the Done by of the version that ADDED it; a kept or edited line keeps its recorder and time", async () => {
    const day = "2026-10-09";
    await pay(`${day}T04:00:00Z`);
    staff();
    assert.ok((await save(day, w.admin.id, { bank: [line("100.00", "09:00", "A"), line("200.00", "10:00", "B")] })).ok);
    const t1 = (await newest(day)).bankLines[0].recordedAt.toISOString();
    freezeClock("2026-11-02T11:00:00Z"); // an hour later
    admin();
    const r = await edit(day, 1, u.staff2.id, { bank: [line("100.00", "09:00", "A"), line("200.00", "10:45", "B2"), line("300.00", "11:00", "C")] });
    freezeClock(NOW);
    assert.ok(r.ok, JSON.stringify(r));
    const lines = (await newest(day)).bankLines;
    assert.deepEqual(lines.map((l) => [l.amount.toFixed(2), l.recordedById]), [["100.00", w.admin.id], ["200.00", w.admin.id], ["300.00", u.staff2.id]]);
    assert.equal(lines[0].recordedAt.toISOString(), t1, "a kept line keeps its time");
    assert.equal(lines[1].recordedAt.toISOString(), t1, "an edited line keeps its time");
    assert.equal(lines[2].recordedAt.toISOString(), "2026-11-02T11:00:00.000Z", "a new line gets this version's time");
  });

  // ---- one day per date -----------------------------------------------------------
  test("one saved day per date: a second first-save is a conflict that names who saved first, and the database refuses a duplicate", async () => {
    const day = "2026-10-10";
    await pay(`${day}T04:00:00Z`);
    staff();
    assert.ok((await save(day, w.admin.id)).ok);
    const base = await counts();
    const second = await save(day, u.staff2.id);
    assert.ok(!second.ok && second.reason === "conflict");
    if (!second.ok) {
      assert.equal(second.current?.version, 1);
      assert.equal(second.current?.doneByName, w.admin.username);
      assert.match(second.message, new RegExp(`${w.admin.username} saved this day`));
    }
    assert.deepEqual(await counts(), base);
    await assert.rejects(() => db.dailySummaryDay.create({ data: { date: colomboDateValue(day), currentVersion: 1 } }), /Unique constraint/);
  });

  test("a stale version number is a conflict: the second person's edit is not saved and sees who changed the day", async () => {
    const day = "2026-10-11";
    await pay(`${day}T04:00:00Z`);
    staff();
    assert.ok((await save(day, w.admin.id)).ok);
    assert.ok((await edit(day, 1, w.admin.id, { bringForward: "10.00" })).ok);
    const base = await counts();
    const late = await edit(day, 1, u.staff2.id, { bringForward: "99.00", bank: [line("5.00")] });
    assert.ok(!late.ok && late.reason === "conflict");
    if (!late.ok) {
      assert.equal(late.current?.version, 2);
      assert.deepEqual(late.values.bringForward, "99.00", "what the second person typed comes back (rule 14)");
      assert.equal(late.values.bank.length, 1);
    }
    assert.deepEqual(await counts(), base);
  });

  // ---- refusals ---------------------------------------------------------------
  test("a stale 'seen' is refused with the figures as they are now; a payment arriving after the sheet opened is caught; nothing is written", async () => {
    const day = "2026-10-12";
    await pay(`${day}T04:00:00Z`);
    staff();
    const seen = await seenFor(day);
    await pay(`${day}T05:00:00Z`); // arrives while the sheet is open
    const base = await counts();
    const r = await A.saveDay({ date: day, mode: "save", baseVersion: 0, doneById: w.admin.id, bringForward: "", bank: [], seen });
    assert.ok(!r.ok && r.reason === "numbers-moved");
    if (!r.ok) assert.deepEqual(r.fresh, { collected: 260000, deductions: 0 });
    assert.deepEqual(await counts(), base);
    assert.ok((await save(day, w.admin.id)).ok, "with the new figures it saves");
  });

  test("a save or re-save without 'seen' is refused; the client's numbers are never what is stored", async () => {
    const day = "2026-10-13";
    await pay(`${day}T04:00:00Z`);
    staff();
    const base = await counts();
    const r = await A.saveDay({ date: day, mode: "save", baseVersion: 0, doneById: w.admin.id, bringForward: "", bank: [] });
    assert.ok(!r.ok && r.reason === "invalid");
    const lie = await A.saveDay({ date: day, mode: "save", baseVersion: 0, doneById: w.admin.id, bringForward: "", bank: [], seen: { collected: 999999999, deductions: 0 } });
    assert.ok(!lie.ok && lie.reason === "numbers-moved");
    assert.deepEqual(await counts(), base);
    const ok = await save(day, w.admin.id, { collected: 5, snapshot: { report: "forged" }, net: 1 });
    assert.ok(ok.ok);
    assert.equal((await newest(day)).collected.toFixed(2), "1300.00", "stored from the server's own read, whatever else the request carried");
  });

  test("banking more than the drawer holds is refused; a negative Left with nothing banked is saved", async () => {
    staff();
    const base = await counts();
    const over = await save("2026-10-14", w.admin.id, { bank: [line("99,999.00")] });
    assert.ok(!over.ok && over.reason === "over-bank");
    assert.deepEqual(await counts(), base);
    await spend("2026-10-15", "5000.00", "Big spend"); // deductions with no money in
    const neg = await save("2026-10-15", w.admin.id);
    assert.ok(neg.ok);
    assert.equal((await newest("2026-10-15")).leftInDrawer.toFixed(2), "-5000.00");
  });

  test("an edit that would leave the bank over the drawer is refused too (frozen numbers)", async () => {
    const day = "2026-10-16";
    await pay(`${day}T04:00:00Z`);
    staff();
    assert.ok((await save(day, w.admin.id)).ok);
    const base = await counts();
    const r = await edit(day, 1, w.admin.id, { bank: [line("5,000.00")] });
    assert.ok(!r.ok && r.reason === "over-bank");
    assert.deepEqual(await counts(), base);
  });

  test("a future day, an impossible date and junk input are refused and write nothing", async () => {
    staff();
    const base = await counts();
    for (const date of ["2026-11-03", "2026-02-30", "not-a-date", "", "2026-13-01"]) {
      const r = await A.saveDay({ date, mode: "save", baseVersion: 0, doneById: w.admin.id, bringForward: "", bank: [], seen: { collected: 0, deductions: 0 } });
      assert.equal(r.ok, false, date);
      if (!r.ok) assert.ok(r.reason === "date" || r.reason === "invalid");
    }
    for (const junk of [null, undefined, 5, "x", [], {}, { date: DAY }]) {
      const r = await A.saveDay(junk);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(typeof r.values.date, "string");
    }
    assert.deepEqual(await counts(), base, "none of them wrote anything");
  });

  // ---- Colombo edges ----------------------------------------------------------
  test("Colombo-day edges: 23:59:59 belongs to its day and 00:00:00 to the next, in the saved day and in the comparison", async () => {
    const day = "2026-09-10";
    await pay("2026-09-10T18:29:59Z"); // 23:59:59 on 10 Sep in Colombo
    await pay("2026-09-10T18:30:00Z"); // 00:00:00 on 11 Sep
    staff();
    const r = await save(day, w.admin.id);
    assert.ok(r.ok);
    assert.equal((await newest(day)).collected.toFixed(2), "1300.00", "only the 23:59:59 payment is on the 10th");
    const view = await A.loadSavedDay(day);
    assert.deepEqual(view.liveDiffs, [], "the 00:00:00 payment is not a difference on the 10th");
    await pay("2026-09-10T18:29:59Z", "100.00");
    const after = await A.loadSavedDay(day);
    assert.ok(after.liveDiffs.some((d) => d.key === "totalCollected"));
    // the 11th is its own day with its own 00:00:00 payment
    assert.equal((await A.loadSavedDay("2026-09-11")).saved, null);
  });

  // ---- reads ------------------------------------------------------------------
  test("loadSavedDay: the saved day with its log, bank deposits (with recorders) and the check; an unsaved day is null", async () => {
    const day = "2026-10-17";
    await pay(`${day}T04:00:00Z`);
    staff();
    assert.ok((await save(day, w.admin.id, { bringForward: "50.00", bank: [line("10.00", "08:00", "S", "n")] })).ok);
    assert.ok((await A.markChecked({ date: day, baseVersion: 1, checkedById: u.admin2.id })).ok);
    assert.ok((await edit(day, 1, u.staff2.id, { bringForward: "60.00", bank: [line("10.00", "08:00", "S", "n")] })).ok);
    const v = await A.loadSavedDay(day);
    assert.ok(v.saved);
    assert.equal(v.saved.version, 2);
    assert.equal(v.saved.cash.bringForward, 6000);
    assert.equal(v.saved.check, null, "the money changed: version 2 is not checked");
    assert.deepEqual(v.saved.log.map((l) => [l.version, l.kind, l.doneByName]), [[1, "SAVE", w.admin.username], [2, "EDIT", u.staff2.username]]);
    assert.deepEqual(v.saved.bank.map((b) => [b.cents, b.recordedByName]), [[1000, w.admin.username]]);
    assert.equal(v.saved.preparedBy.name, w.admin.username);
    assert.equal(v.saved.doneBy.name, u.staff2.username);
    assert.equal(v.saved.savedByName, w.staff.username);
    assert.deepEqual(v.liveDiffs, []);
    assert.equal((await A.loadSavedDay("2026-10-18")).saved, null);
    assert.equal((await A.loadSavedDay("garbage")).date, "2026-11-02", "an unusable date reads as today (a read never throws)");
  });

  test("a receipt cancelled after saving shows up as a difference with saved and live figures", async () => {
    const day = "2026-10-19";
    const p = await pay(`${day}T04:00:00Z`);
    await pay(`${day}T05:00:00Z`);
    staff();
    assert.ok((await save(day, w.admin.id)).ok);
    await db.payment.update({ where: { id: p.id }, data: { cancelled: true, cancelledById: w.admin.id, cancelledAt: new Date(NOW), cancelReason: "test" } });
    const v = await A.loadSavedDay(day);
    const total = v.liveDiffs.find((d) => d.key === "totalCollected");
    assert.deepEqual([total?.saved, total?.live], ["2,600.00", "1,300.00"]);
    assert.ok(v.liveDiffs.some((d) => d.key === "cancelled.receipts"));
    assert.equal((await newest(day)).collected.toFixed(2), "2600.00", "the saved version never changes");
  });

  test("the bring-forward hint: yesterday's saved Left in drawer, or the newest saved day within 7 days with its date; none when too old, unsaved, or already typed", async () => {
    const src = "2026-08-10";
    await pay(`${src}T04:00:00Z`);
    staff();
    assert.ok((await save(src, w.admin.id, { bank: [line("300.00")] })).ok); // collected 1,300.00, banked 300.00: Left 1,000.00
    const next = (await A.loadSavedDay("2026-08-11")).hint;
    assert.deepEqual(next && [next.date, next.leftCents, next.checked, next.daysAgo], [src, 100000, false, 1]);
    assert.ok((await A.markChecked({ date: src, baseVersion: 1, checkedById: w.admin.id })).ok);
    assert.equal((await A.loadSavedDay("2026-08-11")).hint?.checked, true);
    const gap = (await A.loadSavedDay("2026-08-14")).hint; // an older saved day, named by its own date
    assert.deepEqual(gap && [gap.date, gap.daysAgo], [src, 4]);
    assert.equal((await A.loadSavedDay("2026-08-17")).hint?.daysAgo, 7, "exactly 7 days back is still offered");
    assert.equal((await A.loadSavedDay("2026-08-18")).hint, null, "8 days is too old");
    assert.equal((await A.loadSavedDay(src)).hint, null, "a day never hints itself");
    // a saved day that already has a bring-forward gets no hint
    assert.equal((await A.loadSavedDay(DAY)).saved?.cash.bringForward, 650000);
    assert.equal((await A.loadSavedDay(DAY)).hint, null);
  });

  test("loadHistory: one month, newest first, with Collected, Net, version, who and the check; junk months mean the current month", async () => {
    staff();
    const h = await A.loadHistory("2026-10");
    assert.equal(h.month, "2026-10");
    const dates = h.rows.map((r) => r.date);
    assert.deepEqual(dates, [...dates].sort().reverse(), "newest first");
    assert.ok(dates.every((d) => d.startsWith("2026-10")), "no other month");
    const row = h.rows.find((r) => r.date === "2026-10-22")!;
    assert.deepEqual([row.version, row.doneByName, row.collected, row.net, row.checked], [2, w.admin.username, 130000, 130000, false]);
    for (const junk of ["", "2026-13", "9999-01", "1999-12", "x", null, undefined, 5, "2026-1"]) assert.equal((await A.loadHistory(junk)).month, "2026-11", `junk ${String(junk)}`);
  });

  // ---- retention ---------------------------------------------------------------
  test("retention: after a save and when History opens, days older than 3 months are deleted with their versions, deposits and checks; the boundary day and everything else stay", async () => {
    freezeClock("2026-08-05T06:00:00Z"); // saved 'back then'; the cutoff then is 5 May
    staff();
    for (const day of ["2026-08-01", "2026-08-02", "2026-07-15"]) {
      await pay(`${day}T04:00:00Z`);
      const r = await save(day, w.admin.id, { bank: [line("100.00")] });
      assert.ok(r.ok, `${day}: ${JSON.stringify(r)}`);
      assert.ok((await A.markChecked({ date: day, baseVersion: 1, checkedById: w.admin.id })).ok);
    }
    freezeClock(NOW); // today is 2 Nov: the cutoff is 2 Aug
    const before = { ...(await world()), ...(await counts()) };
    const h = await A.loadHistory("2026-11");
    assert.equal(h.purged, 2, "1 Aug and 15 Jul are older than the cutoff");
    const left = await db.dailySummaryDay.findMany({ where: { date: { gte: colomboDateValue("2026-07-01"), lt: colomboDateValue("2026-08-05") } }, select: { date: true } });
    assert.deepEqual(left.map((d) => d.date.toISOString().slice(0, 10)), ["2026-08-02"], "exactly three months old is kept");
    const after = { ...(await world()), ...(await counts()) };
    assert.equal(after.days, before.days - 2);
    assert.equal(after.versions, before.versions - 2, "their versions went with them");
    assert.equal(after.lines, before.lines - 2, "... and their bank deposits");
    assert.equal(after.checks, before.checks - 2, "... and their checks");
    assert.deepEqual([after.payments, after.expenses, after.users, after.students], [before.payments, before.expenses, before.users, before.students], "payments, expenses, users and students are untouched");
    // the live Daily Summary of an expired day is still there (it is computed from payments), and the day reads as unsaved
    assert.equal((await A.loadSavedDay("2026-08-01")).saved, null);
    // a second run has nothing to do
    assert.equal((await A.loadHistory("2026-11")).purged, 0);
  });

  test("a save purges too, as a separate statement after it committed", async () => {
    freezeClock("2026-08-05T06:00:00Z"); // then the cutoff is 5 May: a day from 10 May is fine
    staff();
    await pay("2026-05-10T04:00:00Z");
    assert.ok((await save("2026-05-10", w.admin.id)).ok);
    freezeClock(NOW); // now the cutoff is 2 Aug: that day is expired
    await pay("2026-11-02T04:00:00Z");
    const before = await db.dailySummaryDay.count();
    const r = await save("2026-11-02", w.admin.id, { doneById: w.staff.id });
    assert.ok(r.ok, `saving TODAY is allowed: ${JSON.stringify(r)}`);
    assert.equal(r.date, "2026-11-02");
    assert.equal(r.purged, 1, "the save removed the one expired day");
    assert.equal(await db.dailySummaryDay.count(), before, "one added, one removed");
    assert.equal((await A.loadSavedDay("2026-05-10")).saved, null);
  });

  test("a day already older than 3 months cannot be saved (it would be purged a moment later)", async () => {
    staff();
    await pay("2026-07-31T04:00:00Z");
    const base = await counts();
    const r = await save("2026-07-31", w.admin.id);
    assert.ok(!r.ok && r.reason === "date");
    if (!r.ok) assert.match(r.message, /kept for 3 months/);
    assert.deepEqual(await counts(), base);
  });

  test("a purge that FAILS never breaks the save or the page: it is logged, ignored and retried next time", async () => {
    // plant an expired day (saved 'back then'), then make deleting a day fail inside the database
    freezeClock("2026-08-05T06:00:00Z");
    staff();
    await pay("2026-05-12T04:00:00Z");
    assert.ok((await save("2026-05-12", w.admin.id)).ok);
    freezeClock(NOW);
    await db.$executeRawUnsafe(`CREATE FUNCTION ds_test_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'purge exploded'; END $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER ds_test_fail BEFORE DELETE ON "DailySummaryDay" FOR EACH ROW EXECUTE FUNCTION ds_test_fail()`);
    const errors: unknown[] = [];
    const logged = mock.method(console, "error", (...a: unknown[]) => { errors.push(a); });
    try {
      const day = "2026-10-23";
      await pay(`${day}T04:00:00Z`);
      const r = await save(day, w.admin.id);
      assert.ok(r.ok, "the save itself succeeded");
      assert.equal(r.purged, 0);
      const h = await A.loadHistory("2026-10");
      assert.ok(h.rows.some((x) => x.date === day), "the page loads");
      assert.equal(h.purged, 0);
      assert.equal(errors.length, 2, "both failures were logged");
      assert.ok((await A.loadSavedDay("2026-05-12")).saved, "the expired day is still there: nothing was half-deleted");
    } finally {
      logged.mock.restore();
      await db.$executeRawUnsafe(`DROP TRIGGER ds_test_fail ON "DailySummaryDay"`);
      await db.$executeRawUnsafe(`DROP FUNCTION ds_test_fail()`);
    }
    assert.equal((await A.loadHistory("2026-10")).purged, 1, "the next History open retries and succeeds");
    assert.equal((await A.loadSavedDay("2026-05-12")).saved, null);
  });

  // ---- the version of a day is immutable -------------------------------------------
  test("every save leaves older versions exactly as they were (immutability across a long history)", async () => {
    const day = "2026-10-24";
    await pay(`${day}T04:00:00Z`);
    staff();
    assert.ok((await save(day, w.admin.id)).ok);
    const snapshots: string[] = [];
    for (let i = 1; i <= 4; i++) {
      snapshots.push(JSON.stringify((await dayRow(day)).versions));
      const r = await edit(day, i, w.admin.id, { bringForward: `${i}00.00` });
      assert.ok(r.ok, JSON.stringify(r));
      const d = await dayRow(day);
      assert.equal(JSON.stringify(d.versions.slice(0, i)), snapshots[i - 1], `versions 1..${i} are untouched by version ${i + 1}`);
      assert.equal(d.currentVersion, i + 1);
    }
  });

  test("the cash book columns always agree with the frozen snapshot and the deposits (Decimal(12,2), integer cents)", async () => {
    const day = "2026-10-25";
    await pay(`${day}T04:00:00Z`, "99999999.99");
    await spend(day, "0.01");
    staff();
    const r = await save(day, w.admin.id, { bringForward: "99,999,999.99", bank: [line("12,345.67"), line("0.01")] });
    assert.ok(r.ok, JSON.stringify(r));
    const v = await newest(day);
    const snap = parseSnapshot(v.snapshot, v.snapshotSchema);
    const lines = v.bankLines.reduce((s, b) => s + cents(b.amount.toFixed(2)), 0);
    assert.equal(cents(v.bankTotal.toFixed(2)), lines);
    assert.equal(cents(v.shouldBeInDrawer.toFixed(2)), cents(v.bringForward.toFixed(2)) + cents(snap.report.totalCollected) - cents(snap.report.deductions.total));
    assert.equal(cents(v.leftInDrawer.toFixed(2)), cents(v.shouldBeInDrawer.toFixed(2)) - lines);
    assert.equal(v.bringForward.toFixed(2), "99999999.99");
  });
});
