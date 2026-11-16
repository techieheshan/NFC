import { dbSkip, freezeClock, makeStudent, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * Extra payments on the Daily Summary (own file: the test database is per file). A live extra payment is Other cash in (inside the drawer,
 * never in Collected or Collected by staff); a cancelled one is in neither; the saved day freezes it as schema 2.
 */

const NOW = "2026-11-16T06:00:00Z"; // 11:30 Colombo, 16 Nov
const TODAY = "2026-11-16";
type Actions = typeof import("./actions");
let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let A: Actions;
let shirtId: number;
let studentId: number;
let n = 0;

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const none = { ok: false } as const;
const ref = () => `sale-${String(++n).padStart(8, "0")}`;

describe("extra payments on the Daily Summary (database)", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    A = await import("./actions");
    w = await seedWorld(db);
    shirtId = (await db.extraItem.create({ data: { label: "T-shirt", defaultPrice: "1500.00" } })).id;
    studentId = (await makeStudent(db)).id;
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  test("an extra payment is Other cash in: inside the drawer, NOT in Collected, not in Collected by staff; cancelled is in neither; no double counting", async () => {
    setSession("STAFF", w.staff.id);
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1000.00", takenById: w.staff.id, paidAt: new Date(`${TODAY}T04:00:00Z`) } });
    const live = await A.takeExtraPayment({ clientRef: ref(), lines: [{ itemId: shirtId, quantity: 2 }] });
    const gone = await A.takeExtraPayment({ clientRef: ref(), lines: [{ itemId: shirtId, quantity: 1 }] });
    assert.ok(live.ok && gone.ok);
    if (!gone.ok) return;
    setSession("ADMIN", w.admin.id);
    await A.cancelExtraPayment(none, form({ id: String(gone.receipt.id), reason: "returned" }));

    const { otherInFor } = await import("@/lib/daily-summary-other-in");
    const { dailySummary } = await import("@/lib/reports");
    const { collectedByStaff } = await import("@/lib/daily-summary-extras");
    const other = await otherInFor(TODAY, TODAY);
    assert.equal(other.cash, 300000, "2 x 1,500.00; the cancelled bill is not counted");
    assert.equal(other.bank, 0);
    assert.deepEqual(other.rows.map((r) => [r.kind, r.category, r.method]), [["EXTRA", "Extra payments", "CASH"]]);
    assert.ok(other.rows[0].source?.startsWith("XA-"));

    const summary = await dailySummary(TODAY, TODAY);
    assert.equal(summary.totalCollected, "1000.00", "Collected is the fee money only: extra payments are not in it");
    assert.equal(summary.net, "1000.00");
    const byStaff = await collectedByStaff(TODAY, TODAY);
    assert.equal(byStaff.reduce((s, r) => s + Number(r.collected), 0), 1000, "Collected by staff still adds up to Total collected");

    // Should be in the drawer = bring-forward + collected + other cash − deductions, from the SAVED day too
    setSession("STAFF", w.staff.id);
    const saved = await (await import("@/app/(app)/daily-summary/saved-actions")).saveDay({
      date: TODAY, mode: "save", baseVersion: 0, doneById: w.staff.id, bringForward: "500.00", bank: [], seen: { collected: 100000, deductions: 0, otherCash: 300000 },
    });
    assert.ok(saved.ok, JSON.stringify(saved));
    const v = await db.dailySummaryVersion.findFirstOrThrow({ orderBy: { id: "desc" } });
    assert.equal(v.snapshotSchema, 2);
    assert.equal(v.shouldBeInDrawer.toFixed(2), "4500.00", "500.00 + 1,000.00 + 3,000.00");
    assert.equal(v.collected.toFixed(2), "1000.00");
  });

  test("a bill taken AFTER the day was saved is a money difference; cancelling it makes the day match again", async () => {
    setSession("STAFF", w.staff.id);
    const { loadSavedDay } = await import("@/app/(app)/daily-summary/saved-actions");
    assert.deepEqual((await loadSavedDay(TODAY)).liveDiffs, [], "saved and live agree to start with");
    const r = await A.takeExtraPayment({ clientRef: ref(), lines: [{ itemId: shirtId, quantity: 1 }] });
    assert.ok(r.ok);
    if (!r.ok) return;
    const diffs = (await loadSavedDay(TODAY)).liveDiffs;
    assert.equal(diffs.length, 2, JSON.stringify(diffs));
    assert.deepEqual([diffs[0].key, diffs[0].saved, diffs[0].live], ["otherIn.cash", "3,000.00", "4,500.00"]);
    assert.ok(diffs[1].key.startsWith("other:") && diffs[1].saved === "none" && diffs[1].live === "1 × 1,500.00");
    assert.ok(diffs.every((d) => d.textOnly !== true), "a money difference, not a wording one");
    setSession("ADMIN", w.admin.id);
    await A.cancelExtraPayment(none, form({ id: String(r.receipt.id), reason: "returned" }));
    assert.deepEqual((await loadSavedDay(TODAY)).liveDiffs, [], "cancelled again: the day matches what was saved");
  });
});
