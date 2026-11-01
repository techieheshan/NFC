import { dbSkip, enrol, freezeClock, makeCourse, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";

/*
 * Job 5: /reports/half-no-charge, rendered for real. ADMIN only, and a refusal is asserted by CONTENT
 * (AGENTS rule 30): the not-found screen, none of the data. The Reports page's way in is the ADMIN's.
 */

const SINCE = "2025-12-05T06:00:00Z";

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let Page: typeof import("@/app/(app)/reports/half-no-charge/page").default;
let pay: typeof import("@/app/(app)/payment/actions");
let rec: typeof import("@/app/(app)/receipts/actions");
let course: { id: number };

const html = async (q: Record<string, string | string[] | undefined> = { month: "2026-11" }) =>
  renderToStaticMarkup(await Page({ searchParams: Promise.resolve(q) }));
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

describe("the /reports/half-no-charge page against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock("2026-11-10T06:00:00Z");
    ({ db } = await import("@/lib/db"));
    ({ default: Page } = await import("@/app/(app)/reports/half-no-charge/page"));
    pay = await import("@/app/(app)/payment/actions");
    rec = await import("@/app/(app)/receipts/actions");
    w = await seedWorld(db, { admissionFee: "1300", smartCardFee: "500" });
    course = await makeCourse(db, w, { teacherId: (await makeTeacher(db)).id, fee: "2500", name: "PageReview" });
    await db.staff.create({ data: { name: "Sadun Staff" } }).then((st) => db.user.update({ where: { id: w.staff.id }, data: { staffId: st.id } }));

    let k = 0;
    const take = async (who: "ADMIN" | "STAFF", at: string, mode?: "HALF" | "NO_CHARGE" | "FULL") => {
      freezeClock(at);
      setSession(who, who === "ADMIN" ? w.admin.id : w.staff.id);
      const s = await db.student.create({ data: { name: `Page Kid ${++k}`, cardNumber: `PG-${k}` } });
      await enrol(db, { studentId: s.id, courseId: course.id, tierId: w.tiers.FULL.id, since: SINCE });
      const res = await pay.takePayment({ studentId: s.id, admission: false, smartCard: false, comboDecisions: [], classMonths: [{ courseId: course.id, year: 2026, month: 11, mode }] });
      assert.equal(res.ok, true, JSON.stringify(res));
      return s;
    };
    await take("ADMIN", "2026-11-05T06:00:00Z");
    await take("ADMIN", "2026-11-05T07:00:00Z", "HALF");
    await take("STAFF", "2026-11-06T06:00:00Z");
    await take("STAFF", "2026-11-06T07:00:00Z", "NO_CHARGE");
    await take("STAFF", "2026-11-06T08:00:00Z", "HALF");
    const voided = await take("STAFF", "2026-11-06T09:00:00Z", "NO_CHARGE");
    setSession("ADMIN", w.admin.id);
    const f = new FormData();
    f.set("key", `ref:${(await db.payment.findFirstOrThrow({ where: { studentId: voided.id } })).transactionRef}`);
    f.set("reason", "test");
    assert.deepEqual(await rec.cancelTransaction({ ok: false }, f), { ok: true });
    freezeClock("2026-11-10T06:00:00Z");
    setSession("ADMIN", w.admin.id);
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  test("STAFF, TEACHER and a signed-out visitor get the not-found screen and NONE of the data (by content)", async () => {
    for (const role of [null, "TEACHER", "STAFF"] as const) {
      setSession(role, role === "STAFF" ? w.staff.id : "x");
      let content = "";
      await assert.rejects(async () => { content = await html(); }, { message: "NEXT_NOT_FOUND" }, String(role));
      assert.equal(content, "");
      await assert.rejects(() => Page({ searchParams: Promise.resolve({ month: "2026-11", staff: w.staff.id, mode: "half" }) }), { message: "NEXT_NOT_FOUND" }, `${role} with filters`);
    }
    setSession("ADMIN", w.admin.id);
    assert.ok((await html()).includes("Half and No-charge months"));
  });

  test("ADMIN sees the per-staff table (counts, Half amount, share of their months), the detail rows, and the filters", async () => {
    setSession("ADMIN", w.admin.id);
    const out = await html();
    assert.ok(out.includes("By staff — Nov 2026"));
    assert.ok(out.includes("Sadun Staff") && out.includes(w.admin.username));
    // staff: Half 1 (1250.00), No charge 1 (the second is cancelled), 3 months of 4 -> "2 of 3 (67%)"; admin: Half 1, 1 of 2 (50%)
    assert.match(out, /Sadun Staff<\/td><td[^>]*>1<\/td><td[^>]*>1250\.00<\/td><td[^>]*>1<\/td><td[^>]*>2 of 3 \(67%\)<\/td>/);
    assert.match(out, /Total<\/td><td[^>]*>2<\/td><td[^>]*>2500\.00<\/td><td[^>]*>1<\/td><td[^>]*>3 of 5<\/td>/);
    assert.match(out, /<form [^>]*method="get"[^>]*action="\/reports\/half-no-charge"|<form [^>]*action="\/reports\/half-no-charge"[^>]*method="get"/);
    for (const needle of ['name="month"', 'name="staff"', 'name="mode"', "Everyone", "Half months only", "No-charge months only"]) assert.ok(out.includes(needle), needle);
    assert.ok(out.includes("Counts and totals cover every row in this filter."));
    assert.ok(out.includes("no waived value is shown"));
  });

  test("the detail rows: mode chips with words, a Cancelled chip with the row greyed, receipt links, newest first", async () => {
    setSession("ADMIN", w.admin.id);
    const out = await html();
    assert.equal(count(out, /Half month<\/span>/g) >= 2, true);
    assert.equal(count(out, /No charge<\/span>/g) >= 2, true);
    assert.equal(count(out, />Cancelled<\/span>/g), 2, "one cancelled row, shown in the table and in the phone cards");
    assert.match(out, /href="\/receipts\?key=ref%3A[0-9a-f-]+&amp;cancelled=1"/);
    assert.ok(out.includes("1 cancelled row is shown greyed and counted nowhere."));
    assert.ok(out.includes("<svg"), "the chips carry an icon as well as the word");
    assert.match(out, /tabular-nums line-through">\d+\.\d\d<\/td>/, "a cancelled amount is struck through in the table");
    assert.match(out, /font-semibold tabular-nums line-through">\d+\.\d\d<\/span>/, "...and on the phone card");
    assert.ok(!out.includes("Showing the newest"), "not capped");
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(out.replace(/value="[^"]*"/g, "").replace(/href="[^"]*"/g, "")), "no raw ISO date for staff to read");
  });

  test("filters: staff and mode narrow the report; junk is ignored (not an empty report)", async () => {
    setSession("ADMIN", w.admin.id);
    const one = await html({ month: "2026-11", staff: w.staff.id });
    assert.ok(one.includes("Sadun Staff") && !new RegExp(`>${w.admin.username}</td>`).test(one));
    const half = await html({ month: "2026-11", mode: "half" });
    // a row's No-charge chip is an icon then the words; the totals line ("0 No charge") is not a chip
    assert.ok(/<\/svg>No charge<\/span>/.test(await html({ month: "2026-11" })), "control: both modes show a No-charge chip");
    assert.ok(!/<\/svg>No charge<\/span>/.test(half), "Half only: no No-charge row chip");
    assert.ok(/Half month<\/span>/.test(half));
    assert.match(half, /<option value="half" selected/);
    for (const junk of [{ month: "garbage" }, { month: "2026-13" }, { month: "2026-11", mode: "bogus", staff: "no-such-user" }]) {
      const out = await html(junk);
      assert.ok(out.includes("Half and No-charge months") && !out.includes("Nothing recorded in"), JSON.stringify(junk));
    }
    // an unknown month with nothing in it: the plain empty state
    assert.ok((await html({ month: "2026-03" })).includes("Nothing recorded in Mar 2026"));
  });

  test("more than 300 rows: the plain note, 300 rows listed, and the staff totals cover all of them", async () => {
    setSession("ADMIN", w.admin.id);
    const kid = await db.student.create({ data: { name: "Cap Kid", cardNumber: "CAP-1" } });
    await db.payment.createMany({
      data: Array.from({ length: 310 }, (_, i) => ({
        kind: "CLASS" as const, studentId: kid.id, courseId: course.id, billingYear: 2000 + Math.floor(i / 12), billingMonth: (i % 12) + 1,
        amount: "0.00", chargeMode: "NO_CHARGE" as const, takenById: w.admin.id, paidAt: new Date(Date.UTC(2027, 0, 3, 0, 0) + i * 60_000), transactionRef: randomUUID(),
      })),
    });
    const out = await html({ month: "2027-01" });
    assert.ok(out.includes("Showing the newest 300 of 310 rows. The counts and totals above cover all 310 non-cancelled rows."));
    assert.equal(count(out, /Cap Kid · CAP-1/g), 300, "300 phone cards (the table repeats the rows in cells)");
    assert.match(out, new RegExp(`${w.admin.username}</td><td[^>]*>0</td><td[^>]*>0\\.00</td><td[^>]*>310</td><td[^>]*>310 of 310 \\(100%\\)</td>`));
  });

  /** `n` rows in one month of 2027 for `takenById`, one minute apart from `from`, optionally cancelled. */
  async function volume(year: number, month: number, n: number, o: { cancelled?: boolean; startMinute?: number } = {}) {
    const kid = await db.student.create({ data: { name: `Vol Kid ${year}-${month}-${o.cancelled ? "c" : "l"}`, cardNumber: `VOL-${year}-${month}-${o.cancelled ? "c" : "l"}` } });
    await db.payment.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        kind: "CLASS" as const, studentId: kid.id, courseId: course.id, billingYear: 2000 + Math.floor(i / 12), billingMonth: (i % 12) + 1,
        amount: "0.00", chargeMode: "NO_CHARGE" as const, takenById: w.admin.id,
        paidAt: new Date(Date.UTC(year, month - 1, 3, 0, 0) + ((o.startMinute ?? 0) + i) * 60_000), transactionRef: randomUUID(),
        ...(o.cancelled ? { cancelled: true, cancelledById: w.admin.id, cancelledAt: new Date(Date.UTC(year, month - 1, 20)), cancelReason: "x" } : {}),
      })),
    });
  }

  test("the notes' WORDING, 305 live + 1 cancelled: 'newest 300 of 306', the counts cover 305, and the cancelled row (among the newest) is shown", async () => {
    setSession("ADMIN", w.admin.id);
    await volume(2027, 2, 305, { startMinute: 0 });
    await volume(2027, 2, 1, { cancelled: true, startMinute: 400 }); // the newest row of the month
    const out = await html({ month: "2027-02" });
    assert.ok(out.includes("Showing the newest 300 of 306 rows. The counts and totals above cover all 305 non-cancelled rows."));
    assert.ok(!out.includes("cover all 306"));
    assert.ok(out.includes("1 cancelled row is shown greyed and counted nowhere."));
    assert.match(out, /305 of 305 \(100%\)/, "the share column reads from the live rows only");
  });

  test("the notes' WORDING, cancelled rows BEYOND the cap: they are not said to be shown", async () => {
    setSession("ADMIN", w.admin.id);
    await volume(2027, 3, 4, { cancelled: true, startMinute: 0 }); // four old cancelled rows
    await volume(2027, 3, 300, { startMinute: 100 }); // 300 newer live rows fill the list
    const out = await html({ month: "2027-03" });
    assert.ok(out.includes("Showing the newest 300 of 304 rows. The counts and totals above cover all 300 non-cancelled rows."));
    assert.ok(out.includes("4 cancelled rows in this filter are older than the newest 300 and not shown; counted nowhere."));
    assert.ok(!/4 cancelled rows are shown greyed/.test(out));
    assert.ok(!out.includes(">Cancelled<"), "no cancelled row is in the list, so no Cancelled chip");
  });

  /** The `<form>` element of the page tree, with its React key. */
  type El = { type?: unknown; key?: string | null; props?: { children?: unknown } };
  function findForm(node: unknown): El | null {
    if (Array.isArray(node)) {
      for (const n of node) {
        const f = findForm(n);
        if (f) return f;
      }
      return null;
    }
    if (node && typeof node === "object") {
      const el = node as El;
      if (el.type === "form") return el;
      return findForm(el.props?.children);
    }
    return null;
  }
  const formKey = async (q: Record<string, string>) => findForm(await Page({ searchParams: Promise.resolve(q) }))?.key;

  test("F4: the filter form is keyed on month|person|kind, so 'This month' remounts it and the selects reset", async () => {
    setSession("ADMIN", w.admin.id);
    const filtered = await formKey({ month: "2026-11", staff: w.staff.id, mode: "half" });
    const reset = await formKey({}); // what the "This month" link (no query) renders
    assert.equal(filtered, `2026-11|${w.staff.id}|HALF`);
    assert.match(String(reset), /^\d{4}-\d{2}\|\|$/);
    assert.notEqual(filtered, reset, "a different signature: React remounts the form and the selects take their new defaults");
    // each part of the signature matters on its own
    const keys = new Set([
      await formKey({ month: "2026-11" }),
      await formKey({ month: "2026-10" }),
      await formKey({ month: "2026-11", mode: "half" }),
      await formKey({ month: "2026-11", mode: "nocharge" }),
      await formKey({ month: "2026-11", staff: w.staff.id }),
      await formKey({ month: "2026-11", staff: w.admin.id }),
    ]);
    assert.equal(keys.size, 6);
    // junk is ignored in the key too (it is built from the VALIDATED values)
    assert.equal(await formKey({ month: "2026-11", staff: "no-such-user", mode: "bogus" }), await formKey({ month: "2026-11" }));
  });

  test("the query is text: markup in a filter is not rendered", async () => {
    setSession("ADMIN", w.admin.id);
    const out = await html({ month: "2026-11", staff: "<script>alert(1)</script>", mode: "<b>" });
    assert.ok(!out.includes("<script>alert(1)"));
  });

  test("the Reports page links to it for the ADMIN only, and the menu has no new entry", () => {
    const reports = readFileSync(path.join(process.cwd(), "src", "app", "(app)", "reports", "page.tsx"), "utf8");
    assert.match(reports, /user\.role === "ADMIN" && \(\s*<Button[^>]*>\s*<Link href="\/reports\/half-no-charge">/);
    assert.equal(/half-no-charge/.test(readFileSync(path.join(process.cwd(), "src", "config", "nav.ts"), "utf8")), false);
    const page = readFileSync(path.join(process.cwd(), "src", "app", "(app)", "reports", "half-no-charge", "page.tsx"), "utf8");
    assert.match(page, /requireNavAccess\("\/reports"\)/);
    assert.match(page, /user\.role !== "ADMIN"\) notFound\(\)/);
  });
});
