import { dbSkip, enrol, freezeClock, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * Safety net for the Payment redesign (job 1): cancel, reprint, and what a
 * cancellation does to everything that reads payments. Real actions, throw-away
 * Postgres, clock frozen at 15 Oct 2026 11:30 Colombo.
 */

const NOW = "2026-10-15T06:00:00Z";
const SINCE = "2026-04-01T06:00:00Z";
const DAY = "2026-10-15";
const OCT = { year: 2026, month: 10 };

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let pay: typeof import("@/app/(app)/payment/actions");
let rec: typeof import("@/app/(app)/receipts/actions");
let reports: typeof import("@/lib/reports");
let payslips: typeof import("@/lib/payslips");
let arrears: typeof import("@/lib/student-arrears");

describe("cancel / reprint against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    pay = await import("@/app/(app)/payment/actions");
    rec = await import("@/app/(app)/receipts/actions");
    reports = await import("@/lib/reports");
    payslips = await import("@/lib/payslips");
    arrears = await import("@/lib/student-arrears");
    w = await seedWorld(db);
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------
  const asAdmin = () => setSession("ADMIN", w.admin.id);
  const asStaff = () => setSession("STAFF", w.staff.id);
  const rows = (studentId: number) => db.payment.findMany({ where: { studentId }, orderBy: { id: "asc" } });
  const dec = (d: { toFixed: (n: number) => string } | null) => d?.toFixed(2);
  const form = (key: string, reason: string) => {
    const f = new FormData();
    f.set("key", key);
    f.set("reason", reason);
    return f;
  };
  const cancel = (key: string, reason = "entered for the wrong student") => rec.cancelTransaction({ ok: false }, form(key, reason));

  async function setup(o: { fee?: string; share?: string; teacherId?: number } = {}) {
    const teacherId = o.teacherId ?? (await makeTeacher(db)).id;
    const course = await makeCourse(db, w, { teacherId, fee: o.fee ?? "2500", share: o.share ?? "20.00" });
    const student = await makeStudent(db, { cardUid: `UID${Math.random().toString(16).slice(2, 10)}` });
    await enrol(db, { studentId: student.id, courseId: course.id, tierId: w.tiers.FULL.id, since: SINCE });
    return { teacherId, course, student };
  }
  async function charge(studentId: number, classMonths: { courseId: number; year: number; month: number }[], extra: { admission?: boolean; smartCard?: boolean } = {}) {
    asAdmin();
    const res = await pay.takePayment({ studentId, admission: false, smartCard: false, classMonths, comboDecisions: [], ...extra });
    assert.equal(res.ok, true, JSON.stringify(res));
    return (res as Extract<typeof res, { ok: true }>).receipt;
  }
  const refOf = async (studentId: number) => `ref:${(await rows(studentId))[0].transactionRef}`;

  // ---- cancelling ---------------------------------------------------------------

  test("ADMIN cancels the WHOLE transaction: every row is voided, stamped, and keeps its amount", async () => {
    const t = await makeTeacher(db);
    const a = await setup({ fee: "2500", teacherId: t.id });
    const b = await makeCourse(db, w, { teacherId: t.id, fee: "1800" });
    await enrol(db, { studentId: a.student.id, courseId: b.id, tierId: w.tiers.FULL.id, since: SINCE });
    await charge(a.student.id, [{ courseId: a.course.id, ...OCT }, { courseId: b.id, ...OCT }]);

    asAdmin();
    assert.deepEqual(await cancel(await refOf(a.student.id), "  wrong student  "), { ok: true });

    const ps = await rows(a.student.id);
    assert.equal(ps.length, 2);
    for (const p of ps) {
      assert.equal(p.cancelled, true);
      assert.equal(p.cancelledById, w.admin.id);
      assert.equal(p.cancelledAt?.toISOString(), "2026-10-15T06:00:00.000Z");
      assert.equal(p.cancelReason, "wrong student");
    }
    assert.deepEqual(ps.map((p) => dec(p.amount)), ["2500.00", "1800.00"]); // never recomputed
  });

  test("cancelling touches ONLY that transaction", async () => {
    const { course, student } = await setup();
    await charge(student.id, [{ courseId: course.id, year: 2026, month: 9 }]);
    await charge(student.id, [{ courseId: course.id, ...OCT }]);
    const [first, second] = await rows(student.id);
    asAdmin();
    await cancel(`ref:${second.transactionRef}`);
    const after = await rows(student.id);
    assert.equal(after.find((p) => p.id === first.id)?.cancelled, false);
    assert.equal(after.find((p) => p.id === second.id)?.cancelled, true);
  });

  test("STAFF cancelling is refused AT RUNTIME, with the exact message, and nothing changes (rule 29)", async () => {
    const { course, student } = await setup();
    await charge(student.id, [{ courseId: course.id, ...OCT }]);
    const key = await refOf(student.id);
    asStaff();
    await assert.rejects(() => cancel(key), { message: "Not authorised" });
    assert.equal((await rows(student.id))[0].cancelled, false);
    assert.equal((await rows(student.id))[0].cancelledById, null);
    // Control: the same request as ADMIN goes through.
    asAdmin();
    assert.deepEqual(await cancel(key), { ok: true });
    assert.equal((await rows(student.id))[0].cancelled, true);
  });

  test("cancelling twice, or an unknown transaction, is answered by content and changes nothing", async () => {
    const { course, student } = await setup();
    await charge(student.id, [{ courseId: course.id, ...OCT }]);
    const key = await refOf(student.id);
    asAdmin();
    await cancel(key);
    assert.deepEqual(await cancel(key), { ok: false, error: "This receipt is already cancelled.", values: { reason: "entered for the wrong student" } });
    assert.deepEqual(await cancel("ref:00000000-0000-4000-8000-000000000000"), {
      ok: false,
      error: "That transaction no longer exists.",
      values: { reason: "entered for the wrong student" },
    });
    assert.deepEqual(await cancel("pay:2000000000"), { ok: false, error: "That transaction no longer exists.", values: { reason: "entered for the wrong student" } });
  });

  // ---- admission / smart card side effects -----------------------------------------

  test("cancelling an ADMISSION transaction reverts Student.admissionPaid, and admission can be taken again", async () => {
    const { course, student } = await setup();
    await charge(student.id, [{ courseId: course.id, ...OCT }], { admission: true });
    assert.equal((await db.student.findUniqueOrThrow({ where: { id: student.id } })).admissionPaid, true);

    asAdmin();
    await cancel(await refOf(student.id));
    assert.equal((await db.student.findUniqueOrThrow({ where: { id: student.id } })).admissionPaid, false);

    await charge(student.id, [], { admission: true }); // payable again
    assert.equal((await db.student.findUniqueOrThrow({ where: { id: student.id } })).admissionPaid, true);
  });

  test("cancelling a transaction WITHOUT admission leaves admissionPaid alone", async () => {
    const { course, student } = await setup();
    await charge(student.id, [], { admission: true });
    await charge(student.id, [{ courseId: course.id, ...OCT }]);
    const classKey = `ref:${(await rows(student.id))[1].transactionRef}`;
    asAdmin();
    await cancel(classKey);
    assert.equal((await db.student.findUniqueOrThrow({ where: { id: student.id } })).admissionPaid, true);
  });

  test("a cancelled SMART_CARD leaves cardUid alone", async () => {
    const { student } = await setup();
    const card = (await db.student.findUniqueOrThrow({ where: { id: student.id } })).cardUid;
    await charge(student.id, [], { smartCard: true });
    asAdmin();
    await cancel(await refOf(student.id));
    const s = await db.student.findUniqueOrThrow({ where: { id: student.id } });
    assert.equal(s.cardUid, card);
    assert.equal((await rows(student.id))[0].cancelled, true);
  });

  // ---- legacy rows with a null transactionRef ---------------------------------------

  test("a legacy null-ref row is a transaction of ONE: cancelling pay:<id> voids that row and no other null-ref row (rule 18)", async () => {
    const { course, student } = await setup();
    const other = await setup();
    const legacy = (studentId: number, courseId: number, month: number) =>
      db.payment.create({
        data: { kind: "CLASS", studentId, courseId, billingYear: 2026, billingMonth: month, amount: "2500.00", feeTierId: w.tiers.FULL.id, instituteSharePercentApplied: "20.00", takenById: w.admin.id, transactionRef: null },
      });
    const a = await legacy(student.id, course.id, 8);
    const b = await legacy(student.id, course.id, 9);
    const c = await legacy(other.student.id, other.course.id, 9);

    asAdmin();
    assert.deepEqual(await cancel(`pay:${a.id}`), { ok: true });

    const state = async (id: number) => (await db.payment.findUniqueOrThrow({ where: { id } })).cancelled;
    assert.equal(await state(a.id), true);
    assert.equal(await state(b.id), false); // same student, also null-ref
    assert.equal(await state(c.id), false); // another student, also null-ref
  });

  test("reprint of a legacy row is a single-line receipt keyed pay:<id>", async () => {
    const { course, student } = await setup();
    const row = await db.payment.create({
      data: { kind: "CLASS", studentId: student.id, courseId: course.id, billingYear: 2026, billingMonth: 9, amount: "2500.00", feeTierId: w.tiers.FULL.id, takenById: w.admin.id, transactionRef: null },
    });
    asAdmin();
    const tx = await rec.reprintTransaction(`pay:${row.id}`);
    assert.equal(tx?.key, `pay:${row.id}`);
    assert.equal(tx?.reference, `XN-${row.id}`);
    assert.deepEqual(tx?.paymentIds, [row.id]);
    assert.equal(tx?.total, "2500.00");
    assert.equal(tx?.transactionRef, null);
  });

  // ---- reprint -------------------------------------------------------------------------

  test("reprint returns the same reference, lines and total as the original receipt — for ADMIN and STAFF", async () => {
    const t = await makeTeacher(db);
    const a = await setup({ fee: "2500", teacherId: t.id });
    const b = await makeCourse(db, w, { teacherId: t.id, fee: "1800" });
    await enrol(db, { studentId: a.student.id, courseId: b.id, tierId: w.tiers.HALF.id, since: SINCE });
    const receipt = await charge(a.student.id, [{ courseId: a.course.id, ...OCT }, { courseId: b.id, ...OCT }], { smartCard: true });
    const key = await refOf(a.student.id);

    for (const as of [asAdmin, asStaff]) {
      as();
      const tx = await rec.reprintTransaction(key);
      assert.ok(tx);
      assert.equal(tx.reference, receipt.reference);
      assert.deepEqual(tx.lines, receipt.lines);
      assert.equal(tx.total, receipt.total);
      assert.equal(tx.date, receipt.date);
      assert.equal(tx.at, receipt.at);
      assert.deepEqual(tx.student, receipt.student);
      assert.equal(tx.cancelled, null);
    }
    assert.equal(receipt.total, "3900.00"); // 500 + 2500 + 900
  });

  test("a cancelled receipt reprints as CANCELLED, with who, when and why — amounts unchanged", async () => {
    const { course, student } = await setup();
    const receipt = await charge(student.id, [{ courseId: course.id, ...OCT }]);
    const key = await refOf(student.id);
    asAdmin();
    await cancel(key, "duplicate entry");
    const tx = await rec.reprintTransaction(key);
    assert.deepEqual(tx?.cancelled, { date: DAY, at: "11:30", by: w.admin.username, reason: "duplicate entry" });
    assert.equal(tx?.total, receipt.total);
  });

  test("reprint of a key that does not exist is null", async () => {
    asStaff();
    assert.equal(await rec.reprintTransaction("pay:2000000000"), null);
  });

  // ---- what a cancellation does to everything that reads payments ---------------------

  test("after a cancel the month is owed again — through the central SETTLED_PAYMENT_WHERE rule — and payable again", async () => {
    const { course, student } = await setup({ fee: "2500" });
    // Pay every month since enrolment (Apr..Oct) so the student is up to date.
    await charge(student.id, [4, 5, 6, 7, 8, 9, 10].map((month) => ({ courseId: course.id, year: 2026, month })));
    assert.equal((await arrears.studentArrears(student.id)).status, "green");

    // Void a separate October-only receipt to see ONE month flip.
    const s2 = await setup({ fee: "2500" });
    await charge(s2.student.id, [{ courseId: s2.course.id, year: 2026, month: 9 }, { courseId: s2.course.id, ...OCT }]);
    const before = await arrears.studentArrears(s2.student.id);
    assert.deepEqual(before.owedMonths.map((m) => m.label), ["Apr 2026", "May 2026", "Jun 2026", "Jul 2026", "Aug 2026"]);

    asAdmin();
    await cancel(await refOf(s2.student.id));
    const after = await arrears.studentArrears(s2.student.id);
    assert.equal(after.owedMonths.length, 7); // Apr..Oct all owed again
    assert.ok(after.owedMonths.some((m) => m.label === "Oct 2026"));

    // And the panel offers the month as unpaid, and it can be paid again.
    const panel = await pay.loadPanel({ studentId: s2.student.id });
    const months = (panel as Extract<typeof panel, { status: "ok" }>).panel.courses[0].months;
    assert.equal(months.find((m) => m.month === 10)?.paid, false);
    await charge(s2.student.id, [{ courseId: s2.course.id, ...OCT }]);
    assert.equal((await arrears.studentArrears(s2.student.id)).owedMonths.some((m) => m.label === "Oct 2026"), false);
  });

  test("Daily Summary and the payslip drop by exactly the cancelled amount", async () => {
    const t = await makeTeacher(db);
    const a = await setup({ fee: "2000", share: "20.00", teacherId: t.id });
    const b = await makeCourse(db, w, { teacherId: t.id, fee: "3000", share: "30.00" });
    await enrol(db, { studentId: a.student.id, courseId: b.id, tierId: w.tiers.FULL.id, since: SINCE });

    const summaryTotal = async () => Number((await reports.dailySummary(DAY, DAY)).totalCollected);
    const slip = async () => (await payslips.buildPayslips({ ...{ year: 2026, month: 10 }, teacherIds: [t.id], includeInstitute: false })).slips[0];
    const baseline = await summaryTotal();

    await charge(a.student.id, [{ courseId: a.course.id, ...OCT }, { courseId: b.id, ...OCT }]);
    assert.equal((await summaryTotal()) - baseline, 5000);
    assert.equal((await slip()).totalCollected, "5000.00");
    assert.equal((await slip()).totalInstituteShare, "1300.00"); // 20% of 2000 + 30% of 3000 = 400 + 900
    assert.equal((await slip()).totalTeacherShare, "3700.00"); // 1600 + 2100

    asAdmin();
    await cancel(await refOf(a.student.id));
    assert.equal((await summaryTotal()) - baseline, 0);
    const summary = await reports.dailySummary(DAY, DAY);
    for (const id of [a.course.id, b.id]) assert.equal(summary.courses.find((c) => c.courseId === id)?.amount, "0.00");
    assert.equal((await slip()).totalCollected, "0.00");
    assert.deepEqual((await slip()).courses, []);
  });
});
