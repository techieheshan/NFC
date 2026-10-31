import { dbSkip, freezeClock, makeStudent, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

// identifyStudent against real rows: the card-id normalising (rule 12) the old screen has.

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let actions: typeof import("@/app/(app)/payment-new/actions");

describe("identifyStudent against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock("2026-11-10T06:00:00Z");
    ({ db } = await import("@/lib/db"));
    actions = await import("@/app/(app)/payment-new/actions");
    w = await seedWorld(db);
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  test("a tapped card finds its student whichever way the reader formats the UID (rule 12)", async () => {
    const s = await makeStudent(db, { cardUid: "04A22B9C" });
    setSession("STAFF", w.staff.id);
    for (const raw of ["04:a2:2b:9c", "04A22B9C", "04-a2-2b-9c", " 04 A2 2B 9C "]) {
      assert.deepEqual(await actions.identifyStudent({ cardUid: raw }), { studentId: s.id }, raw);
    }
  });

  test("a scanned QR / typed card number finds its student, with or without stray spaces", async () => {
    const s = await db.student.create({ data: { name: "QR Student", cardNumber: "0186-0007-2000" } });
    setSession("ADMIN", w.admin.id);
    for (const raw of ["0186-0007-2000", " 0186 - 0007 - 2000 "]) {
      assert.deepEqual(await actions.identifyStudent({ cardNumber: raw }), { studentId: s.id }, raw);
    }
  });

  test("an unknown card or number is null — and nothing about any student leaks", async () => {
    setSession("ADMIN", w.admin.id);
    assert.equal(await actions.identifyStudent({ cardUid: "FFFFFFFF" }), null);
    assert.equal(await actions.identifyStudent({ cardNumber: "9999-9999-9999" }), null);
  });
});
