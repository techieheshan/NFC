import { attend, dbSkip, enrol, freezeClock, makeCombo, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * Job 3A: Half month and No charge, through the real takePayment. The clock is frozen at
 * 10 Nov 2026 11:30 Colombo (a Tuesday), so "this month" is November 2026.
 *
 *   HALF       50% of the amount that would otherwise be charged for that month (after the
 *              tier, after the combo), no reason, any month.
 *   NO_CHARGE  the month is recorded as settled with no money: a real CLASS row, 0.00.
 */

const NOW = "2026-11-10T06:00:00Z";
const SINCE = "2026-08-05T06:00:00Z";
const NOV = { year: 2026, month: 11 };

type Mode = "FULL" | "HALF" | "NO_CHARGE";
type Tier = "FULL" | "HALF" | "QUARTER" | "FREE";

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let quarterId: number;
let pay: typeof import("@/app/(app)/payment/actions");
let rec: typeof import("@/app/(app)/receipts/actions");
let reports: typeof import("@/lib/reports");
let payslips: typeof import("@/lib/payslips");
let arrears: typeof import("@/lib/student-arrears");

describe("Half month and No charge against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    pay = await import("@/app/(app)/payment/actions");
    rec = await import("@/app/(app)/receipts/actions");
    reports = await import("@/lib/reports");
    payslips = await import("@/lib/payslips");
    arrears = await import("@/lib/student-arrears");
    w = await seedWorld(db, { admissionFee: "1300", smartCardFee: "500" });
    quarterId = (await db.feeTier.create({ data: { code: "QUARTER", label: "Quarter", multiplier: "0.250" } })).id;
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------
  const tierId = (t: Tier) => (t === "QUARTER" ? quarterId : w.tiers[t].id);
  const dec = (d: { toFixed: (n: number) => string } | null) => d?.toFixed(2);
  const asAdmin = () => setSession("ADMIN", w.admin.id);
  const rows = (studentId: number) => db.payment.findMany({ where: { studentId }, orderBy: { id: "asc" } });

  async function setup(o: { fee?: string; tier?: Tier; since?: string; share?: string; teacherId?: number } = {}) {
    const teacherId = o.teacherId ?? (await makeTeacher(db)).id;
    const course = await makeCourse(db, w, { teacherId, fee: o.fee ?? "2500", share: o.share ?? "20.00", name: `M${Math.random().toString(36).slice(2, 7)}` });
    const student = await makeStudent(db);
    await enrol(db, { studentId: student.id, courseId: course.id, tierId: tierId(o.tier ?? "FULL"), since: o.since ?? SINCE });
    return { teacherId, course, student };
  }
  async function comboSetup(tier: Tier = "FULL") {
    const teacher = await makeTeacher(db);
    const a = await makeCourse(db, w, { teacherId: teacher.id, fee: "2500", name: `CA${Math.random().toString(36).slice(2, 6)}` });
    const b = await makeCourse(db, w, { teacherId: teacher.id, fee: "1700", name: `CB${Math.random().toString(36).slice(2, 6)}` });
    const combo = await makeCombo(db, { teacherId: teacher.id, items: [{ courseId: a.id, fee: "2000" }, { courseId: b.id, fee: "1300" }] });
    const student = await makeStudent(db);
    for (const c of [a, b]) await enrol(db, { studentId: student.id, courseId: c.id, tierId: tierId(tier), since: SINCE });
    return { a, b, combo, student };
  }
  type Line = { courseId: number; year: number; month: number; mode?: Mode };
  async function charge(studentId: number, classMonths: Line[], extra: { admission?: boolean; smartCard?: boolean; comboDecisions?: { comboId: number; apply: boolean; reason?: string }[] } = {}) {
    asAdmin();
    return pay.takePayment({ studentId, admission: false, smartCard: false, classMonths, comboDecisions: [], ...extra });
  }
  const ok = (res: Awaited<ReturnType<typeof charge>>) => {
    assert.equal(res.ok, true, JSON.stringify(res));
    return (res as Extract<typeof res, { ok: true }>).receipt;
  };
  /** The amount one line is charged. */
  async function amountFor(o: { fee?: string; tier?: Tier; mode?: Mode }) {
    const { course, student } = await setup({ fee: o.fee, tier: o.tier });
    ok(await charge(student.id, [{ courseId: course.id, ...NOV, mode: o.mode }]));
    return dec((await rows(student.id))[0].amount);
  }

  // ---- Half month: amounts --------------------------------------------------------------------

  test("HALF is half of the month's normal amount: full tier 2500 → 1250.00", async () => {
    assert.equal(await amountFor({ mode: "HALF" }), "1250.00");
  });

  test("HALF applies AFTER the tier: a HALF-tier student's half month is a quarter (2500 → 625.00); a QUARTER-tier student's is an eighth (312.50)", async () => {
    assert.equal(await amountFor({ tier: "HALF", mode: "HALF" }), "625.00");
    assert.equal(await amountFor({ tier: "QUARTER", mode: "HALF" }), "312.50");
  });

  test("HALF applies AFTER the combo: combo 2000 → 1000.00; HALF-tier 500.00; QUARTER-tier 250.00", async () => {
    for (const [tier, expected] of [["FULL", "1000.00"], ["HALF", "500.00"], ["QUARTER", "250.00"]] as const) {
      const { a, combo, student } = await comboSetup(tier);
      // a decision is needed (no attendance) — apply the combo
      ok(await charge(student.id, [{ courseId: a.id, ...NOV, mode: "HALF" }], { comboDecisions: [{ comboId: combo.id, apply: true }] }));
      const [row] = await rows(student.id);
      assert.equal(dec(row.amount), expected, tier);
      assert.equal(row.comboApplied, true);
    }
  });

  test("HALF with the combo REFUSED is half of the normal rate (2500 → 1250.00) and keeps the reason", async () => {
    const { a, combo, student } = await comboSetup();
    ok(await charge(student.id, [{ courseId: a.id, ...NOV, mode: "HALF" }], { comboDecisions: [{ comboId: combo.id, apply: false, reason: "parent asked" }] }));
    const [row] = await rows(student.id);
    assert.deepEqual([dec(row.amount), row.comboApplied, row.comboRefusedReason], ["1250.00", false, "parent asked"]);
  });

  test("HALF works for ANY month: an old month, an advance month, several at once, and it needs no attendance", async () => {
    const { course, student } = await setup();
    ok(await charge(student.id, [
      { courseId: course.id, year: 2026, month: 8, mode: "HALF" },
      { courseId: course.id, year: 2026, month: 9 },
      { courseId: course.id, year: 2027, month: 2, mode: "HALF" },
    ]));
    assert.deepEqual((await rows(student.id)).map((r) => [r.billingMonth, dec(r.amount), r.chargeMode]), [[8, "1250.00", "HALF"], [9, "2500.00", null], [2, "1250.00", "HALF"]]);
  });

  test("CURRENT BEHAVIOUR (float rounding, see report 9.2): half of 1333.33 is 666.66; for a half-tier student the half month is half of 666.66", async () => {
    // Half is half of the amount as the receipt would have shown it; the rounding itself is unchanged.
    assert.equal(await amountFor({ fee: "1333.33", mode: "HALF" }), "666.66");
    assert.equal(await amountFor({ fee: "1333.33", tier: "HALF", mode: "HALF" }), "333.33");
  });

  test("the frozen institute share is stored on a HALF row, and a later edit never changes it", async () => {
    const { course, student } = await setup({ share: "20.00" });
    ok(await charge(student.id, [{ courseId: course.id, ...NOV, mode: "HALF" }]));
    await db.course.update({ where: { id: course.id }, data: { instituteSharePercent: "50.00" } });
    const [row] = await rows(student.id);
    assert.deepEqual([row.chargeMode, dec(row.amount), dec(row.instituteSharePercentApplied)], ["HALF", "1250.00", "20.00"]);
  });

  // ---- No charge: amounts and the row ------------------------------------------------------------

  test("NO_CHARGE records a real CLASS row of 0.00 with the course, the month, the tier and the frozen share", async () => {
    const { course, student } = await setup({ share: "25.00" });
    ok(await charge(student.id, [{ courseId: course.id, ...NOV, mode: "NO_CHARGE" }]));
    const [row] = await rows(student.id);
    assert.equal(row.kind, "CLASS");
    assert.equal(row.chargeMode, "NO_CHARGE");
    assert.equal(dec(row.amount), "0.00");
    assert.deepEqual([row.courseId, row.billingYear, row.billingMonth, row.feeTierId], [course.id, 2026, 11, w.tiers.FULL.id]);
    assert.equal(dec(row.instituteSharePercentApplied), "25.00");
    assert.equal(row.cancelled, false);
    assert.match(row.transactionRef ?? "", /^[0-9a-f-]{36}$/);
  });

  test("NO_CHARGE is outside the combo: no decision is asked for, and the row records no combo", async () => {
    const { a, combo, student } = await comboSetup();
    // Without the NO_CHARGE this would need a combined-rate decision (0 days attended).
    ok(await charge(student.id, [{ courseId: a.id, ...NOV, mode: "NO_CHARGE" }]));
    const [row] = await rows(student.id);
    assert.deepEqual([row.comboId, row.comboApplied, row.comboRefusedReason], [null, false, null]);
    void combo;
  });

  test("HALF in a combo still asks the combo question (0 days last month): the decision is missing", async () => {
    const { a, student } = await comboSetup();
    const res = await charge(student.id, [{ courseId: a.id, ...NOV, mode: "HALF" }]);
    assert.deepEqual(res, { ok: false, error: "A combined-rate decision is missing." });
  });

  // ---- the receipt ------------------------------------------------------------------------------------

  test("receipt lines say '(Half month)' and '(No charge)'; amounts and the total are the real ones", async () => {
    const t = await makeTeacher(db);
    const a = await setup({ teacherId: t.id });
    const b = await makeCourse(db, w, { teacherId: t.id, fee: "1800", name: "LB" });
    const c = await makeCourse(db, w, { teacherId: t.id, fee: "1200", name: "LC" });
    for (const x of [b, c]) await enrol(db, { studentId: a.student.id, courseId: x.id, tierId: w.tiers.FULL.id, since: SINCE });
    const receipt = ok(await charge(a.student.id, [
      { courseId: a.course.id, ...NOV },
      { courseId: b.id, ...NOV, mode: "HALF" },
      { courseId: c.id, ...NOV, mode: "NO_CHARGE" },
    ]));
    assert.deepEqual(receipt.lines.map((l) => l.amount), ["2500.00", "900.00", "0.00"]);
    assert.ok(receipt.lines[1].label.endsWith("— Nov 2026 (Half month)"), receipt.lines[1].label);
    assert.ok(receipt.lines[2].label.endsWith("— Nov 2026 (No charge)"), receipt.lines[2].label);
    assert.ok(!/Half month|No charge/.test(receipt.lines[0].label), "a full-fee line carries no suffix");
    assert.equal(receipt.total, "3400.00");
    assert.equal("noCharge" in receipt, false, "a mixed checkout is an ordinary receipt");
  });

  test("a checkout of ONLY no-charge months is flagged noCharge: true, total 0.00, with a normal receipt number", async () => {
    const { course, student } = await setup();
    const receipt = ok(await charge(student.id, [{ courseId: course.id, ...NOV, mode: "NO_CHARGE" }]));
    assert.equal(receipt.noCharge, true);
    assert.equal(receipt.total, "0.00");
    const [row] = await rows(student.id);
    assert.equal(receipt.reference, `XN-${row.id}`);
  });

  test("noCharge is NOT set when anything else is taken with it: admission or a smart card", async () => {
    const withAdmission = await setup();
    assert.equal("noCharge" in ok(await charge(withAdmission.student.id, [{ courseId: withAdmission.course.id, ...NOV, mode: "NO_CHARGE" }], { admission: true })), false);
    const withCard = await setup();
    assert.equal("noCharge" in ok(await charge(withCard.student.id, [{ courseId: withCard.course.id, ...NOV, mode: "NO_CHARGE" }], { smartCard: true })), false);
  });

  test("a reprint shows the same labels and totals as the receipt, and carries the same noCharge flag", async () => {
    const { course, student } = await setup();
    const receipt = ok(await charge(student.id, [{ courseId: course.id, ...NOV, mode: "NO_CHARGE" }, { courseId: course.id, year: 2026, month: 10, mode: "HALF" }]));
    setSession("STAFF", w.staff.id);
    const tx = await rec.reprintTransaction(`ref:${(await rows(student.id))[0].transactionRef}`);
    assert.deepEqual(tx?.lines, receipt.lines);
    assert.equal(tx?.total, receipt.total);
    assert.equal(tx?.reference, receipt.reference);
    assert.equal("noCharge" in (tx ?? {}), false); // mixed
    const only = await setup();
    ok(await charge(only.student.id, [{ courseId: only.course.id, ...NOV, mode: "NO_CHARGE" }]));
    const again = await rec.reprintTransaction(`ref:${(await rows(only.student.id))[0].transactionRef}`);
    assert.equal(again?.noCharge, true);
    assert.equal(again?.total, "0.00");
  });

  // ---- the refusals that stay -----------------------------------------------------------------------------

  test("a FREE enrolment is refused in EVERY mode", async () => {
    for (const mode of ["FULL", "HALF", "NO_CHARGE"] as const) {
      const { course, student } = await setup({ tier: "FREE" });
      assert.deepEqual(await charge(student.id, [{ courseId: course.id, ...NOV, mode }]), { ok: false, error: "Free-tier courses are not charged." }, mode);
      assert.equal((await rows(student.id)).length, 0);
    }
  });

  test("the month rules apply to every mode: before enrolment, too far ahead, already paid", async () => {
    for (const mode of ["HALF", "NO_CHARGE"] as const) {
      const { course, student } = await setup({ since: "2026-09-10T06:00:00Z" });
      assert.deepEqual(await charge(student.id, [{ courseId: course.id, year: 2026, month: 8, mode }]), { ok: false, error: "That month is before the student was enrolled." });
      assert.deepEqual(await charge(student.id, [{ courseId: course.id, year: 2027, month: 3, mode }]), { ok: false, error: "Cannot charge more than 3 months ahead." });
      ok(await charge(student.id, [{ courseId: course.id, ...NOV }]));
      const again = await charge(student.id, [{ courseId: course.id, ...NOV, mode }]);
      assert.equal(again.ok, false);
      assert.match((again as { error: string }).error, / — Nov 2026 is already paid\.$/);
    }
  });

  test("a month recorded as NO CHARGE says so when charged again — never 'already paid' — and a HALF month still says 'already paid'", async () => {
    const NO_CHARGE_MESSAGE = / — Nov 2026 was recorded as no charge\. Ask an administrator to cancel that record if it should be charged\.$/;
    const { course, student } = await setup();
    ok(await charge(student.id, [{ courseId: course.id, ...NOV, mode: "NO_CHARGE" }]));
    for (const mode of [undefined, "FULL", "HALF", "NO_CHARGE"] as const) {
      const again = await charge(student.id, [{ courseId: course.id, ...NOV, mode }]);
      assert.equal(again.ok, false, String(mode));
      assert.match((again as { error: string }).error, NO_CHARGE_MESSAGE, String(mode));
    }
    assert.equal((await rows(student.id)).length, 1, "nothing was written by the refusals");

    const half = await setup();
    ok(await charge(half.student.id, [{ courseId: half.course.id, ...NOV, mode: "HALF" }]));
    const again = await charge(half.student.id, [{ courseId: half.course.id, ...NOV }]);
    assert.match((again as { error: string }).error, / — Nov 2026 is already paid\.$/);
  });

  test("several clashing months: the message is deterministic — 'no charge' only when EVERY clash is a no-charge record, otherwise the earliest PAID month is 'already paid'", async () => {
    const { course, student } = await setup();
    const SEP = { year: 2026, month: 9 };
    const OCT = { year: 2026, month: 10 };
    ok(await charge(student.id, [{ courseId: course.id, ...SEP, mode: "NO_CHARGE" }]));
    ok(await charge(student.id, [{ courseId: course.id, ...OCT }]));
    ok(await charge(student.id, [{ courseId: course.id, ...NOV, mode: "NO_CHARGE" }]));
    const ask = async (months: { year: number; month: number }[]) => {
      const res = await charge(student.id, months.map((m) => ({ courseId: course.id, ...m })));
      assert.equal(res.ok, false);
      return (res as { error: string }).error;
    };
    for (let i = 0; i < 5; i++) {
      // a paid month among no-charge ones: the paid month is named, whatever the request order
      assert.match(await ask([NOV, SEP, OCT]), / — Oct 2026 is already paid\.$/);
      assert.match(await ask([SEP, OCT, NOV]), / — Oct 2026 is already paid\.$/);
      // only no-charge records: the earliest is named, with the no-charge message
      assert.match(await ask([NOV, SEP]), / — Sep 2026 was recorded as no charge\. /);
    }
    assert.equal((await rows(student.id)).length, 3, "the refusals wrote nothing");
  });

  test("once an administrator cancels the no-charge record, the month can be charged", async () => {
    const { course, student } = await setup();
    ok(await charge(student.id, [{ courseId: course.id, ...NOV, mode: "NO_CHARGE" }]));
    setSession("ADMIN", w.admin.id);
    const f = new FormData();
    f.set("key", `ref:${(await rows(student.id))[0].transactionRef}`);
    f.set("reason", "ignored by mistake");
    assert.deepEqual(await (await import("@/app/(app)/receipts/actions")).cancelTransaction({ ok: false }, f), { ok: true });
    assert.equal(ok(await charge(student.id, [{ courseId: course.id, ...NOV }])).total, "2500.00");
  });

  test("DECISION: a STAFF login may record Half and No charge for any month — no note, no role limit (the same amounts and rows as an admin)", async () => {
    // Staff run the counter and admins review (AGENTS.md, "Decisions recorded from the 3A review").
    // If this ever needs a limit it is a business decision, and this test is the sentence to change.
    const { course, student } = await setup({ since: "2026-02-10T06:00:00Z" }); // an old month, with attendance or not
    setSession("STAFF", w.staff.id);
    const res = await pay.takePayment({
      studentId: student.id, admission: false, smartCard: false, comboDecisions: [],
      classMonths: [
        { courseId: course.id, year: 2026, month: 3, mode: "NO_CHARGE" },
        { courseId: course.id, year: 2026, month: 4, mode: "HALF" },
        { courseId: course.id, ...NOV },
      ],
    });
    assert.equal(res.ok, true, JSON.stringify(res));
    const rs = await rows(student.id);
    assert.deepEqual(rs.map((r) => [r.billingMonth, r.chargeMode, dec(r.amount)]), [[3, "NO_CHARGE", "0.00"], [4, "HALF", "1250.00"], [11, null, "2500.00"]]);
    for (const r of rs) assert.equal(r.takenById, w.staff.id);
  });

  test("an unknown mode is a malformed request; 'FULL' is accepted and stored as NULL (the full fee)", async () => {
    const { course, student } = await setup();
    for (const bad of ["half", "QUARTER", "", "NONE"]) {
      assert.deepEqual(await charge(student.id, [{ courseId: course.id, ...NOV, mode: bad as Mode }]), { ok: false, error: "Invalid payment request." }, bad);
    }
    ok(await charge(student.id, [{ courseId: course.id, ...NOV, mode: "FULL" }]));
    const [row] = await rows(student.id);
    assert.deepEqual([row.chargeMode, dec(row.amount)], [null, "2500.00"]);
  });

  // ---- settled, and contributing nothing ---------------------------------------------------------------------

  test("a NO_CHARGE month is SETTLED: arrears, the panel and the class boxes all treat it as paid", async () => {
    const { course, student } = await setup({ since: "2026-11-02T06:00:00Z" });
    await db.schedule.create({ data: { courseId: course.id, dayOfWeek: "TUE", startTime: "16:00", endTime: "18:00" } });
    asAdmin();
    assert.deepEqual((await arrears.studentArrears(student.id)).owedMonths.map((m) => m.label), ["Nov 2026"]);
    const states = async () => (await reports.dailyAttendance("2026-11-10", {})).courses.find((c) => c.courseId === course.id)!.states;
    assert.deepEqual(await states(), { paid: 0, notPaid: 1, overdue: 0, free: 0 });

    ok(await charge(student.id, [{ courseId: course.id, ...NOV, mode: "NO_CHARGE" }]));

    assert.deepEqual((await arrears.studentArrears(student.id)).owedMonths, []);
    assert.equal((await arrears.studentArrears(student.id)).status, "green");
    assert.deepEqual(await states(), { paid: 1, notPaid: 0, overdue: 0, free: 0 }); // the Daily Attendance boxes
    const states2 = (await arrears.courseMonthStates([course.id], 2026, 11)).get(course.id)!;
    assert.equal(states2.get(student.id), "paid");
    const panel = await pay.loadPanel({ studentId: student.id });
    const months = (panel as Extract<typeof panel, { status: "ok" }>).panel.courses[0].months;
    assert.equal(months.find((m) => m.month === 11)?.paid, true);
  });

  test("a NO_CHARGE month cannot turn overdue: next month it is still settled for November", async () => {
    const { course, student } = await setup({ since: "2026-11-02T06:00:00Z" });
    ok(await charge(student.id, [{ courseId: course.id, ...NOV, mode: "NO_CHARGE" }]));
    try {
      freezeClock("2026-12-05T06:00:00Z");
      const owed = (await arrears.studentArrears(student.id)).owedMonths.map((m) => m.label);
      assert.deepEqual(owed, ["Dec 2026"]); // only the new month; November is not owed
      assert.equal((await arrears.courseMonthStates([course.id], 2026, 12)).get(course.id)!.get(student.id), "notPaid"); // not "overdue"
    } finally {
      freezeClock(NOW);
    }
  });

  test("a NO_CHARGE month contributes 0.00 to Daily Summary and to every payslip and roll-up figure", async () => {
    const { course, student, teacherId } = await setup({ fee: "2500", share: "20.00" });
    const other = await makeStudent(db);
    await enrol(db, { studentId: other.id, courseId: course.id, tierId: w.tiers.FULL.id, since: SINCE });
    ok(await charge(other.id, [{ courseId: course.id, ...NOV }])); // one real payment: 2500, institute 500

    const summary = () => reports.dailySummary("2026-11-10", "2026-11-10");
    const slip = async () => (await payslips.buildPayslips({ year: 2026, month: 11, teacherIds: [teacherId], includeInstitute: true }));
    const beforeSummary = await summary();
    const beforeSlip = await slip();

    ok(await charge(student.id, [{ courseId: course.id, ...NOV, mode: "NO_CHARGE" }]));

    const afterSummary = await summary();
    assert.equal(afterSummary.classTotal, beforeSummary.classTotal);
    assert.equal(afterSummary.totalCollected, beforeSummary.totalCollected);
    assert.equal(afterSummary.net, beforeSummary.net);
    assert.equal(afterSummary.courses.find((c) => c.courseId === course.id)?.amount, "2500.00");

    const afterSlip = await slip();
    const s = afterSlip.slips[0], b = beforeSlip.slips[0];
    for (const key of ["totalCollected", "totalInstituteShare", "totalTeacherShare", "advances", "finalSalary"] as const) assert.equal(s[key], b[key], key);
    assert.deepEqual([s.totalCollected, s.totalInstituteShare, s.totalTeacherShare], ["2500.00", "500.00", "2000.00"]);
    assert.deepEqual(afterSlip.institute, beforeSlip.institute); // the month-end roll-up, institute profit included
  });

  // ---- cancelling ---------------------------------------------------------------------------------------------------

  test("cancelling a HALF row voids it, and the month is payable again", async () => {
    const { course, student } = await setup();
    ok(await charge(student.id, [{ courseId: course.id, ...NOV, mode: "HALF" }]));
    asAdmin();
    const key = `ref:${(await rows(student.id))[0].transactionRef}`;
    assert.deepEqual(await rec.cancelTransaction({ ok: false }, form(key, "wrong amount")), { ok: true });
    const [row] = await rows(student.id);
    assert.deepEqual([row.cancelled, dec(row.amount), row.chargeMode], [true, "1250.00", "HALF"]); // never recomputed
    ok(await charge(student.id, [{ courseId: course.id, ...NOV }])); // payable again, at the full fee
    assert.equal(dec((await rows(student.id))[1].amount), "2500.00");
  });

  test("cancelling a NO_CHARGE row makes the month OWED again, and payable", async () => {
    const { course, student } = await setup({ since: "2026-11-02T06:00:00Z" });
    ok(await charge(student.id, [{ courseId: course.id, ...NOV, mode: "NO_CHARGE" }]));
    asAdmin();
    assert.deepEqual((await arrears.studentArrears(student.id)).owedMonths, []);
    const key = `ref:${(await rows(student.id))[0].transactionRef}`;
    assert.deepEqual(await rec.cancelTransaction({ ok: false }, form(key, "recorded by mistake")), { ok: true });
    assert.deepEqual((await arrears.studentArrears(student.id)).owedMonths.map((m) => m.label), ["Nov 2026"]);
    ok(await charge(student.id, [{ courseId: course.id, ...NOV }]));
    assert.equal(dec((await rows(student.id))[1].amount), "2500.00");
  });

  test("a cancelled NO_CHARGE or HALF receipt reprints as CANCELLED with its labels", async () => {
    const { course, student } = await setup();
    ok(await charge(student.id, [{ courseId: course.id, ...NOV, mode: "NO_CHARGE" }]));
    asAdmin();
    const key = `ref:${(await rows(student.id))[0].transactionRef}`;
    await rec.cancelTransaction({ ok: false }, form(key, "duplicate entry"));
    const tx = await rec.reprintTransaction(key);
    assert.equal(tx?.cancelled?.reason, "duplicate entry");
    assert.ok(tx?.lines[0].label.endsWith("(No charge)"));
  });

  test("attendance does not matter to Half or No charge — a month with attendance can be waived too", async () => {
    const { course, student } = await setup();
    for (const d of ["2026-11-03", "2026-11-05"]) await attend(db, { studentId: student.id, courseId: course.id, date: d, markedById: w.admin.id });
    ok(await charge(student.id, [{ courseId: course.id, ...NOV, mode: "NO_CHARGE" }]));
    assert.equal((await rows(student.id))[0].chargeMode, "NO_CHARGE");
  });
});

function form(key: string, reason: string) {
  const f = new FormData();
  f.set("key", key);
  f.set("reason", reason);
  return f;
}
