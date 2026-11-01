import { dbSkip, enrol, freezeClock, makeCourse, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";

/*
 * Job 5: the two line-item views that list payments. The Search page's payments tab appends
 * "(Half month)" / "(No charge)" to the course text, in the words the receipts use. The student profile (review
 * F6) keeps the course text plain and carries the mode as its own `mode` field, shown as its own small
 * non-truncated label after the course span — a long course name cannot cut it off. Both say NOTHING on a
 * full-fee row (so for today's data both are byte-identical: the golden master in reports-golden.test.ts proves
 * that for the data, and the render test below for the markup). Label text only: no amount, count or total changes.
 */

const NOW = "2026-11-10T06:00:00Z";
const SINCE = "2026-05-05T06:00:00Z";
const NOV = { year: 2026, month: 11 }, OCT = { year: 2026, month: 10 }, SEP = { year: 2026, month: 9 }, AUG = { year: 2026, month: 8 };

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let pay: typeof import("@/app/(app)/payment/actions");
let rec: typeof import("@/app/(app)/receipts/actions");
let search: typeof import("@/lib/search");
let profile: typeof import("@/lib/student-profile");

describe("Half month / No charge labels in Search and the student profile", { skip: dbSkip }, () => {
  let studentId: number;
  let courseName: string;
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    pay = await import("@/app/(app)/payment/actions");
    rec = await import("@/app/(app)/receipts/actions");
    search = await import("@/lib/search");
    profile = await import("@/lib/student-profile");
    w = await seedWorld(db, { admissionFee: "1300", smartCardFee: "500" });
    const course = await makeCourse(db, w, { teacherId: (await makeTeacher(db)).id, fee: "2500", name: "LabelCourse" });
    const s = await db.student.create({ data: { name: "Label Kid", cardNumber: "LBL-0001", cardUid: "UIDLBL1" } });
    studentId = s.id;
    await enrol(db, { studentId: s.id, courseId: course.id, tierId: w.tiers.FULL.id, since: SINCE });
    setSession("ADMIN", w.admin.id);
    const take = async (months: { year: number; month: number; mode?: "FULL" | "HALF" | "NO_CHARGE" }[], extra: { admission?: boolean; smartCard?: boolean } = {}) => {
      const res = await pay.takePayment({ studentId: s.id, admission: extra.admission ?? false, smartCard: extra.smartCard ?? false, comboDecisions: [], classMonths: months.map((m) => ({ courseId: course.id, ...m })) });
      assert.equal(res.ok, true, JSON.stringify(res));
    };
    await take([{ ...NOV }], { admission: true, smartCard: true }); // full fee + admission + smart card
    await take([{ ...OCT, mode: "HALF" }]);
    await take([{ ...SEP, mode: "NO_CHARGE" }]);
    await take([{ ...AUG, mode: "HALF" }]); // cancelled below
    const f = new FormData();
    f.set("key", `ref:${(await db.payment.findFirstOrThrow({ where: { studentId, billingMonth: 8 } })).transactionRef}`);
    f.set("reason", "test");
    assert.deepEqual(await rec.cancelTransaction({ ok: false }, f), { ok: true });
    courseName = (await search.searchPayments({ student: "LBL-0001" })).find((h) => h.kind === "CLASS")!.course!.replace(/ \((Half month|No charge)\)$/, "");
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  test("SEARCH: the course text carries (Half month) / (No charge) — a full-fee row, an admission and a smart card carry nothing", async () => {
    const hits = await search.searchPayments({ student: "LBL-0001", includeCancelled: true });
    const classHits = hits.filter((h) => h.kind === "CLASS").sort((a, b) => a.id - b.id); // Nov, Oct, Sep, Aug (written in that order)
    assert.deepEqual(classHits.map((h) => h.course), [courseName, `${courseName} (Half month)`, `${courseName} (No charge)`, `${courseName} (Half month)`]);
    assert.deepEqual(classHits.map((h) => h.amount), ["2500.00", "1250.00", "0.00", "1250.00"]); // amounts untouched
    for (const h of hits.filter((x) => x.kind !== "CLASS")) assert.equal(h.course, null);
    assert.deepEqual(classHits.map((h) => h.cancelled), [false, false, false, true]);
  });

  test("PROFILE: the course text stays PLAIN, the mode is its own field (absent on a full-fee row), and amounts and billing months are untouched", async () => {
    const p = (await profile.loadStudentProfile(studentId))!;
    const classRows = p.payments.filter((x) => x.kind === "CLASS").sort((a, b) => a.id - b.id);
    assert.deepEqual(classRows.map((x) => [x.billing, x.course, x.amount, x.cancelled, x.mode]), [
      ["Nov 2026", courseName, "2500.00", false, undefined],
      ["Oct 2026", courseName, "1250.00", false, "HALF"],
      ["Sep 2026", courseName, "0.00", false, "NO_CHARGE"],
      ["Aug 2026", courseName, "1250.00", true, "HALF"],
    ]);
    for (const x of p.payments) assert.equal("mode" in x, x.mode !== undefined, "the key is absent, not undefined, on a full-fee row");
    assert.deepEqual(Object.keys(classRows[0]), ["id", "kind", "date", "amount", "course", "billing", "cancelled"], "a full-fee row has exactly its old keys");
    for (const x of p.payments.filter((y) => y.kind !== "CLASS")) assert.equal(x.course, null);
  });

  test("PROFILE PAGE: a full-fee row renders EXACTLY as before; a Half / No-charge row gets its own non-truncated label after the course span", async () => {
    setSession("ADMIN", w.admin.id);
    const { default: Page } = await import("@/app/(app)/students/[id]/page");
    const out = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: String(studentId) }) } as never));
    const items = out.split("<li ").filter((x) => x.includes("shrink-0 text-right") && x.includes("CLASS"));
    const byBilling = (b: string) => items.find((x) => x.includes(`>${b}<`))!;
    const COURSE = `<span class="text-muted-foreground block truncate">${courseName}</span>`;

    // a full-fee row: the course span is followed directly by the end of its cell — nothing added
    const full = byBilling("Nov 2026");
    assert.ok(full.includes(`${COURSE}</span><span class="shrink-0 text-right">`), "no element between the course span and the amount cell");
    assert.ok(!/Half month|No charge/.test(full));

    const label = (word: string) => `${COURSE}<span class="block text-xs font-medium text-[#4C1D95]">${word}</span></span><span class="shrink-0 text-right">`;
    assert.ok(byBilling("Oct 2026").includes(label("Half month")));
    assert.ok(byBilling("Sep 2026").includes(label("No charge")));
    assert.ok(byBilling("Aug 2026").includes(label("Half month")), "a cancelled Half month keeps its label (and its Cancelled chip)");
    for (const b of ["Oct 2026", "Sep 2026"]) {
      assert.ok(!/\((Half month|No charge)\)/.test(byBilling(b)), "the course text carries no bracketed suffix any more");
      assert.ok(!/truncate[^>]*>(Half month|No charge)/.test(byBilling(b)), "the label itself is not truncated");
    }
  });

  test("the label never touches who is searched for: searching by the course text still finds nothing by the suffix", async () => {
    assert.deepEqual(await search.searchPayments({ student: "(Half month)" }), []);
  });
});
