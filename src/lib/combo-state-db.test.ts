import { attend, dbSkip, enrol, freezeClock, makeCombo, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * Job 3A: the combo state on real rows. The clock is frozen at 15 Nov 2026 (Colombo), so
 * the last completed month is October 2026 and "new" means "enrolled in November".
 */

const NOW = "2026-11-15T06:00:00Z";
const OLD = "2026-08-05T06:00:00Z";

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let comboStates: typeof import("@/lib/combos").comboStates;
let applicableCombos: typeof import("@/lib/combos").applicableCombos;

describe("combo state against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    ({ comboStates, applicableCombos } = await import("@/lib/combos"));
    w = await seedWorld(db);
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------
  async function setup(specs: { since?: string; tier?: "FULL" | "HALF" | "FREE"; days?: number; status?: "ACTIVE" | "DROPPED" }[]) {
    const teacher = await makeTeacher(db);
    const courses = [];
    for (const [i] of specs.entries()) courses.push(await makeCourse(db, w, { teacherId: teacher.id, fee: String(2500 - i * 200) }));
    const combo = await makeCombo(db, { teacherId: teacher.id, items: courses.map((c) => ({ courseId: c.id, fee: "1000" })) });
    const student = await makeStudent(db);
    for (const [i, s] of specs.entries()) {
      await enrol(db, { studentId: student.id, courseId: courses[i].id, tierId: w.tiers[s.tier ?? "FULL"].id, since: s.since ?? OLD, status: s.status });
      for (let d = 0; d < (s.days ?? 0); d++) await attend(db, { studentId: student.id, courseId: courses[i].id, date: `2026-10-${String(3 + d * 7).padStart(2, "0")}`, markedById: w.admin.id });
    }
    return { teacher, courses, combo, student };
  }
  const stateOf = async (studentId: number, opts?: Parameters<typeof comboStates>[1]) => (await comboStates(studentId, opts)).map((c) => c.state);

  // ---- each state, on real enrolments ------------------------------------------------------

  test("auto: both classes attended last month, no decision needed", async () => {
    const { student } = await setup([{ days: 2 }, { days: 1 }]);
    assert.deepEqual(await stateOf(student.id), ["auto"]);
  });

  test("needs-confirmation: one class has 0 days last month", async () => {
    const { student } = await setup([{ days: 2 }, { days: 0 }]);
    assert.deepEqual(await stateOf(student.id), ["needs-confirmation"]);
  });

  test("attendance in OTHER months does not count: September only means 0 days for October", async () => {
    const { courses, student } = await setup([{ days: 2 }, { days: 0 }]);
    await attend(db, { studentId: student.id, courseId: courses[1].id, date: "2026-09-26", markedById: w.admin.id });
    await attend(db, { studentId: student.id, courseId: courses[1].id, date: "2026-11-03", markedById: w.admin.id });
    assert.deepEqual(await stateOf(student.id), ["needs-confirmation"]);
  });

  test("exempt-free: a FREE class — the combo applies even though the paid class has 0 days", async () => {
    const { student } = await setup([{ days: 0 }, { tier: "FREE", days: 0 }]);
    assert.deepEqual(await stateOf(student.id), ["exempt-free"]);
  });

  test("exempt-new: a class enrolled this month is not checked", async () => {
    const { student } = await setup([{ days: 2 }, { since: "2026-11-03T06:00:00Z", days: 0 }]);
    assert.deepEqual(await stateOf(student.id), ["exempt-new"]);
  });

  test("a new class does not excuse the OTHER class: 0 days there still needs a person", async () => {
    const { student } = await setup([{ days: 0 }, { since: "2026-11-03T06:00:00Z", days: 0 }]);
    assert.deepEqual(await stateOf(student.id), ["needs-confirmation"]);
  });

  test("off: the switch wins over every other state", async () => {
    const free = await setup([{ days: 0 }, { tier: "FREE" }]);
    const ok = await setup([{ days: 2 }, { days: 2 }]);
    const zero = await setup([{ days: 0 }, { days: 2 }]);
    for (const s of [free, ok, zero]) {
      assert.deepEqual(await stateOf(s.student.id, { switchedOff: new Set([s.combo.id]) }), ["off"]);
    }
  });

  test("the switch is per combo: switching off a different combo changes nothing", async () => {
    const { student } = await setup([{ days: 2 }, { days: 2 }]);
    assert.deepEqual(await stateOf(student.id, { switchedOff: new Set([999999]) }), ["auto"]);
  });

  // ---- the new-class date boundary, in Colombo time -------------------------------------------

  test("enrolled at 23:59:59 on 31 Oct (Colombo) is NOT new in mid-November — it was there for October", async () => {
    const { student } = await setup([{ days: 2 }, { since: "2026-10-31T18:29:59Z", days: 0 }]);
    assert.deepEqual(await stateOf(student.id), ["needs-confirmation"]);
  });

  test("enrolled at 00:00:00 on 1 Nov (Colombo) IS new in mid-November", async () => {
    const { student } = await setup([{ days: 2 }, { since: "2026-10-31T18:30:00Z", days: 0 }]);
    assert.deepEqual(await stateOf(student.id), ["exempt-new"]);
  });

  test("the exemption ends at the Colombo midnight that starts the month AFTER the enrolment month", async () => {
    const { student } = await setup([{ days: 2 }, { since: "2026-11-20T06:00:00Z", days: 0 }]);
    try {
      freezeClock("2026-11-30T18:29:59Z"); // 23:59:59 on 30 Nov: still November, the class is new
      assert.deepEqual(await stateOf(student.id), ["exempt-new"]);
      freezeClock("2026-11-30T18:30:00Z"); // 00:00 on 1 Dec: November is now the completed month; the class had 0 days in it
      assert.deepEqual(await stateOf(student.id), ["needs-confirmation"]);
    } finally {
      freezeClock(NOW);
    }
  });

  test("across the year end: a class enrolled in December is new until 1 January (Colombo), then checked against December", async () => {
    const { student } = await setup([{ days: 0 }, { since: "2026-12-10T06:00:00Z", days: 0 }]);
    try {
      freezeClock("2026-12-31T18:29:59Z");
      const [c] = await comboStates(student.id);
      assert.deepEqual(c.classes.map((x) => x.isNew), [false, true]);
      freezeClock("2026-12-31T18:30:00Z"); // 1 Jan 2027 in Colombo; the completed month is December 2026
      const [d] = await comboStates(student.id);
      assert.deepEqual(d.classes.map((x) => x.isNew), [false, false]);
    } finally {
      freezeClock(NOW);
    }
  });

  // ---- which combos exist at all (selection rule unchanged) ---------------------------------------

  test("a combo with a DROPPED class has no state at all — it is not offered (the existing rule)", async () => {
    const { student } = await setup([{ days: 2 }, { days: 2, status: "DROPPED" }]);
    assert.deepEqual(await comboStates(student.id), []);
  });

  test("three classes: needs-confirmation for one 0-day class, auto when all attended, exempt-free beside a free one", async () => {
    const zero = await setup([{ days: 2 }, { days: 2 }, { days: 0 }]);
    assert.deepEqual(await stateOf(zero.student.id), ["needs-confirmation"]);
    const ok = await setup([{ days: 1 }, { days: 1 }, { days: 1 }]);
    assert.deepEqual(await stateOf(ok.student.id), ["auto"]);
    const free = await setup([{ days: 0 }, { days: 0 }, { tier: "FREE" }]);
    assert.deepEqual(await stateOf(free.student.id), ["exempt-free"]);
    const mixed = await setup([{ days: 2 }, { days: 2 }, { since: "2026-11-02T06:00:00Z", days: 0 }]);
    assert.deepEqual(await stateOf(mixed.student.id), ["exempt-new"]);
  });

  test("two combos that do not overlap each get their OWN state", async () => {
    const teacher = await makeTeacher(db);
    const cs = await Promise.all([1, 2, 3, 4].map((i) => makeCourse(db, w, { teacherId: teacher.id, fee: String(2000 + i) })));
    const c1 = await makeCombo(db, { teacherId: teacher.id, items: [cs[0], cs[1]].map((c) => ({ courseId: c.id, fee: "1000" })) });
    const c2 = await makeCombo(db, { teacherId: teacher.id, items: [cs[2], cs[3]].map((c) => ({ courseId: c.id, fee: "1000" })) });
    const student = await makeStudent(db);
    for (const c of cs) await enrol(db, { studentId: student.id, courseId: c.id, tierId: w.tiers.FULL.id, since: OLD });
    for (const c of [cs[0], cs[1], cs[2]]) await attend(db, { studentId: student.id, courseId: c.id, date: "2026-10-10", markedById: w.admin.id });
    const got = await comboStates(student.id);
    assert.deepEqual(got.map((c) => [c.comboId, c.state]), [[c1.id, "auto"], [c2.id, "needs-confirmation"]]);
  });

  test("the fullest-set / lowest-id selection is unchanged: three combos over the same two classes → only the lowest id", async () => {
    const teacher = await makeTeacher(db);
    const cs = await Promise.all([1, 2].map((i) => makeCourse(db, w, { teacherId: teacher.id, fee: String(2100 + i) })));
    const first = await makeCombo(db, { teacherId: teacher.id, items: cs.map((c) => ({ courseId: c.id, fee: "1000" })) });
    await makeCombo(db, { teacherId: teacher.id, items: cs.map((c) => ({ courseId: c.id, fee: "1000" })) });
    await makeCombo(db, { teacherId: teacher.id, items: cs.map((c) => ({ courseId: c.id, fee: "1000" })) });
    const student = await makeStudent(db);
    for (const c of cs) await enrol(db, { studentId: student.id, courseId: c.id, tierId: w.tiers.FULL.id, since: OLD });
    assert.deepEqual((await comboStates(student.id)).map((c) => c.comboId), [first.id]);
  });

  test("comboStates adds fields to applicableCombos and changes none of the existing ones", async () => {
    const { student } = await setup([{ days: 2 }, { days: 1 }]);
    const plain = await applicableCombos(student.id);
    const rich = await comboStates(student.id);
    const withoutNew = rich.map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== "state" && k !== "classes")));
    assert.deepEqual(withoutNew, plain);
    assert.deepEqual(rich[0].classes, [
      { courseId: plain[0].courseIds[0], free: false, isNew: false, days: 2 },
      { courseId: plain[0].courseIds[1], free: false, isNew: false, days: 1 },
    ]);
  });
});
