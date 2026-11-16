import { dbSkip, freezeClock, makeStudent, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

import { colomboDateValue } from "@/lib/colombo-time";
import { shiftDay } from "@/lib/daily-summary-dates";

import { overBankRefusal } from "./over-bank";
import { buildSnapshot, parseSnapshot, schemaOf, SnapshotError } from "./snapshot";
import { snapshotOf, summaryOf } from "./fixtures";

/*
 * Other incomes on a SAVED day (snapshot schema 2). The rules under test:
 *  - a day with no other income is stored exactly as before: schema 1, no `otherIn` key; re-saving it keeps schema 1;
 *  - a day with other income is stored as schema 2; CASH is in "Should be in the drawer", BANK never is;
 *  - bring-forward + collected + other cash − deductions = should be in the drawer, and the over-bank rule works on that figure;
 *  - an income added or cancelled after the day was saved is flagged as a MONEY difference and clears the check on a re-save;
 *  - a sheet that does not know about other income (an old tab) is refused rather than saved over it.
 */

const NOW = "2026-11-02T10:00:00Z";
type Actions = typeof import("@/app/(app)/daily-summary/saved-actions");
let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let A: Actions;
let studentId: number;
let catId: number;
let n = 0;

describe("other income on saved days", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    A = await import("@/app/(app)/daily-summary/saved-actions");
    w = await seedWorld(db);
    studentId = (await makeStudent(db)).id;
    catId = (await db.incomeCategory.findFirstOrThrow({ where: { code: "RENT" } })).id;
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  const admin = () => setSession("ADMIN", w.admin.id);
  /** A fresh day with 1,000.00 collected. */
  async function newDay(): Promise<string> {
    const date = shiftDay("2026-10-01", n++);
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1000.00", takenById: w.staff.id, paidAt: new Date(`${date}T04:00:00Z`) } });
    return date;
  }
  const income = (date: string, amount: string, method: "CASH" | "BANK" = "CASH", source = "Mr Silva") =>
    db.otherIncome.create({
      data: { categoryId: catId, amount, date: colomboDateValue(date), method, source, receivedById: w.staff.id, recordedById: w.staff.id },
    });
  const seen = async (date: string, extra: { otherCash?: number; otherBank?: number } = {}) => ({ collected: 100000, deductions: 0, ...extra, _date: date });
  const save = async (date: string, over: Record<string, unknown> = {}, extra: { otherCash?: number; otherBank?: number } = {}) => {
    const { _date, ...s } = await seen(date, extra);
    void _date;
    return A.saveDay({ date, mode: "save", baseVersion: 0, doneById: w.admin.id, bringForward: "", bank: [], seen: s, ...over });
  };
  const stored = (date: string) =>
    db.dailySummaryVersion.findFirstOrThrow({ where: { day: { date: colomboDateValue(date) } }, orderBy: { version: "desc" } });

  test("a day with NO other income is stored exactly as before: schema 1 and no otherIn key", async () => {
    admin();
    const day = await newDay();
    const r = await save(day);
    assert.ok(r.ok, JSON.stringify(r));
    const v = await stored(day);
    assert.equal(v.snapshotSchema, 1);
    assert.deepEqual(Object.keys(v.snapshot as object).sort(), ["cancelled", "report", "staff"]);
    assert.equal(v.collected.toFixed(2), "1000.00");
    assert.equal(v.shouldBeInDrawer.toFixed(2), "1000.00");
  });

  test("a day WITH other income is stored as schema 2; cash is in the drawer, bank is not", async () => {
    admin();
    const day = await newDay();
    await income(day, "250.50", "CASH", "c-1");
    await income(day, "40.00", "CASH", "c-2");
    await income(day, "9000.00", "BANK", "b-1");
    const r = await save(day, { bringForward: "100.00" }, { otherCash: 29050, otherBank: 900000 });
    assert.ok(r.ok, JSON.stringify(r));
    const v = await stored(day);
    assert.equal(v.snapshotSchema, 2);
    // bring-forward 100.00 + collected 1000.00 + other cash 290.50 − deductions 0.00; the 9,000.00 bank transfer is NOT in the drawer
    assert.equal(v.collected.toFixed(2), "1000.00", "Collected stays the fee money");
    assert.equal(v.shouldBeInDrawer.toFixed(2), "1390.50");
    assert.equal(v.leftInDrawer.toFixed(2), "1390.50");

    const read = await A.loadSavedDay(day);
    assert.ok(read.saved);
    assert.equal(read.saved!.cash.otherCash, 29050);
    assert.equal(read.saved!.snapshot.otherIn!.bank, "9000.00");
    assert.deepEqual(read.saved!.snapshot.otherIn!.rows.map((x) => x.source), ["c-1", "c-2", "b-1"]);
    assert.deepEqual(read.liveDiffs, [], "nothing differs right after saving");
  });

  test("a BANK-only day is schema 2 but the drawer figure is untouched", async () => {
    admin();
    const day = await newDay();
    await income(day, "5000.00", "BANK");
    const r = await save(day, {}, { otherBank: 500000 });
    assert.ok(r.ok, JSON.stringify(r));
    const v = await stored(day);
    assert.equal(v.snapshotSchema, 2);
    assert.equal(v.shouldBeInDrawer.toFixed(2), "1000.00");
  });

  test("over-bank uses the drawer INCLUDING other cash: more than that is refused, exactly that is allowed", async () => {
    admin();
    const day = await newDay();
    await income(day, "500.00", "CASH");
    const tooMuch = await save(day, { bank: [{ time: "09:00", amount: "1500.01", slip: "", note: "" }] }, { otherCash: 50000 });
    assert.equal(tooMuch.ok, false);
    if (!tooMuch.ok) assert.equal(tooMuch.message, overBankRefusal(1));
    assert.equal(await db.dailySummaryDay.count({ where: { date: colomboDateValue(day) } }), 0, "nothing was written");
    const exact = await save(day, { bank: [{ time: "09:00", amount: "1500.00", slip: "", note: "" }] }, { otherCash: 50000 });
    assert.ok(exact.ok, JSON.stringify(exact));
    assert.equal((await stored(day)).leftInDrawer.toFixed(2), "0.00");
  });

  test("a sheet that does not know about other income is refused (an old tab), and nothing is written", async () => {
    admin();
    const day = await newDay();
    await income(day, "100.00", "CASH");
    const old = await save(day); // no otherCash in `seen`
    assert.equal(old.ok, false);
    if (!old.ok) assert.equal(old.reason, "numbers-moved");
    const oldBank = await (async () => {
      const d2 = await newDay();
      await income(d2, "10.00", "BANK");
      return save(d2, {}, { otherCash: 0 });
    })();
    assert.equal(oldBank.ok, false, "a bank transfer the sheet did not see is refused too");
    assert.equal(await db.dailySummaryDay.count({ where: { date: colomboDateValue(day) } }), 0);
  });

  test("an income CANCELLED after saving is a money difference: flagged, and a re-save clears the check and drops to schema 1", async () => {
    admin();
    const day = await newDay();
    const row = await income(day, "300.00", "CASH");
    assert.ok((await save(day, {}, { otherCash: 30000 })).ok);
    const checked = await A.markChecked({ date: day, baseVersion: 1, checkedById: w.admin.id });
    assert.ok(checked.ok, JSON.stringify(checked));

    await db.otherIncome.update({ where: { id: row.id }, data: { cancelled: true, cancelledById: w.admin.id, cancelledAt: new Date(), cancelReason: "typed twice" } });
    const read = await A.loadSavedDay(day);
    const keys = read.liveDiffs.map((d) => d.key);
    assert.ok(keys.includes("otherIn.cash"), JSON.stringify(keys));
    assert.ok(read.liveDiffs.every((d) => d.textOnly !== true), "it is a money change, not a wording one");

    // re-save with the live numbers (no other income left): the new version is schema 1 and unchecked
    const re = await A.saveDay({ date: day, mode: "resave", baseVersion: 1, doneById: w.admin.id, bringForward: "", bank: [], seen: { collected: 100000, deductions: 0 } });
    assert.ok(re.ok, JSON.stringify(re));
    const v = await stored(day);
    assert.equal(v.version, 2);
    assert.equal(v.snapshotSchema, 1, "no other income left: schema 1 again, and no otherIn key");
    assert.equal("otherIn" in (v.snapshot as object), false);
    const after = await A.loadSavedDay(day);
    assert.equal(after.saved!.check, null, "the check was cleared by a money change");
    assert.equal(after.saved!.checkCleared?.reason, "money");
  });

  test("an income ADDED after saving a schema-1 day is flagged; the re-save makes it schema 2", async () => {
    admin();
    const day = await newDay();
    assert.ok((await save(day)).ok);
    assert.equal((await stored(day)).snapshotSchema, 1);
    await income(day, "75.00", "CASH");
    const read = await A.loadSavedDay(day);
    assert.ok(read.liveDiffs.some((d) => d.key === "otherIn.cash" && d.saved === "0.00" && d.live === "75.00"));
    const re = await A.saveDay({ date: day, mode: "resave", baseVersion: 1, doneById: w.admin.id, bringForward: "", bank: [], seen: { collected: 100000, deductions: 0, otherCash: 7500 } });
    assert.ok(re.ok, JSON.stringify(re));
    const v = await stored(day);
    assert.equal(v.snapshotSchema, 2);
    assert.equal(v.shouldBeInDrawer.toFixed(2), "1075.00");
  });

  test("a schema-1 day with no other income re-saves as schema 1 (a re-save after a payment changes only the figures)", async () => {
    admin();
    const day = await newDay();
    assert.ok((await save(day)).ok);
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "50.00", takenById: w.staff.id, paidAt: new Date(`${day}T05:00:00Z`) } });
    const re = await A.saveDay({ date: day, mode: "resave", baseVersion: 1, doneById: w.admin.id, bringForward: "", bank: [], seen: { collected: 105000, deductions: 0 } });
    assert.ok(re.ok, JSON.stringify(re));
    assert.equal((await stored(day)).snapshotSchema, 1);
  });

  test("an EDIT of a schema-2 day (bank line) keeps schema 2 and the frozen other income, even if the income is cancelled later", async () => {
    admin();
    const day = await newDay();
    const row = await income(day, "200.00", "CASH");
    assert.ok((await save(day, {}, { otherCash: 20000 })).ok);
    await db.otherIncome.update({ where: { id: row.id }, data: { cancelled: true, cancelledById: w.admin.id, cancelledAt: new Date(), cancelReason: "oops" } });
    const ed = await A.saveDay({ date: day, mode: "edit", baseVersion: 1, doneById: w.admin.id, bringForward: "", bank: [{ time: "10:00", amount: "1200.00", slip: "", note: "" }] });
    assert.ok(ed.ok, JSON.stringify(ed));
    const v = await stored(day);
    assert.equal(v.snapshotSchema, 2);
    assert.equal(v.leftInDrawer.toFixed(2), "0.00", "the frozen 200.00 is still in the drawer figure");
  });
});

