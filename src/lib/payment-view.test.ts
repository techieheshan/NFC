import { attend, dbSkip, enrol, freezeClock, makeCombo, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * The read-only data behind the NEW payment screens (job 2), against a real
 * database. The clock is frozen at 10 Nov 2026 11:30 Colombo — the month the
 * wireframes assume — so "this month" is November 2026.
 */

const NOW = "2026-11-10T06:00:00Z";
const AUG = "2026-08-05T06:00:00Z";

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let pay: typeof import("@/app/(app)/payment/actions");
let view: typeof import("@/lib/payment-view");

describe("payment view (new screens) against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    pay = await import("@/app/(app)/payment/actions");
    view = await import("@/lib/payment-view");
    w = await seedWorld(db);
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------
  async function course(fee = "2500", teacherId?: number) {
    return makeCourse(db, w, { teacherId: teacherId ?? (await makeTeacher(db)).id, fee, name: `C${Math.random().toString(36).slice(2, 7)}` });
  }
  async function student(enrolments: { courseId: number; tier?: "FULL" | "HALF" | "FREE"; since?: string }[]) {
    const s = await makeStudent(db);
    for (const e of enrolments) await enrol(db, { studentId: s.id, courseId: e.courseId, tierId: w.tiers[e.tier ?? "FULL"].id, since: e.since ?? AUG });
    return s;
  }
  const settle = (studentId: number, courseId: number, year: number, month: number, o: { paidAt?: string; cancelled?: boolean } = {}) =>
    db.payment.create({
      data: { kind: "CLASS", studentId, courseId, billingYear: year, billingMonth: month, amount: "2500.00", feeTierId: w.tiers.FULL.id, takenById: w.admin.id, paidAt: new Date(o.paidAt ?? NOW), cancelled: o.cancelled ?? false, transactionRef: null },
    });
  async function load(studentId: number) {
    setSession("ADMIN", w.admin.id);
    const res = await pay.loadPanel({ studentId });
    assert.equal(res.status, "ok");
    return view.buildPaymentView((res as Extract<typeof res, { status: "ok" }>).panel);
  }
  const states = (v: Awaited<ReturnType<typeof load>>, i = 0) => v.courses[i].months.map((m) => `${m.year}-${m.month}:${m.state}`);

  // ---- the month a card charges --------------------------------------------------------

  test("the card month is the OLDEST unpaid month up to now, and it is marked owed when it is in the past", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id }]); // enrolled Aug
    await settle(s.id, c.id, 2026, 8, { paidAt: "2026-08-12T20:00:00Z" });
    await settle(s.id, c.id, 2026, 9, { paidAt: "2026-09-14T06:00:00Z" });
    await attend(db, { studentId: s.id, courseId: c.id, date: "2026-10-10", markedById: w.admin.id });
    for (const d of ["2026-11-03", "2026-11-05", "2026-11-07"]) await attend(db, { studentId: s.id, courseId: c.id, date: d, markedById: w.admin.id });

    const v = await load(s.id);
    const card = v.courses[0];
    assert.equal(card.cardMonth?.label, "Oct 2026");
    assert.equal(card.cardMonth?.owed, true);
    assert.equal(card.cardMonth?.attended, 1);
    assert.equal(card.paidThisMonth, null);
    assert.deepEqual(states(v), ["2026-8:paid", "2026-9:paid", "2026-10:unpaid", "2026-11:unpaid", "2026-12:ahead", "2027-1:ahead", "2027-2:ahead"]);
    const nov = card.months.find((m) => m.month === 11)!;
    assert.equal(nov.owed, false); // this month is unpaid but not "owed" yet
    assert.equal(nov.attended, 3);
  });

  test("the paid day is the day in COLOMBO: 20:00 UTC on 12 Aug is 13 Aug there", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id }]);
    await settle(s.id, c.id, 2026, 8, { paidAt: "2026-08-12T20:00:00Z" });
    await settle(s.id, c.id, 2026, 9, { paidAt: "2026-09-14T06:00:00Z" });
    const months = (await load(s.id)).courses[0].months;
    assert.equal(months.find((m) => m.month === 8)?.paidDay, 13);
    assert.equal(months.find((m) => m.month === 9)?.paidDay, 14);
  });

  test("with everything up to now paid there is no card month — the current month shows as paid with its day", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id }]);
    for (const m of [8, 9, 10]) await settle(s.id, c.id, 2026, m);
    await settle(s.id, c.id, 2026, 11, { paidAt: "2026-11-03T06:00:00Z" });
    const card = (await load(s.id)).courses[0];
    assert.equal(card.cardMonth, null);
    assert.deepEqual(card.paidThisMonth, { label: "Nov 2026", paidDay: 3, paidLabel: "03 Nov" });
  });

  test("a gap in the middle: the card month is the first gap, not the last unpaid month", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id }]);
    for (const m of [8, 10]) await settle(s.id, c.id, 2026, m); // Sep and Nov unpaid
    assert.equal((await load(s.id)).courses[0].cardMonth?.label, "Sep 2026");
  });

  test("a free-tier course has no card month and no paid state", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id, tier: "FREE" }]);
    const card = (await load(s.id)).courses[0];
    assert.equal(card.free, true);
    assert.equal(card.cardMonth, null);
    assert.equal(card.paidThisMonth, null);
    assert.equal(card.monthly, null);
  });

  test("prices, tier and combo fee come straight from the existing panel", async () => {
    const t = await makeTeacher(db);
    const a = await makeCourse(db, w, { teacherId: t.id, fee: "2500", name: "PA" });
    const b = await makeCourse(db, w, { teacherId: t.id, fee: "1700", name: "PB" });
    const combo = await makeCombo(db, { teacherId: t.id, items: [{ courseId: a.id, fee: "2000" }, { courseId: b.id, fee: "1300" }] });
    const s = await student([{ courseId: a.id }, { courseId: b.id, tier: "HALF" }]);
    const v = await load(s.id);
    assert.deepEqual(v.courses.map((c) => [c.course, c.tierCode, c.monthly, c.comboMonthly, c.comboId]), [
      ["PA", "FULL", "2500.00", "2000.00", combo.id],
      ["PB", "HALF", "850.00", "650.00", combo.id],
    ]);
    assert.equal(v.combos.length, 1);
  });

  // ---- which months are offered ------------------------------------------------------------

  test("months run from the ENROLMENT's own start month: nothing before it", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id, since: "2026-11-02T06:00:00Z" }]);
    const v = await load(s.id);
    assert.deepEqual(states(v), ["2026-11:unpaid", "2026-12:ahead", "2027-1:ahead", "2027-2:ahead"]);
    assert.equal(v.courses[0].cardMonth?.owed, false);
  });

  test("CURRENT BEHAVIOUR (will change in job 3: any past month payable — the new screen already offers it): months older than the old 5-month window are offered back to the enrolment start", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id, since: "2026-01-04T06:00:00Z" }]);
    const v = await load(s.id);
    assert.equal(v.courses[0].months.length, 14); // Jan 2026 .. Feb 2027
    assert.equal(v.courses[0].months[0].label, "Jan 2026");
    assert.equal(v.courses[0].cardMonth?.label, "Jan 2026");
  });

  test("the ahead limit is the panel's, and takePayment agrees: the last offered month is payable, the next is refused", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id }]);
    const v = await load(s.id);
    assert.equal(v.ahead, 3);
    const last = v.courses[0].months.at(-1)!;
    assert.equal(`${last.year}-${last.month}`, "2027-2"); // Nov + 3
    setSession("ADMIN", w.admin.id);
    const ok = await pay.takePayment({ studentId: s.id, admission: false, smartCard: false, classMonths: [{ courseId: c.id, year: last.year, month: last.month }], comboDecisions: [] });
    assert.equal(ok.ok, true);
    const next = await pay.takePayment({ studentId: s.id, admission: false, smartCard: false, classMonths: [{ courseId: c.id, year: 2027, month: 3 }], comboDecisions: [] });
    assert.deepEqual(next, { ok: false, error: "Cannot charge more than 3 months ahead." });
  });

  test("a month paid in advance shows as paid, with its day, not as ahead", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id }]);
    await settle(s.id, c.id, 2026, 12, { paidAt: "2026-11-09T06:00:00Z" });
    const dec = (await load(s.id)).courses[0].months.find((m) => m.month === 12)!;
    assert.equal(dec.state, "paid");
    assert.equal(dec.paidDay, 9);
  });

  test("a cancelled payment does not settle a month; a double-paid month shows the first day", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id }]);
    await settle(s.id, c.id, 2026, 8, { cancelled: true });
    await settle(s.id, c.id, 2026, 9, { paidAt: "2026-09-20T06:00:00Z" });
    await settle(s.id, c.id, 2026, 9, { paidAt: "2026-09-02T06:00:00Z" });
    const months = (await load(s.id)).courses[0].months;
    assert.equal(months.find((m) => m.month === 8)?.state, "unpaid");
    assert.equal(months.find((m) => m.month === 9)?.paidDay, 2);
  });

  test("the card and the calendar agree: the card month is the first unpaid month up to now, for every payment pattern", async () => {
    const patterns: number[][] = [[], [8], [9], [8, 9], [8, 9, 10], [8, 9, 10, 11], [10], [8, 10], [11], [8, 9, 10, 11, 12]];
    for (const paid of patterns) {
      const c = await course();
      const s = await student([{ courseId: c.id }]);
      for (const m of paid) await settle(s.id, c.id, 2026, m);
      const card = (await load(s.id)).courses[0];
      const firstUnpaid = card.months.find((m) => m.state === "unpaid");
      assert.equal(card.cardMonth?.label, firstUnpaid?.label, `paid ${JSON.stringify(paid)}`);
      if (!firstUnpaid) assert.notEqual(card.paidThisMonth, null, `paid ${JSON.stringify(paid)}`);
    }
  });

  test("the current month rolls at Colombo midnight", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id }]);
    for (const m of [8, 9]) await settle(s.id, c.id, 2026, m);
    try {
      freezeClock("2026-10-31T18:29:59Z"); // still 31 Oct
      assert.deepEqual((await load(s.id)).today, { year: 2026, month: 10 });
      freezeClock("2026-10-31T18:30:00Z"); // 1 Nov, 00:00 Colombo
      const v = await load(s.id);
      assert.deepEqual(v.today, { year: 2026, month: 11 });
      assert.equal(v.courses[0].months.find((m) => m.month === 11)?.owed, false);
    } finally {
      freezeClock(NOW);
    }
  });

  // ---- attendance --------------------------------------------------------------------------

  test("attended days are counted per course and month, and only for THIS student and course", async () => {
    const [a, b] = [await course(), await course()];
    const s = await student([{ courseId: a.id }, { courseId: b.id }]);
    const other = await student([{ courseId: a.id }]);
    for (const d of ["2026-10-03", "2026-10-10", "2026-10-17"]) await attend(db, { studentId: s.id, courseId: a.id, date: d, markedById: w.admin.id });
    await attend(db, { studentId: s.id, courseId: b.id, date: "2026-10-04", markedById: w.admin.id });
    await attend(db, { studentId: other.id, courseId: a.id, date: "2026-10-24", markedById: w.admin.id });
    await attend(db, { studentId: s.id, courseId: a.id, date: "2026-09-26", markedById: w.admin.id });

    const v = await load(s.id);
    const oct = (i: number) => v.courses[i].months.find((m) => m.month === 10)!.attended;
    assert.deepEqual([oct(0), oct(1)], [3, 1]);
    assert.equal(v.courses[0].months.find((m) => m.month === 9)!.attended, 1);
    assert.deepEqual(v.lastAttended, { [a.id]: "2026-10-17", [b.id]: "2026-10-04" });
  });

  test("a course never attended has lastAttended null", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id }]);
    assert.deepEqual((await load(s.id)).lastAttended, { [c.id]: null });
  });

  // ---- month detail: ONLY classes actually attended ------------------------------------------

  async function detailCourse(since = AUG) {
    const c = await course();
    const s = await student([{ courseId: c.id, since }]);
    return { c, s };
  }
  const detail = (s: { id: number }, c: { id: number }, year: number, month: number) => view.buildMonthDetail({ studentId: s.id, courseId: c.id, year, month });

  test("month detail lists exactly the attended classes, with the Colombo time marked", async () => {
    const { c, s } = await detailCourse();
    await attend(db, { studentId: s.id, courseId: c.id, date: "2026-10-10", markedById: w.admin.id, markedAt: "2026-10-10T04:45:00Z" });
    await attend(db, { studentId: s.id, courseId: c.id, date: "2026-10-03", markedById: w.admin.id, markedAt: "2026-10-03T04:50:00Z" });
    const d = await detail(s, c, 2026, 10);
    assert.ok(d);
    assert.deepEqual(d.rows, [
      { date: "2026-10-03", weekday: "Sat", time: "10:20 AM" },
      { date: "2026-10-10", weekday: "Sat", time: "10:15 AM" },
    ]);
    assert.deepEqual([d.attended, d.lastAttended, d.label], [2, "2026-10-10", "Oct 2026"]);
  });

  test("month detail invents nothing: no schedule, no one-off class, no absences, no 'of N'", async () => {
    // The timetable and additional classes must have NO effect on the result.
    const bare = await detailCourse();
    await attend(db, { studentId: bare.s.id, courseId: bare.c.id, date: "2026-10-10", markedById: w.admin.id, markedAt: "2026-10-10T04:45:00Z" });

    const busy = await detailCourse();
    for (const dow of ["SAT", "SUN", "TUE"] as const) await db.schedule.create({ data: { courseId: busy.c.id, dayOfWeek: dow, startTime: "09:00", endTime: "11:00" } });
    await db.additionalClass.create({ data: { courseId: busy.c.id, date: new Date("2026-10-14T00:00:00Z"), startTime: "15:00", endTime: "17:00" } });
    await attend(db, { studentId: busy.s.id, courseId: busy.c.id, date: "2026-10-10", markedById: w.admin.id, markedAt: "2026-10-10T04:45:00Z" });

    const a = await detail(bare.s, bare.c, 2026, 10);
    const b = await detail(busy.s, busy.c, 2026, 10);
    assert.deepEqual(b!.rows, a!.rows); // identical, whatever the timetable says
    assert.equal(b!.rows.length, 1);
    assert.equal(b!.attended, 1);
    assert.equal("held" in b!, false);
  });

  test("a month with no attendance is simply empty — even with a full timetable", async () => {
    const { c, s } = await detailCourse();
    await db.schedule.create({ data: { courseId: c.id, dayOfWeek: "SAT", startTime: "09:00", endTime: "11:00" } });
    const d = await detail(s, c, 2026, 10);
    assert.deepEqual(d!.rows, []);
    assert.deepEqual([d!.attended, d!.lastAttended], [0, null]);
  });

  test("a class attended on a day that is not on the timetable is listed like any other", async () => {
    const { c, s } = await detailCourse();
    await db.schedule.create({ data: { courseId: c.id, dayOfWeek: "SAT", startTime: "09:00", endTime: "11:00" } });
    await attend(db, { studentId: s.id, courseId: c.id, date: "2026-10-21", markedById: w.admin.id, markedAt: "2026-10-21T04:45:00Z" }); // a Wednesday
    assert.deepEqual((await detail(s, c, 2026, 10))!.rows.map((r) => [r.date, r.weekday]), [["2026-10-21", "Wed"]]);
  });

  test("month detail counts only THIS student, THIS course and THIS month — the same rows the calendar counts", async () => {
    const [a, b] = [await course(), await course()];
    const s = await student([{ courseId: a.id }, { courseId: b.id }]);
    const other = await student([{ courseId: a.id }]);
    for (const d of ["2026-09-26", "2026-10-03", "2026-10-31", "2026-11-07"]) await attend(db, { studentId: s.id, courseId: a.id, date: d, markedById: w.admin.id });
    await attend(db, { studentId: s.id, courseId: b.id, date: "2026-10-04", markedById: w.admin.id });
    await attend(db, { studentId: other.id, courseId: a.id, date: "2026-10-10", markedById: w.admin.id });
    const d = await detail(s, a, 2026, 10);
    assert.deepEqual(d!.rows.map((r) => r.date), ["2026-10-03", "2026-10-31"]); // both ends of the month, nothing outside it
    const calendar = (await load(s.id)).courses[0].months.find((m) => m.month === 10)!;
    assert.equal(d!.attended, calendar.attended);
  });

  test("month detail returns null unless the student is actively enrolled in the course", async () => {
    const c = await course();
    const stranger = await makeStudent(db);
    assert.equal(await detail(stranger, c, 2026, 10), null);
    const dropped = await makeStudent(db);
    await enrol(db, { studentId: dropped.id, courseId: c.id, tierId: w.tiers.FULL.id, since: AUG, status: "DROPPED" });
    assert.equal(await detail(dropped, c, 2026, 10), null);
  });

  test("month detail returns ONLY what the pop-up displays", async () => {
    const { c, s } = await detailCourse();
    await attend(db, { studentId: s.id, courseId: c.id, date: "2026-10-10", markedById: w.admin.id, markedAt: "2026-10-10T04:45:00Z" });
    const d = await detail(s, c, 2026, 10);
    assert.deepEqual(Object.keys(d!).sort(), ["attended", "course", "label", "lastAttended", "rows", "teacher"]);
    assert.deepEqual(Object.keys(d!.rows[0]).sort(), ["date", "time", "weekday"]);
  });
});
