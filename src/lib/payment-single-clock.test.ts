import { attend, dbSkip, enrol, freezeClock, makeCombo, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * Job 3A review fix: takePayment judges the month limits, "before enrolment" and the combo
 * state at ONE instant (`paidAt`). Before, `comboStates` made its own `new Date()` several
 * database round trips later, so a request that started in the last second of the month could
 * be checked as October by the limits and as November by the combo rule.
 *
 * The clock is frozen at 23:59:59.9 on 31 Oct (Colombo) and moved on by 200 ms right after the
 * request's first enrolment read — i.e. across midnight, between taking `paidAt` and judging
 * the combo.
 */

const JUST_BEFORE_MIDNIGHT = "2026-10-31T18:29:59.900Z"; // 23:59:59.9 on 31 Oct in Colombo
const AFTER_MIDNIGHT = "2026-10-31T18:31:00.000Z"; // 00:01 on 1 Nov in Colombo
const SINCE_OLD = "2026-05-05T06:00:00Z";
const SINCE_OCT_15 = "2026-10-15T06:00:00Z";
const OCT = { year: 2026, month: 10 };

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let pay: typeof import("@/app/(app)/payment/actions");

describe("one clock per takePayment request, against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(JUST_BEFORE_MIDNIGHT);
    ({ db } = await import("@/lib/db"));
    pay = await import("@/app/(app)/payment/actions");
    w = await seedWorld(db);
  });
  after(async () => {
    mock.restoreAll();
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  /**
   * A two-class combo; A has been attended in September, B was enrolled on 15 Oct (so B is
   * NEW on 31 Oct — enrolled after the last completed month, September — and has no
   * attendance to ask about). On 1 Nov the last completed month is October: B is no longer
   * new and has 0 days in October, so the very same facts need a person's answer.
   */
  async function setup() {
    const teacher = await makeTeacher(db);
    const ca = await makeCourse(db, w, { teacherId: teacher.id, fee: "2500" });
    const cb = await makeCourse(db, w, { teacherId: teacher.id, fee: "1700" });
    const combo = await makeCombo(db, { teacherId: teacher.id, items: [{ courseId: ca.id, fee: "2000" }, { courseId: cb.id, fee: "1300" }] });
    const student = await makeStudent(db);
    await enrol(db, { studentId: student.id, courseId: ca.id, tierId: w.tiers.FULL.id, since: SINCE_OLD });
    await enrol(db, { studentId: student.id, courseId: cb.id, tierId: w.tiers.FULL.id, since: SINCE_OCT_15 });
    await attend(db, { studentId: student.id, courseId: ca.id, date: "2026-09-08", markedById: w.admin.id });
    return { ca, cb, combo, student };
  }
  const charge = (studentId: number, courses: { id: number }[]) => {
    setSession("ADMIN", w.admin.id);
    return pay.takePayment({ studentId, admission: false, smartCard: false, classMonths: courses.map((c) => ({ courseId: c.id, ...OCT })), comboDecisions: [] });
  };

  test("control: just AFTER midnight the same facts need an answer (so the scenario below really discriminates)", async () => {
    const { ca, cb, student } = await setup();
    freezeClock(AFTER_MIDNIGHT);
    try {
      assert.deepEqual(await charge(student.id, [ca, cb]), { ok: false, error: "A combined-rate decision is missing." });
    } finally {
      freezeClock(JUST_BEFORE_MIDNIGHT);
    }
  });

  test("a request that crosses midnight between taking paidAt and judging the combo is judged entirely as 31 Oct", async () => {
    const { ca, cb, combo, student } = await setup();

    // Move the clock across midnight right after the request's first enrolment read. (A Prisma
    // delegate has no own methods to mock, so the model is wrapped in a proxy for this request.)
    const delegate = db.enrollment;
    let ticked = false;
    Object.defineProperty(db, "enrollment", {
      configurable: true,
      value: new Proxy(delegate, {
        get(target, prop, receiver) {
          if (prop !== "findMany") return Reflect.get(target, prop, receiver);
          return async (...args: Parameters<typeof delegate.findMany>) => {
            const result = await delegate.findMany(...args);
            if (!ticked) {
              ticked = true;
              mock.timers.tick(200);
            }
            return result;
          };
        },
      }),
    });
    let res: Awaited<ReturnType<typeof charge>>;
    try {
      res = await charge(student.id, [ca, cb]);
    } finally {
      delete (db as unknown as Record<string, unknown>).enrollment;
    }
    assert.equal(ticked, true, "the clock really did cross midnight during the request");
    assert.equal(res.ok, true, JSON.stringify(res));

    // B is "new" as of 31 Oct → exempt-new → the combo applies with no question.
    const rows = await db.payment.findMany({ where: { studentId: student.id }, orderBy: { id: "asc" } });
    assert.deepEqual(rows.map((r) => r.amount.toFixed(2)), ["2000.00", "1300.00"]);
    for (const r of rows) assert.deepEqual([r.comboId, r.comboApplied], [combo.id, true]);
    // ...and the row is stamped with the instant the request started.
    for (const r of rows) assert.equal(r.paidAt.toISOString(), JUST_BEFORE_MIDNIGHT);
  });
});
