import { dbSkip, enrol, freezeClock, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { Client } from "pg";
import type { PrismaClient } from "@prisma/client";

/*
 * Job 3A review fix: a request that waits on the per-student lock longer than its transaction
 * may run is answered with a plain message, not thrown (the old screen has no try/catch and
 * would show the browser's crash page), and it writes nothing.
 *
 * The lock is held from a separate connection, exactly as another terminal's open checkout
 * would hold it. The real timeout is used, so this file takes a few seconds on purpose — the
 * production code is not parameterised for the test.
 */

const NOW = "2026-11-10T06:00:00Z";
const SINCE = "2026-05-05T06:00:00Z";
const NOV = { year: 2026, month: 11 };
const LOCK_NAMESPACE = 7301; // PAYMENT_LOCK_NAMESPACE in payment/actions.ts
const BUSY = "Another payment for this student is in progress — check Receipts, then try again.";

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let pay: typeof import("@/app/(app)/payment/actions");

describe("a payment that cannot get the student's lock in time, against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    pay = await import("@/app/(app)/payment/actions");
    w = await seedWorld(db, { admissionFee: "1300", smartCardFee: "500" });
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  const rows = (studentId: number) => db.payment.findMany({ where: { studentId } });

  type Tx = (fn: (tx: PrismaClient) => Promise<unknown>, opts?: unknown) => Promise<unknown>;
  /**
   * Wraps `db.$transaction` for one test and returns how to put it back. It is restored by
   * REDEFINING the saved function: Prisma's client proxy has no delete trap, so a `delete` only
   * happens to work for `$transaction` (it lives on the prototype) and would break a model.
   */
  function stubTransaction(wrap: (original: Tx) => Tx) {
    const saved = db.$transaction;
    const original = saved.bind(db) as unknown as Tx;
    Object.defineProperty(db, "$transaction", { configurable: true, writable: true, value: wrap(original) });
    return () => Object.defineProperty(db, "$transaction", { configurable: true, writable: true, value: saved });
  }

  /**
   * Holds student `id`'s payment lock — a checkout open on another terminal — and lets go by
   * itself after `ms`, so a request that is wrongly left waiting fails the test instead of
   * hanging it. `released` resolves once the lock is really gone.
   */
  async function holdLock(id: number, ms: number) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::int, $2::int)", [LOCK_NAMESPACE, id]);
    const released = new Promise<void>((resolve) => {
      setTimeout(() => {
        client.query("COMMIT").then(() => client.end()).then(() => resolve());
      }, ms);
    });
    return { released };
  }

  async function setup() {
    const teacher = await makeTeacher(db);
    const course = await makeCourse(db, w, { teacherId: teacher.id, fee: "2500" });
    const student = await makeStudent(db, { cardUid: `UID${Math.random().toString(16).slice(2, 10)}`.toUpperCase() });
    await enrol(db, { studentId: student.id, courseId: course.id, tierId: w.tiers.FULL.id, since: SINCE });
    return { course, student };
  }
  const charge = (studentId: number, courseId: number) => {
    setSession("ADMIN", w.admin.id);
    return pay.takePayment({
      studentId, admission: true, smartCard: true,
      classMonths: [{ courseId, ...NOV }], comboDecisions: [],
    });
  };

  test("the lock is not free in time: ANSWERED with the plain message after about 4 s — not thrown, not left waiting — and writes nothing", async () => {
    const { course, student } = await setup();
    const held = await holdLock(student.id, 8000);
    const started = performance.now();
    const res = await charge(student.id, course.id);
    const waited = Math.round(performance.now() - started);

    assert.deepEqual(res, { ok: false, error: BUSY });
    assert.ok(waited >= 3500 && waited < 6500, `it waited ${waited} ms (the lock wait is 4 s; the transaction limit is 6 s)`);
    assert.equal((await rows(student.id)).length, 0, "no payment rows");
    assert.equal((await db.student.findUniqueOrThrow({ where: { id: student.id } })).admissionPaid, false, "admission flag untouched");
    await held.released;
  });

  test("afterwards the student is not stuck: the next request goes straight through and is a normal receipt", async () => {
    const { course, student } = await setup();
    const held = await holdLock(student.id, 5000);
    assert.deepEqual(await charge(student.id, course.id), { ok: false, error: BUSY });
    await held.released;
    const res = await charge(student.id, course.id);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal((await rows(student.id)).length, 3); // admission + smart card + the month
  });

  test("two DIFFERENT students never wait for each other: while A's real payment holds A's lock, B's finishes promptly", async () => {
    const a = await setup();
    const b = await setup();

    // Make the FIRST transaction (student A's) slow once it is holding its own lock: its first
    // payment insert sleeps 3 s. That is a real checkout in progress, using the real lock key —
    // so a lock shared by every student would make B wait for it.
    let calls = 0;
    let slowOnce = true;
    let aIsInside!: () => void;
    const inside = new Promise<void>((resolve) => (aIsInside = resolve));
    const restore = stubTransaction((original) => (fn, opts) =>
        original(async (tx) => {
          if (++calls > 1) return fn(tx);
          const bind = (target: object) =>
            new Proxy(target, {
              get(t, prop) {
                const v = Reflect.get(t, prop);
                return typeof v === "function" ? v.bind(t) : v;
              },
            });
          const payment = bind(tx.payment) as typeof tx.payment;
          const slow = new Proxy(tx, {
            get(t, prop) {
              if (prop === "payment") {
                return new Proxy(payment, {
                  get(pt, pprop) {
                    if (pprop !== "create") return Reflect.get(pt, pprop);
                    return async (...args: Parameters<typeof pt.create>) => {
                      if (slowOnce) {
                        slowOnce = false;
                        aIsInside(); // A holds its lock now
                        await tx.$executeRaw`SELECT pg_sleep(3)`;
                      }
                      return pt.create(...args);
                    };
                  },
                });
              }
              const v = Reflect.get(t, prop);
              return typeof v === "function" ? v.bind(t) : v;
            },
          });
          return fn(slow as PrismaClient);
        }, opts),
    );

    try {
      const aDone = charge(a.student.id, a.course.id);
      await inside; // A is inside its transaction, holding its lock
      const started = performance.now();
      const res = await charge(b.student.id, b.course.id);
      const took = Math.round(performance.now() - started);
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.ok(took < 2000, `student B's payment took ${took} ms while student A's payment was holding A's lock`);
      assert.equal((await rows(a.student.id)).length, 0, "A has not committed yet — it really was still holding its lock");
      assert.equal((await aDone).ok, true);
    } finally {
      restore();
    }
  });

  test("the transaction itself runs past its limit (P2028): the same plain answer, and nothing is written", async () => {
    const { course, student } = await setup();

    // Make the transaction slow for this request only: it sleeps longer than the 6 s limit before
    // doing any work, so Prisma expires it (no lock involved).
    const restore = stubTransaction((original) => (fn, opts) =>
      original(async (tx) => {
        await tx.$executeRaw`SELECT pg_sleep(7)`;
        return fn(tx);
      }, opts),
    );
    let res: Awaited<ReturnType<typeof charge>>;
    const started = performance.now();
    try {
      res = await charge(student.id, course.id);
    } finally {
      restore();
    }
    assert.deepEqual(res, { ok: false, error: BUSY });
    assert.ok(performance.now() - started >= 6000, "it really did run past the 6 s limit");
    assert.equal((await rows(student.id)).length, 0);
    assert.equal((await db.student.findUniqueOrThrow({ where: { id: student.id } })).admissionPaid, false);
  });
});
