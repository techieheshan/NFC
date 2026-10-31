import { attend, dbSkip, enrol, freezeClock, makeCombo, makeCourse, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * Job 5: Half and No-charge months in the reports, against numbers worked out BY HAND. Money is
 * real: every row is written by the real takePayment (and cancelled by the real cancelTransaction).
 *
 * The rules under test:
 *   - a No-charge month is settled but is not cash: 0.00 everywhere, and it is not a paying student;
 *   - a Half month is a real payment of half the fee: its student is a normal payer of THEIR tier
 *     ("Half" in Daily Summary and payslips is the HALF TIER; the tier columns are unchanged), and
 *     the month shows on its own extra line;
 *   - cancelled rows are in nothing.
 *
 * Each test has its own calendar month (the clock is frozen inside it), its own teacher and its own
 * courses, so every figure — including the month-wide ones — belongs to that test alone.
 */

const SINCE = "2025-12-05T06:00:00Z";

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let quarterTierId: number;
let pay: typeof import("@/app/(app)/payment/actions");
let rec: typeof import("@/app/(app)/receipts/actions");
let reports: typeof import("@/lib/reports");

type Tier = "FULL" | "HALF" | "QUARTER";
type Mode = "FULL" | "HALF" | "NO_CHARGE";

describe("Half and No-charge months in the reports (hand-computed)", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock("2026-01-10T06:00:00Z");
    ({ db } = await import("@/lib/db"));
    pay = await import("@/app/(app)/payment/actions");
    rec = await import("@/app/(app)/receipts/actions");
    reports = await import("@/lib/reports");
    w = await seedWorld(db, { admissionFee: "1300", smartCardFee: "500" });
    quarterTierId = (await db.feeTier.create({ data: { code: "QUARTER", label: "25%", multiplier: "0.250" } })).id;
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------------------------

  const pad = (n: number) => String(n).padStart(2, "0");
  /** Month `m` of 2026, the clock on the 10th at 11:30 Colombo. */
  const monthDay = (m: number) => `2026-${pad(m)}-10`;
  const clock = (m: number) => freezeClock(`${monthDay(m)}T06:00:00Z`);
  const tierId = (t: Tier) => (t === "QUARTER" ? quarterTierId : w.tiers[t].id);

  let n = 0;
  async function institute(m: number, fees: { ict: string; chem?: string } = { ict: "2500" }) {
    clock(m);
    const teacher = await makeTeacher(db, `T${m}-${++n}`);
    const ict = await makeCourse(db, w, { teacherId: teacher.id, fee: fees.ict, share: "20.00", name: `ICT${m}-${n}` });
    const chem = fees.chem ? await makeCourse(db, w, { teacherId: teacher.id, fee: fees.chem, share: "25.00", name: `CHEM${m}-${n}` }) : null;
    return { teacher, ict, chem, month: m };
  }
  async function student(name: string, courses: { id: number }[], tier: Tier = "FULL") {
    const s = await db.student.create({ data: { name: `${name}-${++n}`, cardNumber: `HN-${n}` } });
    for (const c of courses) await enrol(db, { studentId: s.id, courseId: c.id, tierId: tierId(tier), since: SINCE });
    return s;
  }
  const NOV = (m: number) => ({ year: 2026, month: m });
  async function take(studentId: number, months: { courseId: number; year: number; month: number; mode?: Mode }[]) {
    setSession("ADMIN", w.admin.id);
    const res = await pay.takePayment({ studentId, admission: false, smartCard: false, comboDecisions: [], classMonths: months });
    assert.equal(res.ok, true, JSON.stringify(res));
    return (res as Extract<typeof res, { ok: true }>).receipt;
  }
  async function cancel(studentId: number) {
    setSession("ADMIN", w.admin.id);
    const f = new FormData();
    f.set("key", `ref:${(await db.payment.findFirstOrThrow({ where: { studentId, cancelled: false } })).transactionRef}`);
    f.set("reason", "test cancel");
    assert.deepEqual(await rec.cancelTransaction({ ok: false }, f), { ok: true });
  }
  const summary = (m: number) => reports.dailySummary(monthDay(m), monthDay(m));
  const rowOf = (s: Awaited<ReturnType<typeof summary>>, courseId: number) => s.courses.find((c) => c.courseId === courseId)!;
  const shape = (r: { registered: number; paidFull: number; paidHalf: number; paidQuarter: number; notPaid: number; free: number; amount: string; reconciles: boolean }) =>
    [r.registered, r.paidFull, r.paidHalf, r.paidQuarter, r.notPaid, r.free, r.amount, r.reconciles];

  // ---- Daily Summary ----------------------------------------------------------------------------

  test("DAILY SUMMARY, hand-computed: Full / Half / Quarter tier students each paying Full, a Half month and No charge", async () => {
    const { ict, month } = await institute(2);
    const m = NOV(month);
    const A = await student("A", [ict]); await take(A.id, [{ courseId: ict.id, ...m }]); //                     Full tier, Full           2500.00
    const B = await student("B", [ict]); await take(B.id, [{ courseId: ict.id, ...m, mode: "HALF" }]); //       Full tier, HALF MONTH     1250.00
    const C = await student("C", [ict]); await take(C.id, [{ courseId: ict.id, ...m, mode: "NO_CHARGE" }]); //  Full tier, No charge         0.00
    const D = await student("D", [ict], "HALF"); await take(D.id, [{ courseId: ict.id, ...m }]); //             Half tier, normal         1250.00
    const E = await student("E", [ict], "HALF"); await take(E.id, [{ courseId: ict.id, ...m, mode: "HALF" }]); // Half tier, HALF MONTH      625.00
    const F = await student("F", [ict], "HALF"); await take(F.id, [{ courseId: ict.id, ...m, mode: "NO_CHARGE" }]); // Half tier, No charge    0.00
    const G = await student("G", [ict], "QUARTER"); await take(G.id, [{ courseId: ict.id, ...m }]); //         Quarter tier, normal       625.00
    const H = await student("H", [ict], "QUARTER"); await take(H.id, [{ courseId: ict.id, ...m, mode: "HALF" }]); // Quarter tier, HALF MONTH 312.50
    const I = await student("I", [ict], "QUARTER"); await take(I.id, [{ courseId: ict.id, ...m, mode: "NO_CHARGE" }]); // Quarter, No charge  0.00
    await student("O", [ict]); //                                                                               never paid

    const s = await summary(month);
    // registered 10. Paid, by TIER: Full A + B = 2; Half D + E = 2; Quarter G + H = 2. The three No-charge
    // students (C, F, I) paid nothing, so they are NOT paid; with O that is 4 not paid. 10 = 6 + 4 + 0.
    // Amount: 2500 + 1250 + 0 + 1250 + 625 + 0 + 625 + 312.50 + 0 = 6562.50.
    assert.deepEqual(shape(rowOf(s, ict.id)), [10, 2, 2, 2, 4, 0, "6562.50", true]);
    // Half MONTHS: B 1250 + E 625 + H 312.50 = 3 months, 2187.50. No-charge months: C, F, I = 3.
    assert.deepEqual(s.halfMonths, { count: 3, total: "2187.50" });
    assert.deepEqual(s.noChargeMonths, { count: 3 });
    assert.equal(s.classTotal, "6562.50");
    assert.equal(s.totalCollected, "6562.50");
  });

  test("DAILY SUMMARY: a student with a normal paid row AND a No-charge row in the same course and range still counts as paid", async () => {
    const { ict, month } = await institute(3);
    const J = await student("J", [ict]);
    // one receipt: January ignored (No charge) and this month paid in full — same course, same day
    await take(J.id, [{ courseId: ict.id, year: 2026, month: 1, mode: "NO_CHARGE" }, { courseId: ict.id, ...NOV(month) }]);
    const K = await student("K", [ict]);
    await take(K.id, [{ courseId: ict.id, year: 2026, month: 1, mode: "NO_CHARGE" }]); // only a No-charge row: NOT paid

    const s = await summary(month);
    // registered 2: J paid (Full) = 1; K not paid = 1. Amount 2500.00. J's No-charge month is still a No-charge MONTH.
    assert.deepEqual(shape(rowOf(s, ict.id)), [2, 1, 0, 0, 1, 0, "2500.00", true]);
    assert.deepEqual(s.noChargeMonths, { count: 2 }); // J's January and K's January
    assert.equal(s.halfMonths, undefined);
  });

  test("DAILY SUMMARY: a combo month recorded as No charge, and combo months paid as Half", async () => {
    const { teacher, ict, chem, month } = await institute(4, { ict: "2500", chem: "3400" });
    await makeCombo(db, { teacherId: teacher.id, items: [{ courseId: ict.id, fee: "2000" }, { courseId: chem!.id, fee: "2600" }] });
    // The combo is "auto" when both classes were attended last month (March).
    const K = await student("K", [ict, chem!]);
    const L = await student("L", [ict, chem!]);
    for (const s of [K, L]) for (const c of [ict, chem!]) await attend(db, { studentId: s.id, courseId: c.id, date: "2026-03-07", markedById: w.admin.id });

    // K: ICT in full at the combo rate (2000) and Chemistry recorded as No charge — a No-charge
    // month is outside the combo, so ICT keeps its combo price.
    await take(K.id, [{ courseId: ict.id, ...NOV(month) }, { courseId: chem!.id, ...NOV(month), mode: "NO_CHARGE" }]);
    // L: both classes as Half months: half of 2000 and half of 2600.
    await take(L.id, [{ courseId: ict.id, ...NOV(month), mode: "HALF" }, { courseId: chem!.id, ...NOV(month), mode: "HALF" }]);

    const s = await summary(month);
    assert.deepEqual(shape(rowOf(s, ict.id)), [2, 2, 0, 0, 0, 0, "3000.00", true]); // 2000 + 1000; both paid (K paid ICT)
    assert.deepEqual(shape(rowOf(s, chem!.id)), [2, 1, 0, 0, 1, 0, "1300.00", true]); // L paid 1300; K's Chemistry is No charge → not paid
    assert.deepEqual(s.halfMonths, { count: 2, total: "2300.00" }); // 1000 + 1300
    assert.deepEqual(s.noChargeMonths, { count: 1 });
    assert.equal(s.classTotal, "4300.00");
    // K's No-charge row: stored outside the combo (comboId null), as the 3A decision says
    const kc = await db.payment.findFirstOrThrow({ where: { studentId: K.id, courseId: chem!.id } });
    assert.deepEqual([kc.comboId, kc.comboApplied, kc.chargeMode, kc.amount.toFixed(2)], [null, false, "NO_CHARGE", "0.00"]);
  });

  test("DAILY SUMMARY: a cancelled Half and a cancelled No-charge row are in no count, no extra line and no total", async () => {
    const { ict, month } = await institute(5);
    const keep = await student("keep", [ict]); await take(keep.id, [{ courseId: ict.id, ...NOV(month) }]);
    const voidHalf = await student("voidHalf", [ict]); await take(voidHalf.id, [{ courseId: ict.id, ...NOV(month), mode: "HALF" }]);
    const voidFree = await student("voidFree", [ict]); await take(voidFree.id, [{ courseId: ict.id, ...NOV(month), mode: "NO_CHARGE" }]);
    await cancel(voidHalf.id);
    await cancel(voidFree.id);

    const s = await summary(month);
    // only `keep` paid: 1 Full, 2500.00. The two cancelled students are simply not paid.
    assert.deepEqual(shape(rowOf(s, ict.id)), [3, 1, 0, 0, 2, 0, "2500.00", true]);
    assert.equal(s.halfMonths, undefined, "a cancelled Half month is not a Half month");
    assert.equal(s.noChargeMonths, undefined, "a cancelled No-charge month is not a No-charge month");
    assert.equal(s.classTotal, "2500.00");
  });

  test("DAILY SUMMARY: with no Half and no No-charge month the report has exactly the keys it always had", async () => {
    const { ict, month } = await institute(6);
    const a = await student("a", [ict]); await take(a.id, [{ courseId: ict.id, ...NOV(month) }]);
    const s = await summary(month);
    assert.equal("halfMonths" in s, false);
    assert.equal("noChargeMonths" in s, false);
    assert.deepEqual(Object.keys(s), ["from", "to", "courses", "admission", "smartCard", "classTotal", "totalCollected", "deductionLines", "deductions", "net"]);
  });

  test("DAILY SUMMARY: rows with a NULL chargeMode — every row written before the column — still count as paid (the NULL is never dropped)", async () => {
    const { ict, month } = await institute(7);
    const old = await student("old", [ict]);
    // a legacy-style row: written directly, chargeMode NULL, no ref
    await db.payment.create({ data: { kind: "CLASS", studentId: old.id, courseId: ict.id, billingYear: 2026, billingMonth: month, feeTierId: w.tiers.FULL.id, amount: "2500.00", instituteSharePercentApplied: "20.00", takenById: w.admin.id, paidAt: new Date(`${monthDay(month)}T06:00:00Z`), transactionRef: null } });
    const s = await summary(month);
    assert.deepEqual(shape(rowOf(s, ict.id)), [1, 1, 0, 0, 0, 0, "2500.00", true]);
  });

  test("DAILY SUMMARY reconciles with and without these rows, over a longer range too", async () => {
    const { ict, month } = await institute(8);
    for (const [mode, tier] of [[undefined, "FULL"], ["HALF", "FULL"], ["NO_CHARGE", "FULL"], ["HALF", "HALF"], ["NO_CHARGE", "QUARTER"]] as const) {
      const s = await student(`r-${mode}`, [ict], tier);
      await take(s.id, [{ courseId: ict.id, ...NOV(month), mode }]);
    }
    for (const [from, to] of [[monthDay(month), monthDay(month)], [`2026-${pad(month)}-01`, `2026-${pad(month)}-28`]] as const) {
      const row = rowOf(await reports.dailySummary(from, to), ict.id);
      assert.equal(row.reconciles, true, `${from}..${to}`);
      assert.equal(row.registered, row.paidFull + row.paidHalf + row.paidQuarter + row.notPaid + row.free);
    }
  });
});
