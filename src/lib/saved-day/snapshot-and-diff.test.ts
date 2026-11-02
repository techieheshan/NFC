import { test } from "node:test";
import assert from "node:assert/strict";

import { diffSummaries } from "./diff";
import { snapshotOf, summaryOf } from "./fixtures";
import { buildSnapshot, cashBookColumns, cashBookOf, parseSnapshot, SNAPSHOT_SCHEMA, SnapshotError } from "./snapshot";

// ---- snapshot ----
test("a snapshot survives JSON exactly (what is stored is what comes back)", () => {
  const s = snapshotOf();
  assert.deepEqual(parseSnapshot(JSON.parse(JSON.stringify(s)), SNAPSHOT_SCHEMA), s);
});

test("buildSnapshot drops keys the schema does not know, so what is frozen is exactly schema 1", () => {
  const withExtra = { ...summaryOf(), futureField: 42 } as never;
  const s = buildSnapshot({ report: withExtra, cancelled: { receipts: 0, total: "0.00" }, staff: [] });
  assert.equal("futureField" in s.report, false);
});

test("optional figures (half / no-charge months) are kept when present and absent when not", () => {
  assert.equal("halfMonths" in snapshotOf().report, false);
  const s = snapshotOf({ report: { halfMonths: { count: 2, total: "1000.00" }, noChargeMonths: { count: 1 } } });
  assert.deepEqual(s.report.halfMonths, { count: 2, total: "1000.00" });
  assert.deepEqual(s.report.noChargeMonths, { count: 1 });
});

test("a schema number this code does not know is refused, never guessed", () => {
  assert.throws(() => parseSnapshot(snapshotOf(), 2), SnapshotError);
  assert.throws(() => parseSnapshot(snapshotOf(), 0), /unknown snapshot schema/);
});

test("a stored shape that does not fit is refused (missing key, a Float where text is expected, a negative count)", () => {
  const good = JSON.parse(JSON.stringify(snapshotOf()));
  for (const mutate of [
    (x: any) => { delete x.report.totalCollected; },
    (x: any) => { x.report.net = 28900.5; },
    (x: any) => { x.report.admission.count = -1; },
    (x: any) => { x.staff = "none"; },
    (x: any) => { x.cancelled = null; },
    (x: any) => { x.report.totalCollected = "12,500.00"; },
  ]) {
    const bad = JSON.parse(JSON.stringify(good));
    mutate(bad);
    assert.throws(() => parseSnapshot(bad, 1), SnapshotError);
  }
  assert.throws(() => parseSnapshot(null, 1), SnapshotError);
});

// ---- cash book ----
test("the cash book is R1's cash flow over the snapshot's own figures, in integer cents", () => {
  const s = snapshotOf(); // collected 35,100.00, deductions 6,200.00, net 28,900.00
  const b = cashBookOf(s, 1_000_00, [{ cents: 10_000_00 }, { cents: 5_000_00 }]);
  assert.deepEqual(b, { bringForward: 100000, collected: 3510000, deductions: 620000, shouldBeInDrawer: 2_990_000, bankTotal: 1_500_000, leftInDrawer: 1_490_000, net: 2890000, overdrawn: false });
  assert.deepEqual(cashBookColumns(b), {
    bringForward: "1000.00", collected: "35100.00", deductions: "6200.00", shouldBeInDrawer: "29900.00", bankTotal: "15000.00", leftInDrawer: "14900.00", net: "28900.00",
  });
});

test("banking more than the drawer holds is overdrawn; a negative Left with nothing banked is not", () => {
  const s = snapshotOf({ report: { totalCollected: "1000.00", deductions: { teacherAdvances: "0.00", xenonExpenses: "5000.00", total: "5000.00" }, net: "-4000.00" } });
  assert.equal(cashBookOf(s, 0, []).overdrawn, false);
  assert.equal(cashBookOf(s, 0, []).leftInDrawer, -400000);
  assert.equal(cashBookOf(snapshotOf(), 0, [{ cents: 99_999_00 }]).overdrawn, true);
  assert.equal(cashBookColumns(cashBookOf(s, 0, [])).leftInDrawer, "-4000.00");
});

// ---- diff ----
test("identical snapshots have no differences, and money text format does not matter", () => {
  assert.deepEqual(diffSummaries(snapshotOf(), snapshotOf()), []);
  const a = snapshotOf({ report: { totalCollected: "35100.00" } });
  const b = snapshotOf({ report: { totalCollected: "35100" } });
  assert.deepEqual(diffSummaries(a, b), [], "35100 and 35100.00 are the same cents");
});

