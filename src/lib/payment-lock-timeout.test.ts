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

  test("the transaction itself runs past its limit (P2028): the same plain answer, and nothing is written", async () => {
    const { course, student } = await setup();

    // Make the transaction slow for this request only: it sleeps longer than the 6 s limit before
    // doing any work, so Prisma expires it (no lock involved).
    const original = db.$transaction.bind(db) as unknown as (fn: (tx: PrismaClient) => Promise<unknown>, opts?: unknown) => Promise<unknown>;
    Object.defineProperty(db, "$transaction", {
      configurable: true,
      value: (fn: (tx: PrismaClient) => Promise<unknown>, opts?: unknown) =>
        original(async (tx) => {
          await tx.$executeRaw`SELECT pg_sleep(7)`;
          return fn(tx);
        }, opts),
    });
    let res: Awaited<ReturnType<typeof charge>>;
    const started = performance.now();
    try {
      res = await charge(student.id, course.id);
    } finally {
      delete (db as unknown as Record<string, unknown>).$transaction;
    }
    assert.deepEqual(res, { ok: false, error: BUSY });
    assert.ok(performance.now() - started >= 6000, "it really did run past the 6 s limit");
    assert.equal((await rows(student.id)).length, 0);
    assert.equal((await db.student.findUniqueOrThrow({ where: { id: student.id } })).admissionPaid, false);
  });
});
