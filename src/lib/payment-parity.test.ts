import { dbSkip, enrol, freezeClock, makeCombo, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

import { chargeCoursesFrom, chargeInput, chargeTotal, monthKey, touchedComboIds, type ChargeCourse } from "@/lib/payment-charge";

/*
 * Job 2 safety check: the NEW screen must show the same totals as the OLD one for the
 * same student and selection, and must submit exactly what the old one submits.
 *
 * The old screen keeps its logic inline in a client component, so it cannot be imported.
 * `old*` below are LABELLED REFERENCE COPIES of payment-screen.tsx (the total at lines
 * 168-187, selectedClassMonths at 189-199, the touched-combo queue at 227-247). If that
 * file changes, these copies are the thing to update — and the comparison is what tells
 * you the two screens drifted.
 *
 * Every case is also run through the REAL takePayment, so the total each screen shows is
 * checked against what the server actually charged.
 */

const NOW = "2026-11-10T06:00:00Z";
const SINCE = "2026-08-05T06:00:00Z";
const NOV = { year: 2026, month: 11 };

type Panel = Extract<Awaited<ReturnType<typeof import("@/app/(app)/payment/actions").loadPanel>>, { status: "ok" }>["panel"];
type Decision = { comboId: number; apply: boolean; reason?: string };

// ---- reference copies of the OLD screen --------------------------------------------------------
const oldKey = (courseId: number, year: number, month: number) => `${courseId}:${year}:${month}`;

function oldTotal(panel: Panel, admission: boolean, smartCard: boolean, selected: Set<string>, decisions: Decision[]) {
  let sum = 0;
  if (admission) sum += Number(panel.admission.amount);
  if (smartCard) sum += Number(panel.smartCard.amount);
  for (const c of panel.courses) {
    if (c.free || !c.monthly) continue;
    const applied = c.comboId !== null && decisions.some((d) => d.comboId === c.comboId && d.apply);
    const unit = Number(applied && c.comboMonthly ? c.comboMonthly : c.monthly);
    for (const m of c.months) {
      if (selected.has(oldKey(c.courseId, m.year, m.month))) sum += unit;
    }
  }
  return sum;
}

const oldClassMonths = (panel: Panel, selected: Set<string>) =>
  panel.courses.flatMap((c) =>
    c.free
      ? []
      : c.months
          .filter((m) => selected.has(oldKey(c.courseId, m.year, m.month)))
          .map((m) => ({ courseId: c.courseId, year: m.year, month: m.month })),
  );

function oldTouchedQueue(panel: Panel, selected: Set<string>) {
  const touched = new Set(
    oldClassMonths(panel, selected)
      .map((m) => panel.courses.find((c) => c.courseId === m.courseId)?.comboId)
      .filter((v): v is number => v !== null && v !== undefined),
  );
  return panel.combos.filter((c) => touched.has(c.comboId)).map((c) => c.comboId);
}

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let pay: typeof import("@/app/(app)/payment/actions");
let view: typeof import("@/lib/payment-view");

describe("new screen vs old screen: same totals, same input, same charge", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    pay = await import("@/app/(app)/payment/actions");
    view = await import("@/lib/payment-view");
    w = await seedWorld(db, { admissionFee: "1300", smartCardFee: "500" });
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------
  type CourseSpec = { fee: string; tier?: "FULL" | "HALF" | "FREE"; since?: string };
  async function world(specs: CourseSpec[], opts: { combo?: { items: string[] } } = {}) {
    const teacher = await makeTeacher(db);
    const courses = [];
    for (const s of specs) courses.push(await makeCourse(db, w, { teacherId: teacher.id, fee: s.fee, name: `P${Math.random().toString(36).slice(2, 6)}` }));
    const student = await makeStudent(db);
    for (const [i, c] of courses.entries()) await enrol(db, { studentId: student.id, courseId: c.id, tierId: w.tiers[specs[i].tier ?? "FULL"].id, since: specs[i].since ?? SINCE });
    const combo = opts.combo ? await makeCombo(db, { teacherId: teacher.id, items: courses.map((c, i) => ({ courseId: c.id, fee: opts.combo!.items[i] })) }) : null;
    return { student, courses, combo };
  }
  async function both(studentId: number) {
    setSession("ADMIN", w.admin.id);
    const res = await pay.loadPanel({ studentId });
    assert.equal(res.status, "ok");
    const panel = (res as { panel: Panel }).panel;
    const v = await view.buildPaymentView(panel);
    const charge: ChargeCourse[] = chargeCoursesFrom(v.courses);
    return { panel, v, charge };
  }

  /** One scenario: compare both screens' totals and input, then charge for real. */
  async function scenario(o: {
    studentId: number;
    picks: { courseId: number; year: number; month: number }[];
    admission?: boolean;
    smartCard?: boolean;
    decisions?: Decision[];
  }) {
    const { panel, v, charge } = await both(o.studentId);
    const admission = o.admission ?? false;
    const smartCard = o.smartCard ?? false;
    const decisions = o.decisions ?? [];
    const selected = new Set(o.picks.map((p) => monthKey(p.courseId, p.year, p.month)));

    // The two screens' course lists line up one for one (same order, same prices).
    assert.deepEqual(v.courses.map((c) => [c.courseId, c.monthly, c.comboMonthly, c.comboId, c.free]), panel.courses.map((c) => [c.courseId, c.monthly, c.comboMonthly, c.comboId, c.free]));

    // 1. Totals — before any combo answer, and after the answers.
    const before = { old: oldTotal(panel, admission, smartCard, selected, []), neu: chargeTotal({ admission, smartCard, admissionAmount: v.admission.amount, smartCardAmount: v.smartCard.amount, courses: charge, selected, decisions: [] }) };
    assert.equal(before.neu, before.old, "total before the combo answer");
    const after = { old: oldTotal(panel, admission, smartCard, selected, decisions), neu: chargeTotal({ admission, smartCard, admissionAmount: v.admission.amount, smartCardAmount: v.smartCard.amount, courses: charge, selected, decisions }) };
    assert.equal(after.neu, after.old, "total after the combo answer");

    // 2. Which combos are asked about.
    assert.deepEqual(touchedComboIds(charge, selected).sort(), oldTouchedQueue(panel, selected).sort(), "combo pop-ups asked");

    // 3. The takePayment input — identical, key for key.
    const oldInput = { studentId: panel.student.id, admission, smartCard, classMonths: oldClassMonths(panel, selected), comboDecisions: decisions };
    const newInput = chargeInput({ studentId: v.student.id, admission, smartCard, courses: charge, selected, comboDecisions: decisions });
    assert.deepEqual(newInput, oldInput, "takePayment input");
    assert.equal(JSON.stringify(newInput), JSON.stringify(oldInput), "same keys in the same order, byte for byte");

    // 4. What the server actually charges is what the screen showed.
    setSession("ADMIN", w.admin.id);
    const res = await pay.takePayment(newInput);
    assert.equal(res.ok, true, JSON.stringify(res));
    const receipt = (res as Extract<typeof res, { ok: true }>).receipt;
    assert.equal(receipt.total, after.neu.toFixed(2), "server total == the new screen's total");
    return { total: receipt.total, lines: receipt.lines.length };
  }

  // ---- the listed cases ---------------------------------------------------------------------

  test("one class", async () => {
    const { student, courses } = await world([{ fee: "2500" }]);
    const r = await scenario({ studentId: student.id, picks: [{ courseId: courses[0].id, ...NOV }] });
    assert.equal(r.total, "2500.00");
  });

  test("two classes", async () => {
    const { student, courses } = await world([{ fee: "2500" }, { fee: "1800" }]);
    const r = await scenario({ studentId: student.id, picks: courses.map((c) => ({ courseId: c.id, ...NOV })) });
    assert.equal(r.total, "4300.00");
  });

  test("a combo, accepted", async () => {
    const { student, courses, combo } = await world([{ fee: "2500" }, { fee: "1700" }], { combo: { items: ["2000", "1300"] } });
    const r = await scenario({ studentId: student.id, picks: courses.map((c) => ({ courseId: c.id, ...NOV })), decisions: [{ comboId: combo!.id, apply: true }] });
    assert.equal(r.total, "3300.00");
  });

  test("a combo, refused with a reason", async () => {
    const { student, courses, combo } = await world([{ fee: "2500" }, { fee: "1700" }], { combo: { items: ["2000", "1300"] } });
    const r = await scenario({ studentId: student.id, picks: courses.map((c) => ({ courseId: c.id, ...NOV })), decisions: [{ comboId: combo!.id, apply: false, reason: "did not attend" }] });
    assert.equal(r.total, "4200.00");
  });

  test("a half-tier student (and a half-tier combo)", async () => {
    const half = await world([{ fee: "2500", tier: "HALF" }]);
    assert.equal((await scenario({ studentId: half.student.id, picks: [{ courseId: half.courses[0].id, ...NOV }] })).total, "1250.00");
    const combo = await world([{ fee: "2500", tier: "HALF" }, { fee: "1700", tier: "HALF" }], { combo: { items: ["2000", "1300"] } });
    const r = await scenario({ studentId: combo.student.id, picks: combo.courses.map((c) => ({ courseId: c.id, ...NOV })), decisions: [{ comboId: combo.combo!.id, apply: true }] });
    assert.equal(r.total, "1650.00");
  });

  test("a free student: a free course adds nothing and is never sent; the paid one beside it is", async () => {
    const { student, courses } = await world([{ fee: "1200", tier: "FREE" }, { fee: "2500" }]);
    const { v } = await both(student.id);
    assert.equal(v.courses[0].free, true);
    // Even if the free course's key were selected, neither screen counts or sends it.
    const r = await scenario({ studentId: student.id, picks: [{ courseId: courses[0].id, ...NOV }, { courseId: courses[1].id, ...NOV }] });
    assert.equal(r.total, "2500.00");
    assert.equal(r.lines, 1);
  });

  test("admission unpaid (alone, and with a class and the smart card)", async () => {
    const a = await world([{ fee: "2500" }]);
    assert.equal((await scenario({ studentId: a.student.id, picks: [], admission: true })).total, "1300.00");
    const b = await world([{ fee: "2500" }]);
    const r = await scenario({ studentId: b.student.id, picks: [{ courseId: b.courses[0].id, ...NOV }], admission: true, smartCard: true });
    assert.equal(r.total, "4300.00");
  });

  test("an owed earlier month: the card's month, and two months at once", async () => {
    const { student, courses } = await world([{ fee: "2500" }]); // enrolled Aug; Aug..Oct owed
    const { v } = await both(student.id);
    assert.equal(v.courses[0].cardMonth?.label, "Aug 2026");
    const r = await scenario({
      studentId: student.id,
      picks: [{ courseId: courses[0].id, year: 2026, month: 8 }, { courseId: courses[0].id, year: 2026, month: 10 }],
    });
    assert.equal(r.total, "5000.00");
  });

  test("the card month the NEW screen picks for a tap is a month the OLD panel also offers (when inside its window)", async () => {
    const { student } = await world([{ fee: "2500" }]);
    const { panel, v } = await both(student.id);
    const card = v.courses[0].cardMonth!;
    assert.ok(panel.courses[0].months.some((m) => m.year === card.year && m.month === card.month));
  });

  test("float totals match to the last digit (1333.33 + 10.15 + 1250.05)", async () => {
    const { student, courses } = await world([{ fee: "1333.33" }, { fee: "10.15" }, { fee: "1250.05" }]);
    await scenario({ studentId: student.id, picks: courses.map((c) => ({ courseId: c.id, ...NOV })) });
  });

  test("a months-ahead and a three-month catch-up in one checkout", async () => {
    const { student, courses } = await world([{ fee: "2500" }]);
    const picks = [8, 9, 10, 11, 12].map((month) => ({ courseId: courses[0].id, year: 2026, month }));
    const r = await scenario({ studentId: student.id, picks });
    assert.equal(r.total, "12500.00");
  });
});
