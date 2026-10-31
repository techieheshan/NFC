import { dbSkip, enrol, freezeClock, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * Safety net for the Payment redesign (job 1): who owes what, locked against
 * real rows. The clock is frozen at 15 Oct 2026 (Colombo).
 *
 * "Owed" is BILLING-month based: it reads Payment.billingYear/billingMonth
 * through the one SETTLED_PAYMENT_WHERE rule, never the cash date (rule 23).
 */

const NOW = "2026-10-15T06:00:00Z";
const SINCE = "2026-04-01T06:00:00Z";

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let arrears: typeof import("@/lib/student-arrears");

describe("arrears and month states against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    arrears = await import("@/lib/student-arrears");
    w = await seedWorld(db);
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------
  async function course(fee = "2500") {
    const t = await makeTeacher(db);
    return makeCourse(db, w, { teacherId: t.id, fee });
  }
  async function student(enrolments: { courseId: number; tier?: "FULL" | "HALF" | "FREE"; since?: string; status?: "ACTIVE" | "DROPPED" }[]) {
    const s = await makeStudent(db);
    for (const e of enrolments) await enrol(db, { studentId: s.id, courseId: e.courseId, tierId: w.tiers[e.tier ?? "FULL"].id, since: e.since ?? SINCE, status: e.status });
    return s;
  }
  /** A stored payment for a billing month, with a cash date of the caller's choosing. */
  const settle = (studentId: number, courseId: number, year: number, month: number, o: { cancelled?: boolean; paidAt?: string; kind?: "CLASS" | "ADMISSION" | "SMART_CARD" } = {}) =>
    db.payment.create({
      data: {
        kind: o.kind ?? "CLASS",
        studentId,
        courseId: o.kind && o.kind !== "CLASS" ? null : courseId,
        billingYear: year,
        billingMonth: month,
        amount: "2500.00",
        feeTierId: w.tiers.FULL.id,
        takenById: w.admin.id,
        cancelled: o.cancelled ?? false,
        paidAt: new Date(o.paidAt ?? NOW),
        transactionRef: null,
      },
    });
  const settleAll = (studentId: number, courseId: number, months: number[], year = 2026) => Promise.all(months.map((m) => settle(studentId, courseId, year, m)));
  const owed = async (studentId: number) => (await arrears.studentArrears(studentId)).owedMonths.map((m) => m.label);

  // ---- the four colours -----------------------------------------------------------------

  test("green / 'Up to date': every month since enrolment is settled", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id }]);
    await settleAll(s.id, c.id, [4, 5, 6, 7, 8, 9, 10]);
    const a = await arrears.studentArrears(s.id);
    assert.equal(a.status, "green");
    assert.equal(a.label, "Up to date");
    assert.deepEqual(a.owedMonths, []);
  });

  test("red: only THIS month is unpaid", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id }]);
    await settleAll(s.id, c.id, [4, 5, 6, 7, 8, 9]);
    const a = await arrears.studentArrears(s.id);
    assert.equal(a.status, "red");
    assert.equal(a.label, "Oct");
  });

  test("darkred: a PAST month is unpaid, and it wins even when this month is unpaid too", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id }]);
    await settleAll(s.id, c.id, [4, 5, 6, 9]); // Jul, Aug, Oct owed
    const a = await arrears.studentArrears(s.id);
    assert.equal(a.status, "darkred");
    assert.equal(a.label, "Jul, Aug, Oct");
    assert.deepEqual(a.owedMonths.map((m) => m.label), ["Jul 2026", "Aug 2026", "Oct 2026"]);
  });

  test("grey / 'Free tier': a free enrolment owes nothing and is never 'paid up'", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id, tier: "FREE" }]);
    const a = await arrears.studentArrears(s.id);
    assert.equal(a.status, "grey");
    assert.equal(a.label, "Free tier");
    assert.deepEqual(a.owedMonths, []);
    assert.equal(a.courses[0].free, true);
  });

  test("a free course next to a paid one: only the chargeable course can owe", async () => {
    const [paid, free] = [await course(), await course()];
    const s = await student([{ courseId: paid.id }, { courseId: free.id, tier: "FREE" }]);
    await settleAll(s.id, paid.id, [4, 5, 6, 7, 8, 9, 10]);
    assert.equal((await arrears.studentArrears(s.id)).status, "green");
  });

  test("CURRENT BEHAVIOUR (quirk, not planned to change): a student with no active enrolment reads as grey 'Free tier'", async () => {
    const a = await arrears.studentArrears((await makeStudent(db)).id);
    assert.equal(a.status, "grey");
    assert.equal(a.label, "Free tier");
  });

  // ---- which months count ---------------------------------------------------------------

  test("months before the enrolment started are never owed; the enrolment month is", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id, since: "2026-08-10T06:00:00Z" }]);
    assert.deepEqual(await owed(s.id), ["Aug 2026", "Sep 2026", "Oct 2026"]);
  });

  test("an enrolment that began this month owes only this month — red, not darkred", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id, since: "2026-10-05T06:00:00Z" }]);
    const a = await arrears.studentArrears(s.id);
    assert.equal(a.status, "red");
    assert.deepEqual(a.owedMonths.map((m) => m.label), ["Oct 2026"]);
  });

  test("paying AHEAD neither clears this month nor creates a debt", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id }]);
    await settleAll(s.id, c.id, [4, 5, 6, 7, 8, 9]);
    await settle(s.id, c.id, 2026, 11); // November, paid in October
    await settle(s.id, c.id, 2026, 12);
    const a = await arrears.studentArrears(s.id);
    assert.equal(a.status, "red"); // October is still owed
    assert.deepEqual(a.owedMonths.map((m) => m.label), ["Oct 2026"]);
  });

  test("CURRENT BEHAVIOUR (will change in job 3: any past month will be payable): arrears are UNLIMITED, unlike the 5-month payment window", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id, since: "2026-01-02T06:00:00Z" }]);
    assert.equal((await owed(s.id)).length, 10); // Jan..Oct — the panel would only offer May..Oct
    assert.equal((await owed(s.id))[0], "Jan 2026");
  });

  test("enrolment years are respected across the year end", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id, since: "2025-11-05T06:00:00Z" }]);
    const labels = await owed(s.id);
    assert.deepEqual(labels.slice(0, 3), ["Nov 2025", "Dec 2025", "Jan 2026"]);
    assert.equal(labels.length, 12); // Nov 2025 .. Oct 2026
  });

  test("a DROPPED enrolment owes nothing", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id, status: "DROPPED" }]);
    assert.deepEqual(await owed(s.id), []);
  });

  // ---- what settles a month ---------------------------------------------------------------

  test("a month is settled by the BILLING month, not the cash date: a September fee paid in October clears September", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id, since: "2026-09-01T06:00:00Z" }]);
    await settle(s.id, c.id, 2026, 9, { paidAt: "2026-10-14T06:00:00Z" });
    assert.deepEqual(await owed(s.id), ["Oct 2026"]);
  });

  test("a cancelled payment, an admission row and a smart-card row do NOT settle a month", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id, since: "2026-09-01T06:00:00Z" }]);
    await settle(s.id, c.id, 2026, 9, { cancelled: true });
    await settle(s.id, c.id, 2026, 10, { kind: "ADMISSION" });
    await settle(s.id, c.id, 2026, 10, { kind: "SMART_CARD" });
    assert.deepEqual(await owed(s.id), ["Sep 2026", "Oct 2026"]);
  });

  test("a payment for ANOTHER course does not settle this one; two courses owe separately", async () => {
    const [a, b] = [await course(), await course()];
    const s = await student([{ courseId: a.id, since: "2026-09-01T06:00:00Z" }, { courseId: b.id, since: "2026-10-01T06:00:00Z" }]);
    await settle(s.id, a.id, 2026, 9);
    await settle(s.id, a.id, 2026, 10);
    const r = await arrears.studentArrears(s.id);
    assert.deepEqual(r.courses.map((c) => [c.courseId, c.owed.map((m) => m.label)]), [[a.id, []], [b.id, ["Oct 2026"]]]);
    assert.deepEqual(r.owedMonths.map((m) => m.label), ["Oct 2026"]); // distinct months across courses
  });

  test("the batch read agrees with the single-student read", async () => {
    const c = await course();
    const ss = [await student([{ courseId: c.id }]), await student([{ courseId: c.id, tier: "FREE" }])];
    await settleAll(ss[0].id, c.id, [4, 5, 6]);
    const many = await arrears.studentArrearsMany(ss.map((s) => s.id));
    for (const s of ss) assert.deepEqual(many.get(s.id), await arrears.studentArrears(s.id));
  });

  // ---- courseMonthStates (the class-list chips) ------------------------------------------------

  test("courseMonthStates: paid / not paid / overdue / free, on the billing month", async () => {
    const c = await course();
    const [paid, notPaid, overdue, free, joinedNow] = await Promise.all([
      student([{ courseId: c.id }]),
      student([{ courseId: c.id }]),
      student([{ courseId: c.id }]),
      student([{ courseId: c.id, tier: "FREE" }]),
      student([{ courseId: c.id, since: "2026-10-05T06:00:00Z" }]),
    ]);
    await settle(paid.id, c.id, 2026, 10);
    await settle(notPaid.id, c.id, 2026, 9); // paid last month, not this
    // overdue: nothing for Sep or Oct
    const states = (await arrears.courseMonthStates([c.id], 2026, 10)).get(c.id)!;
    assert.equal(states.get(paid.id), "paid");
    assert.equal(states.get(notPaid.id), "notPaid");
    assert.equal(states.get(overdue.id), "overdue");
    assert.equal(states.get(free.id), "free");
    assert.equal(states.get(joinedNow.id), "notPaid"); // joined this month: cannot be overdue for last month
  });

  test("courseMonthStates uses the billing month: an October fee paid in September's cash still reads paid for October", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id }]);
    await settle(s.id, c.id, 2026, 10, { paidAt: "2026-09-28T06:00:00Z" });
    assert.equal((await arrears.courseMonthStates([c.id], 2026, 10)).get(c.id)!.get(s.id), "paid");
  });

  test("courseMonthStates ignores cancelled payments", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id }]);
    await settle(s.id, c.id, 2026, 10, { cancelled: true });
    await settle(s.id, c.id, 2026, 9, { cancelled: true });
    assert.equal((await arrears.courseMonthStates([c.id], 2026, 10)).get(c.id)!.get(s.id), "overdue");
  });

  // ---- one more look at the Colombo boundary ------------------------------------------------------

  test("the current month rolls at Colombo midnight: the same student turns red→darkred when 1 Nov begins", async () => {
    const c = await course();
    const s = await student([{ courseId: c.id }]);
    await settleAll(s.id, c.id, [4, 5, 6, 7, 8, 9, 10]); // paid through October
    try {
      freezeClock("2026-10-31T18:29:59Z"); // still 31 Oct in Colombo
      assert.equal((await arrears.studentArrears(s.id)).status, "green");
      freezeClock("2026-10-31T18:30:00Z"); // 1 Nov in Colombo: November is now owed
      const a = await arrears.studentArrears(s.id);
      assert.equal(a.status, "red");
      assert.deepEqual(a.owedMonths.map((m) => m.label), ["Nov 2026"]);
    } finally {
      freezeClock(NOW);
    }
  });
});
