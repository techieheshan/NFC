import { dbSkip, enrol, freezeClock, makeCombo, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { PrismaClient } from "@prisma/client";

/*
 * Changing a course's fee tier after registration (ADMIN only). The REAL changeFeeTier and
 * takePayment against a throw-away Postgres; clock frozen at 15 Oct 2026 (Colombo).
 *
 * What must hold: only an ADMIN may do it (replayed with a STAFF session next to an ADMIN control,
 * AGENTS rule 29); only Full / Half / 25% (never to or from Free); no payment is written or touched;
 * the next payment, earlier owed months and the combo follow the new tier; the lock is the payment's.
 */

const NOW = "2026-10-15T06:00:00Z";
const SINCE = "2026-04-01T06:00:00Z";
const OCT = { year: 2026, month: 10 };

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let quarterId: number;
let inactiveId: number;
let pay: typeof import("@/app/(app)/payment/actions");
let reg: typeof import("@/app/(app)/registration/actions");

describe("changeFeeTier against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    pay = await import("@/app/(app)/payment/actions");
    reg = await import("@/app/(app)/registration/actions");
    w = await seedWorld(db);
    quarterId = (await db.feeTier.create({ data: { code: "QUARTER", label: "25%", multiplier: "0.250" } })).id;
    inactiveId = (await db.feeTier.create({ data: { code: "OLDTIER", label: "Old tier", multiplier: "0.750", active: false } })).id;
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------
  const asAdmin = () => setSession("ADMIN", w.admin.id);
  const asStaff = () => setSession("STAFF", w.staff.id);
  const dec = (d: { toFixed: (n: number) => string } | null) => d?.toFixed(2);

  async function setup(o: { fee?: string; tier?: "FULL" | "HALF" | "FREE"; since?: string } = {}) {
    const teacher = await makeTeacher(db);
    const course = await makeCourse(db, w, { teacherId: teacher.id, fee: o.fee ?? "2500", share: "20.00" });
    const student = await makeStudent(db, { cardUid: `UID${Math.random().toString(16).slice(2, 10)}` });
    const enrolment = await enrol(db, { studentId: student.id, courseId: course.id, tierId: w.tiers[o.tier ?? "FULL"].id, since: o.since ?? SINCE });
    return { course, student, enrolment };
  }
  const tierOf = async (enrolmentId: number) => (await db.enrollment.findUniqueOrThrow({ where: { id: enrolmentId } })).feeTierId;
  const payments = (studentId: number) => db.payment.findMany({ where: { studentId }, orderBy: { id: "asc" } });
  const takeMonths = (studentId: number, classMonths: { courseId: number; year: number; month: number }[], comboDecisions: { comboId: number; apply: boolean }[] = []) => {
    asAdmin();
    return pay.takePayment({ studentId, admission: false, smartCard: false, classMonths, comboDecisions });
  };

  // ---- who may ----------------------------------------------------------------

  test("STAFF is refused inside the action, next to an ADMIN control that succeeds (rule 29)", async () => {
    const control = await setup();
    const target = await setup();
    asStaff();
    await assert.rejects(reg.changeFeeTier(target.enrolment.id, w.tiers.HALF.id), /Not authorised/);
    assert.equal(await tierOf(target.enrolment.id), w.tiers.FULL.id, "a refused STAFF call changes nothing");
    setSession(null);
    await assert.rejects(reg.changeFeeTier(target.enrolment.id, w.tiers.HALF.id), /Not authorised/);
    setSession("TEACHER", "t1");
    await assert.rejects(reg.changeFeeTier(target.enrolment.id, w.tiers.HALF.id), /Not authorised/);

    asAdmin();
    const res = await reg.changeFeeTier(control.enrolment.id, w.tiers.HALF.id);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(await tierOf(control.enrolment.id), w.tiers.HALF.id);
  });

  // ---- what may change -----------------------------------------------------------

  test("Full, Half and 25% change among themselves, in any direction", async () => {
    const { enrolment } = await setup();
    asAdmin();
    for (const [to, label] of [[w.tiers.HALF.id, "Half"], [quarterId, "25%"], [w.tiers.FULL.id, "Full"]] as const) {
      const res = await reg.changeFeeTier(enrolment.id, to);
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(await tierOf(enrolment.id), to, label);
    }
  });

  test("any change to or from a Free tier is refused, and nothing changes", async () => {
    const paying = await setup({ tier: "FULL" });
    const free = await setup({ tier: "FREE" });
    asAdmin();
    const msg = "The fee can only be changed between Full, Half and 25%. A Free course cannot be changed here.";
    assert.deepEqual(await reg.changeFeeTier(paying.enrolment.id, w.tiers.FREE.id), { ok: false, error: msg });
    assert.deepEqual(await reg.changeFeeTier(free.enrolment.id, w.tiers.FULL.id), { ok: false, error: msg });
    assert.deepEqual(await reg.changeFeeTier(free.enrolment.id, w.tiers.HALF.id), { ok: false, error: msg });
    assert.equal(await tierOf(paying.enrolment.id), w.tiers.FULL.id);
    assert.equal(await tierOf(free.enrolment.id), w.tiers.FREE.id);
  });

  test("refused: the same tier, an inactive tier, an unknown tier or enrolment, junk ids, a dropped course", async () => {
    const { enrolment } = await setup();
    asAdmin();
    assert.deepEqual(await reg.changeFeeTier(enrolment.id, w.tiers.FULL.id), { ok: false, error: "This course is already on Full." });
    assert.deepEqual(await reg.changeFeeTier(enrolment.id, inactiveId), { ok: false, error: "Select an active fee tier." });
    assert.deepEqual(await reg.changeFeeTier(enrolment.id, 999999), { ok: false, error: "Select an active fee tier." });
    assert.deepEqual(await reg.changeFeeTier(999999, w.tiers.HALF.id), { ok: false, error: "That enrolment no longer exists." });
    assert.deepEqual(await reg.changeFeeTier(0, w.tiers.HALF.id), { ok: false, error: "Invalid enrolment or fee." });
    assert.deepEqual(await reg.changeFeeTier(enrolment.id, -1), { ok: false, error: "Invalid enrolment or fee." });
    await db.enrollment.update({ where: { id: enrolment.id }, data: { status: "DROPPED" } });
    assert.deepEqual(await reg.changeFeeTier(enrolment.id, w.tiers.HALF.id), { ok: false, error: "Only a course the student is attending can change its fee." });
    assert.equal(await tierOf(enrolment.id), w.tiers.FULL.id);
  });

  // ---- money -----------------------------------------------------------------------

  test("no Payment row is created or touched: past payments are byte-identical after the change (rule 13)", async () => {
    const { course, student, enrolment } = await setup();
    const res = await takeMonths(student.id, [{ courseId: course.id, year: 2026, month: 9 }]);
    assert.equal(res.ok, true, JSON.stringify(res));
    const before = JSON.stringify(await payments(student.id));
    const countBefore = await db.payment.count();

    asAdmin();
    assert.equal((await reg.changeFeeTier(enrolment.id, w.tiers.HALF.id)).ok, true);

    assert.equal(JSON.stringify(await payments(student.id)), before, "past payments never change");
    assert.equal(await db.payment.count(), countBefore, "changing a fee writes no payment");
  });

  test("the next payment uses the NEW tier — including an earlier owed month — and the old one keeps its amount", async () => {
    const { course, student, enrolment } = await setup({ fee: "2500" });
    assert.equal((await takeMonths(student.id, [{ courseId: course.id, year: 2026, month: 8 }])).ok, true); // paid at Full
    asAdmin();
    assert.equal((await reg.changeFeeTier(enrolment.id, w.tiers.HALF.id)).ok, true);

    // Sep is an OLDER unpaid month; Oct is the current one. Both are now Half.
    const res = await takeMonths(student.id, [{ courseId: course.id, year: 2026, month: 9 }, { courseId: course.id, ...OCT }]);
    assert.equal(res.ok, true, JSON.stringify(res));
    const rows = await payments(student.id);
    assert.deepEqual(rows.map((p) => [p.billingMonth, dec(p.amount), p.feeTierId]), [
      [8, "2500.00", w.tiers.FULL.id],
      [9, "1250.00", w.tiers.HALF.id],
      [10, "1250.00", w.tiers.HALF.id],
    ]);
  });

  test("the combo rate follows the new tier (Half of the combo fee for the changed course only)", async () => {
    const teacher = await makeTeacher(db);
    const a = await makeCourse(db, w, { teacherId: teacher.id, fee: "2500", share: "20.00" });
    const b = await makeCourse(db, w, { teacherId: teacher.id, fee: "1800", share: "30.00" });
    const combo = await makeCombo(db, { teacherId: teacher.id, items: [{ courseId: a.id, fee: "2000" }, { courseId: b.id, fee: "1500" }] });
    const student = await makeStudent(db);
    const enrolA = await enrol(db, { studentId: student.id, courseId: a.id, tierId: w.tiers.FULL.id, since: SINCE });
    await enrol(db, { studentId: student.id, courseId: b.id, tierId: w.tiers.FULL.id, since: SINCE });

    asAdmin();
    assert.equal((await reg.changeFeeTier(enrolA.id, w.tiers.HALF.id)).ok, true);
    const res = await takeMonths(student.id, [{ courseId: a.id, ...OCT }, { courseId: b.id, ...OCT }], [{ comboId: combo.id, apply: true }]);
    assert.equal(res.ok, true, JSON.stringify(res));
    const byCourse = new Map((await payments(student.id)).map((p) => [p.courseId, p]));
    assert.equal(dec(byCourse.get(a.id)!.amount), "1000.00"); // combo 2000 x 0.5
    assert.equal(dec(byCourse.get(b.id)!.amount), "1500.00"); // combo 1500 x 1
    assert.notEqual(byCourse.get(a.id)!.comboId, null);
  });

  // ---- the trail ---------------------------------------------------------------------

  test("audit: one structured log line (who, student, course, old tier, new tier) and Enrollment.updatedAt moves", async () => {
    const { course, student, enrolment } = await setup();
    const before = (await db.enrollment.findUniqueOrThrow({ where: { id: enrolment.id } })).updatedAt;
    const log = mock.method(console, "info", () => {});
    try {
      mock.timers.reset();
      asAdmin();
      assert.equal((await reg.changeFeeTier(enrolment.id, quarterId)).ok, true);
      const lines = log.mock.calls.map((c) => String(c.arguments[0])).filter((l) => l.includes("fee-tier-changed"));
      assert.equal(lines.length, 1);
      const entry = JSON.parse(lines[0]);
      assert.equal(entry.byUserId, w.admin.id);
      assert.equal(entry.studentId, student.id);
      assert.equal(entry.enrolmentId, enrolment.id);
      assert.equal(entry.courseId, course.id);
      assert.deepEqual([entry.fromTier.code, entry.toTier.code], ["FULL", "QUARTER"]);
    } finally {
      log.mock.restore();
      freezeClock(NOW);
    }
    const after = (await db.enrollment.findUniqueOrThrow({ where: { id: enrolment.id } })).updatedAt;
    assert.ok(after.getTime() >= before.getTime());
    assert.equal(await tierOf(enrolment.id), quarterId);
  });

  test("a refused change logs nothing", async () => {
    const { enrolment } = await setup({ tier: "FREE" });
    const log = mock.method(console, "info", () => {});
    try {
      asAdmin();
      assert.equal((await reg.changeFeeTier(enrolment.id, w.tiers.FULL.id)).ok, false);
      assert.equal(log.mock.calls.filter((c) => String(c.arguments[0]).includes("fee-tier-changed")).length, 0);
    } finally {
      log.mock.restore();
    }
  });

  // ---- the lock ----------------------------------------------------------------------

  test("it waits for a checkout of the same student (the payment's advisory lock), then goes through", async () => {
    const { student, enrolment } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockedP = new Promise<void>((r) => (locked = r));
    const holder = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(7301::int, ${student.id}::int)`;
        locked();
        await gate;
      },
      { timeout: 20000 },
    );
    await lockedP;
    asAdmin();
    let finished = false;
    const change = reg.changeFeeTier(enrolment.id, w.tiers.HALF.id).then((r) => {
      finished = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(finished, false, "must wait while a checkout holds the student's lock");
    assert.equal(await tierOf(enrolment.id), w.tiers.FULL.id);
    release();
    await holder;
    assert.equal((await change).ok, true);
    assert.equal(await tierOf(enrolment.id), w.tiers.HALF.id);
  });
});

describe("fee tier change: static rules (no database)", () => {
  test("the lock namespace here is the payment's — if one changes, this fails", () => {
    const paymentSrc = readFileSync("src/app/(app)/payment/actions.ts", "utf8");
    const regSrc = readFileSync("src/app/(app)/registration/actions.ts", "utf8");
    const p = /const PAYMENT_LOCK_NAMESPACE = (\d+);/.exec(paymentSrc);
    const r = /const STUDENT_LOCK_NAMESPACE = (\d+);/.exec(regSrc);
    assert.ok(p && r, "both constants must exist");
    assert.equal(r![1], p![1]);
    assert.equal(r![1], "7301");
  });

  test("changeFeeTier guards itself with requireRole(ADMIN) before anything else, and uses tx inside the transaction", () => {
    const src = readFileSync("src/app/(app)/registration/actions.ts", "utf8");
    const body = src.slice(src.indexOf("export async function changeFeeTier"));
    assert.match(body, /await requireRole\(\["ADMIN"\]\);/);
    assert.ok(body.indexOf("requireRole") < body.indexOf("db.enrollment.findUnique"));
    const tx = body.slice(body.indexOf("db.$transaction"));
    assert.equal(/\bdb\.(?!\$transaction)/.test(tx), false, "inside the transaction use tx, never db");
  });

  test("the Change fee button is drawn only when the page says ADMIN, and the dialog buttons are 48 px", () => {
    const page = readFileSync("src/app/(app)/registration/page.tsx", "utf8");
    assert.match(page, /canChangeFee=\{user\.role === "ADMIN"\}/);
    const dialog = readFileSync("src/app/(app)/registration/change-fee-dialog.tsx", "utf8");
    assert.equal((dialog.match(/h-12 w-full/g) ?? []).length, 2);
    assert.match(dialog, /New months will be charged at \{chosen\.label\}\. Months already paid keep their amount\./);
  });
});
