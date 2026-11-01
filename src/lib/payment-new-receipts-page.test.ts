import { dbSkip, enrol, freezeClock, makeCourse, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";

/*
 * Job 4: the /payment-new/receipts page, rendered for real against a real database. Refusals are
 * asserted by CONTENT (AGENTS rule 30): a refused role gets the not-found screen and none of the
 * receipts. The page is ADMIN only through the one PAYMENT_NEW_ROLES constant; the FLIP test shows
 * the page follows it.
 */

const BASE = Date.parse("2026-11-10T04:00:00Z");
const SINCE = "2026-05-05T06:00:00Z";

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let Page: typeof import("@/app/(app)/payment-new/receipts/page").default;
let access: typeof import("@/app/(app)/payment-new/access");
let pay: typeof import("@/app/(app)/payment/actions");
let course: { id: number };

const html = async (q?: string) =>
  renderToStaticMarkup(await Page({ searchParams: Promise.resolve(q === undefined ? {} : { q }) }));

describe("the /payment-new/receipts page against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(new Date(BASE).toISOString());
    ({ db } = await import("@/lib/db"));
    ({ default: Page } = await import("@/app/(app)/payment-new/receipts/page"));
    access = await import("@/app/(app)/payment-new/access");
    pay = await import("@/app/(app)/payment/actions");
    w = await seedWorld(db, { admissionFee: "1300", smartCardFee: "500" });
    course = await makeCourse(db, w, { teacherId: (await makeTeacher(db)).id, fee: "2500", name: "PageCourse" });
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });
  beforeEach(async () => {
    await db.payment.deleteMany({});
    await db.enrollment.deleteMany({});
    await db.student.deleteMany({});
    setSession("ADMIN", w.admin.id);
  });

  let minute = 0;
  let k = 0;
  async function student(name: string, card: string) {
    const s = await db.student.create({ data: { name, cardNumber: card, cardUid: `UIDP${++k}${Math.random().toString(16).slice(2, 8)}`.toUpperCase() } });
    await enrol(db, { studentId: s.id, courseId: course.id, tierId: w.tiers.FULL.id, since: SINCE });
    return s;
  }
  async function pays(studentId: number, month: number, o: { admission?: boolean; mode?: "NO_CHARGE" | "HALF" } = {}) {
    freezeClock(new Date(BASE + ++minute * 60_000).toISOString());
    setSession("ADMIN", w.admin.id);
    const res = await pay.takePayment({
      studentId, admission: o.admission ?? false, smartCard: false, comboDecisions: [],
      classMonths: [{ courseId: course.id, year: 2026, month, mode: o.mode }],
    });
    assert.equal(res.ok, true, JSON.stringify(res));
    return (res as Extract<typeof res, { ok: true }>).receipt;
  }
  /** `n` single-line receipts written directly, one minute apart (volume, not rules). */
  async function many(studentId: number, n: number) {
    for (let i = 0; i < n; i++) {
      await db.payment.create({ data: { kind: "CLASS", studentId, courseId: course.id, billingYear: 2018 + Math.floor(i / 12), billingMonth: (i % 12) + 1, amount: "100.00", takenById: w.admin.id, paidAt: new Date(BASE + (500 + i) * 60_000), transactionRef: randomUUID() } });
    }
  }
  const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

  // ---- who may open it ------------------------------------------------------------------------------

  test("STAFF, TEACHER and a signed-out visitor get the not-found screen and NONE of the receipts (asserted by content)", async () => {
    const s = await student("Secret Kid", "SEC-0001");
    await pays(s.id, 11);
    for (const role of ["STAFF", "TEACHER", null] as const) { // FLIP: STAFF moves to the allowed list
      setSession(role, role === "STAFF" ? w.staff.id : "x");
      let content = "";
      await assert.rejects(async () => { content = await html(); }, { message: "NEXT_NOT_FOUND" }, String(role));
      assert.equal(content, "");
      await assert.rejects(() => Page({ searchParams: Promise.resolve({ q: "secret" }) }), { message: "NEXT_NOT_FOUND" }, `${role} with a search`);
    }
  });

  test("ADMIN gets the page with the receipts", async () => {
    const s = await student("Open Kid", "OPN-0001");
    const r = await pays(s.id, 11);
    const out = await html();
    assert.ok(out.includes(r.reference));
    assert.ok(out.includes("Open Kid · OPN-0001"));
  });

  test("the page follows the one constant: with STAFF added to PAYMENT_NEW_ROLES, STAFF opens it too (the menu switch)", async () => {
    const s = await student("Switch Kid", "SWI-0001");
    await pays(s.id, 11);
    const original = [...access.PAYMENT_NEW_ROLES];
    try {
      access.PAYMENT_NEW_ROLES.push("STAFF");
      setSession("STAFF", w.staff.id);
      assert.ok((await html()).includes("Switch Kid"));
      setSession("TEACHER");
      await assert.rejects(() => html(), { message: "NEXT_NOT_FOUND" });
    } finally {
      access.PAYMENT_NEW_ROLES.splice(0, access.PAYMENT_NEW_ROLES.length, ...original);
    }
    setSession("STAFF", w.staff.id);
    await assert.rejects(() => html(), { message: "NEXT_NOT_FOUND" });
  });

  // ---- what it shows -------------------------------------------------------------------------------

  test("the list: header, back to Start, search field, caption, a row per receipt with Reprint — and no Cancel", async () => {
    const a = await student("Nimal Perera", "0186-0001-2000");
    const b = await student("Heshan Silva", "0186-0002-2000");
    const r1 = await pays(a.id, 11);
    const r2 = await pays(b.id, 10, { admission: true }); // two lines
    setSession("ADMIN", w.admin.id);
    const out = await html();
    assert.ok(out.includes("Receipts"));
    assert.match(out, /<a [^>]*href="\/payment-new"[^>]*aria-label="Back to Start"|<a [^>]*aria-label="Back to Start"[^>]*href="\/payment-new"/);
    assert.match(out, /<form [^>]*action="\/payment-new\/receipts"/);
    assert.match(out, /<input [^>]*name="q"/);
    assert.ok(out.includes("Name, card number or receipt no."));
    assert.ok(out.includes("Last 10 receipts") && out.includes("Newest first"));
    assert.ok(out.indexOf(r2.reference) < out.indexOf(r1.reference), "newest first");
    assert.equal(count(out, /Reprint/g), 2);
    assert.ok(out.includes("2 lines") && !out.includes("1 lines"));
    assert.ok(out.includes("3800.00") && out.includes("2500.00"));
    assert.match(out, /Today 9:\d\d AM · taken by /, "today's receipts say Today, with the Colombo time");
    assert.ok(!/Cancel receipt|Cancel<|>Cancel</.test(out), "Cancel stays on the admin's Receipts page");
    assert.ok(!out.includes("Showing the latest"), "not capped, so no footer");
  });

  test("a cancelled receipt carries a red Cancelled chip (icon + word) and can still be reprinted; a no-charge receipt says No charge with 0.00", async () => {
    const s = await student("Chip Kid", "CHP-0001");
    const r1 = await pays(s.id, 11, { admission: true });
    const r2 = await pays(s.id, 10, { mode: "NO_CHARGE" });
    setSession("ADMIN", w.admin.id);
    const f = new FormData();
    f.set("key", `ref:${(await db.payment.findFirstOrThrow({ where: { studentId: s.id, kind: "ADMISSION" } })).transactionRef}`);
    f.set("reason", "wrong card");
    assert.deepEqual(await (await import("@/app/(app)/receipts/actions")).cancelTransaction({ ok: false }, f), { ok: true });
    const out = await html();
    assert.ok(out.includes(r1.reference) && out.includes(r2.reference));
    assert.equal(count(out, />Cancelled</g), 1, "one cancelled receipt, one chip");
    assert.match(out, /Cancelled<\/span>/);
    assert.match(out, /No charge<\/span>/);
    assert.ok(out.includes("0.00"));
    assert.equal(count(out, /Reprint/g), 2, "the cancelled one has Reprint too");
    assert.ok(out.includes("<svg"), "the chips carry an icon as well as the word");
  });

  test("an older receipt shows its date as '8 Nov 2026' (never 2026-11-08), taken by whom, at the Colombo time", async () => {
    const s = await student("Old Kid", "OLD-0001");
    const row = await db.payment.create({ data: { kind: "CLASS", studentId: s.id, courseId: course.id, billingYear: 2026, billingMonth: 8, amount: "2500.00", takenById: w.staff.id, paidAt: new Date("2026-11-08T10:15:00Z"), transactionRef: null } });
    const out = await html();
    assert.ok(out.includes(`XN-${row.id}`));
    assert.match(out, /8 Nov 2026 3:45 PM · taken by /);
    assert.ok(out.includes(w.staff.username));
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(out), "no raw ISO date on the page");
  });

  test("more than 10 receipts: the footer 'Showing the latest 10. Search to find older receipts.'; exactly 10: no footer", async () => {
    const s = await student("Many Kid", "MNY-0001");
    await many(s.id, 10);
    assert.ok(!(await html()).includes("Showing the latest"));
    await many(s.id, 1);
    const out = await html();
    assert.ok(out.includes("Showing the latest 10. Search to find older receipts."));
    assert.equal(count(out, /Reprint/g), 10);
  });

  test("no receipts yet", async () => {
    const out = await html();
    assert.ok(out.includes("No receipts yet."));
    assert.equal(count(out, /Reprint/g), 0);
  });

  // ---- searching -----------------------------------------------------------------------------------

  test("a search: the results replace the list, the field keeps the query, Clear goes back, and the count is stated", async () => {
    const a = await student("Nimal Perera", "0186-0001-2000");
    const b = await student("Heshan Silva", "0186-0002-2000");
    await pays(a.id, 11);
    await pays(b.id, 10);
    await pays(a.id, 10);
    const out = await html("nimal");
    assert.ok(out.includes("2 receipts found"));
    assert.ok(!out.includes("Last 10 receipts"));
    assert.ok(out.includes("Nimal Perera") && !out.includes("Heshan Silva"));
    assert.match(out, /<input [^>]*value="nimal"/);
    assert.match(out, /aria-label="Clear the search"/);
    assert.match(out, /href="\/payment-new\/receipts"[^>]*aria-label="Clear the search"|aria-label="Clear the search"[^>]*href="\/payment-new\/receipts"/);
    assert.ok(!(await html()).includes("Clear the search"), "no clear button while the field is empty");
  });

  test("a search by receipt number finds it; a middle row's number finds nothing and says so", async () => {
    const s = await student("Number Kid", "NUM-0001");
    const r = await pays(s.id, 11, { admission: true }); // two rows
    const ids = (await db.payment.findMany({ where: { studentId: s.id }, orderBy: { id: "asc" } })).map((x) => x.id);
    for (const q of [r.reference, r.reference.toLowerCase(), String(ids[0])]) {
      const out = await html(q);
      assert.ok(out.includes(r.reference) && out.includes("1 receipt found"), q);
    }
    const middle = await html(`XN-${ids[1]}`);
    assert.ok(middle.includes("No receipts found") && !middle.includes("Reprint"));
  });

  test("no result, and a query that is too short, each say so in plain words", async () => {
    const s = await student("Plain Kid", "PLN-0001");
    await pays(s.id, 11);
    const none = await html("zzzz-nobody");
    assert.ok(none.includes("No receipts found") && none.includes("0 receipts found"));
    const short = await html("p");
    assert.ok(short.includes("Type at least 2 letters of a name or card number, or a receipt number such as XN-1493."));
    assert.ok(!short.includes("Reprint"));
  });

  test("a search with more than 20 matches shows 20 and the footer to narrow it", async () => {
    const s = await student("Capped Kid", "CAP-0001");
    await many(s.id, 21);
    const out = await html("capped");
    assert.equal(count(out, /Reprint/g), 20);
    assert.ok(out.includes("20 receipts found"));
    assert.ok(out.includes("Showing the latest 20. Type more of the name or number to narrow it down."));
  });

  test("the query is taken as text: markup in it is escaped, and an absurd length is cut", async () => {
    const out = await html(`<script>alert(1)</script>${"x".repeat(300)}`);
    assert.ok(!out.includes("<script>alert(1)"));
    assert.ok(out.includes("&lt;script&gt;"));
    const value = /value="([^"]*)"/.exec(out)?.[1] ?? "";
    assert.ok(value.length <= 140, `value length ${value.length}`);
  });
});
