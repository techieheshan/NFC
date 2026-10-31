import test from "node:test";
import assert from "node:assert/strict";

import type { PaymentMode } from "@/app/(app)/payment/actions";
import type { ComboState } from "@/lib/combos";
import {
  asSelection,
  chargeCoursesFrom,
  comboApplies,
  comboOffDecisions,
  comboQuestionIds,
  courseComboApplied,
  lineAmountText,
  setMonthMode,
  chargeInput,
  chargeTotal,
  monthKey,
  selectedClassMonths,
  shortMoney,
  toggleCard,
  toggleMonth,
  touchedComboIds,
  zeroDayNotice,
  type ChargeCourse,
} from "@/lib/payment-charge";

// Pure logic only — no database. The comparison with the OLD screen and with the
// real takePayment, on real rows, is in payment-parity.test.ts.

const month = (year: number, m: number) => ({ year, month: m });
const course = (over: Partial<ChargeCourse> & { courseId: number }): ChargeCourse => ({
  free: false,
  monthly: "2500.00",
  comboMonthly: null,
  halfMonthly: "1250.00",
  halfComboMonthly: null,
  comboId: null,
  months: [month(2026, 10), month(2026, 11), month(2026, 12)],
  ...over,
});
const sel = (...keys: string[]) => new Set(keys);
const base = { admission: false, smartCard: false, admissionAmount: "1300.00", smartCardAmount: "500.00", decisions: [] };

test("nothing selected is 0 — a card never charges until it is chosen", () => {
  assert.equal(chargeTotal({ ...base, courses: [course({ courseId: 1 })], selected: sel() }), 0);
});

test("a selected month adds the course's monthly price; each extra month adds it again", () => {
  const courses = [course({ courseId: 1 })];
  assert.equal(chargeTotal({ ...base, courses, selected: sel(monthKey(1, 2026, 11)) }), 2500);
  assert.equal(chargeTotal({ ...base, courses, selected: sel(monthKey(1, 2026, 10), monthKey(1, 2026, 11)) }), 5000);
});

test("admission and smart card add their own amounts when ticked", () => {
  const t = chargeTotal({ ...base, admission: true, smartCard: true, courses: [], selected: sel() });
  assert.equal(t, 1800);
});

test("a free course adds nothing, even if its key is somehow selected", () => {
  const courses = [course({ courseId: 1, free: true, monthly: null })];
  assert.equal(chargeTotal({ ...base, courses, selected: sel(monthKey(1, 2026, 11)) }), 0);
});

test("a combo is charged at the NORMAL rate until it is accepted, then at the combo rate", () => {
  const courses = [course({ courseId: 1, monthly: "1700.00", comboMonthly: "1300.00", comboId: 9 })];
  const selected = sel(monthKey(1, 2026, 11));
  assert.equal(chargeTotal({ ...base, courses, selected }), 1700);
  assert.equal(chargeTotal({ ...base, courses, selected, decisions: [{ comboId: 9, apply: true }] }), 1300);
  assert.equal(chargeTotal({ ...base, courses, selected, decisions: [{ comboId: 9, apply: false, reason: "x" }] }), 1700);
  assert.equal(chargeTotal({ ...base, courses, selected, decisions: [{ comboId: 4, apply: true }] }), 1700); // another combo
});

test("the sum is accumulated in the same order as the old screen (float result identical)", () => {
  const courses = [
    course({ courseId: 1, monthly: "1333.33" }),
    course({ courseId: 2, monthly: "10.15" }),
    course({ courseId: 3, monthly: "1250.05" }),
  ];
  const selected = sel(monthKey(1, 2026, 10), monthKey(1, 2026, 11), monthKey(2, 2026, 11), monthKey(3, 2026, 12));
  let expected = 0;
  expected += 1333.33;
  expected += 1333.33;
  expected += 10.15;
  expected += 1250.05;
  assert.equal(chargeTotal({ ...base, courses, selected }), expected);
});

test("classMonths come out in course order, then oldest month first — whatever order they were tapped", () => {
  const courses = [course({ courseId: 5 }), course({ courseId: 2 })];
  const selected = sel(monthKey(2, 2026, 12), monthKey(5, 2026, 11), monthKey(2, 2026, 10), monthKey(5, 2026, 10));
  assert.deepEqual(selectedClassMonths(courses, selected), [
    { courseId: 5, year: 2026, month: 10 },
    { courseId: 5, year: 2026, month: 11 },
    { courseId: 2, year: 2026, month: 10 },
    { courseId: 2, year: 2026, month: 12 },
  ]);
});

