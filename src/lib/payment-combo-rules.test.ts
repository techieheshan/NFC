import { attend, dbSkip, enrol, freezeClock, makeCombo, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * Job 3A: what takePayment does with each combo state. The clock is frozen at 10 Nov 2026
 * (Colombo), so the last completed month is OCTOBER and "new" means enrolled in November.
 *
 *   auto / exempt-new / exempt-free  the combo applies on its own — no answer needed
 *   needs-confirmation               a class has 0 days: a person answers, "No" needs a reason
 *   off                              staff switched it off: normal rate, no reason needed
 *
 * Old clients answer EVERY touched combo; that must keep working in every state.
 */

const NOW = "2026-11-10T06:00:00Z";
const OLD = "2026-08-05T06:00:00Z";
const NEW = "2026-11-03T06:00:00Z";
const NOV = { year: 2026, month: 11 };

type Tier = "FULL" | "HALF" | "FREE";
type Spec = { since?: string; tier?: Tier; days?: number };
type Decision = { comboId: number; apply: boolean; reason?: string; off?: boolean };

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let pay: typeof import("@/app/(app)/payment/actions");

describe("combo rules in takePayment against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    pay = await import("@/app/(app)/payment/actions");
    w = await seedWorld(db);
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------
  const dec = (d: { toFixed: (n: number) => string } | null) => d?.toFixed(2);
  const rows = (studentId: number) => db.payment.findMany({ where: { studentId }, orderBy: { id: "asc" } });

  /** A two-class combo (normal 2500 / 1700, combo 2000 / 1300) and a student enrolled in both. */
  async function setup(a: Spec, b: Spec) {
    const teacher = await makeTeacher(db);
    const ca = await makeCourse(db, w, { teacherId: teacher.id, fee: "2500", name: `RA${Math.random().toString(36).slice(2, 6)}` });
    const cb = await makeCourse(db, w, { teacherId: teacher.id, fee: "1700", name: `RB${Math.random().toString(36).slice(2, 6)}` });
    const combo = await makeCombo(db, { teacherId: teacher.id, items: [{ courseId: ca.id, fee: "2000" }, { courseId: cb.id, fee: "1300" }] });
    const student = await makeStudent(db);
    for (const [c, s] of [[ca, a], [cb, b]] as const) {
      await enrol(db, { studentId: student.id, courseId: c.id, tierId: w.tiers[s.tier ?? "FULL"].id, since: s.since ?? OLD });
      for (let d = 0; d < (s.days ?? 0); d++) await attend(db, { studentId: student.id, courseId: c.id, date: `2026-10-${String(5 + d * 7).padStart(2, "0")}`, markedById: w.admin.id });
    }
    return { ca, cb, combo, student };
  }
  async function charge(studentId: number, courses: { id: number }[], comboDecisions: Decision[] = []) {
    setSession("ADMIN", w.admin.id);
    return pay.takePayment({ studentId, admission: false, smartCard: false, classMonths: courses.map((c) => ({ courseId: c.id, ...NOV })), comboDecisions });
  }
  const amounts = async (studentId: number) => (await rows(studentId)).map((r) => dec(r.amount));
  const MISSING = { ok: false, error: "A combined-rate decision is missing." };
  const NEEDS_REASON = { ok: false, error: "A reason is required when the combined rate is refused." };

  // ---- applies on its own -----------------------------------------------------------------------------

  test("auto: both classes attended last month — the combo applies with NO decision at all", async () => {
    const { ca, cb, combo, student } = await setup({ days: 2 }, { days: 1 });
    const res = await charge(student.id, [ca, cb]);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(await amounts(student.id), ["2000.00", "1300.00"]);
    for (const r of await rows(student.id)) assert.deepEqual([r.comboId, r.comboApplied, r.comboRefusedReason], [combo.id, true, null]);
  });

  test("auto: paying just ONE class of the combo still gets the combo rate, without a question", async () => {
    const { ca, student } = await setup({ days: 2 }, { days: 1 });
    assert.equal((await charge(student.id, [ca])).ok, true);
    assert.deepEqual(await amounts(student.id), ["2000.00"]);
  });

  test("exempt-free: the combo applies to the paid class with no question, even though it has 0 days", async () => {
    const { ca, combo, student } = await setup({ days: 0 }, { tier: "FREE" });
    const res = await charge(student.id, [ca]);
    assert.equal(res.ok, true, JSON.stringify(res));
    const [row] = await rows(student.id);
    assert.deepEqual([dec(row.amount), row.comboId, row.comboApplied], ["2000.00", combo.id, true]);
  });

  test("exempt-free: the free class itself is still never charged", async () => {
    const { cb, student } = await setup({ days: 0 }, { tier: "FREE" });
    assert.deepEqual(await charge(student.id, [cb]), { ok: false, error: "Free-tier courses are not charged." });
  });

  test("exempt-new: a class that began this month has no completed month, so no question is asked", async () => {
    const { ca, cb, student } = await setup({ days: 2 }, { since: NEW, days: 0 });
    const res = await charge(student.id, [ca, cb]);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(await amounts(student.id), ["2000.00", "1300.00"]);
  });

  test("exempt-new for the new student too: BOTH classes began this month", async () => {
    const { ca, cb, student } = await setup({ since: NEW }, { since: NEW });
    assert.equal((await charge(student.id, [ca, cb])).ok, true);
    assert.deepEqual(await amounts(student.id), ["2000.00", "1300.00"]);
  });

  test("a new class does not excuse the other one: 0 days there still asks the question", async () => {
    const { ca, cb, student } = await setup({ days: 0 }, { since: NEW });
    assert.deepEqual(await charge(student.id, [ca, cb]), MISSING);
  });

  test("HALF month inside an automatic combo is half of the combo fee", async () => {
    const { ca, student } = await setup({ days: 2 }, { days: 2 });
    setSession("ADMIN", w.admin.id);
    const res = await pay.takePayment({ studentId: student.id, admission: false, smartCard: false, classMonths: [{ courseId: ca.id, ...NOV, mode: "HALF" }], comboDecisions: [] });
    assert.equal(res.ok, true);
    assert.deepEqual(await amounts(student.id), ["1000.00"]);
  });

  // ---- needs a person -------------------------------------------------------------------------------------------

  test("needs-confirmation: a class with 0 days last month still REQUIRES a decision, as today", async () => {
    const { ca, cb, student } = await setup({ days: 2 }, { days: 0 });
    assert.deepEqual(await charge(student.id, [ca, cb]), MISSING);
    assert.equal((await rows(student.id)).length, 0);
  });

  test("needs-confirmation: 'Yes' applies the combo; 'No' needs a reason and charges the normal rate", async () => {
    const yes = await setup({ days: 2 }, { days: 0 });
    assert.equal((await charge(yes.student.id, [yes.ca, yes.cb], [{ comboId: yes.combo.id, apply: true }])).ok, true);
    assert.deepEqual(await amounts(yes.student.id), ["2000.00", "1300.00"]);

    const no = await setup({ days: 2 }, { days: 0 });
    for (const reason of [undefined, "", "   "]) {
      assert.deepEqual(await charge(no.student.id, [no.ca, no.cb], [{ comboId: no.combo.id, apply: false, reason }]), NEEDS_REASON);
    }
    assert.equal((await charge(no.student.id, [no.ca, no.cb], [{ comboId: no.combo.id, apply: false, reason: "  never came to Paper  " }])).ok, true);
    const rs = await rows(no.student.id);
    assert.deepEqual(rs.map((r) => dec(r.amount)), ["2500.00", "1700.00"]);
    for (const r of rs) assert.deepEqual([r.comboApplied, r.comboRefusedReason], [false, "never came to Paper"]);
  });

  // ---- old clients keep working in every state ----------------------------------------------------------------------

  test("an old client that answers 'Yes' for a combo that now applies on its own: same amounts, nothing recorded differently", async () => {
    const auto = await setup({ days: 2 }, { days: 2 });
    const asked = await setup({ days: 2 }, { days: 0 });
    for (const s of [auto, asked]) assert.equal((await charge(s.student.id, [s.ca, s.cb], [{ comboId: s.combo.id, apply: true }])).ok, true);
    const strip = async (id: number) => (await rows(id)).map((r) => [dec(r.amount), r.comboApplied, r.comboRefusedReason]);
    assert.deepEqual(await strip(auto.student.id), await strip(asked.student.id));
  });

  test("an old client's REFUSAL is honoured even when the combo would have applied on its own", async () => {
    for (const spec of [[{ days: 2 }, { days: 2 }], [{ days: 0 }, { tier: "FREE" as Tier }], [{ days: 2 }, { since: NEW }]] as [Spec, Spec][]) {
      const s = await setup(spec[0], spec[1]);
      const paying = spec[1].tier === "FREE" ? [s.ca] : [s.ca, s.cb];
      // a refusal still needs its reason, exactly as before
      assert.deepEqual(await charge(s.student.id, paying, [{ comboId: s.combo.id, apply: false }]), NEEDS_REASON);
      assert.equal((await charge(s.student.id, paying, [{ comboId: s.combo.id, apply: false, reason: "teacher said no" }])).ok, true);
      const rs = await rows(s.student.id);
      assert.deepEqual(rs.map((r) => dec(r.amount)), spec[1].tier === "FREE" ? ["2500.00"] : ["2500.00", "1700.00"]);
      for (const r of rs) assert.deepEqual([r.comboApplied, r.comboRefusedReason], [false, "teacher said no"]);
    }
  });

  test("a decision for a combo this checkout does not touch is still ignored", async () => {
    const touched = await setup({ days: 2 }, { days: 2 });
    const other = await setup({ days: 2 }, { days: 2 });
    assert.equal((await charge(touched.student.id, [touched.ca], [{ comboId: other.combo.id, apply: false, reason: "x" }])).ok, true);
    assert.deepEqual(await amounts(touched.student.id), ["2000.00"]); // the stray refusal changed nothing
  });

  // ---- staff switch it off ------------------------------------------------------------------------------------------------

  test("off: normal rate, recorded as not applied with NO reason text — and no reason is required", async () => {
    const { ca, cb, combo, student } = await setup({ days: 2 }, { days: 2 });
    const res = await charge(student.id, [ca, cb], [{ comboId: combo.id, apply: false, off: true }]);
    assert.equal(res.ok, true, JSON.stringify(res));
    const rs = await rows(student.id);
    assert.deepEqual(rs.map((r) => dec(r.amount)), ["2500.00", "1700.00"]);
    for (const r of rs) assert.deepEqual([r.comboId, r.comboApplied, r.comboRefusedReason], [combo.id, false, null]);
  });

  test("off works in EVERY state: needs-confirmation, exempt-free, exempt-new and auto", async () => {
    const cases: [string, Spec, Spec, boolean][] = [
      ["needs-confirmation", { days: 2 }, { days: 0 }, false],
      ["exempt-free", { days: 0 }, { tier: "FREE" }, true],
      ["exempt-new", { days: 2 }, { since: NEW }, false],
      ["auto", { days: 2 }, { days: 2 }, false],
    ];
    for (const [name, a, b, onlyFirst] of cases) {
      const s = await setup(a, b);
      const res = await charge(s.student.id, onlyFirst ? [s.ca] : [s.ca, s.cb], [{ comboId: s.combo.id, apply: false, off: true }]);
      assert.equal(res.ok, true, `${name}: ${JSON.stringify(res)}`);
      const rs = await rows(s.student.id);
      assert.equal(dec(rs[0].amount), "2500.00", name);
      assert.deepEqual([rs[0].comboApplied, rs[0].comboRefusedReason], [false, null], name);
    }
  });

  test("off wins over a contradictory apply: true, and a typed reason is not stored (off means no reason text)", async () => {
    const { ca, combo, student } = await setup({ days: 2 }, { days: 2 });
    assert.equal((await charge(student.id, [ca], [{ comboId: combo.id, apply: true, off: true, reason: "ignored" }])).ok, true);
    const [row] = await rows(student.id);
    assert.deepEqual([dec(row.amount), row.comboApplied, row.comboRefusedReason], ["2500.00", false, null]);
  });

  test("off is per combo: switching one off leaves another combo in the same checkout automatic", async () => {
    const teacher = await makeTeacher(db);
    const cs = await Promise.all([1, 2, 3, 4].map((i) => makeCourse(db, w, { teacherId: teacher.id, fee: "2500", name: `T${i}${Math.random().toString(36).slice(2, 5)}` })));
    const c1 = await makeCombo(db, { teacherId: teacher.id, items: [cs[0], cs[1]].map((c) => ({ courseId: c.id, fee: "2000" })) });
    const c2 = await makeCombo(db, { teacherId: teacher.id, items: [cs[2], cs[3]].map((c) => ({ courseId: c.id, fee: "2000" })) });
    const student = await makeStudent(db);
    for (const c of cs) {
      await enrol(db, { studentId: student.id, courseId: c.id, tierId: w.tiers.FULL.id, since: OLD });
      await attend(db, { studentId: student.id, courseId: c.id, date: "2026-10-10", markedById: w.admin.id });
    }
    assert.equal((await charge(student.id, cs, [{ comboId: c1.id, apply: false, off: true }])).ok, true);
    assert.deepEqual(await amounts(student.id), ["2500.00", "2500.00", "2000.00", "2000.00"]);
    void c2;
  });

  test("two combos in one checkout: only the one that needs a person asks for an answer", async () => {
    const teacher = await makeTeacher(db);
    const cs = await Promise.all([1, 2, 3, 4].map((i) => makeCourse(db, w, { teacherId: teacher.id, fee: "2500", name: `U${i}${Math.random().toString(36).slice(2, 5)}` })));
    const c1 = await makeCombo(db, { teacherId: teacher.id, items: [cs[0], cs[1]].map((c) => ({ courseId: c.id, fee: "2000" })) });
    const c2 = await makeCombo(db, { teacherId: teacher.id, items: [cs[2], cs[3]].map((c) => ({ courseId: c.id, fee: "2000" })) });
    const student = await makeStudent(db);
    for (const [i, c] of cs.entries()) {
      await enrol(db, { studentId: student.id, courseId: c.id, tierId: w.tiers.FULL.id, since: OLD });
      if (i !== 3) await attend(db, { studentId: student.id, courseId: c.id, date: "2026-10-10", markedById: w.admin.id }); // class 4 has 0 days
    }
    assert.deepEqual(await charge(student.id, cs), MISSING); // c2 needs a person; c1 does not
    assert.equal((await rows(student.id)).length, 0);
    assert.equal((await charge(student.id, cs, [{ comboId: c2.id, apply: true }])).ok, true);
    assert.deepEqual(await amounts(student.id), ["2000.00", "2000.00", "2000.00", "2000.00"]);
    void c1;
  });

  test("a student who is not eligible still cannot claim a combo, whatever the client says", async () => {
    const { ca, combo } = await setup({ days: 2 }, { days: 2 });
    const solo = await makeStudent(db);
    await enrol(db, { studentId: solo.id, courseId: ca.id, tierId: w.tiers.FULL.id, since: OLD });
    assert.equal((await charge(solo.id, [ca], [{ comboId: combo.id, apply: true }])).ok, true);
    const [row] = await rows(solo.id);
    assert.deepEqual([dec(row.amount), row.comboId, row.comboApplied], ["2500.00", null, false]);
  });
});
