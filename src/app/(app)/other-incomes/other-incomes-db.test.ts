import { dbSkip, freezeClock, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * Other incomes against a real (throw-away) database: who may do what (replayed with every role and no session — AGENTS 10 and 29;
 * the proof is the action's own refusal and an unchanged database), what a good entry writes, what is refused, cancel (never a delete),
 * and the Daily Summary read helper (cash in the drawer, bank apart, cancelled in neither). No Payment row is ever written.
 */

const NOW = "2026-11-16T06:00:00Z"; // 11:30 in Colombo, 16 Nov
const TODAY = "2026-11-16";

type Actions = typeof import("./actions");
type Helper = typeof import("@/lib/daily-summary-other-in");
let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let A: Actions;
let H: Helper;
let teacherId: string;
let cat: number;

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const none = { ok: false } as const;

describe("other incomes (database)", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    A = await import("./actions");
    H = await import("@/lib/daily-summary-other-in");
    w = await seedWorld(db);
    teacherId = (await db.user.create({ data: { username: "teacher-oi", passwordHash: "x", role: "TEACHER" } })).id;
    cat = (await db.incomeCategory.findFirstOrThrow({ where: { code: "DONATION" } })).id;
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  const entry = (o: Record<string, string> = {}) =>
    form({ categoryId: String(cat), amount: "1,000.00", date: TODAY, source: "A friend", note: "", method: "CASH", receivedById: w.staff.id, ...o });
  const counts = async () => ({ incomes: await db.otherIncome.count(), categories: await db.incomeCategory.count(), payments: await db.payment.count() });

  test("the migration's starter categories are there as data, all active", async () => {
    const rows = await db.incomeCategory.findMany({ orderBy: { code: "asc" } });
    assert.deepEqual(rows.map((r) => r.code), ["DONATION", "EQUIPMENT_SALE", "OTHER", "RENT", "SPONSORSHIP", "SUPPLIER_REFUND"]);
    assert.ok(rows.every((r) => r.active));
  });

  test("createIncome: TEACHER and no session are refused with nothing written; ADMIN and STAFF are served", async () => {
    for (const [role, id] of [["TEACHER", teacherId], [null, "nobody"]] as const) {
      setSession(role, id);
      const before = await counts();
      await assert.rejects(() => A.createIncome(none, entry()), (e: Error) => e.message === "Not authorised");
      assert.deepEqual(await counts(), before);
    }
    for (const [role, id] of [["ADMIN", w.admin.id], ["STAFF", w.staff.id]] as const) {
      setSession(role, id);
      const r = await A.createIncome(none, entry({ amount: "10.00" }));
      assert.equal(r.ok, true, `${role}: ${r.error}`);
    }
  });

  test("the reads are guarded too: a TEACHER cannot list incomes, categories or receivers", async () => {
    setSession("TEACHER", teacherId);
    await assert.rejects(() => A.listIncomes(), /Not authorised/);
    await assert.rejects(() => A.listActiveCategories(), /Not authorised/);
    await assert.rejects(() => A.listReceivers(), /Not authorised/);
    await assert.rejects(() => A.getIncome(1), /Not authorised/);
    setSession("STAFF", w.staff.id);
    assert.ok((await A.listIncomes()).length >= 2);
    assert.equal((await A.listActiveCategories()).length, 6);
    await assert.rejects(() => A.listAllCategories(), /Not authorised/); // the management list is ADMIN only
  });

  test("a good entry writes exactly what was typed; the recorder is the session, not the form", async () => {
    setSession("STAFF", w.staff.id);
    const r = await A.createIncome(none, entry({ amount: "1,250.50", date: "2026-11-14", source: "  Mr Perera ", note: " roof ", receivedById: w.admin.id }));
    assert.equal(r.ok, true);
    const row = await db.otherIncome.findFirstOrThrow({ where: { source: "Mr Perera" }, include: { category: true } });
    assert.equal(row.amount.toFixed(2), "1250.50");
    assert.equal(row.date.toISOString().slice(0, 10), "2026-11-14");
    assert.equal(row.note, "roof");
    assert.equal(row.method, "CASH");
    assert.equal(row.receivedById, w.admin.id);
    assert.equal(row.recordedById, w.staff.id);
    assert.equal(row.cancelled, false);
    assert.equal(row.category.code, "DONATION");
  });

  test("a refused entry writes nothing and echoes what was typed (rule 14)", async () => {
    setSession("STAFF", w.staff.id);
    const before = await counts();
    const retired = await db.incomeCategory.create({ data: { code: "OLD", label: "Old", active: false } });
    const gone = await db.user.create({ data: { username: "left-oi", passwordHash: "x", role: "STAFF", active: false } });
    const cases: [string, Record<string, string>][] = [
      ["amount zero", { amount: "0" }],
      ["amount junk", { amount: "12x" }],
      ["a future date", { date: "2026-11-17" }],
      ["an impossible date", { date: "2026-02-30" }],
      ["a retired category", { categoryId: String(retired.id) }],
      ["a category that does not exist", { categoryId: "99999" }],
      ["a deactivated receiver", { receivedById: gone.id }],
      ["a TEACHER as receiver", { receivedById: teacherId }],
      ["a receiver that does not exist", { receivedById: "nobody-here" }],
      ["a method that is not one", { method: "CHEQUE" }],
    ];
    for (const [name, o] of cases) {
      const r = await A.createIncome(none, entry({ source: "typed-and-kept", ...o }));
      assert.equal(r.ok, false, name);
      assert.ok(r.error, name);
      assert.equal(r.values?.source, "typed-and-kept", `${name}: the form values come back`);
    }
    // the only rows added are the two helper rows above (a category and a user); no income and no payment
    assert.equal((await counts()).incomes, before.incomes);
    assert.equal((await counts()).payments, before.payments);
  });

  test("cancelIncome: STAFF is refused (and nothing changes); ADMIN cancels; the row stays and is never deleted", async () => {
    setSession("STAFF", w.staff.id);
    await A.createIncome(none, entry({ amount: "77.00", source: "to-cancel" }));
    const row = await db.otherIncome.findFirstOrThrow({ where: { source: "to-cancel" } });

    await assert.rejects(() => A.cancelIncome(none, form({ id: String(row.id), reason: "typed twice" })), (e: Error) => e.message === "Not authorised");
    assert.equal((await db.otherIncome.findUniqueOrThrow({ where: { id: row.id } })).cancelled, false);

    setSession("ADMIN", w.admin.id);
    assert.equal((await A.cancelIncome(none, form({ id: String(row.id), reason: "ab" }))).ok, false, "a short reason is refused");
    assert.equal((await A.cancelIncome(none, form({ id: String(row.id), reason: "typed twice" }))).ok, true);
    const after = await db.otherIncome.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.cancelled, true);
    assert.equal(after.cancelledById, w.admin.id);
    assert.equal(after.cancelReason, "typed twice");
    assert.ok(after.cancelledAt);
    assert.equal(after.amount.toFixed(2), "77.00", "the amount is never touched");

    const again = await A.cancelIncome(none, form({ id: String(row.id), reason: "typed twice" }));
    assert.equal(again.ok, false);
    assert.equal(again.error, "That income is already cancelled.");
    assert.equal((await A.cancelIncome(none, form({ id: "999999", reason: "typed twice" }))).error, "That income could not be found.");
    assert.equal((await A.cancelIncome(none, form({ id: "abc", reason: "typed twice" }))).ok, false);
  });

  test("categories: ADMIN only; a name is unique; a retired category leaves old incomes readable and cannot be picked", async () => {
    setSession("STAFF", w.staff.id);
    for (const fn of [A.createCategory, A.renameCategory, A.setCategoryActive]) {
      await assert.rejects(() => fn(none, form({ label: "Prize money", id: "1", active: "false" })), (e: Error) => e.message === "Not authorised");
    }
    setSession("ADMIN", w.admin.id);
    assert.equal((await A.createCategory(none, form({ label: "Prize money" }))).ok, true);
    assert.equal((await db.incomeCategory.findFirstOrThrow({ where: { label: "Prize money" } })).code, "PRIZE_MONEY");
    assert.equal((await A.createCategory(none, form({ label: "prize MONEY" }))).error, "A category with that name already exists.");
    assert.equal((await A.createCategory(none, form({ label: "x" }))).ok, false);

    const donation = await db.incomeCategory.findFirstOrThrow({ where: { code: "DONATION" } });
    assert.equal((await A.renameCategory(none, form({ id: String(donation.id), label: "Gifts" }))).ok, true);
    const renamed = await db.incomeCategory.findUniqueOrThrow({ where: { id: donation.id } });
    assert.equal(renamed.label, "Gifts");
    assert.equal(renamed.code, "DONATION", "the code never changes");
    assert.equal((await A.renameCategory(none, form({ id: String(donation.id), label: "rent received" }))).error, "A category with that name already exists.");

    // retire: old rows still list with the category's name; staff can no longer pick it
    assert.equal((await A.setCategoryActive(none, form({ id: String(donation.id), active: "false" }))).ok, true);
    setSession("STAFF", w.staff.id);
    assert.ok(!(await A.listActiveCategories()).some((c) => c.id === donation.id));
    assert.ok((await A.listIncomes()).some((r) => r.categoryId === donation.id && r.categoryLabel === "Gifts"));
    assert.equal((await A.createIncome(none, entry())).ok, false, "a retired category is refused");
    setSession("ADMIN", w.admin.id);
    assert.equal((await A.setCategoryActive(none, form({ id: String(donation.id), active: "true" }))).ok, true);
  });

  test("listIncomes: a date range, a category filter, and junk in the query is ignored", async () => {
    setSession("STAFF", w.staff.id);
    const all = await A.listIncomes({ from: "2026-11-01", to: "2026-11-30" });
    assert.ok(all.length >= 3);
    const oneDay = await A.listIncomes({ from: "2026-11-14", to: "2026-11-14" });
    assert.ok(oneDay.length >= 1 && oneDay.every((r) => r.date === "2026-11-14"));
    const swapped = await A.listIncomes({ from: "2026-11-30", to: "2026-11-01" });
    assert.equal(swapped.length, all.length, "a reversed range is read as the same range");
    const junk = await A.listIncomes({ from: "banana", to: "2026-99-99", category: "x" });
    assert.ok(junk.length >= 1, "junk dates fall back to this month, not an empty page or a crash");
    const byCat = await A.listIncomes({ from: "2026-11-01", to: "2026-11-30", category: String(cat) });
    assert.ok(byCat.every((r) => r.categoryId === cat));
    assert.equal(await A.getIncome(0), null);
    assert.equal(await A.getIncome(987654), null);
  });

  test("the Daily Summary helper: cash and bank apart, cancelled in neither, nothing for a day with none", async () => {
    setSession("ADMIN", w.admin.id);
    const day = "2026-10-20";
    const empty = await H.otherInFor(day, day);
    assert.deepEqual(empty, H.NO_OTHER_IN, "a day with no other income returns nothing at all");

    for (const [amount, method, source] of [["100.00", "CASH", "c1"], ["25.50", "CASH", "c2"], ["900.00", "BANK", "b1"], ["5.00", "CASH", "gone"]] as const) {
      await A.createIncome(none, entry({ amount, method, source, date: day }));
    }
    const gone = await db.otherIncome.findFirstOrThrow({ where: { source: "gone" } });
    await A.cancelIncome(none, form({ id: String(gone.id), reason: "wrong day" }));

    const got = await H.otherInFor(day, day);
    assert.equal(got.cash, 12550);
    assert.equal(got.bank, 90000);
    assert.deepEqual(got.rows.map((r) => r.source), ["c1", "c2", "b1"], "oldest first, the cancelled row is absent");
    assert.ok(got.rows.every((r) => r.date === day));

    const prev = await H.otherInFor("2026-10-19", "2026-10-19");
    assert.deepEqual(prev, H.NO_OTHER_IN, "a neighbouring day does not see it");
    const wide = await H.otherInFor("2026-10-01", "2026-10-31");
    assert.equal(wide.cash, 12550);
    assert.deepEqual([...H.otherInByDay(wide)], [[day, { cash: 12550, bank: 90000 }]]);
  });

  test("an income never writes a Payment row, a receipt or a student link", async () => {
    assert.equal(await db.payment.count(), 0);
  });
});