test("the takePayment input has exactly the old shape and nothing else — never an amount", () => {
  const input = chargeInput({
    studentId: 7,
    admission: true,
    smartCard: false,
    courses: [course({ courseId: 1 })],
    selected: sel(monthKey(1, 2026, 11)),
    comboDecisions: [{ comboId: 3, apply: false, reason: "no" }],
  });
  assert.deepEqual(Object.keys(input).sort(), ["admission", "classMonths", "comboDecisions", "smartCard", "studentId"]);
  assert.deepEqual(input, {
    studentId: 7,
    admission: true,
    smartCard: false,
    classMonths: [{ courseId: 1, year: 2026, month: 11 }],
    comboDecisions: [{ comboId: 3, apply: false, reason: "no" }],
  });
});

test("touched combos: only combos whose courses are actually selected", () => {
  const courses = [course({ courseId: 1, comboId: 9 }), course({ courseId: 2, comboId: 9 }), course({ courseId: 3, comboId: 4 }), course({ courseId: 4 })];
  assert.deepEqual(touchedComboIds(courses, sel()), []);
  assert.deepEqual(touchedComboIds(courses, sel(monthKey(4, 2026, 11))), []);
  assert.deepEqual(touchedComboIds(courses, sel(monthKey(1, 2026, 11), monthKey(2, 2026, 11))), [9]);
  assert.deepEqual(touchedComboIds(courses, sel(monthKey(1, 2026, 11), monthKey(3, 2026, 11))).sort(), [4, 9]);
});

test("tapping a card selects its month; tapping again clears it", () => {
  const first = toggleCard(1, month(2026, 10), sel());
  assert.deepEqual([...first.keys()], [monthKey(1, 2026, 10)]);
  assert.deepEqual([...toggleCard(1, month(2026, 10), first).keys()], []);
});

test("tapping a card with months picked in the calendar clears them all (it does not add the card month)", () => {
  const picked = sel(monthKey(1, 2026, 11), monthKey(1, 2026, 12), monthKey(2, 2026, 11));
  const next = toggleCard(1, month(2026, 10), picked);
  assert.deepEqual([...next.keys()], [monthKey(2, 2026, 11)]); // course 2 untouched
});

test("a card with no month to charge (paid or free) cannot be selected by tapping", () => {
  assert.deepEqual([...toggleCard(1, null, sel()).keys()], []);
});

test("calendar toggling is symmetric and does not mutate its input", () => {
  const start = sel(monthKey(1, 2026, 10));
  const added = toggleMonth(start, monthKey(1, 2026, 11));
  assert.equal(start.size, 1);
  assert.equal(added.size, 2);
  assert.equal(toggleMonth(added, monthKey(1, 2026, 11)).size, 1);
});

test("shortMoney drops only a whole-rupee .00 — real cents are never hidden", () => {
  assert.equal(shortMoney("2500.00"), "2500");
  assert.equal(shortMoney("1300.00"), "1300");
  assert.equal(shortMoney("666.66"), "666.66");
  assert.equal(shortMoney("1250.50"), "1250.50");
  assert.equal(shortMoney("100.05"), "100.05");
  assert.equal(shortMoney("0.00"), "0");
  assert.equal(shortMoney(null), "—");
});

test("a PAID month can never be in the total or the request, even if its key is selected", () => {
  const courses = chargeCoursesFrom([
    {
      courseId: 1, free: false, monthly: "2500.00", comboMonthly: null, halfMonthly: "1250.00", halfComboMonthly: null, comboId: null,
      months: [
        { year: 2026, month: 8, state: "paid" },
        { year: 2026, month: 9, state: "paid" },
        { year: 2026, month: 10, state: "unpaid" },
        { year: 2026, month: 11, state: "ahead" },
      ],
    },
  ]);
  const everything = sel(monthKey(1, 2026, 8), monthKey(1, 2026, 9), monthKey(1, 2026, 10), monthKey(1, 2026, 11));
  assert.equal(chargeTotal({ ...base, courses, selected: everything }), 5000); // Oct + Nov only
  assert.deepEqual(selectedClassMonths(courses, everything).map((m) => m.month), [10, 11]);
  assert.equal(chargeTotal({ ...base, courses, selected: sel(monthKey(1, 2026, 8)) }), 0);
  assert.deepEqual(selectedClassMonths(courses, sel(monthKey(1, 2026, 9))), []);
});

