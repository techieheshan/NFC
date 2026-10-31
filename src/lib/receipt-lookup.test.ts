import { dbSkip, enrol, freezeClock, makeCourse, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, TEST_DB_ENV, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { Client } from "pg";
import type { PrismaClient } from "@prisma/client";

/*
 * Job 4: "Last 10 receipts" and the receipt search, against a real database. Receipts are written
 * by the REAL takePayment (and cancelled by the real cancelTransaction); legacy rows with no
 * transactionRef are inserted directly, as old data would be. Everything the new functions return
 * is compared with what the existing Receipts page (`findTransactions`, `loadTransaction`) and the
 * existing reprint (`reprintTransaction`) give for the same receipts.
 *
 * Clock frozen; every checkout is one minute after the last, so "newest first" is unambiguous.
 */

const BASE = Date.parse("2026-11-10T04:00:00Z");
const SINCE = "2026-05-05T06:00:00Z";
const NOV = { year: 2026, month: 11 };
const OCT = { year: 2026, month: 10 };
const SEP = { year: 2026, month: 9 };
const AUG = { year: 2026, month: 8 };

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let lookup: typeof import("@/lib/receipt-lookup");
let receipts: typeof import("@/lib/receipts");
let pay: typeof import("@/app/(app)/payment/actions");
let rec: typeof import("@/app/(app)/receipts/actions");
let courseA: { id: number };
let courseB: { id: number };

describe("last 10 receipts and receipt search against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(new Date(BASE).toISOString());
    ({ db } = await import("@/lib/db"));
    lookup = await import("@/lib/receipt-lookup");
    receipts = await import("@/lib/receipts");
    pay = await import("@/app/(app)/payment/actions");
    rec = await import("@/app/(app)/receipts/actions");
    w = await seedWorld(db, { admissionFee: "1300", smartCardFee: "500" });
    const teacher = await makeTeacher(db);
    courseA = await makeCourse(db, w, { teacherId: teacher.id, fee: "2500", name: "LookupA" });
    courseB = await makeCourse(db, w, { teacherId: teacher.id, fee: "1700", name: "LookupB" });
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------------------------

  let minute = 0;
  /** The next checkout happens one minute after the last. */
  const tick = () => freezeClock(new Date(BASE + ++minute * 60_000).toISOString());
  beforeEach(async () => {
    // the throw-away test database only: each test builds its own students and receipts
    await db.payment.deleteMany({});
    await db.enrollment.deleteMany({});
    await db.student.deleteMany({});
    minute = 0;
  });

  let n = 0;
  const uid = () => `UID${process.pid}${++n}${Math.random().toString(16).slice(2, 8)}`.toUpperCase();
  async function student(name: string, card: string, o: { courses?: { id: number }[] } = {}) {
    const s = await db.student.create({ data: { name, cardNumber: card, cardUid: uid() } });
    for (const c of o.courses ?? [courseA]) await enrol(db, { studentId: s.id, courseId: c.id, tierId: w.tiers.FULL.id, since: SINCE });
    return s;
  }
  type Line = { courseId: number; year: number; month: number; mode?: "FULL" | "HALF" | "NO_CHARGE" };
  async function checkout(studentId: number, o: { admission?: boolean; smartCard?: boolean; months?: Line[]; as?: "ADMIN" | "STAFF" } = {}) {
    tick();
    setSession(o.as ?? "ADMIN", o.as === "STAFF" ? w.staff.id : w.admin.id);
    const res = await pay.takePayment({
      studentId, admission: o.admission ?? false, smartCard: o.smartCard ?? false, comboDecisions: [],
      classMonths: o.months ?? [],
    });
    assert.equal(res.ok, true, JSON.stringify(res));
    return (res as Extract<typeof res, { ok: true }>).receipt;
  }
  const rows = (studentId: number) => db.payment.findMany({ where: { studentId }, orderBy: { id: "asc" } });
  const refs = (list: { receipts: { reference: string }[] }) => list.receipts.map((r) => r.reference);
  const A = (month: { year: number; month: number }, mode?: Line["mode"]): Line => ({ courseId: courseA.id, ...month, mode });
  const B = (month: { year: number; month: number }, mode?: Line["mode"]): Line => ({ courseId: courseB.id, ...month, mode });

  /** Many CLASS rows as ONE receipt (one shared ref), written directly: for volume, not for rules. */
  async function bulkReceipt(studentId: number, lines: number, minuteOffset: number) {
    const transactionRef = randomUUID();
    const paidAt = new Date(BASE + minuteOffset * 60_000);
    await db.payment.createMany({
      data: Array.from({ length: lines }, (_, i) => ({
        kind: "CLASS" as const, studentId, courseId: courseA.id, billingYear: 2018 + Math.floor(i / 12), billingMonth: (i % 12) + 1,
        amount: "100.00", takenById: w.admin.id, paidAt, transactionRef,
      })),
    });
    return transactionRef;
  }

  // ---- the list ---------------------------------------------------------------------------------

  test("no payments at all: an empty list, nothing more", async () => {
    assert.deepEqual(await lookup.lastReceipts(), { receipts: [], more: false });
  });

  test("a few receipts (single line, multi-line, two students): newest first, the numbers, totals and lines the server wrote", async () => {
    const nimal = await student("Nimal Perera", "0186-0001-2000");
    const heshan = await student("Heshan Silva", "0186-0002-2000");
    const r1 = await checkout(nimal.id, { months: [A(NOV)] }); // single line
    const r2 = await checkout(heshan.id, { admission: true, smartCard: true, months: [A(OCT), A(NOV)] }); // 4 lines, one receipt
    const r3 = await checkout(nimal.id, { months: [A(OCT)] });

    const list = await lookup.lastReceipts();
    assert.equal(list.more, false);
    assert.deepEqual(refs(list), [r3.reference, r2.reference, r1.reference], "newest first");
    const [x3, x2, x1] = list.receipts;
    assert.deepEqual([x1.lines.length, x2.lines.length, x3.lines.length], [1, 4, 1]);
    assert.deepEqual([x1.total, x2.total, x3.total], ["2500.00", "6800.00", "2500.00"]);
    // the reference is the LOWEST id of the receipt's rows
    const hs = await rows(heshan.id);
    assert.equal(x2.reference, `XN-${hs[0].id}`);
    assert.deepEqual(x2.paymentIds, hs.map((r) => r.id));
    assert.deepEqual([x1.student.name, x1.student.cardNumber, x1.takenBy], ["Nimal Perera", "0186-0001-2000", w.admin.username]);
    assert.equal(x1.cancelled, null);
  });

  test("the list is exactly what the existing Receipts page shows for the same receipts (same numbers, totals, lines — deep equal)", async () => {
    const s = await student("Parity Kid", "PAR-0001");
    await checkout(s.id, { admission: true, months: [A(NOV)] });
    await checkout(s.id, { months: [A(OCT, "HALF"), A(SEP, "NO_CHARGE")] });
    await checkout(s.id, { months: [A(AUG)] });
    const list = await lookup.lastReceipts();
    const page = await receipts.findTransactions({ q: "PAR-0001", includeCancelled: true });
    assert.equal(list.receipts.length, 3);
    assert.deepEqual(list.receipts, page);
    for (const t of list.receipts) assert.deepEqual(t, await receipts.loadTransaction(t.key));
  });

  test("fewer than 10, exactly 10, and more than 10 receipts: the cap, and the 'more' flag", async () => {
    const s = await student("Counting Kid", "CNT-0001");
    const keys: string[] = [];
    const add = async () => keys.push(`ref:${await bulkReceipt(s.id, 1, keys.length)}`);
    for (let i = 0; i < 9; i++) await add();
    let list = await lookup.lastReceipts();
    assert.deepEqual([list.receipts.length, list.more], [9, false]);

    await add(); // the 10th
    list = await lookup.lastReceipts();
    assert.deepEqual([list.receipts.length, list.more], [10, false], "exactly 10 is not 'capped'");

    await add(); // the 11th
    list = await lookup.lastReceipts();
    assert.deepEqual([list.receipts.length, list.more], [10, true]);
    assert.deepEqual(list.receipts.map((t) => t.key), keys.slice(1).reverse(), "the 10 newest; the oldest dropped out");
  });

  test("a cancelled receipt is listed with its cancellation (and still has every line)", async () => {
    const s = await student("Cancel Kid", "CAN-0001");
    const r1 = await checkout(s.id, { admission: true, months: [A(NOV)] });
    const r2 = await checkout(s.id, { months: [A(OCT)] });
    setSession("ADMIN", w.admin.id);
    const f = new FormData();
    f.set("key", `ref:${(await rows(s.id)).find((r) => r.kind === "ADMISSION")!.transactionRef}`);
    f.set("reason", "taken twice");
    assert.deepEqual(await rec.cancelTransaction({ ok: false }, f), { ok: true });

    const list = await lookup.lastReceipts();
    assert.deepEqual(refs(list), [r2.reference, r1.reference]);
    assert.equal(list.receipts[0].cancelled, null);
    const cancelled = list.receipts[1];
    assert.deepEqual([cancelled.cancelled?.reason, cancelled.cancelled?.by, cancelled.lines.length, cancelled.total], ["taken twice", w.admin.username, 2, "3800.00"]);
    assert.equal(list.receipts[1].hasAdmission, true);
  });

  test("a receipt of ONLY No-charge months is listed with total 0.00 and the noCharge flag; mixed Full + Half + No charge keeps its labels", async () => {
    const s = await student("Mode Kid", "MOD-0001", { courses: [courseA, courseB] });
    const free = await checkout(s.id, { months: [A(NOV, "NO_CHARGE"), A(OCT, "NO_CHARGE")] });
    const mixed = await checkout(s.id, { months: [A(SEP), A(AUG, "HALF"), B(SEP, "NO_CHARGE")] });
    const [m, f] = (await lookup.lastReceipts()).receipts;
    assert.equal(f.reference, free.reference);
    assert.deepEqual([f.total, f.noCharge, f.lines.length], ["0.00", true, 2]);
    assert.ok(f.lines.every((l) => l.amount === "0.00" && l.label.endsWith("(No charge)")));
    assert.equal(m.reference, mixed.reference);
    assert.equal(m.noCharge, undefined, "mixed is not a no-charge receipt");
    assert.deepEqual(m.lines.map((l) => [l.label.replace(/^.* — /, ""), l.amount]), [["Sep 2026", "2500.00"], ["Aug 2026 (Half month)", "1250.00"], ["Sep 2026 (No charge)", "0.00"]]);
    assert.equal(m.total, "3750.00");
  });

  test("legacy rows with NO transactionRef: each is its own receipt, none absorbs another, and a ref-less row never sweeps up the other nulls", async () => {
    const s = await student("Legacy Kid", "LEG-0001");
    const mk = (monthsAgo: number, ref: string | null) =>
      db.payment.create({ data: { kind: "CLASS", studentId: s.id, courseId: courseA.id, billingYear: 2025, billingMonth: monthsAgo, amount: "2500.00", takenById: w.admin.id, paidAt: new Date(BASE - monthsAgo * 3600_000), transactionRef: ref } });
    const l1 = await mk(1, null);
    const l2 = await mk(2, null);
    const l3 = await mk(3, null);
    const grouped = randomUUID();
    const g1 = await mk(4, grouped);
    const g2 = await mk(4, grouped);

    const list = await lookup.lastReceipts();
    assert.deepEqual(list.receipts.map((t) => t.key), [`pay:${l1.id}`, `pay:${l2.id}`, `pay:${l3.id}`, `ref:${grouped}`], "three single receipts and one grouped, newest first");
    assert.deepEqual(list.receipts.map((t) => t.lines.length), [1, 1, 1, 2]);
    assert.deepEqual(list.receipts.map((t) => t.reference), [`XN-${l1.id}`, `XN-${l2.id}`, `XN-${l3.id}`, `XN-${Math.min(g1.id, g2.id)}`]);
    // and by number: a legacy row is its own lowest id
    assert.equal((await lookup.receiptByNumber(l2.id))?.key, `pay:${l2.id}`);
    assert.equal((await lookup.searchReceipts(`XN-${l3.id}`)).receipts[0]?.key, `pay:${l3.id}`);
  });

  test("receipts with MANY lines: the latest 10 come back COMPLETE even when the row walk crosses its page boundary inside a receipt", async () => {
    // 12 receipts x 23 lines = 276 rows; the walk reads 200 rows at a time, so the end of the
    // first page falls in the middle of the 9th receipt. Taking "10 rows" or "the first page"
    // would drop or cut receipts.
    const s = await student("Bulk Kid", "BULK-0001");
    const refsMade: string[] = [];
    for (let i = 0; i < 12; i++) refsMade.push(await bulkReceipt(s.id, 23, i)); // i = minute offset: later = newer
    const list = await lookup.lastReceipts();
    assert.equal(list.receipts.length, 10);
    assert.equal(list.more, true);
    assert.deepEqual(list.receipts.map((t) => t.key), refsMade.slice(2).reverse().map((r) => `ref:${r}`), "the 10 newest, newest first");
    for (const t of list.receipts) {
      assert.equal(t.lines.length, 23, `${t.reference} is complete`);
      assert.equal(t.total, "2300.00");
      assert.equal(t.reference, `XN-${Math.min(...t.paymentIds)}`);
    }
  });

  test("the list reads every row of a receipt even when other receipts are interleaved in time with it", async () => {
    const s1 = await student("Inter One", "INT-0001");
    const s2 = await student("Inter Two", "INT-0002");
    // rows of one receipt share a paidAt; a second checkout slotted in between does not split them
    const a = await checkout(s1.id, { admission: true, smartCard: true, months: [A(NOV), A(OCT)] });
    const b = await checkout(s2.id, { months: [A(NOV)] });
    const list = await lookup.lastReceipts();
    assert.deepEqual(refs(list), [b.reference, a.reference]);
    assert.deepEqual(list.receipts.map((t) => t.lines.length), [1, 4]);
  });

  // ---- search -----------------------------------------------------------------------------------

  async function searchWorld() {
    const nimal = await student("Nimal Perera", "0186-0001-2000");
    const heshan = await student("Heshan Silva", "0186-0002-2000");
    const r1 = await checkout(nimal.id, { months: [A(NOV)] });
    const r2 = await checkout(heshan.id, { admission: true, smartCard: true, months: [A(OCT), A(NOV)] });
    const r3 = await checkout(nimal.id, { months: [A(OCT)] });
    return { nimal, heshan, r1, r2, r3 };
  }

  test("search by name, partial name (any case) and card number: that student's receipts, newest first", async () => {
    const { r1, r2, r3 } = await searchWorld();
    for (const q of ["Nimal Perera", "nimal", "PERERA", "mal Per", "0186-0001-2000", "0001-2000"]) { // (not a bare number: that would also be read as a receipt number)
      const s = await lookup.searchReceipts(q);
      assert.deepEqual(refs(s), [r3.reference, r1.reference], q);
      assert.equal(s.tooShort, false);
    }
    assert.deepEqual(refs(await lookup.searchReceipts("heshan")), [r2.reference]);
    assert.deepEqual(refs(await lookup.searchReceipts("0186-000")), [r3.reference, r2.reference, r1.reference], "a fragment shared by two students finds both");
  });

  test("search by receipt number: XN-n, xn n, xn-n and plain n all find it; a LOWEST id only", async () => {
    const { heshan, r2 } = await searchWorld();
    const ids = (await rows(heshan.id)).map((r) => r.id); // admission, smart card, two months
    assert.equal(r2.reference, `XN-${ids[0]}`);
    for (const q of [`XN-${ids[0]}`, `xn${ids[0]}`, `xn ${ids[0]}`, `xn-${ids[0]}`, `${ids[0]}`]) {
      const s = await lookup.searchReceipts(q);
      assert.deepEqual(refs(s), [r2.reference], q);
      assert.equal(s.receipts[0].lines.length, 4, "the whole receipt, not the row");
    }
    // a MIDDLE row's id is a payment, not a receipt number — whatever the spelling
    for (const mid of ids.slice(1)) {
      for (const q of [`XN-${mid}`, `xn ${mid}`]) {
        const s = await lookup.searchReceipts(q);
        assert.deepEqual(s.receipts, [], q);
      }
      assert.equal(await lookup.receiptByNumber(mid), null);
    }
    assert.equal(await lookup.receiptByNumber(987654), null, "an id that does not exist");
  });

  test("a bare number that is ALSO a card fragment: the receipt-number match comes first, then the student matches", async () => {
    await bulkReceipt((await student("Pad Kid", "PAD-0001")).id, 100, 0); // move the ids past two digits
    await db.payment.deleteMany({});
    const first = await student("Pq Alpha", "PQ-A");
    const r1 = await checkout(first.id, { months: [A(NOV)] });
    const id = (await rows(first.id))[0].id;
    assert.ok(String(id).length >= 2, `id ${id}`);
    const other = await student("Digit Kid", `9-${id}-X`);
    const r2 = await checkout(other.id, { months: [A(NOV)] });
    const s = await lookup.searchReceipts(String(id));
    assert.deepEqual(refs(s), [r1.reference, r2.reference], "the receipt first (older), then the card match (newer)");
    assert.deepEqual(refs(await lookup.searchReceipts(`XN-${id}`)), [r1.reference], "with the XN prefix it is only a receipt number");
  });

  test("search finds cancelled receipts too, with the cancellation", async () => {
    const { nimal, r1 } = await searchWorld();
    setSession("ADMIN", w.admin.id);
    const f = new FormData();
    f.set("key", `ref:${(await rows(nimal.id))[0].transactionRef}`);
    f.set("reason", "wrong student");
    assert.deepEqual(await rec.cancelTransaction({ ok: false }, f), { ok: true });
    const s = await lookup.searchReceipts("nimal");
    assert.equal(s.receipts.length, 2);
    assert.equal(s.receipts.find((t) => t.reference === r1.reference)?.cancelled?.reason, "wrong student");
  });

  test("no result, and a query that is too short", async () => {
    await searchWorld();
    assert.deepEqual(await lookup.searchReceipts("zzzz-nobody"), { receipts: [], more: false, tooShort: false });
    assert.deepEqual(await lookup.searchReceipts("XN-424242"), { receipts: [], more: false, tooShort: false });
    for (const q of ["", " ", "n", "z"]) assert.deepEqual(await lookup.searchReceipts(q), { receipts: [], more: false, tooShort: true }, JSON.stringify(q));
    // one DIGIT is a receipt number, not "too short"
    assert.equal((await lookup.searchReceipts("7")).tooShort, false);
  });

  test("search is capped at 20 receipts: the 20 newest, with 'more' set", async () => {
    const kid = await student("Capped Kid", "CAP-0001");
    const keys: string[] = [];
    for (let i = 0; i < 22; i++) keys.push(`ref:${await bulkReceipt(kid.id, 1, i)}`);
    const s = await lookup.searchReceipts("capped");
    assert.equal(s.receipts.length, 20);
    assert.equal(s.more, true);
    assert.deepEqual(s.receipts.map((t) => t.key), keys.slice(2).reverse());
    // exactly 20 is not capped
    await db.payment.deleteMany({ where: { id: { in: (await rows(kid.id)).slice(0, 2).map((r) => r.id) } } });
    assert.deepEqual([(await lookup.searchReceipts("capped")).receipts.length, (await lookup.searchReceipts("capped")).more], [20, false]);
  });

  test("a search hit is complete too: a receipt of many lines is not cut, wherever the walk's page ends", async () => {
    const kid = await student("Wide Kid", "WIDE-0001");
    for (let i = 0; i < 9; i++) await bulkReceipt(kid.id, 23, i);
    const s = await lookup.searchReceipts("wide kid");
    assert.equal(s.receipts.length, 9);
    for (const t of s.receipts) assert.equal(t.lines.length, 23);
  });

  test("CURRENT BEHAVIOUR (old Receipts page, NOT changed in job 4): findTransactions groups at most 300 ROWS, so a receipt cut at that boundary loses lines and part of its total — the new lookup does not", async () => {
    const kid = await student("Cut Kid", "CUT-0001");
    // The big receipt is the OLDEST: 23 lines. 290 newer single-line receipts come before it, so the
    // 300-row window ends 10 rows into it.
    const bigRef = await bulkReceipt(kid.id, 23, 0);
    await db.payment.createMany({
      data: Array.from({ length: 290 }, (_, i) => ({
        kind: "CLASS" as const, studentId: kid.id, courseId: courseA.id, billingYear: 2000 + Math.floor(i / 12), billingMonth: (i % 12) + 1,
        amount: "10.00", takenById: w.admin.id, paidAt: new Date(BASE + (10 + i) * 60_000), transactionRef: randomUUID(),
      })),
    });
    const complete = await receipts.loadTransaction(`ref:${bigRef}`);
    assert.equal(complete?.lines.length, 23);

    const old = (await receipts.findTransactions({ q: "Cut Kid", includeCancelled: true })).find((t) => t.key === `ref:${bigRef}`)!;
    assert.equal(old.lines.length, 10, "the old page shows 10 of the 23 lines");
    assert.deepEqual([old.total, complete!.total], ["1000.00", "2300.00"], "...and 1000.00 of the 2300.00 (its receipt NUMBER is only right when the lowest-id rows happen to survive the cut)");

    // The new lookup reads every row of the receipt: by its number it is complete.
    const byNumber = await lookup.receiptByNumber(Math.min(...complete!.paymentIds));
    assert.deepEqual(byNumber, complete);
    assert.equal(byNumber?.lines.length, 23);
    assert.deepEqual((await lookup.searchReceipts(complete!.reference)).receipts, [complete]);
  });

  // ---- reprint ----------------------------------------------------------------------------------

  test("reprint gives the same document as the Receipts page for the same key (and a STAFF login may reprint)", async () => {
    const { heshan } = await searchWorld();
    const list = await lookup.lastReceipts();
    const page = await receipts.findTransactions({ q: "Heshan", includeCancelled: true });
    for (const role of ["ADMIN", "STAFF"] as const) {
      setSession(role, role === "ADMIN" ? w.admin.id : w.staff.id);
      for (const t of list.receipts) {
        assert.deepEqual(await rec.reprintTransaction(t.key), t, `${role} ${t.reference}`);
      }
      const h = list.receipts.find((t) => t.student.name === "Heshan Silva")!;
      assert.deepEqual(await rec.reprintTransaction(h.key), page.find((t) => t.key === h.key));
    }
    setSession("TEACHER");
    await assert.rejects(() => rec.reprintTransaction(list.receipts[0].key), { message: "Not authorised" });
    void heshan;
  });

  test("reprint of a cancelled receipt carries the cancellation (the existing CANCELLED band applies)", async () => {
    const { heshan } = await searchWorld();
    setSession("ADMIN", w.admin.id);
    const f = new FormData();
    f.set("key", `ref:${(await rows(heshan.id))[0].transactionRef}`);
    f.set("reason", "double charge");
    await rec.cancelTransaction({ ok: false }, f);
    const t = (await lookup.searchReceipts("heshan")).receipts[0];
    const again = await rec.reprintTransaction(t.key);
    assert.equal(again?.cancelled?.reason, "double charge");
    assert.deepEqual(again, t);
  });

  // ---- read-only --------------------------------------------------------------------------------

  test("the new functions issue only READS: they run to completion on a database that refuses every write", async () => {
    // Seed every kind of receipt first, then make the database refuse writes for every NEW
    // connection and reconnect. A single INSERT/UPDATE/DELETE from the functions below would fail.
    const { heshan } = await searchWorld();
    const mid = (await rows(heshan.id))[1].id;
    await bulkReceipt((await student("Ro Kid", "RO-0001")).id, 3, 50);
    await db.payment.create({ data: { kind: "CLASS", studentId: heshan.id, courseId: courseA.id, billingYear: 2025, billingMonth: 1, amount: "1.00", takenById: w.admin.id, transactionRef: null } });

    const admin = new Client({ connectionString: process.env[TEST_DB_ENV] });
    await admin.connect();
    try {
      await admin.query(`ALTER DATABASE ${handle.name} SET default_transaction_read_only = on`);
      await db.$disconnect(); // the next query opens a new connection, which is read-only
      // control: the database really does refuse a write now
      await assert.rejects(() => db.payment.create({ data: { kind: "CLASS", studentId: heshan.id, amount: "1.00", takenById: w.admin.id } }), /read-only transaction/);

      const list = await lookup.lastReceipts();
      assert.ok(list.receipts.length >= 4);
      for (const q of ["heshan", "0186", "XN-1", "1", `XN-${mid}`, "zzzz", "z"]) await lookup.searchReceipts(q);
      await lookup.receiptByNumber(mid);
      setSession("STAFF", w.staff.id);
      assert.ok(await rec.reprintTransaction(list.receipts[0].key));
    } finally {
      await db.$disconnect();
      await admin.query(`ALTER DATABASE ${handle.name} RESET default_transaction_read_only`);
      await admin.end();
    }
  });
});
