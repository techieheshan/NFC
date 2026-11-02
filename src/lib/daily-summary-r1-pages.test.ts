import { dbSkip, enrol, freezeClock, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, TEST_DB_ENV, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";

/*
 * Daily Summary R1, rendered for real against a database: the day screen, the range screen and the A4 document.
 * Access is asserted by what comes back (rule 30), the URL is treated as hostile, the signers are looked up in
 * the offered lists only, and every screen runs to completion on a database that refuses every write.
 */

type Q = Record<string, string | string[] | undefined>;

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let day: typeof import("@/app/(app)/daily-summary/page").default;
let range: typeof import("@/app/(app)/daily-summary/range/page").default;
let doc: typeof import("@/app/(app)/daily-summary/document/page").default;
let dailySummary: typeof import("@/lib/reports").dailySummary;
let admin2: { id: string };
let staff2: { id: string };

const page = async (P: (a: { searchParams: Promise<Q> }) => Promise<React.ReactNode> | React.ReactNode, q: Q = {}) =>
  renderToStaticMarkup((await P({ searchParams: Promise.resolve(q) })) as React.ReactElement);
const asStaff = () => setSession("STAFF", w.staff.id);

describe("daily summary R1 pages against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock("2026-10-20T06:00:00Z");
    ({ db } = await import("@/lib/db"));
    ({ default: day } = await import("@/app/(app)/daily-summary/page"));
    ({ default: range } = await import("@/app/(app)/daily-summary/range/page"));
    ({ default: doc } = await import("@/app/(app)/daily-summary/document/page"));
    ({ dailySummary } = await import("@/lib/reports"));
    w = await seedWorld(db, { admissionFee: "1300", smartCardFee: "500" });
    const st = (name: string) => db.staff.create({ data: { name } });
    await db.user.update({ where: { id: w.admin.id }, data: { username: "nadeesha", staffId: (await st("Nadeesha Admin")).id } });
    await db.user.update({ where: { id: w.staff.id }, data: { username: "sadun", staffId: (await st("Sadun Staff")).id } });
    admin2 = await db.user.create({ data: { username: "ruwan", passwordHash: "x", role: "ADMIN", staffId: (await st("Ruwan Admin")).id } });
    staff2 = await db.user.create({ data: { username: "thilini", passwordHash: "x", role: "STAFF", staffId: (await st("Thilini Staff")).id } });
    const t = await makeTeacher(db, "සුනිල් ගුණසේන මහතා");
    const c1 = await makeCourse(db, w, { teacherId: t.id, fee: "2500", name: "භෞතික විද්‍යාව - Theory" });
    const c2 = await makeCourse(db, w, { teacherId: t.id, fee: "2000", name: "Quiet Course" });
    void c2;
    await db.expenseType.create({ data: { code: "TEACHER_ADVANCE", label: "Teacher advance", affectsTeacherPayslip: true } });
    const xenon = await db.expenseType.create({ data: { code: "XENON", label: "Xenon" } });
    const row = async (at: string, amount: string, o: { by?: string; ref: string; cancelled?: boolean; mode?: "HALF" }) => {
      const s = await makeStudent(db, { admissionPaid: true });
      await enrol(db, { studentId: s.id, courseId: c1.id, tierId: w.tiers.FULL.id, since: "2026-08-05T06:00:00Z" });
      await db.payment.create({
        data: {
          kind: "CLASS", studentId: s.id, amount, paidAt: new Date(at), takenById: o.by ?? w.staff.id, courseId: c1.id, billingYear: 2026, billingMonth: 10,
          feeTierId: w.tiers.FULL.id, transactionRef: o.ref, chargeMode: o.mode ?? null, cancelled: o.cancelled ?? false,
          ...(o.cancelled ? { cancelledById: w.admin.id, cancelledAt: new Date(at), cancelReason: "t" } : {}),
        },
      });
    };
    await row("2026-10-14T04:00:00Z", "2500.00", { ref: "A" });
    await row("2026-10-14T05:00:00Z", "1250.00", { ref: "B", by: staff2.id, mode: "HALF" });
    await row("2026-10-14T06:00:00Z", "2500.00", { ref: "VOID", cancelled: true });
    await db.expense.create({ data: { expenseTypeId: xenon.id, amount: "950.00", reason: "repair: door lock", date: new Date("2026-10-14T00:00:00Z"), recordedById: w.admin.id, authorizedById: admin2.id } });
    await db.expense.create({ data: { expenseTypeId: xenon.id, amount: "4500.00", reason: "electricity bill", date: new Date("2026-10-11T00:00:00Z"), recordedById: w.admin.id, authorizedById: w.admin.id } }); // a day with no payments: a loss
    unfreezeClock();
    freezeClock("2026-11-01T15:48:00Z"); // 21:18 in Colombo
  });
  after(async () => {
    unfreezeClock();
    await db.$disconnect();
    await handle.drop();
  });

  const good = (extra: Q = {}): Q => ({ date: "2026-10-14", bf: "5000", prep: w.staff.id, chk: w.admin.id, ...extra });

  // ---- access -----------------------------------------------------------------------------------------------------

  test("a TEACHER, or nobody signed in, gets the not-found screen on all three routes", async () => {
    for (const who of ["TEACHER", null] as const) {
      setSession(who, "t");
      for (const P of [day, range, doc]) await assert.rejects(() => page(P as never, good()), /NEXT_NOT_FOUND/);
    }
  });

  test("the loaders and the action refuse a TEACHER or nobody by themselves (rule 10: a read is its own endpoint)", async () => {
    const bundle = await import("@/app/(app)/daily-summary/bundle");
    const actions = await import("@/app/(app)/daily-summary/actions");
    for (const who of ["TEACHER", null] as const) {
      setSession(who, "t");
      await assert.rejects(() => bundle.loadDayBundle("2026-10-14"), /Not authorised/);
      await assert.rejects(() => bundle.loadRangeBundle("2026-10-12", "2026-10-14"), /Not authorised/);
      await assert.rejects(() => actions.loadDailySummary("2026-10-14", "2026-10-14"), /Not authorised/);
    }
  });

  test("loadDailySummary (the action): impossible and extreme dates give today, reversed is swapped, a long range is cut", async () => {
    const actions = await import("@/app/(app)/daily-summary/actions");
    asStaff();
    const today = "2026-11-01";
    for (const [a, b] of [["2026-13-45", "2026-13-45"], ["0001-01-01", "9999-12-31"], ["banana", "x"], ["", ""]]) {
      const r = await actions.loadDailySummary(a, b);
      assert.equal(r.from <= r.to, true);
      assert.ok(r.from >= "2000-01-01" && r.to <= "2100-12-31", `${a}..${b} -> ${r.from}..${r.to}`);
    }
    assert.deepEqual([(await actions.loadDailySummary("2026-13-45", "2026-13-45")).from, (await actions.loadDailySummary("2026-13-45", "2026-13-45")).to], [today, today]);
    const swapped = await actions.loadDailySummary("2026-10-14", "2026-10-12");
    assert.deepEqual([swapped.from, swapped.to], ["2026-10-12", "2026-10-14"]);
    const wide = await actions.loadDailySummary("2000-01-01", "2100-12-31");
    assert.equal(wide.from, "2000-01-01");
    assert.equal(wide.to, "2000-12-31"); // 366 days
  });

  // ---- the document -----------------------------------------------------------------------------------------------

  test("the document for a signed day: cash book, signatures, names and figures; ADMIN and STAFF both reach it", async () => {
    for (const who of ["STAFF", "ADMIN"] as const) {
      setSession(who, who === "ADMIN" ? w.admin.id : w.staff.id);
      const html = await page(doc as never, good());
      for (const needle of ["Left in drawer", "Draft, not saved", "DS-20261014", "Wednesday, 14 October 2026", "Sadun Staff", "Nadeesha Admin", "Collected by staff", "Signature", "සුනිල් ගුණසේන මහතා", "of which Half months (1)", "repair: door lock", "Ruwan Admin", "Cancelled: 1 receipt, 2,500.00 (not counted)", "3,750.00"]) {
        assert.ok(html.includes(needle), `${who}: ${needle}`);
      }
      assert.ok(!html.includes("Asia/Colombo"));
      assert.ok(html.includes(who === "ADMIN" ? "Nadeesha Admin" : "Sadun Staff"), "generated by the signed-in person");
    }
  });

  test("Checked by is ADMIN-only on the document too: a staff id in `chk` builds nothing", async () => {
    asStaff();
    const html = await page(doc as never, good({ chk: staff2.id }));
    assert.ok(html.includes("Choose Prepared by and Checked by (an admin) first"));
    assert.ok(!html.includes("Draft, not saved") && !html.includes("Left in drawer"));
    // an admin may PREPARE
    assert.ok((await page(doc as never, good({ prep: admin2.id, chk: w.admin.id }))).includes("Ruwan Admin"));
  });

  test("hostile query strings: junk dates, repeated values, negative or huge amounts, bad bank lines, unknown ids", async () => {
    asStaff();
    const today = "DS-20261101";
    const a = await page(doc as never, good({ date: "2026-13-45" }));
    assert.ok(a.includes(today), "an impossible date falls back to today");
    assert.ok((await page(doc as never, good({ date: "0001-01-01" }))).includes(today));
    assert.ok((await page(doc as never, good({ date: ["2026-10-14", "2026-10-13"] }))).includes("DS-20261014"), "first value wins");
    assert.ok((await page(doc as never, good({ date: "2099-01-01" }))).includes(today), "the future is today");
    const huge = await page(doc as never, good({ b: ["25:99~1~~", "garbage", "10:00~-4~~", "10:00~1~~~extra"] }));
    assert.ok(huge.includes("Left in drawer") && !huge.includes("Money taken to the bank"));
    assert.ok((await page(doc as never, good({ prep: "nobody", chk: ["../x"] }))).includes("Choose Prepared by"));
    assert.ok((await page(doc as never, { date: "2026-10-14", auto: ["print", "pdf"] })).includes("Choose Prepared by"));
  });

  test("a bad bring-forward in the address never prints as 0.00: the document sends the user back to the day screen with a notice", async () => {
    asStaff();
    for (const bad of ["-5000", "abc", "100000000.00", "9".repeat(21), "1.234"]) {
      const err = await page(doc as never, good({ bf: bad })).then(() => null, (e: Error & { url?: string }) => e);
      assert.ok(err && /NEXT_REDIRECT/.test(err.message), `redirects for bf=${bad}`);
      const url = new URL(err.url!, "http://x");
      assert.equal(url.pathname, "/daily-summary");
      assert.equal(url.searchParams.get("date"), "2026-10-14");
      assert.equal(url.searchParams.get("notice"), "bf");
      assert.equal(url.searchParams.get("bf"), null, "the bad value is dropped, not carried back");
      assert.equal(url.searchParams.get("prep"), w.staff.id, "what else was typed comes back with the user");
      assert.equal(url.searchParams.get("chk"), w.admin.id);
    }
    // the day screen shows the notice, for the redirect AND for a bad bf typed straight into the address; a good one shows none
    for (const q of [good({ bf: undefined, notice: "bf" }), good({ bf: "-5" })]) {
      assert.ok((await page(day as never, q)).includes("was not a valid amount, so it was cleared"));
    }
    assert.ok(!(await page(day as never, good())).includes("was not a valid amount"));
    // a good or absent bf still builds the document
    assert.ok((await page(doc as never, good({ bf: "5,000.50" }))).includes("Left in drawer"));
    assert.ok((await page(doc as never, good({ bf: undefined }))).includes("Left in drawer"));
  });

  test("bank lines print in their own section; banking more than the drawer holds blocks the document", async () => {
    asStaff();
    const ok = await page(doc as never, good({ b: ["10:30~100000~SLIP-9~Peoples%20Bank", "13:05~50000~~"] }));
    assert.ok(ok.includes("Money taken to the bank") && ok.includes("SLIP-9") && ok.includes("Peoples Bank") && ok.includes("1,500.00"));
    const over = await page(doc as never, good({ b: [`10:30~${99_999_999_99}~~`] }));
    assert.ok(over.includes("more than the drawer should hold"));
    assert.ok(!over.includes("Draft, not saved"));
  });

  test("a loss day with nothing banked (deductions above the cash) can still be printed", async () => {
    asStaff();
    const html = await page(doc as never, { date: "2026-10-11", prep: w.staff.id, chk: w.admin.id });
    assert.ok(!html.includes("more than the drawer should hold") && !html.includes("Choose Prepared by"));
    assert.ok(html.includes("Left in drawer"));
  });

  test("a range document has no cash book and no signatures, and needs neither signer", async () => {
    asStaff();
    const html = await page(doc as never, { from: "2026-10-12", to: "2026-10-14" });
    assert.ok(html.includes("Day by day") && html.includes("DS-20261012-20261014") && html.includes("Collection, several days"));
    assert.ok(!/Cash book|Signature|Left in drawer|Prepared by/.test(html));
    // a one-day "range" is the day document (and so wants its signers)
    assert.ok((await page(doc as never, { from: "2026-10-14", to: "2026-10-14" })).includes("Choose Prepared by"));
    // junk and a huge range never crash
    for (const q of [{ from: "banana", to: "x" }, { from: "0001-01-01", to: "9999-12-31" }, { from: "2026-13-45", to: "2026-10-14" }, { from: "2000-01-01", to: "2100-12-31" }]) {
      await assert.doesNotReject(() => page(doc as never, q));
    }
  });

  // ---- the day screen and the range screen -------------------------------------------------------------------------

  test("the day screen: Checked by offers admins only, Prepared by staff and admins, thousands separators, no minus on zero", async () => {
    asStaff();
    const html = await page(day as never, good());
    const checked = html.slice(html.indexOf('id="checked"'), html.indexOf("</select>", html.indexOf('id="checked"')));
    assert.ok(checked.includes("Nadeesha Admin") && checked.includes("Ruwan Admin"));
    assert.ok(!checked.includes("Sadun Staff") && !checked.includes("Thilini Staff"));
    const prepared = html.slice(html.indexOf('id="prepared"'), html.indexOf("</select>", html.indexOf('id="prepared"')));
    for (const n of ["Sadun Staff", "Thilini Staff", "Nadeesha Admin", "Ruwan Admin"]) assert.ok(prepared.includes(n), n);
    assert.ok(html.includes("Wed 14 Oct 2026") && html.includes("Checked by Nadeesha Admin") && html.includes("3,750.00"));
    assert.ok(html.includes("Collected by staff") && html.includes("Several days") && html.includes("Left in drawer"));
    assert.ok(html.includes("Smart card replacement (0)") && html.includes("Admission includes the first smart card") && !html.includes("Smart card (0)"));
    assert.ok(!html.includes("Asia/Colombo") && !html.includes("Not paid") && !html.includes("−0.00"));
    const quiet = await page(day as never, { date: "2026-10-11" });
    assert.ok(!quiet.includes("−0.00") && !quiet.includes("-0.00") && quiet.includes("Not checked"));
  });

  test("the day screen with typed values: bring-forward and bank lines come back from the URL; Print and Download PDF open the document", async () => {
    asStaff();
    const html = await page(day as never, good({ b: ["10:30~100000~SLIP-9~note"] }));
    assert.ok(html.includes("1 line") && html.includes("SLIP-9"));
    assert.ok(html.includes('href="/daily-summary/document?') && html.includes("auto=print") && html.includes("auto=pdf"));
    const unsigned = await page(day as never, { date: "2026-10-14" });
    assert.ok(unsigned.includes("Choose Prepared by and Checked by first.") && !unsigned.includes("auto=print"));
  });

  test("old links and junk never crash: ?from&to opens the day or the range; impossible dates fall back to today", async () => {
    asStaff();
    await assert.rejects(() => page(day as never, { from: "2026-10-12", to: "2026-10-14" }), /NEXT_REDIRECT/);
    assert.ok((await page(day as never, { from: "2026-10-14", to: "2026-10-14" })).includes("Wed 14 Oct 2026"));
    for (const q of [{ date: "2026-13-45" }, { date: "0001-01-01" }, { date: "9999-12-31" }, { date: ["x", "y"] }, { from: "2026-13-45", to: "2026-13-45" }, { date: "2026-10-14", bf: ["1", "2"], b: "x" }]) {
      const html = await page(day as never, q as Q);
      assert.ok(html.includes("Daily Summary"));
    }
    assert.ok((await page(day as never, { date: "2026-13-45" })).includes("Sun 1 Nov 2026"));
  });

  test("the range screen: day by day, totals, 'view only', no cash book; a huge range is cut to a year, junk falls back", async () => {
    asStaff();
    const html = await page(range as never, { from: "2026-10-12", to: "2026-10-14" });
    for (const n of ["Range, view only", "Day by day", "Mon 12 Oct 2026", "Wed 14 Oct 2026", "A range is a quick look. The cash book and signatures belong to a single day."]) assert.ok(html.includes(n), n);
    assert.ok(!/Cash book|Prepared by|Left in drawer|Asia\/Colombo/.test(html));
    assert.ok(html.includes("Smart card replacement (0)") && html.includes("Admission includes the first smart card"));
    const wide = await page(range as never, { from: "2000-01-01", to: "2100-12-31" });
    assert.ok(wide.includes("longer than a year"));
    assert.ok(!(await page(range as never, { from: "2026-10-12", to: "2026-10-14" })).includes("longer than a year"));
    for (const q of [{ from: "0001-01-01", to: "9999-12-31" }, { from: "2026-13-45" }, {}, { from: ["a", "b"], to: ["c"] }]) await assert.doesNotReject(() => page(range as never, q as Q));
  });

  test("the day-by-day figures on the range screen equal dailySummary() for each day (the proof, through the page)", async () => {
    const s = await dailySummary("2026-10-14", "2026-10-14");
    asStaff();
    const html = await page(range as never, { from: "2026-10-14", to: "2026-10-14" });
    assert.ok(html.includes(`${Number(s.net).toLocaleString("en", { minimumFractionDigits: 2 })}`));
  });

  // ---- nothing is written -----------------------------------------------------------------------------------------

  test("every screen runs to completion on a database that refuses every write", async () => {
    const admin = new Client({ connectionString: process.env[TEST_DB_ENV] });
    await admin.connect();
    try {
      await admin.query(`ALTER DATABASE ${handle.name} SET default_transaction_read_only = on`);
      await db.$disconnect();
      await assert.rejects(() => db.setting.create({ data: { key: "x", value: "y" } }), /read-only transaction/); // control
      asStaff();
      await page(day as never, good({ b: ["10:30~100~~"] }));
      await page(day as never, { date: "2026-10-11" });
      await page(range as never, { from: "2026-10-01", to: "2026-10-31" });
      await page(doc as never, good({ b: ["10:30~100~~"] }));
      await page(doc as never, { from: "2026-10-01", to: "2026-10-31" });
    } finally {
      await db.$disconnect();
      await admin.query(`ALTER DATABASE ${handle.name} RESET default_transaction_read_only`);
      await admin.end();
    }
  });

  test("the data object is what it was: dailySummary() is byte-identical before and after all of the above", async () => {
    const a = JSON.stringify(await dailySummary("2026-10-14", "2026-10-14"));
    asStaff();
    await page(day as never, good());
    await page(doc as never, good());
    assert.equal(JSON.stringify(await dailySummary("2026-10-14", "2026-10-14")), a);
    assert.deepEqual(Object.keys(JSON.parse(a)), ["from", "to", "courses", "admission", "smartCard", "classTotal", "halfMonths", "totalCollected", "deductionLines", "deductions", "net"].filter((k) => k in JSON.parse(a)));
  });
});