test("chargeCoursesFrom keeps prices and combo ids exactly as given", () => {
  const [c] = chargeCoursesFrom([{ courseId: 4, free: true, monthly: null, comboMonthly: "1300.00", halfMonthly: null, halfComboMonthly: "650.00", comboId: 9, months: [] }]);
  assert.deepEqual(c, { courseId: 4, free: true, monthly: null, comboMonthly: "1300.00", halfMonthly: null, halfComboMonthly: "650.00", comboId: 9, comboState: null, months: [] });
});

// ---- job 3B: modes, and when a combo applies on the screen ----------------------------------------------

const sel2 = (...entries: [string, PaymentMode][]) => new Map<string, PaymentMode>(entries);
const comboCourse = (over: Partial<ChargeCourse> = {}): ChargeCourse =>
  course({ courseId: 1, monthly: "1700.00", comboMonthly: "1300.00", halfMonthly: "850.00", halfComboMonthly: "650.00", comboId: 9, comboState: "auto", ...over });
const STATES: ComboState[] = ["auto", "needs-confirmation", "exempt-new", "exempt-free", "off"];

test("comboApplies: the whole table — state x switch x answer", () => {
  const yes = { apply: true }, no = { apply: false };
  for (const state of STATES) {
    // switched off: never, whatever the state or the answer
    for (const d of [undefined, yes, no]) assert.equal(comboApplies(state, true, d), false, `${state} off ${JSON.stringify(d)}`);
  }
  // needs-confirmation: only after a "Yes"
  assert.equal(comboApplies("needs-confirmation", false, undefined), false);
  assert.equal(comboApplies("needs-confirmation", false, yes), true);
  assert.equal(comboApplies("needs-confirmation", false, no), false);
  // every other state applies on its own, unless a refusal was answered
  for (const state of ["auto", "exempt-new", "exempt-free"] as const) {
    assert.equal(comboApplies(state, false, undefined), true, state);
    assert.equal(comboApplies(state, false, yes), true, state);
    assert.equal(comboApplies(state, false, no), false, state);
  }
  // a caller that knows no state gets the OLD behaviour: only a "Yes" applies it
  for (const unknown of [null, undefined]) {
    assert.equal(comboApplies(unknown, false, undefined), false);
    assert.equal(comboApplies(unknown, false, yes), true);
  }
});

test("courseComboApplied: the LAST answer for a combo wins (as on the server); no combo price means no combo", () => {
  const c = comboCourse({ comboState: "needs-confirmation" });
  const off = new Set<number>();
  assert.equal(courseComboApplied(c, off, [{ comboId: 9, apply: false, reason: "x" }, { comboId: 9, apply: true }]), true);
  assert.equal(courseComboApplied(c, off, [{ comboId: 9, apply: true }, { comboId: 9, apply: false, reason: "x" }]), false);
  assert.equal(courseComboApplied(comboCourse({ comboMonthly: null }), off, []), false);
  assert.equal(courseComboApplied(comboCourse({ comboId: null }), off, []), false);
  assert.equal(courseComboApplied(comboCourse({ comboState: "auto" }), new Set([9]), []), false); // switched off
});

test("lineAmountText: Full, Half and No charge, with and without the combo — all server strings", () => {
  const c = comboCourse();
  assert.deepEqual(
    (["FULL", "HALF", "NO_CHARGE"] as const).flatMap((m) => [lineAmountText(c, m, false), lineAmountText(c, m, true)]),
    ["1700.00", "1300.00", "850.00", "650.00", "0.00", "0.00"],
  );
});

test("the Total follows the mode of each month: Full, Half and No charge in one selection", () => {
  const c = course({ courseId: 1 });
  const selected = sel2([monthKey(1, 2026, 10), "FULL"], [monthKey(1, 2026, 11), "HALF"], [monthKey(1, 2026, 12), "NO_CHARGE"]);
  assert.equal(chargeTotal({ ...base, courses: [c], selected, decisions: [] }), 2500 + 1250 + 0);
});

