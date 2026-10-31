import { attend, dbSkip, enrol, freezeClock, makeCombo, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

import type { PaymentMode } from "@/app/(app)/payment/actions";
import { friendlyDate } from "@/lib/friendly-date";
import {
  chargeCoursesFrom,
  chargeInput,
  chargeTotal,
  comboOffDecisions,
  comboQuestionIds,
  monthKey,
  type ChargeDecision,
} from "@/lib/payment-charge";

/*
 * Job 3B safety check: the Total the screen DISPLAYS equals the receipt total the real
 * takePayment returns, in every case that has a new feature — and the request the screen
 * builds is accepted as it stands.
 *
 * `screen()` below is the new screen's logic with the clicks taken out: it builds the view the
 * server gave the page, applies the staff's choices (month modes, combo switches) the way the
 * screen does, asks the combo pop-up only when the screen would, and produces the Total and the
 * takePayment input. Then the REAL takePayment is called with that input, and the totals are
 * compared. Clock frozen at 10 Nov 2026 (Colombo): the last completed month is October, "new"
 * means enrolled in November.
 */

const NOW = "2026-11-10T06:00:00Z";
const OLD = "2026-08-05T06:00:00Z";
const NEWER = "2026-11-03T06:00:00Z";

type Tier = "FULL" | "HALF" | "QUARTER" | "FREE";
type Spec = { since?: string; tier?: Tier; days?: number };
type Pick = { courseId: number; year?: number; month?: number; mode?: PaymentMode };
type Answer = "yes" | "no";

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let quarterId: number;
let pay: typeof import("@/app/(app)/payment/actions");
let view: typeof import("@/lib/payment-view");
let arrears: typeof import("@/lib/student-arrears");

describe("the new screen's Total equals the server's receipt total, end to end", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    pay = await import("@/app/(app)/payment/actions");
    view = await import("@/lib/payment-view");
    arrears = await import("@/lib/student-arrears");
    w = await seedWorld(db, { admissionFee: "1300", smartCardFee: "500" });
    quarterId = (await db.feeTier.create({ data: { code: "QUARTER", label: "Quarter", multiplier: "0.250" } })).id;
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------
  const tierId = (t: Tier) => (t === "QUARTER" ? quarterId : w.tiers[t].id);
  const rows = (studentId: number) => db.payment.findMany({ where: { studentId }, orderBy: { id: "asc" } });

  async function loadView(studentId: number) {
    setSession("ADMIN", w.admin.id);
    const res = await pay.loadPanel({ studentId });
    assert.equal(res.status, "ok");
    return view.buildPaymentView((res as Extract<typeof res, { status: "ok" }>).panel);
  }

  /** One course (2500) and a student on a tier. */
  async function single(tier: Tier = "FULL", fee = "2500") {
    const teacher = await makeTeacher(db);
    const course = await makeCourse(db, w, { teacherId: teacher.id, fee, name: `S${Math.random().toString(36).slice(2, 6)}` });
    const student = await makeStudent(db);
    await enrol(db, { studentId: student.id, courseId: course.id, tierId: tierId(tier), since: OLD });
    return { course, student };
  }
  /** Two combo classes (normal 2500 / 1700, combo 2000 / 1300) and a student enrolled in both. */
  async function comboPair(a: Spec, b: Spec) {
    const teacher = await makeTeacher(db);
    const ca = await makeCourse(db, w, { teacherId: teacher.id, fee: "2500", name: `CA${Math.random().toString(36).slice(2, 6)}` });
    const cb = await makeCourse(db, w, { teacherId: teacher.id, fee: "1700", name: `CB${Math.random().toString(36).slice(2, 6)}` });
    const combo = await makeCombo(db, { teacherId: teacher.id, items: [{ courseId: ca.id, fee: "2000" }, { courseId: cb.id, fee: "1300" }] });
    const student = await makeStudent(db);
    for (const [c, s] of [[ca, a], [cb, b]] as const) {
      await enrol(db, { studentId: student.id, courseId: c.id, tierId: tierId(s.tier ?? "FULL"), since: s.since ?? OLD });
      for (let d = 0; d < (s.days ?? 0); d++) await attend(db, { studentId: student.id, courseId: c.id, date: `2026-10-${String(5 + d * 7).padStart(2, "0")}`, markedById: w.admin.id });
    }
    return { ca, cb, combo, student };
  }

  /**
   * The screen, minus the clicks. Returns what it would DISPLAY and SEND.
   * `comboOff`: the combos staff switched off. `answer`: what staff tap in the pop-up, if it appears.
   */
  async function screen(studentId: number, o: { picks: Pick[]; admission?: boolean; smartCard?: boolean; comboOff?: number[]; answer?: Answer }) {
    const v = await loadView(studentId);
    const charge = chargeCoursesFrom(v.courses);
    const selected = new Map<string, PaymentMode>(
      o.picks.map((p) => [monthKey(p.courseId, p.year ?? 2026, p.month ?? 11), p.mode ?? "FULL"] as [string, PaymentMode]),
    );
    const comboOff = new Set(o.comboOff ?? []);
    const asked = comboQuestionIds(charge, selected, comboOff);
    const answers: ChargeDecision[] = asked.map((comboId) =>
      o.answer === "no" ? { comboId, apply: false, reason: "did not attend" } : { comboId, apply: true },
    );
    const decisions = [...comboOffDecisions(charge, selected, comboOff), ...answers];
    const common = { admission: o.admission ?? false, smartCard: o.smartCard ?? false, admissionAmount: v.admission.amount, smartCardAmount: v.smartCard.amount, courses: charge, selected, decisions, comboOff };
    const input = chargeInput({ studentId, admission: common.admission, smartCard: common.smartCard, courses: charge, selected, comboDecisions: decisions });
    return {
      v,
      asked,
      decisions,
      /** The Total the screen shows once any pop-up has been answered (what is about to be charged). */
      total: chargeTotal(common),
      /** The Total it shows BEFORE the pop-up is answered. */
      totalBeforeAnswer: chargeTotal({ ...common, decisions: comboOffDecisions(charge, selected, comboOff) }),
      input,
    };
  }
  /** Take the payment the screen built, and compare the totals. */
  async function chargeAndCompare(studentId: number, o: Parameters<typeof screen>[1]) {
    const s = await screen(studentId, o);
    setSession("ADMIN", w.admin.id);
    const res = await pay.takePayment(s.input);
    assert.equal(res.ok, true, JSON.stringify({ input: s.input, res }));
    const receipt = (res as Extract<typeof res, { ok: true }>).receipt;
    assert.equal(receipt.total, s.total.toFixed(2), "the displayed Total must equal the receipt total");
    return { s, receipt };
  }

  // ---- Half ------------------------------------------------------------------------------------------

  test("Half month: full tier, half tier and quarter tier — Total equals the receipt", async () => {
    for (const [tier, expected] of [["FULL", "1250.00"], ["HALF", "625.00"], ["QUARTER", "312.50"]] as const) {
      const { course, student } = await single(tier);
      const { receipt } = await chargeAndCompare(student.id, { picks: [{ courseId: course.id, mode: "HALF" }] });
      assert.equal(receipt.total, expected, tier);
      assert.ok(receipt.lines[0].label.endsWith("(Half month)"));
    }
  });

  test("Half month with the combo: automatic, switched off, and after a pop-up Yes — every tier", async () => {
    for (const tier of ["FULL", "HALF", "QUARTER"] as const) {
      const auto = await comboPair({ tier, days: 2 }, { tier, days: 2 });
      const a = await chargeAndCompare(auto.student.id, { picks: [{ courseId: auto.ca.id, mode: "HALF" }] }); // combo applies on its own
      assert.equal(a.s.asked.length, 0, `${tier} auto: no pop-up`);

      const off = await comboPair({ tier, days: 2 }, { tier, days: 2 });
      await chargeAndCompare(off.student.id, { picks: [{ courseId: off.ca.id, mode: "HALF" }], comboOff: [off.combo.id] });
      const rs = await rows(off.student.id);
      assert.deepEqual([rs[0].comboApplied, rs[0].comboRefusedReason], [false, null], `${tier} off`);

      const ask = await comboPair({ tier, days: 2 }, { tier, days: 0 });
      const y = await chargeAndCompare(ask.student.id, { picks: [{ courseId: ask.ca.id, mode: "HALF" }], answer: "yes" });
      assert.deepEqual(y.s.asked, [ask.combo.id], `${tier} needs a person`);
      assert.ok(y.s.total < y.s.totalBeforeAnswer, "after Yes the combo price is lower than the normal rate");
    }
  });

  // ---- No charge ---------------------------------------------------------------------------------------

  test("No charge only: Total 0.00 equals the receipt, the receipt says noCharge, and the month is settled", async () => {
    const { course, student } = await single();
    const { s, receipt } = await chargeAndCompare(student.id, { picks: [{ courseId: course.id, mode: "NO_CHARGE" }] });
    assert.equal(s.total, 0);
    assert.equal(receipt.total, "0.00");
    assert.equal(receipt.noCharge, true);
    assert.deepEqual(s.input.classMonths, [{ courseId: course.id, year: 2026, month: 11, mode: "NO_CHARGE" }]);
  });

  test("mixed in one checkout — Full + Half + No charge across months and courses: Total equals the receipt, lines labelled", async () => {
    const teacher = await makeTeacher(db);
    const [a, b] = await Promise.all([1, 2].map((i) => makeCourse(db, w, { teacherId: teacher.id, fee: i === 1 ? "2500" : "1800", name: `MX${i}${Math.random().toString(36).slice(2, 5)}` })));
    const student = await makeStudent(db);
    for (const c of [a, b]) await enrol(db, { studentId: student.id, courseId: c.id, tierId: w.tiers.FULL.id, since: OLD });
    const { s, receipt } = await chargeAndCompare(student.id, {
      picks: [
        { courseId: a.id, month: 9, mode: "FULL" },
        { courseId: a.id, month: 10, mode: "HALF" },
        { courseId: a.id, month: 11, mode: "NO_CHARGE" },
        { courseId: b.id, month: 11, mode: "HALF" },
      ],
    });
    assert.equal(receipt.total, "4650.00"); // 2500 + 1250 + 0 + 900
    assert.deepEqual(receipt.lines.map((l) => l.amount), ["2500.00", "1250.00", "0.00", "900.00"]);
    assert.deepEqual(receipt.lines.map((l) => /\((Half month|No charge)\)$/.exec(l.label)?.[1] ?? null), [null, "Half month", "No charge", "Half month"]);
    assert.equal("noCharge" in receipt, false);
    assert.equal(new Set((await rows(student.id)).map((r) => r.transactionRef)).size, 1); // one receipt
    assert.deepEqual(s.input.classMonths.map((m) => ("mode" in m ? m.mode : "FULL")), ["FULL", "HALF", "NO_CHARGE", "HALF"]);
  });

  // ---- the combo, every state ------------------------------------------------------------------------------

  test("combo auto: both classes attended — no pop-up, no answer sent, the combo rate is charged and shown", async () => {
    const { ca, cb, student } = await comboPair({ days: 2 }, { days: 1 });
    const { s, receipt } = await chargeAndCompare(student.id, { picks: [{ courseId: ca.id }, { courseId: cb.id }] });
    assert.deepEqual([s.asked, s.decisions], [[], []]);
    assert.equal(receipt.total, "3300.00");
    assert.equal(s.total, s.totalBeforeAnswer, "nothing to answer, so the Total never changes");
  });

  test("combo switched off (no reason): normal rate, off: true sent, recorded as not applied with no reason text", async () => {
    const { ca, cb, combo, student } = await comboPair({ days: 2 }, { days: 2 });
    const { s, receipt } = await chargeAndCompare(student.id, { picks: [{ courseId: ca.id }, { courseId: cb.id }], comboOff: [combo.id] });
    assert.deepEqual(s.decisions, [{ comboId: combo.id, apply: false, off: true }]);
    assert.equal(receipt.total, "4200.00");
    for (const r of await rows(student.id)) assert.deepEqual([r.comboId, r.comboApplied, r.comboRefusedReason], [combo.id, false, null]);
  });

  test("0-day combo: the pop-up appears; Yes charges the combo rate, No (with a reason) the normal rate — Total equals the receipt both ways", async () => {
    const yes = await comboPair({ days: 2 }, { days: 0 });
    const y = await chargeAndCompare(yes.student.id, { picks: [{ courseId: yes.ca.id }, { courseId: yes.cb.id }], answer: "yes" });
    assert.deepEqual(y.s.asked, [yes.combo.id]);
    assert.equal(y.s.totalBeforeAnswer, 4200); // normal until answered
    assert.equal(y.receipt.total, "3300.00");

    const no = await comboPair({ days: 2 }, { days: 0 });
    const n = await chargeAndCompare(no.student.id, { picks: [{ courseId: no.ca.id }, { courseId: no.cb.id }], answer: "no" });
    assert.equal(n.receipt.total, "4200.00");
    assert.deepEqual((await rows(no.student.id)).map((r) => r.comboRefusedReason), ["did not attend", "did not attend"]);
  });

  test("a 0-day combo with the switch OFF: no pop-up, and no reason is needed", async () => {
    const { ca, cb, combo, student } = await comboPair({ days: 2 }, { days: 0 });
    const { s, receipt } = await chargeAndCompare(student.id, { picks: [{ courseId: ca.id }, { courseId: cb.id }], comboOff: [combo.id] });
    assert.deepEqual(s.asked, []);
    assert.equal(receipt.total, "4200.00");
  });

  test("free-class combo: the combo applies to the paid class with no question, the free class is not chargeable", async () => {
    const { ca, cb, student } = await comboPair({ days: 0 }, { tier: "FREE" });
    const { s, receipt } = await chargeAndCompare(student.id, { picks: [{ courseId: ca.id }] });
    assert.equal(s.asked.length, 0);
    assert.equal(receipt.total, "2000.00");
    void cb;
  });

  test("new-student combo: the new class is not checked, the combo applies with no question", async () => {
    const { ca, cb, student } = await comboPair({ days: 2 }, { since: NEWER, days: 0 });
    const v = await loadView(student.id);
    assert.equal(v.courses[1].combo?.thisClassIsNew, true); // the card will show the "New" chip
    const { s, receipt } = await chargeAndCompare(student.id, { picks: [{ courseId: ca.id }, { courseId: cb.id }] });
    assert.equal(s.asked.length, 0);
    assert.equal(receipt.total, "3300.00");
  });

  test("the whole matrix: state x switch x pop-up answer x mode — the displayed Total equals the receipt total every time", async () => {
    const states: [string, Spec, Spec, Pick["courseId"][]][] = [
      ["auto", { days: 2 }, { days: 1 }, []],
      ["needs-confirmation", { days: 2 }, { days: 0 }, []],
      ["exempt-new", { days: 2 }, { since: NEWER }, []],
      ["exempt-free", { days: 0 }, { tier: "FREE" }, []],
    ];
    let checked = 0;
    for (const [name, a, b] of states) for (const off of [false, true]) for (const answer of ["yes", "no"] as const) for (const mode of ["FULL", "HALF"] as const) {
      const p = await comboPair(a, b);
      const paying = name === "exempt-free" ? [p.ca] : [p.ca, p.cb];
      const { receipt } = await chargeAndCompare(p.student.id, { picks: paying.map((c) => ({ courseId: c.id, mode })), comboOff: off ? [p.combo.id] : [], answer });
      assert.ok(Number(receipt.total) > 0, `${name} off=${off} answer=${answer} mode=${mode}`);
      checked++;
    }
    assert.equal(checked, 32);
  });

  test("if the screen skipped the pop-up the server would still refuse: the question is the server's, not the screen's", async () => {
    const { ca, student } = await comboPair({ days: 2 }, { days: 0 });
    setSession("ADMIN", w.admin.id);
    const res = await pay.takePayment({ studentId: student.id, admission: false, smartCard: false, comboDecisions: [], classMonths: [{ courseId: ca.id, year: 2026, month: 11 }] });
    assert.deepEqual(res, { ok: false, error: "A combined-rate decision is missing." });
  });

  // ---- the smart card -------------------------------------------------------------------------------------------

  test("smart card: the view shows 'already charged' and the server refuses a forced second charge, naming the same date (both as '10 Nov 2026')", async () => {
    const student = await makeStudent(db, { cardUid: "SCREENCARD01" });
    await chargeAndCompare(student.id, { picks: [], smartCard: true });
    const v = await loadView(student.id);
    assert.equal(v.smartCard.chargedOn, "2026-11-10");
    setSession("ADMIN", w.admin.id);
    const forced = await pay.takePayment({ studentId: student.id, admission: false, smartCard: true, comboDecisions: [], classMonths: [] });
    assert.deepEqual(forced, { ok: false, error: `This card was already charged on ${friendlyDate(v.smartCard.chargedOn)}. If it is a replacement card, change the card number and UID in Registration first.` });
  });

  // ---- after the payment ------------------------------------------------------------------------------------------

  test("reload after each payment: the card shows the NEXT unpaid month, and a No-charge month is settled — no longer owed", async () => {
    const { course, student } = await single(); // enrolled Aug: Aug..Nov
    const before = await loadView(student.id);
    assert.equal(before.courses[0].cardMonth?.label, "Aug 2026");

    await chargeAndCompare(student.id, { picks: [{ courseId: course.id, month: 8, mode: "FULL" }] });
    assert.equal((await loadView(student.id)).courses[0].cardMonth?.label, "Sep 2026");

    await chargeAndCompare(student.id, { picks: [{ courseId: course.id, month: 9, mode: "NO_CHARGE" }] });
    const after = await loadView(student.id);
    assert.equal(after.courses[0].cardMonth?.label, "Oct 2026"); // Sep is settled, so the card moved on
    const sep = after.courses[0].months.find((m) => m.month === 9)!;
    assert.deepEqual([sep.state, sep.paidMode, sep.owed], ["paid", "NO_CHARGE", false]);
    assert.deepEqual((await arrears.studentArrears(student.id)).owedMonths.map((m) => m.label), ["Oct 2026", "Nov 2026"]);

    await chargeAndCompare(student.id, { picks: [{ courseId: course.id, month: 10, mode: "HALF" }] });
    const done = await loadView(student.id);
    assert.equal(done.courses[0].cardMonth?.label, "Nov 2026");
    assert.deepEqual(done.courses[0].months.find((m) => m.month === 10)?.paidMode, "HALF");
  });

  test("admission and the smart card ride along: Total equals the receipt", async () => {
    const { course, student } = await single();
    const { receipt } = await chargeAndCompare(student.id, { picks: [{ courseId: course.id, mode: "HALF" }], admission: true, smartCard: true });
    assert.equal(receipt.total, "3050.00"); // 1300 + 500 + 1250
  });

  test("the request the screen builds for a Full-only checkout is byte-identical to the old one", async () => {
    const { course, student } = await single();
    const s = await screen(student.id, { picks: [{ courseId: course.id }], admission: true });
    assert.equal(JSON.stringify(s.input), JSON.stringify({ studentId: student.id, admission: true, smartCard: false, classMonths: [{ courseId: course.id, year: 2026, month: 11 }], comboDecisions: [] }));
  });
});
