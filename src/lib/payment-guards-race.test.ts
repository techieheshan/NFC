import { dbSkip, enrol, freezeClock, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * Job 3A: the guards that were gaps in the discovery report — a card charged twice, a month
 * or the admission taken by two overlapping requests, the same month listed twice in one
 * request — and the per-student lock that closes them. The clock is frozen at 10 Nov 2026.
 *
 * The race tests run each scenario 20 times with fresh students, and the whole file is run
 * 20 times on top of that. With the lock, "exactly one succeeds" is deterministic whatever
 * order the two requests interleave in; without it, both pass the check and both write.
 */

const NOW = "2026-11-10T06:00:00Z";
const SINCE = "2026-05-05T06:00:00Z";
const ROUNDS = 20;
const NOV = { year: 2026, month: 11 };
const CARD_MESSAGE = (date: string) =>
  `This card was already charged on ${date}. If it is a replacement card, change the card number and UID in Registration first.`;

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let pay: typeof import("@/app/(app)/payment/actions");
let rec: typeof import("@/app/(app)/receipts/actions");

describe("payment guards and races against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    pay = await import("@/app/(app)/payment/actions");
    rec = await import("@/app/(app)/receipts/actions");
    w = await seedWorld(db, { admissionFee: "1300", smartCardFee: "500" });
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------
  let n = 0;
  const uid = () => `UID${process.pid}${++n}${Math.random().toString(16).slice(2, 8)}`.toUpperCase();
  const rows = (studentId: number) => db.payment.findMany({ where: { studentId }, orderBy: { id: "asc" } });
  const cards = async (studentId: number) => (await rows(studentId)).filter((r) => r.kind === "SMART_CARD" && !r.cancelled);

  async function student(opts: { uid?: string | null; course?: { id: number } } = {}) {
    const s = await makeStudent(db, { cardUid: opts.uid === null ? undefined : (opts.uid ?? uid()) });
    if (opts.course) await enrol(db, { studentId: s.id, courseId: opts.course.id, tierId: w.tiers.FULL.id, since: SINCE });
    return s;
  }
  let sharedCourse: { id: number } | null = null;
  async function course() {
    if (!sharedCourse) sharedCourse = await makeCourse(db, w, { teacherId: (await makeTeacher(db)).id, fee: "2500", name: "RaceCourse" });
    return sharedCourse;
  }
  type Months = { year: number; month: number }[];
  type Opts = { admission?: boolean; smartCard?: boolean };
  async function charge(studentId: number, courseId: number | null, months: Months, o: Opts = {}) {
    setSession("ADMIN", w.admin.id);
    return pay.takePayment({
      studentId,
      admission: o.admission ?? false,
      smartCard: o.smartCard ?? false,
      classMonths: courseId === null ? [] : months.map((m) => ({ courseId, ...m })),
      comboDecisions: [],
    });
  }
  const oks = (rs: Awaited<ReturnType<typeof charge>>[]) => rs.filter((r) => r.ok).length;
  const errors = (rs: Awaited<ReturnType<typeof charge>>[]) => rs.flatMap((r) => (r.ok ? [] : [r.error]));

  // ---- smart card: charged once per card ---------------------------------------------------------

  test("the second charge for the same card is refused with the plain message, and writes nothing", async () => {
    const s = await student();
    assert.equal((await charge(s.id, null, [], { smartCard: true })).ok, true);
    assert.deepEqual(await charge(s.id, null, [], { smartCard: true }), { ok: false, error: CARD_MESSAGE("10 Nov 2026") });
    assert.equal((await cards(s.id)).length, 1);
  });

  test("the message names the day the card was charged, in Colombo time (00:30 on 1 Nov in Colombo is still 31 Oct in UTC)", async () => {
    const s = await student();
    try {
      freezeClock("2026-10-31T19:00:00Z"); // 00:30 on 1 Nov in Colombo
      assert.equal((await charge(s.id, null, [], { smartCard: true })).ok, true);
    } finally {
      freezeClock(NOW);
    }
    assert.deepEqual(await charge(s.id, null, [], { smartCard: true }), { ok: false, error: CARD_MESSAGE("1 Nov 2026") });
  });

  test("with repeat charges on record for one UID (old data), the message names the LATEST one", async () => {
    const s = await student();
    const u = (await db.student.findUniqueOrThrow({ where: { id: s.id } })).cardUid!;
    for (const paidAt of ["2026-08-02T06:00:00Z", "2026-09-20T06:00:00Z", "2026-07-01T06:00:00Z"]) {
      await db.payment.create({ data: { kind: "SMART_CARD", studentId: s.id, amount: "500.00", cardUidIssued: u, takenById: w.admin.id, paidAt: new Date(paidAt) } });
    }
    assert.deepEqual(await charge(s.id, null, [], { smartCard: true }), { ok: false, error: CARD_MESSAGE("20 Sep 2026") });
  });

  test("a REPLACEMENT card (a new UID, changed in Registration) is chargeable again", async () => {
    const s = await student();
    assert.equal((await charge(s.id, null, [], { smartCard: true })).ok, true);
    await db.student.update({ where: { id: s.id }, data: { cardUid: uid() } });
    assert.equal((await charge(s.id, null, [], { smartCard: true })).ok, true);
    const rs = await cards(s.id);
    assert.equal(rs.length, 2);
    assert.notEqual(rs[0].cardUidIssued, rs[1].cardUidIssued);
    // ...and the NEW card is now charged once too
    assert.deepEqual(await charge(s.id, null, [], { smartCard: true }), { ok: false, error: CARD_MESSAGE("10 Nov 2026") });
  });

  test("a CANCELLED card charge does not count: cancel it and the card can be charged again", async () => {
    const s = await student();
    assert.equal((await charge(s.id, null, [], { smartCard: true })).ok, true);
    setSession("ADMIN", w.admin.id);
    const f = new FormData();
    f.set("key", `ref:${(await rows(s.id))[0].transactionRef}`);
    f.set("reason", "charged by mistake");
    assert.deepEqual(await rec.cancelTransaction({ ok: false }, f), { ok: true });
    assert.equal((await charge(s.id, null, [], { smartCard: true })).ok, true);
    assert.equal((await cards(s.id)).length, 1);
  });

  test("old rows with NO card UID recorded never block: null and empty cardUidIssued are ignored", async () => {
    const s = await student();
    for (const cardUidIssued of [null, ""]) {
      await db.payment.create({ data: { kind: "SMART_CARD", studentId: s.id, amount: "500.00", cardUidIssued, takenById: w.admin.id, transactionRef: null } });
    }
    assert.equal((await charge(s.id, null, [], { smartCard: true })).ok, true);
  });

  test("a charge recorded against ANOTHER UID, or against another student, does not block this card", async () => {
    const s = await student();
    const other = await student();
    await db.payment.create({ data: { kind: "SMART_CARD", studentId: s.id, amount: "500.00", cardUidIssued: "SOMEOTHERCARD", takenById: w.admin.id } });
    const sameUidElsewhere = (await db.student.findUniqueOrThrow({ where: { id: s.id } })).cardUid!;
    await db.payment.create({ data: { kind: "SMART_CARD", studentId: other.id, amount: "500.00", cardUidIssued: sameUidElsewhere, takenById: w.admin.id } });
    assert.equal((await charge(s.id, null, [], { smartCard: true })).ok, true);
  });

  test("CURRENT BEHAVIOUR (not planned to change): a student with no card UID at all cannot be guarded, so repeat charges are allowed", async () => {
    // The guard keys on the UID; a student identified only by a printed card number has none.
    const s = await student({ uid: null });
    assert.equal((await charge(s.id, null, [], { smartCard: true })).ok, true);
    assert.equal((await charge(s.id, null, [], { smartCard: true })).ok, true);
    assert.equal((await cards(s.id)).length, 2);
  });

  test("a refused card charge refuses the WHOLE checkout: the admission and the class beside it are not written either", async () => {
    const c = await course();
    const s = await student({ course: c });
    assert.equal((await charge(s.id, null, [], { smartCard: true })).ok, true);
    const res = await charge(s.id, c.id, [NOV], { smartCard: true, admission: true });
    assert.deepEqual(res, { ok: false, error: CARD_MESSAGE("10 Nov 2026") });
    assert.equal((await rows(s.id)).length, 1);
    assert.equal((await db.student.findUniqueOrThrow({ where: { id: s.id } })).admissionPaid, false);
  });

  // ---- the same month twice in one request ----------------------------------------------------------

  test("one month listed twice — or three times — is refused whole, whatever each entry's mode", async () => {
    const c = await course();
    const s = await student({ course: c });
    setSession("ADMIN", w.admin.id);
    for (const modes of [["FULL", "FULL"], ["HALF", "FULL"], ["NO_CHARGE", "HALF", "FULL"]] as const) {
      const res = await pay.takePayment({
        studentId: s.id, admission: false, smartCard: false, comboDecisions: [],
        classMonths: modes.map((mode) => ({ courseId: c.id, ...NOV, mode })),
      });
      assert.equal(res.ok, false, modes.join("+"));
      assert.match((res as { error: string }).error, / — Nov 2026 is listed twice in this payment\.$/);
    }
    assert.equal((await rows(s.id)).length, 0);
  });

  // ---- races: exactly one request wins -----------------------------------------------------------------------

  test(`RACE ×${ROUNDS}: two identical requests for one month — exactly one succeeds, the other is told it is already paid`, async () => {
    const c = await course();
    for (let i = 0; i < ROUNDS; i++) {
      const s = await student({ course: c });
      const rs = await Promise.all([charge(s.id, c.id, [NOV]), charge(s.id, c.id, [NOV])]);
      assert.equal(oks(rs), 1, `round ${i}: ${JSON.stringify(rs)}`);
      assert.match(errors(rs)[0], / — Nov 2026 is already paid\.$/, `round ${i}`);
      assert.equal((await rows(s.id)).length, 1, `round ${i}: one row, not two`);
    }
  });

  test("RACE: five identical requests at once — exactly one succeeds", async () => {
    const c = await course();
    for (let i = 0; i < 5; i++) {
      const s = await student({ course: c });
      const rs = await Promise.all(Array.from({ length: 5 }, () => charge(s.id, c.id, [NOV])));
      assert.equal(oks(rs), 1, `round ${i}`);
      assert.equal(errors(rs).length, 4);
      assert.equal((await rows(s.id)).length, 1);
    }
  });

  test(`RACE ×${ROUNDS}: admission taken twice at once — exactly one succeeds, one ADMISSION row, the flag is set`, async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const s = await student();
      const rs = await Promise.all([charge(s.id, null, [], { admission: true }), charge(s.id, null, [], { admission: true })]);
      assert.equal(oks(rs), 1, `round ${i}: ${JSON.stringify(rs)}`);
      assert.deepEqual(errors(rs), ["Admission has already been paid."], `round ${i}`);
      assert.equal((await rows(s.id)).filter((r) => r.kind === "ADMISSION").length, 1, `round ${i}`);
      assert.equal((await db.student.findUniqueOrThrow({ where: { id: s.id } })).admissionPaid, true);
    }
  });

  test(`RACE ×${ROUNDS}: the same card charged twice at once — exactly one succeeds`, async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const s = await student();
      const rs = await Promise.all([charge(s.id, null, [], { smartCard: true }), charge(s.id, null, [], { smartCard: true })]);
      assert.equal(oks(rs), 1, `round ${i}: ${JSON.stringify(rs)}`);
      assert.deepEqual(errors(rs), [CARD_MESSAGE("10 Nov 2026")], `round ${i}`);
      assert.equal((await cards(s.id)).length, 1, `round ${i}`);
    }
  });

  test(`RACE ×${ROUNDS}: two checkouts that OVERLAP on one month — one wins whole, the other writes nothing`, async () => {
    const c = await course();
    for (let i = 0; i < ROUNDS; i++) {
      const s = await student({ course: c });
      const a = [{ year: 2026, month: 8 }, { year: 2026, month: 9 }];
      const b = [{ year: 2026, month: 9 }, { year: 2026, month: 10 }];
      const rs = await Promise.all([charge(s.id, c.id, a), charge(s.id, c.id, b)]);
      assert.equal(oks(rs), 1, `round ${i}: ${JSON.stringify(rs)}`);
      assert.equal((await rows(s.id)).length, 2, `round ${i}: the loser must leave nothing behind`);
      const months = (await rows(s.id)).map((r) => r.billingMonth);
      assert.ok(JSON.stringify(months) === "[8,9]" || JSON.stringify(months) === "[9,10]", `round ${i}: ${months}`);
    }
  });

  test(`RACE ×${ROUNDS}: two requests for DIFFERENT months of one student both succeed (the lock serialises, it does not refuse)`, async () => {
    const c = await course();
    for (let i = 0; i < ROUNDS; i++) {
      const s = await student({ course: c });
      const rs = await Promise.all([charge(s.id, c.id, [{ year: 2026, month: 9 }]), charge(s.id, c.id, [{ year: 2026, month: 10 }])]);
      assert.equal(oks(rs), 2, `round ${i}: ${JSON.stringify(rs)}`);
      assert.equal((await rows(s.id)).length, 2);
    }
  });

  test("two requests for DIFFERENT students at once both succeed", async () => {
    const c = await course();
    for (let i = 0; i < 5; i++) {
      const [a, b] = [await student({ course: c }), await student({ course: c })];
      const rs = await Promise.all([charge(a.id, c.id, [NOV], { smartCard: true }), charge(b.id, c.id, [NOV], { smartCard: true })]);
      assert.equal(oks(rs), 2, JSON.stringify(rs));
    }
  });

  test("POOL: 15 overlapping requests that each read a fee setting for ONE student — one wins, 14 are refused, none throws", async () => {
    // The pool holds 10 connections. The lock holder reads the fee setting while the other
    // requests sit blocked on its lock, each holding a connection; if that read took a SECOND
    // connection the holder would wait for one that the waiters never give back.
    const s = await student();
    const settled = await Promise.allSettled(Array.from({ length: 15 }, () => charge(s.id, null, [], { smartCard: true })));
    const rejected = settled.filter((r) => r.status === "rejected");
    assert.equal(rejected.length, 0, `requests threw: ${rejected.map((r) => String((r as PromiseRejectedResult).reason).slice(0, 120)).join(" | ")}`);
    const rs = settled.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof charge>>>).value);
    assert.equal(oks(rs), 1);
    assert.deepEqual(errors(rs), Array(14).fill(CARD_MESSAGE("10 Nov 2026")));
    assert.equal((await cards(s.id)).length, 1);
  });

  test("POOL: the same for the admission fee — 15 overlapping admission requests, one wins, 14 are refused, none throws", async () => {
    const s = await student();
    const settled = await Promise.allSettled(Array.from({ length: 15 }, () => charge(s.id, null, [], { admission: true })));
    assert.equal(settled.filter((r) => r.status === "rejected").length, 0);
    const rs = settled.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof charge>>>).value);
    assert.equal(oks(rs), 1);
    assert.deepEqual(errors(rs), Array(14).fill("Admission has already been paid."));
  });

  test("after a refusal the lock is gone: the very next request for the same student goes straight through", async () => {
    const c = await course();
    const s = await student({ course: c });
    assert.equal((await charge(s.id, c.id, [NOV])).ok, true);
    assert.equal((await charge(s.id, c.id, [NOV])).ok, false);
    assert.equal((await charge(s.id, c.id, [{ year: 2026, month: 10 }])).ok, true);
  });

  test("a request that FAILS part-way releases the lock too (the transaction rolls back, the next request works)", async () => {
    const double = await db.feeTier.create({ data: { code: "DOUBLE", label: "Double", multiplier: "2.000" } });
    const teacher = await makeTeacher(db);
    const huge = await makeCourse(db, w, { teacherId: teacher.id, fee: "99999999.00", name: "HugeFee" });
    const s = await student();
    await enrol(db, { studentId: s.id, courseId: huge.id, tierId: double.id, since: SINCE });
    await assert.rejects(() => charge(s.id, huge.id, [NOV])); // 2 × 99999999 overflows Decimal(10,2)
    assert.equal((await rows(s.id)).length, 0);
    assert.equal((await charge(s.id, null, [], { smartCard: true })).ok, true); // lock was released
  });
});
