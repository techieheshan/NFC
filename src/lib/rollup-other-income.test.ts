import { dbSkip, freezeClock, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

import { colomboDateValue } from "@/lib/colombo-time";

/*
 * The month-end roll-up and Payslips carry other income and extra payments as their OWN lines, and both count in profit.
 *  - a month with neither: no new key anywhere and profit exactly the old formula (also pinned by reports-golden);
 *  - a month with extra payments: by `paidAt` at the Colombo midnight, cancelled excluded;
 *  - a month with other income (cash AND bank, cancelled excluded) and a bonus paid from it: income adds, bonus subtracts, the line rebuilds.
 */

const NOW = "2026-11-16T06:00:00Z"; // 11:30 Colombo, 16 Nov 2026
type Actions = typeof import("@/app/(app)/salary-adjustments/actions");
let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let A: Actions;
let teacherId: number;
let donationId: number;
let n = 0;

const roll = async (year: number, month: number) => (await import("@/lib/report-monthly-income")).buildMonthlyIncome(year, month);
const extra = (total: string, paidAt: string, cancelled = false) =>
  db.extraPayment.create({
    data: {
      clientRef: `rollup-${String(++n).padStart(8, "0")}`, total, paidAt: new Date(paidAt), takenById: w.staff.id,
      ...(cancelled ? { cancelled: true, cancelledById: w.admin.id, cancelledAt: new Date(), cancelReason: "returned" } : {}),
    },
  });
const income = (amount: string, date: string, method: "CASH" | "BANK", cancelled = false) =>
  db.otherIncome.create({
    data: {
      categoryId: donationId, amount, date: colomboDateValue(date), method, receivedById: w.staff.id, recordedById: w.staff.id, source: `donor ${++n}`,
      ...(cancelled ? { cancelled: true, cancelledById: w.admin.id, cancelledAt: new Date(), cancelReason: "typed twice" } : {}),
    },
  });

describe("roll-up: other income and extra payments (database)", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    A = await import("@/app/(app)/salary-adjustments/actions");
    w = await seedWorld(db);
    donationId = (await db.incomeCategory.findFirstOrThrow({ where: { code: "DONATION" } })).id;
    const teacher = await makeTeacher(db, "Teacher One");
    teacherId = teacher.id;
    // 10,000.00 of class fees at 20% institute share in each of Sep, Oct and Nov -> institute keeps 2,000.00 a month
    const course = await makeCourse(db, w, { teacherId, fee: "10000.00", share: "20.00" });
    for (const [month, paidAt] of [[9, "2026-09-05T05:00:00Z"], [10, "2026-10-05T05:00:00Z"], [11, "2026-11-05T05:00:00Z"]] as const) {
      const student = await makeStudent(db);
      await db.payment.create({ data: { kind: "CLASS", studentId: student.id, courseId: course.id, amount: "10000.00", billingYear: 2026, billingMonth: month, takenById: w.staff.id, paidAt: new Date(paidAt), instituteSharePercentApplied: "20.00" } });
    }
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  test("a month with neither: no new key, profit is the old formula, and the roll-up reconciles", async () => {
    const r = await roll(2026, 9);
    const i = r.institute;
    for (const key of ["otherIncome", "extraPayments", "adjustments"]) assert.equal(key in i, false, key);
    assert.equal(i.instituteProfit, "2000.00");
    assert.equal(r.reconciles.profit, true);
    const { buildPayslips } = await import("@/lib/payslips");
    assert.deepEqual((await buildPayslips({ year: 2026, month: 9, includeInstitute: true })).institute, i, "Payslips and the roll-up read the one summary");
  });

  test("a month with extra payments: a live bill counts, a cancelled one does not, the month is cut at Colombo midnight", async () => {
    await extra("3000.00", "2026-10-10T05:00:00Z");
    await extra("1500.00", "2026-10-10T06:00:00Z", true);
    await extra("700.00", "2026-10-31T18:29:00Z"); // 23:59 on 31 Oct in Colombo -> October
    await extra("900.00", "2026-10-31T18:30:00Z"); // 00:00 on 1 Nov in Colombo -> November
    const oct = await roll(2026, 10);
    assert.equal(oct.institute.extraPayments, "3700.00");
    assert.equal("otherIncome" in oct.institute, false);
    assert.equal(oct.institute.instituteProfit, "5700.00", "2,000.00 institute share + 3,700.00 extra payments");
    assert.equal(oct.reconciles.profit, true);
    assert.equal((await roll(2026, 9)).institute.instituteProfit, "2000.00", "another month is untouched");
  });

  test("a month with other income (cash and bank) and a bonus paid from it: income adds, the bonus subtracts, the profit line rebuilds", async () => {
    setSession("ADMIN", w.admin.id);
    const before = await roll(2026, 11);
    assert.equal(before.institute.extraPayments, "900.00", "the 00:00 bill from the previous test lands here");
    assert.equal(before.institute.instituteProfit, "2900.00");

    const cash = await income("20000.00", "2026-11-12", "CASH");
    await income("5000.00", "2026-11-13", "BANK");
    await income("1000.00", "2026-11-14", "CASH", true); // cancelled: in no figure
    await income("8000.00", "2026-10-30", "CASH"); // October's, not November's
    const bonus = await A.createSalaryAdjustment({
      kind: "BONUS", sourceId: cash.id, title: "Seminar bonus", month: "2026-11", splitMode: "CUSTOM",
      people: [{ key: `t${teacherId}`, amount: "5000" }], consentNote: "Approved by the owner", consentOn: "2026-11-16",
    });
    assert.ok(bonus.ok, JSON.stringify(bonus));

    const r = await roll(2026, 11);
    const i = r.institute;
    assert.equal(i.otherIncome, "25000.00", "20,000.00 cash + 5,000.00 bank; the cancelled and the October rows are out");
    assert.equal(i.adjustments?.bonuses, "5000.00");
    assert.equal(i.instituteProfit, "22900.00", "2,000.00 + 900.00 + 25,000.00 - 5,000.00");
    assert.equal(r.reconciles.profit, true);
    assert.equal((await roll(2026, 10)).institute.otherIncome, "8000.00");
    assert.equal((await roll(2026, 10)).institute.instituteProfit, "13700.00");
  });

  test("cancelling an income takes it out of the roll-up again", async () => {
    setSession("ADMIN", w.admin.id);
    const extraId = (await db.otherIncome.findFirstOrThrow({ where: { method: "BANK" } })).id;
    await db.otherIncome.update({ where: { id: extraId }, data: { cancelled: true, cancelledById: w.admin.id, cancelledAt: new Date(), cancelReason: "wrong day" } });
    const r = await roll(2026, 11);
    assert.equal(r.institute.otherIncome, "20000.00");
    assert.equal(r.institute.instituteProfit, "17900.00");
    assert.equal(r.reconciles.profit, true);
  });
});
