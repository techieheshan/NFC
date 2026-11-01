import { dbSkip, enrol, freezeClock, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * Job 3A leaves the Daily Summary and the payslip queries ALONE (by decision). These tests
 * document, with the real functions, what a NO_CHARGE row does to them TODAY, so that job 5
 * has a failing test pointing at each sentence it must change.
 *
 * What is already right: every MONEY figure. A NO_CHARGE row is 0.00, so collected, share and
 * profit never move (payment-modes.test.ts proves that against the same functions).
 *
 * What is wrong: every COUNT that means "someone paid", because those count rows, not money:
 *   - Daily Summary's paid Full / Half / 25% counts;
 *   - the payslip's paying students, tier counts, sheet lines and "cards".
 * A no-charge month is recorded, settled and free, but nobody paid. The gate for the menu
 * switch is in AGENTS.md: reports must skip NO_CHARGE rows in paid counts and lines first,
 * and a HALF-month row must not read as a full month there either.
 *
 * Clock frozen at 10 Nov 2026 (Colombo).
 */

const NOW = "2026-11-10T06:00:00Z";
const SINCE = "2026-08-05T06:00:00Z";
const NOV = { year: 2026, month: 11 };

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let pay: typeof import("@/app/(app)/payment/actions");
let reports: typeof import("@/lib/reports");
let payslips: typeof import("@/lib/payslips");
let income: typeof import("@/lib/report-monthly-income");

type Mode = "FULL" | "HALF" | "NO_CHARGE";

describe("how No-charge and Half rows are counted in Daily Summary, payslips and the month-end roll-up (the job 5 rules)", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    pay = await import("@/app/(app)/payment/actions");
    reports = await import("@/lib/reports");
    payslips = await import("@/lib/payslips");
    income = await import("@/lib/report-monthly-income");
    w = await seedWorld(db);
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  /** One teacher, one course (2000, 20%), four FULL-tier students: paid, half, no-charge, unpaid. */
  async function scenario() {
    const teacher = await makeTeacher(db);
    const course = await makeCourse(db, w, { teacherId: teacher.id, fee: "2000", share: "20.00", name: `Rpt${Math.random().toString(36).slice(2, 6)}` });
    const make = async () => {
      const s = await makeStudent(db);
      await enrol(db, { studentId: s.id, courseId: course.id, tierId: w.tiers.FULL.id, since: SINCE });
      return s;
    };
    const [paid, half, free, unpaid] = [await make(), await make(), await make(), await make()];
    setSession("ADMIN", w.admin.id);
    for (const [s, mode] of [[paid, "FULL"], [half, "HALF"], [free, "NO_CHARGE"]] as [{ id: number }, Mode][]) {
      const res = await pay.takePayment({ studentId: s.id, admission: false, smartCard: false, comboDecisions: [], classMonths: [{ courseId: course.id, ...NOV, mode }] });
      assert.equal(res.ok, true, JSON.stringify(res));
    }
    return { teacher, course, unpaid };
  }

  test("job 5 (was CURRENT BEHAVIOUR): Daily Summary does NOT count a NO_CHARGE student as having paid — they are not paid for that day's range", async () => {
    // Money was always right (2000 + 1000 = 3000). The paid-FULL count is now 2: the full payer and the
    // half-month payer (a normal payer of THEIR tier — not "Half", which is the HALF tier). The student
    // who paid nothing is no longer in a paid count; with the student who never came, 2 are not paid.
    const { course } = await scenario();
    const summary = await reports.dailySummary("2026-11-10", "2026-11-10");
    const row = summary.courses.find((c) => c.courseId === course.id)!;
    assert.equal(row.amount, "3000.00");
    assert.deepEqual([row.registered, row.paidFull, row.paidHalf, row.paidQuarter, row.notPaid, row.free], [4, 2, 0, 0, 2, 0]);
    assert.equal(row.reconciles, true);
  });

  test("job 5 (was CURRENT BEHAVIOUR): the payslip does NOT count a NO_CHARGE student as a paying student, and has no 0.00 sheet line", async () => {
    // Money was always right (collected 3000, institute 600, teacher 2400). The COUNTS were inflated: 3 paying
    // students and 3 "cards", one at a rate of 0.00. Now: 2 paying students, 2 cards, no 0.00 line. The
    // Half-month payer (1000, a Full-tier student) is a normal payer of their tier, on a labelled line.
    const { teacher, course } = await scenario();
    const report = await payslips.buildPayslips({ year: 2026, month: 11, teacherIds: [teacher.id], includeInstitute: false });
    const slip = report.slips[0];
    assert.deepEqual([slip.totalCollected, slip.totalInstituteShare, slip.totalTeacherShare], ["3000.00", "600.00", "2400.00"]);
    assert.equal(slip.payingStudents, 2);
    assert.equal(slip.courses.find((c) => c.courseId === course.id)?.payingStudents, 2);
    assert.deepEqual(slip.tierCounts.map((t) => [t.code, t.students]), [["FULL", 2]]);
    assert.deepEqual(slip.lines.map((l) => [l.cards, l.rate, l.gross, l.halfMonth === true]).sort(), [[1, "1000.00", "1000.00", true], [1, "2000.00", "2000.00", false]]);
    assert.equal(slip.lineCards, 2);
    assert.deepEqual(slip.halfMonths, { cards: 1, gross: "1000.00" });
    for (const l of slip.lines) assert.equal((l.cards * Number(l.rate)).toFixed(2), l.gross); // "cards x rate = gross" still holds
  });

  test("job 5 (was CURRENT BEHAVIOUR): the monthly income report's 'students' for the teacher no longer includes the NO_CHARGE student", async () => {
    const { teacher } = await scenario();
    const report = await income.buildMonthlyIncome(2026, 11);
    const row = report.byTeacher.find((t) => t.teacherId === teacher.id)!;
    assert.equal(row.collected, "3000.00");
    assert.equal(row.students, 2);
  });

  test("a teacher whose ONLY payments this month are NO_CHARGE has a slip of zeros and is left out of the income report's by-teacher list", async () => {
    // (Not a defect: nothing was collected. Recorded so job 5 sees the whole picture.)
    const teacher = await makeTeacher(db);
    const course = await makeCourse(db, w, { teacherId: teacher.id, fee: "2000", name: `Only${Math.random().toString(36).slice(2, 6)}` });
    const s = await makeStudent(db);
    await enrol(db, { studentId: s.id, courseId: course.id, tierId: w.tiers.FULL.id, since: SINCE });
    setSession("ADMIN", w.admin.id);
    assert.equal((await pay.takePayment({ studentId: s.id, admission: false, smartCard: false, comboDecisions: [], classMonths: [{ courseId: course.id, ...NOV, mode: "NO_CHARGE" }] })).ok, true);
    const slip = (await payslips.buildPayslips({ year: 2026, month: 11, teacherIds: [teacher.id], includeInstitute: false })).slips[0];
    assert.equal(slip.totalCollected, "0.00");
    assert.equal(slip.courses.length, 0); // "courses with no money are dropped"
    const report = await income.buildMonthlyIncome(2026, 11);
    assert.equal(report.byTeacher.find((t) => t.teacherId === teacher.id), undefined);
  });

  test("job 5 (was CURRENT BEHAVIOUR): Daily Summary — a HALF MONTH on a FULL-tier student is a normal payer of their TIER (paidHalf stays the HALF tier), and the month has its own line", async () => {
    // Its OWN day (11 Nov): the extra lines count every Half month in the range, so a shared day would also count the
    // Half months other tests in this file took on the 10th. On its own day the figures are exact.
    const teacher = await makeTeacher(db);
    const course = await makeCourse(db, w, { teacherId: teacher.id, fee: "2000", share: "20.00", name: `HalfDaily${Math.random().toString(36).slice(2, 6)}` });
    const s = await makeStudent(db);
    await enrol(db, { studentId: s.id, courseId: course.id, tierId: w.tiers.FULL.id, since: SINCE });
    setSession("ADMIN", w.admin.id);
    freezeClock("2026-11-11T06:00:00Z");
    try {
      assert.equal((await pay.takePayment({ studentId: s.id, admission: false, smartCard: false, comboDecisions: [], classMonths: [{ courseId: course.id, ...NOV, mode: "HALF" }] })).ok, true);
      const summary = await reports.dailySummary("2026-11-11", "2026-11-11");
      const row = summary.courses.find((c) => c.courseId === course.id)!;
      assert.equal(row.amount, "1000.00");
      assert.deepEqual([row.paidFull, row.paidHalf, row.paidQuarter], [1, 0, 0]); // tier columns are unchanged: they are TIER columns
      assert.deepEqual(summary.halfMonths, { count: 1, total: "1000.00" }, "the Half month is on the extra line, exactly");
      assert.equal(summary.noChargeMonths, undefined);
    } finally {
      freezeClock(NOW);
    }
  });

  test("job 5 (was CURRENT BEHAVIOUR): payslip — a HALF MONTH on a FULL-tier student is a normal payer of their TIER, and the month is a labelled line", async () => {
    // "Half" in the payslip tier counts is the HALF TIER and stays so: the student below is FULL tier, so the
    // tier counts say "1 FULL". The month itself is visible: its own line, flagged Half month, and the slip's note.
    const teacher = await makeTeacher(db);
    const course = await makeCourse(db, w, { teacherId: teacher.id, fee: "2000", share: "20.00", name: `Half${Math.random().toString(36).slice(2, 6)}` });
    const s = await makeStudent(db);
    await enrol(db, { studentId: s.id, courseId: course.id, tierId: w.tiers.FULL.id, since: SINCE });
    setSession("ADMIN", w.admin.id);
    assert.equal((await pay.takePayment({ studentId: s.id, admission: false, smartCard: false, comboDecisions: [], classMonths: [{ courseId: course.id, ...NOV, mode: "HALF" }] })).ok, true);

    const slip = (await payslips.buildPayslips({ year: 2026, month: 11, teacherIds: [teacher.id], includeInstitute: false })).slips[0];
    assert.deepEqual(slip.tierCounts.map((t) => [t.code, t.students]), [["FULL", 1]]);
    assert.deepEqual(slip.lines.map((l) => [l.cards, l.rate, l.gross, l.halfMonth === true]), [[1, "1000.00", "1000.00", true]]);
    assert.deepEqual(slip.halfMonths, { cards: 1, gross: "1000.00" });
  });

  test("the Daily Summary paid count and the payslip's paying students agree with each other — including a NO_CHARGE student (job 5 changed them together)", async () => {
    const { teacher, course } = await scenario();
    const row = (await reports.dailySummary("2026-11-10", "2026-11-10")).courses.find((c) => c.courseId === course.id)!;
    const slip = (await payslips.buildPayslips({ year: 2026, month: 11, teacherIds: [teacher.id], includeInstitute: false })).slips[0];
    assert.equal(row.paidFull + row.paidHalf + row.paidQuarter, slip.payingStudents);
    assert.equal(slip.payingStudents, 2);
  });

  test("the Daily Summary paid count and the payslip's paying students agree for Full and Half-month payers", async () => {
    const teacher = await makeTeacher(db);
    const course = await makeCourse(db, w, { teacherId: teacher.id, fee: "2000", share: "20.00", name: `Agree${Math.random().toString(36).slice(2, 6)}` });
    setSession("ADMIN", w.admin.id);
    for (const mode of ["FULL", "HALF"] as const) {
      const s = await makeStudent(db);
      await enrol(db, { studentId: s.id, courseId: course.id, tierId: w.tiers.FULL.id, since: SINCE });
      assert.equal((await pay.takePayment({ studentId: s.id, admission: false, smartCard: false, comboDecisions: [], classMonths: [{ courseId: course.id, ...NOV, mode }] })).ok, true);
    }
    const row = (await reports.dailySummary("2026-11-10", "2026-11-10")).courses.find((c) => c.courseId === course.id)!;
    const slip = (await payslips.buildPayslips({ year: 2026, month: 11, teacherIds: [teacher.id], includeInstitute: false })).slips[0];
    assert.equal(row.paidFull + row.paidHalf + row.paidQuarter, slip.payingStudents);
  });
});
