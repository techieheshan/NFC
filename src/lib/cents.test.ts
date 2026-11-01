import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_CENTS, amountErrorText, decimalToCents, formatCents, formatDeduction, formatMoney, parseTypedAmount,
} from "@/lib/cents";
import { computeCashFlow, isClockTime } from "@/lib/cash-flow";

/*
 * Daily Summary R1: money is integer cents, shown with thousands separators, and zero never carries a
 * minus sign. None of this touches dailySummary()'s data object.
 */

test("formatCents: thousands separators, two decimals, a real minus for negatives", () => {
  assert.equal(formatCents(7637500), "76,375.00");
  assert.equal(formatCents(100), "1.00");
  assert.equal(formatCents(5), "0.05");
  assert.equal(formatCents(123456789), "1,234,567.89");
  assert.equal(formatCents(-845000), "−8,450.00");
  assert.equal(formatCents(MAX_CENTS), "99,999,999.99");
});

test("formatCents: zero is '0.00' with NO minus sign, whichever way it arrives", () => {
  assert.equal(formatCents(0), "0.00");
  assert.equal(formatCents(-0), "0.00");
  assert.equal(formatDeduction("0.00"), "0.00");
  assert.equal(formatDeduction("-0.00"), "0.00");
  assert.equal(formatMoney("-0.00"), "0.00");
});

test("formatDeduction shows a deduction as a negative; formatMoney keeps the data object's own sign", () => {
  assert.equal(formatDeduction("8450.00"), "−8,450.00");
  assert.equal(formatDeduction("-8450.00"), "−8,450.00");
  assert.equal(formatMoney("76375.00"), "76,375.00");
  assert.equal(formatMoney("-1250.50"), "−1,250.50");
  assert.equal(formatMoney("999.9"), "999.90");
});

test("decimalToCents reads the data object's strings exactly (no float)", () => {
  assert.equal(decimalToCents("76375.00"), 7637500);
  assert.equal(decimalToCents("0.10"), 10);
  assert.equal(decimalToCents("0.2"), 20);
  assert.equal(decimalToCents("-0.00"), 0);
  assert.equal(decimalToCents("1333.33"), 133333);
  assert.equal(decimalToCents("nonsense"), 0);
  assert.equal(decimalToCents(""), 0);
});

test("parseTypedAmount: what people type", () => {
  const cents = (s: string) => {
    const r = parseTypedAmount(s);
    assert.ok(r.ok, `${s} should parse`);
    return r.ok ? r.cents : -1;
  };
  assert.equal(cents("5000"), 500000);
  assert.equal(cents("5,000"), 500000);
  assert.equal(cents(" 1,250.5 "), 125050);
  assert.equal(cents("0.05"), 5);
  assert.equal(cents(".5"), 50);
  assert.equal(cents("0"), 0);
  assert.equal(cents("1,234,567.89"), 123456789);
  assert.equal(cents("99,999,999.99"), MAX_CENTS);
  assert.equal(cents("007"), 700);
});

test("parseTypedAmount: every refusal has a reason and a sentence", () => {
  const why = (s: string) => {
    const r = parseTypedAmount(s);
    return r.ok ? "ok" : r.reason;
  };
  assert.equal(why(""), "empty");
  assert.equal(why("   "), "empty");
  assert.equal(why("-5"), "negative");
  assert.equal(why("−5"), "negative");
  assert.equal(why("1.234"), "format");
  assert.equal(why("12,34"), "format");
  assert.equal(why("1,2345"), "format");
  assert.equal(why("abc"), "format");
  assert.equal(why("1e5"), "format");
  assert.equal(why("."), "format");
  assert.equal(why("5 000"), "format");
  assert.equal(why("100,000,000.00"), "too-big");
  assert.equal(why("99999999.995"), "format");
  assert.equal(why("100000000"), "too-big");
  for (const r of ["empty", "format", "negative", "too-big"] as const) assert.ok(amountErrorText(r).length > 5);
});

test("the 0.1 + 0.2 trap: cents add exactly where floats do not", () => {
  assert.notEqual(0.1 + 0.2, 0.3); // the float problem this module exists to avoid
  const a = parseTypedAmount("0.10");
  const b = parseTypedAmount("0.20");
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) assert.equal(formatCents(a.cents + b.cents), "0.30");
  const flow = computeCashFlow({ bringForward: 10, collected: 20, deductions: 0, bank: [] });
  assert.equal(flow.shouldBe, 30);
});

test("cash flow: should be in the drawer, taken to the bank, left in the drawer", () => {
  const f = computeCashFlow({
    bringForward: 500000, // 5,000.00
    collected: 7637500, // 76,375.00
    deductions: 845000, // 8,450.00
    bank: [{ cents: 5000000 }, { cents: 1500000 }],
  });
  assert.equal(f.shouldBe, 7292500);
  assert.equal(formatCents(f.shouldBe), "72,925.00");
  assert.equal(f.bankTotal, 6500000);
  assert.equal(f.left, 792500);
  assert.equal(formatCents(f.left), "7,925.00");
  assert.equal(f.overdrawn, false);
});

test("cash flow: nothing banked leaves everything; Left equals Should-be", () => {
  const f = computeCashFlow({ bringForward: 0, collected: 100, deductions: 40, bank: [] });
  assert.equal(f.left, f.shouldBe);
  assert.equal(f.left, 60);
});

test("cash flow: banking more than the drawer holds is flagged, never hidden", () => {
  const f = computeCashFlow({ bringForward: 0, collected: 1000, deductions: 0, bank: [{ cents: 1500 }] });
  assert.equal(f.left, -500);
  assert.equal(f.overdrawn, true);
  assert.equal(formatCents(f.left), "−5.00");
});

test("cash flow: deductions above the cash make 'Should be' negative, shown as such — and that alone is NOT over-banking", () => {
  const f = computeCashFlow({ bringForward: 0, collected: 0, deductions: 450000, bank: [] });
  assert.equal(f.shouldBe, -450000);
  assert.equal(formatCents(f.shouldBe), "−4,500.00");
  assert.equal(f.left, -450000);
  assert.equal(f.overdrawn, false); // a loss day with nothing banked can still be printed
});

test("cash flow: any bank line on a drawer that is already short IS over-banking", () => {
  const f = computeCashFlow({ bringForward: 0, collected: 0, deductions: 450000, bank: [{ cents: 100 }] });
  assert.equal(f.overdrawn, true);
  const exact = computeCashFlow({ bringForward: 0, collected: 1000, deductions: 0, bank: [{ cents: 1000 }] });
  assert.equal(exact.left, 0);
  assert.equal(exact.overdrawn, false); // banking exactly what the drawer holds is fine
});

test("isClockTime accepts real clock times only", () => {
  for (const ok of ["00:00", "09:05", "23:59"]) assert.ok(isClockTime(ok), ok);
  for (const bad of ["24:00", "9:05", "12:60", "12:5", "ab:cd", "", "12:30:00"]) assert.ok(!isClockTime(bad), bad);
});
