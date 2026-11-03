import { dbSkip, freezeClock, makeStudent, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient, UserRole } from "@prisma/client";

import { colomboDateValue } from "@/lib/colombo-time";
import { shiftDay } from "@/lib/daily-summary-dates";

import { overBankedBanner, overBankRefusal } from "./over-bank";
import { UNREADABLE_DAY } from "./texts";
import { parseSnapshot } from "./snapshot";

/*
 * Daily Summary Release 2: the saved-day actions against a real database (made-up data only). The clock is frozen at 2 Nov 2026,
 * 15:30 in Colombo. The real server actions are called with a stubbed session.
 *
 * EVERY TEST BUILDS ITS OWN DATA (its own day, its own money): none depends on what another test left behind, so each one passes
 * when it is run alone (`--test-name-pattern`). Tests that move the clock restore it in a `finally`.
 */

const NOW = "2026-11-02T10:00:00Z";

type Actions = typeof import("@/app/(app)/daily-summary/saved-actions");
type Store = typeof import("@/lib/saved-day/store");

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let A: Actions;
let ST: Store;
let u: {
  admin2: { id: string; username: string };
  staff2: { id: string; username: string };
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
    ST = await import("@/lib/saved-day/store");
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

  /** Runs `fn` with the clock somewhere else and ALWAYS puts it back. */
  async function withClock<T>(iso: string, fn: () => Promise<T>): Promise<T> {
    freezeClock(iso);
    try {
      return await fn();
    } finally {
      freezeClock(NOW);
    }
  }

  /** A fresh Colombo day with its own money in (and one expense out, when asked). Dates 27 Aug .. 1 Nov never repeat within a file (the explicit dates in the tests below stay clear of them). */
  let dayCounter = 0;
  async function makeDay(o: { pays?: string[]; spend?: string } = {}): Promise<string> {
    const date = shiftDay("2026-08-27", dayCounter++);
    for (const [i, amount] of (o.pays ?? ["1300.00"]).entries()) {
      await db.payment.create({ data: { kind: "ADMISSION", studentId, amount, takenById: w.staff.id, paidAt: new Date(`${date}T0${4 + i}:00:00Z`) } });
    }
    if (o.spend) await db.expense.create({ data: { expenseTypeId: xenonTypeId, amount: o.spend, reason: "Paper", date: colomboDateValue(date), recordedById: w.staff.id, authorizedById: w.admin.id } });
    return date;
  }

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
  async function resave(date: string, base: number, doneById: string) {
    return A.saveDay({ date, mode: "resave", baseVersion: base, doneById, bringForward: "", bank: [], seen: await seenFor(date) });
  }

  const dayRow = (date: string) =>
    db.dailySummaryDay.findUniqueOrThrow({
      where: { date: colomboDateValue(date) },
      include: { versions: { orderBy: { version: "asc" }, include: { bankLines: { orderBy: { position: "asc" } }, check: true } } },
    });
  const newest = async (date: string) => {
    const d = await dayRow(date);
    return d.versions[d.versions.length - 1];
  };
  const check = (date: string, base: number, checkedById: string) => A.markChecked({ date, baseVersion: base, checkedById });

  /** A day saved by `staff()` (Done by: the admin), optionally checked by the admin. */
  async function savedDay(o: { pays?: string[]; spend?: string; bf?: string; bank?: BankIn[]; checked?: boolean } = {}) {
    const date = await makeDay(o);
    staff();
    const r = await save(date, w.admin.id, { bringForward: o.bf ?? "", bank: o.bank ?? [] });
    assert.ok(r.ok, JSON.stringify(r));
    if (o.checked) assert.ok((await check(date, 1, w.admin.id)).ok);
    return date;
  }

  /** Makes a DELETE (or INSERT) on a table fail or misbehave inside the database, for the length of `fn`. */
  async function withTrigger<T>(name: string, when: "BEFORE DELETE" | "BEFORE INSERT", table: string, body: string, fn: () => Promise<T>): Promise<T> {
    await db.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger AS $$ BEGIN ${body} END $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER ${name} ${when} ON "${table}" FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    try {
      return await fn();
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER ${name} ON "${table}"`);
      await db.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
    }
  }

  // ---- save v1 ----------------------------------------------------------------
  test("a first save writes the day, version 1, the cash book, the frozen snapshot and the bank deposits", async () => {
    const day = await makeDay({ pays: ["1300.00", "1300.00"], spend: "1200.00" });
    staff();
    const r = await save(day, w.admin.id, { bringForward: "5,000.00", bank: [line("1,500.00", "09:15", "SLIP-1", "Peoples"), line("500.00", "10:30")] });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.version, 1);
    assert.equal(r.kind, "SAVE");
    assert.deepEqual(r.changes, [{ t: "saved", by: w.admin.username }]);

    const d = await dayRow(day);
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
    const day = await savedDay({ pays: ["1300.00", "1300.00"], spend: "1200.00", bf: "5,000.00", bank: [line("1,500.00", "09:15", "SLIP-1", "Peoples"), line("500.00", "10:30")] });
    const before = await dayRow(day);
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "700.00", takenById: w.staff.id, paidAt: new Date(`${day}T08:00:00Z`) } }); // live collected is now 3,300.00
    staff();
    const r = await edit(day, 1, u.staff2.id, { bringForward: "6,500.00", bank: [line("1,500.00", "09:15", "SLIP-1", "Peoples"), line("500.00", "10:30")] });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.version, 2);
    assert.equal(r.kind, "EDIT");

    const after = await dayRow(day);
    assert.equal(after.currentVersion, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(after.versions[0])), JSON.parse(JSON.stringify(before.versions[0])), "version 1 is byte-for-byte what it was");
    const v2 = after.versions[1];
    assert.equal(v2.collected.toFixed(2), "2600.00", "... and the saved collected did not move");
    assert.equal(v2.bringForward.toFixed(2), "6500.00");
    assert.equal(cents(v2.leftInDrawer.toFixed(2)), 650000 + 260000 - 120000 - 200000);
    assert.deepEqual(v2.snapshot, before.versions[0].snapshot, "the snapshot is copied unchanged");
    assert.equal(v2.doneById, u.staff2.id);
    assert.equal(v2.doneByName, u.staff2.username);
    assert.equal(v2.preparedById, w.admin.id, "Prepared by is carried unchanged from version 1");
    assert.equal(v2.preparedByName, w.admin.username);
    assert.equal(v2.savedById, w.staff.id);
    assert.equal(v2.snapshotSchema, before.versions[0].snapshotSchema);
    assert.deepEqual(r.changes.map((c) => c.t), ["edited-by", "bf"]);
    assert.deepEqual(r.changes[1], { t: "bf", from: 500000, to: 650000 });
  });

  // ---- Done by rules --------------------------------------------------------------
  test("Done by is required and must be an ACTIVE ADMIN or STAFF user, at the first save, every edit and every re-save; refusals write nothing", async () => {
    const day = await savedDay();
    const other = await makeDay();
    const base = await counts();
    const bad = ["", "no-such-id", "x".repeat(65), u.inactiveStaff.id, u.inactiveAdmin.id, u.teacher.id];
    for (const doneById of bad) {
      const attempts = [await save(other, doneById), await edit(day, 1, doneById, { bringForward: "1.00" }), await resave(day, 1, doneById)];
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
    const day = await savedDay({ bank: [line("100.00")] });
    for (const id of [w.staff.id, u.staff2.id, u.inactiveAdmin.id, u.teacher.id, "no-such-id", ""]) {
      const r = await check(day, 1, id);
      assert.equal(r.ok, false);
      if (!r.ok) assert.ok(r.reason === "not-admin" || r.reason === "invalid", r.reason);
    }
    assert.equal(await db.dailySummaryCheck.count({ where: { version: { day: { date: colomboDateValue(day) } } } }), 0);

    staff(); // C1: STAFF may tap Mark as checked
    const r = await check(day, 1, u.admin2.id);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.checkedByName, u.admin2.username);
    assert.equal(r.markedByName, w.staff.username);
    const c = (await dayRow(day)).versions[0].check!;
    assert.deepEqual([c.checkedById, c.checkedByName, c.markedById, c.markedByName, c.carriedFromVersion], [u.admin2.id, u.admin2.username, w.staff.id, w.staff.username, null]);

    const again = await check(day, 1, w.admin.id);
    assert.ok(!again.ok && again.reason === "already-checked");

    admin();
    assert.ok((await edit(day, 1, w.admin.id, { bank: [line("101.00")] })).ok);
    const d = await dayRow(day);
    assert.equal(d.versions[0].check?.checkedById, u.admin2.id, "version 1 keeps its check");
    assert.equal(d.versions[1].check, null);
    const stale = await check(day, 1, w.admin.id);
    assert.ok(!stale.ok && stale.reason === "conflict");
    assert.equal(await db.dailySummaryCheck.count({ where: { version: { dayId: d.id } } }), 1);
  });

  test("a check on a day that was never saved is refused", async () => {
    const day = await makeDay();
    admin();
    const none = await check(day, 1, w.admin.id);
    assert.ok(!none.ok && none.reason === "not-saved");
  });

  // ---- A2: markChecked echoes the selected admin ------------------------------------
  test("A2: every markChecked outcome, success or refusal, echoes the selected checkedById (rule 14)", async () => {
    const day = await savedDay();
    const unsaved = await makeDay();
    admin();
    const outcomes = [
      await check(day, 1, "not-an-admin-id"), // not-admin
      await check(day, 1, w.staff.id), // not-admin
      await check(unsaved, 1, w.admin.id), // not-saved
      await check(day, 9, w.admin.id), // conflict
      await A.markChecked({ date: "garbage", baseVersion: 1, checkedById: u.admin2.id }), // invalid
      await A.markChecked(null), // invalid, nothing to echo
      await check(day, 1, w.admin.id), // ok
      await check(day, 1, u.admin2.id), // already-checked
    ];
    assert.deepEqual(outcomes.map((o) => o.ok), [false, false, false, false, false, false, true, false]);
    assert.deepEqual(outcomes.map((o) => o.values.checkedById), ["not-an-admin-id", w.staff.id, w.admin.id, w.admin.id, u.admin2.id, "", w.admin.id, u.admin2.id]);
    assert.deepEqual(outcomes.map((o) => (o.ok ? "ok" : o.reason)), ["not-admin", "not-admin", "not-saved", "conflict", "invalid", "invalid", "ok", "already-checked"]);
    const long = await A.markChecked({ date: day, baseVersion: 1, checkedById: "z".repeat(200) });
    assert.equal(long.values.checkedById.length, 64, "an overlong id is echoed cut to what the form can hold");
  });

  // ---- money change clears the check; slip / note / time keeps it -----------------
  test("a MONEY change (bring-forward, a bank amount, the number of lines) gives a version with no check, and the log says it was cleared", async () => {
    const base = [line("100.00", "09:00", "A", "x"), line("200.00", "10:00")];
    const cases: [string, Record<string, unknown>][] = [
      ["bring-forward", { bringForward: "1,001.00" }],
      ["a bank amount", { bank: [line("101.00", "09:00", "A", "x"), line("200.00", "10:00")] }],
      ["a new bank line", { bank: [...base, line("5.00", "11:00")] }],
      ["a removed bank line", { bank: [line("100.00", "09:00", "A", "x")] }],
    ];
    for (const [what, over] of cases) {
      const day = await savedDay({ pays: ["1300.00"], bf: "1,000.00", bank: base, checked: true });
      admin();
      const r = await edit(day, 1, w.admin.id, { bringForward: "1,000.00", bank: base, ...over });
      assert.ok(r.ok, `${what}: ${JSON.stringify(r)}`);
      assert.equal((await newest(day)).check, null, `${what}: no check on the new version`);
      assert.ok(r.changes.some((c) => c.t === "check-cleared" && c.by === w.admin.username), `${what}: the log says the check was cleared`);
    }
  });

  test("a re-save with new live numbers clears the check; with identical numbers it is refused", async () => {
    const day = await savedDay({ bf: "1,000.00", bank: [line("100.00"), line("200.00", "10:00")], checked: true });
    admin();
    const same = await resave(day, 1, w.admin.id);
    assert.ok(!same.ok && same.reason === "nothing-changed");
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "450.00", takenById: w.staff.id, paidAt: new Date(`${day}T07:00:00Z`) } });
    const r = await resave(day, 1, u.staff2.id);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.kind, "RESAVE_LIVE");
    const v = await newest(day);
    assert.equal(v.check, null);
    assert.equal(v.collected.toFixed(2), "1750.00", "the new live number is frozen");
    assert.equal(v.bringForward.toFixed(2), "1000.00", "a re-save keeps what was typed");
    assert.equal(v.bankLines.length, 2);
    assert.deepEqual(r.changes.map((c) => c.t), ["resaved", "check-cleared"]);
    assert.equal(v.preparedById, w.admin.id, "Prepared by is still version 1's Done by");
  });

  test("an edit of ONLY slip, note or time keeps the check: it is carried over with carriedFromVersion and its own time", async () => {
    const day = await savedDay({ bf: "1,000.00", bank: [line("100.00", "09:00", "A", "x"), line("200.00", "10:00")], checked: true });
    const original = (await newest(day)).check!;
    admin();
    const r = await withClock("2026-11-02T12:00:00Z", () => edit(day, 1, u.staff2.id, { bringForward: "1,000.00", bank: [line("100.00", "09:30", "B", "y"), line("200.00", "10:00")] }));
    assert.ok(r.ok, JSON.stringify(r));
    const v2 = await newest(day);
    assert.ok(v2.check, "the check is kept");
    assert.deepEqual(
      [v2.check.checkedById, v2.check.checkedByName, v2.check.markedById, v2.check.markedByName, v2.check.carriedFromVersion],
      [original.checkedById, original.checkedByName, original.markedById, original.markedByName, 1],
    );
    assert.equal(v2.check.checkedAt.toISOString(), original.checkedAt.toISOString(), "the time of the check is the original");
    assert.deepEqual(r.changes.map((c) => c.t), ["edited-by", "bank~", "check-kept"]);
    const r3 = await edit(day, 2, w.admin.id, { bringForward: "1,000.00", bank: [line("100.00", "09:30", "C", "y"), line("200.00", "10:00")] });
    assert.ok(r3.ok);
    assert.equal((await newest(day)).check?.carriedFromVersion, 2);
    const r4 = await edit(day, 3, w.admin.id, { bringForward: "1,000.00", bank: [line("200.00", "10:00"), line("100.00", "09:30", "C", "y")] });
    assert.ok(r4.ok);
    assert.ok((await newest(day)).check, "a reorder keeps the check");
  });

  test("a save that changes nothing at all is refused; Done by alone is not a change; nothing is written", async () => {
    const same = { bringForward: "1,000.00", bank: [line("100.00", "09:00", "A", "x"), line("200.00", "10:00")] };
    const day = await savedDay({ bf: same.bringForward, bank: same.bank, checked: true });
    const base = await counts();
    admin();
    for (const doneById of [w.admin.id, u.staff2.id]) {
      const r = await edit(day, 1, doneById, same);
      assert.ok(!r.ok && r.reason === "nothing-changed" && r.message === "Nothing changed.", JSON.stringify(r));
    }
    assert.deepEqual(await counts(), base);
  });

  // ---- bank recordedBy (A8) ---------------------------------------------------------
  test("a bank deposit is recorded by the Done by of the version that ADDED it; a kept or edited line keeps its recorder and time", async () => {
    const day = await makeDay();
    staff();
    assert.ok((await save(day, w.admin.id, { bank: [line("100.00", "09:00", "A"), line("200.00", "10:00", "B")] })).ok);
    const t1 = (await newest(day)).bankLines[0].recordedAt.toISOString();
    admin();
    const r = await withClock("2026-11-02T11:00:00Z", () => edit(day, 1, u.staff2.id, { bank: [line("100.00", "09:00", "A"), line("200.00", "10:45", "B2"), line("300.00", "11:00", "C")] }));
    assert.ok(r.ok, JSON.stringify(r));
    const lines = (await newest(day)).bankLines;
    assert.deepEqual(lines.map((l) => [l.amount.toFixed(2), l.recordedById]), [["100.00", w.admin.id], ["200.00", w.admin.id], ["300.00", u.staff2.id]]);
    assert.equal(lines[0].recordedAt.toISOString(), t1, "a kept line keeps its time");
    assert.equal(lines[1].recordedAt.toISOString(), t1, "an edited line keeps its time");
    assert.equal(lines[2].recordedAt.toISOString(), "2026-11-02T11:00:00.000Z", "a new line gets this version's time");
  });

  test("A8: two deposits of the same amount keep their own recorders when the slips are swapped", async () => {
    const day = await makeDay({ pays: ["5000.00"] });
    staff();
    assert.ok((await save(day, w.admin.id, { bank: [line("100.00", "09:00", "A")] })).ok); // recorded by the admin
    admin();
    assert.ok((await edit(day, 1, u.staff2.id, { bank: [line("100.00", "09:00", "A"), line("100.00", "09:00", "B")] })).ok); // B recorded by staff-two
    const swap = await edit(day, 2, w.staff.id, { bank: [line("100.00", "09:00", "B"), line("100.00", "09:00", "A")] }); // order swapped
    assert.ok(swap.ok, JSON.stringify(swap));
    assert.deepEqual((await newest(day)).bankLines.map((l) => [l.slip, l.recordedById]), [["B", u.staff2.id], ["A", w.admin.id]], "each slip still belongs to the person who recorded it");
    const retitle = await edit(day, 3, w.staff.id, { bank: [line("100.00", "09:00", "B"), line("100.00", "09:00", "A2")] }); // the admin's line gets a new slip
    assert.ok(retitle.ok);
    assert.deepEqual((await newest(day)).bankLines.map((l) => [l.slip, l.recordedById]), [["B", u.staff2.id], ["A2", w.admin.id]]);
  });

  // ---- one day per date -----------------------------------------------------------
  test("one saved day per date: a second first-save is a conflict that names who saved first, and the database refuses a duplicate", async () => {
    const day = await savedDay();
    const base = await counts();
    staff();
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
    const day = await savedDay();
    admin();
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
    const day = await makeDay();
    staff();
    const seen = await seenFor(day);
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date(`${day}T10:00:00Z`) } });
    const base = await counts();
    const r = await A.saveDay({ date: day, mode: "save", baseVersion: 0, doneById: w.admin.id, bringForward: "", bank: [], seen });
    assert.ok(!r.ok && r.reason === "numbers-moved");
    if (!r.ok) assert.deepEqual(r.fresh, { collected: 260000, deductions: 0 });
    assert.deepEqual(await counts(), base);
    assert.ok((await save(day, w.admin.id)).ok, "with the new figures it saves");
  });

  test("a save or re-save without 'seen' is refused; the client's numbers are never what is stored", async () => {
    const day = await makeDay();
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

  // ---- A1: over-banking ---------------------------------------------------------------
  test("A1: a FIRST save that banks more than the drawer holds is refused, and the message names the amount; nothing is written", async () => {
    const day = await makeDay({ pays: ["1300.00", "1300.00"] }); // 2,600.00 in the drawer
    staff();
    const base = await counts();
    const r = await save(day, w.admin.id, { bank: [line("3,000.00")] });
    assert.ok(!r.ok && r.reason === "over-bank");
    if (!r.ok) assert.equal(r.message, overBankRefusal(40000));
    assert.equal(overBankRefusal(40000), "The money taken to the bank is 400.00 more than the drawer should hold.");
    assert.deepEqual(await counts(), base);
  });

  test("A1: an EDIT that would bank more than the drawer holds is refused with the amount; a negative Left with nothing banked is saved", async () => {
    const day = await savedDay({ pays: ["1300.00", "1300.00"] });
    admin();
    const base = await counts();
    const r = await edit(day, 1, w.admin.id, { bank: [line("5,000.00")] });
    assert.ok(!r.ok && r.reason === "over-bank");
    if (!r.ok) assert.equal(r.message, overBankRefusal(240000));
    assert.deepEqual(await counts(), base);
    const spendOnly = await makeDay({ pays: [], spend: "5000.00" }); // deductions with no money in
    staff();
    assert.ok((await save(spendOnly, w.admin.id)).ok);
    assert.equal((await newest(spendOnly)).leftInDrawer.toFixed(2), "-5000.00");
    const view = await A.loadSavedDay(spendOnly);
    assert.equal(view.saved?.overBankedBy, null, "a negative Left with nothing banked is NOT over-banked");
  });

  test("A1: a RE-SAVE is always allowed; after a receipt is cancelled the day is saved FLAGGED over-banked, cannot be checked, and an edit must put it right", async () => {
    // 10,000 collected (two receipts) and 10,000 banked: Left is exactly 0, a valid save
    const day = await makeDay({ pays: ["5000.00", "5000.00"] });
    staff();
    assert.ok((await save(day, w.admin.id, { bank: [line("10,000.00", "09:00", "S1", "n")] })).ok);
    const cancel = await db.payment.findFirstOrThrow({ where: { paidAt: new Date(`${day}T04:00:00Z`) } });
    await db.payment.update({ where: { id: cancel.id }, data: { cancelled: true, cancelledById: w.admin.id, cancelledAt: new Date(NOW), cancelReason: "test" } });

    const r = await resave(day, 1, w.admin.id); // live collected is now 5,000.00
    assert.ok(r.ok, `a re-save is always allowed: ${JSON.stringify(r)}`);
    const v2 = await newest(day);
    assert.deepEqual([v2.collected.toFixed(2), v2.bankTotal.toFixed(2), v2.leftInDrawer.toFixed(2)], ["5000.00", "10000.00", "-5000.00"]);
    const view = await A.loadSavedDay(day);
    assert.equal(view.saved?.overBankedBy, 500000, "the saved day says it is over-banked, by how much");

    // a check is refused with that reason while the day is over-banked
    const c = await check(day, 2, w.admin.id);
    assert.ok(!c.ok && c.reason === "over-banked");
    if (!c.ok) {
      assert.equal(c.message, overBankedBanner(500000));
      assert.equal(c.message, "Bank deposits are 5,000.00 more than the drawer should hold. Edit the bank lines or the bring-forward.");
    }
    assert.equal(await db.dailySummaryCheck.count({ where: { version: { dayId: (await dayRow(day)).id } } }), 0);

    // an edit that leaves it over-banked (only the slip changes) is still refused, and names the amount
    const still = await edit(day, 2, w.admin.id, { bank: [line("10,000.00", "09:00", "S2", "n")] });
    assert.ok(!still.ok && still.reason === "over-bank");
    if (!still.ok) assert.equal(still.message, overBankRefusal(500000));

    // putting the bank lines right makes it a normal day again, and then it can be checked
    const fixed = await edit(day, 2, w.admin.id, { bank: [line("5,000.00", "09:00", "S1", "n")] });
    assert.ok(fixed.ok, JSON.stringify(fixed));
    assert.equal((await A.loadSavedDay(day)).saved?.overBankedBy, null);
    assert.ok((await check(day, 3, w.admin.id)).ok);
  });

  test("A1: a re-save that does not over-bank carries no flag", async () => {
    const day = await savedDay({ pays: ["5000.00"], bank: [line("1,000.00")] });
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "100.00", takenById: w.staff.id, paidAt: new Date(`${day}T09:00:00Z`) } });
    admin();
    assert.ok((await resave(day, 1, w.admin.id)).ok);
    assert.equal((await A.loadSavedDay(day)).saved?.overBankedBy, null);
  });

  test("a future day, an impossible date and junk input are refused and write nothing", async () => {
    staff();
    const base = await counts();
    for (const date of ["2026-11-03", "2026-02-30", "not-a-date", "", "2026-13-01"]) {
      const r = await A.saveDay({ date, mode: "save", baseVersion: 0, doneById: w.admin.id, bringForward: "", bank: [], seen: { collected: 0, deductions: 0 } });
      assert.equal(r.ok, false, date);
      if (!r.ok) assert.ok(r.reason === "date" || r.reason === "invalid");
    }
    for (const junk of [null, undefined, 5, "x", [], {}, { date: "2026-10-01" }]) {
      const r = await A.saveDay(junk);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(typeof r.values.date, "string");
    }
    assert.deepEqual(await counts(), base, "none of them wrote anything");
  });

  test("a day already older than 3 months cannot be saved (it would be purged a moment later)", async () => {
    staff();
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date("2026-07-31T04:00:00Z") } });
    const base = await counts();
    const r = await save("2026-07-31", w.admin.id);
    assert.ok(!r.ok && r.reason === "date");
    if (!r.ok) assert.match(r.message, /kept for 3 months/);
    assert.deepEqual(await counts(), base);
  });

  // ---- A7: slip and note limits ------------------------------------------------------
  test("A7: a slip over 30 or a note over 80 characters is refused through the action, naming the field, echoing the values; nothing is cut or written", async () => {
    const day = await makeDay();
    staff();
    const base = await counts();
    const long = await save(day, w.admin.id, { bank: [line("10.00", "09:00", "s".repeat(31), "")] });
    assert.ok(!long.ok && long.reason === "invalid");
    if (!long.ok) {
      assert.ok("bank.0.slip" in (long.fieldErrors ?? {}));
      assert.equal(long.values.bank[0].amount, "10.00");
    }
    const note = await save(day, w.admin.id, { bank: [line("10.00", "09:00", "", "n".repeat(81))] });
    assert.ok(!note.ok && "bank.0.note" in (note.fieldErrors ?? {}));
    assert.deepEqual(await counts(), base);
    const edge = await save(day, w.admin.id, { bank: [line("10.00", "09:00", "s".repeat(30), "n".repeat(80))] });
    assert.ok(edge.ok);
    const stored = (await newest(day)).bankLines[0];
    assert.deepEqual([stored.slip.length, stored.note.length], [30, 80], "exactly what was typed is stored");
  });

  // ---- Colombo edges ----------------------------------------------------------
  test("Colombo-day edges: 23:59:59 belongs to its day and 00:00:00 to the next, in the saved day and in the comparison", async () => {
    const day = "2026-08-25"; // dates outside the makeDay range, so nothing else touches them
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date("2026-08-25T18:29:59Z") } }); // 23:59:59 on the 25th in Colombo
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date("2026-08-25T18:30:00Z") } }); // 00:00:00 on the 26th
    staff();
    const r = await save(day, w.admin.id);
    assert.ok(r.ok);
    assert.equal((await newest(day)).collected.toFixed(2), "1300.00", "only the 23:59:59 payment is on the 25th");
    const view = await A.loadSavedDay(day);
    assert.deepEqual(view.liveDiffs, [], "the 00:00:00 payment is not a difference on the 25th");
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "100.00", takenById: w.staff.id, paidAt: new Date("2026-08-25T18:29:59Z") } });
    const after = await A.loadSavedDay(day);
    assert.ok(after.liveDiffs.some((d) => d.key === "totalCollected"), "a payment at 23:59:59 on the 25th IS a difference");
    assert.equal((await A.loadSavedDay("2026-08-26")).saved, null, "the 26th is its own, unsaved day");
    assert.equal((await seenFor("2026-08-26")).collected, 130000, "and it holds exactly the 00:00:00 payment");
  });

  // ---- reads ------------------------------------------------------------------
  test("loadSavedDay: the saved day with its log, bank deposits (with recorders), the check state and the over-bank flag; an unsaved day is null", async () => {
    const day = await savedDay({ bf: "50.00", bank: [line("10.00", "08:00", "S", "n")], checked: true });
    staff();
    assert.ok((await edit(day, 1, u.staff2.id, { bringForward: "60.00", bank: [line("10.00", "08:00", "S", "n")] })).ok);
    const v = await A.loadSavedDay(day);
    assert.ok(v.saved);
    assert.equal(v.unreadable, false);
    assert.equal(v.saved.version, 2);
    assert.equal(v.saved.cash.bringForward, 6000);
    assert.equal(v.saved.check, null, "the money changed: version 2 is not checked");
    assert.deepEqual(v.saved.checkCleared, { by: w.admin.username });
    assert.equal(v.saved.overBankedBy, null);
    assert.deepEqual(v.saved.log.map((l) => [l.version, l.kind, l.doneByName]), [[1, "SAVE", w.admin.username], [2, "EDIT", u.staff2.username]]);
    assert.deepEqual(v.saved.bank.map((b) => [b.cents, b.recordedByName]), [[1000, w.admin.username]]);
    assert.equal(v.saved.preparedBy.name, w.admin.username);
    assert.equal(v.saved.doneBy.name, u.staff2.username);
    assert.equal(v.saved.savedByName, w.staff.username);
    assert.deepEqual(v.liveDiffs, []);
    assert.equal((await A.loadSavedDay(await makeDay())).saved, null);
    assert.equal((await A.loadSavedDay("garbage")).date, "2026-11-02", "an unusable date reads as today (a read never throws)");
  });

  test("F6: names are FROZEN: a saved day, its log and its deposits print the names as they were when written, whatever the accounts are called later", async () => {
    const who = await db.user.create({ data: { username: "frozen-before", passwordHash: "x", role: "STAFF" } });
    const date = await makeDay();
    as("STAFF", who.id);
    assert.ok((await save(date, who.id, { bank: [line("10.00", "08:00", "S", "n")] })).ok);
    const v = (await newest(date));
    assert.equal(v.savedByName, "frozen-before", "stored on the version");
    assert.deepEqual(v.bankLines.map((b) => b.recordedByName), ["frozen-before"], "stored on the deposit");
    await db.user.update({ where: { id: who.id }, data: { username: "renamed-later" } });
    staff();
    const view = await A.loadSavedDay(date);
    assert.equal(view.saved?.savedByName, "frozen-before");
    assert.deepEqual(view.saved?.bank.map((b) => b.recordedByName), ["frozen-before"]);
    assert.deepEqual(view.saved?.log.map((l) => l.savedByName), ["frozen-before"]);
    // an edit by someone else carries the ORIGINAL frozen recorder name, and its own version is frozen as well
    assert.ok((await edit(date, 1, w.admin.id, { bringForward: "1.00", bank: [line("10.00", "08:00", "S", "n")] })).ok);
    const v2 = await newest(date);
    assert.equal(v2.savedByName, w.staff.username);
    assert.deepEqual(v2.bankLines.map((b) => b.recordedByName), ["frozen-before"], "a kept line keeps its frozen recorder name");
  });

  test("F10: a saved day older than the 3-month cutoff opens as an UNSAVED day (live data), whatever a delayed purge has not removed yet", async () => {
    await db.dailySummaryDay.deleteMany();
    const old = "2026-07-20"; // today is 2 Nov: the cutoff is 2 Aug
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date(`${old}T04:00:00Z`) } });
    await withClock("2026-08-05T06:00:00Z", async () => {
      staff();
      assert.ok((await save(old, w.admin.id)).ok);
    });
    staff();
    // the purge has not run: the row is still in the table, and the read must not show it
    assert.ok(await db.dailySummaryDay.findUnique({ where: { date: colomboDateValue(old) } }));
    const read = await A.loadSavedDay(old);
    assert.deepEqual([read.saved, read.unreadable, read.hint, read.liveDiffs], [null, false, null, []]);
    await db.dailySummaryDay.deleteMany();
  });

  test("F1: an unreadable saved day gets no hint from the store, though a saved day the day before would offer one (the unsaved sibling is the control)", async () => {
    const prev = await makeDay({ pays: ["15000.00"] });
    const date = shiftDay(prev, 1);
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "500.00", takenById: w.staff.id, paidAt: new Date(`${date}T05:00:00Z`) } });
    dayCounter++;
    staff();
    assert.ok((await save(prev, w.admin.id, { bank: [line("3,000.00")] })).ok);
    const control = await A.loadSavedDay(date);
    assert.ok(control.hint && control.hint.leftCents === 1_200_000, JSON.stringify(control.hint));
    assert.ok((await save(date, w.admin.id)).ok);
    await db.$executeRawUnsafe(`UPDATE "DailySummaryVersion" SET "snapshotSchema" = 2 WHERE "dayId" = (SELECT id FROM "DailySummaryDay" WHERE date = '${date}')`);
    const read = await A.loadSavedDay(date);
    assert.equal(read.unreadable, true);
    assert.equal(read.hint, null);
  });

  test("F10: the bring-forward hint is looked up for an UNSAVED day only (a saved or unreadable day costs no hint query)", async () => {
    const saved = await savedDay();
    const unsaved = await makeDay();
    const delegate = db.dailySummaryDay as unknown as Record<string, (...a: unknown[]) => unknown>;
    const realFind = delegate.findMany;
    let calls = 0;
    delegate.findMany = function (this: unknown, ...a: unknown[]) { calls++; return realFind.apply(this, a); };
    try {
      staff();
      await A.loadSavedDay(saved);
      assert.equal(calls, 0, "a saved day: no hint query");
      await A.loadSavedDay(unsaved);
      assert.equal(calls, 1, "an unsaved day: one hint query");
    } finally {
      delegate.findMany = realFind;
    }
  });

  test("F10: a caller that only prints (the A4 document) can skip the live comparison and the hint: nothing is read for them", async () => {
    const saved = await savedDay();
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "77.00", takenById: w.staff.id, paidAt: new Date(`${saved}T06:00:00Z`) } }); // live moved
    const unsaved = await makeDay();
    const actor = { id: w.staff.id, role: "STAFF" };
    const full = await ST.loadSavedDayAs(actor, saved);
    assert.ok(full.liveDiffs.length > 0, "by default the comparison is made");
    const delegate = db.dailySummaryDay as unknown as Record<string, (...a: unknown[]) => unknown>;
    const realFind = delegate.findMany;
    let hintQueries = 0;
    delegate.findMany = function (this: unknown, ...a: unknown[]) { hintQueries++; return realFind.apply(this, a); };
    try {
      const lean = await ST.loadSavedDayAs(actor, saved, undefined, { compare: false, hint: false });
      assert.deepEqual([lean.saved?.version, lean.liveDiffs, lean.liveUnreadable], [1, [], false], "the saved day is there, the comparison is not made");
      const draft = await ST.loadSavedDayAs(actor, unsaved, undefined, { compare: false, hint: false });
      assert.deepEqual([draft.saved, draft.hint], [null, null]);
      assert.equal(hintQueries, 0, "no hint query for the document");
    } finally {
      delegate.findMany = realFind;
    }
  });

  test("'Check cleared' is derived from the log: shown after a money change cleared a check, gone once the day is checked again, never for a day that was never checked", async () => {
    const never = await savedDay();
    assert.equal((await A.loadSavedDay(never)).saved?.checkCleared, null);
    const day = await savedDay({ bf: "10.00", checked: true });
    assert.equal((await A.loadSavedDay(day)).saved?.checkCleared, null, "checked: not cleared");
    admin();
    assert.ok((await edit(day, 1, w.admin.id, { bringForward: "20.00" })).ok);
    assert.deepEqual((await A.loadSavedDay(day)).saved?.checkCleared, { by: w.admin.username });
    assert.ok((await edit(day, 2, w.admin.id, { bringForward: "20.00", bank: [line("1.00", "09:00", "a")] })).ok, "another money edit: still cleared");
    assert.deepEqual((await A.loadSavedDay(day)).saved?.checkCleared, { by: w.admin.username });
    assert.ok((await check(day, 3, u.admin2.id)).ok);
    assert.equal((await A.loadSavedDay(day)).saved?.checkCleared, null, "checked again");
  });

  // ---- A3: the live numbers are handed in --------------------------------------------
  test("A3: with the page's live numbers handed in, loadSavedDay compares with THOSE (it does not read them again); null means 'could not be read'", async () => {
    const day = await savedDay({ pays: ["1300.00", "1300.00"] });
    const saved = parseSnapshot((await newest(day)).snapshot, 1);
    const fakeLive = JSON.parse(JSON.stringify(saved));
    fakeLive.report.totalCollected = "1.00"; // not what the database holds
    const actor = { id: w.staff.id, role: "STAFF" };
    const handed = await ST.loadSavedDayAs(actor, day, fakeLive);
    assert.deepEqual(handed.liveDiffs.map((d) => [d.key, d.saved, d.live]), [["totalCollected", "2,600.00", "1.00"]], "the difference is against the handed-in numbers, not the database");
    const same = await ST.loadSavedDayAs(actor, day, saved);
    assert.deepEqual(same.liveDiffs, [], "handing in the saved numbers themselves: nothing differs, although the database is the same either way");
    const none = await ST.loadSavedDayAs(actor, day, null);
    assert.deepEqual([none.liveDiffs, none.liveUnreadable], [[], true]);
    const own = await ST.loadSavedDayAs(actor, day); // no live given: it reads them itself (what the server action does)
    assert.deepEqual([own.liveDiffs, own.liveUnreadable], [[], false]);
  });

  test("a receipt cancelled after saving shows up as a difference with saved and live figures", async () => {
    const day = await makeDay({ pays: ["1300.00", "1300.00"] });
    staff();
    assert.ok((await save(day, w.admin.id)).ok);
    const p = await db.payment.findFirstOrThrow({ where: { paidAt: new Date(`${day}T04:00:00Z`) } });
    await db.payment.update({ where: { id: p.id }, data: { cancelled: true, cancelledById: w.admin.id, cancelledAt: new Date(NOW), cancelReason: "test" } });
    const v = await A.loadSavedDay(day);
    const total = v.liveDiffs.find((d) => d.key === "totalCollected");
    assert.deepEqual([total?.saved, total?.live], ["2,600.00", "1,300.00"]);
    assert.ok(v.liveDiffs.some((d) => d.key === "cancelled.receipts"));
    assert.equal((await newest(day)).collected.toFixed(2), "2600.00", "the saved version never changes");
  });

  // ---- A4 / A5: errors become refusals, not crashes --------------------------------------
  test("A4: live numbers that do not fit the snapshot shape are a refusal path (null), never a crash", async () => {
    const day = await makeDay();
    const bad = { dailySummary: async () => ({ from: day, to: day }) as never, cancelledReceipts: async () => ({ receipts: 0, total: "0.00" }), collectedByStaff: async () => [] };
    assert.equal(await ST.liveOrNull(day, bad), null);
    assert.ok(await ST.liveOrNull(day), "the real loaders fit");
  });

  test("A4: a save whose live numbers cannot be read is a refusal ('could not be read, nothing saved'), never a crash, and writes nothing", async () => {
    const day = await makeDay();
    const bad = { dailySummary: async () => ({ from: day, to: day }) as never, cancelledReceipts: async () => ({ receipts: 0, total: "0.00" }), collectedByStaff: async () => [] };
    const base = await counts();
    const r = await ST.saveDayAs({ id: w.staff.id, role: "STAFF" }, { date: day, mode: "save", baseVersion: 0, doneById: w.admin.id, bringForward: "", bank: [], seen: { collected: 130000, deductions: 0 } }, bad);
    assert.ok(!r.ok && r.reason === "snapshot");
    if (!r.ok) assert.equal(r.message, "The numbers for this day could not be read. Nothing was saved.");
    assert.deepEqual(await counts(), base);
  });

  test("A5: a saved snapshot that cannot be read (unknown schema, corrupt) does not crash the screen: the day is 'unreadable' and the live view stands", async () => {
    const unknownSchema = await savedDay();
    await db.$executeRawUnsafe(`UPDATE "DailySummaryVersion" SET "snapshotSchema" = 2 WHERE "dayId" = ${(await dayRow(unknownSchema)).id}`);
    const a = await A.loadSavedDay(unknownSchema);
    assert.deepEqual([a.saved, a.unreadable, a.liveDiffs, a.liveUnreadable], [null, true, [], false]);
    assert.equal(UNREADABLE_DAY, "This saved day can't be read. Showing the live numbers.");

    const corrupt = await savedDay();
    await db.$executeRawUnsafe(`UPDATE "DailySummaryVersion" SET "snapshot" = '{"x":1}'::jsonb WHERE "dayId" = ${(await dayRow(corrupt)).id}`);
    const b = await A.loadSavedDay(corrupt);
    assert.deepEqual([b.saved, b.unreadable], [null, true]);

    // an edit of such a day is a refusal, not a crash, and writes nothing
    const base = await counts();
    admin();
    const r = await edit(corrupt, 1, w.admin.id, { bringForward: "5.00" });
    assert.ok(!r.ok && r.reason === "corrupt");
    assert.deepEqual(await counts(), base);

    // a day with no versions at all (nothing to read) is simply unsaved
    const empty = await makeDay();
    await db.dailySummaryDay.create({ data: { date: colomboDateValue(empty), currentVersion: 1 } });
    assert.deepEqual([(await A.loadSavedDay(empty)).saved, (await A.loadSavedDay(empty)).unreadable], [null, false]);
  });

  test("A4: a check on a day older than 3 months is refused before anything is written", async () => {
    const day = "2026-05-14";
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date(`${day}T04:00:00Z`) } });
    await withClock("2026-08-05T06:00:00Z", async () => {
      staff();
      assert.ok((await save(day, w.admin.id)).ok);
    });
    const base = await counts();
    admin();
    const r = await check(day, 1, w.admin.id);
    assert.ok(!r.ok && r.reason === "expired");
    if (!r.ok) assert.equal(r.message, "This day's saved details are older than 3 months.");
    assert.deepEqual(await counts(), base);
    await db.dailySummaryDay.deleteMany({ where: { date: colomboDateValue(day) } });
  });

  /**
   * A purge that COMMITS in the middle of a request: a trigger on the insert deletes the day through a second connection (dblink), so the
   * deletion is committed before this transaction's own foreign-key check, exactly like a purge running beside it. (A delete inside the same
   * transaction would be rolled back with it, and the day would still be there afterwards.) Skipped, with the reason, where dblink is missing.
   */
  async function withCommittedPurge<T>(table: "DailySummaryCheck", fn: () => Promise<T>, t: { skip: (m: string) => void }): Promise<T | null> {
    try {
      await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS dblink`);
    } catch (e) {
      t.skip(`dblink is not available on this test server: ${(e as Error).message}`);
      return null;
    }
    // Only the check can lose its day this way: a save or edit holds the day's row (and its advisory lock), so a purge cannot delete the day under it
    // (that case is a version-count conflict, not a foreign-key failure).
    const body = `PERFORM dblink_exec('dbname=' || current_database() || ' user=' || current_user, format('DELETE FROM "DailySummaryDay" WHERE id = (SELECT "dayId" FROM "DailySummaryVersion" WHERE id = %s)', NEW."versionId")); RETURN NEW;`;
    return withTrigger("ds_test_purge_race", "BEFORE INSERT", table, body, fn);
  }

  test("A4: a day the purge deletes between our read and our write is a friendly refusal ('no longer saved'), not a thrown foreign-key error", async (t) => {
    const day = await savedDay();
    admin();
    const r = await withCommittedPurge("DailySummaryCheck", () => check(day, 1, w.admin.id), t);
    if (r === null) return;
    assert.ok(!r.ok && r.reason === "not-saved", JSON.stringify(r));
    if (!r.ok) assert.equal(r.message, "This day is no longer saved (saved details are kept for 3 months). Nothing was changed.");
    assert.equal(r.values.checkedById, w.admin.id);
    assert.equal(await db.dailySummaryDay.findUnique({ where: { date: colomboDateValue(day) } }), null, "the purge really committed");
  });

  test("F9: a foreign-key failure while the day is still there says WHICH account is gone: the Done by or named admin ('no longer available, choose someone else'), the session user ('your sign-in'), never 'no longer saved'", async () => {
    const mk = (username: string, role: UserRole) => db.user.create({ data: { username, passwordHash: "x", role } });
    const vanish = (id: string) => `DELETE FROM "User" WHERE id = '${id}'; RETURN NEW;`;
    const GONE = "This account is no longer available. Choose someone else.";
    const SIGN_IN = "Your sign-in could not be checked. Sign out and in again.";
    // 1. save: the Done by account vanishes after the lookup
    {
      const date = await makeDay();
      const doneBy = (await mk("ghost-doneby", "STAFF")).id;
      staff();
      const r = await withTrigger("ds_test_vanish_user", "BEFORE INSERT", "DailySummaryVersion", vanish(doneBy), () => save(date, doneBy));
      assert.ok(!r.ok && r.reason === "done-by" && r.message === GONE, JSON.stringify(r));
      assert.equal(await db.dailySummaryDay.findUnique({ where: { date: colomboDateValue(date) } }), null, "nothing was written");
    }
    // 2. save: the SESSION user vanishes after the lookup
    {
      const date = await makeDay();
      const session = (await mk("ghost-session", "STAFF")).id;
      as("STAFF", session);
      const r = await withTrigger("ds_test_vanish_user", "BEFORE INSERT", "DailySummaryVersion", vanish(session), () => save(date, w.admin.id));
      assert.ok(!r.ok && r.reason === "sign-in" && r.message === SIGN_IN, JSON.stringify(r));
    }
    // 3. check: the NAMED ADMIN vanishes
    {
      const day = await savedDay();
      const named = (await mk("ghost-admin", "ADMIN")).id;
      admin();
      const r = await withTrigger("ds_test_vanish_user", "BEFORE INSERT", "DailySummaryCheck", vanish(named), () => check(day, 1, named));
      assert.ok(!r.ok && r.reason === "not-admin" && r.message === GONE, JSON.stringify(r));
      assert.equal(await db.dailySummaryCheck.count(), (await counts()).checks, "no check written");
    }
    // 4. check: the TAPPER (session user) vanishes
    {
      const day = await savedDay();
      const tapper = (await mk("ghost-tapper", "STAFF")).id;
      as("STAFF", tapper);
      const r = await withTrigger("ds_test_vanish_user", "BEFORE INSERT", "DailySummaryCheck", vanish(tapper), () => check(day, 1, w.admin.id));
      assert.ok(!r.ok && r.reason === "sign-in" && r.message === SIGN_IN, JSON.stringify(r));
    }
  });

  test("F9: saving needs the signed-in user to exist and be active ADMIN or STAFF; the refusal says so and writes nothing", async () => {
    const date = await makeDay();
    const base = await counts();
    for (const [role, id] of [["STAFF", "a-user-that-does-not-exist"], ["STAFF", u.inactiveStaff.id], ["ADMIN", u.inactiveAdmin.id], ["STAFF", u.teacher.id]] as const) {
      as(role, id);
      const r = await save(date, w.admin.id);
      assert.ok(!r.ok && r.reason === "sign-in", `${role} ${id}: ${JSON.stringify(r)}`);
      if (!r.ok) assert.match(r.message, /sign-in/);
    }
    assert.deepEqual(await counts(), base);
  });

  test("F9: the person who taps Check must still hold a role that may use this screen (a TEACHER login that was once staff is refused)", async () => {
    const day = await savedDay();
    const base = await counts();
    as("STAFF", u.teacher.id); // the session says STAFF, the account row says TEACHER
    const r = await check(day, 1, w.admin.id);
    assert.ok(!r.ok && r.reason === "sign-in", JSON.stringify(r));
    assert.deepEqual(await counts(), base);
  });

  test("A6: when the signed-in user's row is missing or deactivated, markChecked refuses; the tapper is never stored as 'unknown'", async () => {
    const day = await savedDay();
    const base = await counts();
    as("STAFF", "a-user-that-does-not-exist");
    const gone = await check(day, 1, w.admin.id);
    assert.ok(!gone.ok && gone.reason === "sign-in");
    as("STAFF", u.inactiveStaff.id);
    const off = await check(day, 1, w.admin.id);
    assert.ok(!off.ok && off.reason === "sign-in");
    assert.deepEqual(await counts(), base);
    assert.equal(await db.dailySummaryCheck.count({ where: { markedByName: "unknown" } }), 0);
  });

  test("A11: the store checks the role itself: a TEACHER or unknown role cannot reach any write or read, whoever calls", async () => {
    const day = await savedDay();
    const base = await counts();
    for (const role of ["TEACHER", "", "ADMINISTRATOR"]) {
      const actor = { id: w.admin.id, role };
      await assert.rejects(() => ST.markCheckedAs(actor, { date: day, baseVersion: 1, checkedById: w.admin.id }), /Not authorised/);
      await assert.rejects(() => ST.saveDayAs(actor, { date: day, mode: "edit", baseVersion: 1, doneById: w.admin.id, bringForward: "1.00", bank: [] }), /Not authorised/);
      await assert.rejects(() => ST.loadSavedDayAs(actor, day), /Not authorised/);
      await assert.rejects(() => ST.loadHistoryAs(actor, "2026-10"), /Not authorised/);
    }
    assert.deepEqual(await counts(), base);
  });

  // ---- hint ------------------------------------------------------------------------
  test("the bring-forward hint: yesterday's saved Left in drawer, or the newest saved day within 7 days with its date; none when too old, unsaved, or already typed", async () => {
    const src = "2026-08-10";
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date(`${src}T04:00:00Z`) } });
    await withClock("2026-08-12T06:00:00Z", async () => {
      staff();
      assert.ok((await save(src, w.admin.id, { bank: [line("300.00")] })).ok); // collected 1,300.00, banked 300.00: Left 1,000.00
    });
    const next = (await A.loadSavedDay("2026-08-11")).hint;
    assert.deepEqual(next && [next.date, next.leftCents, next.checked, next.daysAgo], [src, 100000, false, 1]);
    admin();
    assert.ok((await check(src, 1, w.admin.id)).ok);
    assert.equal((await A.loadSavedDay("2026-08-11")).hint?.checked, true);
    const gap = (await A.loadSavedDay("2026-08-14")).hint;
    assert.deepEqual(gap && [gap.date, gap.daysAgo], [src, 4]);
    assert.equal((await A.loadSavedDay("2026-08-17")).hint?.daysAgo, 7, "exactly 7 days back is still offered");
    assert.equal((await A.loadSavedDay("2026-08-18")).hint, null, "8 days is too old");
    assert.equal((await A.loadSavedDay(src)).hint, null, "a day never hints itself");
    // a saved day that already has a bring-forward gets no hint, even with a saved day just before it
    const before = await makeDay({ pays: ["10.00"] });
    const withBf = await makeDay(); // the very next day
    assert.equal(shiftDay(before, 1), withBf);
    staff();
    assert.ok((await save(before, w.admin.id)).ok);
    assert.ok((await save(withBf, w.admin.id, { bringForward: "50.00" })).ok);
    assert.equal((await A.loadSavedDay(withBf)).hint, null, "bring-forward typed: no hint");
  });

  // ---- History ----------------------------------------------------------------------
  test("loadHistory: one month, newest first, with Collected, Net, version, who and the check; junk months mean the current month", async () => {
    const one = await savedDay({ pays: ["1300.00"], checked: true });
    const two = await savedDay({ pays: ["1300.00"] });
    admin();
    assert.ok((await edit(two, 1, u.staff2.id, { bringForward: "10.00" })).ok);
    const month = one.slice(0, 7);
    const h = await A.loadHistory(month);
    assert.equal(h.month, month);
    const dates = h.rows.map((r) => r.date);
    assert.deepEqual(dates, [...dates].sort().reverse(), "newest first");
    assert.ok(dates.every((d) => d.startsWith(month)), "no other month");
    const r1 = h.rows.find((r) => r.date === one)!;
    assert.deepEqual([r1.version, r1.preparedByName, r1.doneByName, r1.collected, r1.net, r1.checked], [1, w.admin.username, w.admin.username, 130000, 130000, true]);
    const r2 = h.rows.find((r) => r.date === two)!;
    assert.deepEqual([r2.version, r2.preparedByName, r2.doneByName, r2.checked], [2, w.admin.username, u.staff2.username, false], "saved by one person, last edited by another");
    for (const junk of ["", "2026-13", "9999-01", "1999-12", "x", null, undefined, 5, "2026-1"]) assert.equal((await A.loadHistory(junk)).month, "2026-11", `junk ${String(junk)}`);
  });

  test("History cap: only the newest rows up to the limit are returned (the cap is testable with a lower limit)", async () => {
    await db.dailySummaryDay.deleteMany();
    const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"];
    for (const d of days) {
      await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date(`${d}T04:00:00Z`) } });
      staff();
      assert.ok((await save(d, w.admin.id)).ok);
    }
    staff();
    const all = await ST.loadHistoryAs({ id: w.staff.id, role: "STAFF" }, "2026-10");
    assert.deepEqual(all.rows.map((r) => r.date), [...days].reverse(), "under the default cap nothing is cut");
    const capped = await ST.loadHistoryAs({ id: w.staff.id, role: "STAFF" }, "2026-10", 3);
    assert.deepEqual(capped.rows.map((r) => r.date), ["2026-10-05", "2026-10-04", "2026-10-03"], "the newest three");
    assert.equal(ST.HISTORY_MAX_ROWS, 31);
    await db.dailySummaryDay.deleteMany();
  });

  test("A10: History purges FIRST: the order is the only difference (a recorder sees deleteMany before any read of the days)", async () => {
    await db.dailySummaryDay.deleteMany();
    const old = "2026-07-20";
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date(`${old}T04:00:00Z`) } });
    await withClock("2026-08-05T06:00:00Z", async () => {
      staff();
      assert.ok((await save(old, w.admin.id)).ok);
    });
    staff();
    const order: string[] = [];
    const delegate = db.dailySummaryDay as unknown as Record<string, (...a: unknown[]) => unknown>;
    const realDelete = delegate.deleteMany;
    const realFind = delegate.findMany;
    delegate.deleteMany = function (this: unknown, ...a: unknown[]) { order.push("purge"); return realDelete.apply(this, a); };
    delegate.findMany = function (this: unknown, ...a: unknown[]) { order.push("read"); return realFind.apply(this, a); };
    try {
      await A.loadHistory("2026-11");
    } finally {
      delegate.deleteMany = realDelete;
      delegate.findMany = realFind;
    }
    assert.deepEqual(order.slice(0, 2), ["purge", "read"], "the purge statement comes before the first read of the days");
    await db.dailySummaryDay.deleteMany();
  });

  test("A10: the History query itself never returns an expired day, even when the purge fails", async () => {
    await db.dailySummaryDay.deleteMany();
    const old = "2026-07-20";
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date(`${old}T04:00:00Z`) } });
    await withClock("2026-08-05T06:00:00Z", async () => {
      staff();
      assert.ok((await save(old, w.admin.id)).ok);
    });
    staff();
    // the purge is made to FAIL: the page must still not list the expired day
    const errors: unknown[] = [];
    const logged = mock.method(console, "error", (...a: unknown[]) => void errors.push(a));
    try {
      const failed = await withTrigger("ds_test_fail_delete", "BEFORE DELETE", "DailySummaryDay", `RAISE EXCEPTION 'purge exploded';`, () => A.loadHistory("2026-07"));
      assert.equal(failed.purged, 0);
      assert.deepEqual(failed.rows, [], "the expired day is not listed although it is still in the table");
      assert.equal(errors.length, 1, "the failure was logged");
    } finally {
      logged.mock.restore();
    }
    assert.ok(await db.dailySummaryDay.findUnique({ where: { date: colomboDateValue(old) } }), "it is still there: nothing was half-deleted");
    const ok = await A.loadHistory("2026-07");
    assert.equal(ok.purged, 1, "the next History open purges it first");
    assert.deepEqual(ok.rows, []);
  });

  // ---- retention ---------------------------------------------------------------
  test("retention: after a save and when History opens, days older than 3 months are deleted with their versions, deposits and checks; the boundary day and everything else stay", async () => {
    await db.dailySummaryDay.deleteMany(); // this test counts, so it starts from nothing
    await withClock("2026-08-05T06:00:00Z", async () => {
      staff();
      for (const day of ["2026-08-01", "2026-08-02", "2026-07-15"]) {
        await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date(`${day}T04:00:00Z`) } });
        const r = await save(day, w.admin.id, { bank: [line("100.00")] });
        assert.ok(r.ok, `${day}: ${JSON.stringify(r)}`);
        assert.ok((await check(day, 1, w.admin.id)).ok);
      }
    });
    const before = { ...(await world()), ...(await counts()) };
    const h = await A.loadHistory("2026-11");
    assert.equal(h.purged, 2, "1 Aug and 15 Jul are older than the cutoff (2 Aug)");
    const left = await db.dailySummaryDay.findMany({ select: { date: true } });
    assert.deepEqual(left.map((d) => d.date.toISOString().slice(0, 10)), ["2026-08-02"], "exactly three months old is kept");
    const after = { ...(await world()), ...(await counts()) };
    assert.equal(after.days, before.days - 2);
    assert.equal(after.versions, before.versions - 2, "their versions went with them");
    assert.equal(after.lines, before.lines - 2, "... and their bank deposits");
    assert.equal(after.checks, before.checks - 2, "... and their checks");
    assert.deepEqual([after.payments, after.expenses, after.users, after.students], [before.payments, before.expenses, before.users, before.students], "payments, expenses, users and students are untouched");
    assert.equal((await A.loadSavedDay("2026-08-01")).saved, null, "the expired day reads as unsaved (its live summary is still computed from payments)");
    assert.equal((await A.loadHistory("2026-11")).purged, 0, "a second run has nothing to do");
  });

  test("a save purges too, as a separate statement after it committed", async () => {
    await db.dailySummaryDay.deleteMany();
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date("2026-05-10T04:00:00Z") } });
    await withClock("2026-08-05T06:00:00Z", async () => {
      staff();
      assert.ok((await save("2026-05-10", w.admin.id)).ok); // the cutoff then was 5 May: fine
    });
    const today = await makeDay();
    staff();
    const r = await save(today, w.admin.id);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.purged, 1, "the save removed the one expired day");
    assert.equal((await A.loadSavedDay("2026-05-10")).saved, null);
    assert.ok((await A.loadSavedDay(today)).saved, "and the day just saved is there");
  });

  test("a purge that FAILS never breaks the save or the page: it is logged, ignored and retried next time", async () => {
    await db.dailySummaryDay.deleteMany();
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date("2026-05-12T04:00:00Z") } });
    await withClock("2026-08-05T06:00:00Z", async () => {
      staff();
      assert.ok((await save("2026-05-12", w.admin.id)).ok);
    });
    const errors: unknown[] = [];
    const logged = mock.method(console, "error", (...a: unknown[]) => void errors.push(a));
    try {
      await withTrigger("ds_test_fail", "BEFORE DELETE", "DailySummaryDay", `RAISE EXCEPTION 'purge exploded';`, async () => {
        const day = await makeDay();
        staff();
        const r = await save(day, w.admin.id);
        assert.ok(r.ok, "the save itself succeeded");
        assert.equal(r.purged, 0);
        const h = await A.loadHistory(day.slice(0, 7));
        assert.ok(h.rows.some((x) => x.date === day), "the page loads");
        assert.equal(h.purged, 0);
        assert.equal(errors.length, 2, "both failures were logged");
        assert.ok((await db.dailySummaryDay.findUnique({ where: { date: colomboDateValue("2026-05-12") } })), "the expired day is still there");
      });
    } finally {
      logged.mock.restore();
    }
    assert.equal((await A.loadHistory("2026-10")).purged, 1, "the next History open retries and succeeds");
  });

  // ---- immutability -------------------------------------------------------------------
  test("every save leaves older versions exactly as they were (immutability across a long history)", async () => {
    const day = await savedDay();
    const snapshots: string[] = [];
    admin();
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
    const day = await makeDay({ pays: ["99999999.99"], spend: "0.01" });
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