test("every compared figure is noticed when it changes (one at a time)", () => {
  const base = snapshotOf();
  const cases: [string, (r: any) => void][] = [
    ["totalCollected", (r) => { r.totalCollected = "35101.00"; }],
    ["classTotal", (r) => { r.classTotal = "32001.00"; }],
    ["admission.count", (r) => { r.admission.count = 3; }],
    ["admission.total", (r) => { r.admission.total = "2700.00"; }],
    ["smartCard.count", (r) => { r.smartCard.count = 2; }],
    ["smartCard.total", (r) => { r.smartCard.total = "600.00"; }],
    ["halfMonths.count", (r) => { r.halfMonths = { count: 1, total: "0.00" }; }],
    ["halfMonths.total", (r) => { r.halfMonths = { count: 0, total: "10.00" }; }],
    ["noChargeMonths.count", (r) => { r.noChargeMonths = { count: 1 }; }],
    ["deductions.teacherAdvances", (r) => { r.deductions.teacherAdvances = "5001.00"; }],
    ["deductions.xenonExpenses", (r) => { r.deductions.xenonExpenses = "1201.00"; }],
    ["deductions.total", (r) => { r.deductions.total = "6201.00"; }],
    ["net", (r) => { r.net = "28901.00"; }],
    ["course:1.amount", (r) => { r.courses[0].amount = "24501.00"; }],
    ["course:1.paidFull", (r) => { r.courses[0].paidFull = 9; }],
    ["course:1.paidHalf", (r) => { r.courses[0].paidHalf = 2; }],
    ["course:1.paidQuarter", (r) => { r.courses[0].paidQuarter = 2; }],
    ["course:1.free", (r) => { r.courses[0].free = 2; }],
  ];
  for (const [key, mutate] of cases) {
    const live = JSON.parse(JSON.stringify(base));
    mutate(live.report);
    const keys = diffSummaries(base, live).map((d) => d.key);
    assert.ok(keys.includes(key), `${key} is noticed (got ${keys.join(", ")})`);
  }
  const live2 = JSON.parse(JSON.stringify(base));
  live2.cancelled = { receipts: 1, total: "500.00" };
  assert.deepEqual(diffSummaries(base, live2).map((d) => d.key), ["cancelled.receipts", "cancelled.total"]);
});

test("a cancelled receipt after saving shows as a lower total, with saved and live values formatted for the screen", () => {
  const live = snapshotOf({ report: { totalCollected: "34600.00", net: "28400.00" }, cancelled: { receipts: 1, total: "500.00" } });
  const d = diffSummaries(snapshotOf(), live);
  const total = d.find((x) => x.key === "totalCollected")!;
  assert.deepEqual([total.label, total.saved, total.live], ["Total collected", "35,100.00", "34,600.00"]);
});

test("deduction lines are a multiset: an added, a removed and a changed line are each noticed; the order is not", () => {
  const base = snapshotOf();
  const lines = base.report.deductionLines;
  const reordered = snapshotOf({ report: { deductionLines: [lines[1], lines[0]] } });
  assert.deepEqual(diffSummaries(base, reordered), []);
  const added = snapshotOf({ report: { deductionLines: [...lines, { ...lines[1], reason: "Tea" }] } });
  assert.equal(diffSummaries(base, added).filter((d) => d.key.startsWith("deduction:")).length, 1);
  const removed = snapshotOf({ report: { deductionLines: [lines[0]] } });
  assert.equal(diffSummaries(base, removed).filter((d) => d.key.startsWith("deduction:")).length, 1);
  const changed = snapshotOf({ report: { deductionLines: [{ ...lines[0], amount: "5001.00" }, lines[1]] } });
  assert.equal(diffSummaries(base, changed).filter((d) => d.key.startsWith("deduction:")).length, 2, "the old amount and the new one");
});

test("collected-by-staff rows are matched by user id; a missing row is zero", () => {
  const base = snapshotOf();
  const live = snapshotOf({ staff: [{ userId: "u1", name: "Sadun", receipts: 7, collected: "21100.00" }, { userId: "u2", name: "Thilini", receipts: 4, collected: "15000.00" }] });
  assert.deepEqual(diffSummaries(base, live).map((d) => d.key), ["staff:u1.receipts", "staff:u1.collected"]);
  const gone = snapshotOf({ staff: [{ userId: "u1", name: "Sadun", receipts: 6, collected: "20100.00" }] });
  assert.deepEqual(diffSummaries(base, gone).map((d) => d.key), ["staff:u2.receipts", "staff:u2.collected"]);
});

test("a course that appears only on one side with no money and no count is not a difference; with a payment it is", () => {
  const zero = { courseId: 9, course: "New course", teacher: "Mr Z", registered: 0, paidFull: 0, paidHalf: 0, paidQuarter: 0, notPaid: 0, free: 0, amount: "0.00", reconciles: true };
  const base = snapshotOf();
  assert.deepEqual(diffSummaries(base, snapshotOf({ report: { courses: [...base.report.courses, zero] } })), []);
  const paid = snapshotOf({ report: { courses: [...base.report.courses, { ...zero, paidFull: 1, amount: "2500.00" }] } });
  assert.deepEqual(diffSummaries(base, paid).map((d) => d.key), ["course:9.amount", "course:9.paidFull"]);
});

test("registered / not-paid counts are not compared (they are not on the paper and move with enrolments)", () => {
  const base = snapshotOf();
  const live = JSON.parse(JSON.stringify(base));
  live.report.courses[0].registered = 99;
  live.report.courses[0].notPaid = 80;
  assert.deepEqual(diffSummaries(base, live), []);
});
