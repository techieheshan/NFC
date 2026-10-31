import { dbSkip, freezeClock, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * Safety net for the Payment redesign (job 1): the ONE payroll calculation
 * (buildPayslips, rule 26), checked against numbers worked out by hand.
 *
 * The month a slip covers is the CASH month (paidAt, Colombo), and each
 * payment's share is the percentage frozen on it when it was taken.
 *
 * Every scenario uses its own calendar month, so the institute-wide roll-up (which
 * spans all courses) only ever contains that scenario's rows:
 *   Oct 2026 — the hand-computed roll-up      Sep 2026 — the one-cent case
 *   Aug 2026 — Colombo midnight boundary      Jul 2026 — frozen / legacy shares
 */

const NOW = "2026-10-15T06:00:00Z";

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let advanceType: { id: number };
let xenonType: { id: number };
let buildPayslips: typeof import("@/lib/payslips").buildPayslips;

describe("payslip roll-up against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    ({ buildPayslips } = await import("@/lib/payslips"));
    w = await seedWorld(db);
    advanceType = await db.expenseType.create({ data: { code: "TEACHER_ADVANCE", label: "Teacher advance", affectsTeacherPayslip: true } });
    xenonType = await db.expenseType.create({ data: { code: "XENON", label: "Xenon" } });
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------
  const course = (teacherId: number, name: string, fee: string, share: string) => makeCourse(db, w, { teacherId, name, fee, share });
  async function pays(courseId: number, tier: "FULL" | "HALF", amount: string, o: { share?: string | null; billing?: [number, number]; paidAt: string; cancelled?: boolean; kind?: "CLASS" | "ADMISSION" | "SMART_CARD"; studentId?: number }) {
    const studentId = o.studentId ?? (await makeStudent(db)).id;
    const kind = o.kind ?? "CLASS";
    await db.payment.create({
      data: {
        kind,
        studentId,
        courseId: kind === "CLASS" ? courseId : null,
        billingYear: kind === "CLASS" ? (o.billing ?? [2026, 10])[0] : null,
        billingMonth: kind === "CLASS" ? (o.billing ?? [2026, 10])[1] : null,
        feeTierId: kind === "CLASS" ? w.tiers[tier].id : null,
        amount,
        instituteSharePercentApplied: kind === "CLASS" ? (o.share === undefined ? "20.00" : o.share) : null,
        takenById: w.admin.id,
        paidAt: new Date(o.paidAt),
        cancelled: o.cancelled ?? false,
        transactionRef: null,
      },
    });
    return studentId;
  }
  const slipFor = async (year: number, month: number, teacherId: number) => (await buildPayslips({ year, month, teacherIds: [teacherId], includeInstitute: false })).slips[0];
  const expense = (typeId: number, amount: string, date: string, teacherId?: number) =>
    db.expense.create({ data: { expenseTypeId: typeId, amount, reason: "test", date: new Date(`${date}T00:00:00Z`), teacherId, recordedById: w.admin.id, authorizedById: w.admin.id } });

  // ---- the hand-computed roll-up (October) -------------------------------------------------

  test("one teacher, two courses, one cancelled payment: every figure equals the hand-computed number", async () => {
    const t = await makeTeacher(db, "Hand Teacher");
    const a = await course(t.id, "A-course", "2000", "20.00");
    const b = await course(t.id, "B-course", "3000", "30.00");
    const oct = "2026-10-10T06:00:00Z";

    const s1 = await pays(a.id, "FULL", "2000.00", { share: "20.00", paidAt: oct });
    await pays(b.id, "FULL", "3000.00", { share: "30.00", paidAt: oct, studentId: s1 });
    const s2 = await pays(a.id, "HALF", "1000.00", { share: "20.00", paidAt: oct });
    await pays(b.id, "HALF", "1500.00", { share: "30.00", paidAt: oct, studentId: s2 });
    await pays(a.id, "FULL", "2000.00", { share: "20.00", paidAt: oct, cancelled: true }); // must NOT count
    // Money the institute keeps whole, and the deductions around it.
    await pays(0, "FULL", "1500.00", { kind: "ADMISSION", paidAt: oct });
    await pays(0, "FULL", "500.00", { kind: "SMART_CARD", paidAt: oct });
    await pays(0, "FULL", "9999.00", { kind: "ADMISSION", paidAt: oct, cancelled: true }); // must NOT count
    await expense(advanceType.id, "1000.00", "2026-10-12", t.id);
    await expense(xenonType.id, "300.00", "2026-10-13");

    const report = await buildPayslips({ year: 2026, month: 10, includeInstitute: true });
    const slip = report.slips.find((s) => s.teacherId === t.id)!;

    // by course:  A = 2000+1000 = 3000 → institute 600, teacher 2400
    //             B = 3000+1500 = 4500 → institute 1350 (30%), teacher 3150
    assert.deepEqual(slip.courses.map((c) => [c.course, c.payingStudents, c.collected, c.sharePercent, c.instituteShare, c.teacherShare]), [
      ["A-course", 2, "3000.00", "20.00", "600.00", "2400.00"],
      ["B-course", 2, "4500.00", "30.00", "1350.00", "3150.00"],
    ]);
    assert.equal(slip.totalCollected, "7500.00");
    assert.equal(slip.totalInstituteShare, "1950.00");
    assert.equal(slip.totalTeacherShare, "5550.00");
    assert.equal(slip.advances, "1000.00");
    assert.equal(slip.finalSalary, "4550.00"); // 5550 − 1000
    assert.equal(slip.payingStudents, 2);
    assert.deepEqual(slip.advanceLines.map((l) => [l.date, l.amount]), [["2026-10-12", "1000.00"]]);

    // the printed sheet: one line per course × month × rate, so cards × rate = gross on each
    assert.deepEqual(slip.lines.map((l) => [l.course, l.billingLabel, l.cards, l.rate, l.gross, l.instituteShare, l.teacherShare]), [
      ["A-course", "Oct 2026", 1, "2000.00", "2000.00", "400.00", "1600.00"],
      ["A-course", "Oct 2026", 1, "1000.00", "1000.00", "200.00", "800.00"],
      ["B-course", "Oct 2026", 1, "3000.00", "3000.00", "900.00", "2100.00"],
      ["B-course", "Oct 2026", 1, "1500.00", "1500.00", "450.00", "1050.00"],
    ]);
    for (const l of slip.lines) assert.equal((l.cards * Number(l.rate)).toFixed(2), l.gross);
    assert.equal(slip.lineCards, 4);
    assert.deepEqual(slip.tierCounts.map((c) => [c.code, c.students]), [["FULL", 1], ["HALF", 1]]);

    // the month-end roll-up reads the SAME payments
    assert.deepEqual(report.institute, {
      totalCollected: "7500.00",
      totalInstituteShare: "1950.00",
      totalTeacherShare: "5550.00",
      admissionIncome: "1500.00",
      smartCardIncome: "500.00",
      teacherAdvances: "1000.00",
      xenonExpenses: "300.00",
      instituteProfit: "3650.00", // 1950 + 1500 + 500 − 300; the teacher advance is NOT subtracted
    });
  });

  test("a teacher sheet never carries institute profit, and `teacherIds` narrows the report", async () => {
    const t = await makeTeacher(db);
    const other = await makeTeacher(db);
    const report = await buildPayslips({ year: 2026, month: 10, teacherIds: [t.id], includeInstitute: false });
    assert.equal("institute" in report, false);
    assert.deepEqual(report.slips.map((s) => s.teacherId), [t.id]);
    assert.notEqual(other.id, t.id);
  });

  test("a teacher with no money this month still has a slip, with no course rows and a zero total", async () => {
    const t = await makeTeacher(db);
    await course(t.id, "Quiet-course", "1000", "20.00");
    const slip = await slipFor(2026, 10, t.id);
    assert.deepEqual(slip.courses, []);
    assert.deepEqual(slip.lines, []);
    assert.equal(slip.totalCollected, "0.00");
    assert.equal(slip.finalSalary, "0.00");
  });

  // ---- the month is the CASH month, in Colombo ------------------------------------------------

  test("a payment belongs to the slip of the month it was PAID in (Colombo), whatever month it was billed for", async () => {
    const t = await makeTeacher(db);
    const c = await course(t.id, "Edge-course", "1000", "20.00");
    // both billed for JULY; the cash arrives either side of midnight 31 Jul → 1 Aug in Colombo
    await pays(c.id, "FULL", "1000.00", { billing: [2026, 7], paidAt: "2026-07-31T18:29:59Z" });
    await pays(c.id, "FULL", "400.00", { billing: [2026, 7], paidAt: "2026-07-31T18:30:00Z" });
    assert.equal((await slipFor(2026, 7, t.id)).totalCollected, "1000.00");
    assert.equal((await slipFor(2026, 8, t.id)).totalCollected, "400.00");
    // …and the August slip still labels the line with the BILLING month
    assert.deepEqual((await slipFor(2026, 8, t.id)).lines.map((l) => l.billingLabel), ["Jul 2026"]);
  });

  test("December's window ends at Colombo midnight into January (year rollover)", async () => {
    const t = await makeTeacher(db);
    const c = await course(t.id, "NewYear-course", "1000", "20.00");
    await pays(c.id, "FULL", "1000.00", { billing: [2025, 12], paidAt: "2025-12-31T18:29:59Z" });
    await pays(c.id, "FULL", "700.00", { billing: [2025, 12], paidAt: "2025-12-31T18:30:00Z" });
    assert.equal((await slipFor(2025, 12, t.id)).totalCollected, "1000.00");
    assert.equal((await slipFor(2026, 1, t.id)).totalCollected, "700.00");
  });

  // ---- the share is the one frozen on the payment ------------------------------------------------

  test("each payment keeps the share it was taken with: editing the course's % later does not rewrite a paid slip", async () => {
    const t = await makeTeacher(db);
    const c = await course(t.id, "Frozen-course", "1000", "20.00");
    await pays(c.id, "FULL", "1000.00", { share: "20.00", paidAt: "2026-07-10T06:00:00Z", billing: [2026, 7] });
    await db.course.update({ where: { id: c.id }, data: { instituteSharePercent: "50.00" } });
    await pays(c.id, "FULL", "1000.00", { share: "50.00", paidAt: "2026-07-11T06:00:00Z", billing: [2026, 7] });
    const slip = await slipFor(2026, 7, t.id);
    assert.equal(slip.totalInstituteShare, "700.00"); // 200 + 500, not 1000
    // two payments at the same rate but different shares stay on one line, with the blended %
    assert.deepEqual(slip.lines.map((l) => [l.cards, l.gross, l.instituteShare, l.sharePercent]), [[2, "2000.00", "700.00", "35.00"]]);
  });

  test("a legacy row with NO frozen share falls back to the course's current %", async () => {
    const t = await makeTeacher(db);
    const c = await course(t.id, "Legacy-course", "1000", "25.00");
    await pays(c.id, "FULL", "1000.00", { share: null, paidAt: "2026-07-12T06:00:00Z", billing: [2026, 7] });
    const slip = await slipFor(2026, 7, t.id);
    assert.equal(slip.totalInstituteShare, "250.00");
    assert.equal(slip.totalTeacherShare, "750.00");
  });

  // ---- rounding ------------------------------------------------------------------------------------

  test("CURRENT BEHAVIOUR (rounding, see report 9.3): slips round each teacher's two halves separately, so the slips and the roll-up can be a cent apart", async () => {
    // Two teachers, each collecting 10.00 at 34.96% → institute 3.496 each.
    // A slip shows 3.50 / 6.50 (rounded per teacher); the roll-up sums 6.992 / 13.008 first and shows 6.99 / 13.01.
    const [t1, t2] = [await makeTeacher(db), await makeTeacher(db)];
    for (const [i, t] of [t1, t2].entries()) {
      const c = await course(t.id, `Cent-course-${i}`, "10", "34.96");
      await pays(c.id, "FULL", "10.00", { share: "34.96", paidAt: "2026-09-10T06:00:00Z", billing: [2026, 9] });
    }
    const report = await buildPayslips({ year: 2026, month: 9, includeInstitute: true });
    const slips = report.slips.filter((s) => [t1.id, t2.id].includes(s.teacherId));
    assert.deepEqual(slips.map((s) => [s.totalInstituteShare, s.totalTeacherShare]), [["3.50", "6.50"], ["3.50", "6.50"]]);
    const slipSumInstitute = slips.reduce((s, x) => s + Number(x.totalInstituteShare), 0).toFixed(2);
    const slipSumTeacher = slips.reduce((s, x) => s + Number(x.totalTeacherShare), 0).toFixed(2);
    assert.deepEqual([slipSumInstitute, slipSumTeacher], ["7.00", "13.00"]);
    assert.deepEqual(
      [report.institute?.totalCollected, report.institute?.totalInstituteShare, report.institute?.totalTeacherShare],
      ["20.00", "6.99", "13.01"],
    );
  });
});