test("the Total, by combo state: auto / exempt-* apply it on their own; needs-confirmation waits for a Yes; the switch always wins", () => {
  const selected = sel2([monthKey(1, 2026, 11), "FULL"]);
  const total = (state: ComboState, comboOff: number[], decisions: { comboId: number; apply: boolean; reason?: string }[] = []) =>
    chargeTotal({ ...base, courses: [comboCourse({ comboState: state })], selected, decisions, comboOff: new Set(comboOff) });
  for (const s of ["auto", "exempt-new", "exempt-free"] as const) {
    assert.equal(total(s, []), 1300, s);
    assert.equal(total(s, [9]), 1700, `${s} switched off`);
    assert.equal(total(s, [], [{ comboId: 9, apply: false, reason: "x" }]), 1700, `${s} refused`);
  }
  assert.equal(total("needs-confirmation", []), 1700); // normal until answered
  assert.equal(total("needs-confirmation", [], [{ comboId: 9, apply: true }]), 1300);
  assert.equal(total("needs-confirmation", [], [{ comboId: 9, apply: false, reason: "x" }]), 1700);
  assert.equal(total("needs-confirmation", [9], [{ comboId: 9, apply: true }]), 1700); // the switch wins
});

test("Half of a combo month uses the server's half-of-combo string", () => {
  const selected = sel2([monthKey(1, 2026, 11), "HALF"]);
  assert.equal(chargeTotal({ ...base, courses: [comboCourse()], selected, decisions: [] }), 650);
  assert.equal(chargeTotal({ ...base, courses: [comboCourse()], selected, decisions: [], comboOff: new Set([9]) }), 850);
});

test("a No charge month is 0 with or without a combo, and never needs a combo answer", () => {
  const selected = sel2([monthKey(1, 2026, 11), "NO_CHARGE"]);
  const courses = [comboCourse({ comboState: "needs-confirmation" })];
  assert.equal(chargeTotal({ ...base, courses, selected, decisions: [] }), 0);
  assert.deepEqual(touchedComboIds(courses, selected), []);
  assert.deepEqual(comboQuestionIds(courses, selected, new Set()), []);
});

test("classMonths carry `mode` ONLY when it is not FULL — a Full-only checkout is byte-identical to the old input", () => {
  const courses = [course({ courseId: 1 }), course({ courseId: 2 })];
  const mixed = sel2([monthKey(2, 2026, 10), "NO_CHARGE"], [monthKey(1, 2026, 11), "HALF"], [monthKey(1, 2026, 10), "FULL"]);
  assert.deepEqual(selectedClassMonths(courses, mixed), [
    { courseId: 1, year: 2026, month: 10 }, // FULL: no mode key at all
    { courseId: 1, year: 2026, month: 11, mode: "HALF" },
    { courseId: 2, year: 2026, month: 10, mode: "NO_CHARGE" },
  ]);
  const fullOnly = sel2([monthKey(1, 2026, 10), "FULL"], [monthKey(2, 2026, 11), "FULL"]);
  const asSet = sel(monthKey(1, 2026, 10), monthKey(2, 2026, 11));
  assert.equal(JSON.stringify(selectedClassMonths(courses, fullOnly)), JSON.stringify(selectedClassMonths(courses, asSet)));
  assert.equal(JSON.stringify(selectedClassMonths(courses, fullOnly)), '[{"courseId":1,"year":2026,"month":10},{"courseId":2,"year":2026,"month":11}]');
});

test("a plain set of keys is the same selection as a map of FULL months", () => {
  const courses = [course({ courseId: 1 })];
  const keys = [monthKey(1, 2026, 10), monthKey(1, 2026, 11)];
  const a = chargeTotal({ ...base, courses, selected: new Set(keys), decisions: [] });
  const b = chargeTotal({ ...base, courses, selected: new Map(keys.map((k) => [k, "FULL" as PaymentMode])), decisions: [] });
  assert.equal(a, b);
  assert.deepEqual([...asSelection(new Set(keys)).values()], ["FULL", "FULL"]);
});

