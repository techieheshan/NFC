import { test } from "node:test";
import assert from "node:assert/strict";

import { computeCashFlow } from "@/lib/cash-flow";

test("no other income: the result is exactly the old shape (no otherIn key)", () => {
  const f = computeCashFlow({ bringForward: 100, collected: 1000, deductions: 40, bank: [] });
  assert.deepEqual(f, { bringForward: 100, collected: 1000, deductions: 40, shouldBe: 1060, bankTotal: 0, left: 1060, overdrawn: false });
  assert.equal("otherIn" in f, false);
  assert.deepEqual(computeCashFlow({ bringForward: 100, collected: 1000, deductions: 40, otherIn: 0, bank: [] }), f);
});

test("other cash in is added to the drawer: bring-forward + collected + other cash − deductions", () => {
  const f = computeCashFlow({ bringForward: 10000, collected: 100000, deductions: 4000, otherIn: 29050, bank: [] });
  assert.equal(f.otherIn, 29050);
  assert.equal(f.shouldBe, 10000 + 100000 + 29050 - 4000);
  assert.equal(f.left, f.shouldBe);
});

test("the bank lines come out of a drawer that includes other cash; over-banking is judged on that figure", () => {
  assert.equal(computeCashFlow({ bringForward: 0, collected: 1000, deductions: 0, otherIn: 500, bank: [{ cents: 1500 }] }).overdrawn, false);
  const over = computeCashFlow({ bringForward: 0, collected: 1000, deductions: 0, otherIn: 500, bank: [{ cents: 1501 }] });
  assert.equal(over.overdrawn, true);
  assert.equal(over.left, -1);
});

test("integer cents: no float drift with awkward amounts", () => {
  const f = computeCashFlow({ bringForward: 1, collected: 10, deductions: 3, otherIn: 20, bank: [] });
  assert.equal(f.shouldBe, 28);
});
