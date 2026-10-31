import test from "node:test";
import assert from "node:assert/strict";

import {
  chargeCoursesFrom,
  chargeInput,
  chargeTotal,
  monthKey,
  selectedClassMonths,
  shortMoney,
  toggleCard,
  toggleMonth,
  touchedComboIds,
  type ChargeCourse,
} from "@/lib/payment-charge";

// Pure logic only — no database. The comparison with the OLD screen and with the
// real takePayment, on real rows, is in payment-parity.test.ts.

const month = (year: number, m: number) => ({ year, month: m });
const course = (over: Partial<ChargeCourse> & { courseId: number }): ChargeCourse => ({
  free: false,
  monthly: "2500.00",
  comboMonthly: null,
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
  assert.deepEqual([...first], [monthKey(1, 2026, 10)]);
  assert.deepEqual([...toggleCard(1, month(2026, 10), first)], []);
});

test("tapping a card with months picked in the calendar clears them all (it does not add the card month)", () => {
  const picked = sel(monthKey(1, 2026, 11), monthKey(1, 2026, 12), monthKey(2, 2026, 11));
  const next = toggleCard(1, month(2026, 10), picked);
  assert.deepEqual([...next], [monthKey(2, 2026, 11)]); // course 2 untouched
});

test("a card with no month to charge (paid or free) cannot be selected by tapping", () => {
  assert.deepEqual([...toggleCard(1, null, sel())], []);
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
      courseId: 1, free: false, monthly: "2500.00", comboMonthly: null, comboId: null,
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
  const [c] = chargeCoursesFrom([{ courseId: 4, free: true, monthly: null, comboMonthly: "1300.00", comboId: 9, months: [] }]);
  assert.deepEqual(c, { courseId: 4, free: true, monthly: null, comboMonthly: "1300.00", comboId: 9, months: [] });
});