test("who is asked: only combos still switched ON whose state is needs-confirmation (and unknown states, as before)", () => {
  const selected = sel2([monthKey(1, 2026, 11), "FULL"], [monthKey(2, 2026, 11), "FULL"], [monthKey(3, 2026, 11), "FULL"], [monthKey(4, 2026, 11), "FULL"]);
  const courses = [
    comboCourse({ courseId: 1, comboId: 11, comboState: "needs-confirmation" }),
    comboCourse({ courseId: 2, comboId: 12, comboState: "auto" }),
    comboCourse({ courseId: 3, comboId: 13, comboState: "exempt-new" }),
    comboCourse({ courseId: 4, comboId: 14, comboState: undefined }), // no state known: ask, as the old screen did
  ];
  assert.deepEqual(comboQuestionIds(courses, selected, new Set()), [11, 14]);
  assert.deepEqual(comboQuestionIds(courses, selected, new Set([11])), [14]); // the switch silences the question
  assert.deepEqual(touchedComboIds(courses, selected), [11, 12, 13, 14]);
});

test("a switched-off combo is sent as off: true with no reason — only for combos the checkout touches", () => {
  const courses = [comboCourse({ courseId: 1, comboId: 11 }), comboCourse({ courseId: 2, comboId: 12 })];
  const selected = sel2([monthKey(1, 2026, 11), "FULL"]);
  assert.deepEqual(comboOffDecisions(courses, selected, new Set([11, 12])), [{ comboId: 11, apply: false, off: true }]);
  assert.deepEqual(comboOffDecisions(courses, selected, new Set()), []);
});

test("tapping a card can pick its month as No charge (the 0-day Ignore); tapping again clears it", () => {
  const picked = toggleCard(1, month(2026, 10), sel(), "NO_CHARGE");
  assert.deepEqual([...picked], [[monthKey(1, 2026, 10), "NO_CHARGE"]]);
  assert.equal(toggleCard(1, month(2026, 10), picked, "NO_CHARGE").size, 0);
});

test("setMonthMode changes a month's mode without disturbing the others, and does not mutate its input", () => {
  const start = sel2([monthKey(1, 2026, 10), "FULL"], [monthKey(1, 2026, 11), "FULL"]);
  const next = setMonthMode(start, monthKey(1, 2026, 11), "HALF");
  assert.equal(start.get(monthKey(1, 2026, 11)), "FULL");
  assert.deepEqual([...next], [[monthKey(1, 2026, 10), "FULL"], [monthKey(1, 2026, 11), "HALF"]]);
  assert.equal(setMonthMode(start, monthKey(2, 2026, 5), "NO_CHARGE").get(monthKey(2, 2026, 5)), "NO_CHARGE");
});

test("chargeCoursesFrom carries the combo state and the half amounts, and still drops paid months", () => {
  const [c] = chargeCoursesFrom([
    { courseId: 1, free: false, monthly: "2500.00", comboMonthly: "2000.00", halfMonthly: "1250.00", halfComboMonthly: "1000.00", comboId: 7, combo: { state: "exempt-new" },
      months: [{ year: 2026, month: 10, state: "paid" }, { year: 2026, month: 11, state: "unpaid" }] },
  ]);
  assert.equal(c.comboState, "exempt-new");
  assert.deepEqual([c.halfMonthly, c.halfComboMonthly], ["1250.00", "1000.00"]);
  assert.deepEqual(c.months, [{ year: 2026, month: 11 }]);
});

test("zeroDayNotice: asked for a paying course's COMPLETED month with 0 days, only while nothing is picked", () => {
  const card = (o: { free?: boolean; owed?: boolean; attended?: number; none?: boolean } = {}) => ({
    free: o.free ?? false,
    cardMonth: o.none ? null : { owed: o.owed ?? true, attended: o.attended ?? 0 },
  });
  assert.equal(zeroDayNotice(card(), []), true);
  // answering picks the month (Ignore -> No charge, Charge -> Full): the question is gone...
  assert.equal(zeroDayNotice(card(), [{ mode: "NO_CHARGE" }]), false);
  assert.equal(zeroDayNotice(card(), [{ mode: "FULL" }]), false);
  // ...and it comes back when the card is un-picked: nothing is remembered
  assert.equal(zeroDayNotice(card(), []), true);
  // never asked: a day was attended, the CURRENT month (not owed yet), a free course, no card month
  assert.equal(zeroDayNotice(card({ attended: 1 }), []), false);
  assert.equal(zeroDayNotice(card({ owed: false }), []), false);
  assert.equal(zeroDayNotice(card({ free: true }), []), false);
  assert.equal(zeroDayNotice(card({ none: true }), []), false);
});
