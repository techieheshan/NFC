import { dbSkip, enrol, freezeClock, makeCourse, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

/*
 * Job 5: the admin's "Half and No-charge months" data, against numbers worked out by hand. Months are
 * written by the real takePayment and cancelled by the real cancelTransaction; volume and legacy rows
 * are written directly.
 *
 * Nov 2026 (Colombo). Two people took money:
 *   admin  5 Full, 2 Half months, 1 No charge, and 1 cancelled Half
 *   staff  10 Full, 3 Half months, 4 No charge, 1 cancelled No-charge, plus
 *          - a Half month at 00:30 on 1 Nov Colombo (= 19:00 UTC on 31 Oct)  -> NOVEMBER
 *          - a Half month at 23:59 on 31 Oct Colombo                          -> OCTOBER, not here
 */

const SINCE = "2025-12-05T06:00:00Z";
const NOV = { year: 2026, month: 11 };

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let staffRecord: { id: number };
let course: { id: number };
let pay: typeof import("@/app/(app)/payment/actions");
let rec: typeof import("@/app/(app)/receipts/actions");
let lib: typeof import("@/lib/report-half-no-charge");

type Mode = "FULL" | "HALF" | "NO_CHARGE";

describe("the Half and No-charge review data against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock("2026-11-10T06:00:00Z");
    ({ db } = await import("@/lib/db"));
    pay = await import("@/app/(app)/payment/actions");
    rec = await import("@/app/(app)/receipts/actions");
    lib = await import("@/lib/report-half-no-charge");
    w = await seedWorld(db, { admissionFee: "1300", smartCardFee: "500" });
    course = await makeCourse(db, w, { teacherId: (await makeTeacher(db)).id, fee: "2500", name: "ReviewCourse" });
    // staff has a Staff record, so the report shows a person's NAME; admin shows the username
    staffRecord = await db.staff.create({ data: { name: "Sadun Staff" } });
    await db.user.update({ where: { id: w.staff.id }, data: { staffId: staffRecord.id } });
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------------------------

  let n = 0;
  async function student() {
    const s = await db.student.create({ data: { name: `Review Kid ${++n}`, cardNumber: `RV-${n}` } });
    await enrol(db, { studentId: s.id, courseId: course.id, tierId: w.tiers.FULL.id, since: SINCE });
    return s;
  }
  async function take(at: string, who: "ADMIN" | "STAFF", months: { year: number; month: number; mode?: Mode }[]) {
    freezeClock(at);
    setSession(who, who === "ADMIN" ? w.admin.id : w.staff.id);
    const s = await student();
    const res = await pay.takePayment({ studentId: s.id, admission: false, smartCard: false, comboDecisions: [], classMonths: months.map((m) => ({ courseId: course.id, ...m })) });
    assert.equal(res.ok, true, JSON.stringify(res));
    return s;
  }
  async function cancel(studentId: number) {
    setSession("ADMIN", w.admin.id);
    const f = new FormData();
    f.set("key", `ref:${(await db.payment.findFirstOrThrow({ where: { studentId, cancelled: false } })).transactionRef}`);
    f.set("reason", "test cancel");
    assert.deepEqual(await rec.cancelTransaction({ ok: false }, f), { ok: true });
  }
  const report = (year: number, month: number, o: { mode?: "HALF" | "NO_CHARGE" | null; staffId?: string | null } = {}) => lib.buildHalfNoChargeReport({ year, month, ...o });
  const staffRow = (r: Awaited<ReturnType<typeof report>>, id: string) => r.staff.find((s) => s.userId === id)!;

  before(async () => {
    const day = (d: number, h = 6) => `2026-11-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00Z`;
    // admin: 5 Full, 2 Half, 1 No charge, 1 cancelled Half
    for (let i = 0; i < 5; i++) await take(day(5, 4 + i), "ADMIN", [{ ...NOV }]);
    await take(day(5, 10), "ADMIN", [{ ...NOV, mode: "HALF" }]);
    await take(day(5, 11), "ADMIN", [{ ...NOV, mode: "HALF" }]);
    await take(day(5, 12), "ADMIN", [{ ...NOV, mode: "NO_CHARGE" }]);
    const voidHalf = await take(day(5, 13), "ADMIN", [{ ...NOV, mode: "HALF" }]);
    // staff: 10 Full, 3 Half, 4 No charge, 1 cancelled No-charge
    for (let i = 0; i < 10; i++) await take(day(6, i), "STAFF", [{ ...NOV }]);
    for (let i = 0; i < 3; i++) await take(day(7, 4 + i), "STAFF", [{ ...NOV, mode: "HALF" }]);
    for (let i = 0; i < 4; i++) await take(day(8, 4 + i), "STAFF", [{ ...NOV, mode: "NO_CHARGE" }]);
    const voidFree = await take(day(9, 4), "STAFF", [{ ...NOV, mode: "NO_CHARGE" }]);
    await take("2026-10-31T19:00:00Z", "STAFF", [{ ...NOV, mode: "HALF" }]); // 00:30 on 1 Nov in Colombo -> November
    await take("2026-10-31T18:29:00Z", "STAFF", [{ year: 2026, month: 10, mode: "HALF" }]); // 23:59 on 31 Oct in Colombo -> October
    await cancel(voidHalf.id);
    await cancel(voidFree.id);
    freezeClock("2026-11-10T06:00:00Z");
  });

  // ---- the hand-computed table --------------------------------------------------------------------

  test("per staff: Half and No-charge counts, the Half amount, and the share of their own months — all by hand", async () => {
    const r = await report(2026, 11);
    // admin: Half 2 (1250 + 1250 = 2500.00), No charge 1; all their months 5 + 2 + 1 = 8 (the cancelled Half is not one) -> 3 of 8 = 38%
    assert.deepEqual(staffRow(r, w.admin.id), { userId: w.admin.id, name: w.admin.username, half: 2, halfAmount: "2500.00", noCharge: 1, share: { months: 3, all: 8, percent: 38 } });
    // staff: Half 3 + the 00:30 Colombo one = 4 (5000.00), No charge 4; all 10 + 4 + 4 = 18 -> 8 of 18 = 44%. Named by their Staff record.
    assert.deepEqual(staffRow(r, w.staff.id), { userId: w.staff.id, name: "Sadun Staff", half: 4, halfAmount: "5000.00", noCharge: 4, share: { months: 8, all: 18, percent: 44 } });
    assert.deepEqual(r.totals, { half: 6, halfAmount: "7500.00", noCharge: 5, all: 26 });
    assert.deepEqual(r.staff.map((s) => s.name), ["Sadun Staff", w.admin.username], "busiest first");
  });

  test("the Colombo month boundary: 00:30 on 1 Nov (19:00 UTC on 31 Oct) is NOVEMBER; 23:59 on 31 Oct is October", async () => {
    const nov = await report(2026, 11);
    const oct = await report(2026, 10);
    assert.equal(nov.rows.some((x) => x.date === "2026-11-01" && x.at === "00:30" && x.mode === "HALF"), true);
    assert.equal(nov.rows.some((x) => x.date === "2026-10-31"), false);
    assert.deepEqual(oct.rows.map((x) => [x.date, x.at, x.mode]), [["2026-10-31", "23:59", "HALF"]]);
    assert.deepEqual(oct.totals, { half: 1, halfAmount: "1250.00", noCharge: 0, all: 1 });
  });

  test("cancelled rows are LISTED (with the flag) but are in no count and no total", async () => {
    const r = await report(2026, 11);
    assert.equal(r.rowCount, 13); // 2 + 1 + 1 cancelled (admin) and 4 + 4 + 1 cancelled (staff)
    assert.equal(r.cancelledCount, 2);
    assert.equal(r.rows.filter((x) => x.cancelled).length, 2);
    assert.deepEqual(r.rows.filter((x) => x.cancelled).map((x) => x.mode).sort(), ["HALF", "NO_CHARGE"]);
    assert.equal(r.totals.half + r.totals.noCharge, 11, "13 rows, 2 cancelled");
    assert.equal(r.capped, false);
  });

  test("the list is newest first, and every row has its student, course, billing month, amount and taker", async () => {
    const r = await report(2026, 11);
    const stamps = r.rows.map((x) => `${x.date} ${x.at}`);
    assert.deepEqual([...stamps].sort().reverse(), stamps);
    const half = r.rows.find((x) => x.mode === "HALF" && x.takenBy === w.admin.username && !x.cancelled)!;
    assert.deepEqual([half.course.startsWith("ReviewCourse"), half.billing, half.amount, half.cardNumber?.startsWith("RV-")], [true, "Nov 2026", "1250.00", true]);
    const free = r.rows.find((x) => x.mode === "NO_CHARGE" && !x.cancelled)!;
    assert.equal(free.amount, "0.00");
  });

  // ---- filters -----------------------------------------------------------------------------------

  test("Half only: no No-charge rows or counts; the share's denominator is still ALL of their months", async () => {
    const r = await report(2026, 11, { mode: "HALF" });
    assert.deepEqual(r.rows.map((x) => x.mode), r.rows.map(() => "HALF"));
    assert.deepEqual([staffRow(r, w.staff.id).noCharge, staffRow(r, w.staff.id).half, staffRow(r, w.staff.id).share], [0, 4, { months: 4, all: 18, percent: 22 }]);
    assert.equal(r.rowCount, 7); // admin 2 + 1 cancelled Half, staff 4
    assert.equal(r.cancelledCount, 1);
    assert.deepEqual(r.totals, { half: 6, halfAmount: "7500.00", noCharge: 0, all: 26 });
  });

  test("No charge only", async () => {
    const r = await report(2026, 11, { mode: "NO_CHARGE" });
    assert.deepEqual(r.rows.map((x) => x.mode), r.rows.map(() => "NO_CHARGE"));
    assert.deepEqual([r.totals.half, r.totals.halfAmount, r.totals.noCharge], [0, "0.00", 5]);
    assert.equal(r.rowCount, 6); // admin 1, staff 4 + 1 cancelled
  });

  test("one person: only their rows and only their months in the denominator", async () => {
    const r = await report(2026, 11, { staffId: w.staff.id });
    assert.deepEqual(r.staff.map((s) => s.userId), [w.staff.id]);
    assert.deepEqual(r.totals, { half: 4, halfAmount: "5000.00", noCharge: 4, all: 18 });
    assert.ok(r.rows.every((x) => x.takenBy === "Sadun Staff"));
    assert.equal(r.staffId, w.staff.id);
  });

  test("junk filters are ignored, not an empty report: an unknown person is 'everyone', an unknown mode is 'both'", async () => {
    const r = await report(2026, 11, { staffId: "no-such-user" });
    assert.equal(r.staffId, null);
    assert.equal(r.totals.half, 6);
    assert.equal(lib.parseModeFilter("half"), "HALF");
    assert.equal(lib.parseModeFilter("nocharge"), "NO_CHARGE");
    for (const junk of [undefined, "", "all", "HALF", "full", "half,nocharge"]) assert.equal(lib.parseModeFilter(junk), null, String(junk));
  });

  test("the people to pick from are the ADMIN and STAFF logins, by name", async () => {
    const r = await report(2026, 11);
    assert.deepEqual(new Set(r.staffOptions.map((o) => o.id)), new Set([w.admin.id, w.staff.id]));
    assert.equal(r.staffOptions.find((o) => o.id === w.staff.id)?.name, "Sadun Staff");
  });

  // ---- nothing in the month, a month with only cancelled rows ---------------------------------------------

  test("a month with nothing: empty, not capped, no people", async () => {
    const r = await report(2026, 3);
    assert.deepEqual([r.rows, r.staff, r.rowCount, r.capped, r.cancelledCount], [[], [], 0, false, 0]);
    assert.deepEqual(r.totals, { half: 0, halfAmount: "0.00", noCharge: 0, all: 0 });
  });

  test("a month where everything in the filter is cancelled: the rows are listed, nobody is counted", async () => {
    const s = await take("2026-02-10T06:00:00Z", "STAFF", [{ year: 2026, month: 2, mode: "HALF" }]);
    await cancel(s.id);
    freezeClock("2026-11-10T06:00:00Z");
    const r = await report(2026, 2);
    assert.deepEqual([r.rowCount, r.cancelledCount, r.staff, r.rows.map((x) => x.cancelled)], [1, 1, [], [true]]);
    assert.deepEqual(r.totals, { half: 0, halfAmount: "0.00", noCharge: 0, all: 0 });
  });

  // ---- receipts ------------------------------------------------------------------------------------

  test("the receipt number is the LOWEST id of the transaction — not the Half row's own id — and a legacy row is its own receipt", async () => {
    freezeClock("2026-04-10T06:00:00Z");
    setSession("ADMIN", w.admin.id);
    const s = await student();
    // one receipt of two lines: a Full month first (the lowest id) and a Half month second
    const res = await pay.takePayment({ studentId: s.id, admission: false, smartCard: false, comboDecisions: [], classMonths: [{ courseId: course.id, year: 2026, month: 4 }, { courseId: course.id, year: 2026, month: 3, mode: "HALF" }] });
    assert.equal(res.ok, true);
    const rows = await db.payment.findMany({ where: { studentId: s.id }, orderBy: { id: "asc" } });
    const legacy = async (month: number) => db.payment.create({ data: { kind: "CLASS", studentId: s.id, courseId: course.id, billingYear: 2026, billingMonth: month, amount: "1250.00", chargeMode: "HALF", takenById: w.admin.id, paidAt: new Date("2026-04-11T06:00:00Z"), transactionRef: null } });
    const l1 = await legacy(5), l2 = await legacy(6);
    freezeClock("2026-11-10T06:00:00Z");

    const r = await report(2026, 4);
    const grouped = r.rows.find((x) => x.billing === "Mar 2026")!;
    assert.equal(grouped.id, rows[1].id);
    assert.equal(grouped.receipt, `XN-${rows[0].id}`, "the Half row is the second line; the receipt is the first line's id");
    assert.notEqual(grouped.receipt, `XN-${grouped.id}`);
    assert.equal(r.rows.find((x) => x.id === l1.id)?.receipt, `XN-${l1.id}`);
    assert.equal(r.rows.find((x) => x.id === l2.id)?.receipt, `XN-${l2.id}`, "two ref-less rows are two receipts; neither swallows the other");
    assert.equal(r.rows.find((x) => x.id === l1.id)?.receiptKey, `pay:${l1.id}`);
    assert.equal(grouped.receiptKey.startsWith("ref:"), true);
  });

  // ---- the cap ----------------------------------------------------------------------------------------

  test("more than 300 rows: the list is the newest 300, and the counts and totals cover ALL of them", async () => {
    const kid = await student();
    const total = 305;
    await db.payment.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        kind: "CLASS" as const, studentId: kid.id, courseId: course.id, billingYear: 2000 + Math.floor(i / 12), billingMonth: (i % 12) + 1,
        amount: i % 5 === 0 ? "1250.00" : "0.00", chargeMode: i % 5 === 0 ? ("HALF" as const) : ("NO_CHARGE" as const),
        takenById: w.staff.id, paidAt: new Date(Date.UTC(2026, 11, 3, 0, 0) + i * 60_000), transactionRef: randomUUID(),
      })),
    });
    await db.payment.create({ data: { kind: "CLASS", studentId: kid.id, courseId: course.id, billingYear: 1990, billingMonth: 1, amount: "0.00", chargeMode: "NO_CHARGE", takenById: w.staff.id, paidAt: new Date("2026-12-04T00:00:00Z"), transactionRef: randomUUID(), cancelled: true, cancelledById: w.admin.id, cancelledAt: new Date("2026-12-04T01:00:00Z"), cancelReason: "x" } });

    const r = await report(2026, 12);
    assert.equal(r.rows.length, lib.DETAIL_CAP);
    assert.equal(lib.DETAIL_CAP, 300);
    assert.equal(r.rowCount, total + 1);
    assert.equal(r.capped, true);
    // 61 Half (i = 0, 5, ..., 300) and 244 No charge — over ALL 305, not the 300 listed
    assert.deepEqual([r.totals.half, r.totals.halfAmount, r.totals.noCharge], [61, "76250.00", 244]);
    assert.deepEqual(r.staff.map((s) => [s.half, s.noCharge, s.share]), [[61, 244, { months: 305, all: 305, percent: 100 }]]);
    // the newest is the cancelled one (04 Dec), then the latest of the 305
    assert.equal(r.rows[0].cancelled, true);
    // exactly 300 listed: nothing is derived from them
    assert.equal(r.rows.filter((x) => x.mode === "HALF").length < r.totals.half, true, "the capped list holds fewer Half rows than the true count");
  });

  test("exactly 300 rows is not 'capped'", async () => {
    const kid = await student();
    await db.payment.createMany({
      data: Array.from({ length: 300 }, (_, i) => ({
        kind: "CLASS" as const, studentId: kid.id, courseId: course.id, billingYear: 2000 + Math.floor(i / 12), billingMonth: (i % 12) + 1,
        amount: "0.00", chargeMode: "NO_CHARGE" as const, takenById: w.admin.id, paidAt: new Date(Date.UTC(2027, 0, 5, 0, 0) + i * 60_000), transactionRef: randomUUID(),
      })),
    });
    const r = await report(2027, 1);
    assert.deepEqual([r.rows.length, r.rowCount, r.capped], [300, 300, false]);
  });

  // ---- NULL: a full-fee row is never a Half or No-charge month ------------------------------------------

  test("rows with a NULL chargeMode never show here, and are the denominator ('normal')", async () => {
    const r = await report(2026, 11);
    assert.ok(r.rows.every((x) => x.mode === "HALF" || x.mode === "NO_CHARGE"));
    assert.equal(staffRow(r, w.staff.id).share.all, 18, "10 Full rows (NULL chargeMode) are in the denominator");
  });
});
