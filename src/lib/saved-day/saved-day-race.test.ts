import { dbSkip, freezeClock, makeStudent, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

import { colomboDateValue } from "@/lib/colombo-time";
import { shiftDay } from "@/lib/daily-summary-dates";

/*
 * Daily Summary R2: overlapping requests on the same saved day (and on different days). The per-day advisory lock plus the version
 * check make the outcome deterministic whatever order the requests interleave in: exactly one first save wins, exactly one of two
 * checks, exactly one of two edits at the same version; an edit and a check never attach a check to numbers the checker did not see;
 * two DIFFERENT days never block each other. The whole file is also run 20 times (see the release proof).
 *
 * Each round uses two fresh days that run the same sequence at the same time.
 */

const NOW = "2026-11-02T10:00:00Z";
const ROUNDS = 20;
const FIRST_DAY = "2026-09-01";

type Actions = typeof import("@/app/(app)/daily-summary/saved-actions");
let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let A: Actions;
let admin2Id: string;
let staff2Id: string;
let studentId: number;

describe("saved-day races against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    A = await import("@/app/(app)/daily-summary/saved-actions");
    w = await seedWorld(db);
    admin2Id = (await db.user.create({ data: { username: "admin-race", passwordHash: "x", role: "ADMIN" } })).id;
    staff2Id = (await db.user.create({ data: { username: "staff-race", passwordHash: "x", role: "STAFF" } })).id;
    studentId = (await makeStudent(db)).id;
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  /** Calls an action as someone. The stubbed session is read when the action starts, so set-then-call is safe for overlapping calls. */
  const asStaff = <T>(f: () => Promise<T>) => (setSession("STAFF", w.staff.id), f());
  const asAdmin = <T>(f: () => Promise<T>) => (setSession("ADMIN", w.admin.id), f());
  const dayData = (date: string) =>
    db.dailySummaryDay.findUniqueOrThrow({
      where: { date: colomboDateValue(date) },
      include: { versions: { orderBy: { version: "asc" }, include: { check: true } } },
    });

  async function sequence(date: string) {
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date(`${date}T04:00:00Z`) } });
    const seen = { collected: 130000, deductions: 0 };

    // A. two overlapping FIRST saves of the same day: exactly one wins
    const [a1, a2] = await Promise.all([
      asStaff(() => A.saveDay({ date, mode: "save", baseVersion: 0, doneById: w.admin.id, bringForward: "", bank: [], seen })),
      asAdmin(() => A.saveDay({ date, mode: "save", baseVersion: 0, doneById: staff2Id, bringForward: "", bank: [], seen })),
    ]);
    assert.equal([a1, a2].filter((r) => r.ok).length, 1, `${date}: exactly one first save wins (${JSON.stringify([a1.ok, a2.ok])})`);
    const loser = [a1, a2].find((r) => !r.ok)!;
    assert.ok(!loser.ok && loser.reason === "conflict" && loser.current?.version === 1, `${date}: the other sees a conflict naming version 1`);
    let d = await dayData(date);
    assert.deepEqual([d.currentVersion, d.versions.length, d.versions[0].version], [1, 1, 1], `${date}: one day, one version 1`);
    const winnerDoneBy = a1.ok ? w.admin.id : staff2Id;
    assert.equal(d.versions[0].doneById, winnerDoneBy, `${date}: the stored version is the winner's`);

    // E. two overlapping checks of version 1: exactly one is recorded
    const [c1, c2] = await Promise.all([
      asStaff(() => A.markChecked({ date, baseVersion: 1, checkedById: w.admin.id })),
      asAdmin(() => A.markChecked({ date, baseVersion: 1, checkedById: admin2Id })),
    ]);
    assert.equal([c1, c2].filter((r) => r.ok).length, 1, `${date}: exactly one check`);
    assert.ok([c1, c2].some((r) => !r.ok && r.reason === "already-checked"), `${date}: the other is told it is already checked`);
    d = await dayData(date);
    assert.ok(d.versions[0].check, `${date}: version 1 is checked once`);

    // C. two overlapping edits at the same version (both money changes): exactly one writes version 2, the other is a conflict
    const edit = (doneById: string, bringForward: string) => A.saveDay({ date, mode: "edit", baseVersion: 1, doneById, bringForward, bank: [] });
    const [e1, e2] = await Promise.all([asStaff(() => edit(w.admin.id, "10.00")), asAdmin(() => edit(staff2Id, "20.00"))]);
    assert.equal([e1, e2].filter((r) => r.ok).length, 1, `${date}: exactly one edit wins`);
    assert.ok([e1, e2].some((r) => !r.ok && r.reason === "conflict"), `${date}: the other is a conflict`);
    d = await dayData(date);
    assert.deepEqual([d.currentVersion, d.versions.length], [2, 2]);
    assert.equal(d.versions[1].check, null, `${date}: the money changed, so version 2 has no check`);
    assert.equal(d.versions[0].check !== null, true, `${date}: version 1 keeps its check`);

    // B. an edit (money change) and a check of version 2 overlapping: the check can only ever attach to version 2
    const [ed, ck] = await Promise.all([
      asStaff(() => A.saveDay({ date, mode: "edit", baseVersion: 2, doneById: w.admin.id, bringForward: "30.00", bank: [] })),
      asAdmin(() => A.markChecked({ date, baseVersion: 2, checkedById: w.admin.id })),
    ]);
    assert.ok(ed.ok, `${date}: the edit is never refused (a check does not change the version)`);
    d = await dayData(date);
    assert.equal(d.versions.length, 3);
    assert.equal(d.versions[2].check, null, `${date}: version 3 never inherits or receives a check from the overlapping check`);
    if (ck.ok) {
      assert.ok(d.versions[1].check, `${date}: the check landed on version 2, the one the checker saw`);
      assert.ok(ed.changes.some((c) => c.t === "check-cleared"), `${date}: and the edit recorded that it cleared it`);
    } else {
      assert.equal(ck.reason, "conflict", `${date}: a check that lost is a conflict, not a silent attach`);
      assert.equal(d.versions[1].check, null);
    }
    return d;
  }

  test(`${ROUNDS} rounds: two days run the whole overlapping sequence at the same time; different days never interfere`, async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const x = shiftDay(FIRST_DAY, 2 * i);
      const y = shiftDay(FIRST_DAY, 2 * i + 1);
      const [dx, dy] = await Promise.all([sequence(x), sequence(y)]);
      assert.equal(dx.versions.length, 3);
      assert.equal(dy.versions.length, 3, "both days completed all three versions");
    }
    // nothing leaked across days: every day has consecutive versions 1..3 and exactly one version-1 check
    const days = await db.dailySummaryDay.findMany({
      where: { date: { gte: colomboDateValue(FIRST_DAY), lt: colomboDateValue(shiftDay(FIRST_DAY, 2 * ROUNDS)) } },
      include: { versions: { orderBy: { version: "asc" } } },
    });
    assert.equal(days.length, ROUNDS * 2);
    for (const d of days) assert.deepEqual(d.versions.map((v) => v.version), [1, 2, 3]);
    assert.equal(await db.dailySummaryCheck.count({ where: { version: { version: 3, day: { date: { gte: colomboDateValue(FIRST_DAY), lt: colomboDateValue(shiftDay(FIRST_DAY, 2 * ROUNDS)) } } } } }), 0);
  });

  test("a save that cannot get the day's lock in time answers with a friendly refusal and writes nothing", async () => {
    const date = "2026-10-30";
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date(`${date}T04:00:00Z`) } });
    const base = await db.dailySummaryVersion.count();
    // hold the very lock a save of this day wants, from another connection, for longer than the 4 s lock wait
    const holder = db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7410::int, 20261030::int)`;
      await new Promise((r) => setTimeout(r, 5200));
    }, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 300));
    const r = await asStaff(() => A.saveDay({ date, mode: "save", baseVersion: 0, doneById: w.admin.id, bringForward: "", bank: [], seen: { collected: 130000, deductions: 0 } }));
    assert.ok(!r.ok && r.reason === "busy", JSON.stringify(r));
    if (!r.ok) assert.match(r.message, /nothing was saved/);
    await holder;
    assert.equal(await db.dailySummaryVersion.count(), base, "nothing was written");
    // and once the lock is free the same request saves
    const ok = await asStaff(() => A.saveDay({ date, mode: "save", baseVersion: 0, doneById: w.admin.id, bringForward: "", bank: [], seen: { collected: 130000, deductions: 0 } }));
    assert.ok(ok.ok, JSON.stringify(ok));
  });
});
