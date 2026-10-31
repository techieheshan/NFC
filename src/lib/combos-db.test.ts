import { attend, dbSkip, enrol, freezeClock, makeCombo, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * Safety net for the Payment redesign (job 1): which combos a student
 * qualifies for, locked against real rows. The clock is frozen at 15 Oct 2026
 * (Colombo), so "the last completed month" is September 2026.
 */

const NOW = "2026-10-15T06:00:00Z";
const SINCE = "2026-04-01T06:00:00Z";

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let applicableCombos: typeof import("@/lib/combos").applicableCombos;

describe("applicableCombos against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    ({ applicableCombos } = await import("@/lib/combos"));
    w = await seedWorld(db);
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------
  /** n courses of one teacher with fees 2500, 1800, 1200, ... */
  async function courses(n: number, teacherId?: number) {
    const t = teacherId ?? (await makeTeacher(db)).id;
    const fees = ["2500", "1800", "1200", "900"];
    return { teacherId: t, list: await Promise.all(Array.from({ length: n }, (_, i) => makeCourse(db, w, { teacherId: t, fee: fees[i] }))) };
  }
  async function student(courseIds: number[], opts: { status?: "ACTIVE" | "DROPPED" } = {}) {
    const s = await makeStudent(db);
    for (const id of courseIds) await enrol(db, { studentId: s.id, courseId: id, tierId: w.tiers.FULL.id, since: SINCE, status: opts.status });
    return s;
  }
  const combo = (teacherId: number, ids: number[], active = true) =>
    makeCombo(db, { teacherId, active, items: ids.map((courseId) => ({ courseId, fee: "1000" })) });
  const ids = (cs: Awaited<ReturnType<typeof applicableCombos>>) => cs.map((c) => c.comboId);

  // ---- eligibility ------------------------------------------------------------------

  test("a combo qualifies only when EVERY one of its courses is actively enrolled", async () => {
    const { teacherId, list: [a, b] } = await courses(2);
    const c = await combo(teacherId, [a.id, b.id]);
    assert.deepEqual(ids(await applicableCombos((await student([a.id])).id)), []);
    assert.deepEqual(ids(await applicableCombos((await student([b.id])).id)), []);
    assert.deepEqual(ids(await applicableCombos((await student([a.id, b.id])).id)), [c.id]);
  });

  test("the offer carries the combo fee, the normal fee, the courses, the teacher and the month label", async () => {
    const { teacherId, list: [a, b] } = await courses(2);
    const c = await makeCombo(db, { teacherId, items: [{ courseId: a.id, fee: "2000" }, { courseId: b.id, fee: "1500.5" }] });
    const s = await student([a.id, b.id]);
    const [offer] = await applicableCombos(s.id);
    assert.equal(offer.comboId, c.id);
    assert.deepEqual(offer.courseIds, [a.id, b.id]);
    assert.deepEqual(offer.items.map((i) => [i.courseId, i.comboFee, i.defaultFee]), [[a.id, "2000.00", "2500.00"], [b.id, "1500.50", "1800.00"]]);
    assert.equal(offer.lastMonthLabel, "Sep 2026");
  });

  test("an inactive combo, a DROPPED enrolment, and a student with no enrolments are all not eligible", async () => {
    const { teacherId, list: [a, b] } = await courses(2);
    await combo(teacherId, [a.id, b.id], false);
    assert.deepEqual(await applicableCombos((await student([a.id, b.id])).id), []);

    const live = await courses(2);
    await combo(live.teacherId, live.list.map((c) => c.id));
    assert.deepEqual(await applicableCombos((await student(live.list.map((c) => c.id), { status: "DROPPED" })).id), []);
    assert.deepEqual(await applicableCombos((await makeStudent(db)).id), []);
  });

  test("a combo may span teachers", async () => {
    const [x, y] = [await courses(1), await courses(1)];
    const c = await combo(x.teacherId, [x.list[0].id, y.list[0].id]);
    assert.deepEqual(ids(await applicableCombos((await student([x.list[0].id, y.list[0].id])).id)), [c.id]);
  });

  // ---- which combo wins ---------------------------------------------------------------

  test("the fullest set wins, and a smaller combo overlapping it is skipped", async () => {
    const { teacherId, list: [a, b, c3] } = await courses(3);
    await combo(teacherId, [a.id, b.id]); // lower id, but smaller
    const big = await combo(teacherId, [a.id, b.id, c3.id]);
    assert.deepEqual(ids(await applicableCombos((await student([a.id, b.id, c3.id])).id)), [big.id]);
  });

  test("equal-size combos that overlap: the LOWER id wins and the other is skipped", async () => {
    const { teacherId, list: [a, b, c3] } = await courses(3);
    const first = await combo(teacherId, [a.id, b.id]);
    await combo(teacherId, [b.id, c3.id]); // shares course b
    assert.deepEqual(ids(await applicableCombos((await student([a.id, b.id, c3.id])).id)), [first.id]);
  });

  test("combos that do not overlap both apply, lowest id first among equals", async () => {
    const { teacherId, list: [a, b, c3, d] } = await courses(4);
    const one = await combo(teacherId, [a.id, b.id]);
    const two = await combo(teacherId, [c3.id, d.id]);
    assert.deepEqual(ids(await applicableCombos((await student([a.id, b.id, c3.id, d.id])).id)), [one.id, two.id]);
  });

  test("three active combos over the same two courses: only the LOWEST id ever applies", async () => {
    // Report 10.9: three duplicates exist in the demo data.
    const { teacherId, list: [a, b] } = await courses(2);
    const first = await combo(teacherId, [a.id, b.id]);
    await combo(teacherId, [a.id, b.id]);
    await combo(teacherId, [a.id, b.id]);
    assert.deepEqual(ids(await applicableCombos((await student([a.id, b.id])).id)), [first.id]);
  });

  // ---- the "last completed month" attendance count --------------------------------------

  test("CURRENT BEHAVIOUR (will change in job 3: combo rules): attendance is shown but never decides eligibility", async () => {
    const { teacherId, list: [a, b] } = await courses(2);
    await combo(teacherId, [a.id, b.id]);
    const s = await student([a.id, b.id]); // no attendance at all
    const [offer] = await applicableCombos(s.id);
    assert.deepEqual(offer.attendance.map((x) => x.days), [0, 0]);
  });

  test("attendance is counted per course over the last COMPLETED month (September), start inclusive, end exclusive", async () => {
    const { teacherId, list: [a, b] } = await courses(2);
    await combo(teacherId, [a.id, b.id]);
    const s = await student([a.id, b.id]);
    const other = await student([a.id, b.id]);
    const day = (courseId: number, date: string, studentId = s.id) => attend(db, { studentId, courseId, date, markedById: w.admin.id });

    await day(a.id, "2026-08-31"); // before the window
    await day(a.id, "2026-09-01"); // first day: counted
    await day(a.id, "2026-09-15");
    await day(a.id, "2026-09-30"); // last day: counted
    await day(a.id, "2026-10-01"); // after the window
    await day(b.id, "2026-09-10");
    await day(a.id, "2026-09-10", other.id); // someone else

    const [offer] = await applicableCombos(s.id);
    assert.deepEqual(offer.attendance.map((x) => [x.courseId, x.days]), [[a.id, 3], [b.id, 1]]);
  });

  test("the window follows the Colombo month: just before and just after midnight on 31 Oct", async () => {
    const { teacherId, list: [a, b] } = await courses(2);
    await combo(teacherId, [a.id, b.id]);
    const s = await student([a.id, b.id]);
    await attend(db, { studentId: s.id, courseId: a.id, date: "2026-09-10", markedById: w.admin.id });
    await attend(db, { studentId: s.id, courseId: a.id, date: "2026-10-31", markedById: w.admin.id });
    try {
      freezeClock("2026-10-31T18:29:59Z"); // 23:59:59 on 31 Oct, still October → window is September
      let [offer] = await applicableCombos(s.id);
      assert.equal(offer.lastMonthLabel, "Sep 2026");
      assert.equal(offer.attendance[0].days, 1);

      freezeClock("2026-10-31T18:30:00Z"); // midnight → November → window is October
      [offer] = await applicableCombos(s.id);
      assert.equal(offer.lastMonthLabel, "Oct 2026");
      assert.equal(offer.attendance[0].days, 1); // the 31 Oct class, not the September one
    } finally {
      freezeClock(NOW);
    }
  });

  test("in January the window is last December (year rollover)", async () => {
    const { teacherId, list: [a, b] } = await courses(2);
    await combo(teacherId, [a.id, b.id]);
    const s = await student([a.id, b.id]);
    await attend(db, { studentId: s.id, courseId: a.id, date: "2026-12-20", markedById: w.admin.id });
    try {
      freezeClock("2027-01-10T06:00:00Z");
      const [offer] = await applicableCombos(s.id);
      assert.equal(offer.lastMonthLabel, "Dec 2026");
      assert.equal(offer.attendance[0].days, 1);
    } finally {
      freezeClock(NOW);
    }
  });
});
