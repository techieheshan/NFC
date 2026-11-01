import { dbSkip, enrol, freezeClock, makeCourse, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * Job 5 review F2 (ACCEPTED, documented): when a Half-month line splits off a same-priced line, the sheet's
 * line columns can differ from its Totals row by a cent. Nothing in the payslip maths changed; this test pins
 * the exact numbers so the behaviour is known and cannot drift unnoticed. THE TOTALS ROW IS WHAT COUNTS.
 *
 * Course fee 1250, institute 25%. Two students pay 312.50 in the same month:
 *   - a QUARTER-tier student, normal month  (1250 x 0.25)
 *   - a HALF-tier student, a HALF MONTH     (1250 x 0.5 x 0.5)
 * The institute's cut of each is 78.125 and the teacher's 234.375: every slip rounds each half to 2 places.
 */

const NOW = "2026-11-10T06:00:00Z";
const SINCE = "2026-05-05T06:00:00Z";
const NOV = { year: 2026, month: 11 };

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let pay: typeof import("@/app/(app)/payment/actions");
let payslips: typeof import("@/lib/payslips");
let quarterId: number;

describe("a Half-month line split off a same-priced line: the exact rounding", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    pay = await import("@/app/(app)/payment/actions");
    payslips = await import("@/lib/payslips");
    w = await seedWorld(db);
    quarterId = (await db.feeTier.create({ data: { code: "QUARTER", label: "25%", multiplier: "0.250" } })).id;
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  let n = 0;
  async function slipFor(payers: { tier: "QUARTER" | "HALF"; mode?: "HALF" }[]) {
    const teacher = await makeTeacher(db, `Round T${++n}`);
    const course = await makeCourse(db, w, { teacherId: teacher.id, fee: "1250", share: "25.00", name: `Round${n}` });
    setSession("ADMIN", w.admin.id);
    for (const p of payers) {
      const s = await db.student.create({ data: { name: `Round Kid ${++n}`, cardNumber: `RND-${n}` } });
      await enrol(db, { studentId: s.id, courseId: course.id, tierId: p.tier === "QUARTER" ? quarterId : w.tiers.HALF.id, since: SINCE });
      const res = await pay.takePayment({ studentId: s.id, admission: false, smartCard: false, comboDecisions: [], classMonths: [{ courseId: course.id, ...NOV, mode: p.mode }] });
      assert.equal(res.ok, true, JSON.stringify(res));
    }
    return (await payslips.buildPayslips({ year: 2026, month: 11, teacherIds: [teacher.id], includeInstitute: false })).slips[0];
  }
  const cents = (xs: string[]) => xs.reduce((t, x) => t + Math.round(Number(x) * 100), 0);

  test("BEFORE the split (two normal payers at 312.50): one line, and the line columns equal the Totals row", async () => {
    const slip = await slipFor([{ tier: "QUARTER" }, { tier: "QUARTER" }]);
    assert.deepEqual(slip.lines.map((l) => [l.cards, l.rate, l.gross, l.instituteShare, l.teacherShare]), [[2, "312.50", "625.00", "156.25", "468.75"]]);
    assert.deepEqual([slip.totalCollected, slip.totalInstituteShare, slip.totalTeacherShare], ["625.00", "156.25", "468.75"]);
  });

  test("AFTER the split (a normal payer and a Half-month payer at 312.50): two lines, each share rounded on its own", async () => {
    const slip = await slipFor([{ tier: "QUARTER" }, { tier: "HALF", mode: "HALF" }]);
    assert.deepEqual(slip.lines.map((l) => [l.cards, l.rate, l.gross, l.instituteShare, l.teacherShare, l.halfMonth === true]), [
      [1, "312.50", "312.50", "78.13", "234.38", false], // 78.125 -> 78.13 and 234.375 -> 234.38
      [1, "312.50", "312.50", "78.13", "234.38", true],
    ]);
    // THE TOTALS ROW: computed per course from the whole amount, so it is exact
    assert.deepEqual([slip.totalCollected, slip.totalInstituteShare, slip.totalTeacherShare], ["625.00", "156.25", "468.75"]);
    assert.equal(slip.courses[0].instituteShare, "156.25");
    assert.equal(slip.courses[0].teacherShare, "468.75");
    // the known one-cent differences between the line columns and the Totals row
    assert.equal(cents(slip.lines.map((l) => l.instituteShare)), 15626, "the Institute column adds to 156.26, not 156.25");
    assert.equal(cents(slip.lines.map((l) => l.teacherShare)), 46876, "the Teacher column adds to 468.76, not 468.75");
    // what never differs: gross, cards x rate, and the payslip's own totals
    assert.equal(cents(slip.lines.map((l) => l.gross)), cents([slip.totalCollected]));
    for (const l of slip.lines) assert.equal((l.cards * Number(l.rate)).toFixed(2), l.gross);
    assert.equal(slip.lineCards, 2);
    assert.equal(slip.finalSalary, "468.75");
  });
});
