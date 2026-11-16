import { dbSkip, freezeClock, makeStudent, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import type { PrismaClient } from "@prisma/client";

/*
 * Extra payments against a real (throw-away) database, made-up data only. The rules under test:
 *  - ADMIN + STAFF sell and reprint; the price list and cancelling are ADMIN only (replayed with every role, AGENTS 10 and 29);
 *  - the server prices the bill: a forged unit price, amount or total is ignored, a retired item cannot be sold (AGENTS 16);
 *  - one clientRef = one bill, even under a race; no Payment row is ever written and no student is touched (AGENTS 13);
 *  - cancel keeps the row; the Daily Summary counts live extra payments as cash and never double counts them.
 */

const NOW = "2026-11-16T06:00:00Z"; // 11:30 Colombo, 16 Nov
type Q = Record<string, string | string[] | undefined>;
type Actions = typeof import("./actions");
let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let A: Actions;
let teacherId: string;
let shirtId: number;
let bookId: number;
let studentId: number;
let courseId: number;
let n = 0;

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const none = { ok: false } as const;
const ref = () => `sale-${String(++n).padStart(8, "0")}`;
const bill = (lines: unknown[], over: Record<string, unknown> = {}) => ({ clientRef: ref(), lines, ...over });

describe("extra payments (database)", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    A = await import("./actions");
    w = await seedWorld(db);
    teacherId = (await db.user.create({ data: { username: "teacher-ep", passwordHash: "x", role: "TEACHER" } })).id;
    shirtId = (await db.extraItem.create({ data: { label: "T-shirt", defaultPrice: "1500.00", sortOrder: 1 } })).id;
    bookId = (await db.extraItem.create({ data: { label: "Past papers", defaultPrice: "750.50", sortOrder: 2 } })).id;
    const student = await makeStudent(db);
    studentId = student.id;
    const course = await db.course.create({ data: { teacherId: (await db.teacher.create({ data: { name: "Mr A" } })).id, subjectId: w.subject.id, gradeId: w.grade.id, streamId: w.stream.id, classTypeId: w.classType.id, defaultFee: "2500.00", instituteSharePercent: "25.00" } });
    courseId = course.id;
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  const staff = () => setSession("STAFF", w.staff.id);
  const admin = () => setSession("ADMIN", w.admin.id);
  const counts = async () => ({ bills: await db.extraPayment.count(), lines: await db.extraPaymentLine.count(), payments: await db.payment.count(), items: await db.extraItem.count() });

  test("takeExtraPayment: TEACHER and no session are refused with nothing written; ADMIN and STAFF are served", async () => {
    for (const [role, id] of [["TEACHER", teacherId], [null, "nobody"]] as const) {
      setSession(role, id);
      const before = await counts();
      await assert.rejects(() => A.takeExtraPayment(bill([{ itemId: shirtId, quantity: 1 }])), (e: Error) => e.message === "Not authorised");
      assert.deepEqual(await counts(), before);
    }
    for (const who of [staff, admin]) {
      who();
      const r = await A.takeExtraPayment(bill([{ itemId: shirtId, quantity: 1 }]));
      assert.ok(r.ok, JSON.stringify(r));
    }
  });

  test("the reads are guarded: a TEACHER cannot list items, classes, receipts or the cap", async () => {
    setSession("TEACHER", teacherId);
    for (const fn of [() => A.listSellableItems(), () => A.listClassOptions(), () => A.getOneOffMaxCents(), () => A.getExtraReceipt(1), () => A.searchExtraReceipts("")]) await assert.rejects(fn, /Not authorised/);
    staff();
    assert.equal((await A.listSellableItems()).length, 2);
    await assert.rejects(() => A.listAllItems(), /Not authorised/, "the full list (with retired items) is ADMIN only");
  });

  test("the server prices the bill: a forged price, amount and total are ignored", async () => {
    staff();
    const r = await A.takeExtraPayment({
      clientRef: ref(), total: "1.00", amount: "1.00",
      lines: [{ itemId: shirtId, quantity: 3, price: "0.01", unitPrice: "0.01", amount: "0.01" }, { itemId: bookId, quantity: 2, price: "0.01" }],
    });
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    assert.equal(r.receipt.total, "6,001.00", "3 x 1,500.00 + 2 x 750.50");
    assert.deepEqual(r.receipt.lines.map((l) => l.amount), ["4,500.00", "1,501.00"]);
    const row = await db.extraPayment.findUniqueOrThrow({ where: { id: r.receipt.id }, include: { lines: true } });
    assert.equal(row.total.toFixed(2), "6001.00");
    assert.equal(row.lines.reduce((s, l) => s + Number(l.amount), 0), 6001);
  });

  test("a retired or unknown item refuses the whole bill and writes nothing", async () => {
    staff();
    const old = await db.extraItem.create({ data: { label: "Retired cap", defaultPrice: "300.00", active: false } });
    const before = await counts();
    for (const id of [old.id, 99999]) {
      const r = await A.takeExtraPayment(bill([{ itemId: shirtId, quantity: 1 }, { itemId: id, quantity: 1 }]));
      assert.equal(r.ok, false);
    }
    assert.deepEqual(await counts(), before);
  });

  test("a one-off item: off until the Setting allows it, capped by it, the price typed is what is billed and it is marked", async () => {
    staff();
    const oneOff = (price: string) => bill([{ label: "Lab coat", price, quantity: 2 }]);
    assert.equal((await A.takeExtraPayment(oneOff("400.00"))).ok, false, "no Setting: not allowed");
    await db.setting.upsert({ where: { key: "extra_one_off_max_price" }, update: { value: "500.00" }, create: { key: "extra_one_off_max_price", value: "500.00" } });
    assert.equal(await A.getOneOffMaxCents(), 50000);
    assert.equal((await A.takeExtraPayment(oneOff("500.01"))).ok, false, "above the cap");
    const r = await A.takeExtraPayment(oneOff("400.00"));
    assert.ok(r.ok, JSON.stringify(r));
    if (r.ok) {
      assert.equal(r.receipt.total, "800.00");
      assert.equal(r.receipt.lines[0].custom, true);
      assert.equal((await db.extraPaymentLine.findFirstOrThrow({ where: { paymentId: r.receipt.id } })).itemId, null);
    }
    await db.setting.update({ where: { key: "extra_one_off_max_price" }, data: { value: "0" } });
    assert.equal((await A.takeExtraPayment(oneOff("400.00"))).ok, false, "switched off again");
  });

  test("one clientRef is one bill: a double tap returns the same receipt; five racing taps write one row", async () => {
    staff();
    const input = bill([{ itemId: shirtId, quantity: 1 }]);
    const first = await A.takeExtraPayment(input);
    const second = await A.takeExtraPayment(input);
    assert.ok(first.ok && second.ok);
    if (first.ok && second.ok) {
      assert.equal(first.duplicate, false);
      assert.equal(second.duplicate, true);
      assert.equal(second.receipt.id, first.receipt.id);
    }
    const before = (await counts()).bills;
    const racing = bill([{ itemId: bookId, quantity: 1 }]);
    const results = await Promise.all(Array.from({ length: 5 }, () => A.takeExtraPayment(racing)));
    assert.ok(results.every((r) => r.ok), JSON.stringify(results));
    assert.equal(new Set(results.map((r) => (r.ok ? r.receipt.id : 0))).size, 1, "all five got the same bill");
    assert.equal((await counts()).bills, before + 1);
  });

  test("another login cannot read or reuse someone else's clientRef", async () => {
    staff();
    const input = bill([{ itemId: shirtId, quantity: 1 }]);
    assert.ok((await A.takeExtraPayment(input)).ok);
    admin();
    const r = await A.takeExtraPayment(input);
    assert.equal(r.ok, false);
  });

  test("a bad student or class is refused; a student and class on the bill are printed; registration and money are untouched (rule 13)", async () => {
    staff();
    const before = await counts();
    assert.equal((await A.takeExtraPayment(bill([{ itemId: shirtId, quantity: 1 }], { studentId: 99999 }))).ok, false);
    assert.equal((await A.takeExtraPayment(bill([{ itemId: shirtId, quantity: 1 }], { courseId: 99999 }))).ok, false);
    assert.deepEqual(await counts(), before);

    const s0 = await db.student.findUniqueOrThrow({ where: { id: studentId } });
    const r = await A.takeExtraPayment(bill([{ itemId: shirtId, quantity: 1 }], { studentId, courseId, note: "sports meet" }));
    assert.ok(r.ok, JSON.stringify(r));
    if (r.ok) {
      assert.equal(r.receipt.student?.id, studentId);
      assert.ok(r.receipt.course && r.receipt.course.length > 0);
      assert.equal(r.receipt.note, "sports meet");
    }
    const s1 = await db.student.findUniqueOrThrow({ where: { id: studentId } });
    assert.deepEqual(s1, s0, "the student row is exactly as it was");
    assert.equal(await db.payment.count(), 0, "no Payment row is ever written by an extra payment");
    assert.equal(await db.enrollment.count(), 0);
  });

  test("cancelExtraPayment: STAFF refused (row unchanged); ADMIN cancels; the row stays; a reprint says CANCELLED; twice says so", async () => {
    staff();
    const r = await A.takeExtraPayment(bill([{ itemId: shirtId, quantity: 2 }]));
    assert.ok(r.ok);
    if (!r.ok) return;
    const id = r.receipt.id;
    await assert.rejects(() => A.cancelExtraPayment(none, form({ id: String(id), reason: "wrong size" })), (e: Error) => e.message === "Not authorised");
    assert.equal((await db.extraPayment.findUniqueOrThrow({ where: { id } })).cancelled, false);

    admin();
    assert.equal((await A.cancelExtraPayment(none, form({ id: String(id), reason: "ab" }))).ok, false);
    assert.equal((await A.cancelExtraPayment(none, form({ id: String(id), reason: "wrong size" }))).ok, true);
    const row = await db.extraPayment.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.cancelled, row.cancelledById, row.cancelReason], [true, w.admin.id, "wrong size"]);
    assert.equal(row.total.toFixed(2), "3000.00", "the amount is never touched");
    assert.equal(await db.extraPaymentLine.count({ where: { paymentId: id } }), 1, "lines stay");

    staff();
    const again = await A.getExtraReceipt(id);
    assert.equal(again?.cancelled?.by.length ? true : false, true);
    assert.equal(again?.cancelled?.reason, "wrong size");
    admin();
    assert.equal((await A.cancelExtraPayment(none, form({ id: String(id), reason: "wrong size" }))).error, `XA-${id} is already cancelled.`);
    assert.equal((await A.cancelExtraPayment(none, form({ id: "999999", reason: "wrong size" }))).error, "That receipt could not be found.");
  });

  test("the item list: ADMIN only; a new price is for FUTURE bills; old bills keep their frozen line; retiring keeps old bills readable", async () => {
    staff();
    for (const fn of [A.createExtraItem, A.updateExtraItem, A.setExtraItemActive]) await assert.rejects(() => fn(none, form({ label: "Cap", price: "100", id: String(shirtId), active: "false" })), (e: Error) => e.message === "Not authorised");
    const sold = await A.takeExtraPayment(bill([{ itemId: shirtId, quantity: 1 }]));
    assert.ok(sold.ok);
    admin();
    assert.equal((await A.createExtraItem(none, form({ label: "Water bottle", price: "450" }))).ok, true);
    assert.equal((await A.createExtraItem(none, form({ label: "water BOTTLE", price: "450" }))).error, "An item with that name is already on the list.");
    assert.equal((await A.createExtraItem(none, form({ label: "Free", price: "0" }))).ok, false);
    assert.equal((await A.updateExtraItem(none, form({ id: String(shirtId), label: "T-shirt", price: "1800.00" }))).ok, true);
    staff();
    const old = sold.ok ? await A.getExtraReceipt(sold.receipt.id) : null;
    assert.equal(old?.total, "1,500.00", "the bill sold at the old price still reads 1,500.00");
    const next = await A.takeExtraPayment(bill([{ itemId: shirtId, quantity: 1 }]));
    assert.ok(next.ok && next.receipt.total === "1,800.00");
    admin();
    assert.equal((await A.setExtraItemActive(none, form({ id: String(shirtId), active: "false" }))).ok, true);
    staff();
    assert.ok(!(await A.listSellableItems()).some((i) => i.id === shirtId));
    assert.equal((await A.getExtraReceipt(sold.ok ? sold.receipt.id : 0))?.lines[0].label, "T-shirt", "an old bill is still readable");
    admin();
    await A.setExtraItemActive(none, form({ id: String(shirtId), active: "true" }));
  });

  test("the receipt search: by XA number, by 2+ characters of a student's name, newest 10 by default", async () => {
    staff();
    const r = await A.takeExtraPayment(bill([{ itemId: bookId, quantity: 1 }], { studentId }));
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal((await A.searchExtraReceipts(`XA-${r.receipt.id}`))[0].id, r.receipt.id);
    assert.equal((await A.searchExtraReceipts(String(r.receipt.id)))[0].id, r.receipt.id);
    const studentName = (await db.student.findUniqueOrThrow({ where: { id: studentId } })).name;
    assert.ok((await A.searchExtraReceipts(studentName.slice(0, 4))).some((x) => x.id === r.receipt.id));
    assert.deepEqual(await A.searchExtraReceipts("x"), [], "one character finds nothing");
    assert.ok((await A.searchExtraReceipts("")).length <= 10);
  });

  test("the pages: the receipts page is ADMIN + STAFF, the item list is ADMIN only (not-found for STAFF); a TEACHER gets neither", async () => {
    const render = async (P: unknown, q: Q = {}) => renderToStaticMarkup((await (P as (a: { searchParams: Promise<Q> }) => Promise<React.ReactElement>)({ searchParams: Promise.resolve(q) })) as React.ReactElement);
    const { default: itemsPage } = await import("./items/page");
    const { default: receiptsPage } = await import("./receipts/page");
    const { default: salePage } = await import("./page");
    setSession("TEACHER", teacherId);
    for (const P of [itemsPage, receiptsPage, salePage]) await assert.rejects(() => render(P), /NEXT_NOT_FOUND/);
    staff();
    await assert.rejects(() => render(itemsPage), /NEXT_NOT_FOUND/);
    assert.match(await render(receiptsPage, {}), /Extra payment receipts/);
    assert.ok(!(await render(salePage)).includes("Item list"), "the Item list link is for ADMIN only");
    admin();
    assert.match(await render(itemsPage), /Extra payment items/);
    assert.ok((await render(salePage)).includes("Item list"));
    assert.match(await render(receiptsPage, {}), /Cancel/);
  });
});