describe("snapshot schema 1 and 2 (no database)", () => {
  test("schema 1 reads exactly as before, even if a stray otherIn key is present (it is dropped)", () => {
    const base = snapshotOf();
    const parsed = parseSnapshot({ ...base, otherIn: { cash: "1.00", bank: "0.00", rows: [] } }, 1);
    assert.equal("otherIn" in parsed, false);
    assert.deepEqual(parsed, base);
    assert.equal(schemaOf(base), 1);
  });

  test("a day without other income builds the identical schema-1 object whether otherIn is omitted or empty", () => {
    const withEmpty = buildSnapshot({ report: summaryOf(), cancelled: { receipts: 0, total: "0.00" }, staff: [], otherIn: { cash: "0.00", bank: "0.00", rows: [] } });
    const without = buildSnapshot({ report: summaryOf(), cancelled: { receipts: 0, total: "0.00" }, staff: [] });
    assert.equal(JSON.stringify(withEmpty), JSON.stringify(without));
    assert.equal("otherIn" in withEmpty, false);
  });

  test("schema 2 round-trips and must carry its other income; schema 3 and a schema-2 row without it are refused", () => {
    const otherIn = {
      cash: "250.50", bank: "40.00",
      rows: [
        { kind: "INCOME" as const, id: 1, date: "2026-10-14", category: "Rent received", source: "Mr Silva", receivedBy: "Sadun", amount: "250.50", method: "CASH" as const },
        { kind: "INCOME" as const, id: 2, date: "2026-10-14", category: "Donation", source: null, receivedBy: "Sadun", amount: "40.00", method: "BANK" as const },
      ],
    };
    const snap = buildSnapshot({ report: summaryOf(), cancelled: { receipts: 0, total: "0.00" }, staff: [], otherIn });
    assert.equal(schemaOf(snap), 2);
    const round = parseSnapshot(JSON.parse(JSON.stringify(snap)), 2);
    assert.deepEqual(round, snap);
    assert.throws(() => parseSnapshot(JSON.parse(JSON.stringify(snapshotOf())), 2), SnapshotError);
    assert.throws(() => parseSnapshot(snap, 3), SnapshotError);
    assert.throws(() => parseSnapshot({ ...snap, otherIn: { ...otherIn, rows: [{ ...otherIn.rows[0], method: "CHEQUE" }] } }, 2), SnapshotError);
  });
});
