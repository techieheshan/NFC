import { dbSkip, enrol, freezeClock, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";

/*
 * Daily Summary R1: the three new READ-ONLY helpers, proven against `dailySummary()` itself.
 *  - per-day figures: for EVERY day of a seeded range, collected / deductions / net equal what
 *    `dailySummary(day, day)` returns, and the total row equals `dailySummary(from, to)`;
 *  - staff totals add up to Total collected, day by day;
 *  - a cancelled receipt is in nothing but its own line; a receipt is a transaction, not a row.
 */

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let dailySummary: typeof import("@/lib/reports").dailySummary;
let x: typeof import("@/lib/daily-summary-extras");
let course: { id: number };
let course2: { id: number };
let staffB: { id: string };

const FROM = "2026-10-08";
const TO = "2026-10-16";

describe("daily summary extras against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock("2026-10-20T06:00:00Z");
    ({ db } = await import("@/lib/db"));
    ({ dailySummary } = await import("@/lib/reports"));
    x = await import("@/lib/daily-summary-extras");
    w = await seedWorld(db, { admissionFee: "1300", smartCardFee: "500" });
    const t = await makeTeacher(db, "Mr Extras");
    course = await makeCourse(db, w, { teacherId: t.id, fee: "2500", name: "Extras One" });
    course2 = await makeCourse(db, w, { teacherId: t.id, fee: "1250.55", name: "Extras Two" });
    await db.staff.create({ data: { name: "Sadun Staff" } }).then((s) => db.user.update({ where: { id: w.staff.id }, data: { staffId: s.id } }));
    staffB = await db.user.create({ data: { username: "second-staff", passwordHash: "x", role: "STAFF" } });
    await db.expenseType.create({ data: { code: "TEACHER_ADVANCE", label: "Teacher advance", affectsTeacherPayslip: true } });
    await db.expenseType.create({ data: { code: "XENON", label: "Xenon" } });

    const kid = async () => {
      const s = await makeStudent(db, { admissionPaid: true });
      await enrol(db, { studentId: s.id, courseId: course.id, tierId: w.tiers.FULL.id, since: "2026-08-05T06:00:00Z" });
      return s;
    };
    let ref = 0;
    const row = async (at: string, o: { kind?: "CLASS" | "ADMISSION" | "SMART_CARD"; amount: string; by?: string; ref?: string | null; cancelled?: boolean; courseId?: number | null }) => {
      const s = await kid();
      const kind = o.kind ?? "CLASS";
      await db.payment.create({
        data: {
          kind, studentId: s.id, amount: o.amount, paidAt: new Date(at), takenById: o.by ?? w.staff.id,
          courseId: kind === "CLASS" ? (o.courseId === undefined ? course.id : o.courseId) : null,
          billingYear: kind === "CLASS" ? 2026 : null, billingMonth: kind === "CLASS" ? 10 : null,
          feeTierId: kind === "CLASS" ? w.tiers.FULL.id : null,
          transactionRef: o.ref === undefined ? `R-${++ref}` : o.ref,
          cancelled: o.cancelled ?? false,
          ...(o.cancelled ? { cancelledById: w.admin.id, cancelledAt: new Date(at), cancelReason: "test" } : {}),
        },
      });
    };
    // Thu 8: two rows, one receipt (shared ref), taken by staff one
    await row("2026-10-08T04:00:00Z", { amount: "2500.00", ref: "SHARED" });
    await row("2026-10-08T04:00:00Z", { amount: "1250.55", ref: "SHARED", courseId: course2.id });
    // Fri 9: admission + smart card + class, by the second staff; plus a cancelled receipt of 2 rows
    await row("2026-10-09T05:00:00Z", { kind: "ADMISSION", amount: "1300.00", by: staffB.id });
    await row("2026-10-09T05:00:00Z", { kind: "SMART_CARD", amount: "500.00", by: staffB.id });
    await row("2026-10-09T06:00:00Z", { amount: "2500.00", by: staffB.id });
    await row("2026-10-09T07:00:00Z", { amount: "2500.00", ref: "VOID", cancelled: true });
    await row("2026-10-09T07:00:00Z", { amount: "1250.55", ref: "VOID", cancelled: true, courseId: course2.id });
    // Sat 10: NOTHING (no payments) but an expense
    // Sun 11: the Colombo midnight edge: 18:29:59Z on the 10th is Colombo 23:59:59 on the 10th; 18:30:00Z is the 11th 00:00
    await row("2026-10-10T18:29:59Z", { amount: "100.10" });
    await row("2026-10-10T18:30:00Z", { amount: "200.20" });
    // Mon 12: a legacy row with a NULL ref stands alone, and a CLASS row with no course (never counted by the summary)
    await row("2026-10-12T04:00:00Z", { amount: "700.00", ref: null });
    await row("2026-10-12T04:30:00Z", { amount: "800.00", ref: null });
    await row("2026-10-12T05:00:00Z", { amount: "999.00", courseId: null });
    // Fri 16: a cancelled legacy row (null ref)
    await row("2026-10-16T04:00:00Z", { amount: "321.09", ref: null, cancelled: true });

    const type = (code: string) => db.expenseType.findFirstOrThrow({ where: { code } });
    const exp = async (date: string, code: string, amount: string) =>
      db.expense.create({ data: { expenseTypeId: (await type(code)).id, amount, reason: "t", date: new Date(`${date}T00:00:00Z`), recordedById: w.admin.id, authorizedById: w.admin.id } });
    await exp("2026-10-08", "XENON", "300.10");
    await exp("2026-10-09", "TEACHER_ADVANCE", "1000.00");
    await exp("2026-10-10", "XENON", "4500.00"); // a day with an expense and no payments: net is negative
    await exp("2026-10-12", "XENON", "0.05");
    await exp("2026-10-12", "TEACHER_ADVANCE", "0.10");
    unfreezeClock();
  });
  after(async () => {
    await db.$disconnect();
    await handle.drop();
  });

  test("dayByDay: for EVERY day, collected, deductions and net equal dailySummary(day, day)", async () => {
    const { days } = await x.dayByDay(FROM, TO);
    assert.equal(days.length, 9);
    for (const d of days) {
      const s = await dailySummary(d.date, d.date);
      assert.equal(d.collected, s.totalCollected, `${d.date} collected`);
      assert.equal(d.deductions, s.deductions.total, `${d.date} deductions`);
      assert.equal(d.net, s.net, `${d.date} net`);
    }
  });

  test("dayByDay: the total row equals dailySummary(from, to), and the figures are not all zero", async () => {
    const { days, total } = await x.dayByDay(FROM, TO);
    const s = await dailySummary(FROM, TO);
    assert.equal(total.collected, s.totalCollected);
    assert.equal(total.deductions, s.deductions.total);
    assert.equal(total.net, s.net);
    assert.ok(Number(total.collected) > 0 && Number(total.deductions) > 0);
    assert.ok(days.some((d) => d.net.startsWith("-")), "a loss day keeps its minus sign (the quiet Saturday)");
  });

  test("dayByDay: the Colombo midnight edge sits on the right sides, and an empty day is listed with zeros", async () => {
    const { days } = await x.dayByDay(FROM, TO);
    const by = Object.fromEntries(days.map((d) => [d.date, d]));
    assert.equal(by["2026-10-10"].collected, "100.10"); // 23:59:59 Colombo on the 10th
    assert.equal(by["2026-10-11"].collected, "200.20"); // 00:00:00 Colombo on the 11th
    assert.equal(by["2026-10-10"].deductions, "4500.00");
    assert.equal(by["2026-10-13"].collected, "0.00");
    assert.equal(by["2026-10-13"].net, "0.00");
  });

  test("dayByDay uses TWO queries for any length of range (never one per day)", async () => {
    const calls: string[] = [];
    const real = { p: db.payment.findMany.bind(db.payment), e: db.expense.findMany.bind(db.expense) };
    (db.payment as unknown as { findMany: unknown }).findMany = (...a: unknown[]) => (calls.push("payment"), (real.p as (...x: unknown[]) => unknown)(...a));
    (db.expense as unknown as { findMany: unknown }).findMany = (...a: unknown[]) => (calls.push("expense"), (real.e as (...x: unknown[]) => unknown)(...a));
    try {
      await x.dayByDay("2026-09-01", "2026-10-31");
    } finally {
      (db.payment as unknown as { findMany: unknown }).findMany = real.p;
      (db.expense as unknown as { findMany: unknown }).findMany = real.e;
    }
    assert.deepEqual(calls.sort(), ["expense", "payment"]);
  });

  test("collectedByStaff: the amounts add up to Total collected for every day and for the whole range", async () => {
    const sum = (rows: { collected: string }[]) => (rows.reduce((s, r) => s + Math.round(Number(r.collected) * 100), 0) / 100).toFixed(2);
    for (let d = 8; d <= 16; d++) {
      const day = `2026-10-${String(d).padStart(2, "0")}`;
      const rows = await x.collectedByStaff(day, day);
      assert.equal(sum(rows), (await dailySummary(day, day)).totalCollected, day);
    }
    assert.equal(sum(await x.collectedByStaff(FROM, TO)), (await dailySummary(FROM, TO)).totalCollected);
  });

  test("collectedByStaff: receipts are transactions (shared ref = one), a null ref stands alone, names and order", async () => {
    const thu = await x.collectedByStaff("2026-10-08", "2026-10-08");
    assert.equal(thu.length, 1);
    assert.equal(thu[0].name, "Sadun Staff");
    assert.equal(thu[0].receipts, 1); // two rows, one receipt
    assert.equal(thu[0].collected, "3750.55");
    const mon = await x.collectedByStaff("2026-10-12", "2026-10-12");
    assert.equal(mon[0].receipts, 2); // two legacy rows with a null ref are two receipts; the course-less CLASS row is not counted
    assert.equal(mon[0].collected, "1500.00");
    const fri = await x.collectedByStaff("2026-10-09", "2026-10-09");
    assert.equal(fri[0].name, "second-staff"); // no Staff name: the username
    assert.equal(fri[0].receipts, 3);
    assert.equal(fri[0].collected, "4300.00");
    assert.equal(fri.length, 1, "the cancelled receipt's taker is not listed for it");
  });

  test("cancelled receipts: counted as receipts (not rows), the would-be total, and in no other figure", async () => {
    const fri = await x.cancelledReceipts("2026-10-09", "2026-10-09");
    assert.deepEqual(fri, { receipts: 1, total: "3750.55" });
    const sixteenth = await x.cancelledReceipts("2026-10-16", "2026-10-16");
    assert.deepEqual(sixteenth, { receipts: 1, total: "321.09" }); // a legacy row with a null ref is one receipt
    assert.deepEqual(await x.cancelledReceipts("2026-10-13", "2026-10-13"), { receipts: 0, total: "0.00" });
    assert.deepEqual(await x.cancelledReceipts(FROM, TO), { receipts: 2, total: "4071.64" });
    // excluded everywhere else
    const s = await dailySummary("2026-10-09", "2026-10-09");
    assert.equal(s.totalCollected, "4300.00"); // 1300 + 500 + 2500; the 3750.55 cancelled receipt is not in it
  });
});
