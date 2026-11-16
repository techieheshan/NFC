import { dbSkip, freezeClock, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient, UserRole } from "@prisma/client";

import { colomboDateValue } from "@/lib/colombo-time";

/*
 * The three other-income screens, RENDERED against a real (throw-away) database with made-up data. A refusal is proven by what comes
 * back (AGENTS 30), never a status code: the page throws NEXT_NOT_FOUND (the stub for `notFound()`), and the data is simply absent.
 */

const NOW = "2026-11-16T06:00:00Z";
const TODAY = "2026-11-16";

type Q = Record<string, string | string[] | undefined>;
let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let listPage: unknown;
let categoriesPage: unknown;
let voucherPage: unknown;
let teacherId: string;
let cancelledId: number;
let liveId: number;

const as = (role: UserRole | null, id = "nobody") => setSession(role, id);
const render = async (P: unknown, props: Record<string, unknown>) =>
  renderToStaticMarkup((await (P as (a: Record<string, unknown>) => Promise<React.ReactElement>)(props)) as React.ReactElement);
const list = (q: Q = {}) => render(listPage, { searchParams: Promise.resolve(q) });
const voucher = (id: string) => render(voucherPage, { params: Promise.resolve({ id }) });
const plain = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/<!-- -->/g, "");

describe("other incomes screens (rendered)", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    ({ default: listPage } = await import("./page"));
    ({ default: categoriesPage } = await import("./categories/page"));
    ({ default: voucherPage } = await import("./[id]/voucher/page"));
    w = await seedWorld(db);
    teacherId = (await db.user.create({ data: { username: "teacher-pg", passwordHash: "x", role: "TEACHER" } })).id;
    const cat = await db.incomeCategory.findFirstOrThrow({ where: { code: "RENT" } });
    const base = { categoryId: cat.id, date: colomboDateValue(TODAY), receivedById: w.staff.id, recordedById: w.staff.id };
    liveId = (await db.otherIncome.create({ data: { ...base, amount: "12500.00", source: "Mr Silva", note: "garage rent" } })).id;
    await db.otherIncome.create({ data: { ...base, amount: "40000.00", method: "BANK", source: "Trust" } });
    cancelledId = (
      await db.otherIncome.create({
        data: { ...base, amount: "999.00", source: "typed twice", cancelled: true, cancelledById: w.admin.id, cancelledAt: new Date(), cancelReason: "entered twice" },
      })
    ).id;
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  test("a TEACHER and a visitor get not-found on every screen, and none of the data", async () => {
    for (const [role, id] of [["TEACHER", teacherId], [null, "nobody"]] as const) {
      as(role, id);
      await assert.rejects(() => list(), /NEXT_NOT_FOUND/);
      await assert.rejects(() => render(categoriesPage, {}), /NEXT_NOT_FOUND/);
      await assert.rejects(() => voucher(String(liveId)), /NEXT_NOT_FOUND/);
    }
  });

  test("STAFF sees the list with the right cash and bank figures; the cancelled row is shown cancelled and counted nowhere", async () => {
    as("STAFF", w.staff.id);
    const h = plain(await list());
    assert.match(h, /Other incomes/);
    assert.match(h, /garage rent/);
    assert.match(h, /Cancelled/);
    assert.match(h, /Cash in the drawer<\/p><p[^>]*>12,500\.00</);
    assert.match(h, /Bank \(not in the drawer\)<\/p><p[^>]*>40,000\.00</);
    assert.ok(!h.includes("Cancel income"), "the cancel dialog is not open");
  });

  test("the Cancel button is for ADMIN only; STAFF never gets one; the categories link too", async () => {
    as("STAFF", w.staff.id);
    const staffHtml = plain(await list());
    assert.ok(!/>Cancel<\/button>/.test(staffHtml) && !staffHtml.includes("Categories"));
    as("ADMIN", w.admin.id);
    const adminHtml = plain(await list());
    assert.match(adminHtml, /Cancel<\/button>/);
    assert.match(adminHtml, /Categories/);
    // a cancelled row has no Cancel button of its own: one button per live row (two live rows)
    assert.equal((adminHtml.match(/>Cancel<\/button>/g) ?? []).length, 2);
  });

  test("a mark that tells cash from bank is an icon AND a word", async () => {
    as("STAFF", w.staff.id);
    const h = plain(await list());
    assert.match(h, /<svg[^>]*aria-hidden[^>]*>[\s\S]*?<\/svg>Cash/);
    assert.match(h, /<svg[^>]*aria-hidden[^>]*>[\s\S]*?<\/svg>Bank</);
  });

  test("junk in the query string is ignored: the list still renders this month", async () => {
    as("STAFF", w.staff.id);
    const h = plain(await list({ from: "banana", to: "2026-99-99", category: "x" }));
    assert.match(h, /garage rent/);
    const none = plain(await list({ from: "2026-01-01", to: "2026-01-31" }));
    assert.match(none, /No other income in this period\./);
    assert.ok(!none.includes("garage rent"));
  });

  test("the categories screen is ADMIN only: STAFF gets not-found and sees no names", async () => {
    as("STAFF", w.staff.id);
    await assert.rejects(() => render(categoriesPage, {}), /NEXT_NOT_FOUND/);
    as("ADMIN", w.admin.id);
    const h = plain(await render(categoriesPage, {}));
    assert.match(h, /Income categories/);
    assert.match(h, /Equipment sale/);
  });

  test("the voucher: its own IN- number, the amount, and a plain CANCELLED mark on a cancelled income; junk ids are not-found", async () => {
    as("STAFF", w.staff.id);
    const h = plain(await voucher(String(liveId)));
    assert.match(h, new RegExp(`IN-${liveId}`));
    assert.match(h, /12,500\.00/);
    assert.match(h, /Money received/);
    assert.ok(!/XN-/.test(h));
    const c = plain(await voucher(String(cancelledId)));
    assert.match(c, /CANCELLED/);
    assert.match(c, /entered twice/);
    for (const bad of ["0", "abc", "-4", "9999999", "1.5"]) await assert.rejects(() => voucher(bad), /NEXT_NOT_FOUND/, bad);
  });
});
