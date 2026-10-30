import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMonthStates,
  classifyMonth,
  monthIndex,
  previousMonth,
  sortRoster,
  tallyMonthStates,
  type MonthEnrolment,
} from "@/lib/month-status";

// ---- the rule ---------------------------------------------------------------

test("paid: this month is settled, whatever happened last month", () => {
  assert.equal(
    classifyMonth({ free: false, paidThisMonth: true, enrolledLastMonth: true, paidLastMonth: false }),
    "paid",
  );
});

test("notPaid: this month unpaid, last month paid", () => {
  assert.equal(
    classifyMonth({ free: false, paidThisMonth: false, enrolledLastMonth: true, paidLastMonth: true }),
    "notPaid",
  );
});

test("overdue: this month unpaid AND last month also unpaid", () => {
  assert.equal(
    classifyMonth({ free: false, paidThisMonth: false, enrolledLastMonth: true, paidLastMonth: false }),
    "overdue",
  );
});

test("a student who joined this month cannot be overdue for a month before they enrolled", () => {
  assert.equal(
    classifyMonth({ free: false, paidThisMonth: false, enrolledLastMonth: false, paidLastMonth: false }),
    "notPaid",
  );
});

test("free wins over everything — nothing is ever owed on a free tier", () => {
  for (const paidThisMonth of [true, false])
    for (const enrolledLastMonth of [true, false])
      for (const paidLastMonth of [true, false])
        assert.equal(
          classifyMonth({ free: true, paidThisMonth, enrolledLastMonth, paidLastMonth }),
          "free",
        );
});

// ---- the boxes add up ---------------------------------------------------------

test("paid + notPaid + overdue + free always equals the enrolled total", () => {
  // Every combination of the four inputs, in every mix, for a class of 16.
  const enrolments: MonthEnrolment[] = [];
  const paidThis = new Set<number>();
  const paidLast = new Set<number>();
  let id = 1;
  for (const free of [true, false])
    for (const enrolledLastMonth of [true, false])
      for (const pt of [true, false])
        for (const pl of [true, false]) {
          enrolments.push({ studentId: id, free, enrolledLastMonth });
          if (pt) paidThis.add(id);
          if (pl) paidLast.add(id);
          id++;
        }

  const states = buildMonthStates({ enrolments, paidThisMonth: paidThis, paidLastMonth: paidLast });
  assert.equal(states.size, enrolments.length, "every enrolment gets exactly one state");

  const counts = tallyMonthStates(states.values());
  assert.equal(counts.paid + counts.notPaid + counts.overdue + counts.free, enrolments.length);
  // And the split itself is what the table in the brief says it is.
  assert.deepEqual(counts, { paid: 4, notPaid: 3, overdue: 1, free: 8 });
});

test("an empty class counts to zero in every box", () => {
  const counts = tallyMonthStates(
    buildMonthStates({ enrolments: [], paidThisMonth: new Set(), paidLastMonth: new Set() }).values(),
  );
  assert.deepEqual(counts, { paid: 0, notPaid: 0, overdue: 0, free: 0 });
});

test("payers who are not enrolled are ignored, not counted", () => {
  const states = buildMonthStates({
    enrolments: [{ studentId: 1, free: false, enrolledLastMonth: true }],
    paidThisMonth: new Set([1, 99]), // 99 paid but is not in this class's roster
    paidLastMonth: new Set(),
  });
  assert.equal(states.size, 1);
  assert.equal(states.has(99), false);
});

// ---- months -------------------------------------------------------------------

test("previousMonth wraps January back to December of the year before", () => {
  assert.deepEqual(previousMonth(2026, 1), { year: 2025, month: 12 });
  assert.deepEqual(previousMonth(2026, 10), { year: 2026, month: 9 });
});

test("monthIndex orders months across a year boundary", () => {
  assert.ok(monthIndex(2025, 12) < monthIndex(2026, 1));
  assert.equal(monthIndex(2026, 1) - monthIndex(2025, 12), 1);
});

test("January: last month is last December, so a December payer is not overdue", () => {
  const prev = previousMonth(2026, 1);
  assert.equal(monthIndex(prev.year, prev.month), monthIndex(2025, 12));
});

// ---- the class list order -------------------------------------------------------

const row = (name: string, arrivedAt: string | null) => ({ name, present: arrivedAt !== null, arrivedAt });

test("attended students come first, earliest arrival first; the absent follow, A to Z", () => {
  const sorted = sortRoster([
    row("Zed", null),
    row("Mia", "16:05"),
    row("Abe", null),
    row("Lee", "15:58"),
    row("Ann", "16:05"), // same minute as Mia: tie breaks by name
  ]);
  assert.deepEqual(
    sorted.map((r) => r.name),
    ["Lee", "Ann", "Mia", "Abe", "Zed"],
  );
});

test("24-hour times sort correctly as text, including around noon", () => {
  const sorted = sortRoster([row("PM", "13:10"), row("AM", "09:40"), row("Noon", "12:00")]);
  assert.deepEqual(sorted.map((r) => r.name), ["AM", "Noon", "PM"]);
});

test("sortRoster does not mutate its input", () => {
  const input = [row("B", null), row("A", "10:00")];
  const copy = [...input];
  sortRoster(input);
  assert.deepEqual(input, copy);
});
