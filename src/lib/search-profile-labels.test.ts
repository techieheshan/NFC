import { dbSkip, enrol, freezeClock, makeCourse, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * Job 5: the two line-item views that list payments — the Search page's payments tab and the student
 * profile's payment history — say "(Half month)" / "(No charge)" on such a line, in the words the
 * receipts use, and NOTHING on a full-fee row (so for today's data both are byte-identical: the golden
 * master in reports-golden.test.ts proves that). Label text only: no amount, count or total changes.
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

  test("PROFILE: the payment history says the same, and the amounts and billing months are untouched", async () => {
    const p = (await profile.loadStudentProfile(studentId))!;
    const classRows = p.payments.filter((x) => x.kind === "CLASS").sort((a, b) => a.id - b.id);
    assert.deepEqual(classRows.map((x) => [x.billing, x.course, x.amount, x.cancelled]), [
      ["Nov 2026", courseName, "2500.00", false],
      ["Oct 2026", `${courseName} (Half month)`, "1250.00", false],
      ["Sep 2026", `${courseName} (No charge)`, "0.00", false],
      ["Aug 2026", `${courseName} (Half month)`, "1250.00", true],
    ]);
    for (const x of p.payments.filter((y) => y.kind !== "CLASS")) assert.equal(x.course, null);
  });

  test("the label never touches who is searched for: searching by the course text still finds nothing by the suffix", async () => {
    assert.deepEqual(await search.searchPayments({ student: "(Half month)" }), []);
  });
});
