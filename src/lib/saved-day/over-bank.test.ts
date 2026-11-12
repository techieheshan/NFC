import { test } from "node:test";
import assert from "node:assert/strict";

import { overBankedBanner, overBankedBy, overBankRefusal } from "./over-bank";

test("overBankedBy: money banked and a negative Left is over-banked by that amount; nothing banked is never over-banked", () => {
  assert.equal(overBankedBy(1_000_000, -50_000), 50_000);
  assert.equal(overBankedBy(1_000_000, 0), 0, "Left exactly zero is fine");
  assert.equal(overBankedBy(1_000_000, 20_000), 0);
  assert.equal(overBankedBy(0, -500_000), 0, "deductions above the cash with nothing banked is NOT over-banking");
  assert.equal(overBankedBy(1, -1), 1);
});

test("the over-bank sentences name the amount (R1 formatters) and say what to do", () => {
  assert.equal(overBankRefusal(40_000), "The money taken to the bank is 400.00 more than the drawer should hold.");
  assert.equal(overBankedBanner(123_456_700), "Bank deposits are 1,234,567.00 more than the drawer should hold. Edit the bank lines or the bring-forward.");
});
